/**
 * Live mini-previews from precomputed model results (no Python needed):
 * Aeros 4.0 on the Washington, D.C. sample station, and CORe 4.0's CO₂ pathway.
 */
import { useEffect, useMemo, useState } from "react";
import { SegmentedControl, Skeleton } from "../../components/ui";
import { TimeSeriesChart } from "../../components/charts";
import type { TSSeries } from "../../components/charts";
import { fetchPrecomputed } from "../../runtime/precomputed";
import { fmt } from "../../lib/format";

type Pt = { year: number; value: number | null; imputed?: boolean };
type ProjPt = { year: number; mean: number; lower: number; upper: number };
type AerosSeason = {
  historical: Pt[];
  trend: { fitted: { year: number; value: number }[] };
  projection: ProjPt[];
  summary_end: { year: number; mean: number; lower: number; upper: number };
};
type AerosResult = { station: { name: string }; hist_start_year: number; hist_end_year: number; seasons: Record<string, AerosSeason> };
type CoreResult = {
  historical: { years: number[]; ppm: number[] };
  projection: { years: number[]; ppm_mean: number[]; ppm_lower: number[]; ppm_upper: number[] };
  summary_end: { year: number; ppm_mean: number; ppm_lower: number; ppm_upper: number };
};

export const WASHINGTON_ID = "USW00013743";

export function useWashington() {
  const [r, setR] = useState<AerosResult | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetchPrecomputed<AerosResult>("aeros", WASHINGTON_ID).then((x) => live && setR(x));
    return () => {
      live = false;
    };
  }, []);
  return r;
}

export function aerosSeries(s: AerosSeason): TSSeries[] {
  return [
    {
      id: "obs",
      label: "Observed",
      role: "observed",
      type: "points",
      data: s.historical.filter((p) => p.value != null && !p.imputed).map((p) => ({ x: p.year, y: p.value })),
    },
    { id: "trend", label: "Fitted trend", role: "trend", data: s.trend.fitted.map((p) => ({ x: p.year, y: p.value })) },
    {
      id: "proj",
      label: "Aeros 4.0 mean",
      role: "projection",
      bandLabel: "95% range",
      data: s.projection.map((p) => ({ x: p.year, y: p.mean, lower: p.lower, upper: p.upper })),
    },
  ];
}

type View = "winter" | "summer" | "co2";

export function PreviewCharts({ height }: { height?: number }) {
  const [view, setView] = useState<View>("winter");
  const dc = useWashington();
  const [core, setCore] = useState<CoreResult | null | undefined>(undefined);
  useEffect(() => {
    if (view !== "co2" || core !== undefined) return;
    let live = true;
    fetchPrecomputed<CoreResult>("core", "default").then((x) => live && setCore(x));
    return () => {
      live = false;
    };
  }, [view, core]);

  const chart = useMemo(() => {
    if (view === "co2") {
      if (!core) return null;
      const end = core.summary_end;
      return (
        <TimeSeriesChart
          title="Global CO₂ — CORe 4.0 historical-continuation pathway"
          description={`Observed global CO₂ to 2025 and CORe 4.0 projection to 2100: ${fmt(end.ppm_mean)} ppm (range ${fmt(end.ppm_lower)}–${fmt(end.ppm_upper)}).`}
          unit="ppm"
          projectionStart={core.projection.years[0]}
          height={height}
          digits={1}
          series={[
            { id: "obs", label: "Observed", role: "observed", data: core.historical.years.map((y, i) => ({ x: y, y: core.historical.ppm[i] })) },
            {
              id: "proj",
              label: "CORe 4.0 mean",
              role: "projection",
              bandLabel: "Backtest-based range",
              data: core.projection.years.map((y, i) => ({ x: y, y: core.projection.ppm_mean[i], lower: core.projection.ppm_lower[i], upper: core.projection.ppm_upper[i] })),
            },
          ]}
          footer={
            <>
              CORe 4.0 run on NOAA GML global CO₂ (RCMIP before 1979), precomputed — the same code and data as the poster:
              <strong> {fmt(end.ppm_mean)} ppm in {end.year}</strong> ({fmt(end.ppm_lower)}–{fmt(end.ppm_upper)}). A continuation
              of historical growth, not an IPCC emissions scenario.
            </>
          }
        />
      );
    }
    if (!dc) return null;
    const key = view === "winter" ? "D-J-F" : "J-J-A";
    const s = dc.seasons[key];
    if (!s) return null;
    const e = s.summary_end;
    return (
      <TimeSeriesChart
        title={`${dc.station.name} — ${view} (${key}) mean temperature`}
        description={`Observed ${view} means ${dc.hist_start_year}–${dc.hist_end_year} and Aeros 4.0 projection to 2100: ${fmt(e.mean)} °C (95% range ${fmt(e.lower)}–${fmt(e.upper)}).`}
        unit="°C"
        projectionStart={dc.hist_end_year + 1}
        height={height}
        digits={1}
        series={aerosSeries(s)}
        footer={
          <>
            Aeros 4.0 run on the Solaris sample station set (NOAA GHCN-M v4 adjusted, {dc.hist_start_year}–{dc.hist_end_year}),
            precomputed: <strong>{fmt(e.mean)} °C in {e.year}</strong> (95% range {fmt(e.lower)}–{fmt(e.upper)}). The poster’s{" "}
            {view === "winter" ? "9.00" : "30.21"} °C came from the team’s own 1938–2026 file — different input, so a different
            number. Conditional model output.
          </>
        }
      />
    );
  }, [view, dc, core, height]);

  return (
    <div className="site-preview">
      <SegmentedControl
        label="Preview"
        size="sm"
        value={view}
        onChange={setView}
        options={[
          { value: "winter", label: "Aeros · D.C. winter" },
          { value: "summer", label: "Aeros · D.C. summer" },
          { value: "co2", label: "CORe · CO₂" },
        ]}
      />
      <div className="site-preview__chart">
        {chart ?? (
          (view === "co2" ? core === null : dc === null) ? (
            <p className="sol-muted">Preview data is not available in this build.</p>
          ) : (
            <Skeleton height={height ?? 360} />
          )
        )}
      </div>
    </div>
  );
}
