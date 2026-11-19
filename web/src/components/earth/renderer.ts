/**
 * Canvas renderer for the Earth hero. Pure drawing — no DOM reads, no React.
 *
 * Layers (back → front): deep-space gradient + starfield (pre-rendered offscreen,
 * gentle parallax) → atmospheric halo → Earth frame(s) clipped to the disc, with a
 * crossfade between the two nearest frames → limb light. The vignette and film
 * grain live in CSS over the canvas (cheaper than per-frame canvas work).
 */
import type { FrameSet } from "./frames";

/** Earth disc position inside the 1:1 NASA frames (fractions of image size). Measured from the frames. */
export const DISC = { cx: 0.4995, cy: 0.4995, r: 0.4785 };

export type EarthPose = {
  /** Disc centre, as fractions of the stage width / height. */
  x: number;
  y: number;
  /** Disc diameter as a multiple of min(stage width, stage height). */
  d: number;
};

type Star = { x: number; y: number; r: number; a: number; warm: boolean };

function makeStars(count: number, seed = 0x5f3759df): Star[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return Array.from({ length: count }, () => {
    const big = rnd() > 0.94;
    return {
      x: rnd(),
      y: rnd() * 1.15,
      r: big ? 0.9 + rnd() * 0.8 : 0.3 + rnd() * 0.6,
      a: big ? 0.55 + rnd() * 0.35 : 0.12 + rnd() * 0.45,
      warm: rnd() > 0.82,
    };
  });
}

export class EarthRenderer {
  private ctx: CanvasRenderingContext2D;
  private stars: HTMLCanvasElement | OffscreenCanvas | null = null;
  private w = 1;
  private h = 1;
  private dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private frames: FrameSet,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) throw new Error("Canvas 2D not available");
    this.ctx = ctx;
  }

  /** Size the backing store. Call on resize (with CSS px). */
  resize(width: number, height: number, maxDpr = 2) {
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    const bw = Math.round(this.w * this.dpr);
    const bh = Math.round(this.h * this.dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.renderStars();
  }

  private renderStars() {
    const sw = Math.round(this.w * this.dpr);
    const sh = Math.round(this.h * 1.15 * this.dpr);
    const c: HTMLCanvasElement | OffscreenCanvas =
      typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(sw, sh) : Object.assign(document.createElement("canvas"), { width: sw, height: sh });
    const g = c.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!g) return;
    const density = Math.round(Math.min(420, (this.w * this.h) / 5200));
    for (const s of makeStars(density)) {
      g.beginPath();
      g.fillStyle = s.warm ? `rgba(255, 226, 190, ${s.a})` : `rgba(210, 228, 255, ${s.a})`;
      g.arc(s.x * sw, (s.y / 1.15) * sh, s.r * this.dpr, 0, Math.PI * 2);
      g.fill();
    }
    this.stars = c;
  }

  /** Draw one frame of the scene. `frame` is fractional (crossfades between neighbours). */
  draw(frame: number, pose: EarthPose, progress: number) {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // Deep space.
    ctx.fillStyle = "#010308";
    ctx.fillRect(0, 0, w, h);
    const sky = ctx.createRadialGradient(w * 0.62, h * 0.38, 0, w * 0.62, h * 0.38, Math.max(w, h) * 0.9);
    sky.addColorStop(0, "rgba(18, 39, 70, 0.30)");
    sky.addColorStop(0.5, "rgba(6, 16, 31, 0.16)");
    sky.addColorStop(1, "rgba(1, 3, 8, 0)");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Stars with slow parallax.
    if (this.stars) {
      const shift = progress * h * 0.12;
      ctx.drawImage(this.stars as CanvasImageSource, 0, -shift, w, h * 1.15);
    }

    const unit = Math.min(w, h);
    const diameter = pose.d * unit;
    const r = diameter / 2;
    const cx = pose.x * w;
    const cy = pose.y * h;

    // Skip Earth work if fully off-screen.
    if (cx + r * 1.3 < 0 || cx - r * 1.3 > w || cy + r * 1.3 < 0 || cy - r * 1.3 > h) return;

    // Atmospheric halo (outer glow), brighter on the sunlit (right) side.
    const halo = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.16);
    halo.addColorStop(0, "rgba(120, 196, 255, 0.30)");
    halo.addColorStop(0.25, "rgba(90, 170, 240, 0.14)");
    halo.addColorStop(1, "rgba(60, 140, 220, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.16, 0, Math.PI * 2);
    ctx.fill();

    // Wide soft bloom.
    const bloom = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.7);
    bloom.addColorStop(0, "rgba(70, 140, 220, 0.10)");
    bloom.addColorStop(1, "rgba(70, 140, 220, 0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(cx - r * 1.7, cy - r * 1.7, r * 3.4, r * 3.4);

    // Earth disc.
    const n = this.frames.count;
    const f = Math.max(0, Math.min(n - 1, frame));
    const i0 = Math.floor(f);
    const i1 = Math.min(n - 1, i0 + 1);
    const t = f - i0;
    const a = this.frames.get(i0);
    const b = this.frames.get(i1);
    const base = a ?? b ?? this.frames.nearest(Math.round(f));

    const img = diameter / (2 * DISC.r);
    const ix = cx - DISC.cx * img;
    const iy = cy - DISC.cy * img;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.997, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#02060c";
    ctx.fillRect(cx - r, cy - r, diameter, diameter);
    if (base) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";
      ctx.drawImage(base, ix, iy, img, img);
      if (a && b && a !== b && t > 0.01) {
        ctx.globalAlpha = t;
        ctx.drawImage(b, ix, iy, img, img);
        ctx.globalAlpha = 1;
      }
    }
    // Inner limb darkening + a thin atmospheric rim.
    const limb = ctx.createRadialGradient(cx, cy, r * 0.72, cx, cy, r);
    limb.addColorStop(0, "rgba(0, 0, 0, 0)");
    limb.addColorStop(0.86, "rgba(4, 12, 24, 0.10)");
    limb.addColorStop(0.97, "rgba(110, 180, 255, 0.10)");
    limb.addColorStop(1, "rgba(150, 210, 255, 0.28)");
    ctx.fillStyle = limb;
    ctx.fillRect(cx - r, cy - r, diameter, diameter);
    ctx.restore();
  }
}
