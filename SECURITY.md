# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.2.x | ✅ Active |
| 0.1.x | ⚠️ Security fixes only until 2027-01-31 |

Pre-1.0, fixes land on the latest minor. Upgrading from 0.1 to 0.2 is
backward compatible — see [docs/migration-v0.2.md](./docs/migration-v0.2.md).

## Reporting a vulnerability

**Do not open a public GitHub issue for a security problem.**

Report privately through either channel:

1. **GitHub private advisory** (preferred) —
   [Report a vulnerability](https://github.com/mughalhere/mcp-policy-guard/security/advisories/new)
2. **Email** — mughalhere@icloud.com, subject line starting `[mcp-policy-guard security]`

Please include:

- The version affected
- A minimal reproduction (a `createGuardedHandler` snippet is ideal — no
  transport needed)
- What an attacker gains, and what access they need to start
- Any suggested fix

**What to expect:** acknowledgement within 5 working days, an assessment within
10. If confirmed, a fix and advisory are prepared privately, released, and
credited to you unless you prefer otherwise. This is a spare-time project — if
you have not heard back in 10 days, please ping the same channel before
disclosing publicly.

Coordinated disclosure is appreciated: please allow 90 days, or until a fix
ships, whichever comes first.

## In scope

Anything that breaks a guarantee the library claims:

- **Policy bypass** — a call reaching a tool that the configured policy should
  have denied
- **Confirmation bypass** — executing a gated tool without a valid token:
  forgery, replay of a used token, reuse across tools or arguments, redemption
  by a different identity, expiry not enforced
- **Rate-limit bypass** — sustained throughput above the configured budget
- **Redaction leak** — a builtin pattern failing to match data it documents as
  covered, or redaction being skipped on a path where it is advertised
- **Audit evasion** — a call reaching a tool without a corresponding entry, or
  an attacker suppressing entries
- **Resource exhaustion** — unbounded memory or CPU from attacker-influenced
  input: catastrophic regex backtracking in a redaction pattern, unbounded
  bucket or token growth, unbounded recursion in result traversal
- **Fail-open behaviour** — any error path that results in permission rather
  than denial

## Out of scope

These are known limitations, documented in the README and
[threat model](./docs/threat-model.md), not vulnerabilities:

- **Prompt injection and jailbreaks.** This library governs tool execution, not
  model context. Pair it with input-side gating.
- **A compromised MCP host or server process.** The guard runs in-process; an
  attacker with code execution there has already won.
- **Authorization flaws in your own business API.** The guard decides whether a
  tool may run, not whether the underlying API should have honoured it.
- **PII that no configured pattern targets.** Redaction is best-effort pattern
  matching, not a classifier. Missing formats are feature requests; a builtin
  pattern failing on data it claims to match is a bug.
- **`includeArgs: true` recording sensitive arguments.** That is the documented
  purpose of the flag; combine it with `redact` and locked-down log storage.
- **`defaultAllow: true` allowing an unlisted tool.** That is what it does.
- **Tools visible in `tools/list`.** Filtering is an ergonomic feature. Every
  call is still policy-checked, so visibility alone is not a bypass.

## Hardening checklist

For a deployment handling anything sensitive:

- [ ] Leave `defaultAllow` off; enumerate what is permitted
- [ ] Gate every destructive tool with `requireConfirmation`, and prefer an
      out-of-band `approve` callback over a token the model itself carries
- [ ] Set `rateLimit`, including `perIdentity` if callers are distinguishable
- [ ] Set `timeoutMs` so one hung tool cannot pin the host
- [ ] Enable `redact` with `patterns: "strict"` and key-based rules for your own
      field names
- [ ] Keep `includeArgs` off unless the audit destination is as protected as the
      data itself
- [ ] Send audit to a file or callback — never stdout on a stdio server, where it
      would corrupt the JSON-RPC stream
- [ ] Use a shared `ConfirmationStore` (Redis or similar) if you run more than
      one server process; the in-memory store is per-process
- [ ] Treat policy configuration as code: review it, and test the denials
