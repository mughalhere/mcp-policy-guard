import { evaluatePolicy } from "./policy/evaluate.js";
import type { PolicyRule } from "./policy/types.js";

export type ToolDescriptor = { name: string; [key: string]: unknown };
export type ToolsListResult = { tools: ToolDescriptor[]; [key: string]: unknown };

export type FilterToolsOptions = {
  policies?: readonly PolicyRule[];
  defaultAllow?: boolean;
  identity?: string;
};

/**
 * Drop tools the policy would refuse from a `tools/list` response, so a model
 * never sees affordances it cannot use. Hiding is not a security control on its
 * own — every call is still checked at `tools/call` — it just removes the
 * temptation and the wasted round-trip.
 *
 * Rules carrying a `when` condition are evaluated with empty arguments, which
 * cannot be decided ahead of the call. Such tools stay listed and are blocked at
 * call time instead; hiding them would misreport a conditional deny as absolute.
 */
export function filterTools(
  tools: readonly ToolDescriptor[],
  options: FilterToolsOptions = {},
): ToolDescriptor[] {
  const policies = options.policies ?? [];

  return tools.filter((tool) => {
    if (typeof tool?.name !== "string") return true;

    const decision = evaluatePolicy(
      { tool: tool.name, args: {}, identity: options.identity },
      policies,
      options.defaultAllow === true,
    );

    if (decision.action !== "deny") return true;
    // Conditional deny: the verdict may flip once real arguments arrive.
    return decision.rule?.when !== undefined;
  });
}

/** Wrap a `tools/list` handler so its response is filtered. */
export function filterToolsListResult<T extends ToolsListResult>(
  result: T,
  options: FilterToolsOptions = {},
): T {
  if (!result || !Array.isArray(result.tools)) return result;
  return { ...result, tools: filterTools(result.tools, options) };
}
