import type { ReactNode } from "react";
import { IconAlert, IconCheck, IconInfo } from "./icons";

/**
 * Callout for honesty notes, method caveats, warnings and errors.
 * tone="honesty" is the house style for "conditional model output" notes.
 */
export function Callout({
  tone = "info",
  title,
  children,
  icon,
  compact,
}: {
  tone?: "info" | "honesty" | "warning" | "danger" | "success";
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  const defaultIcon =
    tone === "warning" || tone === "danger" ? <IconAlert /> : tone === "success" ? <IconCheck /> : <IconInfo />;
  return (
    <aside
      className={`sol-callout sol-callout--${tone} ${compact ? "sol-callout--compact" : ""}`}
      role={tone === "danger" ? "alert" : "note"}
    >
      <span className="sol-callout__icon" aria-hidden="true">
        {icon ?? defaultIcon}
      </span>
      <div className="sol-callout__body">
        {title ? <p className="sol-callout__title">{title}</p> : null}
        {children ? <div className="sol-callout__text">{children}</div> : null}
      </div>
    </aside>
  );
}
