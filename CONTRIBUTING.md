# Contributing to mcp-policy-guard

Thanks for taking the time. This is a small, security-adjacent library, so the
bar is less "move fast" and more "every change is understandable and covered by
a test". Everything you need to clear that bar is below.

**Table of contents**

- [Ways to contribute](#ways-to-contribute)
- [Reporting a bug](#reporting-a-bug)
- [Reporting a security vulnerability](#reporting-a-security-vulnerability)
- [Requesting a feature](#requesting-a-feature)
- [Asking a question](#asking-a-question)
- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Code style](#code-style)
- [Design principles](#design-principles)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Documentation changes](#documentation-changes)
- [Releasing](#releasing)
- [Code of conduct](#code-of-conduct)

---

## Ways to contribute

Useful contributions are not only code:

- **Bug reports** with a reproduction — the most valuable thing you can send
- **Threat-model gaps** — "this policy configuration looks safe but isn't"
- **Redaction patterns** that miss real-world PII formats
- **Recipes** for wiring the guard into a real server (see `docs/recipes.md`)
- **Docs fixes** — if something read wrong to you, it reads wrong to others
- **Adapters** — `ConfirmationStore` implementations for Redis, Postgres, etc.

## Reporting a bug

Open a [bug report](https://github.com/mughalhere/mcp-policy-guard/issues/new?template=bug_report.yml).
The template asks for the following; issues missing the first three usually
stall waiting for a reply.

1. **Version** of `mcp-policy-guard`, Node.js, and `@modelcontextprotocol/sdk`.
2. **Minimal reproduction.** Ideally a `createGuardedHandler` snippet — it needs
   no MCP transport and runs in a single file:

   ```ts
   import { createGuardedHandler, allow } from "mcp-policy-guard";

   const handler = createGuardedHandler(async () => ({ content: [{ type: "text", text: "ok" }] }), {
     policies: [allow("search_*")],
   });

   console.log(await handler({ params: { name: "search_x", arguments: {} } }));
   ```

3. **Expected vs actual.** Paste the actual result object, not a description of
   it. Guard rejections are JSON inside `content[0].text` — include the whole
   thing.
4. **Guard options** you passed, with secrets removed.
5. **Audit output** if you have it — run with `debug: true` and
   `audit: { sink: "stderr" }` to get the decision trail.

Two things that are usually *not* bugs, and are worth checking first:

- **"My tool is denied and I didn't deny it."** The default is deny. A tool with
  no matching `allow` rule does not run. Add an `allow` pattern or set
  `defaultAllow: true`.
- **"My `allow` rule is ignored."** `deny` and `requireConfirmation` are
  evaluated first regardless of declaration order. Check for a broader `deny`
  pattern earlier in your list.

## Reporting a security vulnerability

**Do not open a public issue.** A policy-bypass, token-forgery, or
redaction-leak report goes through the private channel described in
[SECURITY.md](./SECURITY.md).

If you are unsure whether something counts, treat it as security and report it
privately — we would rather triage a non-issue than read about a real one on a
public tracker.

## Requesting a feature

Open a [feature request](https://github.com/mughalhere/mcp-policy-guard/issues/new?template=feature_request.yml)
describing the situation you are in, not only the API you want. "I need to allow
`read_file` but only under one directory" leads to a better answer than "add a
`pathPrefix` option".

Helpful to include:

- What you tried with the current API and where it fell short
- Whether it belongs in this library or in your own `when` condition / custom
  sink / custom store (extension points exist precisely so the core stays small)
- Whether you are willing to send the PR

Features likely to be accepted: new redaction patterns, new `ConfirmationStore`
implementations, new policy conditions, sink integrations, ergonomics that
reduce foot-guns.

Features likely to be declined: anything requiring a new runtime dependency,
prompt-level filtering (out of scope — see the README), and anything that makes
the default configuration more permissive.

## Asking a question

Use [Discussions](https://github.com/mughalhere/mcp-policy-guard/discussions) or
the question issue template. "How do I express policy X" questions are welcome —
they usually reveal a documentation gap, and the answer often becomes a recipe.

## Development setup

Requires Node.js 22+ (the package targets `node22` and CI runs 22 and 24).

```bash
git clone https://github.com/mughalhere/mcp-policy-guard.git
cd mcp-policy-guard
npm install

npm run verify        # lint + typecheck + test + build — run this before pushing
```

Individual scripts:

| Script | What it does |
| --- | --- |
| `npm test` | Run the suite once |
| `npm run test:watch` | Watch mode while developing |
| `npm run test:coverage` | Coverage report (v8) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `lint:fix` | ESLint (flat config) |
| `npm run format` / `format:check` | Prettier |
| `npm run build` | tsup → ESM + CJS + `.d.ts` |
| `npm run examples` | Build, then run every runnable example |
| `npm run verify` | Everything CI runs |

## Project layout

```
src/
  guard.ts              wrapper: order of operations for a single tool call
  types.ts              GuardOptions and the public shapes
  errors.ts             error codes and result formatting
  metrics.ts            GuardMetrics counters
  logger.ts             shared pino instance (silent unless debug)
  tools-list.ts         tools/list filtering
  policy/
    types.ts            allow/deny/requireConfirmation, rule shape
    conditions.ts       argEquals, argStartsWith, and/or/not, …
    evaluate.ts         precedence and rule matching
    glob.ts             glob → RegExp, with cache
    config.ts           policiesFromConfig (JSON-driven rules)
  rate-limit/
    token-bucket.ts     TokenBucket + multi-scope RateLimiter
  confirmation/
    store.ts            ConfirmationStore interface + in-memory implementation
    tokens.ts           issue/consume/revoke, argument hashing
  redact/
    redact.ts           patterns, key rules, traversal
  audit/
    audit.ts            entry shape, sinks, fan-out
tests/                  one file per module, plus integration suites
examples/               runnable .mjs demos
docs/                   long-form guides
```

`src/guard.ts` is the file to read first: it is the only place the order of
operations lives (rate limit → policy → validate → confirm → call → redact →
audit), and most behaviour questions are answered there.

## Testing

Tests use [Vitest](https://vitest.dev) and live in `tests/`, one file per module
plus two integration suites:

- `tests/guard.integration.test.ts` — the v0.1 end-to-end path, kept as a
  regression guard for backward compatibility
- `tests/mcp-sdk.integration.test.ts` — runs against the **real**
  `@modelcontextprotocol/sdk`, so a change in how the SDK stores request
  handlers fails loudly here rather than in your production server

What a good test looks like in this repo:

- **Assert on behaviour, not internals.** Parse the JSON out of
  `result.content[0].text` and check the `error` code.
- **Cover the failure direction.** Every new permission path needs a test that
  it *doesn't* permit the neighbouring case. A rule that allows `/workspace/`
  needs a test that `/etc/shadow` is refused.
- **Fail closed under error.** If a hook, condition, or store throws, prove the
  call is denied rather than allowed.
- **No wall-clock dependence beyond ~100 ms.** CI runners vary wildly. If you
  need timing, use short TTLs and generous thresholds — there is a comment on
  the redaction performance test explaining why its bound is loose.

Run one file while iterating:

```bash
npx vitest run tests/policy.test.ts
npx vitest tests/policy.test.ts        # watch
```

## Code style

Prettier and ESLint are configured; `npm run lint:fix && npm run format` settles
most of it. Beyond the mechanical parts:

- **TypeScript strict mode**, including `noUncheckedIndexedAccess`. Index access
  returns `T | undefined` — handle it rather than asserting it away.
- **Explicit `.js` extensions** on relative imports. The package is ESM-first
  and this is required for Node resolution.
- **Comments explain *why*.** The codebase avoids comments that restate the
  code. Comments that survive review are the ones recording a decision: why the
  logger is silent by default, why buckets are peeked before consuming, why a
  throwing condition means "no match".
- **No `console`.** Use the shared logger (`getLogger()`); an MCP stdio server
  shares stdout with the JSON-RPC stream.
- **No new runtime dependencies** without discussion. `pino` is the only one.

## Design principles

Changes are judged against these, in order:

1. **Fail closed.** Every ambiguous state resolves to denial. A throwing
   condition, a missing identity, an unmatched tool, a broken approver — all deny.
2. **Observability cannot break execution.** Audit sinks and `onDecision` hooks
   are wrapped; a failing sink is logged, never propagated.
3. **The default configuration is the safe one.** New options default to the
   conservative value. If a flag makes the guard more permissive, it must be
   opt-in and documented.
4. **Backward compatible within a minor.** v0.1 options still work in v0.2.
   Deprecate with a JSDoc `@deprecated` tag and keep the behaviour.
5. **Bounded memory.** Anything keyed by attacker-influenced input (tool names,
   identities, tokens) needs an eviction path. See `maxBuckets` and `maxEntries`.
6. **Small core, real extension points.** If it can be a `when` condition, a
   custom sink, or a custom store, it probably should be.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<optional scope>): <subject in the imperative, under ~60 chars>

<optional body: why, not what>
<optional footer: Closes #123 / BREAKING CHANGE: …>
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`.

```
feat(policy): support argument conditions on rules
fix(confirmation): reject tokens redeemed by a different identity
docs: document the tools/list filtering caveat
```

Do not add tool or AI attribution trailers to commits.

## Pull requests

1. Branch from `main` — `feat/short-description`, `fix/short-description`.
2. Keep it focused. A refactor bundled with a behaviour change is hard to review
   and harder to revert.
3. Add or update tests. A behaviour change with no test change is usually a sign
   that the behaviour was untested before.
4. Update the docs that go with the change: README section, `docs/api.md` entry,
   and a `CHANGELOG.md` line under "Unreleased".
5. Run `npm run verify` locally — CI runs the same thing on Node 22 and 24.
6. Describe **why** in the PR body. Reviewers can read the diff for the "what".

The PR template covers this as a checklist.

Review turnaround is best-effort — this is a spare-time project. A ping after a
week is welcome, not rude.

## Documentation changes

Docs live in three places, and they drift apart if you only update one:

- `README.md` — the tour: what exists and roughly how to use it
- `docs/api.md` — every option, with defaults
- JSDoc in `src/` — what someone sees on hover in their editor

A new option needs all three. A new recipe needs only `docs/recipes.md`.

## Releasing

Maintainers only — see [PUBLISH.md](./PUBLISH.md). In short: update
`CHANGELOG.md`, bump the version, tag `vX.Y.Z`, push the tag; GitHub Actions
publishes to npm with provenance via trusted publishing.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
