/**
 * Searchable, grouped station picker (combobox + listbox, keyboard accessible).
 * Groups: United States / Argentina / World. Shows class badge and pair partner.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Badge, IconChevronDown } from "../../../components/ui";
import type { Station } from "../../../data";
import { classLabel, GROUP_ORDER, stationGroup } from "../lib/bundles";

function classTone(c: string | null | undefined) {
  return c === "urban" ? "solar" : c === "rural" ? "success" : "info";
}

export function ClassBadge({ value }: { value: string | null | undefined }) {
  return <Badge tone={classTone(value)}>{classLabel(value)}</Badge>;
}

function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function StationPicker({
  stations,
  value,
  onChange,
  label = "Station",
  disabled,
  placeholderValue,
}: {
  stations: Station[];
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
  disabled?: boolean;
  /** Text shown on the trigger when no bundled station is selected (e.g. uploaded data). */
  placeholderValue?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
  const current = value ? byId.get(value) : undefined;

  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    const match = (s: Station) =>
      !nq || norm(`${s.display_name} ${s.name} ${s.id} ${s.country} ${s.region ?? ""} ${classLabel(s.urban_rural)}`).includes(nq);
    return GROUP_ORDER.map((g) => ({ group: g, items: stations.filter((s) => stationGroup(s) === g && match(s)) })).filter((g) => g.items.length);
  }, [stations, q]);
  const flat = useMemo(() => filtered.flatMap((g) => g.items), [filtered]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      const i = flat.findIndex((s) => s.id === value);
      setActive(i >= 0 ? i : 0);
      requestAnimationFrame(() => input.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (s: Station) => {
    onChange(s.id);
    setOpen(false);
    setQ("");
    trigger.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home") {
      setActive(0);
    } else if (e.key === "End") {
      setActive(flat.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[active]) choose(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const partner = current?.pair_partner_id ? byId.get(current.pair_partner_id) : undefined;
  let idx = -1;

  return (
    <div className="sol-field wb-picker" ref={wrap}>
      <span className="sol-field__label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className={`wb-picker__trigger ${open ? "is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        data-testid="station-picker"
      >
        <span className="wb-picker__value" id={`${id}-value`}>
          <span className="wb-picker__name">{current ? current.display_name : placeholderValue ?? "Choose a station"}</span>
          {current ? (
            <span className="wb-picker__meta">
              {current.country} · <ClassBadge value={current.urban_rural} />
              {partner ? <span className="wb-picker__pair">pair: {partner.display_name}</span> : null}
            </span>
          ) : null}
        </span>
        <IconChevronDown size={18} />
      </button>
      {open ? (
        <div className="wb-picker__panel">
          <input
            ref={input}
            className="wb-input"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={flat[active] ? `${id}-opt-${flat[active].id}` : undefined}
            aria-label="Search stations"
            placeholder="Search city, country, id…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
          <div className="wb-picker__list" role="listbox" id={`${id}-list`} aria-label="Stations" ref={listRef}>
            {filtered.length === 0 ? <p className="wb-picker__empty">No station matches “{q}”.</p> : null}
            {filtered.map((g) => (
              <div key={g.group} role="group" aria-label={g.group}>
                <p className="wb-picker__group" aria-hidden="true">
                  {g.group} <span>{g.items.length}</span>
                </p>
                {g.items.map((s) => {
                  idx += 1;
                  const i = idx;
                  const p = s.pair_partner_id ? byId.get(s.pair_partner_id) : undefined;
                  return (
                    <div
                      key={s.id}
                      id={`${id}-opt-${s.id}`}
                      data-idx={i}
                      role="option"
                      aria-selected={s.id === value}
                      className={`wb-picker__opt ${i === active ? "is-active" : ""} ${s.id === value ? "is-selected" : ""}`}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => choose(s)}
                      onPointerEnter={() => setActive(i)}
                    >
                      <span className="wb-picker__opt-name">{s.display_name}</span>
                      <span className="wb-picker__opt-meta">
                        <ClassBadge value={s.urban_rural} />
                        <span className="sol-mono">{s.id}</span>
                        {p ? <span>pair: {p.display_name}{s.pair_distance_km ? ` · ${Math.round(s.pair_distance_km)} km` : ""}</span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
