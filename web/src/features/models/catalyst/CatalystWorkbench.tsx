/**
 * Catalyst 1.0 workbench (new, simplified) — what-if CO2 scenarios on CORe physics.
 * Sliders update the charts live (debounced, coalesced with the runtime's `latest` key).
 * Until Python is ready the precomputed CORe-vs-SSP comparison is shown.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Button, SegmentedControl, Select, Skeleton, Slider, Stat, Toggle } from "../../../components/ui";
import { TimeSeriesChart } from "../../../components/charts";
import type { TSSeries } from "../../../components/charts";
import { seriesToCsv } from "../../../data";
import { fetchPrecomputed, getRuntime, useRuntimeStatus } from "../../../runtime";
import type { CatalystPath, CatalystResult, CatalystValidation, CoreResult, Num } from "../results";
import type { WorkbenchProps } from "../types";
import { catalystData, SSP_LABELS, useCo2Bundle, usePrecomputed } from "../lib/bundles";
import { degC, fmt, isNum, ppm } from "../lib/fmt";
import { useNearView } from "../lib/useNearView";
import { useWorkbenchRun } from "../lib/useWorkbenchRun";
import { Disclosure, ExportBar, KV, RunStatus, TEAM_CREDIT, today, Warnings, WorkbenchHeader } from "../components/common";
import "../models.css";

type Mode = "emissions" | "concentration";
type Iv = { peakYear: number; decline: number; netZero: number; cutPct: number; cutYear: number; removal: number; removalStart: number };
type CatUi = { mode: Mode; baseline: string; scenarioSsp: string; iv: Iv; ecs: number; tempModel: "two_layer" | "core4"; nonCo2: boolean; endYear: number };

const NONE_PEAK = 2025;
const NONE_NZ = 2101;
const IV_OFF: Iv = { peakYear: NONE_PEAK, decline: 0, netZero: NONE_NZ, cutPct: 0, cutYear: 2030, removal: 0, removalStart: 2050 };

type Preset = { id: string; name: string; params: string; iv: Iv };
const PRESETS: Preset[] = [
  { id: "current", name: "Current trajectory", params: "no interventions (scenario = baseline)", iv: IV_OFF },
  { id: "nz2050", name: "Net zero 2050", params: "linear ramp to net-zero CO₂ in 2050", iv: { ...IV_OFF, netZero: 2050 } },
  { id: "nz2070", name: "Net zero 2070", params: "linear ramp to net-zero CO₂ in 2070", iv: { ...IV_OFF, netZero: 2070 } },
  { id: "delayed", name: "Delayed action", params: "emissions may rise until 2040, then ramp to net zero by 2080", iv: { ...IV_OFF, peakYear: 2040, netZero: 2080 } },
  { id: "paris", name: "Paris-style 43% cut by 2030", params: "43% below 2019 by 2030, net zero by 2050", iv: { ...IV_OFF, cutPct: 43, cutYear: 2030, netZero: 2050 } },
];

const DEFAULT_UI: CatUi = { mode: "emissions", baseline: "core", scenarioSsp: "ssp126", iv: PRESETS[1].iv, ecs: 3, tempModel: "two_layer", nonCo2: false, endYear: 2100 };
const PRECOMPUTED_SSPS = ["ssp119", "ssp126", "ssp245", "ssp370", "ssp585"];
const ALL_SSPS = ["ssp119", "ssp126", "ssp245", "ssp370", "ssp434", "ssp460", "ssp585"];

function sameIv(a: Iv, b: Iv) {
  return (Object.keys(a) as (keyof Iv)[]).every((k) => a[k] === b[k] || ((k === "cutYear" && a.cutPct === 0 && b.cutPct === 0) || (k === "removalStart" && a.removal === 0 && b.removal === 0)));
}

function precomputedKey(u: CatUi): string | null {
  if (u.mode !== "concentration" || u.baseline !== "core" || !PRECOMPUTED_SSPS.includes(u.scenarioSsp)) return null;
  if (u.ecs !== 3 || u.tempModel !== "two_layer" || u.nonCo2 || u.endYear !== 2100) return null;
  return `concentration_${u.scenarioSsp}`;
}

function buildPayload(u: CatUi): Record<string, unknown> {
  const p: Record<string, unknown> = {
    mode: u.mode,
    end_year: u.endYear,
    ecs: u.ecs,
    temperature_model: u.tempModel,
    non_co2_forcing: u.nonCo2 ? "scenario" : "none",
    baseline: u.baseline === "core" ? { type: "core" } : { type: "ssp", scenario: u.baseline },
  };
  if (u.mode === "concentration") {
    p.scenario = { type: "ssp", scenario: u.scenarioSsp };
  } else {
    const iv: Record<string, unknown> = {};
    if (u.iv.peakYear > NONE_PEAK) iv.peak_year = u.iv.peakYear;
    if (u.iv.decline > 0) iv.decline_rate_pct = u.iv.decline;
    if (u.iv.cutPct > 0) iv.target_cut = { pct: u.iv.cutPct, year: u.iv.cutYear, reference_year: 2019 };
    if (u.iv.netZero < NONE_NZ) iv.net_zero_year = u.iv.netZero;
    if (u.iv.removal > 0) iv.removal = { gtco2_per_yr: u.iv.removal, start_year: u.iv.removalStart, ramp_years: 10 };
    p.interventions = iv;
  }
  return p;
}

type CatSavedPayload = { ui: CatUi; payload: Record<string, unknown>; data: "co2_bundle (rcmip, historical_co2, noaa_global_annual)"; core_pathway: "CORe 4.0 default projection" | null };

type Q = "temp" | "ppm" | "emissions" | "forcing";
const Q_META: Record<Q, { label: string; unit: string; digits: number }> = {
  temp: { label: "Temperature", unit: "°C", digits: 2 },
  ppm: { label: "CO₂ concentration", unit: "ppm", digits: 1 },
  emissions: { label: "CO₂ emissions", unit: "GtCO₂/yr", digits: 1 },
  forcing: { label: "Radiative forcing", unit: "W/m²", digits: 2 },
};

function pathData(years: number[], v: Num[], band?: { lower: Num[]; upper: Num[] }) {
  return years.map((x, i) => ({ x, y: v[i] ?? null, lower: band?.lower[i] ?? undefined, upper: band?.upper[i] ?? undefined }));
}

function chartSeries(r: CatalystResult, q: Q): TSSeries[] {
  const y = r.years;
  const pick = (p: CatalystPath) =>
    q === "temp" ? p.temperature_c : q === "ppm" ? p.ppm : q === "emissions" ? p.emissions_gtco2 : p.forcing_wm2;
  const band = (p: CatalystPath) => (q === "temp" ? p.temperature_band_c?.likely : q === "ppm" ? p.ppm_band?.likely : undefined);
  const s: TSSeries[] = [];
  if (r.history && (q === "ppm" || q === "emissions")) {
    const hv = q === "ppm" ? r.history.ppm_observed : r.history.emissions_gtco2;
    s.push({ id: "hist", label: q === "ppm" ? "Observed CO₂ (CORe input)" : "Historical emissions (RCMIP)", role: "observed", type: "line", data: r.history.years.map((x, i) => ({ x, y: hv[i] ?? null })).filter((d) => d.x >= 1980) });
  }
  if (r.reference_state && q === "temp") {
    s.push({ id: "ref", label: `${r.reference_state.year} starting state`, role: "observed", type: "points", data: [{ x: r.reference_state.year, y: r.reference_state.temperature_c }] });
  }
  const bb = band(r.baseline);
  s.push({
    id: "base",
    label: "Baseline",
    role: "other",
    color: "var(--sol-data-2)",
    data: pathData(y, pick(r.baseline), bb),
    bandLabel: bb ? `ECS ${bb.ecs[0]}–${bb.ecs[1]} °C` : undefined,
  });
  const sb = band(r.scenario);
  s.push({
    id: "scen",
    label: "Scenario",
    role: "projection",
    data: pathData(y, pick(r.scenario), sb),
    bandLabel: sb ? `ECS ${sb.ecs[0]}–${sb.ecs[1]} °C` : undefined,
  });
  return s;
}

function Delta({ v, unit, d = 2, testId }: { v: Num; unit: string; d?: number; testId?: string }) {
  if (!isNum(v)) return <span>—</span>;
  const cls = Math.abs(v) < 0.5 * 10 ** -d ? "" : v < 0 ? "wb-delta-neg" : "wb-delta-pos";
  return (
    <span className={cls} data-testid={testId} data-value={v.toFixed(4)}>
      {v > 0 ? "+" : v < 0 ? "−" : "±"}
      {fmt(Math.abs(v), d)}
      <span className="sol-stat__unit"> {unit}</span>
    </span>
  );
}

export function CatalystWorkbench({ compact, initialRun, onRunComplete, onSaveRequest }: WorkbenchProps): JSX.Element {
  const uid = useId();
  const co2 = useCo2Bundle();
  const core = usePrecomputed<CoreResult>("core", "default");
  const validation = usePrecomputed<CatalystValidation>("catalyst", "validation");
  const status = useRuntimeStatus();
  const restored = (initialRun?.payload as CatSavedPayload | undefined)?.ui ?? null;
  const [ui, setUi] = useState<CatUi>(restored ?? DEFAULT_UI);
  const [q, setQ] = useState<Q>("temp");
  const [near, setNear] = useState(false);
  const wide: boolean = false;
  const runner = useWorkbenchRun<CatalystResult>("catalyst", `catalyst-${uid}`);
  const savedRef = useRef<CatSavedPayload | null>(initialRun ? (initialRun.payload as CatSavedPayload) : null);
  const rootRef = useNearView<HTMLElement>(() => {
    setNear(true);
    void getRuntime().warmup();
  });

  const uiKey = JSON.stringify(ui);
  const handled = useRef<string | null>(initialRun?.result ? uiKey : null);
  const placeholderShown = useRef(false);

  // Restore saved run.
  useEffect(() => {
    if (initialRun?.result) runner.show(initialRun.result as CatalystResult, { kind: "saved", label: initialRun.label });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRun]);

  // Instant first paint: precomputed SSP comparison while the model loads.
  useEffect(() => {
    if (initialRun?.result) return;
    let alive = true;
    const key = precomputedKey(ui) ?? "concentration_ssp245";
    void fetchPrecomputed<CatalystResult>("catalyst", key).then((pre) => {
      if (alive && pre && !placeholderShown.current && !runner.result) {
        placeholderShown.current = true;
        runner.show(pre, { kind: "precomputed" });
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dataReady = !!co2.data && !!core.data;
  useEffect(() => {
    if (handled.current === uiKey) return;
    const pk = precomputedKey(ui);
    let cancelled = false;
    let timer: number | undefined;
    if (pk) {
      handled.current = uiKey;
      void fetchPrecomputed<CatalystResult>("catalyst", pk).then((pre) => {
        if (!cancelled && pre) {
          savedRef.current = { ui, payload: buildPayload(ui), data: "co2_bundle (rcmip, historical_co2, noaa_global_annual)", core_pathway: "CORe 4.0 default projection" };
          runner.show(pre, { kind: "precomputed" });
        }
      });
    } else {
      if (!near || !dataReady) return;
      handled.current = uiKey;
      timer = window.setTimeout(async () => {
        const body = buildPayload(ui);
        const payload = {
          ...body,
          data: catalystData(co2.data!),
          core_pathway: { years: core.data!.projection.years, ppm: core.data!.projection.ppm_mean },
        };
        const r = await runner.run(payload);
        if (r && !cancelled) {
          savedRef.current = { ui, payload: body, data: "co2_bundle (rcmip, historical_co2, noaa_global_annual)", core_pathway: "CORe 4.0 default projection" };
          onRunComplete?.({ model: "catalyst", label: `Catalyst 1.0 · ${presetName(ui)}`, modelVersion: r.version, payload: savedRef.current, result: r });
        }
      }, 160);
    }
    return () => {
      cancelled = true;
      handled.current = null;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiKey, near, dataReady]);

  const r = runner.result;
  const activePreset = ui.mode === "emissions" ? PRESETS.find((p) => sameIv(p.iv, ui.iv)) : undefined;
  const set = (patch: Partial<CatUi>) => setUi((u) => ({ ...u, ...patch }));
  const setIv = (patch: Partial<Iv>) => setUi((u) => ({ ...u, iv: { ...u.iv, ...patch } }));
  const showingPlaceholder = !!r && runner.source?.kind === "precomputed" && !precomputedKey(ui);

  const endKey = r ? String(r.years.at(-1)) : "2100";
  const dEnd = r?.delta[endKey];
  const cum = r?.cumulative_emissions_gtco2;

  const series = useMemo(() => (r ? (Object.keys(Q_META) as Q[]).map((k) => [k, chartSeries(r, k)] as const) : []), [r]);
  const tempNote =
    r?.reference_state?.temperature_note ??
    (r?.inputs.temperature_model === "two_layer" ? "two-layer model spun up from 1750" : "CORe one-box response starting at 1.2 °C in 2025");

  const chart = (k: Q, data: TSSeries[]) => (
    <TimeSeriesChart
      key={k}
      title={`${Q_META[k].label}${k === "temp" ? (r?.inputs.temperature_model === "two_layer" ? " (two-layer model, relative to 1750)" : " (forcing response estimate, CORe one-box)") : ""}`}
      unit={Q_META[k].unit}
      digits={Q_META[k].digits}
      projectionStart={r?.years[0]}
      xDomain={[k === "ppm" || k === "emissions" ? 1980 : (r?.years[0] ?? 2026) - 1, r?.years.at(-1) ?? 2100]}
      includeZero={k === "emissions"}
      references={k === "emissions" ? [{ y: 0, label: "net zero" }] : undefined}
      series={data}
      height={compact ? 250 : undefined}
      animationMs={350}
      footer={
        k === "temp"
          ? `${tempNote} · bands: ECS ${r?.scenario.temperature_band_c?.likely?.ecs.join("–") ?? "2.5–4"} °C (AR6 likely), physics only`
          : k === "emissions" && r?.mode === "concentration"
            ? "Emissions implied by inverting the carbon cycle (concentration mode)"
            : k === "ppm"
              ? "FaIR v1-style carbon cycle, harmonised to 425.62 ppm in 2025"
              : `CO₂ ${r?.inputs.non_co2_forcing === "scenario" ? "+ scenario non-CO₂" : "only"} forcing`
      }
    />
  );

  const ecsMarks = [
    { value: 2.5, label: "2.5" },
    { value: 4, label: "4.0" },
  ];

  const sliders = (
    <>
      <Slider
        label="Peak year"
        min={NONE_PEAK}
        max={2060}
        step={1}
        value={ui.iv.peakYear}
        format={(v) => (v <= NONE_PEAK ? "No delay" : String(v))}
        onChange={(v) => setIv({ peakYear: v })}
        hint="Follow the baseline until this year, never exceed that level afterwards."
      />
      <Slider label="Decline after peak" min={0} max={10} step={0.5} value={ui.iv.decline} format={(v) => (v === 0 ? "None" : `${v.toFixed(1)} %/yr`)} onChange={(v) => setIv({ decline: v })} />
      <Slider
        label="Net-zero CO₂ year"
        min={2035}
        max={NONE_NZ}
        step={1}
        value={ui.iv.netZero}
        format={(v) => (v >= NONE_NZ ? "Not set" : String(v))}
        onChange={(v) => setIv({ netZero: v })}
        hint="Linear ramp from the peak (or 2025) level to zero."
      />
      <Slider label="Cut below 2019 level" min={0} max={80} step={1} value={ui.iv.cutPct} format={(v) => (v === 0 ? "None" : `${v}%`)} onChange={(v) => setIv({ cutPct: v })} />
      {ui.iv.cutPct > 0 ? <Slider label="…reached by" min={2030} max={2050} step={1} value={ui.iv.cutYear} disabled={ui.iv.cutPct === 0} onChange={(v) => setIv({ cutYear: v })} /> : null}
      <Slider label="Carbon removal" min={0} max={20} step={0.5} value={ui.iv.removal} format={(v) => (v === 0 ? "None" : `${v.toFixed(1)} GtCO₂/yr`)} onChange={(v) => setIv({ removal: v })} />
      {ui.iv.removal > 0 ? <Slider label="…starting in" min={2030} max={2080} step={1} value={ui.iv.removalStart} disabled={ui.iv.removal === 0} onChange={(v) => setIv({ removalStart: v })} hint="10-year ramp; assumed permanent storage." /> : null}
    </>
  );

  const controlsTop = (
    <div className="wb-controls" aria-label="Catalyst scenario">
      <SegmentedControl<Mode>
        label="Scenario mode"
        block
        options={[
          { value: "emissions", label: "Emissions" },
          { value: "concentration", label: "Concentration" },
        ]}
        value={ui.mode}
        onChange={(m) => set({ mode: m })}
      />
      {ui.mode === "emissions" ? (
        <div className="sol-field">
          <span className="sol-field__label">Start from a scenario</span>
          <div className="wb-presets" role="group" aria-label="Scenario presets">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" className={`wb-preset ${activePreset?.id === p.id ? "is-active" : ""}`} aria-pressed={activePreset?.id === p.id} onClick={() => setUi((u) => ({ ...u, iv: p.iv }))}>
                {p.name}
                <small>{p.params}</small>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <Select
            label="Baseline pathway"
            value={ui.baseline}
            onChange={(v) => set({ baseline: v })}
            options={[{ value: "core", label: "CORe 4.0 continuation" }, ...ALL_SSPS.map((s) => ({ value: s, label: `${SSP_LABELS[s]} concentrations` }))]}
          />
          <Select
            label="Compare with"
            value={ui.scenarioSsp}
            onChange={(v) => set({ scenarioSsp: v })}
            options={ALL_SSPS.map((s) => ({ value: s, label: `${SSP_LABELS[s]} (RCMIP concentrations)` }))}
            hint="With default physics, SSP1-1.9 / 1-2.6 / 2-4.5 / 3-7.0 / 5-8.5 load instantly (precomputed)."
          />
        </>
      )}
    </div>
  );

  const controlsTune = (
    <div className="wb-controls" aria-label="Catalyst fine-tuning">
      {ui.mode === "emissions" ? (
        <>
          <Select
            label="Baseline emissions"
            value={ui.baseline}
            onChange={(v) => set({ baseline: v })}
            options={[{ value: "core", label: "CORe continuation (diagnosed emissions)" }, ...ALL_SSPS.map((s) => ({ value: s, label: `${SSP_LABELS[s]} (RCMIP emissions)` }))]}
          />
          <div className="wb-group" data-testid="catalyst-interventions">
            <p className="wb-group__title">Adjust the scenario</p>
            {compact ? <div className="wb-controls__more">{sliders}</div> : sliders}
          </div>
        </>
      ) : null}
      <Disclosure summary="Climate settings">
        <div className="wb-controls__group">
        <Slider label="Climate sensitivity (ECS)" min={1.5} max={6} step={0.1} value={ui.ecs} format={(v) => `${v.toFixed(1)} °C`} onChange={(v) => set({ ecs: v })} marks={ecsMarks} hint="Marks: IPCC AR6 likely range 2.5–4.0 °C." />
        <div className="sol-field">
          <span className="sol-field__label">Temperature model</span>
          <SegmentedControl
            label="Temperature model"
            size="sm"
            block
            options={[
              { value: "two_layer", label: "Two-layer (transient)" },
              { value: "core4", label: "CORe one-box" },
            ]}
            value={ui.tempModel}
            onChange={(v) => set({ tempModel: v as CatUi["tempModel"] })}
          />
        </div>
        <Toggle label="Include scenario non-CO₂ forcing" hint="Methane, aerosols etc. from the RCMIP SSP (SSP2-4.5 for CORe baselines)." checked={ui.nonCo2} onChange={(v) => set({ nonCo2: v })} />
        <Slider label="Run to" min={2050} max={2100} step={5} value={ui.endYear} onChange={(v) => set({ endYear: v })} />
        </div>
      </Disclosure>
      <Button size="sm" variant="ghost" onClick={() => setUi(DEFAULT_UI)}>
        Reset all
      </Button>
    </div>
  );

  return (
    <section ref={rootRef} className={`wb ${compact ? "wb--compact" : ""}`} data-workbench="catalyst" aria-label="Catalyst 1.0 workbench">
      <WorkbenchHeader model="catalyst" compact={compact} title="What if emissions changed? A simplified scenario explorer" />
      <div className="wb-layout wb-layout--cat">
        <div className="wb-cat-top">{controlsTop}</div>
        <div className="wb-cat-tune">{controlsTune}</div>
        <div className="wb-layout__main">
          {showingPlaceholder && status.state !== "ready" && !runner.error ? (
            <p className="wb-loading-banner" role="status" data-testid="catalyst-placeholder">
              Loading the model. Meanwhile, this is the saved comparison of the CORe pathway with {r?.scenario.label ?? "an SSP pathway"}. Your scenario computes in this browser as soon as Python is ready.
            </p>
          ) : null}
          <RunStatus running={runner.running} coldStart={runner.coldStart} source={runner.source} error={runner.error} onRetry={runner.retry} />
          {!r && !runner.error ? <Skeleton height={420} /> : null}
          {r ? (
            <div className={`wb-results ${runner.running ? "is-stale" : ""}`} aria-busy={runner.running} data-testid="catalyst-results">
              <div className="wb-big" data-testid="catalyst-deltas">
                {dEnd ? (
                  <Stat
                    size="sm"
                    value={<Delta v={dEnd.temperature_c} unit="°C" testId="delta-end" />}
                    label={`Warming difference in ${endKey}`}
                    detail={`scenario ${degC(dEnd.scenario.temperature_c, 2)} vs baseline ${degC(dEnd.baseline.temperature_c, 2)}`}
                    source="Catalyst 1.0 · scenario − baseline"
                  />
                ) : null}
                {dEnd ? (
                  <Stat
                    size="sm"
                    value={<Delta v={dEnd.ppm} unit="ppm" d={0} />}
                    label={`CO₂ difference in ${endKey}`}
                    detail={`scenario ${ppm(dEnd.scenario.ppm, 0)} vs baseline ${ppm(dEnd.baseline.ppm, 0)}`}
                    source="Catalyst 1.0"
                  />
                ) : null}
                <Stat
                  size="sm"
                  value={isNum(r.scenario.peak_warming?.value_c) ? fmt(r.scenario.peak_warming!.value_c, 2) : "—"}
                  unit="°C"
                  label={`Scenario peak warming${r.scenario.peak_warming?.year ? `, in ${r.scenario.peak_warming.year}` : ""}`}
                  detail={`baseline peak ${degC(r.baseline.peak_warming?.value_c, 2)}`}
                  source="Catalyst 1.0"
                />
                {cum && isNum(cum.difference) ? (
                  <Stat
                    size="sm"
                    value={fmt(Math.abs(cum.difference), 0)}
                    unit="GtCO₂"
                    label={`Cumulative emissions ${cum.difference <= 0 ? "avoided" : "added"}, ${cum.period[0]}–${cum.period[1]}`}
                    detail={`${fmt(cum.scenario, 0)} vs ${fmt(cum.baseline, 0)} GtCO₂`}
                    source="Catalyst 1.0"
                  />
                ) : null}
              </div>
              <p className="wb-note" data-testid="catalyst-labels">
                <strong style={{ color: "var(--sol-data-2)" }}>Baseline</strong>: {r.baseline.label} · <strong style={{ color: "var(--sol-solar)" }}>Scenario</strong>: {r.scenario.label}
              </p>
              {wide ? (
                <div className="wb-grid4" data-testid="catalyst-charts">
                  {series.map(([k, s]) => chart(k, s))}
                </div>
              ) : (
                <div className="wb-chart-tabs" data-testid="catalyst-charts">
                  <SegmentedControl<Q>
                    label="Quantity"
                    size="sm"
                    block
                    options={[
                      { value: "temp", label: "Temperature" },
                      { value: "ppm", label: "CO₂" },
                      { value: "emissions", label: "Emissions" },
                      { value: "forcing", label: "Forcing" },
                    ]}
                    value={q}
                    onChange={setQ}
                  />
                  {series.filter(([k]) => k === q).map(([k, s]) => chart(k, s))}
                </div>
              )}
              <Warnings warnings={r.warnings} />
              <Disclosure summary="What this run assumed" testId="catalyst-assumptions">
                <ul className="wb-list">
                  {r.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </Disclosure>
              <Disclosure summary="How simplified is this?">
                <p>
                  Catalyst 1.0 is a reduced-complexity model: a FaIR v1-style carbon cycle, CO₂ forcing from the CORe expression and a one-box or two-layer temperature response. Below, its carbon
                  cycle is driven by the official RCMIP SSP emissions and compared with the RCMIP SSP concentrations (ECS 3 °C, no harmonisation).
                </p>
                {validation.data ? (
                  <>
                    {(() => {
                      const v = validation.data.validation.fair_v1;
                      return v ? (
                        <>
                          <KV
                            rows={[
                              ["vs NOAA global CO₂ 1979–2025", `RMSE ${fmt(v.historical.vs_noaa_global.rmse_ppm, 2)} ppm · bias ${fmt(v.historical.vs_noaa_global.bias_ppm, 2)} ppm · 2025 error ${fmt(v.historical.vs_noaa_global.last_year_error_ppm, 2)} ppm`],
                              ["vs RCMIP historical 1850–2014", `RMSE ${fmt(v.historical.vs_rcmip_historical.rmse_ppm, 2)} ppm · max ${fmt(v.historical.vs_rcmip_historical.max_abs_ppm, 2)} ppm`],
                            ]}
                          />
                          <div className="wb-table-wrap">
                            <table className="wb-table wb-table--stack" data-testid="catalyst-validation">
                              <thead>
                                <tr>
                                  <th scope="col">Pathway</th>
                                  <th scope="col">2050 model / RCMIP</th>
                                  <th scope="col">2100 model / RCMIP</th>
                                  <th scope="col">2100 error</th>
                                </tr>
                              </thead>
                              <tbody>
                                {v.ssp.map((row) => (
                                  <tr key={row.scenario}>
                                    <th scope="row">{SSP_LABELS[row.scenario] ?? row.scenario}</th>
                                    <td className="sol-mono" data-label="2050 model / RCMIP">
                                      {fmt(row.model_2050_ppm, 1)} / {fmt(row.rcmip_2050_ppm, 1)} ppm
                                    </td>
                                    <td className="sol-mono" data-label="2100 model / RCMIP">
                                      {fmt(row.model_2100_ppm, 1)} / {fmt(row.rcmip_2100_ppm, 1)} ppm
                                    </td>
                                    <td className="sol-mono" data-label="2100 error">
                                      {isNum(row.error_2100_ppm) ? `${row.error_2100_ppm > 0 ? "+" : "−"}${fmt(Math.abs(row.error_2100_ppm), 1)} ppm` : "—"}
                                      <span className="wb-ci">{isNum(row.error_2100_pct) ? `${row.error_2100_pct > 0 ? "+" : "−"}${fmt(Math.abs(row.error_2100_pct), 1)}%` : ""}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : null;
                    })()}
                    <p className="wb-note">
                      Not included: carbon-cycle parameter uncertainty, regional detail, natural forcing. Bands show only the IPCC AR6 ECS range. Displayed concentrations are harmonised to the
                      observed 2025 value by a constant offset (stated in the assumptions).
                    </p>
                  </>
                ) : (
                  <Skeleton height={120} />
                )}
              </Disclosure>
              <p className="wb-disclaimer">{String(r.provenance.conditional ?? "Conditional what-if output from a simplified model, not a prediction or policy assessment.")}</p>
              <ExportBar
                csv={() => {
                  const cols: Record<string, (number | string | null)[]> = { year: r.years };
                  for (const [name, p] of [["baseline", r.baseline], ["scenario", r.scenario]] as const) {
                    cols[`${name}_emissions_gtco2`] = p.emissions_gtco2 as (number | null)[];
                    cols[`${name}_ppm`] = p.ppm as (number | null)[];
                    cols[`${name}_forcing_wm2`] = p.forcing_wm2 as (number | null)[];
                    cols[`${name}_temperature_c`] = p.temperature_c as (number | null)[];
                    cols[`${name}_temperature_likely_low_c`] = (p.temperature_band_c?.likely?.lower ?? []) as (number | null)[];
                    cols[`${name}_temperature_likely_high_c`] = (p.temperature_band_c?.likely?.upper ?? []) as (number | null)[];
                  }
                  return {
                    filename: "catalyst_scenario.csv",
                    text: seriesToCsv(cols, [`Catalyst ${r.version} (new, simplified) — baseline: ${r.baseline.label}; scenario: ${r.scenario.label}`, ...r.assumptions]),
                  };
                }}
                json={() => ({ filename: "catalyst_scenario.json", data: { payload: savedRef.current ?? { ui, payload: buildPayload(ui) }, result: r } })}
                citation={() =>
                  [
                    `Catalyst ${r.version} (new, simplified scenario engine on CORe 4.0 physics), ${today()}.`,
                    `Baseline: ${r.baseline.label}. Scenario: ${r.scenario.label}.`,
                    dEnd ? `In ${endKey}: scenario − baseline = ${fmt(dEnd.temperature_c, 2)} °C, ${fmt(dEnd.ppm, 1)} ppm.` : "",
                    "Data: RCMIP v5.1.0 (Nicholls et al. 2020), NOAA GML global annual mean CO2.",
                    String(r.provenance.conditional ?? ""),
                    TEAM_CREDIT + ".",
                  ]
                    .filter(Boolean)
                    .join("\n")
                }
                onSave={
                  onSaveRequest
                    ? () =>
                        onSaveRequest({
                          model: "catalyst",
                          label: `Catalyst 1.0 · ${presetName(ui)}`,
                          modelVersion: r.version,
                          payload: savedRef.current ?? { ui, payload: buildPayload(ui), data: "co2_bundle (rcmip, historical_co2, noaa_global_annual)", core_pathway: "CORe 4.0 default projection" },
                          result: r,
                        })
                    : undefined
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function presetName(u: CatUi): string {
  if (u.mode === "concentration") return `${u.baseline === "core" ? "CORe" : SSP_LABELS[u.baseline]} vs ${SSP_LABELS[u.scenarioSsp]}`;
  const p = PRESETS.find((x) => sameIv(x.iv, u.iv));
  return p ? p.name : "custom scenario";
}
