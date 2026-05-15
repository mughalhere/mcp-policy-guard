export type PolicyKind = "allow" | "deny" | "requireConfirmation";

export type PolicyRule = {
  kind: PolicyKind;
  patterns: string[];
};

export function allow(...patterns: string[]): PolicyRule {
  return { kind: "allow", patterns };
}

export function deny(...patterns: string[]): PolicyRule {
  return { kind: "deny", patterns };
}

export function requireConfirmation(...patterns: string[]): PolicyRule {
  return { kind: "requireConfirmation", patterns };
}

export type PolicyDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "requireConfirmation"; reason: string };
