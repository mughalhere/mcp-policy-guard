import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/policy/evaluate.js";
import { allow, deny, requireConfirmation } from "../src/policy/types.js";

describe("evaluatePolicy", () => {
  const policies = [
    allow("search_*", "list_*"),
    requireConfirmation("delete_*", "update_*"),
    deny("admin_*"),
  ];

  it("denies admin before allow", () => {
    expect(evaluatePolicy("admin_wipe", policies).action).toBe("deny");
  });

  it("requires confirmation for delete", () => {
    expect(evaluatePolicy("delete_contact", policies).action).toBe("requireConfirmation");
  });

  it("allows search", () => {
    expect(evaluatePolicy("search_people", policies).action).toBe("allow");
  });

  it("default denies unknown", () => {
    expect(evaluatePolicy("mystery", policies).action).toBe("deny");
  });

  it("defaultAllow permits unknown", () => {
    expect(evaluatePolicy("mystery", policies, true).action).toBe("allow");
  });
});
