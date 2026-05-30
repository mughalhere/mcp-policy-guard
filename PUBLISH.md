# Push to GitHub & publish to npm

Same flow as [`prompt-protection`](https://github.com/mughalhere/prompt-protection): code lives on GitHub; **pushing a version tag** publishes to npm via Actions.

Remote: `git@github.com:mughalhere/mcp-guard.git`

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

From this directory (or from the portfolio `oss-bundles/` helper):

### Option A — from this package folder

```bash
cd packages/mcp-policy-guard
git init -b main
git add .
git commit -m "chore: initial mcp-policy-guard release"
git remote add origin git@github.com:mughalhere/mcp-guard.git
git push -u origin main
```

### Option B — preserve staggered history (recommended)

From the portfolio repo root:

```bash
./scripts/push-from-bundles.sh
# or just mcp-guard:
git clone oss-bundles/mcp-guard.bundle /tmp/mcp-guard
cd /tmp/mcp-guard
git remote add origin git@github.com:mughalhere/mcp-guard.git
git push -u origin main
```

Confirm: https://github.com/mughalhere/mcp-guard

---

## 2. One-time npm / Actions setup

1. On [npmjs.com](https://www.npmjs.com/) create an **automation** (or granular) token that can publish `mcp-policy-guard`.
2. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NPM_TOKEN`
   - Value: the npm token
3. Optional but preferred: link the package for **trusted publishing / provenance** on npm (same as `prompt-protection`).

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
npm version 0.1.0 --no-git-tag-version   # if version not bumped yet
# edit CHANGELOG.md, commit version bump via PR if needed

git tag v0.1.0
git push origin v0.1.0
```

5. The **Publish to npm** workflow (`.github/workflows/publish.yml`) runs on `v*` tags:
   - `npm ci`
   - `npm run prepublishOnly` (build + test + typecheck)
   - `npm publish --access public` using `NPM_TOKEN`

6. Verify: https://www.npmjs.com/package/mcp-policy-guard

### Quick checklist

| Step | Command / action |
|------|------------------|
| Tests green | `npm test && npm run typecheck && npm run build` |
| Version bumped | `package.json` + `CHANGELOG.md` |
| Tag pushed | `git tag vX.Y.Z && git push origin vX.Y.Z` |
| Secret set | `NPM_TOKEN` in repo Actions secrets |

---

## 4. Later releases

```bash
# after merging to main
npm version patch   # or minor / major — creates commit + tag if you prefer
git push origin main --follow-tags
```

Or bump manually and push only the tag (`v0.1.1`, etc.). Same workflow publishes.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `403` from `cursor[bot]` when the agent pushes | Push from your machine (SSH as `mughalhere`) or grant the Cursor GitHub App access to this repo |
| Publish job fails auth | Re-check `NPM_TOKEN`; token must allow publish for this package name |
| Tag pushed but no workflow | Confirm tag matches `v*` (e.g. `v0.1.0`) and Actions are enabled |
| Name already taken on npm | Rename in `package.json` before the first publish |
