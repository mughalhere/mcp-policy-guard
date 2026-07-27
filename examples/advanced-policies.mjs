/**
 * Conditional policies, identity scoping, per-tool rate limits, and validation.
 * Run: node examples/advanced-policies.mjs   (after npm run build)
 */
import {
  allow,
  and,
  argEquals,
  argStartsWith,
  createGuardedHandler,
  deny,
  not,
  requireConfirmation,
} from "../dist/index.js";

const inner = async (req) => ({
  content: [{ type: "text", text: `ran ${req.params.name} ${JSON.stringify(req.params.arguments)}` }],
});

const handler = createGuardedHandler(inner, {
  policies: [
    // Reads are fine, but only inside the workspace.
    allow("read_file", { when: argStartsWith("path", "/workspace/") }),

    // Anything that isn't a SELECT is refused outright, with a custom reason.
    deny("run_sql", {
      when: not(argStartsWith("query", "SELECT")),
      reason: "only SELECT statements are permitted through this server",
    }),
    allow("run_sql"),

    // Destructive prod writes need a human; dev writes do not.
    requireConfirmation("deploy", { when: argEquals("env", "prod") }),
    allow("deploy"),

    // Admin tooling is limited to the ops identities.
    allow("admin_*", { identities: ["ops-*"] }),

    allow("search"),

    // Everything an operator does off-hours is blocked, as an illustration of
    // composing conditions.
    deny("*", {
      when: and(argEquals("mode", "batch"), not(argEquals("dryRun", true))),
      reason: "batch mode requires dryRun",
    }),
  ],

  // Cheap calls get the default budget; the expensive report gets its own.
  rateLimit: {
    windowMs: 60_000,
    maxCalls: 60,
    perIdentity: true,
    overrides: [{ patterns: ["generate_report"], maxCalls: 2 }],
  },

  // Reject nonsense before it reaches a tool handler. Runs after policy, so it
  // only ever sees calls that were already permitted.
  validate: (ctx) =>
    ctx.tool === "search" && typeof ctx.args.q !== "string"
      ? "search requires a string `q`"
      : true,

  // Caller identity comes from wherever your transport puts it.
  identify: (_req, extra) => extra?.user,

  timeoutMs: 10_000,
});

const show = async (label, name, args, extra) => {
  const result = await handler({ params: { name, arguments: args } }, extra);
  console.log(`${label}:`, result.content[0].text);
};

await show("workspace read", "read_file", { path: "/workspace/README.md" });
await show("escape attempt", "read_file", { path: "/etc/shadow" });
await show("select", "run_sql", { query: "SELECT 1" });
await show("mutation", "run_sql", { query: "DROP TABLE users" });
await show("dev deploy", "deploy", { env: "dev" });
await show("prod deploy", "deploy", { env: "prod" });
await show("admin as ops", "admin_rotate_keys", {}, { user: "ops-jane" });
await show("admin as user", "admin_rotate_keys", {}, { user: "user-bob" });
await show("good args", "search", { q: "ada" });
await show("bad args", "search", { q: 42 });
