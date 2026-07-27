export type PolicyKind = "allow" | "deny" | "requireConfirmation";

/** Everything a policy condition can see about the call being evaluated. */
export type PolicyContext = {
  /** Tool name from `params.name`. */
  tool: string;
  /** Tool arguments, with the confirmation token key already stripped. */
  args: Record<string, unknown>;
  /** Caller identity, if `identify()` was configured. */
  identity?: string;
  /** `params._meta` from the MCP request, if any. */
  meta?: Record<string, unknown>;
};

/**
 * Extra predicate attached to a rule. Returning `false` makes the rule
 * not match, so evaluation falls through to later rules.
 */
export type PolicyCondition = (context: PolicyContext) => boolean;

export type PolicyRuleOptions = {
  /** Additional predicate the call must satisfy for the rule to apply. */
  when?: PolicyCondition;
  /** Human-readable reason surfaced to the caller instead of the default text. */
  reason?: string;
  /** Restrict the rule to matching identities (glob patterns). */
  identities?: string[];
  /** Match tool names case-insensitively. Default: false. */
  caseInsensitive?: boolean;
};

export type PolicyRule = PolicyRuleOptions & {
  kind: PolicyKind;
  patterns: string[];
};

type PatternsAndOptions = [...patterns: string[], options: PolicyRuleOptions];

function build(
  kind: PolicyKind,
  args: readonly (string | PolicyRuleOptions)[],
): PolicyRule {
  const patterns: string[] = [];
  let options: PolicyRuleOptions = {};

  for (const arg of args) {
    if (typeof arg === "string") patterns.push(arg);
    else if (arg && typeof arg === "object") options = arg;
  }

  return { kind, patterns, ...options };
}

/**
 * Permit tools matching any of `patterns`.
 *
 * ```ts
 * allow("search_*", "list_*")
 * allow("read_file", { when: argStartsWith("path", "/workspace/") })
 * ```
 */
export function allow(...patterns: string[]): PolicyRule;
export function allow(...args: PatternsAndOptions): PolicyRule;
export function allow(...args: (string | PolicyRuleOptions)[]): PolicyRule {
  return build("allow", args);
}

/** Block tools matching any of `patterns`. Deny always wins over other rules. */
export function deny(...patterns: string[]): PolicyRule;
export function deny(...args: PatternsAndOptions): PolicyRule;
export function deny(...args: (string | PolicyRuleOptions)[]): PolicyRule {
  return build("deny", args);
}

/** Require a confirmation round-trip before tools matching any of `patterns` run. */
export function requireConfirmation(...patterns: string[]): PolicyRule;
export function requireConfirmation(...args: PatternsAndOptions): PolicyRule;
export function requireConfirmation(...args: (string | PolicyRuleOptions)[]): PolicyRule {
  return build("requireConfirmation", args);
}

export type PolicyDecision =
  | { action: "allow"; reason?: string; rule?: PolicyRule }
  | { action: "deny"; reason: string; rule?: PolicyRule }
  | { action: "requireConfirmation"; reason: string; rule?: PolicyRule };
