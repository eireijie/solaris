import { useId } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * Accessible range slider (native input[type=range]) with a live value readout.
 * `format` controls both the visible readout and aria-valuetext.
 */
export function Slider({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  format = (v) => String(v),
  hint,
  marks,
  disabled,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  /** Fires on pointer up / key up — use for expensive model runs. */
  onCommit?: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  hint?: ReactNode;
  /** Optional tick labels under the track. */
  marks?: { value: number; label: string }[];
  disabled?: boolean;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <div className={`sol-field sol-slider ${disabled ? "is-disabled" : ""}`}>
      <div className="sol-slider__top">
        <label htmlFor={id} className="sol-field__label">
          {label}
        </label>
        <output htmlFor={id} className="sol-slider__value sol-mono" aria-hidden="true">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        style={{ "--sol-slider-pct": `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
      {marks ? (
        <div className="sol-slider__marks" aria-hidden="true">
          {marks.map((m) => (
            <span key={m.value} style={{ left: `${((m.value - min) / (max - min || 1)) * 100}%` }}>
              {m.label}
            </span>
          ))}
        </div>
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className="sol-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
