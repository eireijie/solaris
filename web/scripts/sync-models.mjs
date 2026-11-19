#!/usr/bin/env node
/**
 * Copy the Python package ../models/solaris_models/** into public/py/solaris_models/
 * and write public/py/manifest.json listing every Python package under public/py/
 * (solaris_models + the in-repo _selftest), with content hashes for cache-busting.
 *
 * Runs automatically before `npm run dev` and `npm run build`. Tolerates the
 * package not existing yet (the runtime then reports "models not available").
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const SRC = resolve(web, "../models/solaris_models");
const PY_ROOT = join(web, "public/py");
const DEST = join(PY_ROOT, "solaris_models");
/** File types shipped to the browser. Add ".json" here if the package ever needs data files. */
const EXTS = [".py"];
const SKIP_DIRS = new Set(["__pycache__", "tests", "test", ".pytest_cache"]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith(".")) out.push(...walk(p));
    } else if (EXTS.some((e) => name.endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

mkdirSync(PY_ROOT, { recursive: true });
rmSync(DEST, { recursive: true, force: true });

if (existsSync(SRC)) {
  const files = walk(SRC);
  for (const f of files) {
    const to = join(DEST, relative(SRC, f));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(f, to);
  }
  console.log(`[sync-models] copied ${files.length} file(s) from models/solaris_models`);
} else {
  console.warn("[sync-models] ../models/solaris_models not found — skipping (runtime self-test still works)");
}

const packages = {};
for (const name of readdirSync(PY_ROOT)) {
  const dir = join(PY_ROOT, name);
  if (!statSync(dir).isDirectory()) continue;
  const files = walk(dir)
    .map((p) => {
      const rel = relative(dir, p).split(sep).join("/");
      const hash = createHash("sha1").update(readFileSync(p)).digest("hex").slice(0, 10);
      return { path: rel, hash };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  if (files.length) packages[name] = { files };
}

writeFileSync(join(PY_ROOT, "manifest.json"), JSON.stringify({ generated: new Date().toISOString(), packages }, null, 2) + "\n");
console.log(`[sync-models] manifest: ${Object.entries(packages).map(([k, v]) => `${k} (${v.files.length})`).join(", ") || "empty"}`);
