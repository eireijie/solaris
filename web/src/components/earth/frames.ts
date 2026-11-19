/**
 * Progressive loader for the NASA SVS Earth image sequence.
 *
 * Strategy
 *  1. Frame 0 is fetched + decoded first so the hero paints immediately.
 *  2. All compressed JPEG blobs are then fetched in the background (4 at a time),
 *     nearest-to-the-current-frame first. Compressed bytes are small (~0.15–0.45 MB
 *     each) so we keep every blob.
 *  3. Decoded bitmaps are expensive (2000² × 4 B ≈ 16 MB) so only a sliding window
 *     around the current frame is decoded (createImageBitmap — off the main thread
 *     in modern browsers) and the rest are evicted (LRU by distance).
 */

export type FrameSetConfig = {
  /** Absolute URL prefix, e.g. https://host/earth-sequence/ */
  baseUrl: string;
  count: number;
  /** Max decoded bitmaps kept in memory. */
  maxDecoded: number;
  /** Optional decode size (px, square). Undefined = native resolution. */
  decodeSize?: number;
};

type Drawable = ImageBitmap | HTMLImageElement;

export function frameName(index: number) {
  return `earth-${String(index + 1).padStart(3, "0")}.jpg`;
}

async function decode(blob: Blob, size?: number): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      return size
        ? await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: "high" })
        : await createImageBitmap(blob);
    } catch {
      // Older Safari: no resize options → fall through.
      try {
        return await createImageBitmap(blob);
      } catch {
        /* fall back to <img> below */
      }
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Safe to revoke after decode() has resolved.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function release(d: Drawable) {
  if (typeof ImageBitmap !== "undefined" && d instanceof ImageBitmap) d.close();
}

export class FrameSet {
  private blobs: (Blob | undefined)[];
  private blobTasks = new Map<number, Promise<Blob | undefined>>();
  private decoded = new Map<number, Drawable>();
  private decoding = new Map<number, Promise<void>>();
  private abort = new AbortController();
  private focus = 0;
  private disposed = false;
  private loadedCount = 0;
  private failed = new Set<number>();

  /** Called whenever a new bitmap becomes drawable. */
  onFrame: () => void = () => {};
  /** Called with 0..1 as compressed frames arrive. */
  onProgress: (fraction: number) => void = () => {};

  constructor(private cfg: FrameSetConfig) {
    this.blobs = new Array(cfg.count);
  }

  get count() {
    return this.cfg.count;
  }

  /** Start loading: frame 0 first, then the rest in the background. Resolves when frame 0 is drawable. */
  async start(): Promise<void> {
    await this.ensureDecoded(0);
    void this.backgroundFetch();
  }

  /** Tell the loader which (fractional) frame is on screen; it keeps a decoded window around it. */
  setFocus(frame: number, direction: 1 | -1 = 1) {
    const f = Math.max(0, Math.min(this.cfg.count - 1, Math.round(frame)));
    this.focus = f;
    const ahead = Math.max(2, Math.floor(this.cfg.maxDecoded * 0.6));
    const behind = Math.max(1, this.cfg.maxDecoded - ahead - 1);
    void this.ensureDecoded(f);
    for (let d = 1; d <= Math.max(ahead, behind); d++) {
      if (d <= ahead) void this.ensureDecoded(f + d * direction);
      if (d <= behind) void this.ensureDecoded(f - d * direction);
    }
  }

  /** Best available drawable for an integer index (exact, else nearest decoded). */
  get(index: number): Drawable | undefined {
    return this.decoded.get(index);
  }

  nearest(index: number): Drawable | undefined {
    let best: Drawable | undefined;
    let dist = Infinity;
    this.decoded.forEach((d, i) => {
      const k = Math.abs(i - index);
      if (k < dist) {
        dist = k;
        best = d;
      }
    });
    return best;
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    this.decoded.forEach(release);
    this.decoded.clear();
    this.blobs = [];
  }

  private fetchBlob(i: number): Promise<Blob | undefined> {
    if (this.blobs[i]) return Promise.resolve(this.blobs[i]);
    const existing = this.blobTasks.get(i);
    if (existing) return existing;
    const task = fetch(this.cfg.baseUrl + frameName(i), { signal: this.abort.signal, cache: "force-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`Earth frame ${i + 1}: HTTP ${r.status}`);
        return r.blob();
      })
      .then((b) => {
        if (this.disposed) return undefined;
        this.blobs[i] = b;
        this.loadedCount++;
        this.onProgress(this.loadedCount / this.cfg.count);
        return b;
      })
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          this.failed.add(i);
          console.warn(e);
        }
        return undefined;
      })
      .finally(() => this.blobTasks.delete(i));
    this.blobTasks.set(i, task);
    return task;
  }

  private ensureDecoded(i: number): Promise<void> {
    if (this.disposed || i < 0 || i >= this.cfg.count) return Promise.resolve();
    if (this.decoded.has(i)) return Promise.resolve();
    const pending = this.decoding.get(i);
    if (pending) return pending;
    const task = this.fetchBlob(i)
      .then(async (blob) => {
        if (!blob || this.disposed) return;
        // Skip if focus has moved far away while we waited.
        if (Math.abs(i - this.focus) > this.cfg.maxDecoded && i !== 0) return;
        const d = await decode(blob, this.cfg.decodeSize);
        if (this.disposed) {
          release(d);
          return;
        }
        this.decoded.set(i, d);
        this.evict();
        this.onFrame();
      })
      .catch((e) => console.warn(e))
      .finally(() => this.decoding.delete(i));
    this.decoding.set(i, task);
    return task;
  }

  private evict() {
    if (this.decoded.size <= this.cfg.maxDecoded) return;
    const keys = [...this.decoded.keys()].sort((a, b) => Math.abs(b - this.focus) - Math.abs(a - this.focus));
    while (this.decoded.size > this.cfg.maxDecoded && keys.length) {
      const k = keys.shift()!;
      if (k === this.focus) continue;
      const d = this.decoded.get(k);
      if (d) release(d);
      this.decoded.delete(k);
    }
  }

  private async backgroundFetch() {
    const worker = async () => {
      while (!this.disposed) {
        // Next missing blob nearest to the current focus (prefer ahead).
        let next = -1;
        let best = Infinity;
        for (let i = 0; i < this.cfg.count; i++) {
          if (this.blobs[i] || this.blobTasks.has(i) || this.failed.has(i)) continue;
          const d = i >= this.focus ? i - this.focus : (this.focus - i) * 1.5;
          if (d < best) {
            best = d;
            next = i;
          }
        }
        if (next < 0) return;
        await this.fetchBlob(next);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }
}
