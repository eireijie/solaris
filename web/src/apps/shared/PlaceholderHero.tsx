/**
 * PLACEHOLDER hero chapters — feature teams replace this with real content.
 * Shows the pattern: <EarthScroll> + <EarthChapter range placement>.
 */
import type { ReactNode } from "react";
import { EarthChapter, EarthScroll } from "../../components/EarthScroll";

export function PlaceholderHero({ actions, lede }: { actions?: ReactNode; lede?: ReactNode }) {
  return (
    <EarthScroll length={5} label="Solaris introduction">
      <EarthChapter range={[0, 0.16]} enter={false} placement="top">
        <h1 className="sol-hero__title">
          Model the future.
          <span>Test what changes it.</span>
        </h1>
        <p className="sol-hero__lede">
          {lede ??
            "Solaris is a student-led climate research platform that turns real station records into transparent, testable projections."}
        </p>
        {actions ? <div className="sol-hero__actions">{actions}</div> : null}
      </EarthChapter>

      <EarthChapter range={[0.26, 0.5]} placement="left">
        <div>
          <p className="sol-eyebrow">What Solaris is</p>
          <h2 className="sol-chapter-title">Four models. One honest workflow.</h2>
          <p className="sol-chapter-text">
            Aeros forecasts seasonal station temperatures; CORe projects CO₂; Catalyst tests what-if scenarios; Nexus checks
            the evidence.
          </p>
        </div>
      </EarthChapter>

      <EarthChapter range={[0.58, 0.84]} placement="right">
        <div>
          <p className="sol-eyebrow">Placeholder chapter</p>
          <h2 className="sol-chapter-title">Every assumption visible.</h2>
          <p className="sol-chapter-text">
            Projections are conditional model outputs, not verified predictions. Feature teams: replace these chapters.
          </p>
        </div>
      </EarthChapter>
    </EarthScroll>
  );
}
