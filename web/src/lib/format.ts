/** Number formatting helpers. Use these so units and precision stay consistent. */

export type Unit = "°C" | "ppm" | "W/m²" | "GtCO₂/yr" | "°C/decade" | "%" | "";

export function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtUnit(value: number | null | undefined, unit: Unit, digits = 2): string {
  const s = fmt(value, digits);
  if (s === "—" || !unit) return s;
  return unit === "%" ? `${s}%` : `${s} ${unit}`;
}

export function fmtSigned(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const s = fmt(Math.abs(value), digits);
  return value > 0 ? `+${s}` : value < 0 ? `−${s}` : s;
}

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
