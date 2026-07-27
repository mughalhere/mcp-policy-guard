import { describe, expect, it } from "vitest";
import { clearGlobCache, globToRegExp, matchAnyGlob, matchGlob } from "../src/policy/glob.js";

describe("glob syntax", () => {
  it("supports ? for a single character", () => {
    expect(matchGlob("tool_?", "tool_a")).toBe(true);
    expect(matchGlob("tool_?", "tool_ab")).toBe(false);
  });

  it("supports {a,b} alternation", () => {
    expect(matchGlob("{get,list}_users", "get_users")).toBe(true);
    expect(matchGlob("{get,list}_users", "list_users")).toBe(true);
    expect(matchGlob("{get,list}_users", "delete_users")).toBe(false);
  });

  it("treats a literal comma outside braces literally", () => {
    expect(matchGlob("a,b", "a,b")).toBe(true);
    expect(matchGlob("a,b", "a")).toBe(false);
  });

  it("escapes regex metacharacters in patterns", () => {
    expect(matchGlob("a.b", "a.b")).toBe(true);
    expect(matchGlob("a.b", "axb")).toBe(false);
    expect(matchGlob("a+b", "a+b")).toBe(true);
    expect(matchGlob("get-user", "get-user")).toBe(true);
  });

  it("does not blow up on an unbalanced brace", () => {
    expect(() => matchGlob("{a,b", "a")).not.toThrow();
  });

  it("supports case-insensitive matching", () => {
    expect(matchGlob("Search_*", "search_files")).toBe(false);
    expect(matchGlob("Search_*", "search_files", { caseInsensitive: true })).toBe(true);
  });
});

describe("negation", () => {
  it("inverts a single pattern", () => {
    expect(matchGlob("!admin_*", "search")).toBe(true);
    expect(matchGlob("!admin_*", "admin_wipe")).toBe(false);
  });

  it("vetoes the whole list", () => {
    expect(matchAnyGlob(["*", "!admin_*"], "search")).toBe(true);
    expect(matchAnyGlob(["*", "!admin_*"], "admin_wipe")).toBe(false);
  });

  it("matches anything not vetoed when only negations are given", () => {
    expect(matchAnyGlob(["!admin_*"], "search")).toBe(true);
    expect(matchAnyGlob(["!admin_*"], "admin_wipe")).toBe(false);
  });

  it("an empty pattern list matches nothing", () => {
    expect(matchAnyGlob([], "anything")).toBe(false);
  });
});

describe("pattern cache", () => {
  it("returns the same compiled RegExp for a repeated pattern", () => {
    clearGlobCache();
    expect(globToRegExp("search_*")).toBe(globToRegExp("search_*"));
    expect(globToRegExp("search_*")).not.toBe(globToRegExp("search_*", { caseInsensitive: true }));
  });
});
