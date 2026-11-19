import { useEffect, useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement } from "react";
import { IconInfo } from "./icons";

/**
 * Tooltip shown on hover and keyboard focus; tap toggles on touch. Esc dismisses.
 * Wrap a single focusable element, or omit `children` to get an (i) info button.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  label = "More information",
}: {
  content: ReactNode;
  children?: ReactElement<Record<string, unknown>>;
  side?: "top" | "bottom";
  /** Accessible name for the default info button. */
  label?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const trigger =
    children && isValidElement(children) ? (
      cloneElement(children, { "aria-describedby": id })
    ) : (
      <button type="button" className="sol-tooltip__info" aria-label={label} aria-describedby={id} onClick={() => setOpen((o) => !o)}>
        <IconInfo size={16} />
      </button>
    );

  return (
    <span
      ref={wrap}
      className={`sol-tooltip sol-tooltip--${side} ${open ? "is-open" : ""}`}
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {trigger}
      <span role="tooltip" id={id} className="sol-tooltip__bubble">
        {content}
      </span>
    </span>
  );
}
