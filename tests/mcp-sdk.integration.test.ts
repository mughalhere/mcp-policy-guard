import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { guard } from "../src/guard.js";
import { allow, deny, requireConfirmation } from "../src/policy/types.js";
import type { ToolCallResult } from "../src/types.js";

/**
 * Exercises guard() against the real MCP SDK rather than a hand-rolled double,
 * so a change to how the SDK stores its request handlers fails here loudly.
 */
function buildServer() {
  const server = new McpServer({ name: "test-crm", version: "1.0.0" });

  server.registerTool(
    "search_contacts",
    { description: "search", inputSchema: { q: z.string() } },
    async ({ q }) => ({ content: [{ type: "text", text: `found ${q} at ada@example.com` }] }),
  );
  server.registerTool(
    "delete_contact",
    { description: "delete", inputSchema: { id: z.string() } },
    async ({ id }) => ({ content: [{ type: "text", text: `deleted ${id}` }] }),
  );
  server.registerTool("admin_wipe", { description: "wipe" }, async () => ({
    content: [{ type: "text", text: "wiped" }],
  }));

  return server;
}

type Handlers = Map<string, (request: unknown, extra?: unknown) => Promise<unknown>>;

function handlersOf(server: McpServer): Handlers {
  return (server.server as unknown as { _requestHandlers: Handlers })._requestHandlers;
}

async function call(server: McpServer, name: string, args: Record<string, unknown>) {
  const handler = handlersOf(server).get("tools/call")!;
  return (await handler({ method: "tools/call", params: { name, arguments: args } }, {})) as ToolCallResult;
}

function parse(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("guard() against @modelcontextprotocol/sdk", () => {
  it("wraps tools/call without disturbing the SDK's own plumbing", async () => {
    const server = buildServer();
    guard(server, {
      policies: [allow("search_*"), requireConfirmation("delete_*"), deny("admin_*")],
      redact: { patterns: ["email"] },
    });

    const allowed = await call(server, "search_contacts", { q: "ada" });
    expect(allowed.isError).toBeFalsy();
    expect(allowed.content[0]?.text).toBe("found ada at [REDACTED]");

    const denied = await call(server, "admin_wipe", {});
    expect(parse(denied).error).toBe("denied");
  });

  it("carries a confirmation round-trip end to end", async () => {
    const server = buildServer();
    guard(server, { policies: [requireConfirmation("delete_*")] });

    const first = await call(server, "delete_contact", { id: "c1" });
    const token = parse(first).confirmationToken as string;
    expect(token).toBeTruthy();

    const second = await call(server, "delete_contact", { id: "c1", confirmationToken: token });
    expect(second.isError).toBeFalsy();
    expect(second.content[0]?.text).toBe("deleted c1");
  });

  it("hides denied tools from tools/list", async () => {
    const server = buildServer();
    guard(server, { policies: [allow("search_*"), requireConfirmation("delete_*")] });

    const list = handlersOf(server).get("tools/list")!;
    const result = (await list({ method: "tools/list", params: {} }, {})) as {
      tools: Array<{ name: string }>;
    };
    expect(result.tools.map((t) => t.name).sort()).toEqual(["delete_contact", "search_contacts"]);
  });

  it("leaves tools/list alone when filtering is disabled", async () => {
    const server = buildServer();
    guard(server, { policies: [allow("search_*")], filterToolList: false });

    const list = handlersOf(server).get("tools/list")!;
    const result = (await list({ method: "tools/list", params: {} }, {})) as {
      tools: Array<{ name: string }>;
    };
    expect(result.tools).toHaveLength(3);
  });

  it("still guards tools registered after guard() was called", async () => {
    const server = buildServer();
    guard(server, { policies: [allow("search_*")] });

    server.registerTool("late_tool", { description: "late" }, async () => ({
      content: [{ type: "text", text: "late" }],
    }));

    // The SDK routes every tool through the one tools/call handler, so a tool
    // added later is covered by the wrapper installed earlier.
    const result = await call(server, "late_tool", {});
    expect(parse(result).error).toBe("denied");
  });
});
