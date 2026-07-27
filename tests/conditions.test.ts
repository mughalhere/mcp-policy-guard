import { describe, expect, it } from "vitest";
import {
  and,
  argEquals,
  argGlob,
  argInRange,
  argMatches,
  argPresent,
  argStartsWith,
  identityIs,
  metaEquals,
  not,
  or,
} from "../src/policy/conditions.js";
import { evaluatePolicy } from "../src/policy/evaluate.js";
import { allow, deny } from "../src/policy/types.js";
import type { PolicyContext } from "../src/policy/types.js";

function ctx(partial: Partial<PolicyContext> = {}): PolicyContext {
  return { tool: "write_file", args: {}, ...partial };
}

describe("argument conditions", () => {
  it("argEquals matches any listed value", () => {
    const condition = argEquals("mode", "read", "list");
    expect(condition(ctx({ args: { mode: "read" } }))).toBe(true);
    expect(condition(ctx({ args: { mode: "write" } }))).toBe(false);
  });

  it("reads dotted paths into nested arguments", () => {
    const condition = argEquals("target.env", "prod");
    expect(condition(ctx({ args: { target: { env: "prod" } } }))).toBe(true);
    expect(condition(ctx({ args: { target: { env: "dev" } } }))).toBe(false);
    expect(condition(ctx({ args: {} }))).toBe(false);
  });

  it("argMatches ignores a caller-supplied /g lastIndex", () => {
    const condition = argMatches("path", /tmp/g);
    const context = ctx({ args: { path: "/tmp/a" } });
    expect(condition(context)).toBe(true);
    // A shared /g regex would advance lastIndex and miss on the second call.
    expect(condition(context)).toBe(true);
  });

  it("argStartsWith, argGlob, argPresent, argInRange", () => {
    expect(argStartsWith("path", "/workspace/")(ctx({ args: { path: "/workspace/x" } }))).toBe(true);
    expect(argStartsWith("path", "/workspace/")(ctx({ args: { path: "/etc/passwd" } }))).toBe(false);
    expect(argGlob("path", "/workspace/**", "/tmp/*")(ctx({ args: { path: "/tmp/x" } }))).toBe(true);
    expect(argPresent("q")(ctx({ args: { q: "" } }))).toBe(false);
    expect(argPresent("q")(ctx({ args: { q: "hi" } }))).toBe(true);
    expect(argInRange("limit", 1, 100)(ctx({ args: { limit: 50 } }))).toBe(true);
    expect(argInRange("limit", 1, 100)(ctx({ args: { limit: 5000 } }))).toBe(false);
    expect(argInRange("limit", 1, 100)(ctx({ args: { limit: "50" } }))).toBe(false);
  });

  it("identityIs and metaEquals", () => {
    expect(identityIs("svc-*")(ctx({ identity: "svc-billing" }))).toBe(true);
    expect(identityIs("svc-*")(ctx({ identity: "user-1" }))).toBe(false);
    expect(identityIs("svc-*")(ctx())).toBe(false);
    expect(metaEquals("channel", "cli")(ctx({ meta: { channel: "cli" } }))).toBe(true);
    expect(metaEquals("channel", "cli")(ctx())).toBe(false);
  });

  it("composes with and/or/not", () => {
    const condition = and(argEquals("env", "dev"), not(argPresent("force")));
    expect(condition(ctx({ args: { env: "dev" } }))).toBe(true);
    expect(condition(ctx({ args: { env: "dev", force: true } }))).toBe(false);
    expect(or(argEquals("env", "dev"), argEquals("env", "staging"))(ctx({ args: { env: "staging" } }))).toBe(true);
  });
});

describe("conditional policy rules", () => {
  const policies = [
    allow("read_file", { when: argStartsWith("path", "/workspace/") }),
    deny("run_sql", { when: not(argMatches("query", /^\s*select /i)), reason: "read-only SQL only" }),
    allow("run_sql"),
  ];

  it("allows only when the condition holds", () => {
    expect(evaluatePolicy({ tool: "read_file", args: { path: "/workspace/a" } }, policies).action).toBe("allow");
    expect(evaluatePolicy({ tool: "read_file", args: { path: "/etc/shadow" } }, policies).action).toBe("deny");
  });

  it("falls through to a broader allow when a conditional deny misses", () => {
    expect(evaluatePolicy({ tool: "run_sql", args: { query: "select 1" } }, policies).action).toBe("allow");
    const blocked = evaluatePolicy({ tool: "run_sql", args: { query: "drop table t" } }, policies);
    expect(blocked.action).toBe("deny");
    expect(blocked.reason).toBe("read-only SQL only");
  });

  it("treats a throwing condition as non-matching rather than as permission", () => {
    const throwing = [
      allow("*", {
        when: () => {
          throw new Error("boom");
        },
      }),
    ];
    expect(evaluatePolicy({ tool: "anything", args: {} }, throwing).action).toBe("deny");
  });

  it("scopes rules to identities", () => {
    const scoped = [allow("admin_*", { identities: ["ops-*"] })];
    expect(evaluatePolicy({ tool: "admin_wipe", args: {}, identity: "ops-jane" }, scoped).action).toBe("allow");
    expect(evaluatePolicy({ tool: "admin_wipe", args: {}, identity: "user-bob" }, scoped).action).toBe("deny");
    expect(evaluatePolicy({ tool: "admin_wipe", args: {} }, scoped).action).toBe("deny");
  });
});
