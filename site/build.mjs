/**
 * Bundles the real `src/` for the browser demo.
 *
 * The demo runs the actual library — policy evaluation, rate limiting,
 * confirmation tokens, redaction, audit — not a reimplementation. Only the
 * Node built-ins it reaches for are swapped, via the aliases below.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = resolve(root, "site/dist");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [resolve(root, "src/index.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  outfile: resolve(out, "mcp-policy-guard.js"),
  minify: true,
  sourcemap: true,
  alias: {
    "node:crypto": resolve(here, "shims/node-crypto.js"),
    "node:fs/promises": resolve(here, "shims/node-fs-promises.js"),
    "node:path": resolve(here, "shims/node-path.js"),
    pino: resolve(here, "shims/pino.js"),
  },
  inject: [resolve(here, "shims/globals.js")],
});

for (const asset of ["index.html", "app.js", "styles.css"]) {
  await cp(resolve(here, asset), resolve(out, asset));
}

console.log(`site built → ${out}`);
