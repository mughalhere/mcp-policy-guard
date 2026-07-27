import { allow, deny, requireConfirmation } from "./types.js";
import type { PolicyRule } from "./types.js";

/**
 * Serialisable policy shape, for loading rules from JSON/YAML config rather
 * than code. Conditions (`when`) cannot be expressed here — they are functions.
 */
export type PolicyConfig = {
  allow?: string[];
  deny?: string[];
  requireConfirmation?: string[];
  /** Alias for `requireConfirmation`, for terser config files. */
  confirm?: string[];
};

/**
 * Build a rule list from plain data.
 *
 * ```ts
 * const policies = policiesFromConfig(JSON.parse(await readFile("policy.json", "utf8")));
 * ```
 *
 * Throws on unknown keys so a typo (`allowed:`) fails loudly at boot instead of
 * silently widening or narrowing access.
 */
export function policiesFromConfig(config: PolicyConfig): PolicyRule[] {
  if (!config || typeof config !== "object") {
    throw new TypeError("mcp-policy-guard: policy config must be an object");
  }

  const known = new Set(["allow", "deny", "requireConfirmation", "confirm"]);
  for (const key of Object.keys(config)) {
    if (!known.has(key)) {
      throw new TypeError(
        `mcp-policy-guard: unknown policy config key "${key}" (expected ${[...known].join(", ")})`,
      );
    }
  }

  const rules: PolicyRule[] = [];
  const confirmPatterns = [...(config.requireConfirmation ?? []), ...(config.confirm ?? [])];

  if (config.deny?.length) rules.push(deny(...assertStrings(config.deny, "deny")));
  if (confirmPatterns.length) {
    rules.push(requireConfirmation(...assertStrings(confirmPatterns, "requireConfirmation")));
  }
  if (config.allow?.length) rules.push(allow(...assertStrings(config.allow, "allow")));

  return rules;
}

function assertStrings(values: unknown, key: string): string[] {
  if (!Array.isArray(values) || values.some((v) => typeof v !== "string")) {
    throw new TypeError(`mcp-policy-guard: policy config "${key}" must be an array of strings`);
  }
  return values as string[];
}
