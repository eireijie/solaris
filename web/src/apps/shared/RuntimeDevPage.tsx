/**
 * Hidden dev page (#/dev/runtime): proves the Pyodide runtime end to end.
 * 1. warmup (cold-load timing per stage)
 * 2. _selftest.run (numpy + scipy + JSON bridge)
 * 3. _selftest.fail (Python traceback propagation)
 * 4. solaris_models.api.dispatch for each model, if importable (payload from the
 *    textarea; the default is a minimal guess — check models/API.md).
 * scripts/smoke.mjs waits for [data-selftest="pass"].
 */
import { useEffect, useState } from "react";
import { Badge, Button, Callout, Card, RunProgress, SegmentedControl } from "../../components/ui";
import { getRuntime, PYODIDE_BASE_URL, PYODIDE_PACKAGES, RuntimeError, useRuntimeStatus } from "../../runtime";
import type { ModelName } from "../../runtime";
import { loadStationsBundle } from "../../data";
import { fmtMs } from "../../lib/format";

type Check = { name: string; ok: boolean | null; detail: string; ms?: number };

const MODELS: ModelName[] = ["aeros", "core", "catalyst", "nexus"];

export default function RuntimeDevPage() {
  const status = useRuntimeStatus({ warm: true });
  const [checks, setChecks] = useState<Check[]>([]);
  const [selftest, setSelftest] = useState<"pending" | "pass" | "fail">("pending");
  const [model, setModel] = useState<ModelName>("aeros");
  const [payload, setPayload] = useState("{}");
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rt = getRuntime();
      const results: Check[] = [];
      const push = (c: Check) => {
        results.push(c);
        if (!cancelled) setChecks([...results]);
      };
      try {
        await rt.warmup();
        const t0 = performance.now();
        const r = await rt.call<Record<string, unknown>>("_selftest", "run", [{ seed: 7, n: 60 }]);
        const ok = r.ok === true && r.nan_becomes_null === null && Array.isArray(r.series_head) && typeof r.curve_fit_slope_per_decade === "number";
        push({ name: "numpy + scipy self-test", ok, detail: JSON.stringify(r), ms: performance.now() - t0 });
        try {
          await rt.call("_selftest", "fail", [{ reason: "traceback check" }]);
          push({ name: "Python error propagation", ok: false, detail: "expected an exception" });
        } catch (e) {
          const tb = e instanceof RuntimeError ? e.info.traceback ?? "" : "";
          push({ name: "Python error propagation", ok: /ValueError: Self-test error/.test(tb), detail: e instanceof Error ? e.message : String(e) });
        }
        if (!cancelled) setSelftest(results.every((c) => c.ok) ? "pass" : "fail");
      } catch (e) {
        push({ name: "Runtime load", ok: false, detail: e instanceof Error ? e.message : String(e) });
        if (!cancelled) setSelftest("fail");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Default payload: first bundled station, if the bundle exists.
  useEffect(() => {
    loadStationsBundle()
      .then((b) => {
        const s = b.stations[0];
        if (model === "aeros" && s) {
          setPayload(
            JSON.stringify(
              { station: { id: s.id, name: s.display_name, lat: s.lat, lon: s.lon, hemisphere: s.hemisphere }, years: s.series.years, "D-J-F": s.series["D-J-F"], "J-J-A": s.series["J-J-A"] },
              null,
              0,
            ),
          );
        } else setPayload("{}");
      })
      .catch(() => setPayload("{}"));
  }, [model]);

  const runDispatch = async () => {
    setBusy(true);
    setOut("");
    try {
      const payloadObj = JSON.parse(payload || "{}");
      const t0 = performance.now();
      const r = await getRuntime().run(model, payloadObj);
      setOut(`OK in ${fmtMs(performance.now() - t0)} (worker ${fmtMs(getRuntime().lastCallMs)})\n\n${JSON.stringify(r, null, 2).slice(0, 20000)}`);
    } catch (e) {
      setOut(e instanceof RuntimeError ? `${e.message}\n\n${e.info.traceback ?? ""}` : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sol-container sol-section" style={{ display: "grid", gap: 24 }}>
      <header style={{ display: "grid", gap: 12 }}>
        <p className="sol-eyebrow">Developer</p>
        <h1 style={{ fontSize: "var(--sol-text-3xl)" }}>Model runtime self-test</h1>
        <p className="sol-muted">
          Pyodide from <code className="sol-mono">{PYODIDE_BASE_URL}</code> · packages {PYODIDE_PACKAGES.join(", ")}
        </p>
      </header>

      {status.state === "loading" || status.state === "idle" ? (
        <RunProgress
          title="Loading Python runtime"
          stages={[{ label: "Download Python runtime" }, { label: `Load ${PYODIDE_PACKAGES.join(" + ")}` }, { label: "Install Solaris models" }]}
          current={status.step}
          elapsedMs={status.elapsedMs}
        />
      ) : null}
      {status.state === "error" ? (
        <Callout tone="danger" title={status.stage}>
          {status.error?.message}
        </Callout>
      ) : null}
      {status.state === "ready" ? (
        <Card>
          <div className="sol-row" style={{ justifyContent: "space-between" }}>
            <strong>
              Cold load: <span className="sol-mono" data-testid="cold-load-ms">{Math.round(status.elapsedMs)}</span> ms
            </strong>
            <Badge tone={status.modelsAvailable ? "success" : "warning"}>
              {status.modelsAvailable ? "solaris_models.api importable" : "solaris_models not importable"}
            </Badge>
          </div>
          <p className="sol-muted sol-mono" style={{ fontSize: 12, marginTop: 8 }} data-testid="timings">
            {Object.entries(status.timings ?? {})
              .map(([k, v]) => `${k}: ${fmtMs(v)}`)
              .join(" · ")}{" "}
            · packages: {JSON.stringify(status.packages)}
          </p>
          {status.modelsError ? (
            <details style={{ marginTop: 8 }}>
              <summary className="sol-muted">Import error</summary>
              <pre className="sol-mono" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
                {status.modelsError}
              </pre>
            </details>
          ) : null}
        </Card>
      ) : null}

      <section data-selftest={selftest} style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "var(--sol-text-xl)" }}>
          Checks <Badge tone={selftest === "pass" ? "success" : selftest === "fail" ? "danger" : "neutral"}>{selftest}</Badge>
        </h2>
        {checks.map((c) => (
          <Callout key={c.name} tone={c.ok ? "success" : "danger"} title={`${c.name}${c.ms ? ` — ${fmtMs(c.ms)}` : ""}`} compact>
            <pre>{c.detail}</pre>
          </Callout>
        ))}
      </section>

      <Card>
        <div style={{ display: "grid", gap: 12 }}>
          <h2 style={{ fontSize: "var(--sol-text-xl)" }}>solaris_models.api.dispatch</h2>
          <SegmentedControl label="Model" options={MODELS.map((m) => ({ value: m, label: m }))} value={model} onChange={setModel} />
          <label className="sol-field">
            <span className="sol-field__label">Payload (JSON) — see models/API.md for the schema</span>
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={5}
              className="sol-mono"
              style={{ width: "100%", padding: 12, background: "var(--sol-surface-2)", border: "1px solid var(--sol-line-strong)", borderRadius: 6, fontSize: 12 }}
            />
          </label>
          <div>
            <Button onClick={runDispatch} loading={busy} disabled={status.state !== "ready" || !status.modelsAvailable}>
              Run dispatch("{model}")
            </Button>
          </div>
          {out ? (
            <pre data-testid="dispatch-output" className="sol-mono" style={{ maxHeight: 420, overflow: "auto", fontSize: 11, whiteSpace: "pre-wrap", padding: 12, background: "rgba(0,0,0,.35)", borderRadius: 6 }}>
              {out}
            </pre>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
