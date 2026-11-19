import type { ReactNode } from "react";
import { Badge, Button, Callout, IconArrowRight, IconDownload, ModelBadge } from "../../components/ui";
import type { ModelId } from "../../components/ui";
import { publicUrl } from "../../lib/paths";
import { CONDITIONAL_NOTE } from "./content";
import { GuideIllustration } from "./GuideIllustration";
import type { GuideArt } from "./GuideIllustration";
import { Reveal } from "./Reveal";
import "./site.css";
import "./guide.css";

type Step = { art: GuideArt; model?: ModelId; title: string; body: ReactNode; to: string; cta: string };

const STEPS: Step[] = [
  {
    art: "station",
    title: "Pick a station — or upload your own",
    body: (
      <>
        Open <strong>Datasets</strong> or the station picker in Aeros. The Solaris sample station set has 45 stations from
        NOAA GHCN-M v4 (adjusted), including paired urban and rural sites in the United States and Argentina. You can also
        upload a CSV of your own station (format below).
      </>
    ),
    to: "/app/datasets",
    cta: "Browse datasets",
  },
  {
    art: "aeros",
    model: "aeros",
    title: "Read an Aeros projection",
    body: (
      <>
        Aeros projects the station’s winter and summer means to 2100. Grey dots are observations, the dashed line is the
        fitted trend, and the gold line with its shaded band is the projection with its 95% range. Below the chart you’ll
        find the trend slopes for 1940–1979, 1980–today and the future, plus the ensemble weights.
      </>
    ),
    to: "/app/aeros",
    cta: "Open Aeros",
  },
  {
    art: "nexus",
    model: "nexus",
    title: "Check it with Nexus",
    body: (
      <>
        Nexus asks whether the method would have worked before. It retrains Aeros on data up to a cut-off year (2000 by
        default), projects the years after, and compares that with what was actually observed — and with two naive
        baselines. If Aeros doesn’t beat the baselines, Nexus says so.
      </>
    ),
    to: "/app/nexus",
    cta: "Open Nexus",
  },
  {
    art: "core",
    model: "core",
    title: "Explore CO₂ with CORe",
    body: (
      <>
        CORe continues the observed global CO₂ record to 2100 with a validation-weighted ensemble, then turns concentration
        into radiative forcing. Its pathway is a continuation of history — not an emissions scenario — which is exactly
        what Catalyst lets you change.
      </>
    ),
    to: "/app/core",
    cta: "Open CORe",
  },
  {
    art: "catalyst",
    model: "catalyst",
    title: "Test a scenario in Catalyst",
    body: (
      <>
        Start from an SSP pathway or CORe’s pathway, then move the levers: when emissions peak, how fast they fall, when
        they reach net zero, how much carbon is removed. Catalyst follows your pathway through a simplified carbon cycle,
        forcing and temperature, and shows the difference from the baseline.
      </>
    ),
    to: "/app/catalyst",
    cta: "Open Catalyst",
  },
  {
    art: "save",
    title: "Save and export",
    body: (
      <>
        Every result can be exported as CSV or JSON without an account. With a free account, <strong>Save to project</strong>{" "}
        keeps the run — its inputs and results — so you can reopen it later on any device. Manage everything under{" "}
        <strong>Projects</strong>.
      </>
    ),
    to: "/app/projects",
    cta: "Go to projects",
  },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Is this a prediction?",
    a: (
      <>
        No. Every number is a <strong>conditional model output</strong>: what a stated method produces from stated data and
        assumptions. Aeros extrapolates one station’s own record and contains no emissions scenario; CORe continues past CO₂
        growth; Catalyst shows what-if pathways. None of them knows about future policy, volcanoes or surprises.
      </>
    ),
  },
  {
    q: "How accurate is it?",
    a: (
      <>
        Use Nexus to see for yourself on any station. On the Washington, D.C. sample station, the strict hindcast finds
        Aeros about as accurate as naive baselines in winter and somewhat better in summer, with summer ranges too narrow at
        decade horizons. The long-range ranges have not been independently validated for nominal coverage, and the work has
        not been peer reviewed.
      </>
    ),
  },
  {
    q: "Where does my uploaded data go?",
    a: (
      <>
        Nowhere. Files you upload are read and modelled inside your browser — Python runs on your device through
        WebAssembly. Data only leaves the browser if you sign in and choose <strong>Save to project</strong>; then that run’s
        inputs and results are stored in your private account.
      </>
    ),
  },
  {
    q: "Why does the first run take a few seconds?",
    a: (
      <>
        The first time, your browser downloads a Python runtime with numpy and scipy (Pyodide) and installs the Solaris
        models. After that, runs take about a second. Bundled stations also have saved results that appear instantly, clearly
        labelled as precomputed.
      </>
    ),
  },
  {
    q: "Why does the Washington, D.C. projection differ from the poster?",
    a: (
      <>
        The poster used the team’s own 1938–2026 file for Washington; the site’s sample station set uses NOAA GHCN-M v4
        adjusted data from 1940, with a stricter seasonal rule. Same method, different input — so the site shows its own
        numbers as its own numbers.
      </>
    ),
  },
  {
    q: "Do I need an account?",
    a: <>No. Every model, dataset and export works without one. An account only adds saving runs to projects.</>,
  },
];

export function GuidePage() {
  return (
    <div className="guide">
      <header className="guide-hero sol-container">
        <p className="sol-eyebrow">How to use Solaris</p>
        <h1 className="guide-hero__title">
          From a station record to a tested scenario, <span>in six steps.</span>
        </h1>
        <p className="guide-hero__lede">
          Everything below works without an account and runs on your device. It takes about five minutes to go through once.
        </p>
        <nav className="guide-toc" aria-label="On this page">
          {STEPS.map((s, i) => (
            <a
              key={s.title}
              href={`#step-${i + 1}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(`step-${i + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <span>{i + 1}</span>
              {s.title.split(" — ")[0]}
            </a>
          ))}
        </nav>
      </header>

      <ol className="guide-steps sol-container">
        {STEPS.map((s, i) => (
          <Reveal key={s.title} as="li" className="guide-step">
            <div id={`step-${i + 1}`} className="guide-step__anchor" />
            <div className="guide-step__art">
              <GuideIllustration art={s.art} />
            </div>
            <div className="guide-step__text">
              <p className="guide-step__n">
                Step {i + 1}
                {s.model ? <ModelBadge model={s.model} /> : null}
                {s.model === "catalyst" || s.model === "nexus" ? <Badge tone="new">New · simplified</Badge> : null}
              </p>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
              <Button to={s.to} variant="secondary" iconRight={<IconArrowRight size={14} />}>
                {s.cta}
              </Button>
            </div>
          </Reveal>
        ))}
      </ol>

      <section className="guide-section sol-container" aria-labelledby="csv-title">
        <div className="guide-two">
          <div>
            <p className="sol-eyebrow">Your own data</p>
            <h2 id="csv-title">The CSV format</h2>
            <p>
              One row per year, seasonal mean temperatures in °C. <code>D-J-F</code> is December–February (the December belongs
              to the previous calendar year) and <code>J-J-A</code> is June–August. For bundled southern-hemisphere stations,
              Solaris labels J-J-A as winter.
            </p>
            <ul className="guide-list">
              <li>Header aliases are accepted: <code>Year</code>, <code>DJF</code>, <code>JJA</code>.</li>
              <li>Comma, semicolon or tab separators; quotes and a UTF-8 BOM are fine.</li>
              <li>Leave missing values blank, or use NASA’s <code>999.9</code>. A NASA GISS <code>station.csv</code> works as-is.</li>
              <li>At least 10 years per season; 1940 onward lets Nexus compute the 1940–1979 trend.</li>
            </ul>
            <Button href={publicUrl("data/downloads/aeros_input_template.csv")} variant="secondary" iconLeft={<IconDownload size={16} />} download>
              Download the template
            </Button>
          </div>
          <figure className="guide-code">
            <figcaption>washington_dc.csv — first rows of a bundled station</figcaption>
            <pre>
              <code>{`YEAR,D-J-F,J-J-A
1940,0.70,23.75
1941,2.70,23.94
1942,2.57,24.34
1943,2.30,25.84
…
2026,1.99,26.58`}</code>
            </pre>
          </figure>
        </div>
      </section>

      <section className="guide-section sol-container" aria-labelledby="data-title">
        <p className="sol-eyebrow">Provenance</p>
        <h2 id="data-title">Where the data comes from</h2>
        <div className="guide-table-wrap">
          <table className="guide-table">
            <thead>
              <tr>
                <th scope="col">Dataset</th>
                <th scope="col">Source</th>
                <th scope="col">Used by</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Solaris sample station set (45 stations, seasonal means)</td>
                <td>NOAA GHCN-M v4 (adjusted) — the station record NASA GISTEMP is built on</td>
                <td>Aeros, Nexus</td>
              </tr>
              <tr>
                <td>Global CO₂, 1979–2025</td>
                <td>NOAA Global Monitoring Laboratory, global annual means</td>
                <td>CORe, Catalyst</td>
              </tr>
              <tr>
                <td>Global CO₂, 1940–1978</td>
                <td>RCMIP historical concentrations</td>
                <td>CORe, Catalyst</td>
              </tr>
              <tr>
                <td>SSP emissions, concentrations and non-CO₂ forcing</td>
                <td>RCMIP (Reduced Complexity Model Intercomparison Project)</td>
                <td>Catalyst</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="guide-note">All bundled files can be downloaded from Datasets in the workspace.</p>
      </section>

      <section className="guide-section sol-container" aria-labelledby="ranges-title">
        <p className="sol-eyebrow">Reading results</p>
        <h2 id="ranges-title">How to interpret the ranges</h2>
        <div className="guide-ranges">
          <article>
            <ModelBadge model="aeros" />
            <h3>A range for one season’s value</h3>
            <p>
              The band holds the middle 95% of 200 bootstrap paths. It describes how much a <em>single</em> winter or summer could
              vary around the trend — not the uncertainty of the long-term climate, and not emissions uncertainty.
            </p>
          </article>
          <article>
            <ModelBadge model="core" />
            <h3>A backtest-based envelope</h3>
            <p>
              CORe’s range widens with distance from today, scaled from how far its candidate models missed in backtests. It is
              not a calibrated probability interval.
            </p>
          </article>
          <article>
            <ModelBadge model="catalyst" />
            <h3>A climate-sensitivity band</h3>
            <p>
              Catalyst re-runs your scenario at the IPCC AR6 likely and very likely bounds of climate sensitivity. It does not
              include carbon-cycle or forcing uncertainty.
            </p>
          </article>
        </div>
        <Callout tone="honesty" title="Conditional model outputs">
          {CONDITIONAL_NOTE}
        </Callout>
      </section>

      <section className="guide-section sol-container sol-container--narrow" aria-labelledby="faq-title">
        <p className="sol-eyebrow">FAQ</p>
        <h2 id="faq-title">Questions people ask</h2>
        <div className="guide-faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <div>{f.a}</div>
            </details>
          ))}
        </div>
        <div className="guide-end">
          <Button to="/app" size="lg" iconRight={<IconArrowRight size={16} />}>
            Open the workspace
          </Button>
        </div>
      </section>
    </div>
  );
}

export default GuidePage;
