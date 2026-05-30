/**
 * Example: wrap a fake tools/call handler with mcp-policy-guard.
 * Run: node examples/basic-wrap.mjs  (after npm run build)
 */
import {
  createGuardedHandler,
  allow,
  deny,
  requireConfirmation,
} from "../dist/index.js";

const inner = async (req) => ({
  content: [{ type: "text", text: `ran ${req.params.name}` }],
});

const handler = createGuardedHandler(inner, {
  policies: [allow("search_*"), deny("admin_*"), requireConfirmation("delete_*")],
  audit: { sink: "stdout" },
});

const ok = await handler({ params: { name: "search_files", arguments: { q: "readme" } } });
console.log("allow:", ok);

const no = await handler({ params: { name: "admin_shutdown", arguments: {} } });
console.log("deny:", no);
