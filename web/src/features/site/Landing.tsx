/**
 * Platform landing page: scroll-driven Earth story, then research, models, trust, roadmap, team.
 * Must stay light: no Supabase, no Pyodide, no workbench code (only precomputed JSON for previews).
 */
import type { ReactNode } from "react";
import { EarthChapter, EarthScroll } from "../../components/EarthScroll";
import type { EarthKeyframe } from "../../components/EarthScroll";
import { Button, IconArrowRight, IconArrowUpRight, Stat } from "../../components/ui";
import { GroupCompareChart } from "../../components/charts";
import { demoUrl } from "../../lib/paths";
import { CONDITIONAL_NOTE, MODELS, NOT_LIST, OWN_LIMITATION, POSTER, POSTER_SOURCE, ROADMAP, TRUST } from "./content";
import { LazyMount, Reveal } from "./Reveal";
import { PreviewCharts } from "./PreviewCharts";
import { TeamGrid } from "./TeamCards";
import { PRESENTED_AT } from "./team";
import "./site.css";
import "./landing.css";

const PATH_WIDE: EarthKeyframe[] = [
  { at: 0.0, x: 0.5, y: 1.06, d: 1.12 },
  { at: 0.13, x: 0.5, y: 1.0, d: 1.12 },
  { at: 0.25, x: 0.72, y: 0.55, d: 0.86 },
  { at: 0.38, x: 0.72, y: 0.55, d: 0.88 },
  { at: 0.5, x: 0.28, y: 0.56, d: 0.98 },
  { at: 0.62, x: 0.28, y: 0.56, d: 1.0 },
  { at: 0.74, x: 0.72, y: 0.56, d: 0.9 },
  { at: 0.86, x: 0.72, y: 0.56, d: 0.92 },
  { at: 1.0, x: 0.5, y: 1.42, d: 2.5 },
];

const PATH_TALL: EarthKeyframe[] = [
  { at: 0.0, x: 0.5, y: 0.97, d: 1.3 },
  { at: 0.13, x: 0.5, y: 0.94, d: 1.3 },
  { at: 0.25, x: 0.62, y: 0.8, d: 1.3 },
  { at: 0.38, x: 0.62, y: 0.8, d: 1.32 },
  { at: 0.5, x: 0.4, y: 0.82, d: 1.36 },
  { at: 0.62, x: 0.4, y: 0.82, d: 1.38 },
  { at: 0.74, x: 0.6, y: 0.82, d: 1.36 },
  { at: 0.86, x: 0.6, y: 0.82, d: 1.38 },
  { at: 1.0, x: 0.5, y: 1.2, d: 2.8 },
];

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

function Section({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} tabIndex={-1} className={`lp-section sol-section ${className}`} aria-labelledby={`${id}-title`}>
      <div className="sol-container">{children}</div>
    </section>
  );
}

function Heading({ id, eyebrow, title, lede }: { id: string; eyebrow?: string; title: ReactNode; lede?: ReactNode }) {
  return (
    <Reveal className="lp-heading">
      {eyebrow ? <p className="sol-eyebrow">{eyebrow}</p> : null}
      <h2 id={`${id}-title`} className="lp-heading__title">
        {title}
      </h2>
      {lede ? <p className="lp-heading__lede">{lede}</p> : null}
    </Reveal>
  );
}

export function Landing() {
  return (
    <div className="lp">
      <EarthScroll length={6} label="Solaris introduction" pathWide={PATH_WIDE} pathTall={PATH_TALL}>
        <EarthChapter range={[0, 0.14]} enter={false} placement="top">
          <h1 className="sol-hero__title">
            Model the future.
            <span>Test what changes it.</span>
          </h1>
          <p className="sol-hero__lede">
            Solaris turns weather-station records into local climate projections to 2100. The models run in your browser.
          </p>
          <div className="sol-hero__actions">
            <Button to="/app" size="lg">
              Launch Solaris
            </Button>
            <Button variant="secondary" size="lg" onClick={() => scrollToId("research")}>
              See the research
            </Button>
          </div>
        </EarthChapter>

        <EarthChapter range={[0.2, 0.4]} placement="left">
          <div className="lp-chapter">
            <h2 className="sol-chapter-title">How fast are local seasons warming?</h2>
            <p className="sol-chapter-text">
              We compared winter and summer trends at 40 urban and rural locations across the United States and Argentina,
              1940–1979 against 1980–2026.
            </p>
            <dl className="lp-chapter__stats">
              <div>
                <dt>Winter trend increase</dt>
                <dd>
                  +{POSTER.winter.change}
                  <span> °C/decade</span>
                </dd>
              </div>
              <div>
                <dt>Summer trend increase</dt>
                <dd>
                  +{POSTER.summer.change}
                  <span> °C/decade</span>
                </dd>
              </div>
            </dl>
            <p className="lp-chapter__src">{POSTER_SOURCE}</p>
          </div>
        </EarthChapter>

        <EarthChapter range={[0.44, 0.64]} placement="right">
          <div className="lp-chapter">
            <h2 className="sol-chapter-title">Four models, one workflow</h2>
            <ul className="lp-chapter__models">
              <li>
                <strong>Aeros</strong> forecasts a station’s seasons to 2100
              </li>
              <li>
                <strong>Nexus</strong> checks it against the past
              </li>
              <li>
                <strong>CORe</strong> follows global CO₂ and forcing
              </li>
              <li>
                <strong>Catalyst</strong> tests what-if emissions pathways
              </li>
            </ul>
          </div>
        </EarthChapter>

        <EarthChapter range={[0.68, 0.88]} placement="left">
          <div className="lp-chapter">
            <h2 className="sol-chapter-title">The research code, running on this device</h2>
            <p className="sol-chapter-text">
              The same Python as our research notebook runs in your browser, on open data. Every projection is tested against
              the past and shown with its range.
            </p>
          </div>
        </EarthChapter>
      </EarthScroll>

      {/* ---------------------------------------------------------------- what */}
      <Section id="platform">
        <div className="lp-split">
          <Heading
            id="platform"
            title="A research platform for local climate projections"
            lede="Solaris takes a weather station’s temperature record and projects its winters and summers to 2100. Inputs, assumptions and ranges are shown with every result, and every result can be exported."
          />
          <Reveal>
            <ol className="lp-steps">
              <li>
                <strong>Start from a real record</strong>
                <p>45 bundled stations from NOAA GHCN-M v4, or your own CSV.</p>
              </li>
              <li>
                <strong>Project it and check it</strong>
                <p>Aeros projects to 2100. Nexus scores the method on the recent past.</p>
              </li>
              <li>
                <strong>Test what changes it</strong>
                <p>CORe and Catalyst follow CO₂ under historical growth or a pathway you set.</p>
              </li>
            </ol>
          </Reveal>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- research */}
      <Section id="research">
        <Heading
          id="research"
          eyebrow="Research"
          title="Warming sped up at most of the 40 locations we studied"
          lede="We compared each station’s seasonal warming rate in 1940–1979 with 1980–2026, across urban and rural sites in the United States and Argentina."
        />

        <Reveal className="lp-stats">
          <Stat
            size="lg"
            value={`+${POSTER.winter.change}`}
            unit="°C/decade"
            label="Increase in winter warming rate"
            detail={`95% CI ${POSTER.winter.ciLow}–${POSTER.winter.ciHigh}, ${POSTER.winter.p}`}
          />
          <Stat
            size="lg"
            value={`+${POSTER.summer.change}`}
            unit="°C/decade"
            label="Increase in summer warming rate"
            detail={`95% CI ${POSTER.summer.ciLow.toFixed(3)}–${POSTER.summer.ciHigh.toFixed(3)}, ${POSTER.summer.p}`}
          />
          <Stat size="lg" value={`${POSTER.winter.increased} of 40`} label="Stations warming faster in winter" detail="than in 1940–1979" />
          <Stat size="lg" value={`${POSTER.summer.increased} of 40`} label="Stations warming faster in summer" detail="than in 1940–1979" />
        </Reveal>

        <div className="lp-research__grid">
          <Reveal>
            <GroupCompareChart
              title="Mean warming rate, 1980–2026"
              description="Poster values: United States 0.225 °C/decade in winter and 0.280 in summer; Argentina 0.156 in winter and 0.230 in summer."
              unit="°C/decade"
              reference={0}
              digits={3}
              domain={[0, 0.32]}
              groups={[
                { label: "United States · winter", value: POSTER.rates1980.us.winter, color: "var(--sol-data-2)" },
                { label: "United States · summer", value: POSTER.rates1980.us.summer, color: "var(--sol-data-1)" },
                { label: "Argentina · winter", value: POSTER.rates1980.argentina.winter, color: "var(--sol-data-2)" },
                { label: "Argentina · summer", value: POSTER.rates1980.argentina.summer, color: "var(--sol-data-1)" },
              ]}
              footer={<>Sampled-station means. The poster reports no intervals for these rates.</>}
            />
          </Reveal>
          <Reveal className="lp-results">
            <h3>Model results</h3>
            <dl>
              <div>
                <dt>Washington, D.C. winter mean, 2100 (Aeros 4.0)</dt>
                <dd>{POSTER.washington.winter2100.toFixed(2)} °C</dd>
              </div>
              <div>
                <dt>Washington, D.C. summer mean, 2100 (Aeros 4.0)</dt>
                <dd>{POSTER.washington.summer2100.toFixed(2)} °C</dd>
              </div>
              <div>
                <dt>
                  Global CO₂, 2100 (CORe 4.0), bounds {POSTER.co2.low}–{POSTER.co2.high}
                </dt>
                <dd>{POSTER.co2.mean2100.toFixed(2)} ppm</dd>
              </div>
            </dl>
            <p>
              CORe continues historical CO₂ growth. It is not an IPCC emissions scenario. Long-range results are conditional
              model outputs and have not been independently validated.
            </p>
          </Reveal>
        </div>
        <p className="lp-note">All figures in this section are quoted from the team’s poster, “Surface Air Temperature &amp; Carbon Forecasting”.</p>
      </Section>

      {/* ---------------------------------------------------------------- models */}
      <Section id="models">
        <Heading
          id="models"
          eyebrow="Models"
          title="Four models"
          lede="Aeros and CORe are ports of the team’s research notebook and reproduce its results. Catalyst and Nexus are new and deliberately simple."
        />
        <Reveal>
          <ul className="lp-models">
            {MODELS.map((m) => (
              <li key={m.id} className="lp-model">
                <p className="lp-model__name">
                  {m.name} <span>{m.version}</span>
                </p>
                <div>
                  <h3 className="lp-model__q">{m.question}</h3>
                  <p className="lp-model__does">{m.does}</p>
                </div>
                <Button to={m.route} variant="link" iconRight={<IconArrowRight size={14} />}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </Reveal>
        <div className="lp-preview">
          <h3>Output from a saved run</h3>
          <p>Washington, D.C., computed with the same code that runs in the workspace. Hover the chart to read values.</p>
          <LazyMount minHeight={420} rootMargin="400px 0px">
            <PreviewCharts />
          </LazyMount>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- method */}
      <Section id="trust">
        <Heading id="trust" eyebrow="Method" title="How it works, and where it falls short" />
        <div className="lp-method">
          <Reveal>
            <h3 className="lp-colhead">How it works</h3>
            <dl className="lp-deflist">
              {TRUST.map((t) => (
                <div key={t.title}>
                  <dt>{t.title}</dt>
                  <dd>{t.text}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal>
            <h3 className="lp-colhead">Limits</h3>
            <dl className="lp-deflist">
              {NOT_LIST.map((n) => (
                <div key={n.title}>
                  <dt>{n.title}</dt>
                  <dd>{n.text}</dd>
                </div>
              ))}
              <div>
                <dt>{OWN_LIMITATION.title}</dt>
                <dd>{OWN_LIMITATION.text}</dd>
              </div>
            </dl>
          </Reveal>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- roadmap */}
      <Section id="roadmap">
        <div className="lp-split">
          <Heading
            id="roadmap"
            eyebrow="Roadmap"
            title="What funding would pay for"
            lede="These are plans, not shipped features. Each one addresses a limit listed above."
          />
          <Reveal>
            <ol className="lp-steps">
              {ROADMAP.map((r) => (
                <li key={r.title}>
                  <strong>{r.title}</strong>
                  <p>{r.text}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- team */}
      <Section id="team">
        <Heading id="team" eyebrow="Team" title="Two students and a mentor" lede="Solaris is a student-led research project from Prince George’s County, Maryland." />
        <Reveal>
          <TeamGrid />
          <p className="lp-note">{PRESENTED_AT}.</p>
        </Reveal>
      </Section>

      {/* ---------------------------------------------------------------- CTA */}
      <section className="lp-cta" aria-labelledby="cta-title">
        <div className="sol-container">
          <h2 id="cta-title" className="lp-cta__title">
            Run the models yourself
          </h2>
          <p className="lp-cta__text">No account and nothing to install. Pick a station and see its projection in seconds.</p>
          <div className="lp-cta__actions">
            <Button to="/app" size="lg">
              Launch Solaris
            </Button>
            <Button to="/guide" size="lg" variant="secondary">
              How to use it
            </Button>
            <Button href={demoUrl()} size="lg" variant="ghost" iconRight={<IconArrowUpRight size={14} />}>
              One-page demo
            </Button>
          </div>
          <p className="lp-cta__fine">{CONDITIONAL_NOTE}</p>
        </div>
      </section>
    </div>
  );
}

export default Landing;
