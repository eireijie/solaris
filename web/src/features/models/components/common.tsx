/** Shared building blocks for the workbenches. */
import { useState } from "react";
import type { ReactNode } from "react";
import { Button, Callout, IconCheck, IconDownload, Spinner } from "../../../components/ui";
import { downloadText } from "../../../data";
import { PYODIDE_PACKAGES, useRuntimeStatus } from "../../../runtime";
import { MODEL_INFO } from "../modelInfo";
import type { ModelKey } from "../types";
import { msLabel } from "../lib/fmt";
import type { RunError, RunSource } from "../lib/useWorkbenchRun";
import { RuntimeStatusPill } from "../RuntimeStatusPill";

/* ---------------- header ---------------- */

const HEAD: Record<ModelKey, { title: string; sub: string; origin: string }> = {
  aeros: { title: "Seasonal temperature projection", sub: "Projects a station’s winter and summer mean temperature to 2100 from its own record.", origin: "From the research notebook" },
  core: { title: "Global CO₂ projection", sub: "Continues the observed CO₂ record to 2100 and converts it to radiative forcing.", origin: "From the research notebook" },
  catalyst: { title: "Emissions scenarios", sub: "Change an emissions pathway and compare the outcome with the baseline.", origin: "New, simplified model" },
  nexus: { title: "Hindcast check", sub: "Trains Aeros on the past only, then scores it against what actually happened.", origin: "New, simplified model" },
};

export function WorkbenchHeader({ model, compact, children }: { model: ModelKey; compact?: boolean; title?: ReactNode; children?: ReactNode }) {
  const info = MODEL_INFO[model];
  const head = HEAD[model];
  return (
    <header className="wb-head">
      <div className="wb-head__text">
        <p className="wb-head__kicker">
          {info.name} {info.version} · {head.origin}
        </p>
        <h2 className={`wb-head__title ${compact ? "is-compact" : ""}`}>{head.title}</h2>
        <p className="wb-head__summary">{head.sub}</p>
      </div>
      <span className="wb-head__pill">
        <RuntimeStatusPill />
      </span>
      {children}
    </header>
  );
}

/* ---------------- run status line ---------------- */

const LOAD_STAGES = [{ label: "Download Python runtime (Pyodide)" }, { label: `Load ${PYODIDE_PACKAGES.join(" + ")}` }, { label: "Install Solaris models" }];

export function RunStatus({
  running,
  coldStart,
  source,
  error,
  onRetry,
  idleHint,
}: {
  running: boolean;
  coldStart?: boolean;
  source: RunSource | null;
  error: RunError | null;
  onRetry?: () => void;
  idleHint?: string;
}) {
  const status = useRuntimeStatus();
  if (error) {
    return (
      <div className="wb-status wb-status--error" data-testid="run-error">
        <Callout tone="danger" title={error.kind === "model" ? "The model could not run with this input" : error.kind === "python" ? "Python error" : "The in-browser runtime failed"}>
          <p className="wb-status__msg sol-mono">{error.message}</p>
          {error.traceback ? (
            <details className="wb-trace">
              <summary>Full traceback</summary>
              <pre>{error.traceback}</pre>
            </details>
          ) : null}
          {onRetry ? (
            <div className="wb-status__actions">
              <Button size="sm" variant="secondary" onClick={onRetry}>
                Retry
              </Button>
              <span className="sol-muted">The previous result (if any) is still shown below.</span>
            </div>
          ) : null}
        </Callout>
      </div>
    );
  }
  if (running && (coldStart || status.state === "loading") && status.state !== "ready") {
    return (
      <p className="wb-status wb-status--line is-running" role="status" data-testid="run-loading">
        <Spinner size={16} label="" /> Starting Python in your browser (first run only, about 10 seconds). {LOAD_STAGES[Math.min(status.state === "loading" || status.state === "idle" ? status.step : 2, 2)]?.label ?? ""}…
      </p>
    );
  }
  if (running) {
    return (
      <p className="wb-status wb-status--line is-running" role="status" data-testid="run-running">
        <Spinner size={16} label="" /> Running in your browser…
      </p>
    );
  }
  if (!source) return idleHint ? <p className="wb-status wb-status--line sol-muted">{idleHint}</p> : null;
  if (source.kind === "precomputed") {
    return (
      <p className="wb-status wb-status--line" data-testid="source-precomputed" data-source="precomputed">
        <span className="sol-muted">Saved result for the default settings. Change a setting to run the model in your browser.</span>
      </p>
    );
  }
  if (source.kind === "saved") {
    return (
      <p className="wb-status wb-status--line" data-testid="source-saved" data-source="saved">
        <span className="sol-muted">Saved run: {source.label}. Shown as saved, not re-run.</span>
      </p>
    );
  }
  return (
    <p className="wb-status wb-status--line" data-testid="source-live" data-source="live" data-ms={Math.round(source.ms)}>
      <span className="wb-status__ok">
        <IconCheck size={14} /> Computed in your browser
      </span>
      <span className="sol-muted">
        {source.coldStart ? (
          <>
            {msLabel(source.wallMs)}, including Python start-up
          </>
        ) : (
          <>
            {msLabel(source.ms)}
          </>
        )}
      </span>
    </p>
  );
}

/* ---------------- disclosure ---------------- */

export function Disclosure({ summary, children, defaultOpen, testId }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; testId?: string }) {
  return (
    <details className="wb-disclosure" open={defaultOpen} data-testid={testId}>
      <summary>
        <span>{summary}</span>
      </summary>
      <div className="wb-disclosure__body">{children}</div>
    </details>
  );
}

/* ---------------- warnings ---------------- */

export function Warnings({ warnings, title = "Notes from the model" }: { warnings: string[] | undefined; title?: string }) {
  if (!warnings?.length) return null;
  return (
    <Disclosure summary={`${title} (${warnings.length})`}>
      <ul className="wb-list">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </Disclosure>
  );
}

/* ---------------- export bar ---------------- */

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function ExportBar({
  csv,
  json,
  citation,
  onSave,
  disabled,
}: {
  csv?: () => { filename: string; text: string };
  json?: () => { filename: string; data: unknown };
  citation?: () => string;
  onSave?: () => void;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <div className="wb-export" role="group" aria-label="Export">
      {csv ? (
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<IconDownload size={16} />}
          disabled={disabled}
          onClick={() => {
            const { filename, text } = csv();
            downloadText(filename, text);
          }}
        >
          Download CSV
        </Button>
      ) : null}
      {json ? (
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<IconDownload size={16} />}
          disabled={disabled}
          onClick={() => {
            const { filename, data } = json();
            downloadText(filename, JSON.stringify(data, null, 1), "application/json");
          }}
        >
          JSON
        </Button>
      ) : null}
      {citation ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={async () => {
            if (await copyText(citation())) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }
          }}
        >
          {copied ? "Copied" : "Copy citation"}
        </Button>
      ) : null}
      {onSave ? (
        <Button
          size="sm"
          variant="primary"
          disabled={disabled}
          onClick={() => {
            onSave();
            setSaved(true);
            window.setTimeout(() => setSaved(false), 2000);
          }}
        >
          {saved ? "Sent to project" : "Save to project"}
        </Button>
      ) : null}
      <span className="wb-export__note sol-muted" aria-live="polite">
        {copied ? "Citation copied to clipboard." : ""}
      </span>
    </div>
  );
}

/* ---------------- key-value table ---------------- */

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="wb-kv">
      {rows.map(([k, v], i) => (
        <div key={i} className="wb-kv__row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Horizontal weight bar (0..1). */
export function WeightBar({ value, label }: { value: number; label: string }) {
  const w = Math.max(0, Math.min(1, value));
  return (
    <span className="wb-bar" role="img" aria-label={`${label}: ${(w * 100).toFixed(0)}%`}>
      <span className="wb-bar__fill" style={{ width: `${w * 100}%` }} />
    </span>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="wb-section-title">
      <h3>{children}</h3>
      {aside ? <div>{aside}</div> : null}
    </div>
  );
}

/** Today's date for citations. */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

export const TEAM_CREDIT = "Solaris research project — Jeff Minsona Leba, Yug Patel (Academy of Health Sciences at Prince George's Community College); mentor Kurt Lienau";
