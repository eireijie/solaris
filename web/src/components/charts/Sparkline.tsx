/** Tiny inline trend line (no axes). Decorative unless `label` is given. */
import { useMemo } from "react";
import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import type { TSDatum } from "./TimeSeriesChart";

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "var(--sol-data-projection)",
  label,
  showLast = true,
  band = false,
}: {
  /** Numbers (evenly spaced) or {x, y, lower?, upper?} points. */
  data: (number | null)[] | TSDatum[];
  width?: number;
  height?: number;
  color?: string;
  /** Accessible label; omit for decorative sparklines. */
  label?: string;
  showLast?: boolean;
  /** Draw lower/upper band when present. */
  band?: boolean;
}) {
  const pts: TSDatum[] = useMemo(
    () => (typeof data[0] === "object" && data[0] !== null ? (data as TSDatum[]) : (data as (number | null)[]).map((y, x) => ({ x, y }))),
    [data],
  );
  const vals = pts.flatMap((p) => [p.y, band ? p.lower : null, band ? p.upper : null]).filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return <svg width={width} height={height} aria-hidden="true" />;
  const xs = scaleLinear()
    .domain([pts[0].x, pts[pts.length - 1].x])
    .range([2, width - 3]);
  const ys = scaleLinear()
    .domain([Math.min(...vals), Math.max(...vals)])
    .range([height - 3, 3]);
  const l = line<TSDatum>()
    .defined((d) => d.y != null)
    .x((d) => xs(d.x))
    .y((d) => ys(d.y as number))
    .curve(curveMonotoneX)(pts);
  const a = band
    ? area<TSDatum>()
        .defined((d) => d.lower != null && d.upper != null)
        .x((d) => xs(d.x))
        .y0((d) => ys(d.lower as number))
        .y1((d) => ys(d.upper as number))
        .curve(curveMonotoneX)(pts)
    : null;
  const last = [...pts].reverse().find((p) => p.y != null);
  return (
    <svg
      className="sol-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {a ? <path d={a} style={{ fill: color }} opacity={0.18} /> : null}
      <path d={l ?? undefined} fill="none" style={{ stroke: color }} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {showLast && last && last.y != null ? <circle cx={xs(last.x)} cy={ys(last.y)} r={2.5} style={{ fill: color }} /> : null}
    </svg>
  );
}
