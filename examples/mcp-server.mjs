/**
 * A real MCP stdio server, guarded.
 *
 * This one is not part of `npm run examples` because it blocks on stdio.
 * Build first (`npm run build`), then point an MCP host at it:
 *
 *   {
 *     "mcpServers": {
 *       "guarded-crm": { "command": "node", "args": ["examples/mcp-server.mjs"] }
 *     }
 *   }
 *
 * Or drive it by hand:
 *   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node examples/mcp-server.mjs
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { allow, deny, guard, requireConfirmation } from "../dist/index.js";

const contacts = new Map([
  ["c1", { id: "c1", name: "Ada Lovelace", email: "ada@example.com" }],
  ["c2", { id: "c2", name: "Alan Turing", email: "alan@example.com" }],
]);

const server = new McpServer({ name: "guarded-crm", version: "0.2.0" });

server.registerTool("list_contacts", { description: "List all contacts" }, async () => ({
  content: [{ type: "text", text: JSON.stringify([...contacts.values()]) }],
}));

server.registerTool(
  "delete_contact",
  { description: "Delete a contact", inputSchema: { id: z.string() } },
  async ({ id }) => {
    const existed = contacts.delete(id);
    return { content: [{ type: "text", text: JSON.stringify({ deleted: existed ? id : null }) }] };
  },
);

server.registerTool("admin_purge", { description: "Delete everything" }, async () => {
  contacts.clear();
  return { content: [{ type: "text", text: "purged" }] };
});

// Register tools first, then guard. The wrapper covers every tool the server
// routes through tools/call, including ones registered afterwards.
guard(server, {
  policies: [
    allow("list_*"),
    requireConfirmation("delete_*"),
    deny("admin_*", { reason: "admin tooling is not exposed over MCP" }),
  ],
  rateLimit: { windowMs: 60_000, maxCalls: 30 },
  redact: { patterns: ["email"] },
  // stdout carries the JSON-RPC stream, so audit goes to a file, never stdout.
  audit: { sink: "file", filePath: "./tmp/mcp-audit.jsonl" },
  timeoutMs: 15_000,
});

await server.connect(new StdioServerTransport());
