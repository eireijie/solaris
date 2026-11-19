import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { IconClose, IconMenu } from "./icons";
import { SolarisMark } from "./SolarisMark";

export type NavItem = { label: string; to?: string; href?: string };

function Item({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  if (item.to)
    return (
      <NavLink to={item.to} end className={({ isActive }) => `sol-nav__link ${isActive ? "is-active" : ""}`} onClick={onNavigate}>
        {item.label}
      </NavLink>
    );
  return (
    <a className="sol-nav__link" href={item.href} onClick={onNavigate}>
      {item.label}
    </a>
  );
}

/**
 * Site header. Fixed at the top; `overlay` makes it transparent over a hero until
 * the page scrolls (then it gets a glass background). Without `overlay` a spacer
 * keeps content below it. Responsive: below 860px the nav collapses into a
 * full-screen menu (Esc closes, focus moves into the menu and back).
 */
export function Header({
  nav = [],
  actions,
  overlay = false,
  homeTo = "/",
  homeHref,
  badge,
}: {
  nav?: NavItem[];
  /** Right-side actions, e.g. <Button size="sm">Launch</Button>. Also shown in the mobile menu. */
  actions?: ReactNode;
  overlay?: boolean;
  /** Router path for the logo link (ignored if homeHref is set). */
  homeTo?: string;
  homeHref?: string;
  /** Small label after the logo, e.g. <Badge>Summit demo</Badge>. */
  badge?: ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("sol-menu-open");
    menuRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("sol-menu-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const solid = !overlay || scrolled || open;

  return (
    <>
      <header className={`sol-header ${solid ? "is-solid" : ""} ${open ? "is-open" : ""}`}>
        <div className="sol-header__inner sol-container">
          <div className="sol-header__brand">
            <SolarisMark compact to={homeHref ? undefined : homeTo} href={homeHref} size={30} />
            {badge}
          </div>
          {nav.length ? (
            <nav className="sol-header__nav" aria-label="Primary">
              {nav.map((n) => (
                <Item key={n.label} item={n} />
              ))}
            </nav>
          ) : null}
          <div className="sol-header__actions">{actions}</div>
          {nav.length || actions ? (
            <button
              ref={toggleRef}
              type="button"
              className="sol-icon-btn sol-header__toggle"
              aria-expanded={open}
              aria-controls="sol-mobile-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <IconClose size={20} /> : <IconMenu size={20} />}
            </button>
          ) : null}
        </div>
      </header>
      <div id="sol-mobile-menu" ref={menuRef} className={`sol-mobile-menu ${open ? "is-open" : ""}`} hidden={!open}>
        <nav aria-label="Mobile">
          {nav.map((n) => (
            <Item key={n.label} item={n} onNavigate={() => setOpen(false)} />
          ))}
        </nav>
        {actions ? <div className="sol-mobile-menu__actions">{actions}</div> : null}
      </div>
      {!overlay ? <div className="sol-header-spacer" aria-hidden="true" /> : null}
    </>
  );
}
