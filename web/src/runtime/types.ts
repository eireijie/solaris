/** Shared types for the Python-in-browser runtime. */

export type ModelName = "aeros" | "core" | "catalyst" | "nexus";

export type RuntimeState = "idle" | "loading" | "ready" | "error";

export type RuntimeStatus = {
  state: RuntimeState;
  /** Human-readable current stage, e.g. "Loading numpy + scipy". */
  stage: string;
  /** Stage index (0-based) and total — semantic stages, not a fake percentage. */
  step: number;
  steps: number;
  /** ms since warmup() started; final load time once ready. */
  elapsedMs: number;
  /** Set when state === "error". */
  error?: RuntimeErrorInfo;
  /** Packages installed from public/py/manifest.json, with file counts. */
  packages?: Record<string, number>;
  /** Per-stage timings (ms), filled in as stages complete. */
  timings?: Record<string, number>;
  /** True when solaris_models.api imported successfully. */
  modelsAvailable?: boolean;
  /** Import error text if solaris_models could not be imported. */
  modelsError?: string;
};

export type RuntimeErrorInfo = {
  /** Short message (last line of the Python traceback, or JS error message). */
  message: string;
  /** Full Python traceback when available. */
  traceback?: string;
  /** "python" for exceptions raised by model code, "runtime" for loading problems, "abort" for cancelled runs. */
  kind: "python" | "runtime" | "abort";
};

/** Every model result includes these (CONTRACT.md). Model-specific fields are added by each model. */
export type ModelResultBase = {
  model: ModelName | string;
  version: string;
  inputs: Record<string, unknown>;
  warnings: string[];
  provenance: Record<string, unknown> | unknown[];
  runtime_ms: number;
};

export type RunOptions = {
  /** Abort: rejects immediately; a queued job is dropped, a running job's result is discarded. */
  signal?: AbortSignal;
  /**
   * Coalescing key for slider-driven UIs: when a new job with the same key is
   * queued, older *queued* (not yet started) jobs with that key are cancelled.
   */
  latest?: string;
};

/* ---------------- worker protocol ---------------- */

export type ToWorker =
  | { type: "init"; rootUrl: string; pyodideBase: string; packages: string[]; manifestPath: string }
  | { type: "call"; id: number; module: string; fn: string; argsJson: string };

export type FromWorker =
  | { type: "status"; status: Omit<RuntimeStatus, "elapsedMs"> & { elapsedMs?: number } }
  | { type: "result"; id: number; ok: true; json: string; ms: number }
  | { type: "result"; id: number; ok: false; error: RuntimeErrorInfo; ms: number };
