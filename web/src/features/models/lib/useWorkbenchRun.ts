/**
 * Run state for a workbench: precomputed / saved / live results, running flag, errors.
 * Keeps the previous result visible while a new one computes (never flashes empty).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getRuntime, isAbort, RuntimeError } from "../../../runtime";
import type { ModelName } from "../../../runtime";
import type { BaseResult } from "../results";

export type RunSource =
  | { kind: "precomputed" }
  | { kind: "live"; ms: number; wallMs: number; at: number; coldStart: boolean }
  | { kind: "saved"; label: string };

export type RunError = { message: string; traceback?: string; kind: "python" | "runtime" | "model" };

export type WorkbenchRunState<R> = {
  result: R | null;
  source: RunSource | null;
  running: boolean;
  /** True while this run is also waiting for Python to load. */
  coldStart: boolean;
  error: RunError | null;
};

export function useWorkbenchRun<R extends BaseResult>(model: ModelName, latestKey: string) {
  const [state, setState] = useState<WorkbenchRunState<R>>({ result: null, source: null, running: false, coldStart: false, error: null });
  const ctrl = useRef<AbortController | null>(null);
  const lastPayload = useRef<object | null>(null);

  const run = useCallback(
    async (payload: object): Promise<R | null> => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      lastPayload.current = payload;
      const rt = getRuntime();
      const coldStart = rt.status.state !== "ready";
      setState((s) => ({ ...s, running: true, coldStart, error: null }));
      const t0 = performance.now();
      try {
        const result = await rt.run<R>(model, payload, { signal: c.signal, latest: latestKey });
        if (c.signal.aborted) return null;
        if (result && result.ok === false) {
          setState((s) => ({
            ...s,
            running: false,
            coldStart: false,
            error: { kind: "model", message: result.error?.message ?? "The model rejected this input." },
          }));
          return null;
        }
        const wallMs = performance.now() - t0;
        setState({
          result,
          source: { kind: "live", ms: rt.lastCallMs, wallMs, at: Date.now(), coldStart },
          running: false,
          coldStart: false,
          error: null,
        });
        return result;
      } catch (e) {
        if (isAbort(e)) return null;
        if (c.signal.aborted) return null;
        const info = e instanceof RuntimeError ? e.info : { kind: "runtime" as const, message: String(e) };
        setState((s) => ({
          ...s,
          running: false,
          coldStart: false,
          error: { kind: info.kind === "python" ? "python" : "runtime", message: info.message, traceback: info.traceback },
        }));
        return null;
      }
    },
    [model, latestKey],
  );

  /** Show an existing result (precomputed or restored) and cancel any pending run. */
  const show = useCallback((result: R, source: RunSource) => {
    ctrl.current?.abort();
    setState({ result, source, running: false, coldStart: false, error: null });
  }, []);

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    setState((s) => ({ ...s, running: false, coldStart: false }));
  }, []);

  const retry = useCallback(() => {
    const rt = getRuntime();
    if (rt.status.state === "error") rt.reset();
    if (lastPayload.current) void run(lastPayload.current);
  }, [run]);

  useEffect(() => () => ctrl.current?.abort(), []);

  return { ...state, run, show, cancel, retry };
}

/** Debounced effect trigger: returns a function that schedules `fn` after `ms`. */
export function useDebounced<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  const t = useRef<number | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => () => {
    if (t.current) window.clearTimeout(t.current);
  }, []);
  return useCallback(
    (...a: A) => {
      if (t.current) window.clearTimeout(t.current);
      t.current = window.setTimeout(() => fnRef.current(...a), ms);
    },
    [ms],
  );
}
