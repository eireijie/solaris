/**
 * Nexus 1.0 workbench (new, simplified) — validation and context for Aeros.
 * Single station: hindcast audit, trend statistics, optional bias-adjusted view, data quality.
 * Station set: poster-style statistics for the Solaris sample set (precomputed or live subset).
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Button, Callout, SegmentedControl, Skeleton, Stat, Toggle } from "../../../components/ui";
import { GroupCompareChart, TimeSeriesChart } from "../../../components/charts";
import type { Group, TSSeries } from "../../../components/charts";
import type { SeasonKey, Station } from "../../../data";
import { toCsv } from "../../../data";
import { fetchPrecomputed } from "../../../runtime";
import type { GroupCell, GroupViews, HindcastSeason, NexusSetResult, NexusStationResult, NexusTrendSeason } from "../results";
import type { SavedRun, WorkbenchProps } from "../types";
import { classLabel, DEFAULT_STATION_ID, STATION_PROVENANCE, stationGroup, useStationsBundle } from "../lib/bundles";
import { capital, degC, degCSigned, fmt, isNum, pct, perDecade, pValue, range } from "../lib/fmt";
import { useWorkbenchRun } from "../lib/useWorkbenchRun";
import { Disclosure, ExportBar, KV, RunStatus, TEAM_CREDIT, today, Warnings, WorkbenchHeader } from "../components/common";
import { StationGlobe } from "../components/StationGlobe";
import { StationPicker } from "../components/StationPicker";
import "../models.css";

type View = "station" | "set";
type StationUi = { cutoff: number; paths: 100 | 200 };
const STATION_DEFAULTS: StationUi = { cutoff: 2000, paths: 200 };

type NexusSavedPayload =
  | { view: "station"; station_id: string; options: Record<string, unknown>; ui: StationUi }
  | { view: "set"; station_ids: string[]; options: Record<string, unknown> };

function seasonName(local: string | null | undefined, k: SeasonKey) {
  return local ? `${capital(local)} (${k})` : k;
}

function skillWord(s: number) {
  if (s < 0) return "No skill";
  if (s < 0.25) return "Weak skill";
  if (s < 0.5) return "Moderate skill";
  return "Clear skill";
}

/* ======================= single station ======================= */

function HindcastPanel({ h, station, season, label, compact }: { h: HindcastSeason; station: Station | undefined; season: SeasonKey; label: string; compact?: boolean }) {
  const cutoff = h.test_years[0] - 1;
  const series: TSSeries[] = useMemo(() => {
    const obsAll = station
      ? station.series.years.map((y, i) => ({ x: y, y: station.series[season][i] })).filter((d) => d.y != null)
      : h.per_year.map((p) => ({ x: p.year, y: p.observed }));
    return [
      { id: "train", label: "Observed (training years)", role: "observed", type: "points", data: obsAll.filter((d) => d.x <= cutoff), color: "var(--sol-text-3)" },
      { id: "test", label: "Observed (held out)", role: "observed", type: "points", data: obsAll.filter((d) => d.x > cutoff) },
      {
        id: "pred",
        label: `Aeros hindcast (trained to ${cutoff})`,
        role: "projection",
        data: h.per_year.map((p) => ({ x: p.year, y: p.predicted, lower: p.lower, upper: p.upper })),
        bandLabel: "95% range",
      },
    ];
  }, [h, station, season, cutoff]);
  return (
    <TimeSeriesChart
      title={`${label} · hindcast vs what happened`}
      description={`Aeros trained on years up to ${cutoff} and asked to predict ${h.test_years[0]}–${h.test_years[1]}; dots after the marker are the held-out observations.`}
      unit="°C"
      digits={1}
      projectionStart={h.test_years[0]}
      projectionLabel={`Held out from ${h.test_years[0]}`}
      xDomain={[station?.series.years[0] ?? h.per_year[0]?.year ?? 1940, h.test_years[1]]}
      series={series}
      height={compact ? 240 : undefined}
      footer="Nexus 1.0 hindcast audit · Aeros never sees the held-out years · error = predicted − observed"
    />
  );
}

function MetricsTable({ h }: { h: HindcastSeason }) {
  const clim = h.baselines.climatology_last30;
  const lin = h.baselines.linear_trend_full;
  const bias = h.mean_bias;
  return (
    <div className="wb-table-wrap">
      <table className="wb-table wb-table--stack wb-table--kv" data-testid="nexus-metrics">
        <caption className="sol-visually-hidden">Hindcast metrics</caption>
        <tbody>
          <tr>
            <th scope="row">Test years</th>
            <td className="sol-mono" data-label="">
              {h.test_years[0]}–{h.test_years[1]} · {h.n_test} seasons
            </td>
          </tr>
          <tr>
            <th scope="row">Mean absolute error (MAE)</th>
            <td className="sol-mono" data-label="">{degC(h.mae, 2)}</td>
          </tr>
          <tr>
            <th scope="row">Root-mean-square error (RMSE)</th>
            <td className="sol-mono" data-label="">{degC(h.rmse, 2)}</td>
          </tr>
          <tr>
            <th scope="row">
              Mean bias
              <span className="wb-ci">predicted − observed: positive = Aeros ran too warm, negative = too cool</span>
            </th>
            <td className="sol-mono" data-label="">
              {degCSigned(bias, 2)}
              <span className="wb-ci">
                ± {fmt(h.mean_bias_se, 2)} SE · {isNum(bias) ? (bias > 0 ? "too warm" : bias < 0 ? "too cool" : "unbiased") : ""}
                {isNum(bias) && isNum(h.mean_bias_se) && Math.abs(bias) > 2 * h.mean_bias_se ? ", more than 2 SE from zero" : ", within 2 SE of zero"}
              </span>
            </td>
          </tr>
          <tr>
            <th scope="row">
              95% interval coverage
              <span className="wb-ci">share of held-out seasons inside the band; 95% is the target</span>
            </th>
            <td className="sol-mono" data-label="">
              {pct(h.interval_coverage_95)}
              <span className="wb-ci">mean band width {degC(h.mean_interval_width, 1)}</span>
            </td>
          </tr>
          <tr>
            <th scope="row">
              Direction accuracy
              <span className="wb-ci">{h.direction_definition}</span>
            </th>
            <td className="sol-mono" data-label="">{pct(h.direction_accuracy)}</td>
          </tr>
          <tr>
            <th scope="row">
              Trend over the test years
              <span className="wb-ci">observed vs predicted slope; error = predicted − observed</span>
            </th>
            <td className="sol-mono" data-label="">
              {perDecade(h.observed_slope)} obs.
              <span className="wb-ci">
                {perDecade(h.predicted_slope)} predicted · error {perDecade(h.slope_error)}
              </span>
            </td>
          </tr>
          {clim ? (
            <tr>
              <th scope="row">
                Skill vs last-30-year average
                <span className="wb-ci">1 − MSE(Aeros)/MSE(baseline); 0 = no better, 1 = perfect. Baseline MAE {degC(clim.mae, 2)}</span>
              </th>
              <td className="sol-mono" data-label="">{fmt(clim.aeros_skill_score_vs_this, 2)}</td>
            </tr>
          ) : null}
          {lin ? (
            <tr>
              <th scope="row">
                Skill vs straight-line trend
                <span className="wb-ci">OLS line through all training years, extrapolated. Baseline MAE {degC(lin.mae, 2)}</span>
              </th>
              <td className="sol-mono" data-label="">{fmt(lin.aeros_skill_score_vs_this, 2)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function Verdict({ h, label }: { h: HindcastSeason; label: string }) {
  const skills = [h.baselines.climatology_last30?.aeros_skill_score_vs_this, h.baselines.linear_trend_full?.aeros_skill_score_vs_this].filter(isNum);
  if (!skills.length) return null;
  const worst = Math.min(...skills);
  const cov = h.interval_coverage_95;
  return (
    <p className="wb-verdict">
      <strong>
        {label}: {skillWord(worst).toLowerCase()} against simple baselines.
      </strong>{" "}
      Skill score {fmt(worst, 2)} (0 is no better than a baseline, 1 is perfect).
      {isNum(cov) ? ` The 95% range held ${pct(cov)} of the held-out seasons.` : ""}
    </p>
  );
}

function TrendTable({ t }: { t: NexusTrendSeason }) {
  const row = (name: string, w: NexusTrendSeason["early"]) =>
    w ? (
      <tr>
        <th scope="row">
          {name} <span className="wb-ci">{w.window} · n = {w.n}</span>
        </th>
        <td className="sol-mono" data-label="Slope">
          {perDecade(w.slope)}
          <span className="wb-ci">95% CI {range(w.ci_low, w.ci_high, 2)}</span>
        </td>
        <td className="sol-mono" data-label="p">{pValue(w.p_value)}</td>
        <td className="sol-mono" data-label="SE · AR(1)-adj.">
          {fmt(w.se, 3)}
          <span className="wb-ci">
            AR(1)-adjusted {fmt(w.se_ar1_adjusted, 3)} · n<sub>eff</sub> {fmt(w.n_effective, 1)}
          </span>
        </td>
      </tr>
    ) : (
      <tr>
        <th scope="row">{name}</th>
        <td colSpan={3} className="sol-muted">Not enough observed years in this window.</td>
      </tr>
    );
  return (
    <div className="wb-table-wrap">
      <table className="wb-table wb-table--stack" data-testid="nexus-trends">
        <thead>
          <tr>
            <th scope="col">Window</th>
            <th scope="col">Slope (°C/decade)</th>
            <th scope="col">p</th>
            <th scope="col">SE</th>
          </tr>
        </thead>
        <tbody>
          {row("Early", t.early)}
          {row("Modern", t.modern)}
          {t.change ? (
            <tr className="is-selected">
              <th scope="row">
                Change (modern − early)
                <span className="wb-ci">SE = √(se₁² + se₂²), t-test with {t.change.df ?? "—"} df</span>
              </th>
              <td className="sol-mono" data-label="Change">
                {perDecade(t.change.change)}
                <span className="wb-ci">95% CI {range(t.change.ci_low, t.change.ci_high, 2)}</span>
              </td>
              <td className="sol-mono" data-label="p">{pValue(t.change.p_value)}</td>
              <td className="sol-mono" data-label="SE">{fmt(t.change.se, 3)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="wb-note">
        OLS on observed (not gap-filled) values with t-based 95% CIs, as on the poster. The AR(1)-adjusted SE accounts for year-to-year autocorrelation (effective sample size n<sub>eff</sub>); it is
        reported alongside, not used in the p-value.
      </p>
    </div>
  );
}

function StationView({ compact, initial, onRunComplete, onSaveRequest, initialStationId, stations, bundleSourceUrl }: {
  compact?: boolean;
  initial: SavedRun | undefined;
  onRunComplete?: WorkbenchProps["onRunComplete"];
  onSaveRequest?: WorkbenchProps["onSaveRequest"];
  initialStationId?: string;
  stations: Station[];
  bundleSourceUrl?: string;
}) {
  const uid = useId();
  const restored = initial && (initial.payload as NexusSavedPayload | undefined)?.view === "station" ? (initial.payload as Extract<NexusSavedPayload, { view: "station" }>) : null;
  const [stationId, setStationId0] = useState(restored?.station_id ?? initialStationId ?? DEFAULT_STATION_ID);
  const [picked, setPicked] = useState(!!restored || !!initialStationId);
  const setStationId = (id: string) => {
    setPicked(true);
    setStationId0(id);
  };
  const [ui, setUi] = useState<StationUi>(restored?.ui ?? STATION_DEFAULTS);
  const [prefLocal, setPrefLocal] = useState<"winter" | "summer">("winter");
  const [showAdjusted, setShowAdjusted] = useState(false);
  const runner = useWorkbenchRun<NexusStationResult>("nexus", `nexus-st-${uid}`);
  const reqKey = `${stationId}:${ui.cutoff}:${ui.paths}`;
  const handled = useRef<string | null>(restored && initial?.result ? reqKey : null);
  const saved = useRef<NexusSavedPayload | null>(restored);
  const station = stations.find((s) => s.id === stationId);
  const ready = stations.length > 0;

  useEffect(() => {
    if (restored && initial?.result) runner.show(initial.result as NexusStationResult, { kind: "saved", label: initial.label });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useEffect(() => {
    if (!ready || !picked) return;
    if (handled.current === reqKey) return;
    handled.current = reqKey;
    let cancelled = false;
    let timer: number | undefined;
    const options = { train_end_year: ui.cutoff, mode: ui.paths === 100 ? "fast" : "notebook" };
    const live = () => {
      const st = stations.find((s) => s.id === stationId);
      if (!st) return;
      timer = window.setTimeout(async () => {
        const r = await runner.run({ station: st, options, provenance: { data_source: STATION_PROVENANCE, source_url: bundleSourceUrl ?? null } });
        if (r && !cancelled) {
          saved.current = { view: "station", station_id: stationId, options, ui };
          onRunComplete?.({ model: "nexus", label: `Nexus 1.0 · ${st.display_name}`, modelVersion: r.version, payload: saved.current, result: r });
        }
      }, 250);
    };
    if (ui.cutoff === STATION_DEFAULTS.cutoff && ui.paths === STATION_DEFAULTS.paths) {
      void fetchPrecomputed<NexusStationResult>("nexus", stationId).then((pre) => {
        if (cancelled) return;
        if (pre) {
          saved.current = { view: "station", station_id: stationId, options, ui };
          runner.show(pre, { kind: "precomputed" });
        } else live();
      });
    } else live();
    return () => {
      cancelled = true;
      handled.current = null;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey, ready, picked]);

  const r = runner.result;
  const seasonKeys = (["D-J-F", "J-J-A"] as SeasonKey[]).filter((k) => r?.hindcast?.seasons[k] || r?.trends?.seasons[k]);
  const localOf = (k: SeasonKey) => r?.trends?.seasons[k]?.local_label ?? station?.local_season?.[k] ?? null;
  const ordered = [...seasonKeys].sort((a, b) => (localOf(a) === "winter" ? -1 : localOf(b) === "winter" ? 1 : 0));
  const sel = ordered.find((k) => localOf(k) === prefLocal) ?? ordered[0];
  const h = sel ? r?.hindcast?.seasons[sel] : undefined;
  const t = sel ? r?.trends?.seasons[sel] : undefined;
  const dq = sel ? r?.data_quality?.seasons[sel] : undefined;
  const adj = sel ? r?.bias_correction?.adjusted[sel] : undefined;
  const base = sel ? r?.bias_correction?.aeros_baseline[sel] : undefined;
  const label = r?.station?.name ?? station?.display_name ?? stationId;
  const selName = sel ? seasonName(localOf(sel), sel) : "";

  const csv = () => {
    const rows: Record<string, string | number | null | undefined>[] = [];
    for (const k of ordered) {
      const hh = r?.hindcast?.seasons[k];
      hh?.per_year.forEach((p) => rows.push({ season: k, local_season: localOf(k) ?? "", year: p.year, observed_c: p.observed, predicted_c: p.predicted, lower_c: p.lower, upper_c: p.upper }));
    }
    return {
      filename: `nexus_hindcast_${stationId}.csv`,
      text: toCsv(rows, ["season", "local_season", "year", "observed_c", "predicted_c", "lower_c", "upper_c"], [
        `Nexus ${r?.version} hindcast audit — ${label}; trained to ${r?.hindcast?.cutoff}`,
        "error = predicted − observed (°C)",
        STATION_PROVENANCE,
      ]),
    };
  };

  return (
    <div className="wb-layout">
      <aside className="wb-layout__side">
        <div className="wb-controls">
          {stations.length ? <StationPicker stations={stations} value={picked ? stationId : null} placeholderValue={picked ? undefined : "Choose a station"} onChange={setStationId} /> : <Skeleton height={64} />}
          {!picked ? <p className="wb-pick">Pick a station on the globe or from the list. The settings appear once a station is chosen.</p> : null}
          <div className={compact ? "wb-controls__more" : "wb-controls__group"} hidden={!picked}>
            <div className="sol-field">
              <span className="sol-field__label">Train Aeros up to</span>
              <SegmentedControl<string>
                label="Hindcast cutoff year"
                size="sm"
                block
                options={[1990, 2000, 2010].map((y) => ({ value: String(y), label: String(y) }))}
                value={String(ui.cutoff)}
                onChange={(v) => setUi((u) => ({ ...u, cutoff: Number(v) }))}
              />
              <p className="sol-field__hint">Aeros sees only years up to the cutoff and is scored on every observed season after it.</p>
            </div>
          </div>
          {picked ? (
          <Disclosure summary="Advanced settings">
            <div className="sol-field">
              <span className="sol-field__label">Bootstrap paths</span>
              <SegmentedControl<string>
                label="Bootstrap paths"
                size="sm"
                block
                options={[
                  { value: "100", label: "100" },
                  { value: "200", label: "200" },
                ]}
                value={String(ui.paths)}
                onChange={(v) => setUi((u) => ({ ...u, paths: Number(v) as 100 | 200 }))}
              />
            </div>
          </Disclosure>
          ) : null}
        </div>
      </aside>
      <div className="wb-layout__main">
        {stations.length ? <StationGlobe stations={stations} value={picked ? stationId : null} onChange={setStationId} height={compact ? 320 : 380} /> : null}
        {picked ? <RunStatus running={runner.running} coldStart={runner.coldStart} source={runner.source} error={runner.error} onRetry={runner.retry} /> : null}
        {picked && !r && !runner.error ? <Skeleton height={360} /> : null}
        {picked && r && sel ? (
          <div className={`wb-results ${runner.running ? "is-stale" : ""}`} aria-busy={runner.running}>
            <div className="wb-chart-head">
              <p className="wb-result-title">
                <strong>{label}</strong> <span className="sol-muted">· trained to {r.hindcast?.cutoff}, tested {h ? `${h.test_years[0]}–${h.test_years[1]}` : ""}</span>
              </p>
              <SegmentedControl<SeasonKey>
                label="Season"
                size="sm"
                options={ordered.map((k) => ({ value: k, label: seasonName(localOf(k), k) }))}
                value={sel}
                onChange={(k) => setPrefLocal((localOf(k) as "winter" | "summer") ?? (k === "D-J-F" ? "winter" : "summer"))}
              />
            </div>
            {h ? (
              <>
                <Verdict h={h} label={selName} />
                <div data-testid="nexus-chart">
                  <HindcastPanel h={h} station={station} season={sel} label={`${label} · ${selName}`} compact={compact} />
                </div>
                <div className="wb-stats">
                  <Stat size="sm" value={fmt(h.mae, 2)} unit="°C" label="Mean absolute error" detail={`over ${h.n_test} held-out seasons`} source="" />
                  <Stat size="sm" value={degCSigned(h.mean_bias, 2)} label="Mean bias" detail={isNum(h.mean_bias) ? (h.mean_bias > 0 ? "Aeros ran too warm" : "Aeros ran too cool") : ""} source="" />
                  <Stat size="sm" value={pct(h.interval_coverage_95)} label="Seasons inside the 95% range" detail="target is 95%" source="" />
                </div>
                <Disclosure summary={`All hindcast metrics · ${selName}`}>
                  <MetricsTable h={h} />
                </Disclosure>
                {t ? (
                  <Disclosure summary={`Observed trends, 1940–1979 vs 1980–latest · ${selName}`}>
                    <TrendTable t={t} />
                  </Disclosure>
                ) : null}
              </>
            ) : (
              <Callout tone="warning">No hindcast available for this season (too few observed years after the cutoff).</Callout>
            )}
            {adj && base ? (
              <Disclosure summary="Experimental: bias-adjusted view">
                <Toggle
                  label="Show the Nexus bias-adjusted view next to Aeros"
                  hint="Experimental. The Aeros forecast itself is never changed."
                  checked={showAdjusted}
                  onChange={setShowAdjusted}
                />
                {showAdjusted ? (
                  adj.available && adj.projection ? (
                    <>
                      <TimeSeriesChart
                        title={`${label} · ${selName}: Aeros baseline vs ${adj.label}`}
                        unit="°C"
                        digits={1}
                        height={compact ? 220 : 280}
                        series={[
                          { id: "base", label: "Aeros 4.0 forecast (unchanged)", role: "projection", data: base.projection.map((p) => ({ x: p.year, y: p.mean, lower: p.lower, upper: p.upper })), bandLabel: "95% range" },
                          { id: "adj", label: "Nexus bias-adjusted view (experimental; not the Aeros forecast)", role: "other", color: "var(--sol-model-nexus)", dashed: true, data: adj.projection.map((p) => ({ x: p.year, y: p.mean })) },
                        ]}
                        footer={`${adj.formula ?? ""} · correction ${degCSigned(adj.correction_c, 2)} (shrinkage ${fmt(adj.shrinkage, 1)})`}
                      />
                      <p className="wb-note">
                        Hindcast mean (observed − predicted) {degCSigned(adj.hindcast_mean_observed_minus_predicted, 2)};{" "}
                        {adj.hindcast_bias_distinguishable_from_zero ? "distinguishable from zero." : "not distinguishable from zero, so the adjustment is not supported by the evidence."} {adj.caveat}
                      </p>
                    </>
                  ) : (
                    <p className="wb-note">{adj.reason ?? "No adjustment available for this season."}</p>
                  )
                ) : null}
              </Disclosure>
            ) : null}
            <Disclosure summary={`Data quality · ${selName}`}>
              {dq ? (
                <KV
                  rows={[
                    ["Years with data", `${dq.first_year}–${dq.last_year} · ${dq.n_observed} observed`],
                    ["Gaps filled for Aeros (PCHIP)", dq.imputed_years.length ? dq.imputed_years.join(", ") : "none"],
                    ["Longest gap", `${dq.longest_internal_gap_years} yr`],
                    ["Outlier years flagged", dq.outlier_years.length ? dq.outlier_years.join(", ") : "none"],
                    ["Years in 1940–1979", String(dq.n_years_1940_1979 ?? "—")],
                    ["Sufficient for Aeros", dq.sufficient ? "yes" : "no"],
                  ]}
                />
              ) : (
                <p>No data-quality block.</p>
              )}
              <p className="wb-note">Trend statistics use observed values only; gap-filled years are never scored in the hindcast.</p>
            </Disclosure>
            <Warnings warnings={r.warnings} title="Notes from the run" />
            <p className="wb-disclaimer">Nexus never alters Aeros output. A hindcast on one station’s past is evidence about the method, not a guarantee for 2100.</p>
            <ExportBar
              csv={csv}
              json={() => ({ filename: `nexus_${stationId}.json`, data: { payload: saved.current, result: r } })}
              citation={() =>
                [
                  `Nexus ${r.version} (new, simplified validation layer for Aeros 4.0), ${today()}.`,
                  `Station: ${label} (${stationId}). Data: ${STATION_PROVENANCE}.`,
                  `Hindcast: trained to ${r.hindcast?.cutoff}, scored on held-out observed seasons; error = predicted − observed.`,
                  ...ordered.map((k) => {
                    const hh = r.hindcast?.seasons[k];
                    return hh ? `${seasonName(localOf(k), k)}: MAE ${fmt(hh.mae, 2)} °C, bias ${fmt(hh.mean_bias, 2)} °C, coverage ${pct(hh.interval_coverage_95)}.` : "";
                  }),
                  TEAM_CREDIT + ".",
                ].join("\n")
              }
              onSave={
                onSaveRequest
                  ? () => onSaveRequest({ model: "nexus", label: `Nexus 1.0 · ${label}`, modelVersion: r.version, payload: saved.current, result: r })
                  : undefined
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ======================= station set ======================= */

const POSTER = {
  winter: { change: 0.189, lo: 0.085, hi: 0.294, p: "p = 0.0007", up: "29 of 40" },
  summer: { change: 0.211, lo: 0.132, hi: 0.29, p: "p < 0.001", up: "34 of 40" },
};

function cellGroup(label: string, c: GroupCell | undefined, color?: string): Group | null {
  if (!c || !isNum(c.mean_change)) return null;
  return { label: `${label} (n = ${c.n})`, value: c.mean_change, lower: c.ci_low, upper: c.ci_high, note: `${pValue(c.p_value)} · ${c.n_increased}/${c.n} up`, color };
}

function SetView({ stations, initial, onRunComplete, onSaveRequest }: {
  stations: Station[];
  initial: SavedRun | undefined;
  onRunComplete?: WorkbenchProps["onRunComplete"];
  onSaveRequest?: WorkbenchProps["onSaveRequest"];
}) {
  const uid = useId();
  const restored = initial && (initial.payload as NexusSavedPayload | undefined)?.view === "set" ? (initial.payload as Extract<NexusSavedPayload, { view: "set" }>) : null;
  const runner = useWorkbenchRun<NexusSetResult>("nexus", `nexus-set-${uid}`);
  const [frame, setFrame] = useState<"hemi" | "calendar">("hemi");
  const americas = useMemo(() => stations.filter((s) => s.set === "americas"), [stations]);
  const [selected, setSelected] = useState<Set<string>>(new Set(restored?.station_ids ?? []));
  const [subsetOpen, setSubsetOpen] = useState(false);
  const saved = useRef<NexusSavedPayload | null>(restored);

  useEffect(() => {
    if (restored && initial?.result) {
      runner.show(initial.result as NexusSetResult, { kind: "saved", label: initial.label });
      return;
    }
    let alive = true;
    void fetchPrecomputed<NexusSetResult>("nexus", "station_set_americas").then((pre) => {
      if (alive && pre) {
        runner.show(pre, { kind: "precomputed" });
        saved.current = { view: "set", station_ids: pre.station_set.stations.map((s) => s.id), options: { group_by: ["country", "urban_rural"] } };
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected.size && americas.length) setSelected(new Set(americas.map((s) => s.id)));
  }, [americas, selected.size]);

  const runSubset = async () => {
    const chosen = stations.filter((s) => selected.has(s.id));
    const options = { group_by: ["country", "urban_rural"] };
    const res = await runner.run({ stations: chosen, options });
    if (res) {
      saved.current = { view: "set", station_ids: chosen.map((s) => s.id), options };
      onRunComplete?.({ model: "nexus", label: `Nexus 1.0 · station set (${chosen.length})`, modelVersion: res.version, payload: saved.current, result: res });
    }
  };

  const r = runner.result;
  const g = r?.station_set.groups;
  const keys = frame === "hemi" ? (["winter", "summer"] as const) : (["D-J-F", "J-J-A"] as const);
  const cellOf = (v: GroupViews | undefined, k: string): GroupCell | undefined =>
    v ? (frame === "hemi" ? v.hemisphere_adjusted[k as "winter" | "summer"] : v.calendar[k as SeasonKey]) : undefined;
  const keyLabel = (k: string) => (frame === "hemi" ? `${capital(k)} (hemisphere-adjusted)` : k === "D-J-F" ? "D-J-F (calendar)" : "J-J-A (calendar)");
  const isDefaultSet = runner.source?.kind === "precomputed";

  const presets: [string, (s: Station) => boolean][] = [
    ["All 40 Americas", (s) => s.set === "americas"],
    ["United States", (s) => s.country === "United States"],
    ["Argentina", (s) => s.country === "Argentina"],
    ["Urban", (s) => s.set === "americas" && s.urban_rural === "urban"],
    ["Rural", (s) => s.set === "americas" && s.urban_rural === "rural"],
  ];

  return (
    <div className="wb-layout__main">
      <RunStatus running={runner.running} coldStart={runner.coldStart} source={runner.source} error={runner.error} onRetry={runner.retry} />
      {!r && !runner.error ? <Skeleton height={320} /> : null}
      {r && g ? (
        <div className={`wb-results ${runner.running ? "is-stale" : ""}`} aria-busy={runner.running} data-testid="nexus-set">
          <div className="wb-chart-head">
            <p className="wb-result-title">
              <strong>{isDefaultSet ? "Solaris sample set: 40 Americas stations" : `Your selection: ${r.station_set.n_stations} stations`}</strong>
              <span className="sol-muted"> · trend change 1940–1979 → 1980–latest</span>
            </p>
            <SegmentedControl
              label="Season frame"
              size="sm"
              options={[
                { value: "hemi", label: "Winter / summer" },
                { value: "calendar", label: "Calendar D-J-F / J-J-A" },
              ]}
              value={frame}
              onChange={(v) => setFrame(v as "hemi" | "calendar")}
            />
          </div>
          <div className="wb-stats">
            {keys.map((k) => {
              const c = cellOf(g.all, k);
              return c ? (
                <Stat
                  key={k}
                  size="sm"
                  tone="atmosphere"
                  value={fmtSignedNum(c.mean_change)}
                  unit="°C/decade"
                  label={`Mean trend change · ${keyLabel(k)}`}
                  detail={`95% CI ${range(c.ci_low, c.ci_high, 2)} · ${pValue(c.p_value)} · ${c.n_increased} of ${c.n} stations increased, ${c.n_decreased} decreased · Wilcoxon ${pValue(c.wilcoxon_p_value)}`}
                  source={`Nexus 1.0 on the Solaris sample set (${STATION_PROVENANCE.split(" — ")[1]})`}
                />
              ) : null;
            })}
          </div>
          <div className="wb-grid2">
            {keys.map((k) => {
              const groups = [
                cellGroup("All stations", cellOf(g.all, k), "var(--sol-model-nexus)"),
                ...Object.entries(g.by.country ?? {}).map(([name, v]) => cellGroup(name, cellOf(v, k))),
                ...Object.entries(g.by.urban_rural ?? {}).map(([name, v]) => cellGroup(capital(classLabel(name)), cellOf(v, k))),
              ].filter((x): x is Group => !!x);
              return (
                <GroupCompareChart
                  key={k}
                  title={`Change in trend · ${keyLabel(k)}`}
                  unit="°C/decade"
                  reference={0}
                  referenceLabel="no change"
                  groups={groups}
                  footer="Mean of (1980–latest slope − 1940–1979 slope) per group; paired t-test, 95% CI"
                />
              );
            })}
          </div>
          <div className="wb-poster" data-testid="poster-note">
            <h4>For comparison: the research poster's reported values (the poster's numbers, not computed here)</h4>
            <p className="wb-note">
              Poster, 40 urban and rural U.S. and Argentine stations, hemisphere-adjusted: winter +{POSTER.winter.change} °C/decade (95% CI {POSTER.winter.lo}–{POSTER.winter.hi}, {POSTER.winter.p}),{" "}
              {POSTER.winter.up} increased; summer +{POSTER.summer.change} °C/decade (95% CI {POSTER.summer.lo}–{POSTER.summer.hi}, {POSTER.summer.p}), {POSTER.summer.up} increased.
            </p>
            <p className="wb-note">
              The Solaris sample set is a <strong>different station list from a different source</strong> (NOAA GHCN-M v4 adjusted, our own selection rules), so its numbers differ from the poster's.
              It is not a reproduction of the poster.
            </p>
          </div>
          <Callout tone="honesty" compact title="Caveats">
            Paired stations 44–345 km apart are correlated, so the station-level t-test overstates the effective sample size; the Wilcoxon p is a robustness check, not a fix. Night-light classes
            describe today, not 1940.
          </Callout>
          <Disclosure summary="Per-station trend changes">
            <div className="wb-table-wrap">
              <table className="wb-table wb-table--stack">
                <thead>
                  <tr>
                    <th scope="col">Station</th>
                    <th scope="col">D-J-F change</th>
                    <th scope="col">J-J-A change</th>
                  </tr>
                </thead>
                <tbody>
                  {r.station_set.stations.map((s) => (
                    <tr key={s.id}>
                      <th scope="row">
                        {s.name}
                        <span className="wb-ci">
                          {s.country} · {classLabel(s.urban_rural)}
                        </span>
                      </th>
                      <td className="sol-mono" data-label="D-J-F change">{perDecade(s.seasons["D-J-F"]?.change?.change)}</td>
                      <td className="sol-mono" data-label="J-J-A change">{perDecade(s.seasons["J-J-A"]?.change?.change)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Disclosure>
          <div className="wb-group">
            <div className="wb-group__title">
              Compute for your own selection
              <Button size="sm" variant="ghost" onClick={() => setSubsetOpen((o) => !o)} aria-expanded={subsetOpen}>
                {subsetOpen ? "Hide" : "Choose stations"}
              </Button>
            </div>
            {subsetOpen ? (
              <>
                <div className="wb-presets">
                  {presets.map(([name, f]) => (
                    <button key={name} type="button" className="wb-preset" onClick={() => setSelected(new Set(stations.filter(f).map((s) => s.id)))}>
                      {name}
                    </button>
                  ))}
                </div>
                <ul className="wb-check-list" aria-label="Stations in the selection">
                  {stations.map((s) => (
                    <li key={s.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const n = new Set(prev);
                              if (e.target.checked) n.add(s.id);
                              else n.delete(s.id);
                              return n;
                            })
                          }
                        />
                        <span>
                          {s.display_name} <span className="sol-muted">· {stationGroup(s)} · {classLabel(s.urban_rural)}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="sol-row">
                  <Button size="sm" onClick={runSubset} disabled={selected.size < 3} loading={runner.running}>
                    Compute for {selected.size} stations
                  </Button>
                  {selected.size < 3 ? <span className="wb-note">Choose at least 3 stations.</span> : <span className="wb-note">Runs in your browser in well under a second once Python is loaded.</span>}
                </div>
              </>
            ) : null}
          </div>
          <ExportBar
            csv={() => ({
              filename: "nexus_station_set.csv",
              text: toCsv(
                r.station_set.stations.map((s) => ({
                  id: s.id,
                  name: s.name,
                  country: s.country,
                  class: s.urban_rural,
                  hemisphere: s.hemisphere,
                  djf_early: s.seasons["D-J-F"]?.early?.slope,
                  djf_modern: s.seasons["D-J-F"]?.modern?.slope,
                  djf_change: s.seasons["D-J-F"]?.change?.change,
                  jja_early: s.seasons["J-J-A"]?.early?.slope,
                  jja_modern: s.seasons["J-J-A"]?.modern?.slope,
                  jja_change: s.seasons["J-J-A"]?.change?.change,
                })),
                ["id", "name", "country", "class", "hemisphere", "djf_early", "djf_modern", "djf_change", "jja_early", "jja_modern", "jja_change"],
                [`Nexus ${r.version} station-set trends (°C/decade), ${r.station_set.n_stations} stations`, STATION_PROVENANCE, "Sample-set statistics; not the poster's station list"],
              ),
            })}
            json={() => ({ filename: "nexus_station_set.json", data: { payload: saved.current, result: r } })}
            citation={() =>
              [
                `Nexus ${r.version} station-set statistics on the Solaris sample set (${r.station_set.n_stations} stations), ${today()}.`,
                `Data: ${STATION_PROVENANCE}. Not the research poster's 40-station list.`,
                r.station_set.method,
                TEAM_CREDIT + ".",
              ].join("\n")
            }
            onSave={onSaveRequest ? () => onSaveRequest({ model: "nexus", label: `Nexus 1.0 · station set (${r.station_set.n_stations})`, modelVersion: r.version, payload: saved.current, result: r }) : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}

function fmtSignedNum(v: number | null | undefined) {
  if (!isNum(v)) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v), 2)}`;
}

/* ======================= main ======================= */

export function NexusWorkbench({ compact, initialRun, onRunComplete, onSaveRequest, initialStationId }: WorkbenchProps & { initialStationId?: string }): JSX.Element {
  const bundle = useStationsBundle();
  const initialView: View = (initialRun?.payload as NexusSavedPayload | undefined)?.view === "set" ? "set" : "station";
  const [view, setView] = useState<View>(initialView);
  const stations = bundle.data?.stations ?? [];
  return (
    <section className={`wb ${compact ? "wb--compact" : ""}`} data-workbench="nexus" aria-label="Nexus 1.0 workbench">
      <WorkbenchHeader model="nexus" compact={compact} title="Validation and context: how well does Aeros do on data it never saw?" />
      <SegmentedControl
        label="Nexus view"
        options={[
          { value: "station", label: "Single station audit" },
          { value: "set", label: "Station set statistics" },
        ]}
        value={view}
        onChange={(v) => setView(v as View)}
      />
      {bundle.error ? (
        <Callout tone="danger" title="Could not load the station list">
          {bundle.error} <Button size="sm" variant="ghost" onClick={bundle.retry}>Retry</Button>
        </Callout>
      ) : null}
      {view === "station" ? (
        <StationView
          compact={compact}
          initial={initialView === "station" ? initialRun : undefined}
          onRunComplete={onRunComplete}
          onSaveRequest={onSaveRequest}
          initialStationId={initialStationId}
          stations={stations}
          bundleSourceUrl={bundle.data?.source_url}
        />
      ) : (
        <SetView stations={stations} initial={initialView === "set" ? initialRun : undefined} onRunComplete={onRunComplete} onSaveRequest={onSaveRequest} />
      )}
    </section>
  );
}
