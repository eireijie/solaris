/**
 * Interactive station globe: drag to rotate, click a dot to choose a station.
 * Canvas + d3-geo orthographic projection; land outlines from world-atlas (110m).
 * The StationPicker list stays available as the keyboard-accessible alternative.
 */
import { useEffect, useRef, useState } from "react";
import { geoDistance, geoOrthographic, geoPath } from "d3-geo";
import type { GeoPermissibleObjects } from "d3-geo";
import type { Station } from "../../../data";
import { publicUrl } from "../../../lib/paths";

type Land = { land: GeoPermissibleObjects; borders: GeoPermissibleObjects };
let landPromise: Promise<Land> | null = null;

function loadLand(): Promise<Land> {
  landPromise ??= Promise.all([import("topojson-client"), import("world-atlas/countries-110m.json")]).then(([topo, mod]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = ((mod as any).default ?? mod) as any;
    return {
      land: topo.feature(world, world.objects.land) as unknown as GeoPermissibleObjects,
      borders: topo.mesh(world, world.objects.countries, (a: unknown, b: unknown) => a !== b) as unknown as GeoPermissibleObjects,
    };
  });
  return landPromise;
}

/* ---------------- textured Earth (WebGL) ---------------- */

const VERT = `attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform sampler2D tex;
uniform vec2 center;   // px, from bottom-left
uniform float radius;  // px
uniform vec2 view;     // lon0, lat0 in radians
const float PI = 3.14159265359;
void main() {
  vec2 p = (gl_FragCoord.xy - center) / radius;
  float d2 = dot(p, p);
  if (d2 > 1.0) {
    // Thin atmosphere outside the limb.
    float d = sqrt(d2);
    float glow = smoothstep(1.07, 1.0, d) * 0.55;
    gl_FragColor = vec4(vec3(0.42, 0.68, 1.0) * glow, glow);
    return;
  }
  float z = sqrt(1.0 - d2);
  float sl = sin(view.y), cl = cos(view.y);
  float lat = asin(clamp(z * sl + p.y * cl, -1.0, 1.0));
  float lon = view.x + atan(p.x, z * cl - p.y * sl);
  vec2 uv = vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
  vec3 c = texture2D(tex, uv).rgb;
  // Soft daylight from the upper left, a specular hint on water, limb haze.
  vec3 n = vec3(p, z);
  vec3 l = normalize(vec3(-0.45, 0.5, 0.75));
  float diff = clamp(dot(n, l), 0.0, 1.0);
  c *= 0.62 + 0.5 * diff;
  float water = step(c.r + c.g, c.b * 1.9);
  c += water * pow(clamp(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 24.0) * 0.18;
  float rim = pow(1.0 - z, 3.0);
  c = mix(c, vec3(0.45, 0.7, 1.0), rim * 0.55);
  float edge = smoothstep(1.0, 0.985, sqrt(d2));
  gl_FragColor = vec4(c * edge, edge);
}`;

type EarthGl = { draw: (cx: number, cy: number, r: number, lon: number, lat: number) => void; ready: () => boolean; dispose: () => void };

function createEarthGl(canvas: HTMLCanvasElement, textureUrl: string, onReady: () => void): EarthGl | null {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uCenter = gl.getUniformLocation(prog, "center");
  const uRadius = gl.getUniformLocation(prog, "radius");
  const uView = gl.getUniformLocation(prog, "view");
  const tex = gl.createTexture();
  let ready = false;
  let disposed = false;
  const img = new Image();
  img.onload = () => {
    if (disposed) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    // 2048 x 1024 is power-of-two, so repeat + mipmaps are allowed in WebGL 1.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    ready = true;
    onReady();
  };
  img.src = textureUrl;
  return {
    ready: () => ready,
    draw(cx, cy, r, lon, lat) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!ready) return;
      gl.uniform2f(uCenter, cx, cy);
      gl.uniform1f(uRadius, r);
      gl.uniform2f(uView, (lon * Math.PI) / 180, (lat * Math.PI) / 180);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      // Keep the context: React may remount on the same canvas, and a lost context cannot be reused.
      disposed = true;
    },
  };
}

const COLORS = {
  ocean: "#dbe7f3",
  land: "#f7f8f5",
  coast: "#8a99a8",
  border: "#c3ccd5",
  graticule: "rgba(60, 80, 100, 0.12)",
  urban: "#ffb020",
  rural: "#5eead4",
  other: "#e2e8f0",
  selected: "#ffffff",
  label: "#111827",
};

const dotColor = (s: Station) => (s.urban_rural === "urban" ? COLORS.urban : s.urban_rural === "rural" ? COLORS.rural : COLORS.other);

type View = { lon: number; lat: number; k: number };
const HOME: View = { lon: -80, lat: 12, k: 1 };

export function StationGlobe({
  stations,
  value,
  onChange,
  height = 380,
}: {
  stations: Station[];
  value: string | null;
  onChange: (id: string) => void;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const earth = useRef<EarthGl | null>(null);
  const view = useRef<View>({ ...HOME });
  const target = useRef<View | null>(null);
  const land = useRef<Land | null>(null);
  const hover = useRef<string | null>(null);
  const raf = useRef(0);
  const size = useRef({ w: 600, h: height });
  const live = useRef({ stations, value, onChange });
  live.current = { stations, value, onChange };
  const [hoverName, setHoverName] = useState<string | null>(null);

  const projection = () => {
    const { w, h } = size.current;
    const v = view.current;
    return geoOrthographic()
      .translate([w / 2, h / 2])
      .scale((Math.min(w, h) / 2 - 10) * v.k)
      .rotate([-v.lon, -v.lat])
      .clipAngle(90);
  };

  const visible = (s: Station) => geoDistance([s.lon, s.lat], [view.current.lon, view.current.lat]) < Math.PI / 2 - 0.02;

  const draw = () => {
    raf.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Ease towards a requested view (station selected, zoom buttons, reset).
    const t = target.current;
    if (t) {
      const v = view.current;
      let dLon = t.lon - v.lon;
      dLon = ((dLon + 540) % 360) - 180;
      v.lon += dLon * 0.18;
      v.lat += (t.lat - v.lat) * 0.18;
      v.k += (t.k - v.k) * 0.18;
      if (Math.abs(dLon) < 0.05 && Math.abs(t.lat - v.lat) < 0.05 && Math.abs(t.k - v.k) < 0.005) {
        v.lon = t.lon;
        v.lat = t.lat;
        v.k = t.k;
        target.current = null;
      } else schedule();
    }

    const { w, h } = size.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const proj = projection();
    const path = geoPath(proj, ctx);

    const glc = glCanvasRef.current;
    const textured = !!earth.current?.ready() && !!glc;
    if (glc && earth.current) {
      if (glc.width !== canvas.width || glc.height !== canvas.height) {
        glc.width = canvas.width;
        glc.height = canvas.height;
      }
      earth.current.draw((w / 2) * dpr, (h / 2) * dpr, proj.scale() * dpr, view.current.lon, view.current.lat);
    }

    if (!textured) {
      // Fallback while the texture loads, or where WebGL is unavailable.
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fillStyle = "#123a63";
      ctx.fill();
      if (land.current) {
        ctx.beginPath();
        path(land.current.land);
        ctx.fillStyle = "#3f6b4a";
        ctx.fill();
      }
    }

    if (land.current) {
      ctx.beginPath();
      path(land.current.borders);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    const { stations: list, value: selected } = live.current;
    const r = view.current.k > 1.8 ? 5 : 4;
    let labelFor: { s: Station; x: number; y: number } | null = null;
    for (const s of list) {
      if (!visible(s)) continue;
      const p = proj([s.lon, s.lat]);
      if (!p) continue;
      const isSel = s.id === selected;
      const isHover = s.id === hover.current;
      ctx.beginPath();
      ctx.arc(p[0], p[1], isSel || isHover ? r + 2 : r, 0, Math.PI * 2);
      ctx.fillStyle = dotColor(s);
      ctx.fill();
      ctx.lineWidth = isSel ? 2.5 : 1;
      ctx.strokeStyle = isSel ? COLORS.selected : "rgba(4, 12, 24, 0.85)";
      ctx.stroke();
      if (isHover || (isSel && !labelFor)) labelFor = { s, x: p[0], y: p[1] };
    }

    if (labelFor) {
      const text = labelFor.s.display_name;
      ctx.font = '500 13px "Geist Variable", system-ui, sans-serif';
      const tw = ctx.measureText(text).width;
      let x = labelFor.x + 12;
      if (x + tw + 12 > w) x = labelFor.x - 24 - tw;
      const y = Math.max(16, labelFor.y - 12);
      ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
      ctx.strokeStyle = "rgba(4, 12, 24, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x - 6, y - 14, tw + 12, 22, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.label;
      ctx.fillText(text, x, y + 2);
    }
  };

  const schedule = () => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  };

  // Size + land data.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      size.current = { w: Math.max(240, wrap.clientWidth), h: height };
      schedule();
    });
    ro.observe(wrap);
    if (glCanvasRef.current && !earth.current) earth.current = createEarthGl(glCanvasRef.current, publicUrl("globe/earth-blue-marble.jpg"), schedule);
    let alive = true;
    void loadLand().then((l) => {
      if (!alive) return;
      land.current = l;
      schedule();
    });
    return () => {
      alive = false;
      ro.disconnect();
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
      earth.current?.dispose();
      earth.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // Fly to the selected station.
  useEffect(() => {
    const s = stations.find((x) => x.id === value);
    if (s) target.current = { lon: s.lon, lat: s.lat, k: Math.max(view.current.k, 2.2) };
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, stations]);

  const stationAt = (clientX: number, clientY: number): Station | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const proj = projection();
    let best: Station | null = null;
    let bestD = 14 * 14;
    for (const s of live.current.stations) {
      if (!visible(s)) continue;
      const p = proj([s.lon, s.lat]);
      if (!p) continue;
      const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  };

  const drag = useRef<{ x: number; y: number; lon: number; lat: number; moved: boolean } | null>(null);

  const zoom = (factor: number) => {
    const v = target.current ?? view.current;
    target.current = { lon: v.lon, lat: v.lat, k: Math.min(6, Math.max(1, v.k * factor)) };
    schedule();
  };

  return (
    <div className="wb-globe" ref={wrapRef}>
      <canvas ref={glCanvasRef} className="wb-globe__earth" style={{ height }} aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className="wb-globe__canvas"
        style={{ height }}
        role="img"
        aria-label="Globe showing the sample stations. Drag to rotate and click a station to select it. The station list offers the same choices."
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          target.current = null;
          drag.current = { x: e.clientX, y: e.clientY, lon: view.current.lon, lat: view.current.lat, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) {
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
            if (d.moved) {
              const sens = 0.32 / view.current.k;
              view.current.lon = d.lon - dx * sens;
              view.current.lat = Math.max(-85, Math.min(85, d.lat + dy * sens));
              schedule();
            }
            return;
          }
          const s = stationAt(e.clientX, e.clientY);
          const id = s?.id ?? null;
          if (id !== hover.current) {
            hover.current = id;
            setHoverName(s?.display_name ?? null);
            e.currentTarget.style.cursor = id ? "pointer" : "grab";
            schedule();
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const s = stationAt(e.clientX, e.clientY);
            if (s) live.current.onChange(s.id);
          }
        }}
        onPointerLeave={() => {
          if (hover.current) {
            hover.current = null;
            setHoverName(null);
            schedule();
          }
        }}
      />
      <div className="wb-globe__tools">
        <button type="button" onClick={() => zoom(1.5)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoom(1 / 1.5)} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onClick={() => {
            target.current = { ...HOME };
            schedule();
          }}
          aria-label="Reset view"
          className="wb-globe__reset"
        >
          Reset
        </button>
      </div>
      <p className="wb-globe__legend">
        <span>
          <i style={{ background: COLORS.urban }} /> Urban
        </span>
        <span>
          <i style={{ background: COLORS.rural }} /> Rural
        </span>
        <span className="wb-globe__hint" aria-live="polite">
          {hoverName ?? "Drag to rotate. Click a station to select it."}
        </span>
      </p>
    </div>
  );
}
