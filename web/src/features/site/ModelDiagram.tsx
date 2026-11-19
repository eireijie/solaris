/**
 * How the four models connect — hand-built SVG, wide (≥ 760px) and tall (phone) layouts.
 * Colours come from tokens via CSS classes (site.css: .md-*).
 */
import { useId } from "react";

type Box = { x: number; y: number; w: number; h: number };

function DataNode({ b, title, sub }: { b: Box; title: string; sub: string }) {
  return (
    <g className="md-data">
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={10} />
      <text x={b.x + 16} y={b.y + b.h / 2 - 4} className="md-data__title">
        {title}
      </text>
      <text x={b.x + 16} y={b.y + b.h / 2 + 15} className="md-data__sub">
        {sub}
      </text>
    </g>
  );
}

function ModelNode({
  b,
  id,
  name,
  version,
  status,
  role,
  out,
}: {
  b: Box;
  id: "aeros" | "core" | "catalyst" | "nexus";
  name: string;
  version: string;
  status: string;
  role: string;
  out: string;
}) {
  return (
    <g className={`md-model md-model--${id}`}>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} className="md-model__bg" />
      <rect x={b.x} y={b.y + 14} width={3} height={b.h - 28} rx={1.5} className="md-model__bar" />
      <text x={b.x + 20} y={b.y + 30} className="md-model__name">
        {name} <tspan className="md-model__ver">{version}</tspan>
      </text>
      <text x={b.x + b.w - 16} y={b.y + 29} textAnchor="end" className={`md-model__status ${status.startsWith("New") ? "is-new" : ""}`}>
        {status}
      </text>
      <text x={b.x + 20} y={b.y + 54} className="md-model__role">
        {role}
      </text>
      <text x={b.x + 20} y={b.y + 74} className="md-model__out">
        → {out}
      </text>
    </g>
  );
}

function Arrow({ d, label, lx, ly, anchor = "start", planned, marker }: { d: string; label?: string; lx?: number; ly?: number; anchor?: "start" | "middle" | "end"; planned?: boolean; marker: string }) {
  return (
    <g className={`md-link ${planned ? "md-link--planned" : ""}`}>
      <path d={d} markerEnd={`url(#${marker})`} pathLength={1} />
      {label ? (
        <text x={lx} y={ly} textAnchor={anchor} className="md-link__label">
          {label}
        </text>
      ) : null}
    </g>
  );
}

export function ModelDiagram() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const mk = `md-arrow-${uid}`;
  const mkp = `md-arrow-p-${uid}`;
  const defs = (
    <defs>
      <marker id={mk} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 1 L9 5 L0 9 z" className="md-marker" />
      </marker>
      <marker id={mkp} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 1 L9 5 L0 9 z" className="md-marker md-marker--planned" />
      </marker>
    </defs>
  );

  // ---------- wide ----------
  const W = { data: 0, dataW: 236, model: 352, modelW: 440 };
  const aeros: Box = { x: W.model, y: 24, w: W.modelW, h: 88 };
  const nexus: Box = { x: W.model, y: 148, w: W.modelW, h: 88 };
  const core: Box = { x: W.model, y: 296, w: W.modelW, h: 88 };
  const cat: Box = { x: W.model, y: 420, w: W.modelW, h: 88 };
  const dStations: Box = { x: 0, y: 30, w: W.dataW, h: 62 };
  const dCsv: Box = { x: 0, y: 108, w: W.dataW, h: 62 };
  const dCo2: Box = { x: 0, y: 309, w: W.dataW, h: 62 };
  const dSsp: Box = { x: 0, y: 433, w: W.dataW, h: 62 };
  const cy = (b: Box) => b.y + b.h / 2;
  const right = (b: Box) => b.x + b.w;
  const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2 - 2} ${y2}`;

  return (
    <figure className="md" aria-labelledby={`md-cap-${uid}`}>
      <svg className="md-svg md-svg--wide" viewBox="0 0 1000 520" role="img" aria-labelledby={`md-title-${uid}`}>
        <title id={`md-title-${uid}`}>
          Station records and uploaded CSV files feed Aeros; Nexus audits Aeros with a hindcast. Global CO₂ feeds CORe;
          Catalyst builds scenarios on CORe’s pathway and physics using SSP pathways. A planned link would feed Catalyst
          scenarios back into Aeros station projections.
        </title>
        {defs}
        <text x={0} y={12} className="md-col">DATA</text>
        <text x={W.model} y={12} className="md-col">MODELS</text>

        <DataNode b={dStations} title="Station records" sub="NOAA GHCN-M v4 · 45 stations" />
        <DataNode b={dCsv} title="Your CSV" sub="Year, winter, summer" />
        <DataNode b={dCo2} title="Global CO₂" sub="NOAA GML · RCMIP, 1940–2025" />
        <DataNode b={dSsp} title="SSP pathways" sub="RCMIP emissions & ppm" />

        <Arrow marker={mk} d={curve(right(dStations), cy(dStations), aeros.x, cy(aeros) - 10)} />
        <Arrow marker={mk} d={curve(right(dCsv), cy(dCsv), aeros.x, cy(aeros) + 10)} />
        <Arrow marker={mk} d={curve(right(dStations), cy(dStations) + 14, nexus.x, cy(nexus))} label="observations to score against" lx={W.model - 12} ly={cy(nexus) + 30} anchor="end" />
        <Arrow marker={mk} d={curve(right(dCo2), cy(dCo2), core.x, cy(core))} />
        <Arrow marker={mk} d={curve(right(dSsp), cy(dSsp), cat.x, cy(cat))} />

        <Arrow marker={mk} d={`M${aeros.x + 90} ${aeros.y + aeros.h} L${aeros.x + 90} ${nexus.y - 2}`} label="audited by" lx={aeros.x + 102} ly={aeros.y + aeros.h + 23} />
        <Arrow marker={mk} d={`M${core.x + 90} ${core.y + core.h} L${core.x + 90} ${cat.y - 2}`} label="pathway + physics" lx={core.x + 102} ly={core.y + core.h + 23} />

        <Arrow
          marker={mkp}
          planned
          d={`M${right(cat)} ${cy(cat)} C ${right(cat) + 120} ${cy(cat)}, ${right(cat) + 120} ${cy(aeros)}, ${right(aeros) + 2} ${cy(aeros)}`}
        />
        <g className="md-planned-tag">
          <rect x={right(aeros) + 40} y={250} width={150} height={52} rx={8} />
          <text x={right(aeros) + 115} y={272} textAnchor="middle" className="md-planned-tag__t">
            PLANNED
          </text>
          <text x={right(aeros) + 115} y={290} textAnchor="middle" className="md-planned-tag__s">
            scenario-driven stations
          </text>
        </g>

        <ModelNode b={aeros} id="aeros" name="Aeros" version="4.0" status="From notebook" role="Seasonal station temperatures to 2100" out="projection with 95% range" />
        <ModelNode b={nexus} id="nexus" name="Nexus" version="1.0" status="New · simplified" role="Validation and context" out="hindcast skill vs baselines, trend tests" />
        <ModelNode b={core} id="core" name="CORe" version="4.0" status="From notebook" role="Global CO₂ and radiative forcing" out="CO₂ pathway to 2100 with range" />
        <ModelNode b={cat} id="catalyst" name="Catalyst" version="1.0" status="New · simplified" role="What-if emissions scenarios" out="scenario CO₂ and warming vs baseline" />
      </svg>

      <TallDiagram uid={uid} mk={mk} defs={defs} />

      <figcaption id={`md-cap-${uid}`} className="md-caption">
        Solid arrows exist today. The dashed link — driving station projections with Catalyst scenarios — is planned
        research, not a shipped feature.
      </figcaption>
    </figure>
  );
}

function TallDiagram({ uid, mk, defs }: { uid: string; mk: string; defs: React.ReactNode }) {
  const w = 328; // leaves a lane on the right for the SSP → Catalyst link
  const dA: Box = { x: 0, y: 26, w: 172, h: 56 };
  const dB: Box = { x: 188, y: 26, w: 172, h: 56 };
  const aeros: Box = { x: 0, y: 116, w, h: 88 };
  const nexus: Box = { x: 0, y: 238, w, h: 88 };
  const dC: Box = { x: 0, y: 380, w: 172, h: 56 };
  const dD: Box = { x: 188, y: 380, w: 172, h: 56 };
  const core: Box = { x: 0, y: 470, w, h: 88 };
  const cat: Box = { x: 0, y: 592, w, h: 88 };
  const small = (b: Box, t: string, s: string) => <DataNode b={b} title={t} sub={s} />;
  return (
    <svg className="md-svg md-svg--tall" viewBox="0 0 360 690" role="img" aria-labelledby={`md-title-t-${uid}`}>
      <title id={`md-title-t-${uid}`}>
        Station records and your CSV feed Aeros, which Nexus audits. Global CO₂ feeds CORe, and Catalyst builds scenarios on
        CORe using SSP pathways.
      </title>
      {defs}
      <text x={0} y={12} className="md-col">TEMPERATURE</text>
      {small(dA, "Station records", "NOAA GHCN-M v4")}
      {small(dB, "Your CSV", "Year, winter, summer")}
      <Arrow marker={mk} d={`M86 ${dA.y + dA.h} L86 ${aeros.y - 2}`} />
      <Arrow marker={mk} d={`M274 ${dB.y + dB.h} L274 ${aeros.y - 2}`} />
      <Arrow marker={mk} d={`M60 ${aeros.y + aeros.h} L60 ${nexus.y - 2}`} label="audited by" lx={72} ly={aeros.y + aeros.h + 21} />
      <ModelNode b={aeros} id="aeros" name="Aeros" version="4.0" status="From notebook" role="Seasonal station temperatures" out="projection to 2100, 95% range" />
      <ModelNode b={nexus} id="nexus" name="Nexus" version="1.0" status="New · simplified" role="Validation and context" out="hindcast skill, trend tests" />

      <text x={0} y={366} className="md-col">CARBON</text>
      {small(dC, "Global CO₂", "NOAA GML · RCMIP")}
      {small(dD, "SSP pathways", "RCMIP")}
      <Arrow marker={mk} d={`M86 ${dC.y + dC.h} L86 ${core.y - 2}`} />
      <Arrow
        marker={mk}
        d={`M274 ${dD.y + dD.h} C 274 ${dD.y + dD.h + 18}, 346 ${dD.y + dD.h + 12}, 346 ${dD.y + dD.h + 36} L346 ${cat.y + 24} C 346 ${cat.y + 40}, 340 ${cat.y + 44}, ${w + 2} ${cat.y + 44}`}
      />
      <Arrow marker={mk} d={`M60 ${core.y + core.h} L60 ${cat.y - 2}`} label="pathway + physics" lx={72} ly={core.y + core.h + 21} />
      <ModelNode b={core} id="core" name="CORe" version="4.0" status="From notebook" role="Global CO₂ and forcing" out="CO₂ pathway with range" />
      <ModelNode b={cat} id="catalyst" name="Catalyst" version="1.0" status="New · simplified" role="What-if emissions scenarios" out="scenario CO₂ and warming" />
    </svg>
  );
}
