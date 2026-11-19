#!/usr/bin/env node
/**
 * Workbench smoke test (Playwright / Chromium) for src/features/models.
 *
 *   node scripts/smoke-workbench.mjs                  # starts Vite on 5181 (or the next free port)
 *   SMOKE_URL=http://127.0.0.1:5181/ node scripts/smoke-workbench.mjs   # use a running server
 *   node scripts/smoke-workbench.mjs --only=desktop   # desktop | mobile | compact
 *
 * Loads web/workbench.html (the dev harness) at 1440 px and 390 px and checks:
 *   - precomputed Aeros / Nexus / CORe results render; Catalyst computes live once in view
 *   - changing an Aeros option produces a live Python result (timings recorded)
 *   - switching to an Argentine station flips the season labels (D-J-F becomes summer)
 *   - uploading data/stations/csv/USW00013743.csv validates and runs
 *   - "Save to project" emits a payload and the restored copy shows it without re-running
 *   - a Catalyst slider (keyboard) changes the 2100 numbers; a CORe slider recomputes live
 *   - Nexus station-set view and poster note; library "Open in Aeros"
 *   - no console errors, no page errors, no horizontal overflow
 * Screenshots: web/.screenshots/workbench-*.png (only those files are replaced).
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const repo = resolve(web, "..");
const OUT = join(web, ".screenshots");
const SAMPLE_CSV = join(repo, "data/stations/csv/USW00013743.csv");
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const want = (n) => !only.length || only.includes(n);

const LIVE_TIMEOUT = 120_000;
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

/* ---------------- server ---------------- */
let server = null;
let base = process.env.SMOKE_URL;
if (!base) {
  const vite = await import("vite");
  server = await vite.createServer({ root: web, server: { port: 5181, strictPort: false, host: "127.0.0.1" }, logLevel: "warn" });
  await server.listen();
  base = server.resolvedUrls.local[0];
}
if (!base.endsWith("/")) base += "/";
console.log(`[wb-smoke] testing ${base}workbench.html`);

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.startsWith("workbench-") && f.endsWith(".png")) rmSync(join(OUT, f));

/* ---------------- helpers ---------------- */
const failures = [];
const timings = [];
let current = "";
const fail = (msg) => {
  failures.push(`[${current}] ${msg}`);
  console.log(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

async function step(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(`${name}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  }
}

function watch(page) {
  const origin = new URL(base).origin;
  page.on("console", (m) => {
    if (m.type() === "error") fail(`console error: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => fail(`page error: ${e.message.slice(0, 300)}`));
  page.on("requestfailed", (r) => {
    if (r.url().startsWith(origin) && !/aborted/i.test(r.failure()?.errorText ?? "")) fail(`request failed: ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.url().startsWith(origin) && r.status() >= 400) fail(`HTTP ${r.status()}: ${r.url()}`);
  });
}

async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (o.sw > o.cw + 1) fail(`horizontal overflow (${label}): scrollWidth ${o.sw} > ${o.cw}`);
}

async function shot(page, name, selector) {
  const path = join(OUT, `workbench-${name}.png`);
  if (selector) await page.locator(selector).first().screenshot({ path });
  else await page.screenshot({ path });
}

const wb = (page, model) => page.locator(`[data-workbench="${model}"]`).first();

async function liveMs(locator, label) {
  const el = locator.locator('[data-source="live"]').first();
  await el.waitFor({ timeout: LIVE_TIMEOUT });
  const ms = Number(await el.getAttribute("data-ms"));
  const text = (await el.innerText()).replace(/\s+/g, " ").trim();
  timings.push({ viewport: current, label, ms, text });
  return ms;
}

/** Waits until the live-source line is gone (a new run started) and back. */
async function nextLive(locator, label, before) {
  await locator.page().waitForFunction(
    ([sel, prev]) => {
      const el = document.querySelector(sel);
      return el && el.getAttribute("data-source") === "live" && el.textContent !== prev;
    },
    [`[data-workbench="${await locator.getAttribute("data-workbench")}"] [data-source]`, before],
    { timeout: LIVE_TIMEOUT },
  );
  return liveMs(locator, label);
}

const statusText = async (locator) => (await locator.locator("[data-source]").first().textContent().catch(() => "")) ?? "";

/* ---------------- full run per viewport ---------------- */
async function fullRun(browser, vpName) {
  current = vpName;
  console.log(`\n[${vpName}]`);
  const ctx = await browser.newContext(VIEWPORTS[vpName]);
  const page = await ctx.newPage();
  watch(page);
  await page.goto(`${base}workbench.html`, { waitUntil: "domcontentloaded" });

  const aeros = wb(page, "aeros");
  const nexus = wb(page, "nexus");
  const core = wb(page, "core");
  const cat = wb(page, "catalyst");
  const lib = wb(page, "library");

  await step("precomputed Aeros / Nexus / CORe render", async () => {
    for (const w of [aeros, nexus, core]) await w.locator('[data-source="precomputed"]').waitFor({ timeout: 30_000 });
    await aeros.getByTestId("aeros-headline").waitFor();
    await aeros.getByTestId("aeros-chart").locator("svg").first().waitFor();
    await nexus.getByTestId("nexus-metrics").waitFor();
    await core.getByTestId("core-headline").waitFor();
    const head = (await aeros.getByTestId("aeros-headline").innerText()).replace(/\s+/g, " ");
    if (!/°C/.test(head)) throw new Error(`Aeros headline has no °C: ${head}`);
    await aeros.getByRole("radio", { name: "Winter (D-J-F)" }).waitFor();
  });
  await step("library lists 45 stations", async () => {
    await lib.getByTestId("library-list").locator("li").nth(44).waitFor({ timeout: 20_000 });
  });
  await noOverflow(page, "initial");
  await shot(page, `${vpName}-top`);
  await shot(page, `${vpName}-aeros`, '[data-workbench="aeros"]');

  /* Aeros: option change -> live */
  await step("Aeros option change (100 paths, fast) runs live in Python", async () => {
    await aeros.getByRole("radio", { name: /100 · fast/ }).click();
    const ms = await liveMs(aeros, "Aeros 100 paths (first live run incl. Python start-up)");
    if (!(ms > 0)) throw new Error("no timing");
  });
  await step("Aeros seed change re-runs live (warm)", async () => {
    const before = await statusText(aeros);
    const seed = aeros.getByTestId("aeros-seed");
    await seed.fill("7");
    await seed.press("Enter");
    await nextLive(aeros, "Aeros 100 paths, seed 7 (warm)", before);
  });
  await step("Aeros 200 paths, seed 7 (warm)", async () => {
    const before = await statusText(aeros);
    await aeros.getByRole("radio", { name: /200 · notebook/ }).click();
    await nextLive(aeros, "Aeros 200 paths, seed 7 (warm)", before);
  });
  await shot(page, `${vpName}-aeros-live`, '[data-workbench="aeros"]');

  /* Argentine station: season labels flip */
  await step("Argentine station flips season labels", async () => {
    await aeros.getByTestId("station-picker").click();
    const search = page.getByLabel("Search stations");
    await search.fill("Buenos");
    await search.press("Enter");
    await aeros.getByRole("radio", { name: "Summer (D-J-F)" }).waitFor({ timeout: LIVE_TIMEOUT });
    await aeros.getByRole("radio", { name: "Winter (J-J-A)" }).waitFor();
    const picked = await aeros.getByTestId("station-picker").innerText();
    if (!/Buenos Aires/.test(picked)) throw new Error(`picker shows "${picked}"`);
  });
  await shot(page, `${vpName}-aeros-argentina`, '[data-workbench="aeros"]');

  /* Save -> restore */
  await step("Save to project -> restored copy shows saved run without re-running", async () => {
    await aeros.locator('[data-source="live"]').waitFor({ timeout: LIVE_TIMEOUT });
    await aeros.getByRole("button", { name: "Save to project" }).click();
    const restored = page.getByTestId("restored");
    await restored.locator('[data-source="saved"]').waitFor({ timeout: 20_000 });
    await restored.getByTestId("aeros-headline").waitFor();
    const events = await page.evaluate(() => window.__wbEvents ?? []);
    const save = events.filter((e) => e.type === "save" && e.model === "aeros").at(-1);
    if (!save) throw new Error("no save event");
    if (save.payloadBytes > 20_000) throw new Error(`saved payload is ${save.payloadBytes} bytes`);
    const runEvents = events.filter((e) => e.type === "complete");
    if (!runEvents.length) throw new Error("no onRunComplete events");
  });

  /* Upload */
  await step("upload sample CSV validates and runs", async () => {
    await aeros.getByRole("radio", { name: "Use your own data" }).click();
    await aeros.getByTestId("csv-input").setInputFiles(SAMPLE_CSV);
    await aeros.getByTestId("csv-messages").getByText("Ready").waitFor({ timeout: 10_000 });
    await aeros.getByText("USW00013743").first().waitFor();
    await liveMs(aeros, "Aeros uploaded CSV (200 paths, seed 7)");
    await aeros.getByRole("radio", { name: "Winter (D-J-F)" }).waitFor();
  });
  await shot(page, `${vpName}-aeros-upload`, '[data-workbench="aeros"]');

  /* Library -> Open in Aeros */
  await step("library 'Open in Aeros' selects the station", async () => {
    await aeros.getByRole("radio", { name: "Sample stations" }).click();
    await lib.getByTestId("open-AR000087344").click();
    await page.waitForFunction(() => /Córdoba/.test(document.querySelector('[data-workbench="aeros"] [data-testid="station-picker"]')?.textContent ?? ""), null, {
      timeout: 10_000,
    });
  });

  /* Nexus */
  await step("Nexus station set view + poster note", async () => {
    await nexus.scrollIntoViewIfNeeded();
    await nexus.getByRole("radio", { name: "Station set statistics" }).click();
    await nexus.getByTestId("nexus-set").waitFor({ timeout: 20_000 });
    await nexus.getByTestId("poster-note").waitFor();
  });
  await shot(page, `${vpName}-nexus-set`, '[data-workbench="nexus"]');
  await step("Nexus single station audit (precomputed)", async () => {
    await nexus.getByRole("radio", { name: "Single station audit" }).click();
    await nexus.getByTestId("nexus-chart").waitFor({ timeout: 20_000 });
  });
  await step("Nexus cutoff change runs live", async () => {
    await nexus.getByRole("radio", { name: "1990" }).click();
    await liveMs(nexus, "Nexus hindcast, cutoff 1990 (warm)");
  });
  await shot(page, `${vpName}-nexus`, '[data-workbench="nexus"]');

  /* CORe */
  await step("CORe ECS slider recomputes live", async () => {
    await core.scrollIntoViewIfNeeded();
    const s = core.getByRole("slider", { name: "Climate sensitivity (ECS)" });
    await s.focus();
    await s.press("ArrowRight");
    await liveMs(core, "CORe ECS 3.1 (warm)");
  });
  await shot(page, `${vpName}-core`, '[data-workbench="core"]');

  /* Catalyst */
  await step("Catalyst computes live when in view", async () => {
    await cat.scrollIntoViewIfNeeded();
    await liveMs(cat, "Catalyst Net zero 2050 preset (first run in view)");
    await cat.getByTestId("catalyst-deltas").waitFor();
  });
  await step("Catalyst slider changes the numbers", async () => {
    const end = cat.getByTestId("delta-end").first();
    const before = await end.getAttribute("data-value");
    const statusBefore = await statusText(cat);
    const s = cat.getByRole("slider", { name: "Net-zero CO₂ year" });
    await s.focus();
    for (let i = 0; i < 4; i++) await s.press("ArrowRight");
    await nextLive(cat, "Catalyst net-zero year +4 steps (warm, debounced)", statusBefore);
    const after = await end.getAttribute("data-value");
    if (before === after) throw new Error(`delta-end unchanged (${before})`);
  });
  await step("Catalyst preset 'Current trajectory' changes the numbers", async () => {
    const statusBefore = await statusText(cat);
    await cat.getByRole("button", { name: /Current trajectory/ }).click();
    await nextLive(cat, "Catalyst preset Current trajectory (warm)", statusBefore);
  });
  await noOverflow(page, "after interactions");
  await shot(page, `${vpName}-catalyst`, '[data-workbench="catalyst"]');
  await shot(page, `${vpName}-library`, '[data-workbench="library"]');
  await ctx.close();
}

/* ---------------- compact pass ---------------- */
async function compactRun(browser) {
  for (const vp of ["desktop", "mobile"]) {
    current = `compact-${vp}`;
    console.log(`\n[${current}]`);
    const ctx = await browser.newContext(VIEWPORTS[vp]);
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${base}workbench.html?compact=1`, { waitUntil: "domcontentloaded" });
    await step("compact precomputed results render", async () => {
      for (const m of ["aeros", "nexus", "core"]) await wb(page, m).locator('[data-source="precomputed"]').waitFor({ timeout: 30_000 });
      await wb(page, "catalyst").scrollIntoViewIfNeeded();
      await wb(page, "catalyst").locator('[data-source="live"]').waitFor({ timeout: LIVE_TIMEOUT });
    });
    await noOverflow(page, "compact");
    for (const m of ["aeros", "nexus", "core", "catalyst"]) await shot(page, `compact-${vp}-${m}`, `[data-workbench="${m}"]`);
    await ctx.close();
  }
}

/* ---------------- main ---------------- */
const browser = await chromium.launch();
try {
  if (want("desktop")) await fullRun(browser, "desktop");
  if (want("mobile")) await fullRun(browser, "mobile");
  if (want("compact")) await compactRun(browser);
} finally {
  await browser.close();
  if (server) await server.close();
}

console.log("\n[wb-smoke] timings (data-ms = time inside Python; status text shows what the user sees)");
for (const t of timings) console.log(`  ${t.viewport.padEnd(8)} ${String(t.ms).padStart(6)} ms  ${t.label}  — "${t.text}"`);
console.log(`\n[wb-smoke] screenshots: ${OUT}/workbench-*.png`);
if (failures.length) {
  console.log(`\n[wb-smoke] FAILED (${failures.length})`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("[wb-smoke] all checks passed");
