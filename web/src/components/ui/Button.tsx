import { forwardRef } from "react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Spinner } from "./Skeleton";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "link";
export type ButtonSize = "sm" | "md" | "lg";

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon rendered after the label (e.g. <IconArrowRight />). */
  iconRight?: ReactNode;
  iconLeft?: ReactNode;
  /** Shows a spinner and sets aria-busy; button is disabled while loading. */
  loading?: boolean;
  block?: boolean;
  className?: string;
  children?: ReactNode;
};

type AsButton = Common & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined; to?: undefined };
type AsAnchor = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; to?: undefined };
/** In-app route (React Router). */
type AsLink = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; href?: undefined };

export type ButtonProps = AsButton | AsAnchor | AsLink;

function classes(p: Common) {
  return [
    "sol-btn",
    `sol-btn--${p.variant ?? "primary"}`,
    `sol-btn--${p.size ?? "md"}`,
    p.block ? "sol-btn--block" : "",
    p.loading ? "is-loading" : "",
    p.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function Inner({ iconLeft, iconRight, loading, children }: Common) {
  return (
    <>
      {loading ? <Spinner size={16} label="" /> : iconLeft}
      {children != null && <span className="sol-btn__label">{children}</span>}
      {iconRight ? <span className="sol-btn__icon">{iconRight}</span> : null}
    </>
  );
}

/**
 * Primary gold / secondary / ghost / link button.
 * `href` → <a>, `to` → router <Link>, otherwise <button type="button">.
 */
export const Button = forwardRef<HTMLButtonElement & HTMLAnchorElement, ButtonProps>(function Button(props, ref) {
  const { variant, size, iconRight, iconLeft, loading, block, className, children, ...rest } = props;
  const common = { variant, size, iconRight, iconLeft, loading, block, className, children };
  if ("to" in rest && rest.to !== undefined) {
    const { to, ...a } = rest as AsLink;
    return (
      <Link ref={ref} to={to} className={classes(common)} {...a}>
        <Inner {...common} />
      </Link>
    );
  }
  if ("href" in rest && rest.href !== undefined) {
    const a = rest as AsAnchor;
    const external = /^https?:/.test(a.href);
    return (
      <a
        ref={ref}
        className={classes(common)}
        {...(external ? { target: "_blank", rel: "noreferrer" } : null)}
        {...a}
      >
        <Inner {...common} />
      </a>
    );
  }
  const b = rest as AsButton;
  return (
    <button
      ref={ref}
      type={b.type ?? "button"}
      className={classes(common)}
      aria-busy={loading || undefined}
      {...b}
      disabled={b.disabled || loading}
    >
      <Inner {...common} />
    </button>
  );
});
