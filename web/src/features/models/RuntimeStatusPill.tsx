/** Small Python-runtime status indicator: idle / loading step / ready / error + retry. */
import type { JSX } from "react";
import { getRuntime, useRuntimeStatus } from "../../runtime";
import { msLabel } from "./lib/fmt";
import "./models.css";

export function RuntimeStatusPill(): JSX.Element {
  const s = useRuntimeStatus();
  const rt = getRuntime();
  if (s.state === "ready") {
    const ok = s.modelsAvailable !== false;
    return (
      <span
        className={`wb-pill ${ok ? "is-ready" : "is-error"}`}
        role="status"
        title={ok ? `Python loaded in ${msLabel(s.elapsedMs)}` : s.modelsError}
        data-testid="runtime-pill"
        data-state="ready"
      >
        <span className="wb-pill__dot" aria-hidden="true" />
        {ok ? "Python ready" : "Models unavailable"}
        {ok ? <span className="wb-pill__meta sol-mono">{msLabel(s.elapsedMs)}</span> : null}
      </span>
    );
  }
  if (s.state === "loading") {
    return (
      <span className="wb-pill is-loading" role="status" aria-live="polite" title={s.stage} data-testid="runtime-pill" data-state="loading">
        <span className="wb-pill__dot" aria-hidden="true" />
        Loading Python
        <span className="wb-pill__meta sol-mono">
          {Math.min(s.step + 1, s.steps)}/{s.steps}
        </span>
        <span className="sol-visually-hidden">: {s.stage}</span>
      </span>
    );
  }
  if (s.state === "error") {
    return (
      <button
        type="button"
        className="wb-pill is-error"
        title={s.error?.message}
        onClick={() => {
          rt.reset();
          void rt.warmup();
        }}
        data-testid="runtime-pill"
        data-state="error"
      >
        <span className="wb-pill__dot" aria-hidden="true" />
        Python failed · Retry
      </button>
    );
  }
  return (
    <button
      type="button"
      className="wb-pill is-idle"
      title="Load the Python runtime now (downloaded once, then cached by the browser)"
      onClick={() => void rt.warmup()}
      data-testid="runtime-pill"
      data-state="idle"
    >
      <span className="wb-pill__dot" aria-hidden="true" />
      Python not loaded
    </button>
  );
}
