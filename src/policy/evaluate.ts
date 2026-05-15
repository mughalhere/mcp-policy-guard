import { matchAnyGlob } from "./glob.js";
import type { PolicyDecision, PolicyRule } from "./types.js";

/** Order: deny → requireConfirmation → allow; else defaultAllow. */
export function evaluatePolicy(
  toolName: string,
  policies: PolicyRule[],
  defaultAllow = false,
): PolicyDecision {
  const denyRule = policies.find(
    (p) => p.kind === "deny" && matchAnyGlob(p.patterns, toolName),
  );
  if (denyRule) {
    return { action: "deny", reason: `Tool "${toolName}" matched deny policy` };
  }

  const confirmRule = policies.find(
    (p) => p.kind === "requireConfirmation" && matchAnyGlob(p.patterns, toolName),
  );
  if (confirmRule) {
    return {
      action: "requireConfirmation",
      reason: `Tool "${toolName}" requires confirmation`,
    };
  }

  const allowRule = policies.find(
    (p) => p.kind === "allow" && matchAnyGlob(p.patterns, toolName),
  );
  if (allowRule) return { action: "allow" };

  if (defaultAllow) return { action: "allow" };

  return {
    action: "deny",
    reason: `Tool "${toolName}" denied by default (no matching allow rule)`,
  };
}
