/**
 * Chart colours — all reference tokens in styles/tokens.css (Okabe–Ito derived,
 * colour-blind-safe, tuned for the dark background). Never encode meaning by
 * colour alone: observed = points, trend = dashed, projection = solid + band.
 */
export const CHART_COLORS = {
  observed: "var(--sol-data-observed)",
  trend: "var(--sol-data-trend)",
  projection: "var(--sol-data-projection)",
  grid: "var(--sol-data-grid)",
  axis: "var(--sol-data-axis)",
  marker: "var(--sol-data-marker)",
} as const;

export const SERIES_PALETTE = [
  "var(--sol-data-1)",
  "var(--sol-data-2)",
  "var(--sol-data-3)",
  "var(--sol-data-4)",
  "var(--sol-data-5)",
  "var(--sol-data-6)",
] as const;

export const MODEL_COLORS = {
  aeros: "var(--sol-model-aeros)",
  core: "var(--sol-model-core)",
  catalyst: "var(--sol-model-catalyst)",
  nexus: "var(--sol-model-nexus)",
} as const;

export type SeriesRole = "observed" | "trend" | "projection" | "other";

export function colorFor(role: SeriesRole | undefined, index: number): string {
  if (role === "observed") return CHART_COLORS.observed;
  if (role === "trend") return CHART_COLORS.trend;
  if (role === "projection") return CHART_COLORS.projection;
  return SERIES_PALETTE[index % SERIES_PALETTE.length];
}
