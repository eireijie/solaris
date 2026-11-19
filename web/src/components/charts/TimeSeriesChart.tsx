/**
 * TimeSeriesChart — responsive SVG chart for observed / trend / projection series
 * with uncertainty bands, a "projection begins" marker, hover/touch/keyboard
 * crosshair + tooltip, legend, units, and animated transitions when data changes.
 *
 *   <TimeSeriesChart
 *     title="Washington D.C. winter temperature"
 *     unit="°C"
 *     projectionStart={2026}
 *     series={[
 *       { id: "obs", label: "Observed", role: "observed", type: "points", data: obs },
 *       { id: "trend", label: "Fitted trend", role: "trend", data: trend },
 *       { id: "proj", label: "Aeros projection", role: "projection", data: proj }, // data may carry lower/upper → band
 *     ]}
 *   />
 */
import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { useElementSize } from "../../lib/hooks";
import { colorFor } from "./palette";
import type { SeriesRole } from "./palette";
import { lerpNum, useTween } from "./useTween";

export type TSDatum = { x: number; y?: number | null; lower?: number | null; upper?: number | null };

export type TSSeries = {
  id: string;
  label: string;
  data: TSDatum[];
  /** "line" (default), "points" (observations), "line+points", "band" (only lower/upper). */
  type?: "line" | "points" | "line+points" | "band";
  role?: SeriesRole;
  /** CSS colour; defaults from role / palette (tokens). */
  color?: string;
  /** Dashed stroke (default true for role "trend"). */
  dashed?: boolean;
  strokeWidth?: number;
  /** Label for the band in legend/tooltip, e.g. "95% bootstrap range". Band drawn when data has lower/upper. */
  bandLabel?: string;
  hideInLegend?: boolean;
  /** Exclude from tooltip. */
  hideInTooltip?: boolean;
};

export type ChartUnit = "°C" | "ppm" | "W/m²" | "GtCO₂/yr" | "°C/decade" | "%" | "K" | string;

export type TimeSeriesChartProps = {
  series: TSSeries[];
  /** Accessible title (also shown unless hideTitle). */
  title: string;
  /** Longer accessible description (screen readers). */
  description?: string;
  unit: ChartUnit;
  yLabel?: string;
  /** x of the vertical "Projection begins" marker. */
  projectionStart?: number;
  projectionLabel?: string;
  /** Extra vertical markers. */
  markers?: { x: number; label: string }[];
  /** Horizontal reference lines. */
  references?: { y: number; label: string }[];
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** Include zero in the y domain. */
  includeZero?: boolean;
  /** Fixed height in px. Default: responsive (≈ width × 0.48, 260–460). */
  height?: number;
  digits?: number;
  legend?: boolean;
  hideTitle?: boolean;
  /** Tween duration in ms when data changes (0 disables). */
  animationMs?: number;
  /** Rendered under the chart (e.g. source note). */
  footer?: ReactNode;
  /** Format the x value in tooltip / ticks. */
  formatX?: (x: number) => string;
};

type Prepared = { s: TSSeries; color: string; data: TSDatum[] };

function lerpSeries(from: Prepared[], to: Prepared[], t: number): Prepared[] {
  const prev = new Map(from.map((p) => [p.s.id, new Map(p.data.map((d) => [d.x, d]))]));
  return to.map((p) => {
    const old = prev.get(p.s.id);
    if (!old) return p;
    return {
      ...p,
      data: p.data.map((d) => {
        const o = old.get(d.x);
        if (!o) return d;
        const L = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? b : lerpNum(a, b, t));
        return { x: d.x, y: L(o.y, d.y), lower: L(o.lower, d.lower), upper: L(o.upper, d.upper) };
      }),
    };
  });
}

const lerpDomain = (a: [number, number], b: [number, number], t: number): [number, number] => [lerpNum(a[0], b[0], t), lerpNum(a[1], b[1], t)];

function niceStep(span: number, target: number) {
  const raw = span / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

export function TimeSeriesChart({
  series,
  title,
  description,
  unit,
  yLabel,
  projectionStart,
  projectionLabel = "Projection begins",
  markers = [],
  references = [],
  xDomain,
  yDomain,
  includeZero,
  height,
  digits = 2,
  legend = true,
  hideTitle = false,
  animationMs = 600,
  footer,
  formatX = (x) => String(Math.round(x)),
}: TimeSeriesChartProps) {
  const uid = useId();
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const prepared = useMemo<Prepared[]>(
    () =>
      series.map((s, i) => ({
        s,
        color: s.color ?? colorFor(s.role, i),
        data: [...s.data].sort((a, b) => a.x - b.x),
      })),
    [series],
  );

  // Target domains from (visible) data.
  const targetDomains = useMemo(() => {
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const p of prepared) {
      if (hidden.has(p.s.id)) continue;
      for (const d of p.data) {
        x0 = Math.min(x0, d.x);
        x1 = Math.max(x1, d.x);
        for (const v of [d.y, d.lower, d.upper]) {
          if (v != null && Number.isFinite(v)) {
            y0 = Math.min(y0, v);
            y1 = Math.max(y1, v);
          }
        }
      }
    }
    if (!Number.isFinite(x0)) [x0, x1] = [0, 1];
    if (!Number.isFinite(y0)) [y0, y1] = [0, 1];
    if (includeZero) [y0, y1] = [Math.min(0, y0), Math.max(0, y1)];
    for (const r of references) [y0, y1] = [Math.min(y0, r.y), Math.max(y1, r.y)];
    const pad = (y1 - y0 || Math.abs(y1) || 1) * 0.08;
    return {
      x: xDomain ?? ([x0, x1] as [number, number]),
      y: yDomain ?? ([y0 - pad, y1 + pad] as [number, number]),
    };
  }, [prepared, hidden, xDomain, yDomain, includeZero, references]);

  const anim = useTween(
    useMemo(() => ({ data: prepared, x: targetDomains.x, y: targetDomains.y }), [prepared, targetDomains]),
    (a, b, t) => ({ data: lerpSeries(a.data, b.data, t), x: lerpDomain(a.x, b.x, t), y: lerpDomain(a.y, b.y, t) }),
    animationMs,
  );

  const width = Math.max(280, size.width || 640);
  const compact = width < 520;
  const h = height ?? Math.round(Math.min(460, Math.max(260, width * (compact ? 0.72 : 0.46))));
  const yTicksCount = h < 300 ? 4 : 5;
  const ys = scaleLinear().domain(anim.y).range([h - 32, 14]);
  const yStep = niceStep(anim.y[1] - anim.y[0], yTicksCount);
  const yTicks: number[] = [];
  for (let v = Math.ceil(anim.y[0] / yStep) * yStep; v <= anim.y[1] + 1e-9; v += yStep) yTicks.push(+v.toFixed(10));
  const tickDigits = yStep >= 1 ? 0 : yStep >= 0.1 ? 1 : 2;
  const longest = Math.max(...yTicks.map((t) => t.toFixed(tickDigits).length), 2);
  const margin = { left: 12 + longest * 7.2, right: compact ? 10 : 18 };
  const xs = scaleLinear().domain(anim.x).range([margin.left, width - margin.right]);
  const xStep = niceStep(anim.x[1] - anim.x[0], compact ? 4 : 8);
  const xTicks: number[] = [];
  for (let v = Math.ceil(anim.x[0] / xStep) * xStep; v <= anim.x[1] + 1e-9; v += xStep) xTicks.push(Math.round(v));

  const lineGen = line<TSDatum>()
    .defined((d) => d.y != null && Number.isFinite(d.y))
    .x((d) => xs(d.x))
    .y((d) => ys(d.y as number))
    .curve(curveMonotoneX);
  const areaGen = area<TSDatum>()
    .defined((d) => d.lower != null && d.upper != null)
    .x((d) => xs(d.x))
    .y0((d) => ys(d.lower as number))
    .y1((d) => ys(d.upper as number))
    .curve(curveMonotoneX);

  const visible = anim.data.filter((p) => !hidden.has(p.s.id));
  const allX = useMemo(() => [...new Set(prepared.flatMap((p) => p.data.map((d) => d.x)))].sort((a, b) => a - b), [prepared]);

  const nearestX = (px: number) => {
    const xv = xs.invert(px);
    let best = allX[0];
    for (const x of allX) if (Math.abs(x - xv) < Math.abs(best - xv)) best = x;
    return best;
  };

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !allX.length) return;
    setHoverX(nearestX(((e.clientX - r.left) / r.width) * width));
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!allX.length) return;
    const i = hoverX == null ? -1 : allX.indexOf(hoverX);
    let n = i;
    if (e.key === "ArrowRight") n = Math.min(allX.length - 1, i + 1);
    else if (e.key === "ArrowLeft") n = i < 0 ? allX.length - 1 : Math.max(0, i - 1);
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = allX.length - 1;
    else if (e.key === "Escape") {
      setHoverX(null);
      return;
    } else return;
    e.preventDefault();
    setHoverX(allX[n]);
  };

  const fmt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits));
  const unitSuffix = unit ? ` ${unit}` : "";

  const tooltipRows =
    hoverX == null
      ? []
      : prepared
          .filter((p) => !hidden.has(p.s.id) && !p.s.hideInTooltip)
          .map((p) => ({ p, d: p.data.find((d) => d.x === hoverX) }))
          .filter((r) => r.d && (r.d.y != null || r.d.lower != null));

  const hx = hoverX != null ? xs(hoverX) : 0;
  const tipLeft = hx > width * 0.6;

  const summary = prepared
    .map((p) => {
      const vals = p.data.filter((d) => d.y != null);
      if (!vals.length) return `${p.s.label}: no values`;
      const a = vals[0];
      const b = vals[vals.length - 1];
      return `${p.s.label}: ${formatX(a.x)} ${fmt(a.y)}${unitSuffix} to ${formatX(b.x)} ${fmt(b.y)}${unitSuffix}`;
    })
    .join(". ");

  return (
    <figure className="sol-chart" aria-labelledby={`${uid}-t`}>
      <figcaption className={hideTitle ? "sol-visually-hidden" : "sol-chart__title"} id={`${uid}-t`}>
        {title}
        {yLabel || unit ? <span className="sol-chart__unit">{yLabel ? `${yLabel}${unit ? ` (${unit})` : ""}` : unit}</span> : null}
      </figcaption>

      {legend ? (
        <ul className="sol-chart__legend" aria-label="Series (toggle visibility)">
          {prepared
            .filter((p) => !p.s.hideInLegend)
            .map((p) => {
              const type = p.s.type ?? "line";
              const off = hidden.has(p.s.id);
              const band = p.data.some((d) => d.lower != null);
              return (
                <li key={p.s.id}>
                  <button
                    type="button"
                    className={`sol-chart__legend-item ${off ? "is-off" : ""}`}
                    aria-pressed={!off}
                    onClick={() =>
                      setHidden((h0) => {
                        const n = new Set(h0);
                        if (n.has(p.s.id)) n.delete(p.s.id);
                        else n.add(p.s.id);
                        return n;
                      })
                    }
                  >
                    <svg width="22" height="12" aria-hidden="true">
                      {band || type === "band" ? <rect x="0" y="1" width="22" height="10" rx="2" style={{ fill: p.color, opacity: 0.22 }} /> : null}
                      {type !== "band" && type !== "points" ? (
                        <line x1="1" x2="21" y1="6" y2="6" style={{ stroke: p.color }} strokeWidth={2} strokeDasharray={(p.s.dashed ?? p.s.role === "trend") ? "4 3" : undefined} />
                      ) : null}
                      {type === "points" || type === "line+points" ? <circle cx="11" cy="6" r="3" style={{ fill: p.color }} /> : null}
                    </svg>
                    {p.s.label}
                    {band && p.s.bandLabel ? <span className="sol-chart__legend-note">± {p.s.bandLabel}</span> : null}
                  </button>
                </li>
              );
            })}
        </ul>
      ) : null}

      <div ref={wrapRef} className="sol-chart__plot">
        <svg
          ref={svgRef}
          width={width}
          height={h}
          viewBox={`0 0 ${width} ${h}`}
          role="img"
          aria-labelledby={`${uid}-t ${uid}-d`}
          tabIndex={0}
          className="sol-chart__svg"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={(e) => e.pointerType === "mouse" && setHoverX(null)}
          onKeyDown={onKey}
          onBlur={() => setHoverX(null)}
        >
          <desc id={`${uid}-d`}>
            {description ? `${description} ` : ""}
            {summary}. Use left and right arrow keys to read values.
          </desc>
          <defs>
            <clipPath id={`${uid}-clip`}>
              <rect x={margin.left} y={0} width={width - margin.left - margin.right} height={h} />
            </clipPath>
          </defs>

          {/* grid + y axis */}
          <g className="sol-chart__grid" aria-hidden="true">
            {yTicks.map((t) => (
              <g key={`y${t}`} transform={`translate(0 ${ys(t)})`}>
                <line x1={margin.left} x2={width - margin.right} />
                <text x={margin.left - 8} dy="0.32em" textAnchor="end">
                  {t.toFixed(tickDigits)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={`x${t}`} x={xs(t)} y={h - 10} textAnchor="middle">
                {formatX(t)}
              </text>
            ))}
            <line className="sol-chart__baseline" x1={margin.left} x2={width - margin.right} y1={h - 32} y2={h - 32} />
          </g>

          {/* projection shading + marker */}
          {projectionStart != null && projectionStart >= anim.x[0] && projectionStart <= anim.x[1] ? (
            <g className="sol-chart__projection" aria-hidden="true">
              <rect x={xs(projectionStart)} y={14} width={Math.max(0, width - margin.right - xs(projectionStart))} height={h - 46} />
              <line x1={xs(projectionStart)} x2={xs(projectionStart)} y1={10} y2={h - 32} />
              <text x={xs(projectionStart) + 6} y={22}>
                {projectionLabel}
              </text>
            </g>
          ) : null}
          {markers.map((m) => (
            <g key={`m${m.x}`} className="sol-chart__marker" aria-hidden="true">
              <line x1={xs(m.x)} x2={xs(m.x)} y1={10} y2={h - 32} />
              <text x={xs(m.x) + 6} y={38}>
                {m.label}
              </text>
            </g>
          ))}
          {references.map((r) => (
            <g key={`r${r.y}`} className="sol-chart__reference" aria-hidden="true">
              <line x1={margin.left} x2={width - margin.right} y1={ys(r.y)} y2={ys(r.y)} />
              <text x={width - margin.right - 4} y={ys(r.y) - 6} textAnchor="end">
                {r.label}
              </text>
            </g>
          ))}

          <g clipPath={`url(#${uid}-clip)`} aria-hidden="true">
            {/* bands first */}
            {visible.map((p) =>
              p.data.some((d) => d.lower != null && d.upper != null) ? (
                <path key={`${p.s.id}-band`} d={areaGen(p.data) ?? undefined} className="sol-chart__band" style={{ fill: p.color }} />
              ) : null,
            )}
            {visible.map((p) => {
              const type = p.s.type ?? "line";
              const dashed = p.s.dashed ?? p.s.role === "trend";
              return (
                <g key={p.s.id}>
                  {type === "line" || type === "line+points" ? (
                    <path
                      d={lineGen(p.data) ?? undefined}
                      fill="none"
                      style={{ stroke: p.color }}
                      strokeWidth={p.s.strokeWidth ?? (p.s.role === "observed" ? 1.25 : 2)}
                      strokeDasharray={dashed ? "5 4" : undefined}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={p.s.role === "observed" && type === "line+points" ? 0.45 : 1}
                    />
                  ) : null}
                  {type === "points" || type === "line+points"
                    ? p.data.map((d) =>
                        d.y != null ? <circle key={d.x} cx={xs(d.x)} cy={ys(d.y)} r={compact ? 1.8 : 2.3} style={{ fill: p.color }} opacity={0.85} /> : null,
                      )
                    : null}
                </g>
              );
            })}
          </g>

          {/* crosshair */}
          {hoverX != null ? (
            <g className="sol-chart__crosshair" aria-hidden="true">
              <line x1={hx} x2={hx} y1={10} y2={h - 32} />
              {tooltipRows.map(({ p, d }) =>
                d && d.y != null ? <circle key={p.s.id} cx={hx} cy={ys(d.y)} r={4.5} style={{ fill: p.color }} /> : null,
              )}
            </g>
          ) : null}
        </svg>

        {hoverX != null && tooltipRows.length ? (
          <div
            className="sol-chart__tooltip"
            style={{ left: tipLeft ? undefined : hx + 12, right: tipLeft ? width - hx + 12 : undefined }}
            aria-live="polite"
          >
            <p className="sol-chart__tooltip-x">{formatX(hoverX)}</p>
            {tooltipRows.map(({ p, d }) => (
              <p key={p.s.id} className="sol-chart__tooltip-row">
                <span className="sol-chart__swatch" style={{ background: p.color }} aria-hidden="true" />
                <span className="sol-chart__tooltip-label">{p.s.label}</span>
                <span className="sol-mono">
                  {d!.y != null ? `${fmt(d!.y)}${unitSuffix}` : ""}
                  {d!.lower != null && d!.upper != null ? (
                    <small>
                      {" "}
                      [{fmt(d!.lower)}–{fmt(d!.upper)}]
                    </small>
                  ) : null}
                </span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      {footer ? <div className="sol-chart__footer">{footer}</div> : null}
    </figure>
  );
}
