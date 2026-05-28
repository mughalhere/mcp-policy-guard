import { describe, expect, it } from "vitest";
import { matchGlob, matchAnyGlob } from "../src/policy/glob.js";

describe("matchGlob", () => {
  it("matches exact names", () => {
    expect(matchGlob("search", "search")).toBe(true);
    expect(matchGlob("search", "search_all")).toBe(false);
  });

  it("matches star prefixes/suffixes", () => {
    expect(matchGlob("search_*", "search_contacts")).toBe(true);
    expect(matchGlob("*_delete", "soft_delete")).toBe(true);
    expect(matchGlob("admin_*", "search")).toBe(false);
  });

  it("matchAnyGlob", () => {
    expect(matchAnyGlob(["a", "b_*"], "b_1")).toBe(true);
    expect(matchAnyGlob(["a"], "b")).toBe(false);
  });
});
