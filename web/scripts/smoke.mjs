#!/usr/bin/env node
/**
 * Headless smoke test (Playwright / Chromium).
 *
 *   npm run smoke                 # starts a Vite dev server on a free port
 *   npm run smoke -- --preview    # serves the production build in dist/ (run `npm run build` first)
 *   SMOKE_URL=http://host/path/ npm run smoke   # test an already-running server
 *   npm run smoke -- --only=home,demo           # subset of checks
 *   npm run smoke -- --no-runtime               # skip the Pyodide self-test (offline)
 *
 * For each viewport (desktop 1440×900, mobile 390×844 @3x touch) it loads:
 *   /            hero at 0%, ~33%, ~66%, ~95% scroll
 *   /demo/       hero top
 *   #/styleguide full page
 *   #/dev/runtime waits for the Pyodide self-test to pass (desktop + mobile)
 * plus a reduced-motion pass of /. Screenshots → web/.screenshots/.
 * Fails on console errors, page errors, failed same-origin requests, or horizontal overflow.
 *
 * Feature teams: add checks to CHECKS below.
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const OUT = join(web, ".screenshots");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

/* ---------------- server ---------------- */
let server = null;
let base = process.env.SMOKE_URL;
if (!base) {
  const vite = await import("vite");
  if (flag("preview")) {
    server = await vite.preview({ root: web, preview: { port: 4191, strictPort: false }, logLevel: "warn" });
    base = server.resolvedUrls.local[0];
  } else {
    server = await vite.createServer({ root: web, server: { port: 5191, strictPort: false }, logLevel: "warn" });
    await server.listen();
    base = server.resolvedUrls.local[0];
  }
}
if (!base.endsWith("/")) base += "/";
console.log(`[smoke] testing ${base}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/* ---------------- helpers ---------------- */
const failures = [];
const notes = [];
const fail = (m) => {
  failures.push(m);
  console.error(`  ✗ ${m}`);
};
const ok = (m) => console.log(`  ✓ ${m}`);

async function newPage(browser, vpName, extra = {}) {
  const ctx = await browser.newContext({ ...VIEWPORTS[vpName], ...extra });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (u.startsWith(base) && !/net::ERR_ABORTED/.test(r.failure()?.errorText ?? "")) errors.push(`requestfailed: ${u} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.url().startsWith(base) && r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return { ctx, page, errors };
}

async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) fail(`${label}: horizontal overflow (${o.sw} > ${o.iw})`);
}

async function heroReady(page) {
  await page.waitForSelector(".sol-earth.is-ready", { timeout: 20000 });
  await page.waitForTimeout(900); // canvas fade-in
}

async function scrollHeroTo(page, p) {
  await page.evaluate((p) => {
    const s = document.querySelector(".sol-earth");
    const top = s.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top + p * (s.offsetHeight - window.innerHeight));
  }, p);
  await page.waitForTimeout(1100); // smoothing + frame decode
}

/* ---------------- checks ---------------- */
const CHECKS = {
  async home(browser, vp) {
    const { ctx, page, errors } = await newPage(browser, vp);
    await page.goto(base, { waitUntil: "load" });
    await heroReady(page);
    await page.screenshot({ path: join(OUT, `${vp}-home-0.png`) });
    for (const [i, p] of [0.33, 0.66, 0.95].entries()) {
      await scrollHeroTo(page, p);
      await page.screenshot({ path: join(OUT, `${vp}-home-${i + 1}.png`) });
    }
    // After the hero.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${vp}-home-end.png`) });
    await noOverflow(page, `${vp} /`);
    errors.length ? errors.forEach((e) => fail(`${vp} /: ${e}`)) : ok(`${vp} / (hero + 4 scroll positions)`);
    await ctx.close();
  },

  async demo(browser, vp) {
    const { ctx, page, errors } = await newPage(browser, vp);
    await page.goto(`${base}demo/`, { waitUntil: "load" });
    await heroReady(page);
    await page.screenshot({ path: join(OUT, `${vp}-demo-0.png`) });
    await noOverflow(page, `${vp} /demo/`);
    errors.length ? errors.forEach((e) => fail(`${vp} /demo/: ${e}`)) : ok(`${vp} /demo/`);
    await ctx.close();
  },

  async styleguide(browser, vp) {
    const { ctx, page, errors } = await newPage(browser, vp);
    await page.goto(`${base}#/styleguide`, { waitUntil: "load" });
    await page.waitForSelector(".sol-chart svg", { timeout: 15000 });
    await page.waitForTimeout(900);
    // Exercise the chart crosshair.
    const svg = page.locator(".sol-chart__svg").first();
    await svg.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await svg.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
      await page.waitForTimeout(200);
      if (!(await page.locator(".sol-chart__tooltip").count())) fail(`${vp} styleguide: chart tooltip did not appear`);
      await svg.screenshot({ path: join(OUT, `${vp}-chart-hover.png`) });
    }
    // Modal opens + Esc closes.
    await page.getByRole("button", { name: "Open modal" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Open modal" }).click();
    await page.waitForTimeout(450);
    if (!(await page.locator("dialog[open]").count())) fail(`${vp} styleguide: modal did not open`);
    await page.screenshot({ path: join(OUT, `${vp}-modal.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    if (await page.locator("dialog[open]").count()) fail(`${vp} styleguide: Esc did not close modal`);
    await page.screenshot({ path: join(OUT, `${vp}-styleguide.png`), fullPage: true });
    await noOverflow(page, `${vp} styleguide`);
    errors.length ? errors.forEach((e) => fail(`${vp} styleguide: ${e}`)) : ok(`${vp} #/styleguide`);
    await ctx.close();
  },

  async runtime(browser, vp) {
    if (flag("no-runtime")) return;
    const { ctx, page, errors } = await newPage(browser, vp);
    const t0 = Date.now();
    await page.goto(`${base}#/dev/runtime`, { waitUntil: "load" });
    try {
      await page.waitForSelector('[data-selftest="pass"], [data-selftest="fail"]', { timeout: 180000 });
    } catch {
      fail(`${vp} runtime: self-test timed out`);
    }
    const state = await page.getAttribute("[data-selftest]", "data-selftest");
    const cold = await page.textContent('[data-testid="cold-load-ms"]').catch(() => null);
    const timings = await page.textContent('[data-testid="timings"]').catch(() => null);
    await page.screenshot({ path: join(OUT, `${vp}-runtime.png`), fullPage: true });
    if (state !== "pass") fail(`${vp} runtime: self-test ${state}`);
    else ok(`${vp} runtime self-test passed — cold load ${cold} ms (${timings?.trim()}), wall ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    notes.push(`${vp} pyodide cold load: ${cold} ms; ${timings?.trim()}`);
    // Real models, if present: run dispatch with the default payload.
    const btn = page.getByRole("button", { name: /Run dispatch/ });
    if (vp === "desktop" && (await btn.isEnabled().catch(() => false))) {
      await btn.click();
      await page.waitForSelector('[data-testid="dispatch-output"]', { timeout: 120000 }).catch(() => {});
      const out = (await page.textContent('[data-testid="dispatch-output"]').catch(() => "")) ?? "";
      notes.push(`dispatch("aeros"): ${out.split("\n")[0]}`);
      console.log(`  · dispatch("aeros"): ${out.split("\n")[0]}`);
      await page.screenshot({ path: join(OUT, `${vp}-runtime-dispatch.png`), fullPage: true });
    }
    errors.length ? errors.forEach((e) => fail(`${vp} runtime: ${e}`)) : null;
    await ctx.close();
  },

  async reduced(browser, vp) {
    if (vp !== "desktop") return;
    const { ctx, page, errors } = await newPage(browser, vp, { reducedMotion: "reduce" });
    await page.goto(base, { waitUntil: "load" });
    await heroReady(page);
    await page.screenshot({ path: join(OUT, `reduced-motion-home.png`), fullPage: true });
    errors.length ? errors.forEach((e) => fail(`reduced /: ${e}`)) : ok("reduced-motion /");
    await ctx.close();
  },
};

const browser = await chromium.launch();
try {
  for (const vp of Object.keys(VIEWPORTS)) {
    console.log(`[smoke] ${vp}`);
    for (const [name, fn] of Object.entries(CHECKS)) {
      if (only.length && !only.includes(name)) continue;
      try {
        await fn(browser, vp);
      } catch (e) {
        fail(`${vp} ${name}: ${e.message.split("\n")[0]}`);
      }
    }
  }
} finally {
  await browser.close();
  await server?.close?.();
  if (server?.httpServer) server.httpServer.close();
}

console.log(`\n[smoke] screenshots in ${OUT}`);
notes.forEach((n) => console.log(`[smoke] ${n}`));
if (failures.length) {
  console.error(`[smoke] ${failures.length} failure(s)`);
  process.exit(1);
}
console.log("[smoke] all checks passed");
process.exit(0);
