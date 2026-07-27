import type { AuditConfig, AuditOutcome } from "./audit/audit.js";
import type { ConfirmationStore } from "./confirmation/store.js";
import type { GuardError } from "./errors.js";
import type { PolicyContext, PolicyRule } from "./policy/types.js";
import type { RateLimitConfig, RateLimitScope } from "./rate-limit/token-bucket.js";
import type { RedactConfig } from "./redact/redact.js";

/** Minimal surface needed from an MCP `Server` or `McpServer` instance. */
export type GuardableServer = {
  server?: {
    setRequestHandler?: (method: unknown, handler: RequestHandler) => void;
    _requestHandlers?: Map<string, RequestHandler>;
  };
  setRequestHandler?: (method: unknown, handler: RequestHandler) => void;
  _requestHandlers?: Map<string, RequestHandler>;
};

export type ToolCallRequest = {
  params: {
    name: string;
    arguments?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
};

export type ToolCallResult = {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
  [key: string]: unknown;
};

export type ToolCallHandler = (
  request: ToolCallRequest,
  extra?: unknown,
) => Promise<ToolCallResult>;

/** Any JSON-RPC request handler registered on the server. */
export type RequestHandler = (request: any, extra?: unknown) => Promise<any>;

/** Derive a caller identity from the request. Return `undefined` for anonymous. */
export type IdentifyFn = (
  request: ToolCallRequest,
  extra?: unknown,
) => string | undefined | Promise<string | undefined>;

/**
 * Extra argument validation, run after policy and before the tool.
 * Return `true` to accept, or a string describing why the call was rejected.
 */
export type ValidateFn = (
  context: PolicyContext,
) => true | string | Promise<true | string>;

/** Context handed to an out-of-band confirmation approver. */
export type ApprovalRequest = {
  tool: string;
  args: Record<string, unknown>;
  identity?: string;
  reason: string;
};

export type ConfirmationOptions = {
  /** Token store. Default: a per-guard in-memory store. */
  store?: ConfirmationStore;
  /** Argument key carrying the token on retry. Default: `confirmationToken`. */
  tokenKey?: string;
  /** Token lifetime in ms. Default: 300_000 (5 minutes). */
  ttlMs?: number;
  /** Bind tokens to the issuing identity so another caller cannot redeem them. Default: true. */
  bindIdentity?: boolean;
  /**
   * Approve out of band instead of round-tripping a token through the model.
   * Return `true` to let the call through. Throwing counts as a refusal.
   * When set, no token is issued.
   */
  approve?: (request: ApprovalRequest) => boolean | Promise<boolean>;
};

/** Emitted once per call, after the outcome is known. */
export type GuardEvent = {
  /** Correlates with the `callId` on the audit entry. */
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  identity?: string;
  /** Policy action, or the stage that blocked: `rate_limited`, `confirmation_failed`, … */
  decision: string;
  outcome: AuditOutcome;
  reason?: string;
  latencyMs: number;
  error?: string;
  /** Which bucket rejected, on `rate_limited`. */
  rateLimitScope?: RateLimitScope;
};

export type GuardOptions = {
  /** Rules evaluated as deny → requireConfirmation → allow. */
  policies?: PolicyRule[];
  /** When true, tools matching no rule are allowed. Default: false (default deny). */
  defaultAllow?: boolean;
  rateLimit?: RateLimitConfig;
  audit?: AuditConfig;
  redact?: RedactConfig;
  confirmation?: ConfirmationOptions;
  /** Resolve who is calling — used by policies, rate limits, audit, and token binding. */
  identify?: IdentifyFn;
  /** Extra argument validation run after policy, before the tool. */
  validate?: ValidateFn;
  /** Abort and return a `timeout` error if the tool exceeds this many ms. */
  timeoutMs?: number;
  /** Also wrap `tools/list` so denied tools are hidden. `guard()` only. Default: true. */
  filterToolList?: boolean;
  /** Called once per call with the final outcome. Errors thrown here are swallowed. */
  onDecision?: (event: GuardEvent) => void | Promise<void>;
  /** Override how rejections are serialised into a tool result. */
  formatError?: (error: GuardError) => ToolCallResult;
  /** Raise the shared logger to `debug`. Default: false (silent). */
  debug?: boolean;

  /** @deprecated Use `confirmation.store`. Kept for v0.1 compatibility. */
  confirmationStore?: ConfirmationStore;
  /** @deprecated Use `confirmation.tokenKey`. Kept for v0.1 compatibility. */
  confirmationTokenKey?: string;
};
