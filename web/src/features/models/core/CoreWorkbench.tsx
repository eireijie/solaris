/**
 * CORe 4.0 workbench — global CO2 historical-continuation pathway to 2100.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Badge, Button, Callout, SegmentedControl, Skeleton, Slider, Stat, Toggle } from "../../../components/ui";
import { SERIES_PALETTE, TimeSeriesChart } from "../../../components/charts";
import type { TSSeries } from "../../../components/charts";
import { seriesToCsv } from "../../../data";
import { fetchPrecomputed } from "../../../runtime";
import type { CatalystResult, CoreResult } from "../results";
import type { WorkbenchProps } from "../types";
import { SSP_LABELS, useCo2Bundle, usePrecomputed } from "../lib/bundles";
import { degC, fmt, ppm, range } from "../lib/fmt";
import { useWorkbenchRun } from "../lib/useWorkbenchRun";
import { Disclosure, ExportBar, KV, RunStatus, SectionTitle, TEAM_CREDIT, today, Warnings, WorkbenchHeader } from "../components/common";
import "../models.css";

type CoreUi = { ecs: number; heatCapacity: number; endYear: number };
const CORE_DEFAULTS: CoreUi = { ecs: 3.0, heatCapacity: 8.0, endYear: 2100 };
const isDefault = (u: CoreUi) => u.ecs === 3 && u.heatCapacity === 8 && u.endYear === 2100;
type Metric = "ppm" | "forcing" | "temp";


type CoreSavedPayload = { settings: Record<string, number>; ui: CoreUi; data: "co2_bundle.historical_co2" };

const settingsOf = (u: CoreUi) => ({ ecs_c: u.ecs, heat_capacity: u.heatCapacity, projection_end_year: u.endYear });

function scrollToCatalyst() {
  const el = document.querySelector<HTMLElement>('[data-workbench="catalyst"]');
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function CoreWorkbench({ compact, initialRun, onRunComplete, onSaveRequest, catalystHref }: WorkbenchProps & { catalystHref?: string }): JSX.Element {
  const uid = useId();
  const co2 = useCo2Bundle();
  const restored = (initialRun?.payload as CoreSavedPayload | undefined)?.ui ?? null;
  const [ui, setUi] = useState<CoreUi>(restored ?? CORE_DEFAULTS);
  const [draft, setDraft] = useState<CoreUi>(restored ?? CORE_DEFAULTS);
  const [metric, setMetric] = useState<Metric>("ppm");
  const [showSsp, setShowSsp] = useState(false);
  const runner = useWorkbenchRun<CoreResult>("core", `core-${uid}`);
  const reqKey = `${ui.ecs}:${ui.heatCapacity}:${ui.endYear}`;
  const handled = useRef<string | null>(initialRun?.result ? reqKey : null);
  const twoLayer = usePrecomputed<CatalystResult>("catalyst", "concentration_ssp245");
  const [hasCatalyst, setHasCatalyst] = useState(false);
  useEffect(() => {
    setHasCatalyst(!!document.querySelector('[data-workbench="catalyst"]'));
  }, []);

  useEffect(() => {
    if (initialRun?.result) runner.show(initialRun.result as CoreResult, { kind: "saved", label: initialRun.label });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRun]);

  const bundleReady = !!co2.data;
  useEffect(() => {
    if (handled.current === reqKey) return;
    if (!isDefault(ui) && !bundleReady) return;
    handled.current = reqKey;
    let cancelled = false;
    let timer: number | undefined;
    const live = () => {
      if (!co2.data) {
        handled.current = null;
        return;
      }
      const settings = settingsOf(ui);
      const payload = { historical_co2: co2.data.historical_co2, settings };
      timer = window.setTimeout(async () => {
        const r = await runner.run(payload);
        if (r && !cancelled) {
          onRunComplete?.({ model: "core", label: `CORe 4.0 · ECS ${fmt(ui.ecs, 1)} °C · to ${ui.endYear}`, modelVersion: r.version, payload: { settings, ui, data: "co2_bundle.historical_co2" }, result: r });
        }
      }, 200);
    };
    if (isDefault(ui)) {
      void fetchPrecomputed<CoreResult>("core", "default").then((pre) => {
        if (cancelled) return;
        if (pre) runner.show(pre, { kind: "precomputed" });
        else live();
      });
    } else live();
    return () => {
      cancelled = true;
      handled.current = null;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey, bundleReady]);

  const r = runner.result;
  const end = r?.summary_end;

  const series: TSSeries[] = useMemo(() => {
    if (!r) return [];
    const h = r.historical;
    const src = co2.data?.historical_co2.source;
    const isNoaa = (i: number) => (src?.[i] ? /NOAA/i.test(src[i]) : h.years[i] >= 1979);
    const p = r.projection;
    if (metric === "ppm") {
      const s: TSSeries[] = [
        { id: "rcmip", label: "Historical CO₂ · RCMIP (to 1978)", role: "observed", data: h.years.map((x, i) => ({ x, y: isNoaa(i) ? null : h.ppm[i] })).filter((d) => d.y != null) },
        { id: "noaa", label: "Historical CO₂ · NOAA GML global (1979–)", role: "observed", type: "line", data: h.years.map((x, i) => ({ x, y: isNoaa(i) ? h.ppm[i] : null })).filter((d) => d.y != null), color: "var(--sol-text)" },
        {
          id: "proj",
          label: "CORe 4.0 continuation",
          role: "projection",
          data: p.years.map((x, i) => ({ x, y: p.ppm_mean[i], lower: p.ppm_lower[i], upper: p.ppm_upper[i] })),
          bandLabel: "uncertainty envelope",
        },
      ];
      if (showSsp && co2.data?.rcmip) {
        const rc = co2.data.rcmip;
        ["ssp119", "ssp126", "ssp245", "ssp460", "ssp370"].forEach((k, j) => {
          const vals = rc.concentrations_ppm[k];
          if (!vals) return;
          s.push({
            id: k,
            label: `${SSP_LABELS[k]} (RCMIP)`,
            role: "other",
            color: SERIES_PALETTE[(j + 1) % SERIES_PALETTE.length],
            dashed: true,
            strokeWidth: 1.25,
            hideInTooltip: false,
            data: rc.years.map((x, i) => ({ x, y: vals[i] })).filter((d) => d.x >= 2015 && d.x <= (r.projection.years.at(-1) ?? 2100)),
          });
        });
      }
      return s;
    }
    if (metric === "forcing") {
      return [
        { id: "hist", label: "Historical CO₂ forcing", role: "observed", type: "line", data: h.years.map((x, i) => ({ x, y: h.forcing_wm2[i] })) },
        {
          id: "proj",
          label: "CORe 4.0 CO₂ forcing",
          role: "projection",
          data: p.years.map((x, i) => ({ x, y: p.forcing_wm2[i], lower: p.forcing_lower_wm2?.[i], upper: p.forcing_upper_wm2?.[i] })),
          bandLabel: "from the ppm envelope",
        },
      ];
    }
    return [{ id: "temp", label: "Forcing response estimate (CO₂-only, one-box)", role: "projection", data: p.years.map((x, i) => ({ x, y: p.temperature_response_c[i] })) }];
  }, [r, metric, showSsp, co2.data]);

  const twoLayerEnd = twoLayer.data?.baseline.temperature_c.at(-1);
  const ssp585End = co2.data?.rcmip ? co2.data.rcmip.concentrations_ppm.ssp585?.[co2.data.rcmip.years.indexOf(2100)] : null;
  const catalystLink = catalystHref ? (
    <Button size="sm" variant="secondary" href={catalystHref}>
      Compare in Catalyst (two-layer)
    </Button>
  ) : hasCatalyst ? (
    <Button size="sm" variant="secondary" onClick={scrollToCatalyst}>
      Compare in Catalyst (two-layer)
    </Button>
  ) : null;

  const commit = (k: keyof CoreUi) => (v: number) => setUi((u) => ({ ...u, [k]: v }));

  const controls = (
    <div className="wb-controls">
      <Slider
        label="Project to"
        min={2050}
        max={2100}
        step={5}
        value={draft.endYear}
        onChange={(v) => setDraft((d) => ({ ...d, endYear: v }))}
        onCommit={commit("endYear")}
      />
      <Disclosure summary="Response estimate settings">
        <div className="wb-controls__group">
        <Slider
          label="Climate sensitivity (ECS)"
          min={1.5}
          max={6}
          step={0.1}
          value={draft.ecs}
          format={(v) => `${v.toFixed(1)} °C`}
          onChange={(v) => setDraft((d) => ({ ...d, ecs: v }))}
          onCommit={commit("ecs")}
          marks={[
            { value: 2.5, label: "2.5" },
            { value: 4, label: "4.0" },
          ]}
          hint="Notebook value: 3.0. Marks show the IPCC AR6 likely range."
        />
        <Slider
          label="Heat capacity"
          min={2}
          max={30}
          step={1}
          value={draft.heatCapacity}
          format={(v) => `${v} W yr/m²/K`}
          onChange={(v) => setDraft((d) => ({ ...d, heatCapacity: v }))}
          onCommit={commit("heatCapacity")}
          hint="Notebook value: 8."
        />
        {!isDefault(ui) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setUi(CORE_DEFAULTS);
              setDraft(CORE_DEFAULTS);
            }}
          >
            Reset to notebook defaults
          </Button>
        ) : null}
        </div>
      </Disclosure>
    </div>
  );

  return (
    <section className={`wb ${compact ? "wb--compact" : ""}`} data-workbench="core" aria-label="CORe 4.0 workbench">
      <WorkbenchHeader model="core" compact={compact} />
      <div className="wb-layout">
        <aside className="wb-layout__side">{controls}</aside>
        <div className="wb-layout__main">
          <RunStatus running={runner.running} coldStart={runner.coldStart} source={runner.source} error={runner.error} onRetry={runner.retry} />
          {co2.error ? (
            <Callout tone="danger" title="Could not load the CO₂ data">
              {co2.error} <Button size="sm" variant="ghost" onClick={co2.retry}>Retry</Button>
            </Callout>
          ) : null}
          {!r && !runner.error ? <Skeleton height={380} /> : null}
          {r && end ? (
            <div className={`wb-results ${runner.running ? "is-stale" : ""}`} aria-busy={runner.running}>
              <div className="wb-stats" data-testid="core-headline">
                <Stat
                  size="sm"
                  tone="solar"
                  value={fmt(end.ppm_mean, 1)}
                  unit="ppm"
                  label={`CO₂ in ${end.year}`}
                  detail={`range ${range(end.ppm_lower, end.ppm_upper, 1, "ppm")}`}
                  source={`CORe ${r.version} · historical-continuation pathway, not an IPCC scenario`}
                />
                <Stat
                  size="sm"
                  value={fmt(end.forcing_wm2, 2)}
                  unit="W/m²"
                  label={`CO₂ forcing in ${end.year}`}
                  detail={`range ${range(end.forcing_lower_wm2, end.forcing_upper_wm2, 2, "W/m²")}`}
                  source={`CORe ${r.version} · CO₂ only`}
                />
                <Stat
                  size="sm"
                  value={fmt(end.temperature_response_c, 2)}
                  unit="°C"
                  label={`Response estimate in ${end.year}`}
                  detail="CO₂ only, one-box. Not comparable to IPCC warming"
                  source={`CORe ${r.version}`}
                />
              </div>
              <div className="wb-chart-head">
                <SegmentedControl<Metric>
                  label="Quantity"
                  size="sm"
                  options={[
                    { value: "ppm", label: "CO₂ (ppm)" },
                    { value: "forcing", label: "Forcing (W/m²)" },
                    { value: "temp", label: "Response (°C)" },
                  ]}
                  value={metric}
                  onChange={setMetric}
                />
                {metric === "ppm" ? <Toggle label="Compare with SSP pathways" checked={showSsp} onChange={setShowSsp} /> : null}
              </div>
              <div data-testid="core-chart">
                <TimeSeriesChart
                  title={
                    metric === "ppm"
                      ? "Global CO₂ concentration: history and CORe continuation"
                      : metric === "forcing"
                        ? "CO₂ radiative forcing (CORe expression)"
                        : "Forcing response estimate (CO₂-only, one-box)"
                  }
                  unit={metric === "ppm" ? "ppm" : metric === "forcing" ? "W/m²" : "°C"}
                  digits={metric === "ppm" ? 1 : 2}
                  projectionStart={r.projection.years[0]}
                  xDomain={metric === "temp" ? undefined : [1940, r.projection.years.at(-1) ?? 2100]}
                  series={series}
                  height={compact ? 260 : undefined}
                  footer={
                    metric === "ppm"
                      ? `RCMIP v5.1.0 (1940–1978) → NOAA GML global annual mean (1979–2025); SSP lines: RCMIP CMIP6 concentrations, for context only${ssp585End != null ? ` (SSP5-8.5, ${fmt(ssp585End, 0)} ppm in 2100, not drawn to keep the scale readable)` : ""} · conditional model output`
                      : metric === "forcing"
                        ? "F = 5.35 ln(C / 278.3 ppm), CO₂ only · CORe 4.0"
                        : "One-box response T += (F − (3.7/ECS)·T)/C, CO₂ forcing only · CORe 4.0"
                  }
                />
              </div>
              {metric === "temp" ? (
                <Callout tone="honesty" title="A forcing response estimate, not a warming projection">
                  <p>
                    This is CORe's one-box response to CO₂ forcing alone, started at 1.2 °C in 2025. With no deep ocean it relaxes to equilibrium within about a decade, and it leaves out
                    methane, aerosols and other non-CO₂ forcing. It is not comparable to IPCC assessed warming.
                  </p>
                  {twoLayerEnd != null ? (
                    <p style={{ marginTop: 8 }}>
                      For comparison, the same default CORe pathway run through Catalyst's two-layer model (CO₂-only, ECS 3 °C) gives <strong className="sol-mono">{degC(twoLayerEnd, 2)}</strong> in 2100{" "}
                      <Badge tone="new">Catalyst 1.0 · precomputed</Badge>
                    </p>
                  ) : null}
                  {catalystLink ? <div style={{ marginTop: 10 }}>{catalystLink}</div> : null}
                </Callout>
              ) : null}
              <Warnings warnings={r.warnings} />
              <Disclosure summary="Validation and ensemble weights">
              <div className="wb-grid2">
                <div className="wb-span2">
                  <SectionTitle aside={<span className="wb-note">rolling-origin backtest, ≤ 10-yr horizons</span>}>Validation of candidate models</SectionTitle>
                  <div className="wb-table-wrap">
                    <table className="wb-table wb-table--stack" data-testid="core-validation">
                      <thead>
                        <tr>
                          <th scope="col">Model</th>
                          <th scope="col">MAE</th>
                          <th scope="col">RMSE</th>
                          <th scope="col">Bias</th>
                          <th scope="col">Weight</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.validation.candidates.map((c) => (
                          <tr key={c.model} className={c.selected_for_ensemble ? "is-selected" : ""}>
                            <th scope="row">
                              <span className="sol-mono">{c.model}</span> {c.selected_for_ensemble ? <Badge tone="success">in ensemble</Badge> : null}
                              <span className="wb-ci">{c.n_validation_points} backtest points</span>
                            </th>
                            <td className="sol-mono" data-label="MAE">{ppm(c.mae_ppm, 2)}</td>
                            <td className="sol-mono" data-label="RMSE">{ppm(c.rmse_ppm, 2)}</td>
                            <td className="sol-mono" data-label="Bias">{c.bias_ppm != null ? `${c.bias_ppm > 0 ? "+" : "−"}${fmt(Math.abs(c.bias_ppm), 2)} ppm` : "—"}</td>
                            <td className="sol-mono" data-label="Weight">{c.selected_for_ensemble && c.weight != null ? `${fmt(c.weight * 100, 1)}%` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="wb-note">
                      Weighted ensemble backtest: MAE {ppm(r.validation.ensemble_backtest.mae_ppm, 2)}, RMSE {ppm(r.validation.ensemble_backtest.rmse_ppm, 2)}, bias{" "}
                      {fmt(r.validation.ensemble_backtest.bias_ppm, 2)} ppm over {r.validation.ensemble_backtest.n_points} points (error = predicted − observed). Every candidate under-predicts in
                      backtests because CO₂ growth has accelerated, so the continuation may run low. The envelope is conformal-style, not a calibrated probability interval.
                    </p>
                  </div>
                </div>
                <div>
                  <SectionTitle>Adaptive growth constraints</SectionTitle>
                  <KV
                    rows={[
                      ["Minimum annual growth", `${fmt(r.growth_constraints.min_growth, 3)} ppm/yr`],
                      ["Maximum annual growth", `${fmt(r.growth_constraints.max_growth, 2)} ppm/yr`],
                      ["Maximum acceleration", `${fmt(r.growth_constraints.max_accel, 2)} ppm/yr²`],
                      ["Recent growth (median)", `${fmt(r.growth_constraints.recent_growth_median, 2)} ppm/yr`],
                    ]}
                  />
                </div>
                <div>
                  <SectionTitle>Ensemble</SectionTitle>
                  <KV rows={r.ensemble.map((e) => [<span className="sol-mono">{e.model}</span>, `${fmt(e.weight * 100, 1)}%`])} />
                </div>
              </div>
              </Disclosure>
              <Disclosure summary="Data and method">
                <ul className="wb-list">
                  {(r.provenance.data_sources as string[] | undefined)?.map((d) => <li key={d}>{d}</li>)}
                  {(r.provenance.method as string[] | undefined)?.map((d) => <li key={d}>{d}</li>)}
                </ul>
                <p className="wb-note">
                  NOAA revises recent annual values by about 0.01–0.02 ppm between releases, which moves the 2100 value by up to roughly 0.3 ppm; the bundled data pin the 9 Oct 2026 release.
                </p>
              </Disclosure>
              <p className="wb-disclaimer">CORe continues recent CO₂ growth. It is not an IPCC emissions scenario. Conditional model output, not a prediction.</p>
              <ExportBar
                csv={() => {
                  const h = r.historical;
                  const p = r.projection;
                  const years = [...h.years, ...p.years];
                  return {
                    filename: `core_co2_${end.year}.csv`,
                    text: seriesToCsv(
                      {
                        year: years,
                        kind: [...h.years.map(() => "historical"), ...p.years.map(() => "projection")],
                        ppm: [...h.ppm, ...p.ppm_mean],
                        ppm_lower: [...h.years.map(() => null), ...p.ppm_lower],
                        ppm_upper: [...h.years.map(() => null), ...p.ppm_upper],
                        forcing_wm2: [...h.forcing_wm2, ...p.forcing_wm2],
                        forcing_response_estimate_c: [...h.years.map(() => null), ...p.temperature_response_c],
                      },
                      [`CORe ${r.version} historical-continuation CO2 pathway (not an IPCC scenario)`, `Settings: ECS ${r.inputs.settings.ecs_c} C, heat capacity ${r.inputs.settings.heat_capacity}`, "Data: RCMIP v5.1.0 (1940-1978) + NOAA GML global annual mean (1979-2025)", "forcing_response_estimate_c: one-box CO2-only response, not comparable to IPCC warming"],
                    ),
                  };
                }}
                json={() => ({ filename: "core_result.json", data: { payload: { settings: settingsOf(ui), data: "co2_bundle.historical_co2" }, result: r } })}
                citation={() =>
                  [
                    `CORe ${r.version} (ported from the Solaris team notebook with exact parity), ${today()}.`,
                    `Historical-continuation CO2 pathway: ${fmt(end.ppm_mean, 2)} ppm in ${end.year} (envelope ${fmt(end.ppm_lower, 2)}–${fmt(end.ppm_upper, 2)} ppm); CO2 forcing ${fmt(end.forcing_wm2, 2)} W/m2.`,
                    `Data: RCMIP v5.1.0 (Nicholls et al. 2020) 1940–1978; NOAA GML global annual mean CO2 (Lan, Tans & Thoning) 1979–2025.`,
                    "Not an IPCC emissions scenario. Conditional model output, not a prediction.",
                    TEAM_CREDIT + ".",
                  ].join("\n")
                }
                onSave={
                  onSaveRequest
                    ? () => onSaveRequest({ model: "core", label: `CORe 4.0 · ${fmt(end.ppm_mean, 1)} ppm in ${end.year}`, modelVersion: r.version, payload: { settings: settingsOf(ui), ui, data: "co2_bundle.historical_co2" }, result: r })
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

