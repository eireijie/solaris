/** Shared building blocks for the workbenches. */
import { useState } from "react";
import type { ReactNode } from "react";
import { Badge, Button, Callout, IconCheck, IconDownload, ModelBadge, RunProgress, Spinner } from "../../../components/ui";
import { downloadText } from "../../../data";
import { PYODIDE_PACKAGES, useRuntimeStatus } from "../../../runtime";
import { MODEL_INFO } from "../modelInfo";
import type { ModelKey } from "../types";
import { msLabel } from "../lib/fmt";
import type { RunError, RunSource } from "../lib/useWorkbenchRun";
import { RuntimeStatusPill } from "../RuntimeStatusPill";

/* ---------------- header ---------------- */

export function WorkbenchHeader({ model, compact, title, children }: { model: ModelKey; compact?: boolean; title?: ReactNode; children?: ReactNode }) {
  const info = MODEL_INFO[model];
  return (
    <header className="wb-head">
      <div className="wb-head__badges">
        <ModelBadge model={model} />
        {info.status === "new" ? <Badge tone="new">New</Badge> : <Badge tone="neutral">Ported from the team notebook</Badge>}
        {model === "catalyst" || model === "nexus" ? <Badge tone="info">Simplified model</Badge> : null}
        <span className="wb-head__pill">
          <RuntimeStatusPill />
        </span>
      </div>
      <h2 className={`wb-head__title ${compact ? "is-compact" : ""}`}>{title ?? info.tagline}</h2>
      {!compact ? <p className="wb-head__summary">{info.summary}</p> : null}
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
      <div className="wb-status" data-testid="run-loading">
        <RunProgress
          compact
          title="Loading Python in your browser (first run only)"
          stages={[...LOAD_STAGES, { label: "Run the model" }]}
          current={status.state === "loading" || status.state === "idle" ? status.step : 3}
          elapsedMs={status.elapsedMs}
          note="Runs locally on this device: nothing is sent to a server. Later runs take well under a second."
        />
      </div>
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
        <Badge tone="neutral">Precomputed default result</Badge>
        <span className="sol-muted">Same model and settings, computed ahead of time. Change any setting to recompute live in your browser.</span>
      </p>
    );
  }
  if (source.kind === "saved") {
    return (
      <p className="wb-status wb-status--line" data-testid="source-saved" data-source="saved">
        <Badge tone="info">Saved run</Badge>
        <span className="sol-muted">{source.label} — shown as saved, not re-run.</span>
      </p>
    );
  }
  return (
    <p className="wb-status wb-status--line" data-testid="source-live" data-source="live" data-ms={Math.round(source.ms)}>
      <Badge tone="success">
        <IconCheck size={14} /> Computed live in your browser
      </Badge>
      <span className="sol-muted">
        just now ·{" "}
        {source.coldStart ? (
          <>
            first run, including Python start-up: <span className="sol-mono">{msLabel(source.wallMs)}</span>
          </>
        ) : (
          <>
            <span className="sol-mono">{msLabel(source.ms)}</span> in Python
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
    <Callout tone="warning" title={`${title} (${warnings.length})`} compact>
      <ul className="wb-list">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </Callout>
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
          CSV
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
          {copied ? "Copied" : "Copy citation & provenance"}
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
