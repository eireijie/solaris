import type { ReactNode } from "react";

/**
 * Eyebrow + serif title + lede. `accent` renders a second title line in solar gold
 * (the hero pattern "Model the future. / Test what changes it.").
 */
export function SectionHeading({
  eyebrow,
  title,
  accent,
  lede,
  align = "start",
  level = 2,
  size = "lg",
  id,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  accent?: ReactNode;
  lede?: ReactNode;
  align?: "start" | "center";
  level?: 1 | 2 | 3;
  size?: "md" | "lg" | "xl";
  id?: string;
  children?: ReactNode;
}) {
  const H = `h${level}` as "h1" | "h2" | "h3";
  return (
    <header className={`sol-heading sol-heading--${align} sol-heading--${size}`}>
      {eyebrow ? <p className="sol-eyebrow">{eyebrow}</p> : null}
      <H className="sol-heading__title" id={id}>
        {title}
        {accent ? <span className="sol-heading__accent">{accent}</span> : null}
      </H>
      {lede ? <p className="sol-heading__lede">{lede}</p> : null}
      {children}
    </header>
  );
}
