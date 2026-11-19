import { useId } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { IconChevronDown } from "./icons";

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectGroup = { label: string; options: SelectOption[] };

/**
 * Native <select> styled to the system (best mobile UX + accessibility).
 * Pass `options` or `groups` (renders <optgroup>).
 */
export function Select({
  label,
  hint,
  options,
  groups,
  value,
  onChange,
  hideLabel,
  className = "",
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  label: ReactNode;
  hint?: ReactNode;
  options?: SelectOption[];
  groups?: SelectGroup[];
  value: string;
  onChange: (value: string) => void;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className={`sol-field ${className}`}>
      <label htmlFor={id} className={hideLabel ? "sol-visually-hidden" : "sol-field__label"}>
        {label}
      </label>
      <div className="sol-select">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          {...rest}
        >
          {options?.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
          {groups?.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <IconChevronDown className="sol-select__chevron" size={16} />
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="sol-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
