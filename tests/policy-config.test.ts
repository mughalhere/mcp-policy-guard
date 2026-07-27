import { describe, expect, it } from "vitest";
import { policiesFromConfig } from "../src/policy/config.js";
import { evaluatePolicy } from "../src/policy/evaluate.js";

describe("policiesFromConfig", () => {
  it("builds rules from plain data", () => {
    const policies = policiesFromConfig({
      allow: ["search_*"],
      confirm: ["delete_*"],
      deny: ["admin_*"],
    });

    expect(evaluatePolicy("search_x", policies).action).toBe("allow");
    expect(evaluatePolicy("delete_x", policies).action).toBe("requireConfirmation");
    expect(evaluatePolicy("admin_x", policies).action).toBe("deny");
    expect(evaluatePolicy("other", policies).action).toBe("deny");
  });

  it("merges confirm and requireConfirmation", () => {
    const policies = policiesFromConfig({ requireConfirmation: ["delete_*"], confirm: ["drop_*"] });
    expect(evaluatePolicy("drop_table", policies).action).toBe("requireConfirmation");
    expect(evaluatePolicy("delete_row", policies).action).toBe("requireConfirmation");
  });

  it("fails loudly on a typo instead of silently widening access", () => {
    expect(() => policiesFromConfig({ allowed: ["*"] } as never)).toThrow(/unknown policy config key/);
    expect(() => policiesFromConfig({ allow: [1] } as never)).toThrow(/array of strings/);
    expect(() => policiesFromConfig(null as never)).toThrow(/must be an object/);
  });

  it("produces an empty rule list for an empty config, which denies everything", () => {
    const policies = policiesFromConfig({});
    expect(policies).toEqual([]);
    expect(evaluatePolicy("anything", policies).action).toBe("deny");
  });
});
