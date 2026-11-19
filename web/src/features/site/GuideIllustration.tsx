/**
 * Schematic line illustrations for the guide (hand-drawn SVG, token colours).
 * They depict the real UI ideas (station list, projection band, hindcast, CO₂ curve, sliders, save/export).
 */
export type GuideArt = "station" | "aeros" | "nexus" | "core" | "catalyst" | "save";

const W = 320;
const H = 200;

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg className="gi" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="14" className="gi-frame" />
      <circle cx="18" cy="16" r="3" className="gi-dot" />
      <circle cx="30" cy="16" r="3" className="gi-dot" />
      <circle cx="42" cy="16" r="3" className="gi-dot" />
      {children}
    </svg>
  );
}

// Deterministic pseudo-observations for the drawings (decorative only).
const OBS = [62, 70, 58, 66, 72, 61, 69, 75, 64, 71, 78, 67, 74, 81, 73, 79, 84, 76, 83, 88];

export function GuideIllustration({ art }: { art: GuideArt }) {
  switch (art) {
    case "station":
      return (
        <Frame label="Illustration: a list of stations with one selected, and a CSV file being added">
          <rect x="20" y="36" width="170" height="26" rx="6" className="gi-input" />
          <text x="30" y="53" className="gi-t gi-t--muted">Search stations…</text>
          {["Washington, D.C.", "Buenos Aires", "Chicago", "Córdoba"].map((s, i) => (
            <g key={s} transform={`translate(20 ${72 + i * 28})`}>
              <rect width="170" height="22" rx="5" className={i === 0 ? "gi-row gi-row--on" : "gi-row"} />
              <circle cx="12" cy="11" r="3.5" className={i === 0 ? "gi-pin gi-pin--on" : "gi-pin"} />
              <text x="24" y="15" className="gi-t">{s}</text>
            </g>
          ))}
          <g transform="translate(210 64)">
            <path d="M0 0h58l22 22v74H0z" className="gi-file" />
            <path d="M58 0v22h22" className="gi-file" />
            <text x="12" y="46" className="gi-t gi-t--mono">YEAR,</text>
            <text x="12" y="60" className="gi-t gi-t--mono">D-J-F,</text>
            <text x="12" y="74" className="gi-t gi-t--mono">J-J-A</text>
            <text x="40" y="118" textAnchor="middle" className="gi-t gi-t--accent">.csv</text>
          </g>
        </Frame>
      );
    case "aeros":
      return (
        <Frame label="Illustration: observed points, a fitted trend and a projection with a widening range to 2100">
          <path d="M20 160H300" className="gi-axis" />
          {OBS.map((v, i) => (
            <circle key={i} cx={24 + i * 7} cy={180 - v} r="2.2" className="gi-obs" />
          ))}
          <path d="M22 118 Q 90 108 160 96" className="gi-trend" />
          <path d="M160 88 L300 34 L300 92 L160 104 Z" className="gi-band" />
          <path d="M160 96 L300 62" className="gi-proj" />
          <path d="M160 40V162" className="gi-marker" />
          <text x="166" y="48" className="gi-t gi-t--muted">projection</text>
          <text x="296" y="54" textAnchor="end" className="gi-t gi-t--accent">2100</text>
        </Frame>
      );
    case "nexus":
      return (
        <Frame label="Illustration: a hindcast trained to 2000 compared with what was observed afterwards">
          <path d="M20 160H300" className="gi-axis" />
          <rect x="190" y="34" width="110" height="126" className="gi-test" />
          <text x="196" y="48" className="gi-t gi-t--muted">scored 2001–2026</text>
          {OBS.map((v, i) => (
            <circle key={i} cx={24 + i * 14} cy={180 - v} r="2.2" className={i > 11 ? "gi-obs gi-obs--test" : "gi-obs"} />
          ))}
          <path d="M22 116 Q 120 104 190 96 L300 84" className="gi-hind" />
          <path d="M190 34V160" className="gi-marker" />
          <text x="186" y="172" textAnchor="end" className="gi-t gi-t--muted">train ≤ 2000</text>
          <g transform="translate(206 112)">
            <rect width="86" height="38" rx="6" className="gi-card" />
            <text x="10" y="16" className="gi-t gi-t--muted">RMSE vs baseline</text>
            <path d="M10 26h50" className="gi-bar" />
            <path d="M10 32h62" className="gi-bar gi-bar--base" />
          </g>
        </Frame>
      );
    case "core":
      return (
        <Frame label="Illustration: CO₂ rising along an accelerating curve with a range after the observed record">
          <path d="M20 160H300" className="gi-axis" />
          <path d="M20 150 C 80 146, 130 132, 180 110" className="gi-obsline" />
          <path d="M180 110 C 220 92, 260 70, 300 40 L300 78 C 260 98, 220 108, 180 110 Z" className="gi-band gi-band--core" />
          <path d="M180 110 C 222 98, 262 80, 300 58" className="gi-proj gi-proj--core" />
          <text x="26" y="44" className="gi-t gi-t--muted">ppm</text>
          <text x="296" y="34" textAnchor="end" className="gi-t gi-t--core">CO₂ 2100</text>
        </Frame>
      );
    case "catalyst":
      return (
        <Frame label="Illustration: sliders for peak year and decline rate next to two diverging scenario curves">
          {["Peak year", "Decline %/yr", "Net zero"].map((s, i) => (
            <g key={s} transform={`translate(20 ${44 + i * 40})`}>
              <text x="0" y="0" className="gi-t gi-t--muted">{s}</text>
              <path d="M0 14h110" className="gi-track" />
              <path d={`M0 14h${[40, 70, 55][i]}`} className="gi-track gi-track--on" />
              <circle cx={[40, 70, 55][i]} cy="14" r="6" className="gi-knob" />
            </g>
          ))}
          <path d="M150 160H300" className="gi-axis" />
          <path d="M150 130 C 200 110, 250 80, 300 52" className="gi-proj gi-proj--muted" />
          <path d="M150 130 C 190 116, 230 112, 300 116" className="gi-proj gi-proj--cat" />
          <text x="296" y="46" textAnchor="end" className="gi-t gi-t--muted">baseline</text>
          <text x="296" y="132" textAnchor="end" className="gi-t gi-t--cat">your scenario</text>
        </Frame>
      );
    case "save":
      return (
        <Frame label="Illustration: a result saved into a project folder and exported as CSV or JSON">
          <g transform="translate(24 44)">
            <rect width="120" height="80" rx="8" className="gi-card" />
            <path d="M12 60 C 40 54, 70 40, 108 22" className="gi-proj" />
            <text x="12" y="20" className="gi-t">Run · D.C.</text>
          </g>
          <path d="M152 84h36" className="gi-arrow" markerEnd="url(#gi-head)" />
          <defs>
            <marker id="gi-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 1L9 5L0 9z" className="gi-head" />
            </marker>
          </defs>
          <g transform="translate(198 50)">
            <path d="M0 8a4 4 0 0 1 4-4h26l8 9h52a4 4 0 0 1 4 4v52a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4z" className="gi-folder" />
            <text x="10" y="44" className="gi-t">My project</text>
          </g>
          {["CSV", "JSON"].map((t, i) => (
            <g key={t} transform={`translate(${24 + i * 70} 146)`}>
              <rect width="60" height="26" rx="13" className="gi-chip" />
              <text x="30" y="17" textAnchor="middle" className="gi-t gi-t--mono">{t}</text>
            </g>
          ))}
        </Frame>
      );
  }
}
