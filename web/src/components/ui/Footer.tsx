import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SolarisMark } from "./SolarisMark";
import type { NavItem } from "./Header";

export type FooterColumn = { title: string; links: NavItem[] };

const DEFAULT_COLUMNS: FooterColumn[] = [
  {
    title: "Data sources",
    links: [
      { label: "NASA GISS — GISTEMP v4 stations", href: "https://data.giss.nasa.gov/gistemp/station_data_v4_globe/" },
      { label: "NOAA GML — Mauna Loa CO₂", href: "https://gml.noaa.gov/ccgg/trends/" },
      { label: "RCMIP — SSP concentrations", href: "https://www.rcmip.org/" },
    ],
  },
];

/**
 * Site footer: brand, link columns, data provenance, NASA SVS imagery credit
 * (required wherever the Earth sequence is shown) and the conditional-output note.
 */
export function Footer({ columns = DEFAULT_COLUMNS, children }: { columns?: FooterColumn[]; children?: ReactNode }) {
  return (
    <footer className="sol-footer">
      <div className="sol-container">
        <div className="sol-footer__grid">
          <div className="sol-footer__brand">
            <SolarisMark />
            <p>
              A student-led climate research platform: seasonal station forecasts, CO₂ pathways, scenario testing and
              validation — with every assumption visible.
            </p>
            {children}
          </div>
          {columns.map((c) => (
            <nav key={c.title} aria-label={c.title} className="sol-footer__col">
              <p className="sol-footer__title">{c.title}</p>
              <ul>
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.to ? (
                      <Link to={l.to}>{l.label}</Link>
                    ) : (
                      <a href={l.href} {...(l.href && /^https?:/.test(l.href) ? { target: "_blank", rel: "noreferrer" } : null)}>
                        {l.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="sol-footer__lower">
          <p>
            Earth imagery: NASA Scientific Visualization Studio,{" "}
            <a href="https://svs.gsfc.nasa.gov/5570/" target="_blank" rel="noreferrer">
              “Spinning Earth with clouds, atmosphere, and night lights”
            </a>{" "}
            — Kel Elkins (USRA), William Putman (NASA/GSFC); Blue Marble data from Aqua and Terra MODIS. Use of NASA
            imagery does not imply NASA endorsement.
          </p>
          <p>
            Projections are conditional model outputs under stated assumptions, not verified predictions. ©{" "}
            {new Date().getFullYear()} Solaris.
          </p>
        </div>
      </div>
    </footer>
  );
}
