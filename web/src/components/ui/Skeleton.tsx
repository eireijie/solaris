import type { CSSProperties } from "react";

/** Shimmering placeholder block. */
export function Skeleton({
  width = "100%",
  height = 16,
  radius,
  className = "",
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={`sol-skeleton ${className}`}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** Small circular spinner. `label` is announced to screen readers (empty string = decorative). */
export function Spinner({ size = 20, label = "Loading" }: { size?: number; label?: string }) {
  return (
    <span className="sol-spinner" style={{ width: size, height: size }} role={label ? "status" : undefined}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
        <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {label ? <span className="sol-visually-hidden">{label}</span> : null}
    </span>
  );
}

export type RunStage = { label: string; detail?: string };

/**
 * "Model running" state: an orbiting sun mark plus a list of semantic stages.
 * Honest by design: no fake percentages; stages before `current` are done,
 * `current` is active. Pass `elapsedMs` to show a timer.
 */
export function RunProgress({
  title = "Running model",
  stages,
  current,
  elapsedMs,
  note,
  compact = false,
}: {
  title?: string;
  stages: RunStage[];
  current: number;
  elapsedMs?: number;
  note?: string;
  compact?: boolean;
}) {
  return (
    <div className={`sol-run ${compact ? "sol-run--compact" : ""}`} role="status" aria-live="polite">
      <div className="sol-run__head">
        <span className="sol-run__orbit" aria-hidden="true">
          <span className="sol-run__sun" />
          <span className="sol-run__planet" />
        </span>
        <div>
          <p className="sol-run__title">{title}</p>
          {elapsedMs != null && <p className="sol-run__time sol-mono">{(elapsedMs / 1000).toFixed(1)} s</p>}
        </div>
      </div>
      <ol className="sol-run__stages">
        {stages.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={s.label} className={`sol-run__stage is-${state}`}>
              <span className="sol-run__dot" aria-hidden="true" />
              <span>
                {s.label}
                <span className="sol-visually-hidden">
                  {state === "done" ? " (done)" : state === "active" ? " (in progress)" : " (pending)"}
                </span>
                {s.detail && state === "active" ? <small>{s.detail}</small> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {note ? <p className="sol-run__note">{note}</p> : null}
    </div>
  );
}
