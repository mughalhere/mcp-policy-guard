/**
 * The browser bundle swaps out `node:crypto`. This asserts the replacement
 * agrees with the real thing, then exercises the bundled library end to end.
 *
 * Run after `npm run build:site`. Node 22 has Web Crypto and TextEncoder as
 * globals, so the browser bundle loads here unmodified.
 */
import { createHash as nodeCreateHash } from "node:crypto";
import assert from "node:assert/strict";
import { createHash as shimCreateHash, randomBytes, timingSafeEqual } from "./shims/node-crypto.js";

const cases = [
  "",
  "a",
  "abc",
  JSON.stringify({ id: "c1" }),
  "x".repeat(55), // one byte short of a padding boundary
  "x".repeat(56), // forces a second block
  "x".repeat(64),
  "x".repeat(1000),
  "unicode: héllo 🌍 ünïcode",
];

for (const input of cases) {
  const expected = nodeCreateHash("sha256").update(input).digest("hex");
  const actual = shimCreateHash("sha256").update(input).digest("hex");
  assert.equal(actual, expected, `sha256 mismatch for input of length ${input.length}`);
}
console.log(`✓ sha256 shim matches node:crypto across ${cases.length} inputs`);

const chunked = shimCreateHash("sha256").update("abc").update("def").digest("hex");
assert.equal(chunked, nodeCreateHash("sha256").update("abcdef").digest("hex"));
console.log("✓ chunked update() matches");

assert.equal(randomBytes(24).toString("hex").length, 48);
assert.notEqual(randomBytes(24).toString("hex"), randomBytes(24).toString("hex"));
console.log("✓ randomBytes produces 24 distinct bytes as hex");

const a = new TextEncoder().encode("same");
const b = new TextEncoder().encode("same");
const c = new TextEncoder().encode("diff");
assert.equal(timingSafeEqual(a, b), true);
assert.equal(timingSafeEqual(a, c), false);
console.log("✓ timingSafeEqual agrees on equal and unequal input");

// Now the bundle itself, through the same public API the demo page uses.
const guard = await import("./dist/mcp-policy-guard.js");
const {
  createGuardedHandler,
  allow,
  deny,
  requireConfirmation,
  argStartsWith,
  hashArgs,
  GuardMetrics,
} = guard;

assert.equal(
  hashArgs({ b: 2, a: 1 }),
  nodeCreateHash("sha256").update(JSON.stringify({ a: 1, b: 2 })).digest("hex"),
  "bundled hashArgs must produce the same canonical hash as the Node build",
);
console.log("✓ bundled hashArgs matches the Node build");

const metrics = new GuardMetrics();
const audit = [];
const handler = createGuardedHandler(
  async (req) => ({ content: [{ type: "text", text: `ran ${req.params.name} for ada@example.com` }] }),
  {
    policies: [
      allow("read_file", { when: argStartsWith("path", "/workspace/") }),
      requireConfirmation("delete_*"),
      deny("admin_*"),
    ],
    rateLimit: { windowMs: 60_000, maxCalls: 50 },
    redact: { patterns: "strict" },
    audit: { sink: (entry) => audit.push(entry) },
    onDecision: (event) => metrics.record(event),
  },
);

const body = async (name, args) =>
  JSON.parse((await handler({ params: { name, arguments: args } })).content[0].text);

const ok = await handler({ params: { name: "read_file", arguments: { path: "/workspace/a" } } });
assert.equal(ok.content[0].text, "ran read_file for [REDACTED]");

assert.equal((await body("read_file", { path: "/etc/shadow" })).error, "denied");
assert.equal((await body("admin_wipe", {})).error, "denied");

const gated = await body("delete_contact", { id: "c1" });
assert.equal(gated.error, "confirmation_required");
assert.match(gated.confirmationToken, /^[0-9a-f]{48}$/);

const confirmed = await handler({
  params: { name: "delete_contact", arguments: { id: "c1", confirmationToken: gated.confirmationToken } },
});
assert.ok(!confirmed.isError, "a valid token must let the call through");

const replayed = await body("delete_contact", { id: "c1", confirmationToken: gated.confirmationToken });
assert.equal(replayed.error, "confirmation_failed");

assert.equal(audit.length, 6, `expected one audit entry per call, got ${audit.length}`);
assert.equal(metrics.snapshot().calls, 6);
console.log("✓ bundled guard: policy, conditions, redaction, confirmation, replay, audit, metrics");

console.log("\nall shim and bundle checks passed");
