import type { AerosSeries } from "../../../data";
import type { SeasonKey } from "../../../data";
import { toCsv } from "../../../data";
import type { AerosResult, AerosSeason } from "../results";
import { capital } from "../lib/fmt";

export type PathsChoice = 100 | 200 | 1000;
export type AerosUi = { endYear: number; paths: PathsChoice; seed: number };
export const AEROS_DEFAULTS: AerosUi = { endYear: 2100, paths: 200, seed: 42 };
export const isDefaultUi = (u: AerosUi) => u.endYear === 2100 && u.paths === 200 && u.seed === 42;

export function apiOptions(u: AerosUi): Record<string, unknown> {
  const base = { seed: u.seed, end_year: u.endYear };
  if (u.paths === 100) return { ...base, mode: "fast" };
  if (u.paths === 200) return { ...base, mode: "notebook" };
  return { ...base, mode: "notebook", n_bootstrap: u.paths };
}

export type Upload = {
  /** Used as station id and seed label (as the notebook used the file name). */
  name: string;
  fileName: string;
  hemisphere: "northern" | "southern" | "unknown";
  series: AerosSeries;
};

export function uploadSeasons(series: AerosSeries): Partial<Record<SeasonKey, (number | null)[]>> {
  const out: Partial<Record<SeasonKey, (number | null)[]>> = {};
  if (series["D-J-F"]) out["D-J-F"] = series["D-J-F"];
  if (series["J-J-A"]) out["J-J-A"] = series["J-J-A"];
  return out;
}

/** Payload stored with saved runs: station id or uploaded series, never the bundle. */
export type AerosSavedPayload = {
  station_id?: string;
  upload?: { name: string; fileName: string; hemisphere: Upload["hemisphere"]; years: number[]; seasons: Partial<Record<SeasonKey, (number | null)[]>> };
  options: Record<string, unknown>;
  ui: AerosUi;
};

/** Season label after hemisphere adjustment, e.g. "Winter (D-J-F)". */
export function seasonTitle(s: Pick<AerosSeason, "season" | "local_label"> | { season: SeasonKey; local_label?: string | null }): string {
  return s.local_label ? `${capital(s.local_label)} (${s.season})` : s.season;
}

/** Seasons ordered winter first (by local label). */
export function orderedSeasons(r: AerosResult): AerosSeason[] {
  const list = (["D-J-F", "J-J-A"] as SeasonKey[]).map((k) => r.seasons[k]).filter((x): x is AerosSeason => !!x);
  return list.sort((a, b) => (a.local_label === "winter" ? -1 : b.local_label === "winter" ? 1 : 0));
}

export function aerosCsv(r: AerosResult, stationLabel: string): string {
  type Row = Record<string, string | number | null | undefined>;
  const rows: Row[] = [];
  for (const s of orderedSeasons(r)) {
    const trend = new Map(s.trend.fitted.map((t) => [t.year, t.value]));
    for (const h of s.historical) {
      rows.push({
        season: s.season,
        local_season: s.local_label ?? "",
        year: h.year,
        kind: h.imputed ? "imputed" : "observed",
        observed_c: h.value,
        trend_c: trend.get(h.year),
        mean_c: null,
        lower_2_5_c: null,
        upper_97_5_c: null,
      });
    }
    for (const p of s.projection) {
      rows.push({
        season: s.season,
        local_season: s.local_label ?? "",
        year: p.year,
        kind: "projection",
        observed_c: null,
        trend_c: null,
        mean_c: p.mean,
        lower_2_5_c: p.lower,
        upper_97_5_c: p.upper,
      });
    }
  }
  const n = r.inputs.n_bootstrap as number | undefined;
  return toCsv(
    rows,
    ["season", "local_season", "year", "kind", "observed_c", "trend_c", "mean_c", "lower_2_5_c", "upper_97_5_c"],
    [
      `Aeros ${r.version} — ${stationLabel}`,
      `Settings: ${n ?? "?"} bootstrap paths, seed ${String(r.inputs.seed)}, seed label ${r.seed_label}, end year ${r.end_year}`,
      `Bounds = 2.5th–97.5th percentile of bootstrap paths (range of single seasons, not of the climate mean)`,
      `Data: ${String(r.provenance?.data_source ?? "")}`,
      r.disclaimer,
    ],
  );
}
