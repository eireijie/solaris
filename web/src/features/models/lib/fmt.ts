/** Feature-level formatting on top of lib/format.ts — units always attached, never bare floats. */
import { fmt, fmtSigned } from "../../../lib/format";
import type { Num } from "../results";

export { fmt, fmtSigned };

const ok = (v: Num): v is number => v != null && Number.isFinite(v);

export const degC = (v: Num, d = 1) => (ok(v) ? `${fmt(v, d)} °C` : "—");
export const degCSigned = (v: Num, d = 2) => (ok(v) ? `${fmtSigned(v, d)} °C` : "—");
export const perDecade = (v: Num, d = 2) => (ok(v) ? `${fmtSigned(v, d)} °C/decade` : "—");
export const ppm = (v: Num, d = 1) => (ok(v) ? `${fmt(v, d)} ppm` : "—");
export const wm2 = (v: Num, d = 2) => (ok(v) ? `${fmt(v, d)} W/m²` : "—");
export const gt = (v: Num, d = 1) => (ok(v) ? `${fmt(v, d)} GtCO₂/yr` : "—");
export const pct = (v: Num, d = 0) => (ok(v) ? `${fmt(v * 100, d)}%` : "—");
export const range = (lo: Num, hi: Num, d = 1, unit = "") =>
  ok(lo) && ok(hi) ? `${fmt(lo, d)}–${fmt(hi, d)}${unit ? ` ${unit}` : ""}` : "—";

/** p-values: "p < 0.001", "p = 0.014". */
export function pValue(p: Num): string {
  if (!ok(p)) return "p —";
  if (p < 0.001) return "p < 0.001";
  return `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`;
}

export function msLabel(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function capital(s: string | null | undefined): string {
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

export const isNum = ok;
