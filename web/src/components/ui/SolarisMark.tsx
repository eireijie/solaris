import { useId } from "react";
import { Link } from "react-router-dom";

/**
 * Solaris logo: a solar point inside an orbit ring with two tilted orbit arcs,
 * plus the wordmark. Pure SVG so it is crisp at any size.
 * Pass `to` for an in-app route, `href` for a plain link, neither for a static mark.
 */
export function SolarisMark({
  to,
  href,
  compact = false,
  size = 34,
  tagline = "Climate research platform",
}: {
  to?: string;
  href?: string;
  compact?: boolean;
  size?: number;
  tagline?: string;
}) {
  const content = (
    <>
      <SolarisGlyph size={size} />
      <span className="sol-mark__word">
        Solaris
        {!compact && tagline ? <small>{tagline}</small> : null}
      </span>
    </>
  );
  if (to)
    return (
      <Link className="sol-mark" to={to} aria-label="Solaris home">
        {content}
      </Link>
    );
  if (href)
    return (
      <a className="sol-mark" href={href} aria-label="Solaris home">
        {content}
      </a>
    );
  return <span className="sol-mark">{content}</span>;
}

export function SolarisGlyph({ size = 34 }: { size?: number }) {
  const gid = `sol-sun-${useId().replace(/:/g, "")}`;
  return (
    <svg className="sol-mark__glyph" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={gid} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fff3d6" />
          <stop offset="0.45" stopColor="#f2b75e" />
          <stop offset="1" stopColor="#f2b75e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="17" fill="none" stroke="rgba(255,211,138,0.45)" strokeWidth="1" />
      <ellipse cx="24" cy="24" rx="23" ry="7.5" fill="none" stroke="rgba(102,200,210,0.65)" strokeWidth="1" transform="rotate(-18 24 24)" strokeDasharray="38 200" strokeDashoffset="-6" />
      <ellipse cx="24" cy="24" rx="14.5" ry="4.2" fill="none" stroke="rgba(196,208,227,0.35)" strokeWidth="1" transform="rotate(26 24 24)" strokeDasharray="26 200" strokeDashoffset="-2" />
      <circle cx="24" cy="24" r="9" fill={`url(#${gid})`} />
      <circle cx="24" cy="24" r="3.6" fill="#f2b75e" />
    </svg>
  );
}
