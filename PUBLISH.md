# Push to GitHub & publish to npm

Same flow as [`prompt-protection`](https://github.com/mughalhere/prompt-protection): code lives on GitHub; **pushing a version tag** publishes to npm via Actions.

Remote: `git@github.com:mughalhere/mcp-policy-guard.git`

---

## 0. First npm publish (do this before GitHub Actions tokens)

Create the package on the registry once from your laptop (where `npm whoami` works). Granular tokens can only be scoped after the package exists.

From the **portfolio** repo root on this branch:

```bash
npm whoami   # must print your npm username
./scripts/first-npm-publish.sh
```

Or per package:

```bash
cd packages/PACKAGE_NAME
npm ci
npm run prepublishOnly
npm publish --access public
```

Then create package-scoped tokens on npm and add `NPM_TOKEN` to each GitHub repo. Later releases use version tags (section 3 below).

---

## 1. First-time push to GitHub

> Already done — the repo exists at `mughalhere/mcp-policy-guard`. Kept for
> reference when bootstrapping the next package.

From this directory (or from the portfolio `oss-bundles/` helper):

### Option A — from this package folder

```bash
cd packages/mcp-policy-guard
git init -b main
git add .
git commit -m "chore: initial mcp-policy-guard release"
git remote add origin git@github.com:mughalhere/mcp-policy-guard.git
git push -u origin main
```

### Option B — preserve staggered history (recommended)

From the portfolio repo root:

```bash
./scripts/push-from-bundles.sh
# or just mcp-policy-guard:
git clone oss-bundles/mcp-policy-guard.bundle /tmp/mcp-policy-guard
cd /tmp/mcp-policy-guard
git remote add origin git@github.com:mughalhere/mcp-policy-guard.git
git push -u origin main
```

Confirm: https://github.com/mughalhere/mcp-policy-guard

---

## 2. One-time npm / Actions setup

The workflow publishes with **npm trusted publishing (OIDC)** — no `NPM_TOKEN`
secret is involved.

1. On [npmjs.com](https://www.npmjs.com/package/mcp-policy-guard/access), under
   **Publishing access**, add a trusted publisher: this GitHub repository, the
   `publish.yml` workflow.
2. Confirm the job keeps `permissions: id-token: write` — OIDC fails without it.
3. Nothing to rotate: OIDC tokens are minted per run.

---

## 3. Publish a version to npm

Publishing is **tag-driven**. Do not run `npm publish` by hand unless Actions is broken.

1. Land changes on `main` (PR + green CI).
2. Bump `version` in `package.json` and update `CHANGELOG.md`.
3. Commit, merge to `main`.
4. Create and push a tag matching the version:

```bash
git checkout main
git pull
npm version 0.2.0 --no-git-tag-version   # if version not bumped yet
# edit CHANGELOG.md, commit version bump via PR if needed

git tag v0.2.0
git push origin v0.2.0
```

5. The **Publish to npm** workflow (`.github/workflows/publish.yml`) runs on `v*` tags:
   - `npm ci`
   - `npm run prepublishOnly` → `npm run verify` (lint + typecheck + test + build)
   - `npm publish --access public --provenance` via trusted publishing

6. Verify: https://www.npmjs.com/package/mcp-policy-guard

### Quick checklist

| Step | Command / action |
|------|------------------|
| Everything green | `npm run verify` |
| Version bumped | `package.json` + `CHANGELOG.md` |
| Docs updated | README, `docs/api.md`, migration notes for behaviour changes |
| Tag pushed | `git tag vX.Y.Z && git push origin vX.Y.Z` |
| Trusted publisher | configured on npm for this repo + `publish.yml` |

---

## 4. Later releases

```bash
# after merging to main
npm version patch   # or minor / major — creates commit + tag if you prefer
git push origin main --follow-tags
```

Or bump manually and push only the tag (`v0.2.1`, etc.). Same workflow publishes.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `403` from `cursor[bot]` when the agent pushes | Push from your machine (SSH as `mughalhere`) or grant the Cursor GitHub App access to this repo |
| Publish job fails auth | Check the npm trusted-publisher entry matches this repo and `publish.yml`, and that the job still has `id-token: write` |
| Tag pushed but no workflow | Confirm tag matches `v*` (e.g. `v0.1.0`) and Actions are enabled |
| Name already taken on npm | Rename in `package.json` before the first publish |
