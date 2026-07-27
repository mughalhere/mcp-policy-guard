# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org) and
[Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

## [0.2.0] - 2026-07-27

Backward compatible with 0.1: every option, export, and call signature still
works. See [docs/migration-v0.2.md](./docs/migration-v0.2.md).

### Added

**Policy**
- Argument-aware rules: `allow("read_file", { when: argStartsWith("path", "/workspace/") })`
- Condition helpers `argEquals`, `argMatches`, `argStartsWith`, `argGlob`, `argPresent`, `argInRange`, `identityIs`, `metaEquals`, composed with `and` / `or` / `not`; keys accept dotted paths
- Per-rule `reason` (surfaced to the caller instead of the default message), `identities` scoping, and `caseInsensitive` matching
- `policiesFromConfig()` builds rules from serialisable JSON; unknown keys throw at load time
- `evaluatePolicy()` accepts a full `PolicyContext` as well as a bare tool name, and returns the matching rule
- Glob syntax gained `?`, `{a,b}` alternation, `!` negation, case-insensitive matching, and a bounded compiled-pattern cache

**Identity**
- `identify(request, extra)` resolves the caller; feeds policies, rate limits, audit entries, and confirmation-token binding

**Confirmation**
- `confirmation` option group: `store`, `tokenKey`, `ttlMs`, `bindIdentity`, `approve`
- `confirmation.approve` performs approval out of band, so the authorising signal never passes through the model
- Tokens are bound to the issuing identity by default and cannot be redeemed by another caller
- `revokeConfirmation()`; `ConfirmationStore` gained optional `delete()` and `sweep()`
- `InMemoryConfirmationStore` accepts `maxEntries` and evicts expired and used records

**Rate limiting**
- Per-identity buckets (`perIdentity`) and per-pattern `overrides`
- Rejections report the `scope` that rejected, the `limit`, and the window
- `maxBuckets` LRU cap so cycled tool names or identities cannot grow memory unboundedly
- `RateLimiter.reset()` and `size`

**Redaction**
- Eight new builtin patterns: `ssn`, `ipv4`, `jwt`, `awsAccessKeyId`, `apiKey`, `bearerToken`, `privateKey`, `iban`; select them all with `patterns: "strict"`
- Key-based redaction (`keys`), with `DEFAULT_SENSITIVE_KEYS` exported
- `preserveLast` keeps a match's trailing characters (card last-four)
- Applies to arguments (`arguments: true`) and audit records (`auditArgs`) as well as results
- `maxDepth` bound and `luhnValid()` exported

**Audit**
- `"stderr"` sink, plus arrays of sinks for fan-out
- `callId` correlates entries with `onDecision` events
- `outcomes` filter, `await: false` for off-path writes, and `redact` for recorded arguments
- Entries carry `identity` and the policy `reason`

**Observability and control**
- `onDecision` hook and the `GuardMetrics` counter class
- `timeoutMs` bounds how long the host waits for a tool
- `validate()` rejects malformed arguments with `invalid_arguments`, before any token is minted
- `formatError` customises rejection results; `GuardErrorCode` gives stable machine-readable codes
- `guard()` filters `tools/list` so denied tools are hidden (`filterToolList`, default on); `filterTools()` exported
- `setLogger()` routes library logs into your own pino instance

**Project**
- Detailed [CONTRIBUTING.md](./CONTRIBUTING.md), [SECURITY.md](./SECURITY.md), [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md), issue forms, and a PR template
- New guides: [API reference](./docs/api.md), [policies](./docs/policies.md), [recipes](./docs/recipes.md), [threat model](./docs/threat-model.md), [migration](./docs/migration-v0.2.md)
- New examples: `advanced-policies.mjs`, `observability.mjs`, and `mcp-server.mjs` (a real guarded stdio server)
- ESLint flat config and Prettier config added — `npm run lint` previously had no configuration to run against
- `npm run verify` runs everything CI does; CI now lints and covers Node 22 and 24
- Test suite grown from 16 to 118 cases, including a suite that runs against the real `@modelcontextprotocol/sdk`

### Changed

- **Argument hashes are order-independent.** `hashArgs()` canonicalises objects before hashing, so a client that re-serialises arguments in a different key order on a confirmation retry no longer fails the binding check. `argsHash` values in audit entries differ from 0.1.
- **`tools/list` is filtered by default.** Opt out with `filterToolList: false`.
- **A throwing audit sink no longer fails the tool call.** It is logged and swallowed; observability cannot break execution.
- **Rate-limit buckets are peeked before any is consumed**, so a call rejected by a narrow bucket no longer burns global budget.
- **Credit-card redaction is Luhn-checked** by default, leaving long order ids and identifiers readable. Disable with `luhn: false`.
- `getLogger()` with no argument leaves the level unchanged instead of forcing it to silent; pass an explicit boolean to set it.
- Rejection messages carry more context (rate-limit scope and limits, policy reasons). Branch on the `error` code, not the message text.
- `guard()` writes into the server's request-handler map when one is available, which keeps the MCP SDK's schema wiring intact.

### Fixed

- Redaction no longer recurses forever on a circular tool result, and no longer flattens `Date`s, `Buffer`s, and class instances into plain objects
- A policy condition, `identify()`, approver, or `onDecision` hook that throws can no longer produce permission — every error path denies
- `guard()` on a server with no `tools/call` handler returns a `misconfigured` error rather than leaving calls unguarded
- Invalid rate-limit configuration throws at construction instead of failing open at request time

### Deprecated

- `confirmationStore` → `confirmation.store`
- `confirmationTokenKey` → `confirmation.tokenKey`

Both continue to work; no removal is planned before 1.0.

## [0.1.2] - 2026-07-27

### Fixed
- `consumeConfirmation` now rejects expired confirmation tokens itself instead of relying entirely on the `ConfirmationStore` implementation to filter them, so custom stores that don't evict expired records can't have stale tokens replayed.
- `getLogger()` no longer locks in the first caller's `debug` flag for the life of the process — the shared logger's level now updates on every call, so a later `guard()` instance with a different `debug` setting is respected.
- Loosened the flaky redact-performance test's timing threshold, which failed intermittently on slower CI runners despite no regression in the code.

Note: `0.1.1` was tagged but never published — the CI perf test above failed on the runner before the publish step ran. Skipping straight to `0.1.2`.

## [0.1.0] - 2026-05-30

### Added
- Initial release: `guard()` / `createGuardedHandler()` middleware for MCP tool calls
- Policy helpers: `allow`, `deny`, `requireConfirmation` with glob matching
- Token-bucket rate limiting (global + per-tool)
- Two-phase confirmation tokens (5-minute TTL, pluggable store)
- JSONL audit sink (`stdout` / `file` / custom) with hashed args by default
- PII redaction on tool results (email, phone, credit card)
