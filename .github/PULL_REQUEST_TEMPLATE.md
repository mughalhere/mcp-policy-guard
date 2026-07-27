<!--
Thanks for the PR. Keep the description focused on *why* — reviewers can read
the diff for the *what*.

Security fixes should not arrive as a public PR. See SECURITY.md.
-->

## What this changes

<!-- One or two sentences. -->

## Why

<!-- The problem, the situation you hit, or the issue this closes. -->

Closes #

## Type of change

- [ ] Bug fix (no API change)
- [ ] New feature (additive)
- [ ] Breaking change (a documented behaviour differs)
- [ ] Documentation only
- [ ] Internal refactor / tooling

## Safety review

<!-- Skip the ones that don't apply, but do consider each. -->

- [ ] Every new error path fails **closed** (denies rather than permits)
- [ ] No new option makes the default configuration more permissive
- [ ] Anything keyed by attacker-influenced input has an eviction path
- [ ] No new runtime dependency
- [ ] New regex patterns cannot backtrack catastrophically on long input

## Checklist

- [ ] `npm run verify` passes locally (lint, typecheck, test, build)
- [ ] Tests added or updated — including the failure direction, not only the
      happy path
- [ ] Docs updated: README section, `docs/api.md`, and JSDoc in `src/`
- [ ] `CHANGELOG.md` updated under "Unreleased"
- [ ] Commit messages follow Conventional Commits
- [ ] Backward compatible with v0.1 options, or the break is called out above
