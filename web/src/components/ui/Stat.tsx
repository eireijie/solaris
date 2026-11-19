import type { ReactNode } from "react";

/**
 * Big number + label + source note. Every number on the site needs a source
 * (CONTRACT.md honesty rules) — `source` is required on purpose.
 */
export function Stat({
  value,
  unit,
  label,
  source,
  detail,
  tone = "default",
  size = "md",
}: {
  value: ReactNode;
  unit?: ReactNode;
  label: ReactNode;
  /** Where the number comes from, e.g. "Poster, 40 stations" or "Aeros 4.0 run". */
  source: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "solar" | "atmosphere";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div className={`sol-stat sol-stat--${tone} sol-stat--${size}`}>
      <p className="sol-stat__value">
        <span className="sol-mono-num">{value}</span>
        {unit ? <span className="sol-stat__unit">{unit}</span> : null}
      </p>
      <p className="sol-stat__label">{label}</p>
      {detail ? <p className="sol-stat__detail">{detail}</p> : null}
      <p className="sol-stat__source">
        <span className="sol-visually-hidden">Source: </span>
        {source}
      </p>
    </div>
  );
}
