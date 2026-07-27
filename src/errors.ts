import type { ToolCallResult } from "./types.js";

/**
 * Stable machine-readable codes carried in the `error` field of every guard
 * rejection. Clients and agents should branch on these rather than on message
 * text, which may be reworded in a minor release.
 */
export const GuardErrorCode = {
  /** Policy denied the call outright. */
  DENIED: "denied",
  /** A rate-limit bucket rejected the call. */
  RATE_LIMITED: "rate_limited",
  /** Policy requires confirmation; a token is attached to the response. */
  CONFIRMATION_REQUIRED: "confirmation_required",
  /** A confirmation token was supplied but invalid, expired, replayed, or mismatched. */
  CONFIRMATION_FAILED: "confirmation_failed",
  /** The wrapped handler exceeded `timeoutMs`. */
  TIMEOUT: "timeout",
  /** Arguments failed a `validate()` check. */
  INVALID_ARGUMENTS: "invalid_arguments",
  /** guard() could not find the handler it was meant to wrap. */
  MISCONFIGURED: "misconfigured",
} as const;

export type GuardErrorCode = (typeof GuardErrorCode)[keyof typeof GuardErrorCode];

/** Named fields of a rejection. {@link GuardError} adds room for extras. */
export type GuardErrorFields = {
  error: GuardErrorCode;
  message: string;
  tool: string;
  /** Present on `rate_limited`. */
  retryAfterMs?: number;
  /** Present on `confirmation_required`. */
  confirmationToken?: string;
  /** Present on `confirmation_required`, ISO-8601. */
  expiresAt?: string;
};

/** Everything the guard knows about a rejection, before it is serialised. */
export type GuardError = GuardErrorFields & Record<string, unknown>;

/** Turn a rejection into the JSON-in-text error result MCP clients expect. */
export function formatGuardError(error: GuardError): ToolCallResult {
  const { tool: _tool, ...body } = error;
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    isError: true,
  };
}

/** Convenience for building a plain text result. */
export function textResult(text: string, isError = false): ToolCallResult {
  return { content: [{ type: "text", text }], isError };
}
