import { nextCallId, writeAudit, type AuditOutcome } from "./audit/audit.js";
import {
  consumeConfirmation,
  defaultConfirmationStore,
  issueConfirmation,
} from "./confirmation/tokens.js";
import { formatGuardError, GuardErrorCode, textResult, type GuardErrorFields } from "./errors.js";
import { getLogger } from "./logger.js";
import { evaluatePolicy } from "./policy/evaluate.js";
import type { PolicyContext } from "./policy/types.js";
import { RateLimiter, type RateLimitScope } from "./rate-limit/token-bucket.js";
import { redactArgs, redactResult } from "./redact/redact.js";
import { filterToolsListResult } from "./tools-list.js";
import type {
  GuardableServer,
  GuardEvent,
  GuardOptions,
  RequestHandler,
  ToolCallHandler,
  ToolCallRequest,
  ToolCallResult,
} from "./types.js";

/**
 * Wrap an MCP server with policy, rate limiting, confirmation, audit, and
 * redaction. Register your tools first — `guard()` wraps the handler that is
 * already installed:
 *
 * ```ts
 * const server = new McpServer({ name: "crm", version: "1.0.0" });
 * server.tool("delete_contact", schema, handler);
 * guard(server, { policies: [requireConfirmation("delete_*")] });
 * ```
 *
 * Unless `filterToolList` is false, `tools/list` is wrapped too so denied tools
 * are hidden from the model.
 */
export function guard<T extends GuardableServer>(server: T, options: GuardOptions = {}): T {
  const handlers = findHandlerMap(server);
  const existingCall = handlers?.get("tools/call") as ToolCallHandler | undefined;
  const wrapped = buildWrapper(existingCall ?? missingHandler(), options);

  install(server, handlers, "tools/call", wrapped as RequestHandler);

  if (options.filterToolList !== false) {
    const existingList = handlers?.get("tools/list");
    if (existingList) {
      const filtered: RequestHandler = async (request, extra) => {
        const result = await existingList(request, extra);
        return filterToolsListResult(result as { tools: Array<{ name: string }> }, {
          policies: options.policies,
          defaultAllow: options.defaultAllow,
        });
      };
      install(server, handlers, "tools/list", filtered);
    }
  }

  return server;
}

/**
 * Wrap a `tools/call` handler directly. Preferred for tests, composition, and
 * servers that do not expose their handler map.
 */
export function createGuardedHandler(
  inner: ToolCallHandler,
  options: GuardOptions = {},
): ToolCallHandler {
  return buildWrapper(inner, options);
}

function findHandlerMap(server: GuardableServer): Map<string, RequestHandler> | undefined {
  const candidate = server.server?._requestHandlers ?? server._requestHandlers;
  return candidate instanceof Map ? candidate : undefined;
}

function install(
  server: GuardableServer,
  handlers: Map<string, RequestHandler> | undefined,
  method: string,
  handler: RequestHandler,
): void {
  // Writing straight into the handler map keeps the SDK's zod schema wiring
  // intact; setRequestHandler() expects a schema object, not a method string.
  if (handlers) {
    handlers.set(method, handler);
    return;
  }
  const setter = server.server?.setRequestHandler ?? server.setRequestHandler;
  if (setter) {
    setter.call(server.server ?? server, method, handler);
    return;
  }
  throw new Error(
    "mcp-policy-guard: server exposes neither a request-handler map nor setRequestHandler. " +
      "Pass an MCP Server/McpServer instance, or wrap your handler with createGuardedHandler().",
  );
}

function missingHandler(): ToolCallHandler {
  return async () =>
    textResult(
      JSON.stringify({
        error: GuardErrorCode.MISCONFIGURED,
        message:
          "No tools/call handler found. Register tools before calling guard(), or use createGuardedHandler().",
      }),
      true,
    );
}

function buildWrapper(inner: ToolCallHandler, options: GuardOptions): ToolCallHandler {
  const log = getLogger(options.debug === true);
  const policies = options.policies ?? [];
  const defaultAllow = options.defaultAllow === true;
  const confirmation = options.confirmation ?? {};
  const store = confirmation.store ?? options.confirmationStore ?? defaultConfirmationStore();
  const tokenKey = confirmation.tokenKey ?? options.confirmationTokenKey ?? "confirmationToken";
  const bindIdentity = confirmation.bindIdentity !== false;
  const rateLimiter = options.rateLimit ? new RateLimiter(options.rateLimit) : null;
  const redactionOfResults = options.redact && options.redact.results !== false;
  const redactionOfArgs = options.redact?.arguments === true;
  const auditRedact =
    options.audit?.redact ?? (options.redact && options.redact.auditArgs !== false ? options.redact : undefined);
  const emitError = options.formatError ?? formatGuardError;

  return async (request, extra) => {
    const started = Date.now();
    const callId = nextCallId();
    const tool = request.params.name;

    const rawArgs = { ...(request.params.arguments ?? {}) };
    const suppliedToken = typeof rawArgs[tokenKey] === "string" ? (rawArgs[tokenKey] as string) : undefined;
    const args = { ...rawArgs };
    delete args[tokenKey];

    let identity: string | undefined;
    if (options.identify) {
      try {
        identity = await options.identify(request, extra);
      } catch (err) {
        log.warn({ err: String(err), tool }, "identify() threw; treating caller as anonymous");
      }
    }

    const context: PolicyContext = {
      tool,
      args,
      ...(identity !== undefined ? { identity } : {}),
      ...(request.params._meta ? { meta: request.params._meta } : {}),
    };

    log.debug({ tool, identity, callId }, "tool call");

    /** Record the outcome once, on every exit path. */
    const finish = async (
      decision: string,
      outcome: AuditOutcome,
      details: { reason?: string; error?: string; rateLimitScope?: RateLimitScope } = {},
    ): Promise<void> => {
      const latencyMs = Date.now() - started;
      await writeAudit(
        options.audit ? { ...options.audit, redact: auditRedact } : undefined,
        {
          callId,
          tool,
          args,
          decision,
          latencyMs,
          outcome,
          ...(identity !== undefined ? { identity } : {}),
          ...(details.reason !== undefined ? { reason: details.reason } : {}),
          ...(details.error !== undefined ? { error: details.error } : {}),
          ...(details.rateLimitScope ? { rateLimitScope: details.rateLimitScope } : {}),
        },
      );

      if (!options.onDecision) return;
      const event: GuardEvent = {
        callId,
        tool,
        args,
        decision,
        outcome,
        latencyMs,
        ...(identity !== undefined ? { identity } : {}),
        ...(details.reason !== undefined ? { reason: details.reason } : {}),
        ...(details.error !== undefined ? { error: details.error } : {}),
        ...(details.rateLimitScope ? { rateLimitScope: details.rateLimitScope } : {}),
      };
      try {
        await options.onDecision(event);
      } catch (err) {
        // Observability must not be able to break a tool call.
        log.warn({ err: String(err) }, "onDecision hook failed");
      }
    };

    const reject = async (
      error: Omit<GuardErrorFields, "tool"> & Record<string, unknown>,
      decision: string,
      outcome: AuditOutcome,
      details: { rateLimitScope?: RateLimitScope } = {},
    ): Promise<ToolCallResult> => {
      await finish(decision, outcome, { error: error.message, ...details });
      return emitError({ ...error, tool });
    };

    if (rateLimiter) {
      const limit = rateLimiter.check(tool, identity);
      if (!limit.ok) {
        return reject(
          {
            error: GuardErrorCode.RATE_LIMITED,
            message: `Rate limit exceeded for tool "${tool}" (${limit.limit} per ${limit.windowMs}ms, ${limit.scope} scope)`,
            retryAfterMs: limit.retryAfterMs,
            scope: limit.scope,
          },
          "rate_limited",
          "denied",
          { rateLimitScope: limit.scope },
        );
      }
    }

    const decision = evaluatePolicy(context, policies, defaultAllow);

    if (decision.action === "deny") {
      return reject(
        { error: GuardErrorCode.DENIED, message: decision.reason },
        "deny",
        "denied",
      );
    }

    if (options.validate) {
      let verdict: true | string;
      try {
        verdict = await options.validate(context);
      } catch (err) {
        verdict = err instanceof Error ? err.message : String(err);
      }
      if (verdict !== true) {
        return reject(
          { error: GuardErrorCode.INVALID_ARGUMENTS, message: verdict },
          "invalid_arguments",
          "denied",
        );
      }
    }

    if (decision.action === "requireConfirmation") {
      if (confirmation.approve) {
        let approved = false;
        let failure: string | undefined;
        try {
          approved = await confirmation.approve({
            tool,
            args,
            reason: decision.reason,
            ...(identity !== undefined ? { identity } : {}),
          });
        } catch (err) {
          failure = err instanceof Error ? err.message : String(err);
        }
        if (!approved) {
          return reject(
            {
              error: GuardErrorCode.CONFIRMATION_FAILED,
              message: failure ?? `Approval refused for tool "${tool}"`,
            },
            "confirmation_failed",
            "denied",
          );
        }
      } else if (!suppliedToken) {
        const issued = await issueConfirmation(store, tool, args, {
          ...(confirmation.ttlMs !== undefined ? { ttlMs: confirmation.ttlMs } : {}),
          ...(bindIdentity && identity !== undefined ? { identity } : {}),
        });
        await finish("requireConfirmation", "confirmation_required", { reason: decision.reason });
        return emitError({
          error: GuardErrorCode.CONFIRMATION_REQUIRED,
          message: decision.reason,
          tool,
          confirmationToken: issued.token,
          expiresAt: new Date(issued.expiresAt).toISOString(),
          hint: `Retry the same tool call with arguments.${tokenKey} set to the confirmationToken.`,
        });
      } else {
        const consumed = await consumeConfirmation(store, suppliedToken, tool, args, {
          ...(bindIdentity && identity !== undefined ? { identity } : {}),
        });
        if (!consumed.ok) {
          return reject(
            { error: GuardErrorCode.CONFIRMATION_FAILED, message: consumed.reason },
            "confirmation_failed",
            "denied",
          );
        }
      }
    }

    const forwarded: ToolCallRequest = {
      ...request,
      params: {
        ...request.params,
        arguments: redactionOfArgs ? redactArgs(args, options.redact ?? {}) : args,
      },
    };

    try {
      let result = await callWithTimeout(inner, forwarded, extra, options.timeoutMs);
      if (redactionOfResults) result = redactResult(result, options.redact ?? {});
      await finish(decision.action, result.isError ? "error" : "success", {
        ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (err instanceof GuardTimeoutError) {
        return reject(
          {
            error: GuardErrorCode.TIMEOUT,
            message: `Tool "${tool}" exceeded the ${options.timeoutMs}ms guard timeout`,
          },
          decision.action,
          "timeout",
        );
      }

      await finish(decision.action, "error", { error: message });
      throw err;
    }
  };
}

class GuardTimeoutError extends Error {}

async function callWithTimeout(
  inner: ToolCallHandler,
  request: ToolCallRequest,
  extra: unknown,
  timeoutMs: number | undefined,
): Promise<ToolCallResult> {
  if (!timeoutMs || timeoutMs <= 0) return inner(request, extra);

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      inner(request, extra),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new GuardTimeoutError("guard timeout")), timeoutMs);
        // Do not hold the event loop open on the timeout alone.
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
