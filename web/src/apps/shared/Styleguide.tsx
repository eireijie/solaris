/**
 * Styleguide (#/styleguide): every UI component and chart with FAKE data.
 * Feature teams: copy usage from here. Keep it working — smoke tests screenshot it.
 */
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  IconArrowRight,
  IconDownload,
  Modal,
  ModelBadge,
  RunProgress,
  SectionHeading,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  SolarisMark,
  Spinner,
  Stat,
  Tabs,
  Toggle,
  Tooltip,
} from "../../components/ui";
import { GroupCompareChart, Sparkline, TimeSeriesChart } from "../../components/charts";
import type { TSDatum } from "../../components/charts";
import { downloadText, parseAerosCsv, seriesToCsv } from "../../data";
import "./styleguide.css";

/* ---------- fake data (deterministic) ---------- */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

function fakeScenario(warming: number) {
  const r = rng(11);
  const obs: TSDatum[] = [];
  const trend: TSDatum[] = [];
  const proj: TSDatum[] = [];
  for (let y = 1940; y <= 2025; y++) {
    const base = 2.2 + (y > 1980 ? (y - 1980) * 0.024 : 0) + 0.004 * (y - 1940);
    obs.push({ x: y, y: y === 1977 ? null : +(base + r() * 1.6).toFixed(2) });
    trend.push({ x: y, y: +base.toFixed(3) });
  }
  const last = trend[trend.length - 1].y as number;
  for (let y = 2025; y <= 2100; y++) {
    const t = (y - 2025) / 75;
    const m = last + warming * t;
    const spread = 0.35 + 1.1 * t;
    proj.push({ x: y, y: +m.toFixed(3), lower: +(m - spread).toFixed(3), upper: +(m + spread).toFixed(3) });
  }
  return { obs, trend, proj };
}

const CSV_SAMPLE = `Station: EXAMPLE,,,,
YEAR,JAN,FEB,MAR,D-J-F,J-J-A,metANN
1940,0.1,1.2,5.0,999.9,24.87,12.3
1941,0.2,0.4,4.9,1.33,25.10,12.4
1942,,,,0.47,999.9,12.0
1943,1.0,1.1,5.5,0.92,25.40,12.6`;

function Block({ title, children, note }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="sg-block">
      <div className="sg-block__head">
        <h2>{title}</h2>
        {note ? <p className="sol-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function Styleguide() {
  const [season, setSeason] = useState<"djf" | "jja">("djf");
  const [tab, setTab] = useState<"overview" | "method" | "data">("overview");
  const [station, setStation] = useState("dc");
  const [warming, setWarming] = useState(2.4);
  const [band, setBand] = useState(true);
  const [modal, setModal] = useState(false);
  const scen = useMemo(() => fakeScenario(warming), [warming]);
  const parsed = useMemo(() => parseAerosCsv(CSV_SAMPLE), []);

  return (
    <div className="sol-container sol-section sg">
      <SectionHeading
        level={1}
        size="xl"
        eyebrow="Design system"
        title="Solaris styleguide."
        accent="Every component, fake data."
        lede="Dark, spacious, cinematic. Serif display, sans UI, solar gold for the single primary action. All data on this page is illustrative."
      />

      <Block title="Colour tokens">
        <div className="sg-swatches">
          {[
            "space",
            "bg",
            "surface-1",
            "surface-2",
            "surface-3",
            "text",
            "text-2",
            "text-3",
            "solar",
            "solar-hi",
            "atmosphere",
            "model-aeros",
            "model-core",
            "model-catalyst",
            "model-nexus",
            "data-observed",
            "data-trend",
            "data-projection",
            "data-1",
            "data-2",
            "data-3",
            "data-4",
            "data-5",
            "data-6",
          ].map((t) => (
            <div key={t} className="sg-swatch">
              <span style={{ background: `var(--sol-${t})` }} />
              <code>--sol-{t}</code>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Typography">
        <div className="sol-stack" style={{ ["--sol-stack-gap" as string]: "16px" }}>
          <p className="sol-hero__title" style={{ margin: 0, textAlign: "left", maxWidth: "none", fontSize: "var(--sol-text-4xl)" }}>
            Model the future.<span>Test what changes it.</span>
          </p>
          <h2 style={{ fontSize: "var(--sol-text-3xl)" }}>Section title — Newsreader</h2>
          <p className="sol-lede">Lede — Geist, 17–19 px. Projections are conditional model outputs, not verified predictions.</p>
          <p>Body — Geist 16 px. The quick brown fox measures 0.189 °C/decade.</p>
          <p className="sol-mono">Mono — Geist Mono: 1940–1979 vs 1980–2026 · 620.86 ppm</p>
          <p className="sol-eyebrow">Eyebrow label</p>
          <div className="sol-row">
            <SolarisMark />
            <SolarisMark compact />
          </div>
        </div>
      </Block>

      <Block title="Buttons">
        <div className="sol-row">
          <Button iconRight={<IconArrowRight size={16} />}>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link variant</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button loading>Running</Button>
          <Button disabled>Disabled</Button>
          <Button variant="secondary" iconLeft={<IconDownload size={16} />}>
            Download CSV
          </Button>
        </div>
      </Block>

      <Block title="Badges & callouts">
        <div className="sol-row" style={{ marginBottom: 16 }}>
          <Badge>v4.0</Badge>
          <Badge tone="new">New</Badge>
          <Badge tone="info">Simplified model</Badge>
          <Badge tone="warning">Demo data</Badge>
          <Badge tone="success">Ready</Badge>
          <Badge tone="danger">Error</Badge>
          <ModelBadge model="aeros" />
          <ModelBadge model="core" />
          <ModelBadge model="catalyst" />
          <ModelBadge model="nexus" />
        </div>
        <div className="sol-grid" style={{ ["--sol-grid-min" as string]: "300px" }}>
          <Callout tone="honesty" title="Conditional model output">
            Projections show what the model produces under stated assumptions. They are not verified predictions.
          </Callout>
          <Callout tone="info">Data from NASA GISS and NOAA GML.</Callout>
          <Callout tone="warning" title="Short record">
            This station has 42 valid winters; at least ~60 are recommended.
          </Callout>
          <Callout tone="danger" title="Run failed">
            ValueError: no valid D-J-F values
            <pre>Traceback (most recent call last): …</pre>
          </Callout>
        </div>
      </Block>

      <Block title="Stats" note="Every stat carries a source line (honesty rule).">
        <div className="sol-grid" style={{ ["--sol-grid-min" as string]: "200px" }}>
          <Stat value="+0.189" unit="°C/decade" label="Winter trend increase, 1980–2026 vs 1940–1979" source="Example · poster" tone="solar" />
          <Stat value="34/40" label="Stations warming faster in summer" source="Example · poster" />
          <Stat value="620.86" unit="ppm" label="CO₂ by 2100 (historical continuation)" source="Example · CORe 4.0" tone="atmosphere" />
          <Stat value="9.00" unit="°C" label="Washington D.C. winter mean, 2100" source="Example · Aeros 4.0" size="sm" />
        </div>
      </Block>

      <Block title="Controls">
        <div className="sol-grid" style={{ ["--sol-grid-min" as string]: "280px", alignItems: "start" }}>
          <div className="sol-stack">
            <SegmentedControl
              label="Season"
              value={season}
              onChange={setSeason}
              options={[
                { value: "djf", label: "Winter · DJF" },
                { value: "jja", label: "Summer · JJA" },
              ]}
            />
            <Select
              label="Station"
              value={station}
              onChange={setStation}
              hint="Native select: best on phones."
              groups={[
                { label: "United States", options: [{ value: "dc", label: "Washington, D.C." }, { value: "bos", label: "Boston, MA" }] },
                { label: "Argentina", options: [{ value: "ba", label: "Buenos Aires" }] },
              ]}
            />
          </div>
          <div className="sol-stack">
            <Slider label="Added warming by 2100" min={0} max={5} step={0.1} value={warming} onChange={setWarming} format={(v) => `+${v.toFixed(1)} °C`} hint="Drives the chart below (animated)." marks={[{ value: 0, label: "0" }, { value: 2.5, label: "2.5" }, { value: 5, label: "5" }]} />
            <Toggle label="Show uncertainty band" checked={band} onChange={setBand} hint="95% bootstrap range (example)." />
            <div className="sol-row">
              <span>Tooltip</span>
              <Tooltip content="D-J-F for year Y uses December of Y−1 plus January and February of Y." />
              <Tooltip content="Opens the method note">
                <Button variant="ghost" size="sm">
                  Hover or focus me
                </Button>
              </Tooltip>
            </div>
            <div>
              <Button variant="secondary" onClick={() => setModal(true)}>
                Open modal
              </Button>
            </div>
          </div>
        </div>
        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title="About this projection"
          description="Focus is trapped; Esc or the backdrop closes."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModal(false)}>
                Cancel
              </Button>
              <Button onClick={() => setModal(false)}>Got it</Button>
            </>
          }
        >
          <p>Aeros 4.0 fits a seasonal model to the station record and projects to 2100 with bootstrap bounds.</p>
        </Modal>
      </Block>

      <Block title="Tabs">
        <Tabs
          label="Result views"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "overview", label: "Overview" },
            { value: "method", label: "Method" },
            { value: "data", label: "Data" },
          ]}
        >
          {(v) => <p className="sol-muted">Panel: {v}. Only the active panel is mounted.</p>}
        </Tabs>
      </Block>

      <Block title="Time-series chart" note="Hover / touch / arrow keys for the crosshair. Click legend items to toggle. Drag the slider above to see transitions.">
        <Card padding="lg">
          <TimeSeriesChart
            title="Example station · winter (D-J-F) temperature"
            description="Illustrative data, not a real station."
            unit="°C"
            projectionStart={2025}
            series={[
              { id: "obs", label: "Observed", role: "observed", type: "points", data: scen.obs },
              { id: "trend", label: "Fitted trend", role: "trend", data: scen.trend },
              {
                id: "proj",
                label: "Projection (example)",
                role: "projection",
                bandLabel: "95% range",
                data: band ? scen.proj : scen.proj.map((d) => ({ x: d.x, y: d.y })),
              },
            ]}
            footer="Illustrative data · Conditional model output, not a prediction."
          />
        </Card>
        <div className="sol-grid" style={{ ["--sol-grid-min" as string]: "320px", marginTop: 24 }}>
          <Card>
            <TimeSeriesChart
              title="Multiple named series"
              unit="ppm"
              height={260}
              projectionStart={2025}
              series={["SSP1-2.6", "SSP2-4.5", "SSP5-8.5"].map((name, i) => ({
                id: name,
                label: name,
                data: Array.from({ length: 16 }, (_, k) => {
                  const x = 1950 + k * 10;
                  const hist = 310 + Math.pow(Math.max(0, x - 1950), 1.6) * 0.15;
                  return { x, y: x <= 2020 ? hist : hist + (x - 2020) * (i * 1.6 - 0.6) };
                }),
              }))}
            />
          </Card>
          <Card>
            <TimeSeriesChart
              title="Forcing"
              unit="W/m²"
              height={260}
              includeZero
              references={[{ y: 0, label: "pre-industrial" }]}
              series={[{ id: "f", label: "CO₂ forcing (example)", role: "projection", data: Array.from({ length: 31 }, (_, k) => ({ x: 1950 + k * 5, y: 5.35 * Math.log((310 + k * k * 0.5) / 278) })) }]}
            />
          </Card>
        </div>
      </Block>

      <Block title="Group comparison (dot + CI) and sparklines">
        <div className="sol-grid" style={{ ["--sol-grid-min" as string]: "320px" }}>
          <Card>
            <GroupCompareChart
              title="Trend change between periods (example)"
              unit="°C/decade"
              reference={0}
              referenceLabel="no change"
              digits={3}
              groups={[
                { label: "Winter (DJF)", value: 0.189, lower: 0.085, upper: 0.294, note: "p = 0.0007" },
                { label: "Summer (JJA)", value: 0.211 + (warming - 2.4) * 0.02, lower: 0.132, upper: 0.29, note: "p < 0.001" },
                { label: "Urban (fake)", value: 0.25, lower: 0.12, upper: 0.38 },
                { label: "Rural (fake)", value: 0.15, lower: 0.02, upper: 0.27 },
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="Sparklines" meta="Inline trends in lists and stat tiles" />
            <div className="sol-stack">
              {["Boston", "Buenos Aires", "Denver"].map((n, i) => (
                <div key={n} className="sol-row" style={{ justifyContent: "space-between" }}>
                  <span>{n}</span>
                  <Sparkline data={scen.obs.slice(i * 10, i * 10 + 50).map((d) => d.y ?? null)} color={`var(--sol-data-${i + 1})`} />
                </div>
              ))}
              <Sparkline data={scen.proj} band width={240} height={48} label="Projection sparkline with band" />
            </div>
          </Card>
        </div>
      </Block>

      <Block title="Loading & model-running states">
        <div className="sol-grid" style={{ ["--sol-grid-min" as string]: "300px", alignItems: "start" }}>
          <RunProgress
            title="Running Aeros 4.0"
            stages={[{ label: "Prepare station series" }, { label: "Fit seasonal ensemble", detail: "D-J-F · 200 bootstrap draws" }, { label: "Project to 2100" }, { label: "Summarise bounds" }]}
            current={1}
            elapsedMs={3400}
            note="Runs in your browser — nothing is uploaded."
          />
          <Card>
            <div className="sol-stack">
              <Skeleton height={28} width="60%" />
              <Skeleton height={14} />
              <Skeleton height={14} width="85%" />
              <Skeleton height={180} radius={8} />
              <div className="sol-row">
                <Spinner /> <span className="sol-muted">Spinner</span>
              </div>
            </div>
          </Card>
        </div>
      </Block>

      <Block title="CSV upload parser" note="parseAerosCsv() on a NASA-style file with 999.9 and extra columns.">
        <Card>
          <ul className="sg-messages">
            {parsed.messages.map((m, i) => (
              <li key={i}>
                <Badge tone={m.level === "error" ? "danger" : m.level === "warning" ? "warning" : "info"}>{m.level}</Badge> {m.message}
                {m.line ? <span className="sol-muted"> (line {m.line})</span> : null}
              </li>
            ))}
          </ul>
          <pre className="sol-mono" style={{ fontSize: 12, marginTop: 12, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(parsed.series)}
          </pre>
          <div style={{ marginTop: 12 }}>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<IconDownload size={14} />}
              onClick={() =>
                downloadText(
                  "solaris-example.csv",
                  seriesToCsv(
                    { year: scen.proj.map((d) => d.x), mean: scen.proj.map((d) => d.y ?? null), lower: scen.proj.map((d) => d.lower ?? null), upper: scen.proj.map((d) => d.upper ?? null) },
                    ["Solaris example export — illustrative data", "Conditional model output, not a prediction"],
                  ),
                )
              }
            >
              Export example CSV
            </Button>
          </div>
        </Card>
      </Block>
    </div>
  );
}
