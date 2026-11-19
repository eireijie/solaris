/**
 * EarthScroll — scroll-driven NASA Earth image-sequence hero.
 *
 * A tall section (length × viewport) with a sticky full-screen stage. Scroll
 * progress (0..1) scrubs the 72-frame rotation (crossfaded, eased), moves/scales
 * the planet along a keyframed path, and drives overlaid <EarthChapter>s.
 *
 * Usage:
 *   <EarthScroll length={5}>
 *     <EarthChapter range={[0, 0.2]} enter={false} placement="top">…headline…</EarthChapter>
 *     <EarthChapter range={[0.25, 0.45]} placement="left">…</EarthChapter>
 *   </EarthScroll>
 *
 * Progress for custom choreography: useEarthProgress() (re-renders, rAF-throttled)
 * or useEarthProgressListener(cb) (no re-render; write styles yourself).
 *
 * Reduced motion: static frame, normal document flow, all chapters visible.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { FrameSet } from "./earth/frames";
import { EarthRenderer } from "./earth/renderer";
import type { EarthPose } from "./earth/renderer";
import { publicUrl } from "../lib/paths";
import { usePrefersReducedMotion } from "../lib/hooks";

export type EarthKeyframe = EarthPose & { at: number };

const FRAME_COUNT = 72;

/** Default choreography (landscape). Feature teams can pass their own `path`. */
export const DEFAULT_PATH_WIDE: EarthKeyframe[] = [
  { at: 0.0, x: 0.5, y: 1.06, d: 1.12 },
  { at: 0.16, x: 0.5, y: 1.0, d: 1.12 },
  { at: 0.34, x: 0.71, y: 0.55, d: 0.86 },
  { at: 0.5, x: 0.71, y: 0.55, d: 0.86 },
  { at: 0.66, x: 0.28, y: 0.56, d: 1.02 },
  { at: 0.8, x: 0.3, y: 0.56, d: 1.04 },
  { at: 1.0, x: 0.5, y: 1.42, d: 2.5 },
];

/** Default choreography (portrait / phones). Text sits in the top half. */
export const DEFAULT_PATH_TALL: EarthKeyframe[] = [
  { at: 0.0, x: 0.5, y: 0.97, d: 1.3 },
  { at: 0.16, x: 0.5, y: 0.94, d: 1.3 },
  { at: 0.34, x: 0.62, y: 0.74, d: 1.45 },
  { at: 0.5, x: 0.62, y: 0.74, d: 1.45 },
  { at: 0.66, x: 0.4, y: 0.76, d: 1.55 },
  { at: 0.8, x: 0.42, y: 0.76, d: 1.6 },
  { at: 1.0, x: 0.5, y: 1.2, d: 2.8 },
];

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function poseAt(path: EarthKeyframe[], p: number): EarthPose {
  if (p <= path[0].at) return path[0];
  for (let i = 1; i < path.length; i++) {
    const b = path[i];
    if (p <= b.at) {
      const a = path[i - 1];
      const t = smooth((p - a.at) / (b.at - a.at || 1));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, d: a.d + (b.d - a.d) * t };
    }
  }
  return path[path.length - 1];
}

/* ------------------------------------------------------------------ context */

type Listener = (p: number) => void;
type Ctx = {
  subscribe: (l: Listener) => () => void;
  get: () => number;
  reduced: boolean;
  /** Scroll the window so that progress == p. */
  scrollTo: (p: number) => void;
};

const EarthCtx = createContext<Ctx | null>(null);

function useEarthCtx() {
  const c = useContext(EarthCtx);
  if (!c) throw new Error("EarthChapter / useEarthProgress must be used inside <EarthScroll>");
  return c;
}

/** Imperative listener (no React re-render). Callback runs inside requestAnimationFrame. */
export function useEarthProgressListener(cb: Listener) {
  const ctx = useEarthCtx();
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => ctx.subscribe((p) => ref.current(p)), [ctx]);
}

/** Current (smoothed) progress 0..1 as React state. Re-renders at most once per frame. */
export function useEarthProgress(): number {
  const ctx = useEarthCtx();
  const [p, setP] = useState(ctx.get());
  useEffect(() => ctx.subscribe(setP), [ctx]);
  return p;
}

/* ------------------------------------------------------------------ chapter */

export type ChapterPlacement = "top" | "center" | "left" | "right" | "bottom" | "bottom-left";

/**
 * Overlay content shown while progress is inside `range`. Fades/slides in and out.
 * `enter={false}`: already visible at progress 0 (use for the first chapter).
 * `exit={false}`: stays visible to the end.
 * Content stays in the accessibility tree; focusing inside a chapter scrolls it into view.
 */
export function EarthChapter({
  range,
  enter = true,
  exit = true,
  placement = "center",
  fade = 0.05,
  className = "",
  children,
}: {
  range: [number, number];
  enter?: boolean;
  exit?: boolean;
  placement?: ChapterPlacement;
  /** Fade width in progress units. */
  fade?: number;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useEarthCtx();
  const ref = useRef<HTMLDivElement>(null);
  const [a, b] = range;

  const apply = useCallback(
    (p: number) => {
      const el = ref.current;
      if (!el || ctx.reduced) return;
      const tin = enter ? smooth(clamp01((p - a) / fade)) : p <= b ? 1 : 0;
      const tout = exit ? 1 - smooth(clamp01((p - (b - fade)) / fade)) : 1;
      const o = Math.min(tin, enter ? tout : p <= b - fade ? 1 : tout);
      const y = (1 - tin) * 28 - (1 - tout) * 28;
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
      el.style.pointerEvents = o > 0.5 ? "auto" : "none";
      el.dataset.visible = o > 0.02 ? "true" : "false";
    },
    [a, b, enter, exit, fade, ctx.reduced],
  );

  useLayoutEffect(() => {
    apply(ctx.get());
  }, [apply, ctx]);
  useEffect(() => ctx.subscribe(apply), [ctx, apply]);

  return (
    <div
      ref={ref}
      className={`sol-earth-chapter sol-earth-chapter--${placement} ${className}`}
      onFocusCapture={() => {
        if (ctx.reduced) return;
        const p = ctx.get();
        if (p < a || p > b) ctx.scrollTo(enter ? a + (b - a) * 0.5 : a);
      }}
    >
      <div className="sol-earth-chapter__inner">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ main */

export type EarthScrollProps = {
  /** Section height in viewport heights (scroll distance ≈ length − 1 screens). */
  length?: number;
  pathWide?: EarthKeyframe[];
  pathTall?: EarthKeyframe[];
  /** Fraction of progress at which the rotation completes (default 1). */
  rotationEnd?: number;
  /** Show the "Scroll" cue at the bottom while progress < 0.04. */
  cue?: boolean | string;
  /** Show the small imagery loading indicator. */
  loader?: boolean;
  /** Called (in rAF) with smoothed progress. */
  onProgress?: (p: number) => void;
  /** Accessible label for the section. */
  label?: string;
  id?: string;
  children?: ReactNode;
};

export function EarthScroll({
  length = 5,
  pathWide = DEFAULT_PATH_WIDE,
  pathTall = DEFAULT_PATH_TALL,
  rotationEnd = 1,
  cue = true,
  loader = true,
  onProgress,
  label = "Solaris introduction",
  id,
  children,
}: EarthScrollProps) {
  const reduced = usePrefersReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(0);

  const listeners = useRef(new Set<Listener>());
  const progressRef = useRef(0);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const geom = useRef({ top: 0, height: 1, vh: 1 });

  const ctx = useMemo<Ctx>(
    () => ({
      subscribe: (l) => {
        listeners.current.add(l);
        return () => listeners.current.delete(l);
      },
      get: () => progressRef.current,
      reduced,
      scrollTo: (p) => {
        const g = geom.current;
        window.scrollTo({ top: g.top + p * Math.max(1, g.height - g.vh), behavior: "auto" });
      },
    }),
    [reduced],
  );

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!section || !stage || !canvas) return;

    const compact = window.matchMedia("(max-width: 820px)").matches;
    const lowMemory = ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
    const useMobile = compact || lowMemory;
    const frames = new FrameSet({
      baseUrl: publicUrl(useMobile ? "earth-sequence-mobile/" : "earth-sequence/"),
      count: FRAME_COUNT,
      maxDecoded: useMobile ? 20 : 16,
      // Decode desktop frames below native size: smaller textures upload and draw much faster.
      decodeSize: useMobile ? undefined : 1280,
    });
    let renderer: EarthRenderer;
    try {
      renderer = new EarthRenderer(canvas, frames);
    } catch {
      return;
    }

    let raf = 0;
    let target = reduced ? 0 : progressRef.current;
    let shown = target;
    let last = performance.now();
    let dirty = true;
    let disposed = false;
    let lastVar = "";

    const measure = () => {
      const rect = section.getBoundingClientRect();
      geom.current = { top: rect.top + window.scrollY, height: rect.height, vh: window.innerHeight };
      const s = stage.getBoundingClientRect();
      renderer.resize(s.width, s.height, useMobile ? 1.5 : 1.25);
      dirty = true;
    };

    const readScroll = () => {
      if (reduced) return;
      const g = geom.current;
      target = clamp01((window.scrollY - g.top) / Math.max(1, g.height - g.vh));
    };

    const tick = (now: number) => {
      raf = 0;
      if (disposed) return;
      const dt = Math.min(64, now - last);
      last = now;
      const k = 1 - Math.exp(-dt / 90);
      const prev = shown;
      shown = Math.abs(target - shown) < 0.0004 ? target : shown + (target - shown) * k;
      const moving = shown !== prev;

      const tall = geom.current.vh > (stage.clientWidth || 1) * 1.05;
      const pose = poseAt(tall ? pathTall : pathWide, shown);
      const frame = clamp01(shown / rotationEnd) * (FRAME_COUNT - 1);

      if (moving || dirty) {
        frames.setFocus(frame, target >= prev ? 1 : -1);
        renderer.draw(frame, pose, shown);
        dirty = false;
        progressRef.current = shown;
        // Coarse steps only: every write restyles the whole hero subtree.
        const coarse = (Math.round(shown * 100) / 100).toFixed(2);
        if (coarse !== lastVar) {
          lastVar = coarse;
          section.style.setProperty("--earth-p", coarse);
        }
        listeners.current.forEach((l) => l(shown));
        onProgressRef.current?.(shown);
      }
      if (shown !== target || dirty) raf = requestAnimationFrame(tick);
    };

    const kick = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    const onScroll = () => {
      readScroll();
      kick();
    };
    const onResize = () => {
      measure();
      readScroll();
      kick();
    };

    frames.onFrame = () => {
      dirty = true;
      kick();
    };
    let lastReported = 0;
    frames.onProgress = (f) => {
      if (f - lastReported >= 0.05 || f >= 1) {
        lastReported = f;
        setLoaded(f);
      }
    };

    measure();
    readScroll();
    shown = target;
    void frames.start().then(() => {
      if (disposed) return;
      setReady(true);
      dirty = true;
      kick();
    });

    const ro = new ResizeObserver(onResize);
    ro.observe(stage);
    ro.observe(section);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(() => !disposed && onResize());
    kick();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      frames.dispose();
    };
  }, [reduced, pathWide, pathTall, rotationEnd]);

  const cueText = typeof cue === "string" ? cue : "Scroll to explore";

  return (
    <EarthCtx.Provider value={ctx}>
      <section
        ref={sectionRef}
        id={id}
        aria-label={label}
        className={`sol-earth ${reduced ? "is-static" : ""} ${ready ? "is-ready" : ""}`}
        style={{ "--earth-length": length } as CSSProperties}
      >
        <div ref={stageRef} className="sol-earth__stage">
          <canvas ref={canvasRef} className="sol-earth__canvas" aria-hidden="true" />
          <div className="sol-earth__sun" aria-hidden="true" />
          <div className="sol-earth__vignette" aria-hidden="true" />
          <div className="sol-earth__grain" aria-hidden="true" />
          <div className="sol-earth__handoff" aria-hidden="true" />
          {!reduced && <div className="sol-earth__overlay">{children}</div>}
          {cue && !reduced ? (
            <div className="sol-earth__cue" aria-hidden="true">
              <span className="sol-earth__cue-line" />
              {cueText}
            </div>
          ) : null}
          {loader ? (
            <div className={`sol-earth__loader ${loaded >= 1 ? "is-done" : ""}`} aria-hidden="true">
              <span>NASA Earth imagery</span>
              <span className="sol-mono">{Math.round(loaded * 100)}%</span>
              <span className="sol-earth__loader-bar" style={{ transform: `scaleX(${loaded})` }} />
            </div>
          ) : null}
        </div>
        {reduced && <div className="sol-earth__flow">{children}</div>}
      </section>
    </EarthCtx.Provider>
  );
}
