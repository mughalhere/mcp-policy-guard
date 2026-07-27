import { matchAnyGlob } from "./glob.js";
import type { PolicyContext, PolicyDecision, PolicyRule } from "./types.js";

/** Precedence, highest first. A `deny` anywhere in the list beats every allow. */
const PRECEDENCE = ["deny", "requireConfirmation", "allow"] as const;

function toContext(input: string | PolicyContext): PolicyContext {
  return typeof input === "string" ? { tool: input, args: {} } : input;
}

function ruleApplies(rule: PolicyRule, context: PolicyContext): boolean {
  const options = { caseInsensitive: rule.caseInsensitive === true };
  if (!matchAnyGlob(rule.patterns, context.tool, options)) return false;

  if (rule.identities && rule.identities.length > 0) {
    if (typeof context.identity !== "string") return false;
    if (!matchAnyGlob(rule.identities, context.identity)) return false;
  }

  if (rule.when) {
    try {
      if (!rule.when(context)) return false;
    } catch {
      // A throwing condition must never read as "permitted". Treat the rule as
      // non-matching so evaluation falls through — for an allow rule that means
      // the call ends up denied by default.
      return false;
    }
  }

  return true;
}

/**
 * Resolve a call against the policy list.
 *
 * Order is fixed and independent of declaration order:
 * `deny` → `requireConfirmation` → `allow` → default. Within a kind the first
 * matching rule wins and supplies the reason.
 *
 * Accepts a bare tool name (v0.1 signature) or a full {@link PolicyContext}.
 */
export function evaluatePolicy(
  input: string | PolicyContext,
  policies: readonly PolicyRule[],
  defaultAllow = false,
): PolicyDecision {
  const context = toContext(input);

  for (const kind of PRECEDENCE) {
    const rule = policies.find((p) => p.kind === kind && ruleApplies(p, context));
    if (!rule) continue;

    if (kind === "allow") return { action: "allow", reason: rule.reason, rule };
    if (kind === "deny") {
      return {
        action: "deny",
        reason: rule.reason ?? `Tool "${context.tool}" matched deny policy`,
        rule,
      };
    }
    return {
      action: "requireConfirmation",
      reason: rule.reason ?? `Tool "${context.tool}" requires confirmation`,
      rule,
    };
  }

  if (defaultAllow) return { action: "allow" };

  return {
    action: "deny",
    reason: `Tool "${context.tool}" denied by default (no matching allow rule)`,
  };
}
