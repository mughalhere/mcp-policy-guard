import { writeAudit } from "./audit/audit.js";
import {
  consumeConfirmation,
  defaultConfirmationStore,
  issueConfirmation,
} from "./confirmation/tokens.js";
import { getLogger } from "./logger.js";
import { evaluatePolicy } from "./policy/evaluate.js";
import { RateLimiter } from "./rate-limit/token-bucket.js";
import { redactResult } from "./redact/redact.js";
import type {
  GuardableServer,
  GuardOptions,
  ToolCallHandler,
  ToolCallRequest,
  ToolCallResult,
} from "./types.js";

function textResult(text: string, isError = false): ToolCallResult {
  return { content: [{ type: "text", text }], isError };
}

/**
 * Wrap an MCP server with policy, rate-limit, confirmation, audit, and redaction.
 * Register tools first, then call guard(server, options).
 */
export function guard<T extends GuardableServer>(server: T, options: GuardOptions = {}): T {
  const handler = createGuardedHandlerFromServer(server, options);
  const low = server.server;
  if (low?.setRequestHandler) {
    low.setRequestHandler("tools/call", handler);
  } else if (server.setRequestHandler) {
    server.setRequestHandler("tools/call", handler);
  } else {
    throw new Error(
      "mcp-policy-guard: server does not expose setRequestHandler. Pass an MCP Server or McpServer instance.",
    );
  }
  return server;
}

/** Wrap a tools/call handler directly — preferred for tests and composition. */
export function createGuardedHandler(
  inner: ToolCallHandler,
  options: GuardOptions = {},
): ToolCallHandler {
  return buildWrapper(inner, options);
}

function createGuardedHandlerFromServer(
  server: GuardableServer,
  options: GuardOptions,
): ToolCallHandler {
  const existing =
    server.server?._requestHandlers?.get("tools/call") ??
    ((async () =>
      textResult(
        JSON.stringify({
          error: "misconfigured",
          message:
            "No tools/call handler found. Register tools before calling guard(), or use createGuardedHandler().",
        }),
        true,
      )) as ToolCallHandler);

  return buildWrapper(existing, options);
}

function buildWrapper(inner: ToolCallHandler, options: GuardOptions): ToolCallHandler {
  const log = getLogger(options.debug === true);
  const policies = options.policies ?? [];
  const store = options.confirmationStore ?? defaultConfirmationStore();
  const tokenKey = options.confirmationTokenKey ?? "confirmationToken";
  const rateLimiter = options.rateLimit ? new RateLimiter(options.rateLimit) : null;
  const defaultAllow = options.defaultAllow === true;

  return async (request, extra) => {
    const started = Date.now();
    const toolName = request.params.name;
    const args = { ...(request.params.arguments ?? {}) };
    const confirmationToken =
      typeof args[tokenKey] === "string" ? (args[tokenKey] as string) : undefined;
    const callArgs = { ...args };
    delete callArgs[tokenKey];

    log.debug({ toolName }, "tool call");

    if (rateLimiter) {
      const limit = rateLimiter.check(toolName);
      if (!limit.ok) {
        await writeAudit(options.audit, {
          tool: toolName,
          args: callArgs,
          decision: "rate_limited",
          latencyMs: Date.now() - started,
          outcome: "denied",
          error: `retry after ${limit.retryAfterMs}ms`,
        });
        return textResult(
          JSON.stringify({
            error: "rate_limited",
            message: `Rate limit exceeded for tool "${toolName}"`,
            retryAfterMs: limit.retryAfterMs,
          }),
          true,
        );
      }
    }

    const decision = evaluatePolicy(toolName, policies, defaultAllow);

    if (decision.action === "deny") {
      await writeAudit(options.audit, {
        tool: toolName,
        args: callArgs,
        decision: "deny",
        latencyMs: Date.now() - started,
        outcome: "denied",
        error: decision.reason,
      });
      return textResult(JSON.stringify({ error: "denied", message: decision.reason }), true);
    }

    if (decision.action === "requireConfirmation") {
      if (!confirmationToken) {
        const issued = await issueConfirmation(store, toolName, callArgs);
        await writeAudit(options.audit, {
          tool: toolName,
          args: callArgs,
          decision: "requireConfirmation",
          latencyMs: Date.now() - started,
          outcome: "confirmation_required",
        });
        return textResult(
          JSON.stringify({
            error: "confirmation_required",
            message: decision.reason,
            confirmationToken: issued.token,
            expiresAt: new Date(issued.expiresAt).toISOString(),
            hint: `Retry the same tool call with arguments.${tokenKey} set to the confirmationToken.`,
          }),
          true,
        );
      }

      const consumed = await consumeConfirmation(store, confirmationToken, toolName, callArgs);
      if (!consumed.ok) {
        await writeAudit(options.audit, {
          tool: toolName,
          args: callArgs,
          decision: "confirmation_failed",
          latencyMs: Date.now() - started,
          outcome: "denied",
          error: consumed.reason,
        });
        return textResult(
          JSON.stringify({ error: "confirmation_failed", message: consumed.reason }),
          true,
        );
      }
    }

    try {
      const forwarded: ToolCallRequest = {
        ...request,
        params: { ...request.params, arguments: callArgs },
      };
      let result = await inner(forwarded, extra);
      if (options.redact) result = redactResult(result, options.redact);
      await writeAudit(options.audit, {
        tool: toolName,
        args: callArgs,
        decision: decision.action,
        latencyMs: Date.now() - started,
        outcome: result.isError ? "error" : "success",
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await writeAudit(options.audit, {
        tool: toolName,
        args: callArgs,
        decision: decision.action,
        latencyMs: Date.now() - started,
        outcome: "error",
        error: message,
      });
      throw err;
    }
  };
}
