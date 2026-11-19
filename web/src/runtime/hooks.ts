import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getRuntime, isAbort, RuntimeError } from "./client";
import type { ModelName, RuntimeStatus } from "./types";

/** Subscribe to runtime status. Pass `warm` to start loading on mount. */
export function useRuntimeStatus(opts: { warm?: boolean } = {}): RuntimeStatus {
  const rt = getRuntime();
  const status = useSyncExternalStore(
    (cb) => rt.subscribe(cb),
    () => rt.status,
    () => rt.status,
  );
  useEffect(() => {
    if (opts.warm) void rt.warmup();
  }, [opts.warm, rt]);
  return status;
}

export type ModelRunState<T> = {
  result: T | null;
  error: RuntimeError | null;
  running: boolean;
  /** Worker-side ms of the last successful run. */
  ms: number | null;
};

/**
 * Convenience hook for model UIs: `run(payload)` starts a run, cancelling/superseding
 * the previous one. Keeps the last good result while a new one computes.
 */
export function useModelRun<T>(model: ModelName) {
  const [state, setState] = useState<ModelRunState<T>>({ result: null, error: null, running: false, ms: null });
  const ctrl = useRef<AbortController | null>(null);

  const run = useCallback(
    async (payload: object) => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setState((s) => ({ ...s, running: true, error: null }));
      try {
        const result = await getRuntime().run<T>(model, payload, { signal: c.signal, latest: `hook-${model}` });
        if (!c.signal.aborted) setState({ result, error: null, running: false, ms: getRuntime().lastCallMs });
        return result;
      } catch (e) {
        if (isAbort(e)) return null;
        const err = e instanceof RuntimeError ? e : new RuntimeError({ kind: "runtime", message: String(e) });
        if (!c.signal.aborted) setState((s) => ({ ...s, running: false, error: err }));
        return null;
      }
    },
    [model],
  );

  useEffect(() => () => ctrl.current?.abort(), []);
  return { ...state, run, setResult: (result: T) => setState((s) => ({ ...s, result })) };
}
