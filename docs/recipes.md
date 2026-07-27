# Recipes

Working configurations for situations that come up repeatedly. Each one is
self-contained — copy, adjust the names, keep the safety properties.

- [Filesystem server confined to a directory](#filesystem-server-confined-to-a-directory)
- [SQL gateway restricted to reads](#sql-gateway-restricted-to-reads)
- [Human approval over Slack](#human-approval-over-slack)
- [Redis-backed confirmation store](#redis-backed-confirmation-store)
- [Per-user limits on a multi-tenant server](#per-user-limits-on-a-multi-tenant-server)
- [Audit into an existing logger](#audit-into-an-existing-logger)
- [Prometheus metrics](#prometheus-metrics)
- [Environment-driven policy](#environment-driven-policy)
- [Testing a guarded server](#testing-a-guarded-server)
- [Composing with prompt-level protection](#composing-with-prompt-level-protection)

---

## Filesystem server confined to a directory

The condition is the policy layer; `realpath` inside the tool is the actual
boundary. Use both — a prefix check does not resolve `..` or symlinks.

```ts
import { resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { guard, allow, requireConfirmation, deny } from "mcp-policy-guard";

const ROOT = resolve("/srv/workspace");

const insideRoot = (ctx) => {
  const path = ctx.args.path;
  return typeof path === "string" && resolve(ROOT, path).startsWith(`${ROOT}/`);
};

guard(server, {
  policies: [
    deny("*", { when: (ctx) => "path" in ctx.args && !insideRoot(ctx), reason: "path escapes the workspace root" }),
    allow("{read,list,search}_*"),
    requireConfirmation("{write,move,delete}_*"),
  ],
  timeoutMs: 10_000,
});

// In the tool itself — symlinks are resolved only on the real filesystem:
async function readFileTool({ path }) {
  const real = await realpath(resolve(ROOT, path));
  if (!real.startsWith(`${ROOT}/`)) throw new Error("path escapes the workspace root");
  return { content: [{ type: "text", text: await readFile(real, "utf8") }] };
}
```

## SQL gateway restricted to reads

```ts
import { guard, allow, deny, not, argMatches } from "mcp-policy-guard";

guard(server, {
  policies: [
    deny("run_sql", {
      when: not(argMatches("query", /^\s*select\b/i)),
      reason: "this endpoint accepts SELECT statements only",
    }),
    deny("run_sql", {
      when: argMatches("query", /;\s*\S/),
      reason: "multiple statements are not permitted",
    }),
    allow("run_sql"),
    allow("{list,describe}_*"),
  ],
  rateLimit: { windowMs: 60_000, maxCalls: 20, overrides: [{ patterns: ["run_sql"], maxCalls: 5 }] },
  redact: { patterns: "strict" },
  timeoutMs: 30_000,
});
```

Pattern checks are a filter, not a parser. Back them with a read-only database
role — that is what actually enforces it.

## Human approval over Slack

`approve` replaces the token round-trip, so the model never holds the thing that
authorises the action.

```ts
guard(server, {
  policies: [requireConfirmation("{delete,deploy,refund}_*")],
  identify: (_req, extra) => extra?.userId,
  confirmation: {
    approve: async ({ tool, args, identity }) => {
      const { ts, channel } = await slack.chat.postMessage({
        channel: "#oncall",
        text: `\`${identity ?? "anonymous"}\` wants to run *${tool}*\n\`\`\`${JSON.stringify(args, null, 2)}\`\`\``,
        blocks: approveDenyBlocks(),
      });
      // Resolves true/false when someone clicks; rejects on timeout.
      return waitForClick({ ts, channel, timeoutMs: 120_000 });
    },
  },
  // The tool call is blocked while a human decides — bound the total wait.
  timeoutMs: 180_000,
});
```

A rejected promise counts as a refusal, so an approval service that goes down
fails closed.

## Redis-backed confirmation store

The in-memory store is per-process. Any deployment with more than one server
process needs a shared one.

```ts
import type { ConfirmationStore, ConfirmationRecord } from "mcp-policy-guard";

class RedisConfirmationStore implements ConfirmationStore {
  constructor(private readonly redis: Redis, private readonly prefix = "mcp:confirm:") {}

  private key(token: string) {
    return `${this.prefix}${token}`;
  }

  async set(record: ConfirmationRecord): Promise<void> {
    const ttlMs = Math.max(record.expiresAt - Date.now(), 1);
    // Redis expiry is a backstop; consumeConfirmation checks expiry itself.
    await this.redis.set(this.key(record.token), JSON.stringify(record), "PX", ttlMs);
  }

  async get(token: string): Promise<ConfirmationRecord | undefined> {
    const raw = await this.redis.get(this.key(token));
    return raw ? (JSON.parse(raw) as ConfirmationRecord) : undefined;
  }

  async markUsed(token: string): Promise<void> {
    const record = await this.get(token);
    if (!record) return;
    record.used = true;
    await this.set(record);
  }

  async delete(token: string): Promise<void> {
    await this.redis.del(this.key(token));
  }
}

guard(server, {
  policies: [requireConfirmation("delete_*")],
  confirmation: { store: new RedisConfirmationStore(redis) },
});
```

`markUsed` above is read-then-write. If two processes can redeem the same token
concurrently, make it atomic — a Lua script or `SET … XX` on a `used` flag —
otherwise a race allows one replay.

## Per-user limits on a multi-tenant server

```ts
guard(server, {
  policies: [allow("{list,get,search}_*"), requireConfirmation("{create,update,delete}_*")],
  identify: (_req, extra) => extra?.authInfo?.subject,
  rateLimit: {
    windowMs: 60_000,
    maxCalls: 600,        // process-wide ceiling
    perTool: true,
    perIdentity: true,    // each caller gets their own 600/min bucket
    maxBuckets: 50_000,
    overrides: [{ patterns: ["generate_report", "export_*"], maxCalls: 3 }],
  },
  audit: { sink: (entry) => log.info({ audit: entry }), includeArgs: false },
});
```

`maxBuckets` matters here: without a cap, a caller cycling identities would grow
memory unboundedly. Buckets are evicted least-recently-used.

## Audit into an existing logger

```ts
import pino from "pino";

const log = pino({ name: "crm-mcp" });

guard(server, {
  audit: {
    sink: [
      (entry) => log.info({ audit: entry }, `${entry.tool} ${entry.outcome}`),
      (entry) => (entry.outcome === "denied" ? alerting.notify(entry) : undefined),
    ],
    outcomes: ["denied", "error", "timeout", "confirmation_required"],
    await: false,   // keep alerting latency off the tool path
  },
});
```

A throwing sink is logged and swallowed, so a broken alerting integration cannot
fail a permitted tool call.

## Prometheus metrics

```ts
import { Counter, Histogram } from "prom-client";
import { GuardMetrics } from "mcp-policy-guard";

const calls = new Counter({ name: "mcp_tool_calls_total", help: "…", labelNames: ["tool", "outcome"] });
const latency = new Histogram({ name: "mcp_tool_latency_ms", help: "…", labelNames: ["tool"] });
const metrics = new GuardMetrics();

guard(server, {
  onDecision: (event) => {
    metrics.record(event);
    calls.inc({ tool: event.tool, outcome: event.outcome });
    latency.observe({ tool: event.tool }, event.latencyMs);
  },
});

app.get("/debug/guard", (_req, res) => res.json(metrics.snapshot()));
```

## Environment-driven policy

Keep the permissive configuration impossible to ship by accident.

```ts
import { policiesFromConfig, allow, deny } from "mcp-policy-guard";

const isProd = process.env.NODE_ENV === "production";

guard(server, {
  policies: isProd
    ? policiesFromConfig(JSON.parse(await readFile("policy.prod.json", "utf8")))
    : [allow("*"), deny("admin_*")],
  defaultAllow: false,        // never true, in any environment
  audit: { sink: "file", filePath: isProd ? "/var/log/mcp/audit.jsonl" : "./audit.jsonl" },
  debug: !isProd,
});
```

`policiesFromConfig` throws on an unknown key, so a typo in the production
policy file fails at boot rather than quietly changing access.

## Testing a guarded server

`createGuardedHandler` needs no transport, which makes policy tests fast:

```ts
import { createGuardedHandler } from "mcp-policy-guard";
import { policies } from "../src/policy.js";

const call = (name: string, args = {}) =>
  createGuardedHandler(innerHandler, { policies })({ params: { name, arguments: args } });

const body = async (name: string, args = {}) =>
  JSON.parse((await call(name, args)).content[0].text);

it("refuses admin tools", async () => {
  expect((await body("admin_wipe")).error).toBe("denied");
});

it("gates deletes and honours the token", async () => {
  const { confirmationToken } = await body("delete_contact", { id: "c1" });
  const result = await call("delete_contact", { id: "c1", confirmationToken });
  expect(result.isError).toBeFalsy();
});
```

## Composing with prompt-level protection

This library does not inspect prompts. Layer the two concerns:

```ts
import { inspect } from "prompt-protection";

guard(server, {
  policies: [allow("search_*"), requireConfirmation("delete_*")],
  validate: (ctx) => {
    const text = typeof ctx.args.query === "string" ? ctx.args.query : "";
    const verdict = inspect(text);
    return verdict.safe ? true : `argument rejected: ${verdict.reason}`;
  },
});
```

`validate` runs after policy and before confirmation, so suspicious input is
rejected without minting a token.
