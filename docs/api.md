# API reference

Every export of `mcp-policy-guard`, with defaults.

- [Entry points](#entry-points)
- [GuardOptions](#guardoptions)
- [Policy](#policy)
- [Conditions](#conditions)
- [Glob](#glob)
- [Rate limiting](#rate-limiting)
- [Confirmation](#confirmation)
- [Redaction](#redaction)
- [Audit](#audit)
- [Metrics](#metrics)
- [Errors](#errors)
- [Tool list filtering](#tool-list-filtering)
- [Logging](#logging)

---

## Entry points

### `guard(server, options?)`

Wraps an MCP `Server` or `McpServer` in place and returns it. Writes directly
into the server's request-handler map, so the SDK's schema wiring stays intact.
Also wraps `tools/list` unless `filterToolList` is `false`.

Register tools **before** calling `guard()`. Tools registered afterwards are
still covered — the SDK routes them all through the one `tools/call` handler.

Throws if the object exposes neither a request-handler map nor
`setRequestHandler`. If no `tools/call` handler is installed, calls return a
`misconfigured` error rather than passing through unchecked.

### `createGuardedHandler(inner, options?)`

Wraps a `tools/call` handler function and returns a new one. Same options, no
server required — the preferred form for tests, custom transports, and
composition.

```ts
type ToolCallHandler = (request: ToolCallRequest, extra?: unknown) => Promise<ToolCallResult>;
```

---

## GuardOptions

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `policies` | `PolicyRule[]` | `[]` | Rules; see [Policy](#policy) |
| `defaultAllow` | `boolean` | `false` | Allow tools matching no rule |
| `rateLimit` | `RateLimitConfig` | — | See [Rate limiting](#rate-limiting) |
| `audit` | `AuditConfig` | — | See [Audit](#audit) |
| `redact` | `RedactConfig` | — | See [Redaction](#redaction) |
| `confirmation` | `ConfirmationOptions` | — | See [Confirmation](#confirmation) |
| `identify` | `IdentifyFn` | — | Resolve the caller identity |
| `validate` | `ValidateFn` | — | Extra argument validation |
| `timeoutMs` | `number` | — | Bound how long a tool may take |
| `filterToolList` | `boolean` | `true` | Hide denied tools from `tools/list` (`guard()` only) |
| `onDecision` | `(event: GuardEvent) => void \| Promise<void>` | — | Per-call outcome hook |
| `formatError` | `(error: GuardError) => ToolCallResult` | `formatGuardError` | Customise rejection results |
| `debug` | `boolean` | `false` | Raise the shared logger to `debug` |
| `confirmationStore` | `ConfirmationStore` | — | **Deprecated** — use `confirmation.store` |
| `confirmationTokenKey` | `string` | `"confirmationToken"` | **Deprecated** — use `confirmation.tokenKey` |

### Order of operations

```
identify → rate limit → policy → validate → confirmation → tool → redact → audit + onDecision
```

Rate limiting runs first so a spamming caller is cheap to reject. Audit fires on
every branch, including ones that never reach a tool.

### `IdentifyFn`

```ts
(request: ToolCallRequest, extra?: unknown) => string | undefined | Promise<string | undefined>
```

Feeds identity-scoped policies, `perIdentity` rate limits, audit entries, and
confirmation-token binding. Throwing is logged and treated as anonymous.

### `ValidateFn`

```ts
(context: PolicyContext) => true | string | Promise<true | string>
```

Runs after policy, before confirmation — invalid arguments never mint a token.
Return `true` to accept; any string rejects with `invalid_arguments` and that
string as the message. Throwing is equivalent to returning the error message.

### `GuardEvent`

Passed to `onDecision` once per call.

```ts
{
  callId: string;          // matches the audit entry's callId
  tool: string;
  args: Record<string, unknown>;
  identity?: string;
  decision: string;        // allow | deny | requireConfirmation | rate_limited | confirmation_failed | invalid_arguments
  outcome: AuditOutcome;   // success | error | denied | confirmation_required | timeout
  reason?: string;
  latencyMs: number;
  error?: string;
  rateLimitScope?: RateLimitScope;
}
```

Errors thrown by the hook are logged and swallowed.

---

## Policy

### `allow(...patterns, options?)` · `deny(...)` · `requireConfirmation(...)`

Build a `PolicyRule`. Patterns are [globs](#glob); an optional trailing options
object refines the rule.

```ts
allow("search_*", "list_*")
deny("admin_*", { reason: "not exposed over MCP" })
allow("read_file", { when: argStartsWith("path", "/workspace/") })
allow("admin_*", { identities: ["ops-*"] })
allow("Search_*", { caseInsensitive: true })
```

| Rule option | Type | Description |
| --- | --- | --- |
| `when` | `PolicyCondition` | Predicate over the call; false means the rule doesn't match |
| `reason` | `string` | Message returned to the caller instead of the default |
| `identities` | `string[]` | Restrict to matching identities (globs) |
| `caseInsensitive` | `boolean` | Match tool names case-insensitively |

### `evaluatePolicy(toolOrContext, policies, defaultAllow?)`

Resolve a call without running it. Accepts a bare tool name or a full
`PolicyContext`. Precedence is fixed: `deny` → `requireConfirmation` → `allow` →
default. Within a kind, the first matching rule wins.

Returns `{ action, reason?, rule? }`.

### `policiesFromConfig(config)`

Build rules from serialisable data. Accepts `allow`, `deny`,
`requireConfirmation`, and `confirm` (an alias). Throws on unknown keys or
non-string patterns, so a typo fails at boot rather than silently changing
access.

### `PolicyContext`

```ts
{ tool: string; args: Record<string, unknown>; identity?: string; meta?: Record<string, unknown> }
```

`args` has the confirmation-token key already removed. `meta` is `params._meta`
from the MCP request.

---

## Conditions

Composable predicates for `when`. Any `(ctx: PolicyContext) => boolean` works;
these are conveniences.

| Function | True when |
| --- | --- |
| `argEquals(key, ...values)` | The argument strictly equals any listed value |
| `argMatches(key, regex)` | The argument is a string matching the regex |
| `argStartsWith(key, prefix)` | The argument is a string with that prefix |
| `argGlob(key, ...patterns)` | The argument is a string matching any glob |
| `argPresent(key)` | The argument is not `undefined`, `null`, or `""` |
| `argInRange(key, min, max)` | The argument is a finite number in `[min, max]` |
| `identityIs(...patterns)` | The caller identity matches any glob |
| `metaEquals(key, ...values)` | `params._meta[key]` equals any listed value |
| `and(...)` / `or(...)` / `not(...)` | Boolean composition |

Keys accept dotted paths for nested arguments: `argEquals("target.env", "prod")`.

`argMatches` recompiles the regex per call and strips the `g` flag, so a
caller-supplied global pattern cannot carry `lastIndex` between evaluations.

A condition that throws is treated as **not matching**. For an `allow` rule that
means the call falls through to default deny.

---

## Glob

| Syntax | Meaning |
| --- | --- |
| `*` | Any run of characters, including none |
| `?` | Exactly one character |
| `{a,b}` | Alternation |
| `!x` | Negation — a veto inside a pattern list |

Patterns are anchored. Everything else matches literally, including regex
metacharacters.

- `matchGlob(pattern, value, options?)` — one pattern; a leading `!` inverts
- `matchAnyGlob(patterns, value, options?)` — a matching negated pattern vetoes
  the whole list. A list of only negations matches anything not vetoed. An empty
  list matches nothing.
- `globToRegExp(pattern, options?)` — the compiled, memoised RegExp
- `clearGlobCache()` — drop the cache (tests, long-lived hosts)

`options.caseInsensitive` defaults to `false`.

---

## Rate limiting

### `RateLimitConfig`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `windowMs` | `number` | — | Refill window; must be > 0 |
| `maxCalls` | `number` | — | Bucket capacity; must be > 0 |
| `perTool` | `boolean` | `true` | Keep a bucket per tool name |
| `perIdentity` | `boolean` | `false` | Keep a bucket per identity; needs `identify` |
| `overrides` | `RateLimitOverride[]` | — | `{ patterns, maxCalls, windowMs? }`; first match wins and replaces the per-tool bucket |
| `maxBuckets` | `number` | `10_000` | LRU cap across tracked buckets |

Invalid configuration throws `RangeError` at construction rather than failing
open at request time.

### `RateLimiter`

`check(toolName, identity?)` returns `{ ok: true }` or
`{ ok: false, retryAfterMs, scope, limit, windowMs }` where `scope` is
`"global" | "tool" | "identity" | "override"`.

Every applicable bucket is peeked before any is consumed, so a call rejected by
a narrow bucket does not burn global budget. Also exposes `reset()` and `size`.

### `TokenBucket`

`take()`, `canTake()`, `consume()`, `retryAfterMs()`, `available`.

---

## Confirmation

### `ConfirmationOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `store` | `ConfirmationStore` | in-memory | Where tokens live |
| `tokenKey` | `string` | `"confirmationToken"` | Argument carrying the token on retry |
| `ttlMs` | `number` | `300_000` | Token lifetime |
| `bindIdentity` | `boolean` | `true` | Only the issuing identity may redeem |
| `approve` | `(req: ApprovalRequest) => boolean \| Promise<boolean>` | — | Out-of-band approval instead of a token round-trip |

When `approve` is set, no token is issued. Returning `false` or throwing denies
the call.

### The token flow

1. First call returns `confirmation_required`, a `confirmationToken`, an
   `expiresAt`, and a `hint` naming the argument to set.
2. The client retries with `arguments[tokenKey]` set to the token.
3. The guard checks: exists, not expired, not used, same tool, same argument
   hash, same identity. Then it burns the token.

The token key is stripped before the tool sees the arguments.

### `ConfirmationStore`

```ts
interface ConfirmationStore {
  set(record: ConfirmationRecord): Promise<void>;
  get(token: string): Promise<ConfirmationRecord | undefined>;
  markUsed(token: string): Promise<void>;
  delete?(token: string): Promise<void>;
  sweep?(): Promise<number>;
}
```

Every validity check is enforced in `consumeConfirmation`, not delegated to the
store — a custom store that forgets to filter expired or used records cannot
weaken the gate.

`InMemoryConfirmationStore` accepts `{ maxEntries }` (default `10_000`) and
evicts expired and used records before falling back to dropping the oldest.

### Functions

- `issueConfirmation(store, tool, args, { ttlMs?, identity? })`
- `consumeConfirmation(store, token, tool, args, { identity? })`
- `revokeConfirmation(store, token)`
- `createConfirmationToken()` — 24 CSPRNG bytes, hex encoded
- `hashArgs(args)` — SHA-256 over canonical JSON with keys sorted at every
  depth, so argument order does not affect the hash
- `CONFIRMATION_TTL_MS` — 5 minutes

---

## Redaction

### `RedactConfig`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `patterns` | `"default" \| "strict" \| string[]` | `"default"` | `"default"` is email/phone/creditCard; `"strict"` is every builtin |
| `custom` | `RegExp[]` | `[]` | Extra patterns; a missing `g` flag is added |
| `keys` | `string[]` | — | Key globs whose values are replaced wholesale, case-insensitively |
| `replacement` | `string` | `"[REDACTED]"` | Substituted text |
| `preserveLast` | `number` | `0` | Keep the last N characters of each match |
| `luhn` | `boolean` | `true` | Luhn-check credit-card matches before redacting |
| `results` | `boolean` | `true` | Redact tool results |
| `arguments` | `boolean` | `false` | Redact arguments before the tool sees them |
| `auditArgs` | `boolean` | `true` | Redact arguments recorded by the audit sink |
| `maxDepth` | `number` | `32` | Deeper values pass through untouched |

### Builtin patterns

`email`, `phone`, `creditCard`, `ssn`, `ipv4`, `jwt`, `awsAccessKeyId`,
`apiKey`, `bearerToken`, `privateKey`, `iban`.

`BUILTIN_PATTERNS` is a mutable record — add your own before constructing the
guard. `DEFAULT_PATTERNS`, `STRICT_PATTERNS`, and `DEFAULT_SENSITIVE_KEYS` are
exported for composing configurations.

### Functions

- `redactString(input, config?)`
- `redactResult(value, config?)` — deep traversal
- `redactArgs(value, config?)` — same, named for intent
- `luhnValid(digits)`

Traversal detail: cycles become `"[CIRCULAR]"`; `Date`s, `Buffer`s, `Map`s, and
class instances pass through unchanged rather than being flattened into plain
objects.

---

## Audit

### `AuditConfig`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `sink` | `"stdout" \| "stderr" \| "file" \| fn \| Array<…>` | — | Destination(s); an array fans out |
| `includeArgs` | `boolean` | `false` | Record raw arguments alongside the hash |
| `redact` | `RedactConfig` | inherits `options.redact` | Applied to recorded arguments |
| `filePath` | `string` | `mcp-policy-guard-audit.jsonl` | For the `"file"` sink |
| `outcomes` | `AuditOutcome[]` | all | Only record these outcomes |
| `await` | `boolean` | `true` | `false` keeps writes off the critical path |

On a stdio MCP server, **never** use `"stdout"` — it shares the JSON-RPC stream.

### `AuditEntry`

```ts
{
  ts: string;          // ISO-8601
  callId: string;      // correlates with GuardEvent.callId
  tool: string;
  argsHash: string;    // SHA-256 of canonical argument JSON
  args?: unknown;      // only with includeArgs
  decision: string;
  reason?: string;
  identity?: string;
  latencyMs: number;
  outcome: "success" | "error" | "denied" | "confirmation_required" | "timeout";
  error?: string;
}
```

A sink that throws is logged at `warn` and swallowed. With an array of sinks,
one failure does not stop the others.

`writeAudit(config, input)` and `nextCallId()` are exported for building your
own pipelines.

---

## Metrics

### `GuardMetrics`

```ts
const metrics = new GuardMetrics();
guard(server, { onDecision: (event) => metrics.record(event) });
metrics.snapshot();
metrics.reset();
```

`snapshot()` returns `calls`, `allowed`, `denied`, `rateLimited`,
`confirmationsRequired`, `confirmationsFailed`, `errors`, `timeouts`,
`avgLatencyMs`, and `byTool` (`{ calls, allowed, blocked, errors }` per tool).
Snapshots are copies — mutating one does not affect the counters.

Dependency-free by design; export it wherever you like.

---

## Errors

Rejections are returned as `isError: true` results with a JSON body in
`content[0].text`:

```json
{ "error": "rate_limited", "message": "…", "retryAfterMs": 1200, "scope": "tool" }
```

`GuardErrorCode` values: `denied`, `rate_limited`, `confirmation_required`,
`confirmation_failed`, `timeout`, `invalid_arguments`, `misconfigured`.

Branch on `error`, not on `message` — messages may be reworded in a minor
release. Override serialisation with `formatError`; build results with the
exported `formatGuardError`.

---

## Tool list filtering

- `filterTools(tools, { policies?, defaultAllow?, identity? })`
- `filterToolsListResult(result, options)` — preserves other response fields

A tool is hidden when policy denies it with no `when` condition. Conditionally
denied tools stay listed, since the verdict depends on arguments that do not
exist yet, and are blocked at call time.

Filtering is ergonomics, not a security boundary — every call is policy-checked
regardless of what was listed.

---

## Logging

The shared `pino` logger is **silent** by default: an MCP stdio server shares
stdout with the JSON-RPC stream, so unsolicited output can corrupt the transport.

- `getLogger(debug?)` — passing a boolean sets the level; no argument leaves it
- `setLogger(custom)` — route library logs into your own pino instance
- `resetLogger()`

`debug: true` on `GuardOptions` raises the level for the whole process.
