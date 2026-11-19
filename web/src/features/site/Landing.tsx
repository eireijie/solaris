/**
 * Platform landing page: scroll-driven Earth story, then research, models, trust, roadmap, team.
 * Must stay light: no Supabase, no Pyodide, no workbench code (only precomputed JSON for previews).
 */
import type { ReactNode } from "react";
import { EarthChapter, EarthScroll } from "../../components/EarthScroll";
import type { EarthKeyframe } from "../../components/EarthScroll";
import { Badge, Button, Callout, IconArrowRight, IconArrowUpRight, ModelBadge, Stat } from "../../components/ui";
import { GroupCompareChart } from "../../components/charts";
import { demoUrl } from "../../lib/paths";
import { AUDIENCES, CONDITIONAL_NOTE, MODELS, NOT_LIST, OWN_LIMITATION, POSTER, POSTER_SOURCE, ROADMAP, TRUST } from "./content";
import { IconBook, IconCode, IconDatabase, IconShield, IconTarget, IconWave } from "./icons";
import { ModelDiagram } from "./ModelDiagram";
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

const POSTER_TAG = <span className="lp-source">{POSTER_SOURCE}</span>;

function Section({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} tabIndex={-1} className={`lp-section sol-section ${className}`} aria-labelledby={`${id}-title`}>
      <div className="sol-container">{children}</div>
    </section>
  );
}

function Heading({ id, eyebrow, title, accent, lede }: { id: string; eyebrow: string; title: ReactNode; accent?: ReactNode; lede?: ReactNode }) {
  return (
    <Reveal className="lp-heading">
      <p className="sol-eyebrow">{eyebrow}</p>
      <h2 id={`${id}-title`} className="lp-heading__title">
        {title}
        {accent ? <span className="lp-heading__accent">{accent}</span> : null}
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
          <p className="sol-eyebrow lp-hero__eyebrow">Solaris · climate research platform</p>
          <h1 className="sol-hero__title">
            Model the future.
            <span>Test what changes it.</span>
          </h1>
          <p className="sol-hero__lede">
            Solaris turns real weather-station records into transparent projections to 2100 — and lets you test what changes
            them, with the models running right in your browser.
          </p>
          <div className="sol-hero__actions">
            <Button to="/app" size="lg" iconRight={<IconArrowRight size={16} />}>
              Launch Solaris
            </Button>
            <Button variant="secondary" size="lg" onClick={() => scrollToId("research")}>
              See the research
            </Button>
          </div>
        </EarthChapter>

        <EarthChapter range={[0.2, 0.4]} placement="left">
          <div className="lp-chapter">
            <p className="sol-eyebrow">01 · The question</p>
            <h2 className="sol-chapter-title">How fast are local seasons warming?</h2>
            <p className="sol-chapter-text">
              We compared winter and summer trends at 40 urban and rural locations across the United States and Argentina —
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
            <p className="sol-eyebrow">02 · Four models</p>
            <h2 className="sol-chapter-title">One honest workflow.</h2>
            <ul className="lp-chapter__models">
              <li>
                <ModelBadge model="aeros" /> forecasts a station’s seasons to 2100
              </li>
              <li>
                <ModelBadge model="nexus" /> checks it against the past
              </li>
              <li>
                <ModelBadge model="core" /> follows global CO₂ and forcing
              </li>
              <li>
                <ModelBadge model="catalyst" /> tests what-if emissions pathways
              </li>
            </ul>
          </div>
        </EarthChapter>

        <EarthChapter range={[0.68, 0.88]} placement="left">
          <div className="lp-chapter">
            <p className="sol-eyebrow">03 · Nothing hidden</p>
            <h2 className="sol-chapter-title">Real Python, running on this device.</h2>
            <p className="sol-chapter-text">
              The same code as our research notebook runs in your browser. Open data, strict hindcasts, and a range on every
              projection — because a projection is a conditional model output, not a promise.
            </p>
          </div>
        </EarthChapter>
      </EarthScroll>

      {/* ---------------------------------------------------------------- what */}
      <Section id="platform">
        <div className="lp-split">
          <Heading
            id="platform"
            eyebrow="What Solaris is"
            title="A research platform for local climate,"
            accent="built in the open."
            lede="Solaris turns real station records into transparent, testable projections through 2100 — and lets you test what changes them. Every input, assumption and range stays visible, and every result can be exported."
          />
          <Reveal delay={120} className="lp-steps">
            <ol>
              <li>
                <span className="lp-steps__n">1</span>
                <div>
                  <strong>Start from a real record</strong>
                  <p>45 bundled stations from NOAA GHCN-M v4, or your own CSV.</p>
                </div>
              </li>
              <li>
                <span className="lp-steps__n">2</span>
                <div>
                  <strong>Project and check</strong>
                  <p>Aeros projects to 2100; Nexus scores the method on the recent past.</p>
                </div>
              </li>
              <li>
                <span className="lp-steps__n">3</span>
                <div>
                  <strong>Test what changes it</strong>
                  <p>CORe and Catalyst follow CO₂ under historical growth or your own pathway.</p>
                </div>
              </li>
            </ol>
          </Reveal>
        </div>
        <p className="sol-eyebrow lp-audiences-label">Who it’s for</p>
        <div className="lp-audiences">
          {AUDIENCES.map((a, i) => (
            <Reveal key={a.title} delay={i * 70} className="lp-audience">
              <h3>{a.title}</h3>
              <p>{a.text}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ---------------------------------------------------------------- research */}
      <Section id="research" className="lp-research">
        <Heading
          id="research"
          eyebrow="The research so far"
          title="Warming sped up at most of the 40 locations we studied."
          lede={
            <>
              Our poster compared each station’s seasonal warming rate in 1940–1979 with 1980–2026, across urban and rural
              sites in the United States and Argentina (winter and summer, adjusted for hemisphere). Numbers below are quoted
              from it. {POSTER_TAG}
            </>
          }
        />

        <div className="lp-stats">
          <Reveal>
            <Stat
              size="lg"
              tone="solar"
              value={`+${POSTER.winter.change}`}
              unit="°C/decade"
              label="Mean increase in winter warming rate"
              detail={`95% CI ${POSTER.winter.ciLow}–${POSTER.winter.ciHigh} · ${POSTER.winter.p}`}
              source={POSTER_SOURCE}
            />
          </Reveal>
          <Reveal delay={80}>
            <Stat
              size="lg"
              tone="solar"
              value={`+${POSTER.summer.change}`}
              unit="°C/decade"
              label="Mean increase in summer warming rate"
              detail={`95% CI ${POSTER.summer.ciLow.toFixed(3)}–${POSTER.summer.ciHigh.toFixed(3)} · ${POSTER.summer.p}`}
              source={POSTER_SOURCE}
            />
          </Reveal>
          <Reveal delay={160}>
            <Stat
              size="lg"
              value={`${POSTER.winter.increased}/40`}
              label="Stations warming faster in winter"
              detail="since 1980 than in 1940–1979"
              source={POSTER_SOURCE}
            />
          </Reveal>
          <Reveal delay={240}>
            <Stat
              size="lg"
              value={`${POSTER.summer.increased}/40`}
              label="Stations warming faster in summer"
              detail="since 1980 than in 1940–1979"
              source={POSTER_SOURCE}
            />
          </Reveal>
        </div>

        <div className="lp-research__grid">
          <Reveal className="lp-panel">
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
              footer={<>Sampled-station means; the poster reports no intervals for these rates. {POSTER_SOURCE}.</>}
            />
          </Reveal>
          <Reveal delay={100} className="lp-panel lp-panel--text">
            <p className="lp-kicker">Geography matters</p>
            <p className="lp-big">
              Winter warming rates rose by <strong>+{POSTER.winterChangeByCountry.us} °C/decade</strong> in the U.S. sample,
              against <strong>+{POSTER.winterChangeByCountry.argentina.toFixed(3)}</strong> in the Argentine sample.
            </p>
            <p className="sol-muted">Summer trend changes were similar across both samples. {POSTER_SOURCE}.</p>
          </Reveal>
        </div>

        <div className="lp-cases">
          <Reveal className="lp-case">
            <div className="lp-case__head">
              <ModelBadge model="aeros" />
              <span className="lp-case__where">Washington, D.C. case study</span>
            </div>
            <div className="lp-case__stats">
              <Stat value={POSTER.washington.winter2100.toFixed(2)} unit="°C" label="Projected winter mean, 2100" source={POSTER_SOURCE} />
              <Stat value={POSTER.washington.summer2100.toFixed(2)} unit="°C" label="Projected summer mean, 2100" source={POSTER_SOURCE} />
            </div>
            <p className="lp-case__note">Seasonal machine-learning ensemble with 2.5th–97.5th percentile bootstrap bounds.</p>
          </Reveal>
          <Reveal delay={100} className="lp-case">
            <div className="lp-case__head">
              <ModelBadge model="core" />
              <span className="lp-case__where">Global atmospheric CO₂</span>
            </div>
            <div className="lp-case__stats">
              <Stat
                value={POSTER.co2.mean2100.toFixed(2)}
                unit="ppm"
                label="Projected CO₂ in 2100"
                detail={`Bounds ${POSTER.co2.low}–${POSTER.co2.high} ppm`}
                source={POSTER_SOURCE}
              />
            </div>
            <p className="lp-case__note">Historical-continuation pathway — a continuation of past growth, not an IPCC emissions scenario.</p>
          </Reveal>
        </div>

        <Reveal>
          <Callout tone="honesty" title="In the poster’s own words">
            <ul className="lp-caveats">
              {POSTER.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Callout>
        </Reveal>
      </Section>

      {/* ---------------------------------------------------------------- models */}
      <Section id="models">
        <Heading
          id="models"
          eyebrow="The models"
          title="Four models."
          accent="One honest workflow."
          lede="Two models are ports of the team’s research notebook, checked to reproduce it. Two are new, deliberately simple, and labelled that way."
        />
        <Reveal className="lp-diagram">
          <ModelDiagram />
        </Reveal>
        <div className="lp-models">
          {MODELS.map((m, i) => (
            <Reveal key={m.id} delay={i * 70} as="article" className={`lp-model lp-model--${m.id}`}>
              <div className="lp-model__top">
                <ModelBadge model={m.id} />
                <Badge tone={m.status === "new" ? "new" : "neutral"}>{m.statusLabel}</Badge>
              </div>
              <h3 className="lp-model__q">{m.question}</h3>
              <p className="lp-model__does">{m.does}</p>
              <dl className="lp-model__io">
                <div>
                  <dt>In</dt>
                  <dd>{m.inputs}</dd>
                </div>
                <div>
                  <dt>Out</dt>
                  <dd>{m.outputs}</dd>
                </div>
              </dl>
              <Button to={m.route} variant="link" iconRight={<IconArrowRight size={14} />}>
                Open {m.name}
              </Button>
            </Reveal>
          ))}
        </div>
        <Reveal className="lp-preview">
          <div className="lp-preview__intro">
            <p className="sol-eyebrow">Live preview</p>
            <h3>Real model output, not an illustration.</h3>
            <p>
              These charts are drawn from saved runs of the same code you can run in the workspace. Hover or drag across them
              to read values.
            </p>
            <Button to="/app/aeros" variant="secondary" iconRight={<IconArrowRight size={14} />}>
              Run it yourself
            </Button>
          </div>
          <LazyMount minHeight={420} rootMargin="400px 0px">
            <PreviewCharts />
          </LazyMount>
        </Reveal>
      </Section>

      {/* ---------------------------------------------------------------- trust */}
      <Section id="trust" className="lp-trust">
        <Heading
          id="trust"
          eyebrow="How it works · why trust it"
          title="Every assumption visible."
          lede="Credibility comes from showing the work. Here is what runs, where the data comes from, and how we test it."
        />
        <div className="lp-pillars">
          {TRUST.map((t, i) => (
            <Reveal key={t.title} delay={i * 70} className="lp-pillar">
              <span className="lp-pillar__icon" aria-hidden="true">
                {[<IconCode key="a" size={20} />, <IconDatabase key="b" size={20} />, <IconTarget key="c" size={20} />, <IconWave key="d" size={20} />][i]}
              </span>
              <h3>{t.title}</h3>
              <p>{t.text}</p>
              <p className="lp-source">{t.source}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className="lp-own">
          <IconShield size={22} />
          <p>
            {OWN_LIMITATION.text} <span className="lp-source">{OWN_LIMITATION.source}</span>
          </p>
        </Reveal>
        <div className="lp-not">
          <Reveal className="lp-not__head">
            <h3>What Solaris is not</h3>
            <p>Stated plainly, so nobody has to guess.</p>
          </Reveal>
          <ul className="lp-not__list">
            {NOT_LIST.map((n, i) => (
              <Reveal key={n.title} as="li" delay={i * 60}>
                <strong>{n.title}.</strong> {n.text}
              </Reveal>
            ))}
          </ul>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- roadmap */}
      <Section id="roadmap">
        <Heading
          id="roadmap"
          eyebrow="Roadmap"
          title="What funding would unlock."
          lede="These are plans, not shipped features. Each one closes a limitation we already state on this page."
        />
        <ol className="lp-roadmap">
          {ROADMAP.map((r, i) => (
            <Reveal key={r.title} as="li" delay={i * 60} className="lp-roadmap__item">
              <span className="lp-roadmap__n">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{r.title}</h3>
                <p>{r.text}</p>
              </div>
              <Badge tone="neutral">Planned</Badge>
            </Reveal>
          ))}
        </ol>
      </Section>

      {/* ---------------------------------------------------------------- team */}
      <Section id="team">
        <Heading
          id="team"
          eyebrow="Team"
          title="Two students and a mentor."
          lede="Solaris is a student-led research project from Prince George’s County, Maryland."
        />
        <Reveal>
          <TeamGrid />
        </Reveal>
        <Reveal>
          <p className="lp-presented">
            <IconBook size={16} /> {PRESENTED_AT}.
          </p>
        </Reveal>
      </Section>

      {/* ---------------------------------------------------------------- CTA */}
      <section className="lp-cta" aria-labelledby="cta-title">
        <div className="sol-container lp-cta__inner">
          <Reveal>
            <h2 id="cta-title" className="lp-cta__title">
              Run the models <span>yourself.</span>
            </h2>
            <p className="lp-cta__text">No account and nothing to install. Pick a station and see its projection in seconds.</p>
            <div className="lp-cta__actions">
              <Button to="/app" size="lg" iconRight={<IconArrowRight size={16} />}>
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
          </Reveal>
        </div>
      </section>
    </div>
  );
}

export default Landing;
