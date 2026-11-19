import { useId } from "react";
import type { ReactNode } from "react";

/** Switch (role="switch"). */
export function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={`sol-toggle ${disabled ? "is-disabled" : ""}`}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        className={`sol-toggle__switch ${checked ? "is-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="sol-toggle__thumb" aria-hidden="true" />
      </button>
      <label htmlFor={id} className="sol-toggle__label">
        {label}
        {hint ? (
          <span id={`${id}-hint`} className="sol-field__hint">
            {hint}
          </span>
        ) : null}
      </label>
    </div>
  );
}
