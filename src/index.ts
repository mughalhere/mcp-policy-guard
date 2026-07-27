/**
 * mcp-policy-guard — policy & safety middleware for MCP servers.
 *
 * @packageDocumentation
 */

export { guard, createGuardedHandler } from "./guard.js";

// Policy
export { allow, deny, requireConfirmation } from "./policy/types.js";
export type {
  PolicyRule,
  PolicyRuleOptions,
  PolicyDecision,
  PolicyKind,
  PolicyContext,
  PolicyCondition,
} from "./policy/types.js";
export { evaluatePolicy } from "./policy/evaluate.js";
export { policiesFromConfig } from "./policy/config.js";
export type { PolicyConfig } from "./policy/config.js";
export {
  and,
  or,
  not,
  argEquals,
  argMatches,
  argStartsWith,
  argGlob,
  argPresent,
  argInRange,
  identityIs,
  metaEquals,
} from "./policy/conditions.js";

// Glob matching
export { matchGlob, matchAnyGlob, globToRegExp, clearGlobCache } from "./policy/glob.js";
export type { GlobOptions } from "./policy/glob.js";

// Rate limiting
export { TokenBucket, RateLimiter } from "./rate-limit/token-bucket.js";
export type {
  RateLimitConfig,
  RateLimitOverride,
  RateLimitResult,
  RateLimitScope,
  TokenBucketOptions,
} from "./rate-limit/token-bucket.js";

// Confirmation
export {
  hashArgs,
  createConfirmationToken,
  issueConfirmation,
  consumeConfirmation,
  revokeConfirmation,
  defaultConfirmationStore,
  InMemoryConfirmationStore,
  CONFIRMATION_TTL_MS,
} from "./confirmation/tokens.js";
export type {
  ConfirmationStore,
  ConfirmationRecord,
  InMemoryConfirmationStoreOptions,
} from "./confirmation/store.js";
export type {
  ConsumeConfirmationOptions,
  ConsumeResult,
  IssueConfirmationOptions,
} from "./confirmation/tokens.js";

// Audit
export { writeAudit, nextCallId } from "./audit/audit.js";
export type {
  AuditConfig,
  AuditEntry,
  AuditInput,
  AuditOutcome,
  AuditSink,
  AuditSinkFn,
} from "./audit/audit.js";

// Redaction
export {
  redactResult,
  redactArgs,
  redactString,
  luhnValid,
  BUILTIN_PATTERNS,
  DEFAULT_PATTERNS,
  STRICT_PATTERNS,
  DEFAULT_SENSITIVE_KEYS,
} from "./redact/redact.js";
export type { RedactConfig, RedactPatternSelection } from "./redact/redact.js";

// Tool listing
export { filterTools, filterToolsListResult } from "./tools-list.js";
export type { FilterToolsOptions, ToolDescriptor, ToolsListResult } from "./tools-list.js";

// Errors
export { GuardErrorCode, formatGuardError } from "./errors.js";
export type { GuardError } from "./errors.js";

// Metrics
export { GuardMetrics } from "./metrics.js";
export type { GuardMetricsSnapshot } from "./metrics.js";

// Logging
export { getLogger, setLogger, resetLogger } from "./logger.js";

export type {
  ApprovalRequest,
  ConfirmationOptions,
  GuardEvent,
  GuardOptions,
  GuardableServer,
  IdentifyFn,
  RequestHandler,
  ToolCallHandler,
  ToolCallRequest,
  ToolCallResult,
  ValidateFn,
} from "./types.js";
