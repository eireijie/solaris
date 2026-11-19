/**
 * Main-thread client for the Pyodide worker.
 *
 *   const rt = getRuntime();          // singleton
 *   rt.status                         // RuntimeStatus (subscribe via useRuntimeStatus())
 *   await rt.warmup();                // start loading in the background (idempotent)
 *   const r = await rt.run<AerosResult>("aeros", payload, { signal, latest: "aeros-slider" });
 *
 * Jobs run one at a time in a FIFO queue (Python in the worker is single-threaded).
 * Errors reject with RuntimeError (has .info.traceback for Python exceptions).
 */
import { DISPATCH, PY_MANIFEST_PATH, PYODIDE_BASE_URL, PYODIDE_PACKAGES } from "./config";
import type { FromWorker, ModelName, RunOptions, RuntimeErrorInfo, RuntimeStatus, ToWorker } from "./types";
import { appRoot } from "../lib/paths";

export class RuntimeError extends Error {
  info: RuntimeErrorInfo;
  constructor(info: RuntimeErrorInfo) {
    super(info.message);
    this.name = info.kind === "abort" ? "AbortError" : "RuntimeError";
    this.info = info;
  }
  get traceback() {
    return this.info.traceback;
  }
}

type Job = {
  id: number;
  module: string;
  fn: string;
  argsJson: string;
  latest?: string;
  signal?: AbortSignal;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  started: boolean;
  /** Wall time measured on the main thread (queue wait excluded). */
  onAbort?: () => void;
};

const IDLE: RuntimeStatus = { state: "idle", stage: "Not started", step: 0, steps: 3, elapsedMs: 0 };

class Runtime {
  status: RuntimeStatus = IDLE;
  /** ms of the last completed call inside the worker. */
  lastCallMs = 0;
  private worker: Worker | null = null;
  private listeners = new Set<(s: RuntimeStatus) => void>();
  private queue: Job[] = [];
  private active: Job | null = null;
  private nextId = 1;
  private warm: Promise<void> | null = null;
  private warmResolve: (() => void) | null = null;
  private warmReject: ((e: unknown) => void) | null = null;
  private startedAt = 0;
  private timer: number | null = null;

  subscribe(cb: (s: RuntimeStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setStatus(s: RuntimeStatus) {
    this.status = s;
    this.listeners.forEach((l) => l(s));
  }

  /** Start loading Pyodide + packages + our models. Safe to call many times. */
  warmup(): Promise<void> {
    if (this.warm) return this.warm;
    this.warm = new Promise<void>((res, rej) => {
      this.warmResolve = res;
      this.warmReject = rej;
    });
    this.warm.catch(() => {});
    this.startedAt = performance.now();
    this.setStatus({ ...IDLE, state: "loading", stage: "Starting worker" });
    // Tick elapsed time for UIs while loading.
    this.timer = window.setInterval(() => {
      if (this.status.state === "loading") this.setStatus({ ...this.status, elapsedMs: performance.now() - this.startedAt });
    }, 250);

    try {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "solaris-pyodide" });
    } catch (e) {
      this.fail({ kind: "runtime", message: `Could not start worker: ${String(e)}` });
      return this.warm;
    }
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => this.fail({ kind: "runtime", message: ev.message || "Worker error" });
    const init: ToWorker = {
      type: "init",
      rootUrl: appRoot(),
      pyodideBase: new URL(PYODIDE_BASE_URL, appRoot()).href,
      packages: [...PYODIDE_PACKAGES],
      manifestPath: PY_MANIFEST_PATH,
    };
    this.worker.postMessage(init);
    return this.warm;
  }

  /** Run a Solaris model via solaris_models.api.dispatch(model, payload). */
  run<T = unknown>(model: ModelName, payload: object, opts: RunOptions = {}): Promise<T> {
    return this.call<T>(DISPATCH.module, DISPATCH.fn, [model, payload], opts);
  }

  /**
   * Call any Python function `module.fn(*args)` (args JSON-serialisable; result
   * must be JSON-serialisable — NaN/Inf become null, numpy types are converted).
   */
  call<T = unknown>(module: string, fn: string, args: unknown[] | Record<string, unknown> = [], opts: RunOptions = {}): Promise<T> {
    void this.warmup();
    return new Promise<T>((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(new RuntimeError({ kind: "abort", message: "Aborted" }));
        return;
      }
      const job: Job = {
        id: this.nextId++,
        module,
        fn,
        argsJson: JSON.stringify(args),
        latest: opts.latest,
        signal: opts.signal,
        resolve: resolve as (v: unknown) => void,
        reject,
        started: false,
      };
      if (opts.latest) {
        this.queue = this.queue.filter((q) => {
          if (q.latest === opts.latest) {
            q.reject(new RuntimeError({ kind: "abort", message: "Superseded by a newer run" }));
            return false;
          }
          return true;
        });
      }
      if (opts.signal) {
        job.onAbort = () => {
          this.queue = this.queue.filter((q) => q !== job);
          job.reject(new RuntimeError({ kind: "abort", message: "Aborted" }));
          // A running job cannot be interrupted inside Python; its result is discarded.
        };
        opts.signal.addEventListener("abort", job.onAbort, { once: true });
      }
      this.queue.push(job);
      this.pump();
    });
  }

  private pump() {
    if (this.active || !this.worker) return;
    const job = this.queue.shift();
    if (!job) return;
    job.started = true;
    this.active = job;
    const msg: ToWorker = { type: "call", id: job.id, module: job.module, fn: job.fn, argsJson: job.argsJson };
    this.worker.postMessage(msg);
  }

  private onMessage(m: FromWorker) {
    if (m.type === "status") {
      const s = { ...this.status, ...m.status, elapsedMs: m.status.elapsedMs ?? performance.now() - this.startedAt } as RuntimeStatus;
      this.setStatus(s);
      if (s.state === "ready") {
        if (this.timer) window.clearInterval(this.timer);
        this.warmResolve?.();
      } else if (s.state === "error") {
        this.fail(s.error ?? { kind: "runtime", message: "Runtime failed" });
      }
      return;
    }
    const job = this.active;
    this.active = null;
    if (job && job.id === m.id) {
      if (job.signal && job.onAbort) job.signal.removeEventListener("abort", job.onAbort);
      this.lastCallMs = m.ms;
      if (!job.signal?.aborted) {
        if (m.ok) {
          try {
            job.resolve(JSON.parse(m.json));
          } catch (e) {
            job.reject(new RuntimeError({ kind: "runtime", message: `Invalid JSON from Python: ${String(e)}` }));
          }
        } else {
          job.reject(new RuntimeError(m.error));
        }
      }
    }
    this.pump();
  }

  private fail(info: RuntimeErrorInfo) {
    if (this.timer) window.clearInterval(this.timer);
    this.setStatus({ ...this.status, state: "error", stage: "Failed to start Python runtime", error: info });
    this.warmReject?.(new RuntimeError(info));
    const pending = [...this.queue, ...(this.active ? [this.active] : [])];
    this.queue = [];
    this.active = null;
    pending.forEach((j) => j.reject(new RuntimeError(info)));
  }

  /** Terminate the worker and reset (e.g. to retry after a load failure). */
  reset() {
    this.worker?.terminate();
    this.worker = null;
    this.warm = null;
    this.active = null;
    this.queue.forEach((j) => j.reject(new RuntimeError({ kind: "abort", message: "Runtime reset" })));
    this.queue = [];
    if (this.timer) window.clearInterval(this.timer);
    this.setStatus(IDLE);
  }
}

let singleton: Runtime | null = null;

export function getRuntime(): Runtime {
  if (!singleton) singleton = new Runtime();
  return singleton;
}

export type { Runtime };

/** True if an error is a cancellation (abort / superseded) rather than a failure. */
export function isAbort(e: unknown): boolean {
  return e instanceof RuntimeError && e.info.kind === "abort";
}
