/** React hooks around the foundation's cached loaders. */
import { useEffect, useState } from "react";
import { loadCo2Bundle, loadDataAvailability, loadStationsBundle } from "../../../data";
import type { Co2Bundle, DataAvailability, Station, StationsBundle } from "../../../data";
import { fetchPrecomputed } from "../../../runtime";

export type Loadable<T> = { data: T | null; error: string | null; retry: () => void };

function useLoad<T>(fn: () => Promise<T>, key = ""): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    fn()
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, key]);
  return { data, error, retry: () => setN((x) => x + 1) };
}

export const useStationsBundle = () => useLoad<StationsBundle>(loadStationsBundle);
export const useCo2Bundle = () => useLoad<Co2Bundle>(loadCo2Bundle);
export const useAvailability = () => useLoad<DataAvailability>(loadDataAvailability);

/** Precomputed result; resolves null when missing. */
export function usePrecomputed<T>(model: string, key: string | null): { data: T | null; loading: boolean } {
  const [state, setState] = useState<{ key: string | null; data: T | null }>({ key: null, data: null });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void fetchPrecomputed<T>(model, key).then((d) => alive && setState({ key, data: d }));
    return () => {
      alive = false;
    };
  }, [model, key]);
  return { data: state.key === key ? state.data : null, loading: !!key && state.key !== key };
}

/** Grouping used across the feature: United States / Argentina / World. */
export function stationGroup(s: Station): "United States" | "Argentina" | "World" {
  if (s.set === "world") return "World";
  if (s.country === "Argentina") return "Argentina";
  if (s.country === "United States") return "United States";
  return "World";
}

export const GROUP_ORDER = ["United States", "Argentina", "World"] as const;

export function classLabel(c: string | null | undefined): string {
  if (c === "periurban") return "peri-urban";
  return c ?? "unclassified";
}

/** Short city label without the parenthetical, for compact UI. */
export function shortName(s: Pick<Station, "display_name">): string {
  return s.display_name;
}

export const DEFAULT_STATION_ID = "USW00013743";

/** Exact provenance wording (CONTRACT.md). */
export const STATION_PROVENANCE =
  "Solaris sample station set — NOAA GHCN-M v4 (adjusted), the station record NASA GISTEMP is built on";

/** Copy of the CO2 bundle without parts Catalyst does not need (smaller payload per slider move). */
export function catalystData(b: Co2Bundle): Partial<Co2Bundle> {
  return { schema: b.schema, historical_co2: b.historical_co2, noaa_global_annual: b.noaa_global_annual, rcmip: b.rcmip };
}

export const SSP_LABELS: Record<string, string> = {
  ssp119: "SSP1-1.9",
  ssp126: "SSP1-2.6",
  ssp245: "SSP2-4.5",
  ssp370: "SSP3-7.0",
  ssp434: "SSP4-3.4",
  ssp460: "SSP4-6.0",
  ssp585: "SSP5-8.5",
};
