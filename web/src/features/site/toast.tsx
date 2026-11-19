/**
 * Minimal toast notifications (polite live region, auto-dismiss, optional action).
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { IconAlert, IconCheck, IconClose, IconInfo } from "../../components/ui";
import "./toast.css";

export type ToastTone = "info" | "success" | "danger";
export type Toast = { id: number; tone: ToastTone; title: ReactNode; body?: ReactNode; action?: { label: string; onClick: () => void } };

type Ctx = { push: (t: Omit<Toast, "id"> & { ms?: number }) => void; dismiss: (id: number) => void };

const ToastCtx = createContext<Ctx>({ push: () => {}, dismiss: () => {} });

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback(
    ({ ms, ...t }: Omit<Toast, "id"> & { ms?: number }) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      window.setTimeout(() => dismiss(id), ms ?? (t.tone === "danger" ? 9000 : 5500));
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="site-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`site-toast site-toast--${t.tone}`}>
            <span className="site-toast__icon" aria-hidden="true">
              {t.tone === "success" ? <IconCheck size={16} /> : t.tone === "danger" ? <IconAlert size={16} /> : <IconInfo size={16} />}
            </span>
            <div className="site-toast__body">
              <p className="site-toast__title">{t.title}</p>
              {t.body ? <p className="site-toast__text">{t.body}</p> : null}
              {t.action ? (
                <button
                  type="button"
                  className="site-toast__action"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
            <button type="button" className="site-toast__close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <IconClose size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
