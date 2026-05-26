/**
 * mcp-policy-guard — policy & safety middleware for MCP servers.
 *
 * @packageDocumentation
 */

export { guard, createGuardedHandler } from "./guard.js";
export { allow, deny, requireConfirmation } from "./policy/types.js";
export type { PolicyRule, PolicyDecision, PolicyKind } from "./policy/types.js";
export { evaluatePolicy } from "./policy/evaluate.js";
export { matchGlob, matchAnyGlob, globToRegExp } from "./policy/glob.js";
export { TokenBucket, RateLimiter } from "./rate-limit/token-bucket.js";
export type { RateLimitConfig, TokenBucketOptions } from "./rate-limit/token-bucket.js";
export {
  hashArgs,
  createConfirmationToken,
  issueConfirmation,
  consumeConfirmation,
  defaultConfirmationStore,
  InMemoryConfirmationStore,
  CONFIRMATION_TTL_MS,
} from "./confirmation/tokens.js";
export type { ConfirmationStore, ConfirmationRecord } from "./confirmation/store.js";
export { writeAudit } from "./audit/audit.js";
export type { AuditConfig, AuditEntry, AuditSink } from "./audit/audit.js";
export { redactResult, redactString, BUILTIN_PATTERNS } from "./redact/redact.js";
export type { RedactConfig } from "./redact/redact.js";
export type {
  GuardOptions,
  GuardableServer,
  ToolCallHandler,
  ToolCallRequest,
  ToolCallResult,
} from "./types.js";
