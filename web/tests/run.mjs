// Bundle the TypeScript reference cases with the bundler the app already uses,
// then run them on plain Node. No extra test framework to keep in sync.
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = await mkdtemp(path.join(tmpdir(), "gravespire-tests-"));
const bundle = path.join(out, "authority.mjs");

await build({
  entryPoints: [path.join(here, "authority.test.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: bundle,
  logLevel: "warning",
  alias: { "@": path.join(root, "src") },
});

try {
  await import(pathToFileURL(bundle).href);
} finally {
  await rm(out, { recursive: true, force: true });
}
