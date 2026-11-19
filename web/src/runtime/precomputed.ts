/**
 * Precomputed model results: public/precomputed/<model>/<key>.json
 * (copied from ../data/precomputed by scripts/sync-data.mjs).
 *
 * Use these for instant first paint; fall back to (or refresh with) a live run.
 */
import { publicUrl } from "../lib/paths";
import { getRuntime } from "./client";
import type { ModelName, RunOptions } from "./types";

const cache = new Map<string, Promise<unknown | null>>();

/** Fetch a precomputed result. Resolves null if it does not exist. Cached per URL. */
export function fetchPrecomputed<T = unknown>(model: ModelName | string, key: string): Promise<T | null> {
  const url = publicUrl(`precomputed/${model}/${encodeURIComponent(key)}.json`);
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then(async (r) => {
        if (!r.ok) return null;
        const type = r.headers.get("content-type") ?? "";
        // Dev servers answer unknown paths with index.html — treat as missing.
        if (type.includes("text/html")) return null;
        return (await r.json()) as unknown;
      })
      .catch(() => null);
    cache.set(url, p);
  }
  return p as Promise<T | null>;
}

/** Optional index file listing available keys: public/precomputed/<model>/index.json */
export function fetchPrecomputedIndex<T = unknown>(model: ModelName | string): Promise<T | null> {
  return fetchPrecomputed<T>(model, "index");
}

export type Sourced<T> = { result: T; source: "precomputed" | "live" };

/**
 * Precomputed if available, otherwise a live Pyodide run with `payload`.
 * The `source` field lets UIs label results honestly ("precomputed" vs "computed in your browser").
 */
export async function precomputedOrRun<T = unknown>(
  model: ModelName,
  key: string,
  payload: object,
  opts?: RunOptions,
): Promise<Sourced<T>> {
  const pre = await fetchPrecomputed<T>(model, key);
  if (pre) return { result: pre, source: "precomputed" };
  return { result: await getRuntime().run<T>(model, payload, opts), source: "live" };
}
