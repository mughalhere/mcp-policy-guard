# Demo site

The interactive demo at <https://mughalhere.github.io/mcp-policy-guard/>.

It runs the **real library** — `site/build.mjs` bundles `src/` with esbuild, so
policy evaluation, token buckets, confirmation tokens, and redaction are the
same code that ships to npm. Nothing is reimplemented for the page.

## Local development

```bash
npm run build:site     # bundle + copy assets into site/dist
npm run verify:site    # build, then check the shims and the bundle
npx http-server site/dist   # or any static server
```

## What is shimmed

The library reaches for four things a browser does not have. `build.mjs` aliases
each to a file in `site/shims/`:

| Import | Shim | Notes |
| --- | --- | --- |
| `node:crypto` | `shims/node-crypto.js` | `hashArgs()` is synchronous and `crypto.subtle.digest` is not, so this carries a compact synchronous SHA-256 |
| `node:fs/promises` | `shims/node-fs-promises.js` | The `"file"` audit sink rejects; the guard logs and swallows it, as it does on a server |
| `node:path` | `shims/node-path.js` | Just `dirname` |
| `pino` | `shims/pino.js` | Routes to the console so `debug: true` is visible in devtools |

`Buffer` and `process` are injected as globals from `shims/globals.js`.

## Why `verify-shims.mjs` exists

Swapping out crypto in a demo is an easy way to ship something that looks right
and is subtly wrong. `site/verify-shims.mjs` asserts the shim's SHA-256 matches
`node:crypto` byte for byte across padding boundaries and multi-byte input,
that `hashArgs` in the bundle matches the Node build, and that the bundled guard
still denies, gates, redacts, and rejects replayed tokens. CI runs it before
every deploy.

## Deployment

`.github/workflows/pages.yml` builds and verifies on pushes to `main` that touch
`site/**` or `src/**`, then publishes `site/dist` to GitHub Pages.
