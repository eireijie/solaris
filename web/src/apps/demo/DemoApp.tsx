/**
 * Summit demo (entry: demo/index.html). One scrolling page, no sign-in:
 * Earth hero → poster findings → Aeros, Nexus, CORe, Catalyst (compact, mounted lazily)
 * → datasets → QR code to the full platform → team → footer.
 * Presenter mode: press P or open with ?kiosk=1 (hides the nav, enlarges type).
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { EarthChapter, EarthScroll } from "../../components/EarthScroll";
import type { EarthKeyframe } from "../../components/EarthScroll";
import { Badge, Button, IconArrowRight, IconArrowUpRight, ModelBadge, SolarisMark, Skeleton, Stat } from "../../components/ui";
import type { ModelId } from "../../components/ui";
import { getRuntime } from "../../runtime";
import { platformUrl } from "../../lib/paths";
import { displayUrl, publicSiteUrl } from "../../lib/env";
import { AerosWorkbench, CatalystWorkbench, CoreWorkbench, DatasetLibrary, NexusWorkbench, RuntimeStatusPill } from "../../features/models";
import { POSTER, POSTER_SOURCE, CONDITIONAL_NOTE } from "../../features/site/content";
import { IconMonitor } from "../../features/site/icons";
import { QrCode } from "../../features/site/QrCode";
import { LazyMount, Reveal } from "../../features/site/Reveal";
import { SiteFooter } from "../../features/site/SiteFooter";
import { TeamGrid } from "../../features/site/TeamCards";
import { PRESENTED_AT } from "../../features/site/team";
import "../../features/site/site.css";
import "./demo.css";

const PATH_WIDE: EarthKeyframe[] = [
  { at: 0, x: 0.5, y: 1.08, d: 1.12 },
  { at: 0.55, x: 0.5, y: 0.98, d: 1.16 },
  { at: 1, x: 0.5, y: 1.42, d: 2.5 },
];
const PATH_TALL: EarthKeyframe[] = [
  { at: 0, x: 0.5, y: 0.97, d: 1.3 },
  { at: 0.55, x: 0.5, y: 0.93, d: 1.34 },
  { at: 1, x: 0.5, y: 1.2, d: 2.8 },
];

const SECTIONS = [
  { id: "findings", label: "Findings" },
  { id: "aeros", label: "Aeros" },
  { id: "nexus", label: "Nexus" },
  { id: "core", label: "CORe" },
  { id: "catalyst", label: "Catalyst" },
  { id: "data", label: "Data" },
  { id: "open", label: "Open platform" },
  { id: "team", label: "Team" },
];

function go(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

function useKiosk(): [boolean, () => void] {
  const [kiosk, setKiosk] = useState(() => new URLSearchParams(window.location.search).get("kiosk") === "1");
  const toggle = useCallback(() => setKiosk((k) => !k), []);
  useEffect(() => {
    document.documentElement.classList.toggle("demo-kiosk", kiosk);
  }, [kiosk]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "p" && e.key !== "P") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  return [kiosk, toggle];
}

function useActiveSection(): string {
  const [active, setActive] = useState("");
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return active;
}

function DemoNav({ kiosk, onToggleKiosk }: { kiosk: boolean; onToggleKiosk: () => void }) {
  const active = useActiveSection();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (kiosk) return null;
  return (
    <header className={`demo-nav ${scrolled ? "is-solid" : ""}`}>
      <div className="demo-nav__inner">
        <div className="demo-nav__brand">
          <SolarisMark compact href={platformUrl("/")} size={28} />
          <Badge tone="solar">Summit demo</Badge>
        </div>
        <nav className="demo-nav__links" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={`demo-nav__link ${active === s.id ? "is-active" : ""}`} aria-current={active === s.id ? "true" : undefined} onClick={() => go(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="demo-nav__actions">
          <button type="button" className="demo-nav__icon" onClick={onToggleKiosk} aria-pressed={kiosk} aria-label="Presenter mode (P)" title="Presenter mode (P)">
            <IconMonitor size={18} />
          </button>
          <Button size="sm" variant="secondary" href={platformUrl("/")} iconRight={<IconArrowUpRight size={14} />}>
            Full platform
          </Button>
        </div>
      </div>
    </header>
  );
}

function BenchSection({
  id,
  n,
  model,
  isNew,
  title,
  lines,
  children,
}: {
  id: string;
  n: number;
  model: ModelId;
  isNew?: boolean;
  title: string;
  lines: [string, string];
  children: ReactNode;
}) {
  return (
    <section id={id} className={`demo-section demo-bench demo-bench--${model}`} aria-labelledby={`${id}-title`}>
      <div className="sol-container">
        <Reveal className="demo-bench__head">
          <p className="demo-bench__n">
            <span>{String(n).padStart(2, "0")}</span>
            <ModelBadge model={model} />
            {isNew ? (
              <>
                <Badge tone="new">New</Badge>
                <Badge tone="info">Simplified model</Badge>
              </>
            ) : (
              <Badge tone="neutral">From the research notebook</Badge>
            )}
          </p>
          <h2 id={`${id}-title`} className="demo-h2">
            {title}
          </h2>
          <p className="demo-bench__intro">
            {lines[0]}
            <br className="demo-br" /> {lines[1]}
          </p>
        </Reveal>
        <LazyMount
          minHeight={620}
          rootMargin="700px 0px"
          placeholder={
            <div className="demo-bench__placeholder" aria-hidden="true">
              <Skeleton height={44} width="40%" />
              <Skeleton height={380} />
            </div>
          }
        >
          <div className="demo-bench__body">{children}</div>
        </LazyMount>
      </div>
    </section>
  );
}

export function DemoApp() {
  const [kiosk, toggleKiosk] = useKiosk();
  const site = publicSiteUrl();

  useEffect(() => {
    // Start loading Pyodide after first paint so the hero gets the bandwidth first.
    const id = window.setTimeout(() => void getRuntime().warmup(), 1500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className={`sol-page demo ${kiosk ? "is-kiosk" : ""}`}>
      <a
        className="sol-skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("findings")?.focus();
        }}
      >
        Skip to content
      </a>
      <DemoNav kiosk={kiosk} onToggleKiosk={toggleKiosk} />
      {kiosk ? (
        <button type="button" className="demo-kiosk-exit" onClick={toggleKiosk}>
          Presenter mode · press P to exit
        </button>
      ) : null}

      <main id="main">
        <EarthScroll length={2.4} label="Solaris summit demo" pathWide={PATH_WIDE} pathTall={PATH_TALL}>
          <EarthChapter range={[0, 0.6]} enter={false} placement="top">
            <p className="sol-eyebrow demo-hero__eyebrow">Solaris · live summit demo</p>
            <h1 className="sol-hero__title">
              Model the future.
              <span>Test what changes it.</span>
            </h1>
            <p className="sol-hero__lede">
              Four climate models running live in this browser — real station records, the team’s real research code, no
              sign-in.
            </p>
            <div className="sol-hero__actions">
              <Button size="lg" onClick={() => go("aeros")} iconRight={<IconArrowRight size={16} />}>
                Run a model
              </Button>
              <Button size="lg" variant="secondary" onClick={() => go("open")}>
                Open it on your phone
              </Button>
            </div>
          </EarthChapter>
        </EarthScroll>

        <section id="findings" tabIndex={-1} className="demo-section demo-findings" aria-labelledby="findings-title">
          <div className="sol-container">
            <Reveal className="demo-head">
              <p className="sol-eyebrow">The research so far</p>
              <h2 id="findings-title" className="demo-h2">
                Warming sped up at most of the 40 locations we studied.
              </h2>
              <p className="demo-lede">
                Urban and rural stations in the United States and Argentina, 1940–1979 compared with 1980–2026.
              </p>
            </Reveal>
            <div className="demo-stats">
              <Reveal>
                <Stat size="lg" tone="solar" value={`+${POSTER.winter.change}`} unit="°C/decade" label="Winter warming-rate increase" detail={`95% CI ${POSTER.winter.ciLow}–${POSTER.winter.ciHigh}`} source={POSTER_SOURCE} />
              </Reveal>
              <Reveal delay={80}>
                <Stat size="lg" tone="solar" value={`+${POSTER.summer.change}`} unit="°C/decade" label="Summer warming-rate increase" detail={`95% CI ${POSTER.summer.ciLow.toFixed(3)}–${POSTER.summer.ciHigh.toFixed(3)}`} source={POSTER_SOURCE} />
              </Reveal>
              <Reveal delay={160}>
                <Stat size="lg" value={`${POSTER.summer.increased}/40`} label="Stations warming faster in summer" detail={`${POSTER.winter.increased}/40 in winter`} source={POSTER_SOURCE} />
              </Reveal>
              <Reveal delay={240}>
                <Stat size="lg" tone="atmosphere" value={POSTER.co2.mean2100.toFixed(2)} unit="ppm" label="CO₂ in 2100, CORe 4.0" detail={`Bounds ${POSTER.co2.low}–${POSTER.co2.high} · historical continuation`} source={POSTER_SOURCE} />
              </Reveal>
            </div>
            <p className="demo-fine">{POSTER.caveats[0]}</p>
          </div>
        </section>

        <BenchSection
          id="aeros"
          n={1}
          model="aeros"
          title="Project a station’s seasons to 2100."
          lines={[
            "Pick any of 45 stations — or upload your own CSV — and Aeros projects its winters and summers.",
            "The shaded band is the 95% range of 200 bootstrap paths: how much one season could vary.",
          ]}
        >
          <AerosWorkbench compact />
        </BenchSection>

        <BenchSection
          id="nexus"
          n={2}
          model="nexus"
          isNew
          title="Check it against the past."
          lines={[
            "Nexus trains Aeros only on data up to 2000, then scores what it would have said about 2001–2026.",
            "It compares against two naive baselines — and says so when Aeros doesn’t beat them.",
          ]}
        >
          <NexusWorkbench compact />
        </BenchSection>

        <BenchSection
          id="core"
          n={3}
          model="core"
          title="Follow global CO₂ to 2100."
          lines={[
            "CORe continues the observed CO₂ record with ten competing growth models, weighted by how well they backtest.",
            "It is a continuation of history, not an emissions scenario — that is what Catalyst changes.",
          ]}
        >
          <CoreWorkbench compact />
        </BenchSection>

        <BenchSection
          id="catalyst"
          n={4}
          model="catalyst"
          isNew
          title="Test what changes it."
          lines={[
            "Move the emissions peak, the decline rate, net zero or carbon removal, and compare with the baseline.",
            "A new, simplified engine: carbon cycle → forcing → warming, with climate-sensitivity ranges.",
          ]}
        >
          <CatalystWorkbench compact />
        </BenchSection>

        <section id="data" className="demo-section" aria-labelledby="data-title">
          <div className="sol-container">
            <Reveal className="demo-head">
              <p className="sol-eyebrow">Open data</p>
              <h2 id="data-title" className="demo-h2">
                Ready-to-use datasets.
              </h2>
              <p className="demo-lede">
                The Solaris sample station set — NOAA GHCN-M v4 (adjusted), the station record NASA GISTEMP is built on — plus
                global CO₂ and SSP pathways. Download any of them.
              </p>
            </Reveal>
            <LazyMount minHeight={360} rootMargin="600px 0px">
              <DatasetLibrary compact />
            </LazyMount>
          </div>
        </section>

        <section id="open" className="demo-section demo-qr" aria-labelledby="open-title">
          <div className="sol-container demo-qr__inner">
            <div className="demo-qr__text">
              <p className="sol-eyebrow">Take Solaris with you</p>
              <h2 id="open-title" className="demo-h2 demo-qr__title">
                Scan to open the full Solaris platform.
              </h2>
              <p className="demo-lede">
                Every model on your phone or laptop, a step-by-step guide, and a free account to save your runs to projects.
              </p>
              <p className="demo-qr__url" data-testid="qr-url">
                {displayUrl(site)}
              </p>
              <div className="demo-qr__runtime">
                <RuntimeStatusPill />
              </div>
            </div>
            <div className="demo-qr__card">
              <QrCode value={site} label={`QR code linking to ${displayUrl(site)}`} className="demo-qr__code" />
              <p className="demo-qr__caption">{displayUrl(site)}</p>
            </div>
          </div>
        </section>

        <section id="team" className="demo-section" aria-labelledby="team-title">
          <div className="sol-container">
            <Reveal className="demo-head">
              <p className="sol-eyebrow">Team</p>
              <h2 id="team-title" className="demo-h2">
                Two students and a mentor.
              </h2>
            </Reveal>
            <TeamGrid />
            <p className="demo-fine">{PRESENTED_AT}.</p>
            <p className="demo-fine">{CONDITIONAL_NOTE}</p>
          </div>
        </section>
      </main>
      <SiteFooter inDemo />
    </div>
  );
}
