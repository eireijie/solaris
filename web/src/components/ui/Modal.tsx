import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { IconClose } from "./icons";

/**
 * Modal dialog built on native <dialog>.showModal(): top layer, inert background,
 * Esc closes, focus is trapped (Tab cycles inside) and restored to the opener.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const id = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      opener.current = document.activeElement;
      dlg.showModal();
      document.documentElement.classList.add("sol-modal-open");
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    const onClosed = () => {
      document.documentElement.classList.remove("sol-modal-open");
      const el = opener.current as HTMLElement | null;
      if (el && typeof el.focus === "function") el.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = dlg.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dlg.addEventListener("cancel", onCancel);
    dlg.addEventListener("close", onClosed);
    dlg.addEventListener("keydown", onKey);
    return () => {
      dlg.removeEventListener("cancel", onCancel);
      dlg.removeEventListener("close", onClosed);
      dlg.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`sol-modal sol-modal--${size}`}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes.
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="sol-modal__inner">
          <header className="sol-modal__header">
            <div>
              <h2 id={`${id}-title`} className="sol-modal__title">
                {title}
              </h2>
              {description ? (
                <p id={`${id}-desc`} className="sol-modal__desc">
                  {description}
                </p>
              ) : null}
            </div>
            <button type="button" className="sol-icon-btn" aria-label="Close dialog" onClick={onClose}>
              <IconClose />
            </button>
          </header>
          <div className="sol-modal__body">{children}</div>
          {footer ? <footer className="sol-modal__footer">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
