import { useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export type Option<V extends string> = { value: V; label: ReactNode; disabled?: boolean; hint?: string };

function moveFocus<V extends string>(
  e: KeyboardEvent,
  options: Option<V>[],
  value: V,
  onChange: (v: V) => void,
  refs: (HTMLButtonElement | null)[],
) {
  const enabled = options.map((o, i) => ({ o, i })).filter((x) => !x.o.disabled);
  const pos = enabled.findIndex((x) => x.o.value === value);
  let next = -1;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (pos + 1) % enabled.length;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (pos - 1 + enabled.length) % enabled.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = enabled.length - 1;
  if (next < 0) return;
  e.preventDefault();
  const target = enabled[next];
  onChange(target.o.value);
  refs[target.i]?.focus();
}

/**
 * Segmented control (single choice, radiogroup semantics, roving tabindex).
 * Use for compact mode switches: season DJF/JJA, scenario, units.
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  block,
}: {
  options: Option<V>[];
  value: V;
  onChange: (v: V) => void;
  /** Accessible name for the group. */
  label: string;
  size?: "sm" | "md";
  block?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`sol-segmented sol-segmented--${size} ${block ? "sol-segmented--block" : ""}`}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            title={o.hint}
            className={`sol-segmented__item ${checked ? "is-active" : ""}`}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => moveFocus(e, options, value, onChange, refs.current)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Tabs with panels (WAI-ARIA tabs pattern). Panels are rendered lazily: only the
 * active panel mounts.
 */
export function Tabs<V extends string>({
  tabs,
  value,
  onChange,
  label,
  children,
}: {
  tabs: Option<V>[];
  value: V;
  onChange: (v: V) => void;
  label: string;
  /** Render the active panel. */
  children: (value: V) => ReactNode;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="sol-tabs">
      <div role="tablist" aria-label={label} className="sol-tabs__list">
        {tabs.map((t, i) => {
          const selected = t.value === value;
          return (
            <button
              key={t.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.value}`}
              aria-selected={selected}
              aria-controls={`${id}-panel-${t.value}`}
              tabIndex={selected ? 0 : -1}
              disabled={t.disabled}
              className={`sol-tabs__tab ${selected ? "is-active" : ""}`}
              onClick={() => onChange(t.value)}
              onKeyDown={(e) => moveFocus(e, tabs, value, onChange, refs.current)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-${value}`}
        aria-labelledby={`${id}-tab-${value}`}
        className="sol-tabs__panel"
        tabIndex={0}
      >
        {children(value)}
      </div>
    </div>
  );
}
