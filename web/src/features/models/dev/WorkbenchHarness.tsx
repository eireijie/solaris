/**
 * Route-free harness for the workbenches (web/workbench.html).
 *   ?compact=1         compact layout
 *   ?only=aeros,core   subset
 *   ?restore=1         also mounts an Aeros workbench restored from the last saved run
 * Logs onRunComplete / onSaveRequest payloads to a panel (and window.__wbEvents for tests).
 */
import { useState } from "react";
import type { JSX } from "react";
import { AerosWorkbench, CatalystWorkbench, CoreWorkbench, DatasetLibrary, MODEL_INFO, NexusWorkbench, RuntimeStatusPill } from "../index";
import type { SavedRun } from "../index";

declare global {
  interface Window {
    __wbEvents?: { type: string; model: string; label: string; payloadBytes: number; at: number }[];
  }
}

const params = new URLSearchParams(window.location.search);
const compact = params.get("compact") === "1";
const only = (params.get("only") ?? "").split(",").filter(Boolean);
const show = (k: string) => !only.length || only.includes(k);

export function WorkbenchHarness(): JSX.Element {
  const [events, setEvents] = useState<{ type: string; run: SavedRun; bytes: number }[]>([]);
  const [saved, setSaved] = useState<SavedRun | null>(null);
  const log = (type: string) => (run: SavedRun) => {
    const bytes = JSON.stringify(run.payload ?? null).length;
    window.__wbEvents = [...(window.__wbEvents ?? []), { type, model: run.model, label: run.label, payloadBytes: bytes, at: Date.now() }];
    setEvents((e) => [{ type, run, bytes }, ...e].slice(0, 8));
    if (type === "save") setSaved(run);
  };
  const props = { compact, onRunComplete: log("complete"), onSaveRequest: log("save") };
  const width = compact ? "min(100%, 720px)" : "min(100%, 1320px)";

  return (
    <main className="sol-page" style={{ padding: "24px var(--sol-gutter) 96px", display: "grid", gap: 40, justifyItems: "center" }}>
      <header style={{ width, display: "grid", gap: 8 }}>
        <p className="sol-eyebrow">Workbench harness{compact ? " · compact" : ""}</p>
        <div className="sol-row" style={{ justifyContent: "space-between" }}>
          <h1 style={{ fontSize: "var(--sol-text-2xl)", fontFamily: "var(--sol-font-display)", fontWeight: 400 }}>Solaris model workbenches</h1>
          <RuntimeStatusPill />
        </div>
        <p className="sol-muted" style={{ fontSize: 14 }}>
          {Object.values(MODEL_INFO)
            .map((m) => `${m.name} ${m.version} (${m.status})`)
            .join(" · ")}{" "}
          — <a href={compact ? "?" : "?compact=1"} style={{ color: "var(--sol-solar)" }}>{compact ? "full layout" : "compact layout"}</a>
        </p>
      </header>
      {show("aeros") ? (
        <div style={{ width }} id="aeros">
          <AerosWorkbench {...props} />
        </div>
      ) : null}
      {saved && saved.model === "aeros" ? (
        <div style={{ width }} id="aeros-restored" data-testid="restored">
          <p className="sol-eyebrow" style={{ marginBottom: 12 }}>Restored from saved run (no re-run)</p>
          <AerosWorkbench compact initialRun={saved} />
        </div>
      ) : null}
      {show("nexus") ? (
        <div style={{ width }} id="nexus">
          <NexusWorkbench {...props} />
        </div>
      ) : null}
      {show("core") ? (
        <div style={{ width }} id="core">
          <CoreWorkbench {...props} />
        </div>
      ) : null}
      {show("catalyst") ? (
        <div style={{ width }} id="catalyst">
          <CatalystWorkbench {...props} />
        </div>
      ) : null}
      {show("library") ? (
        <div style={{ width }} id="library">
          <DatasetLibrary compact={compact} />
        </div>
      ) : null}
      <section style={{ width }} aria-label="Event log" data-testid="event-log">
        <p className="sol-eyebrow">onRunComplete / onSaveRequest</p>
        <ul style={{ fontSize: 12, fontFamily: "var(--sol-font-mono)", color: "var(--sol-text-3)", display: "grid", gap: 4, marginTop: 8 }}>
          {events.length ? null : <li>No events yet.</li>}
          {events.map((e, i) => (
            <li key={i}>
              {e.type} · {e.run.model} · {e.run.label} · payload {e.bytes} B
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
