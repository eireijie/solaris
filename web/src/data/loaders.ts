/**
 * Typed loaders for public/data/*. Each loader fetches once and caches the promise.
 * They reject with a readable Error if the file is missing (run `npm run sync`).
 */
import { publicUrl } from "../lib/paths";
import type { Co2Bundle, DataAvailability, Point, SeasonKey, Station, StationsBundle } from "./types";

const cache = new Map<string, Promise<unknown>>();

export function fetchJson<T>(path: string): Promise<T> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(publicUrl(path)).then(async (r) => {
      if (!r.ok) throw new Error(`Could not load ${path} (HTTP ${r.status})`);
      if ((r.headers.get("content-type") ?? "").includes("text/html")) throw new Error(`Could not load ${path} (not found)`);
      return r.json();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p as Promise<T>;
}

export async function loadStationsBundle(): Promise<StationsBundle> {
  const b = await fetchJson<StationsBundle>("data/stations_bundle.json");
  if (!Array.isArray(b.stations)) throw new Error("stations_bundle.json: missing `stations` array");
  return b;
}

export async function loadCo2Bundle(): Promise<Co2Bundle> {
  const b = await fetchJson<Co2Bundle>("data/co2_bundle.json");
  if (!b.historical_co2?.years) throw new Error("co2_bundle.json: missing `historical_co2`");
  return b;
}

/** What data files exist in this build (downloads, precomputed counts). */
export function loadDataAvailability(): Promise<DataAvailability> {
  return fetchJson<DataAvailability>("data/available.json");
}

/* ---------------- helpers ---------------- */

export function findStation(bundle: StationsBundle, id: string): Station | undefined {
  return bundle.stations.find((s) => s.id === id);
}

/** One season of a station as points (nulls kept, so charts can show gaps). */
export function stationSeason(station: Station, season: SeasonKey): Point[] {
  const ys = station.series.years;
  const vs = station.series[season] ?? [];
  return ys.map((year, i) => ({ year, value: vs[i] ?? null }));
}

/** Local season name for display, e.g. "Winter (D-J-F)". Handles the southern-hemisphere flip. */
export function seasonLabel(station: Pick<Station, "local_season"> | null, season: SeasonKey): string {
  const local = station?.local_season?.[season];
  const name = local ? local[0].toUpperCase() + local.slice(1) : season === "D-J-F" ? "Winter" : "Summer";
  return `${name} (${season})`;
}

/** Zip two arrays into points. */
export function toPoints(years: number[], values: (number | null)[]): Point[] {
  return years.map((year, i) => ({ year, value: values[i] ?? null }));
}

/** Slice points to [from, to] inclusive. */
export function yearRange(points: Point[], from: number, to: number): Point[] {
  return points.filter((p) => p.year >= from && p.year <= to);
}
