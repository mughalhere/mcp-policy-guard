# Migrating to v0.2

**Short version:** upgrade and change nothing. Every v0.1 option, export, and
call signature still works. Two behaviours differ; both are listed below.

```bash
npm install mcp-policy-guard@^0.2.0
```

---

## Behaviour changes

### 1. Argument hashes are now order-independent

`hashArgs` canonicalises objects — keys sorted at every depth — before hashing.

**Why:** a client that re-serialised arguments in a different key order on a
confirmation retry would fail the args-binding check, which looked like a bug in
the client rather than in us.

**Impact:** the `argsHash` written into audit entries differs from v0.1 for any
object argument with more than one key. If you correlate audit entries across
the upgrade by hash, expect a discontinuity. Nothing else depends on the value.

### 2. `tools/list` is filtered by default

`guard(server, …)` now also wraps `tools/list` and hides tools the policy would
deny, so the model does not see affordances it cannot use.

**Impact:** clients that enumerate tools will see fewer of them. Conditional
rules (`when`) do not hide anything — their verdict depends on arguments that
don't exist at list time — so those tools stay listed and are blocked at call
time.

**To restore v0.1 behaviour:**

```ts
guard(server, { policies, filterToolList: false });
```

`createGuardedHandler` is unaffected; it only ever wrapped `tools/call`.

---

## Deprecations

Both still work and are not scheduled for removal before 1.0.

| v0.1 | v0.2 |
| --- | --- |
| `confirmationStore: store` | `confirmation: { store }` |
| `confirmationTokenKey: "x"` | `confirmation: { tokenKey: "x" }` |

```ts
// Still valid
guard(server, { confirmationStore: myStore, confirmationTokenKey: "approvalId" });

// Preferred
guard(server, { confirmation: { store: myStore, tokenKey: "approvalId" } });
```

---

## Additions worth adopting

None are required. In rough order of value for an existing deployment:

### Bound your tools

```ts
timeoutMs: 15_000,
```

One hung tool no longer pins the host.

### Cap the confirmation and rate-limit stores

Defaults are already bounded (`maxBuckets: 10_000`, `maxEntries: 10_000`). Raise
or lower them to match your deployment; a multi-tenant server with many
identities usually wants a higher `maxBuckets`.

### Identity

```ts
identify: (request, extra) => extra?.authInfo?.subject,
rateLimit: { windowMs: 60_000, maxCalls: 600, perIdentity: true },
policies: [allow("admin_*", { identities: ["ops-*"] })],
```

Also binds confirmation tokens to the caller who was issued them.

### Argument conditions

Rules that were "allow this tool" can become "allow this tool for these
arguments":

```ts
allow("read_file", { when: argStartsWith("path", "/workspace/") })
```

### Real human approval

If a confirmation gate exists mainly so a human sees the action, move it out of
the model loop:

```ts
confirmation: { approve: async ({ tool, args }) => askOncall(tool, args) }
```

### Stronger redaction

```ts
redact: { patterns: "strict", keys: [...DEFAULT_SENSITIVE_KEYS] }
```

Eight patterns beyond the v0.1 three, plus key-based rules. Credit cards are now
Luhn-checked, so long order ids stay readable.

### Audit fan-out and metrics

```ts
audit: { sink: [(entry) => log.info(entry), "file"], outcomes: ["denied", "error"] },
onDecision: (event) => metrics.record(event),
```

---

## Compatibility notes

- **Node 22+** — unchanged from v0.1.
- **`evaluatePolicy(name, …)`** still accepts a bare tool name; passing a
  `PolicyContext` is new and optional.
- **`PolicyDecision`** gained optional `reason` on `allow` and an optional
  `rule` reference. Existing narrowing on `action` is unaffected.
- **`AuditEntry`** gained `callId`, and optional `reason`, `identity`, and
  extras. Existing fields are unchanged, except that `argsHash` now uses
  canonical JSON.
- **`AuditSink`** now also accepts `"stderr"` and arrays. Existing values work.
- **A throwing audit sink no longer propagates.** In v0.1 it could fail the tool
  call; now it is logged and swallowed. If you relied on that to fail closed,
  move the check into `validate` or a policy condition.
- **`getLogger()` with no argument no longer forces the level to silent.** Pass
  an explicit boolean to set it, as `guard()` does.

## If something breaks

Open a [bug report](https://github.com/mughalhere/mcp-policy-guard/issues/new?template=bug_report.yml)
with the v0.1 configuration that worked and the v0.2 behaviour you see.
Backward compatibility inside a minor is a design invariant, so a break is a bug
on our side, not a migration step you missed.
