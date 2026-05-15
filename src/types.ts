import type { AuditConfig } from "./audit/audit.js";
import type { ConfirmationStore } from "./confirmation/store.js";
import type { PolicyRule } from "./policy/types.js";
import type { RateLimitConfig } from "./rate-limit/token-bucket.js";
import type { RedactConfig } from "./redact/redact.js";

/** Minimal surface we need from an MCP server / McpServer wrapper. */
export type GuardableServer = {
  server?: {
    setRequestHandler?: (method: string, handler: ToolCallHandler) => void;
    _requestHandlers?: Map<string, ToolCallHandler>;
  };
  setRequestHandler?: (method: string | { shape?: unknown }, handler: ToolCallHandler) => void;
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

export type GuardOptions = {
  policies?: PolicyRule[];
  rateLimit?: RateLimitConfig;
  audit?: AuditConfig;
  redact?: RedactConfig;
  /** When true, unmatched tools are allowed. Default: false (default deny). */
  defaultAllow?: boolean;
  confirmationStore?: ConfirmationStore;
  /** Argument key used to pass confirmation token on retry. Default: confirmationToken */
  confirmationTokenKey?: string;
  debug?: boolean;
};
