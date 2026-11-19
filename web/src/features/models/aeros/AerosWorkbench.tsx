/**
 * Aeros 4.0 workbench — seasonal station temperature projection to 2100.
 * Precomputed default results for bundled stations (instant), live Pyodide runs otherwise.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Button, Callout, SegmentedControl, Skeleton, Slider, Stat } from "../../../components/ui";
import { TimeSeriesChart } from "../../../components/charts";
import type { TSSeries } from "../../../components/charts";
import type { SeasonKey, Station } from "../../../data";
import { fetchPrecomputed } from "../../../runtime";
import type { AerosResult, AerosSeason } from "../results";
import type { SavedRun, WorkbenchProps } from "../types";
import { DEFAULT_STATION_ID, STATION_PROVENANCE, useStationsBundle } from "../lib/bundles";
import { degC, degCSigned, fmt, isNum, perDecade, range } from "../lib/fmt";
import { useOpenInAeros } from "../lib/selection";
import { useWorkbenchRun } from "../lib/useWorkbenchRun";
import { Disclosure, ExportBar, KV, RunStatus, SectionTitle, TEAM_CREDIT, today, Warnings, WeightBar, WorkbenchHeader } from "../components/common";
import { StationPicker } from "../components/StationPicker";
import { CsvUpload } from "./CsvUpload";
import { AEROS_DEFAULTS, aerosCsv, apiOptions, isDefaultUi, orderedSeasons, seasonTitle, uploadSeasons } from "./aerosShared";
import type { AerosSavedPayload, AerosUi, PathsChoice, Upload } from "./aerosShared";
import "../models.css";

type Src = { kind: "station"; id: string } | { kind: "upload"; upload: Upload };

const MEMBER_LABEL: Record<string, string> = {
  poly2: "Quadratic trend (poly2)",
  pchip: "PCHIP extrapolation",
  ridge: "Ridge regression",
  lin_modern: "Linear trend since 1980",
};

function localLabel(season: SeasonKey, hemi: string): "winter" | "summer" | null {
  if (hemi === "northern") return season === "D-J-F" ? "winter" : "summer";
  if (hemi === "southern") return season === "D-J-F" ? "summer" : "winter";
  return null;
}

/** Labels follow the chosen hemisphere for uploads (labels only; numbers unchanged). */
function relabel(r: AerosResult, hemi: string): AerosResult {
  const seasons: AerosResult["seasons"] = {};
  for (const k of Object.keys(r.seasons) as SeasonKey[]) {
    const s = r.seasons[k];
    if (s) seasons[k] = { ...s, local_label: localLabel(k, hemi) };
  }
  return { ...r, station: { ...r.station, hemisphere: hemi }, seasons };
}

function restoreFrom(run: SavedRun | undefined): { src: Src | null; ui: AerosUi } {
  const p = (run?.payload ?? null) as AerosSavedPayload | null;
  if (!p) return { src: null, ui: AEROS_DEFAULTS };
  const ui = p.ui ?? AEROS_DEFAULTS;
  if (p.upload) {
    const seasons = p.upload.seasons;
    return {
      src: {
        kind: "upload",
        upload: {
          name: p.upload.name,
          fileName: p.upload.fileName,
          hemisphere: p.upload.hemisphere,
          series: { years: p.upload.years, "D-J-F": seasons["D-J-F"] ?? null, "J-J-A": seasons["J-J-A"] ?? null },
        },
      },
      ui,
    };
  }
  if (p.station_id) return { src: { kind: "station", id: p.station_id }, ui };
  return { src: null, ui };
}

export function AerosWorkbench({ compact, initialRun, onRunComplete, onSaveRequest, initialStationId }: WorkbenchProps & { initialStationId?: string }): JSX.Element {
  const uid = useId();
  const rootRef = useRef<HTMLElement>(null);
  const bundle = useStationsBundle();
  const restored = useMemo(() => restoreFrom(initialRun), [initialRun]);
  const [src, setSrc] = useState<Src>(restored.src ?? { kind: "station", id: initialStationId ?? DEFAULT_STATION_ID });
  const [ui, setUi] = useState<AerosUi>(restored.ui);
  const [seedDraft, setSeedDraft] = useState(String(restored.ui.seed));
  const [endDraft, setEndDraft] = useState(restored.ui.endYear);
  const [inputMode, setInputMode] = useState<"station" | "upload">(restored.src?.kind === "upload" ? "upload" : "station");
  const [prefLocal, setPrefLocal] = useState<"winter" | "summer">("winter");
  const runner = useWorkbenchRun<AerosResult>("aeros", `aeros-${uid}`);
  const lastStation = useRef<string>(src.kind === "station" ? src.id : initialStationId ?? DEFAULT_STATION_ID);

  // Restore a saved run without re-running.
  useEffect(() => {
    if (initialRun?.result) runner.show(initialRun.result as AerosResult, { kind: "saved", label: initialRun.label });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRun]);

  // External station requests (prop change, DatasetLibrary "Open in Aeros").
  const firstProp = useRef(true);
  useEffect(() => {
    if (firstProp.current) {
      firstProp.current = false;
      return;
    }
    if (initialStationId) {
      setInputMode("station");
      setSrc({ kind: "station", id: initialStationId });
    }
  }, [initialStationId]);
  useOpenInAeros(
    useCallback((id: string) => {
      setInputMode("station");
      setSrc({ kind: "station", id });
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, []),
  );

  const stations = bundle.data?.stations ?? [];
  const station: Station | undefined = src.kind === "station" ? stations.find((s) => s.id === src.id) : undefined;
  const sourceLabel = src.kind === "station" ? station?.display_name ?? src.id : `Your data: ${src.upload.fileName}`;

  const buildPayload = useCallback((): { payload: object; saved: AerosSavedPayload } | null => {
    const options = apiOptions(ui);
    if (src.kind === "station") {
      const st = bundle.data?.stations.find((s) => s.id === src.id);
      if (!st) return null;
      return {
        payload: { station: st, options, provenance: { data_source: STATION_PROVENANCE, source_url: bundle.data?.source_url ?? null } },
        saved: { station_id: st.id, options, ui },
      };
    }
    const u = src.upload;
    const seasons = uploadSeasons(u.series);
    return {
      payload: {
        station: { id: u.name, name: u.name, display_name: u.fileName, ...(u.hemisphere !== "unknown" ? { hemisphere: u.hemisphere } : {}) },
        years: u.series.years,
        seasons,
        options,
        provenance: { data_source: `uploaded by the user (${u.fileName}); processed in the browser only` },
      },
      saved: { upload: { name: u.name, fileName: u.fileName, hemisphere: u.hemisphere, years: u.series.years, seasons }, options, ui },
    };
  }, [src, ui, bundle.data]);

  const savedPayload = useRef<AerosSavedPayload | null>(initialRun ? (initialRun.payload as AerosSavedPayload) : null);

  const reqKey = src.kind === "station" ? `s:${src.id}:${ui.endYear}:${ui.paths}:${ui.seed}` : `u:${src.upload.fileName}:${src.upload.series.years.length}:${ui.endYear}:${ui.paths}:${ui.seed}`;
  const bundleReady = !!bundle.data;

  // Key of a restored saved run: not recomputed until the user changes something.
  const handled = useRef<string | null>(initialRun?.result ? reqKey : null);

  useEffect(() => {
    if (!bundleReady) return;
    if (handled.current === reqKey) return;
    handled.current = reqKey;
    let cancelled = false;
    let timer: number | undefined;
    const live = () => {
      const b = buildPayload();
      if (!b) return;
      timer = window.setTimeout(async () => {
        const r = await runner.run(b.payload);
        if (r && !cancelled) {
          savedPayload.current = b.saved;
          onRunComplete?.({ model: "aeros", label: `Aeros 4.0 · ${r.station?.name ?? sourceLabel}`, modelVersion: r.version, payload: b.saved, result: r });
        }
      }, 250);
    };
    if (src.kind === "station" && isDefaultUi(ui)) {
      void fetchPrecomputed<AerosResult>("aeros", src.id).then((pre) => {
        if (cancelled) return;
        if (pre) {
          savedPayload.current = { station_id: src.id, options: apiOptions(ui), ui };
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
  }, [reqKey, bundleReady]);

  const result0 = runner.result;
  const result = useMemo(() => (result0 && src.kind === "upload" && result0.seed_label === src.upload.name ? relabel(result0, src.upload.hemisphere) : result0), [result0, src]);
  const seasons = result ? orderedSeasons(result) : [];
  const sel: AerosSeason | undefined = seasons.find((s) => s.local_label === prefLocal) ?? seasons.find((s) => s.season === (prefLocal === "winter" ? "D-J-F" : "J-J-A")) ?? seasons[0];
  const resultLabel = result?.station?.name ?? sourceLabel;
  const nPaths = (result?.inputs?.n_bootstrap as number | undefined) ?? sel?.n_bootstrap;

  const setUiKey = <K extends keyof AerosUi>(k: K, v: AerosUi[K]) => setUi((u) => ({ ...u, [k]: v }));
  const commitSeed = () => {
    const n = Math.round(Number(seedDraft));
    if (Number.isFinite(n) && n >= 0 && n <= 2 ** 31 - 1) setUiKey("seed", n);
    else setSeedDraft(String(ui.seed));
  };

  const makeSaved = (): SavedRun | null =>
    result ? { model: "aeros", label: `Aeros 4.0 · ${resultLabel}`, modelVersion: result.version, payload: savedPayload.current ?? buildPayload()?.saved, result } : null;

  const citation = () => {
    if (!result) return "";
    return [
      `Aeros ${result.version} (ported from the Solaris team notebook), ${runner.source?.kind === "live" ? "computed in the browser" : runner.source?.kind === "precomputed" ? "precomputed default result" : "saved run"}, ${today()}.`,
      `Station: ${resultLabel}${result.station?.id ? ` (${result.station.id})` : ""}. Data: ${src.kind === "station" ? STATION_PROVENANCE : "user-supplied series"}.`,
      `Settings: ${nPaths ?? "?"} bootstrap paths, seed ${String(result.inputs.seed)} (label ${result.seed_label}), projection to ${result.end_year}.`,
      ...orderedSeasons(result).map(
        (s) => `${seasonTitle(s)} ${s.summary_end.year}: ${fmt(s.summary_end.mean, 2)} °C (95% range of single seasons ${fmt(s.summary_end.lower, 2)}–${fmt(s.summary_end.upper, 2)} °C).`,
      ),
      result.disclaimer,
      TEAM_CREDIT + ".",
    ].join("\n");
  };

  const chartSeries: TSSeries[] = useMemo(() => {
    if (!sel) return [];
    const obs = sel.historical.filter((h) => !h.imputed).map((h) => ({ x: h.year, y: h.value }));
    const imp = sel.historical.filter((h) => h.imputed).map((h) => ({ x: h.year, y: h.value }));
    const s: TSSeries[] = [
      { id: "obs", label: "Observed", role: "observed", type: "points", data: obs },
      { id: "trend", label: "Fitted trend (quadratic)", role: "trend", data: sel.trend.fitted.map((t) => ({ x: t.year, y: t.value })) },
      {
        id: "proj",
        label: "Aeros 4.0 projection (mean)",
        role: "projection",
        data: sel.projection.map((p) => ({ x: p.year, y: p.mean, lower: p.lower, upper: p.upper })),
        bandLabel: "95% range of single seasons",
      },
    ];
    if (imp.length) s.splice(1, 0, { id: "imp", label: "Filled gap (PCHIP)", role: "other", type: "points", color: "var(--sol-data-5)", data: imp });
    return s;
  }, [sel]);

  const loadingFirst = !result && !runner.error;
  const dominant = sel ? [...sel.ensemble.members].sort((a, b) => b.weight - a.weight)[0] : undefined;

  const controls = (
    <div className="wb-controls" aria-label="Aeros settings">
      <SegmentedControl
        label="Input data"
        block
        options={[
          { value: "station", label: "Sample stations" },
          { value: "upload", label: "Use your own data" },
        ]}
        value={inputMode}
        onChange={(v) => {
          setInputMode(v);
          if (v === "station" && src.kind === "upload") setSrc({ kind: "station", id: lastStation.current });
        }}
      />
      {inputMode === "station" ? (
        bundle.error ? (
          <Callout tone="danger" title="Could not load the station list">
            {bundle.error} <Button size="sm" variant="ghost" onClick={bundle.retry}>Retry</Button>
          </Callout>
        ) : stations.length ? (
          <StationPicker
            stations={stations}
            value={src.kind === "station" ? src.id : null}
            placeholderValue={src.kind === "upload" ? `Your data: ${src.upload.fileName}` : undefined}
            onChange={(id) => {
              lastStation.current = id;
              setSrc({ kind: "station", id });
            }}
          />
        ) : (
          <Skeleton height={64} />
        )
      ) : (
        <CsvUpload
          current={src.kind === "upload" ? src.upload : null}
          onUpload={(u) => setSrc({ kind: "upload", upload: u })}
          onHemisphere={(h) => setSrc((s) => (s.kind === "upload" ? { kind: "upload", upload: { ...s.upload, hemisphere: h } } : s))}
        />
      )}
      <div className={compact ? "wb-controls__more" : "wb-controls__group"}>
        {compact ? null : <p className="wb-controls__heading">Settings</p>}
        <div className="sol-field">
          <span className="sol-field__label" id={`${uid}-paths`}>
            Bootstrap paths
          </span>
          <SegmentedControl<string>
            label="Bootstrap paths"
            block
            size="sm"
            options={[
              { value: "100", label: "100 · fast", hint: "Fast mode for phones (100 paths)" },
              { value: "200", label: "200 · notebook", hint: "The team notebook's recorded setting" },
              { value: "1000", label: "1000 · stable", hint: "Smaller Monte-Carlo noise; ~5× slower" },
            ]}
            value={String(ui.paths)}
            onChange={(v) => setUiKey("paths", Number(v) as PathsChoice)}
          />
          <p className="sol-field__hint">200 reproduces the notebook. With 200 paths re-seeding moves the 2100 mean by about ±0.15 °C; 1000 is steadier.</p>
        </div>
        <Slider
          label="Project to"
          min={2040}
          max={2100}
          step={5}
          value={endDraft}
          format={(v) => String(v)}
          onChange={setEndDraft}
          onCommit={(v) => setUiKey("endYear", v)}
        />
        <div className="sol-field">
          <label className="sol-field__label" htmlFor={`${uid}-seed`}>
            Random seed
          </label>
          <div className="wb-seed">
            <input
              id={`${uid}-seed`}
              className="wb-input sol-mono"
              inputMode="numeric"
              value={seedDraft}
              onChange={(e) => setSeedDraft(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={commitSeed}
              onKeyDown={(e) => e.key === "Enter" && commitSeed()}
              data-testid="aeros-seed"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const n = Math.floor(Math.random() * 100000);
                setSeedDraft(String(n));
                setUiKey("seed", n);
              }}
            >
              New seed
            </Button>
          </div>
          <p className="sol-field__hint">42 = notebook. The draw also depends on the station id (seed label).</p>
        </div>
        {!isDefaultUi(ui) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setUi(AEROS_DEFAULTS);
              setSeedDraft("42");
              setEndDraft(2100);
            }}
          >
            Reset to notebook defaults
          </Button>
        ) : null}
      </div>
    </div>
  );

  const headline = result ? (
    <div className="wb-stats" data-testid="aeros-headline">
      {seasons.map((s) => (
        <button
          key={s.season}
          type="button"
          className={`wb-stat-btn ${sel?.season === s.season ? "is-active" : ""}`}
          onClick={() => s.local_label && setPrefLocal(s.local_label)}
          aria-pressed={sel?.season === s.season}
        >
          <Stat
            size="sm"
            tone={sel?.season === s.season ? "solar" : "default"}
            value={fmt(s.summary_end.mean, 1)}
            unit="°C"
            label={`${seasonTitle(s)} mean, ${s.summary_end.year}`}
            detail={`95% range of a single season ${range(s.summary_end.lower, s.summary_end.upper, 1, "°C")}${isNum(s.summary_end.mc_standard_error_of_mean) ? ` · Monte-Carlo SE ±${fmt(s.summary_end.mc_standard_error_of_mean, 2)} °C` : ""}`}
            source={`Aeros ${result.version} · ${nPaths ?? "?"} paths, seed ${String(result.inputs.seed)}`}
          />
        </button>
      ))}
    </div>
  ) : null;

  const slopes = result ? (
    <div className="wb-table-wrap">
      <table className="wb-table wb-table--stack" data-testid="aeros-slopes">
        <caption className="sol-visually-hidden">Trend slopes in °C per decade</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {seasons.map((s) => (
              <th scope="col" key={s.season}>
                {seasonTitle(s)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{seasons[0]?.slopes.historical_range ?? "1940–1979"} observed</th>
            {seasons.map((s) => (
              <td key={s.season} className="sol-mono" data-label={seasonTitle(s)}>
                {perDecade(s.slopes.historical_1940_1979)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">{seasons[0]?.slopes.modern_range ?? "1980–latest"} observed</th>
            {seasons.map((s) => (
              <td key={s.season} className="sol-mono" data-label={seasonTitle(s)}>
                {perDecade(s.slopes.modern)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">{seasons[0]?.slopes.future_range ?? "Projected"} projected</th>
            {seasons.map((s) => (
              <td key={s.season} className="sol-mono" data-label={seasonTitle(s)}>
                {perDecade(s.slopes.future_mean)}
                <span className="wb-ci">95% CI {range(s.slopes.future_ci_low, s.slopes.future_ci_high, 2)}</span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="wb-note">
        Observed slopes are OLS fits to the series Aeros used (filled gaps included). The projected CI is the 2.5–97.5% range of per-path slopes. Nexus reports observed-only slopes with standard errors.
      </p>
    </div>
  ) : null;

  const ensemble = sel ? (
    <div className="wb-table-wrap">
      {dominant && dominant.weight >= 0.6 ? (
        <Callout tone="honesty" compact title={`One member dominates: ${MEMBER_LABEL[dominant.name] ?? dominant.name} carries ${fmt(dominant.weight * 100, 0)}% of the weight`}>
          In practice this projection is mostly {dominant.description ? dominant.description.charAt(0).toLowerCase() + dominant.description.slice(1) : dominant.name}, continued forward with year-to-year noise. Weights come from stacking on decadal hindcasts.
        </Callout>
      ) : null}
      <table className="wb-table wb-table--stack" data-testid="aeros-ensemble">
        <caption className="sol-visually-hidden">Ensemble members, weights and hindcast errors for {seasonTitle(sel)}</caption>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Weight</th>
            <th scope="col">Hindcast MAE</th>
            <th scope="col">RMSE</th>
            <th scope="col">Bias</th>
          </tr>
        </thead>
        <tbody>
          {[...sel.ensemble.members]
            .sort((a, b) => b.weight - a.weight)
            .map((m) => (
              <tr key={m.name}>
                <th scope="row">
                  {MEMBER_LABEL[m.name] ?? m.name}
                  {isNum(m.sanity_pass_fraction) ? <span className="wb-ci">passes 2 °C/decade check in {fmt(m.sanity_pass_fraction * 100, 0)}% of paths</span> : null}
                </th>
                <td data-label="Weight">
                  <span className="wb-weight">
                    <WeightBar value={m.weight} label={`${m.name} weight`} />
                    <span className="sol-mono">{fmt(m.weight * 100, 1)}%</span>
                  </span>
                </td>
                <td className="sol-mono" data-label="Hindcast MAE">{degC(m.hindcast_mae, 2)}</td>
                <td className="sol-mono" data-label="RMSE">{isNum(m.hindcast_rmse) && m.hindcast_rmse > 50 ? `${fmt(m.hindcast_rmse, 0)} °C` : degC(m.hindcast_rmse, 2)}</td>
                <td className="sol-mono" data-label="Bias">{degCSigned(m.hindcast_bias, 2)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <p className="wb-note">
        {sel.ensemble.error_sign_convention ?? "error = prediction − observed"}. Decadal hindcast folds up to {sel.ensemble.validation_year ?? "—"}
        {sel.ensemble.stacked_hindcast
          ? `; stacked ensemble: MAE ${degC(sel.ensemble.stacked_hindcast.mae, 2)}, RMSE ${degC(sel.ensemble.stacked_hindcast.rmse, 2)}, bias ${degCSigned(sel.ensemble.stacked_hindcast.bias, 2)} over ${sel.ensemble.stacked_hindcast.n_points} points`
          : ""}
        .
      </p>
    </div>
  ) : null;

  const dq = sel?.data_quality;
  const quality = dq ? (
    <KV
      rows={[
        ["Years with data", `${dq.first_year}–${dq.last_year} · ${dq.n_observed} observed seasons`],
        ["Filled gaps (PCHIP)", dq.imputed_years.length ? dq.imputed_years.join(", ") : "none"],
        ["Still missing", dq.missing_after_imputation.length ? dq.missing_after_imputation.join(", ") : "none"],
        ["Longest gap", `${dq.longest_internal_gap_years} yr`],
        ["Outlier years flagged", dq.outlier_years.length ? dq.outlier_years.join(", ") : "none"],
        ["Missing-value markers removed", String(dq.sentinel_values_removed)],
        ["Years in 1940–1979", String(dq.n_years_1940_1979 ?? "—")],
        ["Enough data for Aeros", dq.sufficient ? "yes" : "no"],
      ]}
    />
  ) : null;

  const howTo = (
    <Disclosure summary="How to read this" testId="aeros-howto">
      <ul className="wb-list">
        <li>
          <strong>The band is the spread of single seasons.</strong> It is the 2.5–97.5% range across bootstrap paths of one season's mean temperature, so it is dominated by year-to-year
          variability. It is not the uncertainty of the 2100 climate mean, which is much narrower, and it has no structural or emissions-scenario component.
        </li>
        <li>
          <strong>Statistical continuation, not a climate scenario.</strong> Aeros extends this station's own record (trend models plus AR(1) noise). It is not conditioned on any
          emissions pathway; for scenario questions see Catalyst.
        </li>
        <li>
          <strong>Conditional model output, not a verified prediction.</strong> See Nexus for how Aeros performs when trained to 2000 and tested on 2001 onward.
        </li>
        <li>Monte-Carlo noise: with 200 paths the 2100 mean moves by roughly ±0.15 °C between seeds. Quote it as “about”, or use 1000 paths.</li>
      </ul>
    </Disclosure>
  );

  return (
    <section ref={rootRef} className={`wb ${compact ? "wb--compact" : ""}`} data-workbench="aeros" aria-label="Aeros 4.0 workbench">
      <WorkbenchHeader model="aeros" compact={compact} />
      <div className="wb-layout">
        <aside className="wb-layout__side">{controls}</aside>
        <div className="wb-layout__main">
          <RunStatus running={runner.running} coldStart={runner.coldStart} source={runner.source} error={runner.error} onRetry={runner.retry} />
          {loadingFirst ? (
            <div className="wb-skel" aria-busy="true">
              <Skeleton height={88} />
              <Skeleton height={320} />
            </div>
          ) : null}
          {result && sel ? (
            <div className={`wb-results ${runner.running ? "is-stale" : ""}`} aria-busy={runner.running}>
              <p className="wb-result-title">
                <strong>{resultLabel}</strong>
                <span className="sol-muted">
                  {" "}
                  · {result.hist_start_year}–{result.hist_end_year} observed · projection to {result.end_year}
                </span>
              </p>
              {headline}
              <div className="wb-chart-head">
                <SegmentedControl<SeasonKey>
                  label="Season"
                  size="sm"
                  options={seasons.map((s) => ({ value: s.season, label: seasonTitle(s) }))}
                  value={sel.season}
                  onChange={(k) => {
                    const s = seasons.find((x) => x.season === k);
                    if (s?.local_label) setPrefLocal(s.local_label);
                    else setPrefLocal(k === "D-J-F" ? "winter" : "summer");
                  }}
                />
              </div>
              <div data-testid="aeros-chart">
                <TimeSeriesChart
                  title={`${resultLabel} · ${seasonTitle(sel)} mean temperature`}
                  description={`Observed seasonal means ${result.hist_start_year}–${result.hist_end_year}, fitted trend, and Aeros projection to ${result.end_year} with the 95% range of single seasons.`}
                  unit="°C"
                  digits={1}
                  projectionStart={sel.projection[0]?.year}
                  series={chartSeries}
                  height={compact ? 260 : undefined}
                  footer={`${src.kind === "station" ? STATION_PROVENANCE : "Your uploaded data (kept in this browser)"} · Aeros ${result.version} · conditional model output`}
                />
              </div>
              <Warnings warnings={result.warnings} title="Data notes" />
              {compact ? (
                <>
                  <Disclosure summary="Trend slopes (°C/decade)">{slopes}</Disclosure>
                  <Disclosure summary={`Ensemble weights · ${seasonTitle(sel)}`}>{ensemble}</Disclosure>
                  <Disclosure summary={`Data quality · ${seasonTitle(sel)}`}>{quality}</Disclosure>
                </>
              ) : (
                <div className="wb-grid2">
                  <div>
                    <SectionTitle>Trend slopes</SectionTitle>
                    {slopes}
                  </div>
                  <div>
                    <SectionTitle>Data quality · {seasonTitle(sel)}</SectionTitle>
                    {quality}
                  </div>
                  <div className="wb-span2">
                    <SectionTitle>Ensemble members · {seasonTitle(sel)}</SectionTitle>
                    {ensemble}
                  </div>
                </div>
              )}
              {howTo}
              <Callout tone="honesty" compact>
                {result.disclaimer}
              </Callout>
              <ExportBar
                csv={() => ({ filename: `aeros_${(result.station?.id ?? "station").replace(/[^\w-]+/g, "_")}_${result.end_year}.csv`, text: aerosCsv(result, resultLabel) })}
                json={() => ({ filename: `aeros_${(result.station?.id ?? "station").replace(/[^\w-]+/g, "_")}.json`, data: { payload: savedPayload.current, result } })}
                citation={citation}
                onSave={
                  onSaveRequest
                    ? () => {
                        const s = makeSaved();
                        if (s) onSaveRequest(s);
                      }
                    : undefined
                }
              />
            </div>
          ) : null}
          {result && !sel ? <Callout tone="warning" title="No season had enough data">Aeros needs at least 10 years in a season. Skipped: {result.skipped_seasons.join(", ")}</Callout> : null}
        </div>
      </div>
    </section>
  );
}
