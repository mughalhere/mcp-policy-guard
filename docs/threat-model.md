# Threat model

What this library defends, what it explicitly does not, and the assumptions
underneath both. Read it before relying on the guard for anything that matters.

- [Position in the system](#position-in-the-system)
- [Assumptions](#assumptions)
- [Threats addressed](#threats-addressed)
- [Threats not addressed](#threats-not-addressed)
- [Design invariants](#design-invariants)
- [Known limitations](#known-limitations)
- [Residual risk checklist](#residual-risk-checklist)

---

## Position in the system

```
User → MCP Host (model) → MCP transport → [ mcp-policy-guard ] → your tools → your APIs
```

The guard is **in-process middleware on the server side**, sitting between the
transport and your tool handlers. Everything upstream — what the model decided
to call and why — is outside its view. Everything downstream — whether your API
should have honoured the request — is outside its authority.

That position determines what it can and cannot promise. It sees a tool name,
its arguments, and whatever identity you hand it. It does not see the
conversation, and it cannot distinguish a call the user wanted from an
identically-shaped call an injected instruction produced.

## Assumptions

1. **The server process is trusted.** The guard, the tools, and the policy all
   run in one process. Code execution there defeats everything below.
2. **Policy configuration is trusted and reviewed.** It is code with security
   consequences. Treat a policy change like an IAM change.
3. **`identify()` returns an authenticated identity.** The guard consumes it; it
   does not verify it. If your transport lets a caller assert its own identity,
   identity-scoped rules are advisory.
4. **Tool handlers enforce their own invariants.** The guard decides whether a
   call happens, not whether the operation is internally safe.
5. **The audit destination is at least as protected as the data it records.**
   Particularly with `includeArgs: true`.

## Threats addressed

### Over-broad tool exposure

An agent calls a tool it should never have had access to.

*Mitigation:* default deny. A tool with no matching `allow` rule does not run,
including tools added to the server after the policy was written. Argument-level
conditions narrow further — the same tool may be permitted for one path and
refused for another. `tools/list` filtering removes the affordance from the
model's view as well, though the deny rule is what stops the call.

### Unconfirmed destructive actions

An agent deletes, deploys, or refunds without a human in the loop.

*Mitigation:* `requireConfirmation` gates. A gated call returns a single-use
token bound to the tool name, an order-independent hash of the arguments, and
the issuing identity. Replays, cross-tool reuse, argument substitution after
issuance, and redemption by a different caller are all rejected. Tokens expire
(5 minutes by default).

*Caveat:* when the model itself carries the token, this is a speed bump plus an
audit record, not human oversight. For genuine oversight use
`confirmation.approve` with an out-of-band channel, so the authorising signal
never passes through the model.

### Runaway agents

A loop calls a tool thousands of times, exhausting quota, rate limits at your
API, or money.

*Mitigation:* token buckets at four scopes — global, per-tool, per-identity, and
per-pattern overrides. All applicable buckets are peeked before any is consumed,
so a call rejected by a narrow bucket does not silently drain global budget.
Rejections carry `retryAfterMs` and the scope that rejected, which a
well-behaved client can back off on.

### Data leaking through tool results

A tool returns a record containing PII or credentials, which lands in the model
context and possibly in the host's logs.

*Mitigation:* pattern-based redaction of results, with 11 builtin patterns plus
key-based rules for your own field names. Credit-card matches are Luhn-checked
so order numbers survive. Optionally applied to arguments and to audit records.

*Caveat:* this is pattern matching, not classification. It catches formats it
knows; it will not catch a name, an address, or a bespoke identifier you did not
configure.

### Missing decision trail

An incident happens and nobody can reconstruct what the agent did.

*Mitigation:* every branch — allow, deny, rate limit, confirmation issued,
confirmation failed, timeout, error — produces a JSONL audit entry with a
correlating `callId`, the tool, an argument hash, latency, and identity.
Arguments are hashed rather than recorded unless you opt in.

### Resource exhaustion in the guard itself

Middleware that grows without bound is a denial-of-service vector.

*Mitigation:* rate-limit buckets are LRU-capped (`maxBuckets`), the in-memory
confirmation store is capped (`maxEntries`) and sweeps expired records, the glob
cache is bounded, redaction traversal has a depth limit and detects cycles, and
redaction patterns avoid nested quantifiers. A performance regression test
guards against catastrophic backtracking.

### Failures that could permit rather than deny

*Mitigation:* every ambiguous state resolves to denial. A throwing policy
condition means the rule does not match. A throwing `identify()` means
anonymous, which fails identity-scoped rules. A throwing approver is a refusal.
An unmatched tool is denied. A `guard()` call on a server with no `tools/call`
handler returns `misconfigured` rather than passing calls through.

Conversely, observability failures never block execution: a throwing audit sink
or `onDecision` hook is logged and swallowed.

## Threats not addressed

### Prompt injection and jailbreaks

Content in the model's context that induces a tool call. The guard sees the
resulting call, which may be indistinguishable from a legitimate one. Policy
limits the *blast radius* — an injected instruction still cannot reach a denied
tool — but it cannot tell intent from content.

Layer input-side gating (for example
[`prompt-protection`](https://www.npmjs.com/package/prompt-protection)) via
`validate`, and keep destructive tools behind out-of-band approval.

### A compromised host or server process

If the MCP host is compromised, it can issue any call it is permitted to. If the
server process is compromised, the guard is compromised with it.

### Confused deputy in your own API

The guard decides whether `delete_contact` may run. It does not know whether the
credentials your tool uses should have been allowed to delete *that* contact.
Object-level authorization belongs in your API.

### Transport and identity spoofing

The guard consumes `identify()`'s answer. Authentication is your transport's job.

### PII the patterns do not know

See above — redaction is best-effort. A missing format is a feature request; a
builtin pattern failing on data it claims to cover is a bug.

### Covert channels through arguments

Arguments are hashed in audit by default precisely because they may carry
sensitive content. A tool that accepts free text can carry anything; the guard
does not analyse it beyond configured redaction and `validate`.

### Timing and side channels in your tools

Confirmation-token comparison is constant-time and lookups are by key, but a
tool whose runtime depends on secret data leaks through its own latency, which
the guard also records in the audit trail.

## Design invariants

Contributors are held to these; they are also what a security reviewer should
check a change against:

1. **Fail closed.** Every error path denies.
2. **Observability cannot break execution.** Sinks and hooks are wrapped.
3. **Safe by default.** New options default conservatively; permissive
   behaviour is opt-in and documented.
4. **Validity is enforced centrally.** A custom `ConfirmationStore` cannot
   weaken the gate — expiry, single-use, tool binding, argument binding, and
   identity binding are all checked in `consumeConfirmation`.
5. **Bounded memory.** Anything keyed by attacker-influenced input has an
   eviction path.
6. **No unreviewed dependencies.** `pino` is the only runtime dependency.

## Known limitations

- **`timeoutMs` bounds waiting, not work.** JavaScript cannot abort a running
  promise; the tool may keep executing after the host has been answered. Use it
  to protect the host, not to guarantee cancellation.
- **The in-memory confirmation store is per-process.** Multiple server processes
  need a shared store, and its `markUsed` must be atomic or a token can be
  replayed once under a race.
- **Rate-limit state is per-process too.** With N processes the effective global
  budget is N × `maxCalls`.
- **Argument-hash binding uses canonical JSON.** Values that do not survive
  `JSON.stringify` round-tripping (functions, `undefined` in arrays, `BigInt`)
  are not covered as you might expect.
- **`tools/list` filtering evaluates conditional rules with empty arguments**, so
  conditionally-denied tools remain listed and are blocked at call time instead.
- **Redaction rewrites strings.** If a tool result is parsed downstream, a
  redacted value may break the consumer's expectations — this is intended, but
  worth designing for.

## Residual risk checklist

Before shipping, confirm each of these has an owner:

- [ ] Who reviews policy changes, and against what?
- [ ] What happens when the approval channel is down — does the deployment fail
      closed, and is anyone paged?
- [ ] Where does the audit trail go, who can read it, and how long is it kept?
- [ ] If `includeArgs` is on, is that destination appropriate for the data?
- [ ] Are rate limits sized against your downstream API's real limits?
- [ ] Does your API enforce object-level authorization independently?
- [ ] Is there input-side protection for injection, and is it actually wired in?
- [ ] Are the denials tested, not just the permissions?
