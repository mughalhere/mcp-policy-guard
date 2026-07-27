import { describe, expect, it } from "vitest";
import { argStartsWith } from "../src/policy/conditions.js";
import { allow, deny } from "../src/policy/types.js";
import { filterTools, filterToolsListResult } from "../src/tools-list.js";

const tools = [
  { name: "search_files", description: "search" },
  { name: "delete_contact" },
  { name: "admin_wipe" },
];

describe("filterTools", () => {
  it("hides tools with no matching allow rule under default deny", () => {
    const visible = filterTools(tools, { policies: [allow("search_*")] });
    expect(visible.map((t) => t.name)).toEqual(["search_files"]);
  });

  it("keeps everything except explicit denies when defaultAllow is on", () => {
    const visible = filterTools(tools, { policies: [deny("admin_*")], defaultAllow: true });
    expect(visible.map((t) => t.name)).toEqual(["search_files", "delete_contact"]);
  });

  it("keeps conditionally denied tools listed, since the verdict depends on arguments", () => {
    const visible = filterTools(tools, {
      policies: [deny("search_*", { when: argStartsWith("path", "/etc") }), allow("*")],
    });
    expect(visible.map((t) => t.name)).toContain("search_files");
  });

  it("respects identity-scoped rules", () => {
    const policies = [allow("admin_*", { identities: ["ops-*"] }), allow("search_*")];
    expect(filterTools(tools, { policies, identity: "ops-jane" }).map((t) => t.name)).toEqual([
      "search_files",
      "admin_wipe",
    ]);
    expect(filterTools(tools, { policies, identity: "user-bob" }).map((t) => t.name)).toEqual([
      "search_files",
    ]);
  });

  it("passes through malformed entries rather than dropping them silently", () => {
    const visible = filterTools([{ name: 1 as unknown as string }], { policies: [] });
    expect(visible).toHaveLength(1);
  });
});

describe("filterToolsListResult", () => {
  it("preserves other response fields", () => {
    const result = filterToolsListResult(
      { tools, nextCursor: "abc" },
      { policies: [allow("search_*")] },
    );
    expect(result.nextCursor).toBe("abc");
    expect(result.tools).toHaveLength(1);
  });

  it("is a no-op on a response without a tools array", () => {
    const result = { unexpected: true } as unknown as { tools: Array<{ name: string }> };
    expect(filterToolsListResult(result, { policies: [] })).toBe(result);
  });
});
