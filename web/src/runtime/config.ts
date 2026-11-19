/**
 * Runtime configuration. Change PYODIDE_BASE_URL to self-host Pyodide
 * (see README → "Self-hosting Pyodide").
 */
export const PYODIDE_VERSION = "0.29.5"; // Python 3.13.2, numpy 2.2.5, scipy 1.14.1

/** Absolute URL, or a path relative to the site root (e.g. "pyodide/" when self-hosted in public/pyodide/).
 * Directory containing pyodide.mjs, pyodide.asm.wasm, python_stdlib.zip, pyodide-lock.json and the wheels. Must end with "/". */
export const PYODIDE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/**
 * Packages loaded before our code is installed. Imports found in the installed
 * .py files are also auto-loaded (pyodide.loadPackagesFromImports), so if the
 * models start importing e.g. pandas it still works — but keep this list minimal:
 * every package slows the first load on a phone.
 */
export const PYODIDE_PACKAGES = ["numpy", "scipy"] as const;

/** Where the Python sources are served from (inside public/). */
export const PY_MANIFEST_PATH = "py/manifest.json";

/** Python module + function used for model runs. */
export const DISPATCH = { module: "solaris_models.api", fn: "dispatch" } as const;
