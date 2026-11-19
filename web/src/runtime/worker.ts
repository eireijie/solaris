/**
 * Pyodide Web Worker. Loads CPython (WASM) + numpy/scipy, installs our Python
 * packages from public/py/ (listed in py/manifest.json), then serves JSON-in /
 * JSON-out function calls. All values cross the boundary as JSON strings
 * (json.dumps in Python) so no PyProxy objects leak.
 */
import type { FromWorker, ToWorker, RuntimeErrorInfo } from "./types";

type PyodideAPI = {
  loadPackage: (names: string[] | string, opts?: { messageCallback?: (m: string) => void; errorCallback?: (m: string) => void }) => Promise<unknown>;
  loadPackagesFromImports: (code: string, opts?: { messageCallback?: (m: string) => void }) => Promise<unknown>;
  runPython: (code: string) => unknown;
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: { get: (name: string) => unknown };
  FS: { mkdirTree: (p: string) => void; writeFile: (p: string, data: string) => void };
  version: string;
};

type Manifest = {
  generated?: string;
  packages: Record<string, { files: { path: string; hash?: string }[] }>;
};

const ctx = self as unknown as {
  postMessage: (m: unknown) => void;
  onmessage: ((ev: MessageEvent<ToWorker>) => void) | null;
};
const post = (m: FromWorker) => ctx.postMessage(m);

const HELPERS = `
import json, math, importlib, sys

def _sol_sanitize(o):
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {str(k): _sol_sanitize(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_sol_sanitize(v) for v in o]
    try:
        import numpy as _np
        if isinstance(o, _np.ndarray):
            return _sol_sanitize(o.tolist())
        if isinstance(o, _np.generic):
            return _sol_sanitize(o.item())
    except ImportError:
        pass
    return o

def _sol_call(module, fn, args_json):
    mod = importlib.import_module(module)
    f = getattr(mod, fn)
    args = json.loads(args_json)
    res = f(*args) if isinstance(args, list) else f(**args)
    return json.dumps(_sol_sanitize(res), allow_nan=False)

def _sol_try_import(name):
    try:
        importlib.import_module(name)
        return ""
    except BaseException:
        import traceback
        return traceback.format_exc()
`;

let py: PyodideAPI | null = null;
let readyResolve!: () => void;
let readyReject!: (e: unknown) => void;
const ready = new Promise<void>((res, rej) => {
  readyResolve = res;
  readyReject = rej;
});
ready.catch(() => {});
let initError: RuntimeErrorInfo | null = null;
let callFn: ((m: string, f: string, a: string) => string) | null = null;

function toErrorInfo(e: unknown, kind: RuntimeErrorInfo["kind"]): RuntimeErrorInfo {
  const text = e instanceof Error ? e.message : String(e);
  const isPy = (e as { constructor?: { name?: string } })?.constructor?.name === "PythonError" || /Traceback \(most recent call last\)/.test(text);
  if (isPy) {
    const lines = text.trim().split("\n").filter(Boolean);
    return { kind: "python", message: lines[lines.length - 1] ?? text, traceback: text };
  }
  return { kind, message: text };
}

async function init(msg: Extract<ToWorker, { type: "init" }>) {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const steps = 3;
  const status = (step: number, stage: string, extra: Record<string, unknown> = {}) =>
    post({ type: "status", status: { state: "loading", stage, step, steps, elapsedMs: performance.now() - t0, timings: { ...timings }, ...extra } });

  try {
    status(0, "Downloading Python runtime");
    const mod = (await import(/* @vite-ignore */ `${msg.pyodideBase}pyodide.mjs`)) as {
      loadPyodide: (o: { indexURL: string; stdout?: (s: string) => void; stderr?: (s: string) => void }) => Promise<PyodideAPI>;
    };
    py = await mod.loadPyodide({
      indexURL: msg.pyodideBase,
      stdout: (s) => console.log("[py]", s),
      stderr: (s) => console.warn("[py]", s),
    });
    timings.pyodide = performance.now() - t0;

    status(1, `Loading ${msg.packages.join(" + ")}`);
    const t1 = performance.now();
    await py.loadPackage(msg.packages, { messageCallback: () => {}, errorCallback: (m) => console.warn(m) });
    timings.packages = performance.now() - t1;

    status(2, "Installing Solaris models");
    const t2 = performance.now();
    const manifestRes = await fetch(new URL(msg.manifestPath, msg.rootUrl), { cache: "no-cache" });
    if (!manifestRes.ok) throw new Error(`Could not load ${msg.manifestPath} (HTTP ${manifestRes.status}). Run "npm run sync".`);
    const manifest = (await manifestRes.json()) as Manifest;
    const root = "/home/pyodide";
    const counts: Record<string, number> = {};
    let allCode = "";
    for (const [pkg, { files }] of Object.entries(manifest.packages)) {
      const texts = await Promise.all(
        files.map(async (f) => {
          const url = new URL(`py/${pkg}/${f.path}${f.hash ? `?v=${f.hash}` : ""}`, msg.rootUrl);
          const r = await fetch(url);
          if (!r.ok) throw new Error(`Could not fetch ${url.pathname} (HTTP ${r.status})`);
          return [f.path, await r.text()] as const;
        }),
      );
      for (const [path, text] of texts) {
        const full = `${root}/${pkg}/${path}`;
        py.FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
        py.FS.writeFile(full, text);
        if (path.endsWith(".py")) allCode += `\n${text}`;
      }
      counts[pkg] = files.length;
    }
    // Auto-load any extra Pyodide packages the sources import (e.g. pandas) — no-op for numpy/scipy.
    await py.loadPackagesFromImports(allCode);
    py.runPython(`import sys\nif "${root}" not in sys.path: sys.path.insert(0, "${root}")\nimport importlib; importlib.invalidate_caches()`);
    py.runPython(HELPERS);
    callFn = py.globals.get("_sol_call") as (m: string, f: string, a: string) => string;
    const tryImport = py.globals.get("_sol_try_import") as ((n: string) => string) & { destroy?: () => void };
    const modelsError = counts.solaris_models ? tryImport("solaris_models.api") : "solaris_models not present in py/manifest.json";
    tryImport.destroy?.();
    timings.install = performance.now() - t2;
    timings.total = performance.now() - t0;

    post({
      type: "status",
      status: {
        state: "ready",
        stage: "Ready",
        step: steps,
        steps,
        elapsedMs: timings.total,
        timings,
        packages: counts,
        modelsAvailable: !modelsError,
        modelsError: modelsError || undefined,
      },
    });
    readyResolve();
  } catch (e) {
    initError = toErrorInfo(e, "runtime");
    post({
      type: "status",
      status: { state: "error", stage: "Failed to start Python runtime", step: 0, steps, elapsedMs: performance.now() - t0, error: initError, timings },
    });
    readyReject(e);
  }
}

async function call(msg: Extract<ToWorker, { type: "call" }>) {
  const t0 = performance.now();
  try {
    await ready;
  } catch {
    post({ type: "result", id: msg.id, ok: false, error: initError ?? { kind: "runtime", message: "Runtime failed to load" }, ms: 0 });
    return;
  }
  try {
    const json = callFn!(msg.module, msg.fn, msg.argsJson);
    post({ type: "result", id: msg.id, ok: true, json, ms: performance.now() - t0 });
  } catch (e) {
    post({ type: "result", id: msg.id, ok: false, error: toErrorInfo(e, "python"), ms: performance.now() - t0 });
  }
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type === "init") void init(msg);
  else if (msg.type === "call") void call(msg);
};
