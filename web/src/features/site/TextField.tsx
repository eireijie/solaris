import { forwardRef, useId, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { IconEye, IconEyeOff } from "./icons";
import "./forms.css";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string | null;
  /** Adds a show/hide toggle for password inputs. */
  reveal?: boolean;
  optional?: boolean;
};

/** Labelled text input with hint, inline error (aria-invalid + aria-describedby) and optional reveal toggle. */
export const TextField = forwardRef<HTMLInputElement, Props>(function TextField(
  { label, value, onChange, hint, error, reveal, optional, type = "text", className = "", ...rest },
  ref,
) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
  const inputType = reveal && type === "password" ? (shown ? "text" : "password") : type;
  return (
    <div className={`sol-field site-field ${error ? "is-invalid" : ""} ${className}`}>
      <label className="sol-field__label" htmlFor={id}>
        {label}
        {optional ? <span className="site-field__optional"> (optional)</span> : null}
      </label>
      <div className="site-input-wrap">
        <input
          ref={ref}
          id={id}
          className="site-input"
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        {reveal && type === "password" ? (
          <button
            type="button"
            className="site-input__reveal"
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? <IconEyeOff size={18} /> : <IconEye size={18} />}
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="sol-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} className="site-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
});
