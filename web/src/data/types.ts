/**
 * Types for the bundled datasets in public/data/ (produced under ../data by the
 * data agents; copied by scripts/sync-data.mjs). Field names mirror the JSON.
 */

export type SeasonKey = "D-J-F" | "J-J-A";
export const SEASONS: SeasonKey[] = ["D-J-F", "J-J-A"];

/* ---------------- stations_bundle.json (schema "solaris.stations_bundle/1") ---------------- */

export type Station = {
  id: string;
  name: string;
  display_name: string;
  country: string;
  region?: string | null;
  lat: number;
  lon: number;
  elevation_m?: number | null;
  urban_rural?: "urban" | "rural" | string | null;
  pair_id?: string | null;
  pair_role?: string | null;
  pair_partner_id?: string | null;
  pair_distance_km?: number | null;
  set?: string | null;
  hemisphere: "northern" | "southern" | string;
  /** Calendar season → local season name, e.g. {"D-J-F": "winter"} (flipped in the south). */
  local_season: Record<SeasonKey, string>;
  first_year: number;
  last_year: number;
  coverage_note?: string | null;
  brightness_index?: number | null;
  valid_counts?: Partial<Record<SeasonKey, number>>;
  series: { years: number[] } & Record<SeasonKey, (number | null)[]>;
};

export type StationsBundle = {
  schema: string;
  station_set?: string;
  generated?: string;
  dataset?: string;
  source_url?: string;
  inventory_url?: string;
  source_file?: string;
  units?: string;
  season_convention?: string;
  note?: string;
  stations: Station[];
  [k: string]: unknown;
};

/* ---------------- co2_bundle.json (schema "solaris.co2_bundle.v1") ---------------- */

export type YearSeries = { years: number[]; ppm: (number | null)[] };

export type Co2Bundle = {
  schema: string;
  retrieved?: string;
  notes?: string;
  sources: Record<string, string>;
  /** CORe 4.0 input (notebook cell07). */
  historical_co2: YearSeries & { description?: string; source?: string[] };
  noaa_global_annual?: YearSeries & { unc_ppm?: (number | null)[] };
  noaa_mlo_annual?: YearSeries & { unc_ppm?: (number | null)[] };
  rcmip?: {
    years: number[];
    scenarios: string[];
    emissions_native_years?: number[];
    concentrations_ppm: Record<string, (number | null)[]>;
    emissions_gtco2: Record<string, { total: (number | null)[]; ffi?: (number | null)[]; afolu?: (number | null)[] }>;
    erf_wm2: Record<string, { total: (number | null)[]; anthro?: (number | null)[]; anthro_co2?: (number | null)[] }>;
  };
  [k: string]: unknown;
};

/** What scripts/sync-data.mjs found (public/data/available.json). */
export type DataAvailability = {
  generated: string;
  bundles: Partial<Record<"stations" | "co2", { path: string; bytes: number }>>;
  downloads: { name: string; path: string; bytes: number }[];
  precomputed: Record<string, number>;
  /** e.g. "data/stations-csv/" — per-station CSVs named <station id>.csv, or null. */
  stationCsvDir: string | null;
};

/* ---------------- generic series used by charts / CSV ---------------- */

export type Point = { year: number; value: number | null };
