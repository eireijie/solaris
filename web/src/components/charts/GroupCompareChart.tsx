/**
 * GroupCompareChart — horizontal dot-with-confidence-interval chart for comparing
 * groups (urban vs rural, by country, by period). Works well on phones because
 * labels sit on their own row above each interval.
 *
 *   <GroupCompareChart
 *     title="Trend increase between periods" unit="°C/decade" reference={0}
 *     groups={[{ label: "Winter (DJF)", value: 0.189, lower: 0.085, upper: 0.294, note: "p = 0.0007" }]}
 *   />
 */
import { useId, useMemo } from "react";
import type { ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import { useElementSize } from "../../lib/hooks";
import { SERIES_PALETTE } from "./palette";
import { lerpNum, useTween } from "./useTween";

export type Group = {
  label: string;
  value: number;
  lower?: number | null;
  upper?: number | null;
  color?: string;
  /** Short annotation shown at the right, e.g. "p < 0.001" or "n = 40". */
  note?: string;
};

export function GroupCompareChart({
  groups,
  title,
  description,
  unit,
  reference,
  referenceLabel,
  domain,
  digits = 2,
  ciLabel = "95% CI",
  footer,
  hideTitle,
  animationMs = 600,
}: {
  groups: Group[];
  title: string;
  description?: string;
  unit: string;
  /** Vertical reference line (e.g. 0). */
  reference?: number;
  referenceLabel?: string;
  domain?: [number, number];
  digits?: number;
  ciLabel?: string;
  footer?: ReactNode;
  hideTitle?: boolean;
  animationMs?: number;
}) {
  const uid = useId();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const width = Math.max(260, size.width || 560);

  const target = useMemo(() => groups.map((g) => [g.value, g.lower ?? g.value, g.upper ?? g.value]), [groups]);
  const anim = useTween(target, (a, b, t) => b.map((row, i) => row.map((v, j) => (a[i] ? lerpNum(a[i][j], v, t) : v))), animationMs);

  const dom = useMemo<[number, number]>(() => {
    if (domain) return domain;
    const vals = groups.flatMap((g) => [g.value, g.lower ?? g.value, g.upper ?? g.value]);
    if (reference != null) vals.push(reference);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo || 1) * 0.12;
    return [lo - pad, hi + pad];
  }, [groups, domain, reference]);

  const rowH = 52;
  const top = 8;
  const h = top + groups.length * rowH + 28;
  const xs = scaleLinear().domain(dom).range([8, width - 8]).nice();
  const ticks = xs.ticks(width < 420 ? 4 : 6);
  const fmt = (v: number) => v.toFixed(digits);

  return (
    <figure className="sol-chart sol-chart--groups" aria-labelledby={`${uid}-t`}>
      <figcaption className={hideTitle ? "sol-visually-hidden" : "sol-chart__title"} id={`${uid}-t`}>
        {title}
        <span className="sol-chart__unit">
          {unit} · dot = estimate, bar = {ciLabel}
        </span>
      </figcaption>
      <div ref={ref} className="sol-chart__plot">
        <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} className="sol-chart__svg" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
          <desc id={`${uid}-d`}>
            {description ? `${description} ` : ""}
            {groups
              .map((g) => `${g.label}: ${fmt(g.value)} ${unit}${g.lower != null && g.upper != null ? ` (${ciLabel} ${fmt(g.lower)} to ${fmt(g.upper)})` : ""}${g.note ? `, ${g.note}` : ""}`)
              .join("; ")}
          </desc>
          <g className="sol-chart__grid" aria-hidden="true">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={xs(t)} x2={xs(t)} y1={top} y2={h - 26} />
                <text x={xs(t)} y={h - 8} textAnchor="middle">
                  {t}
                </text>
              </g>
            ))}
          </g>
          {reference != null ? (
            <g className="sol-chart__reference" aria-hidden="true">
              <line x1={xs(reference)} x2={xs(reference)} y1={top} y2={h - 26} />
              {referenceLabel ? (
                <text x={xs(reference) + 4} y={h - 30}>
                  {referenceLabel}
                </text>
              ) : null}
            </g>
          ) : null}
          {groups.map((g, i) => {
            const [v, lo, hi] = anim[i] ?? [g.value, g.value, g.value];
            const y = top + i * rowH + 34;
            const color = g.color ?? SERIES_PALETTE[i % SERIES_PALETTE.length];
            return (
              <g key={g.label} aria-hidden="true">
                <text className="sol-chart__group-label" x={8} y={y - 14}>
                  {g.label}
                </text>
                <text className="sol-chart__group-value" x={width - 8} y={y - 14} textAnchor="end">
                  {fmt(g.value)}
                  {g.lower != null && g.upper != null ? ` [${fmt(g.lower)}–${fmt(g.upper)}]` : ""}
                  {g.note ? ` · ${g.note}` : ""}
                </text>
                {g.lower != null && g.upper != null ? (
                  <>
                    <line x1={xs(lo)} x2={xs(hi)} y1={y} y2={y} style={{ stroke: color }} strokeWidth={3} strokeLinecap="round" opacity={0.55} />
                    <line x1={xs(lo)} x2={xs(lo)} y1={y - 5} y2={y + 5} style={{ stroke: color }} strokeWidth={1.5} />
                    <line x1={xs(hi)} x2={xs(hi)} y1={y - 5} y2={y + 5} style={{ stroke: color }} strokeWidth={1.5} />
                  </>
                ) : null}
                <circle cx={xs(v)} cy={y} r={6} style={{ fill: color, stroke: "var(--sol-bg)" }} strokeWidth={2} />
              </g>
            );
          })}
        </svg>
      </div>
      {footer ? <div className="sol-chart__footer">{footer}</div> : null}
    </figure>
  );
}
