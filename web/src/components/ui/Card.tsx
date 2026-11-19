import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLElement> & {
  /** "panel" = bordered surface (default); "glass" = translucent over imagery; "plain" = no chrome. */
  tone?: "panel" | "glass" | "plain" | "raised";
  padding?: "none" | "sm" | "md" | "lg";
  as?: "div" | "section" | "article" | "aside" | "li";
  interactive?: boolean;
  children?: ReactNode;
};

/** Card / Panel surface. */
export function Card({ tone = "panel", padding = "md", as: Tag = "div", interactive, className = "", children, ...rest }: CardProps) {
  return (
    <Tag
      className={`sol-card sol-card--${tone} sol-card--pad-${padding} ${interactive ? "sol-card--interactive" : ""} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export const Panel = Card;

/** Optional header row for cards: title on the left, actions on the right. */
export function CardHeader({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="sol-card__header">
      <div>
        <h3 className="sol-card__title">{title}</h3>
        {meta ? <p className="sol-card__meta">{meta}</p> : null}
      </div>
      {actions ? <div className="sol-card__actions">{actions}</div> : null}
    </div>
  );
}
