#!/usr/bin/env node
/**
 * Site smoke test (Playwright / Chromium) for the platform + summit demo.
 *
 *   node scripts/smoke-site.mjs                    # starts a Vite dev server on a free port
 *   node scripts/smoke-site.mjs --dist             # serves dist/ under /solaris/ (run `npm run build` first)
 *   SMOKE_URL=http://localhost:5182/ node scripts/smoke-site.mjs   # test a running server
 *   node scripts/smoke-site.mjs --only=welcome,landing,routes,demo,auth
 *   node scripts/smoke-site.mjs --auth-live        # also sign up a throwaway account against the real Supabase project
 *
 * Checks: welcome dialog shows once and stays dismissed; landing scroll story at several progress points
 * (1440 and 390 px) without downloading Supabase or Pyodide; every route renders (workspace pages host their
 * workbench); guide; demo sections, lazy workbenches, decodable QR code, presenter mode; auth dialog
 * validation and (with --auth-live) sign-up / data-layer round trip. Fails on console errors, page errors,
 * failed same-origin requests, or horizontal overflow. Screenshots → web/.screenshots/site-*.png.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import jsQR from "jsqr";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const OUT = join(web, ".screenshots");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);

const env = Object.fromEntries(
  (existsSync(join(web, ".env")) ? readFileSync(join(web, ".env"), "utf8") : "")
    .split("\n")
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const EXPECTED_QR = env.VITE_PUBLIC_SITE_URL || null;

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

/* ---------------- server ---------------- */
let server = null;
let staticServer = null;
let base = process.env.SMOKE_URL;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".csv": "text/csv", ".zip": "application/zip", ".py": "text/plain", ".txt": "text/plain", ".wasm": "application/wasm" };
if (!base && flag("dist")) {
  const dist = join(web, "dist");
  if (!existsSync(dist)) throw new Error("dist/ missing — run npm run build first");
  staticServer = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (!url.pathname.startsWith("/solaris/")) {
      res.writeHead(url.pathname === "/solaris" ? 301 : 404, url.pathname === "/solaris" ? { Location: "/solaris/" } : {});
      return res.end();
    }
    let p = join(dist, decodeURIComponent(url.pathname.slice("/solaris/".length)));
    if (!p.startsWith(dist)) return res.writeHead(403).end();
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
    if (!existsSync(p)) return res.writeHead(404).end("not found");
    res.writeHead(200, { "Content-Type": MIME[extname(p)] ?? "application/octet-stream" });
    createReadStream(p).pipe(res);
  });
  await new Promise((r) => staticServer.listen(4195, r));
  base = "http://localhost:4195/solaris/";
} else if (!base) {
  const vite = await import("vite");
  server = await vite.createServer({ root: web, server: { port: 5183, strictPort: false }, logLevel: "warn" });
  await server.listen();
  base = server.resolvedUrls.local[0];
}
if (!base.endsWith("/")) base += "/";
const isDev = !flag("dist") && !/\/solaris\/$/.test(base);
console.log(`[smoke-site] testing ${base}${isDev ? " (dev)" : ""}`);

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.startsWith("site-")) rmSync(join(OUT, f));

/* ---------------- helpers ---------------- */
const failures = [];
const notes = [];
const fail = (m) => {
  failures.push(m);
  console.error(`  ✗ ${m}`);
};
const ok = (m) => console.log(`  ✓ ${m}`);
const shot = (name) => join(OUT, `site-${name}.png`);

async function newPage(browser, vp, { dismissWelcome = true, allowHosts = [], ...extra } = {}) {
  const ctx = await browser.newContext({ ...VIEWPORTS[vp], ...extra });
  if (dismissWelcome) await ctx.addInitScript(() => localStorage.setItem("solaris.welcome.v1", "smoke"));
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (allowHosts.some((h) => t.includes(h) || /status of 4\d\d/.test(t))) return;
    errors.push(`console: ${t}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("request", (r) => requests.push(r.url()));
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (u.startsWith(base) && !/net::ERR_ABORTED/.test(r.failure()?.errorText ?? "")) errors.push(`requestfailed: ${u} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.url().startsWith(base) && r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return { ctx, page, errors, requests };
}

async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) fail(`${label}: horizontal overflow (${o.sw} > ${o.iw})`);
}

function report(label, errors) {
  if (errors.length) errors.forEach((e) => fail(`${label}: ${e}`));
  else ok(label);
}

async function heroReady(page) {
  await page.waitForSelector(".sol-earth.is-ready", { timeout: 25000 });
  await page.waitForTimeout(900);
}

async function scrollHeroTo(page, p) {
  await page.evaluate((p) => {
    const s = document.querySelector(".sol-earth");
    const top = s.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top + p * (s.offsetHeight - window.innerHeight));
  }, p);
  await page.waitForTimeout(1200);
}

async function scrollToSel(page, sel, settle = 900) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70);
  }, sel);
  await page.waitForTimeout(settle);
}

/** Scroll through the whole page in steps so reveal + lazy-mount observers fire. */
async function scrollThrough(page, step = 700, pause = 120) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += step) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(pause);
  }
}

/* ---------------- checks ---------------- */
const CHECKS = {
  async welcome(browser, vp) {
    const { ctx, page, errors } = await newPage(browser, vp, { dismissWelcome: false });
    await page.goto(base, { waitUntil: "load" });
    const dlg = page.locator('dialog[open] [data-testid="welcome-dialog"]');
    await dlg.waitFor({ timeout: 8000 }).catch(() => fail(`${vp} welcome: dialog did not appear on first visit`));
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot(`${vp}-welcome`) });
    await page.getByTestId("welcome-explore").click();
    await page.waitForTimeout(400);
    if (await page.locator("dialog[open]").count()) fail(`${vp} welcome: did not close`);
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1800);
    if (await page.locator('dialog[open] [data-testid="welcome-dialog"]').count()) fail(`${vp} welcome: re-appeared after dismissal`);
    // Re-open from the header ("About") — on phones it sits in the menu.
    if (vp === "mobile") await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByTestId("about-button")[vp === "mobile" ? "last" : "first"]().click();
    await page.waitForTimeout(500);
    if (!(await page.locator('dialog[open] [data-testid="welcome-dialog"]').count())) fail(`${vp} welcome: About did not reopen it`);
    await page.keyboard.press("Escape");
    await noOverflow(page, `${vp} welcome`);
    report(`${vp} welcome dialog (once, dismissible, re-openable)`, errors);
    await ctx.close();
  },

  async landing(browser, vp) {
    const { ctx, page, errors, requests } = await newPage(browser, vp);
    await page.goto(base, { waitUntil: "load" });
    await heroReady(page);
    for (const [i, p] of [0, 0.3, 0.54, 0.78, 0.97].entries()) {
      if (p) await scrollHeroTo(page, p);
      await page.screenshot({ path: shot(`${vp}-landing-hero-${i}`) });
    }
    for (const id of ["platform", "research", "models", "trust", "roadmap", "team"]) {
      await scrollToSel(page, `#${id}`, 1000);
      await page.screenshot({ path: shot(`${vp}-landing-${id}`) });
    }
    await scrollToSel(page, ".lp-cta", 800);
    await page.screenshot({ path: shot(`${vp}-landing-cta`) });
    await scrollThrough(page, 900, 60);
    await page.waitForTimeout(800);
    if (vp === "desktop") await page.screenshot({ path: shot(`${vp}-landing-full`), fullPage: true });
    await noOverflow(page, `${vp} landing`);
    const heavy = requests.filter((u) => /@supabase|supabase\.co|pyodide|cdn\.jsdelivr/.test(u));
    if (heavy.length) fail(`${vp} landing downloaded Supabase/Pyodide before needed: ${heavy.slice(0, 3).join(", ")}`);
    const preview = await page.locator(".site-preview .sol-chart").count();
    if (!preview) fail(`${vp} landing: live preview chart did not render`);
    report(`${vp} landing (hero ×5, sections, no Supabase/Pyodide)`, errors);
    await ctx.close();
  },

  async routes(browser, vp) {
    const { ctx, page, errors } = await newPage(browser, vp);
    const routes = [
      ["guide", "#/guide", ".guide-step"],
      ["app", "#/app", ".ws-quick"],
      ["app-aeros", "#/app/aeros", ".ws-bench > *"],
      ["app-nexus", "#/app/nexus", ".ws-bench > *"],
      ["app-core", "#/app/core", ".ws-bench > *"],
      ["app-catalyst", "#/app/catalyst", ".ws-bench > *"],
      ["app-datasets", "#/app/datasets", ".ws-bench > *"],
      ["app-projects", "#/app/projects", "[data-testid=projects-signed-out], [data-testid=projects-page]"],
      ["app-account", "#/app/account", "[data-testid=account-signed-out], [data-testid=account-page]"],
      ["styleguide", "#/styleguide", ".sol-chart"],
      ["dev-runtime", "#/dev/runtime", "h1, h2"],
    ];
    for (const [name, hash, sel] of routes) {
      await page.goto(`${base}${hash}`, { waitUntil: "load" });
      try {
        await page.waitForSelector(sel, { timeout: 15000 });
      } catch {
        fail(`${vp} ${hash}: "${sel}" did not render`);
      }
      await page.waitForTimeout(name.startsWith("app-") ? 1500 : 600);
      const stub = await page.locator(".ws-bench").textContent().catch(() => "");
      if (stub && /loading workbench…/.test(stub)) notes.push(`${vp} ${hash}: workbench is still a stub`);
      await page.screenshot({ path: shot(`${vp}-${name}`), fullPage: name === "guide" && vp === "desktop" });
      await noOverflow(page, `${vp} ${hash}`);
    }
    // Header navigation from the landing page.
    await page.goto(base, { waitUntil: "load" });
    if (vp === "desktop") {
      await page.getByRole("link", { name: "Guide" }).first().click();
      await page.waitForSelector(".guide-step");
      await page.getByRole("link", { name: "Workspace" }).first().click();
      await page.waitForSelector(".ws-quick");
      ok(`${vp} header navigation landing → guide → workspace`);
    } else {
      await page.goto(`${base}#/app`, { waitUntil: "load" });
      await page.waitForSelector(".ws-tabs");
      await page.locator(".ws-tabs").getByText("Models").click();
      await page.waitForSelector(".ws-switch");
      await page.locator(".ws-tabs").getByText("Projects").click();
      await page.waitForSelector("[data-testid=projects-signed-out]");
      ok(`${vp} bottom tab bar navigation`);
    }
    report(`${vp} routes (${routes.length})`, errors);
    await ctx.close();
  },

  async demo(browser, vp) {
    const { ctx, page, errors } = await newPage(browser, vp);
    await page.goto(`${base}demo/`, { waitUntil: "load" });
    await heroReady(page);
    await page.screenshot({ path: shot(`${vp}-demo-hero`) });
    const ids = ["findings", "aeros", "nexus", "core", "catalyst", "data", "open", "team"];
    for (const id of ids) if (!(await page.locator(`section#${id}`).count())) fail(`${vp} demo: section #${id} missing`);
    const mountedAtTop = await page.locator('[data-mounted="true"]').count();
    for (const id of ids) {
      await scrollToSel(page, `#${id}`, id === "open" ? 900 : 1600);
      await page.screenshot({ path: shot(`${vp}-demo-${id}`) });
    }
    const mounted = await page.locator('[data-mounted="true"]').count();
    if (mounted < 5) fail(`${vp} demo: only ${mounted} lazy sections mounted after scrolling`);
    notes.push(`${vp} demo lazy mounts: ${mountedAtTop} at top → ${mounted} after scrolling`);

    // QR: rasterise the SVG in the page, decode in Node with jsQR.
    const qr = await page.evaluate(async () => {
      const svg = document.querySelector("svg.site-qr");
      if (!svg) return null;
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
      await img.decode();
      const size = 600;
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, size, size);
      g.drawImage(img, 0, 0, size, size);
      const d = g.getImageData(0, 0, size, size);
      return { w: size, h: size, data: Array.from(d.data), attr: svg.getAttribute("data-qr-text"), shown: document.querySelector("[data-testid=qr-url]")?.textContent, box: svg.getBoundingClientRect().width };
    });
    if (!qr) fail(`${vp} demo: QR svg missing`);
    else {
      const decoded = jsQR(Uint8ClampedArray.from(qr.data), qr.w, qr.h);
      if (!decoded) fail(`${vp} demo: QR could not be decoded`);
      else if (decoded.data !== qr.attr) fail(`${vp} demo: QR decodes to ${decoded.data}, expected ${qr.attr}`);
      else if (EXPECTED_QR && decoded.data !== EXPECTED_QR) fail(`${vp} demo: QR ${decoded.data} ≠ VITE_PUBLIC_SITE_URL ${EXPECTED_QR}`);
      else ok(`${vp} demo QR decodes to ${decoded.data} (rendered ${Math.round(qr.box)} px wide; label "${qr.shown}")`);
    }
    await noOverflow(page, `${vp} demo`);

    if (vp === "desktop") {
      // Sticky nav jump + presenter mode.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      await page.locator(".demo-nav__link", { hasText: "CORe" }).click();
      await page.waitForTimeout(1500);
      const coreTop = await page.evaluate(() => document.getElementById("core").getBoundingClientRect().top);
      if (Math.abs(coreTop) > 120) fail(`demo nav: CORe section not scrolled into view (top ${Math.round(coreTop)})`);
      await page.keyboard.press("p");
      await page.waitForTimeout(300);
      if (await page.locator(".demo-nav").count()) fail("demo: P did not enter presenter mode");
      await page.keyboard.press("p");
      await page.waitForTimeout(200);
      await page.goto(`${base}demo/?kiosk=1`, { waitUntil: "load" });
      await heroReady(page);
      if (await page.locator(".demo-nav").count()) fail("demo ?kiosk=1: nav still visible");
      await scrollToSel(page, "#open", 1000);
      await page.screenshot({ path: shot(`desktop-demo-kiosk-qr`) });
      ok("demo sticky nav + presenter mode (P, ?kiosk=1)");
    }
    report(`${vp} demo (sections, lazy workbenches)`, errors);
    await ctx.close();
  },

  async auth(browser, vp) {
    if (vp !== "desktop") return;
    const { ctx, page, errors } = await newPage(browser, vp, { allowHosts: ["supabase.co"] });
    await page.goto(`${base}#/app/projects`, { waitUntil: "load" });
    await page.waitForSelector("[data-testid=projects-signed-out]");
    await page.getByTestId("sign-in-button").first().click();
    await page.waitForSelector('dialog[open] [data-testid="auth-dialog"]');
    // Client-side validation.
    await page.locator('dialog[open] button[type="submit"]').click();
    await page.waitForTimeout(200);
    const invalid = await page.locator('dialog[open] [aria-invalid="true"]').count();
    if (invalid < 2) fail(`auth: empty sign-in should flag email + password (flagged ${invalid})`);
    await page.locator("dialog[open]").getByRole("radio", { name: "Create account" }).click().catch(async () => {
      await page.locator("dialog[open]").getByText("Create account", { exact: true }).first().click();
    });
    await page.waitForTimeout(200);
    await page.locator("dialog[open]").getByLabel("Email").fill("not-an-email");
    await page.locator("dialog[open]").getByLabel("Password", { exact: true }).fill("short");
    await page.locator('dialog[open] button[type="submit"]').click();
    await page.waitForTimeout(200);
    const msgs = await page.locator("dialog[open] .site-field__error").allTextContents();
    if (msgs.length < 2) fail(`auth: sign-up validation messages missing (${msgs.join(" | ")})`);
    await page.screenshot({ path: shot("desktop-auth-validation") });
    // Wrong password → friendly message from Supabase.
    await page.locator("dialog[open]").getByText("Sign in", { exact: true }).first().click();
    await page.waitForTimeout(200);
    await page.locator("dialog[open]").getByLabel("Email").fill(`solaris-smoke-nobody-${Date.now()}@example.com`);
    await page.locator("dialog[open]").getByLabel("Password", { exact: true }).fill(`x${randomBytes(9).toString("hex")}1`);
    await page.locator('dialog[open] button[type="submit"]').click();
    await page.waitForSelector("dialog[open] .site-form__error", { timeout: 20000 }).catch(() => {});
    const wrong = (await page.locator("dialog[open] .site-form__error").textContent().catch(() => "")) ?? "";
    notes.push(`auth wrong-password message: ${wrong}`);
    if (!wrong) fail("auth: no error shown for a wrong password");
    else ok(`auth wrong password → “${wrong.trim()}”`);
    await page.screenshot({ path: shot("desktop-auth-wrong-password") });

    if (flag("auth-live")) {
      const email = `solaris-smoke-${Date.now()}@example.com`;
      const password = `Sm0ke-${randomBytes(12).toString("base64url")}`; // never printed
      await page.locator("dialog[open]").getByText("Create account", { exact: true }).first().click();
      await page.waitForTimeout(200);
      await page.locator("dialog[open]").getByLabel("Name").fill("Smoke Test");
      await page.locator("dialog[open]").getByLabel("Email").fill(email);
      await page.locator("dialog[open]").getByLabel("Password", { exact: true }).fill(password);
      await page.locator('dialog[open] button[type="submit"]').click();
      await page.waitForFunction(
        () => document.querySelector("[data-testid=auth-check-inbox]") || document.querySelector("dialog[open] .site-form__error") || !document.querySelector("dialog[open] [data-testid=auth-dialog]"),
        null,
        { timeout: 30000 },
      );
      await page.waitForTimeout(800);
      await page.screenshot({ path: shot("desktop-auth-signup-result") });
      const inbox = await page.locator("[data-testid=auth-check-inbox]").count();
      const err = (await page.locator("dialog[open] .site-form__error").textContent().catch(() => null)) ?? null;
      const signedIn = !inbox && !err;
      notes.push(`auth live sign-up (${email}): ${inbox ? "confirmation required (check-inbox UI shown)" : err ? `error: ${err}` : "session returned immediately"}`);
      console.log(`  · live sign-up: ${notes[notes.length - 1]}`);
      if (signedIn) {
        await page.waitForSelector("[data-testid=projects-page]", { timeout: 20000 });
        // Data layer round trip through the UI.
        await page.getByLabel("New project").fill("Smoke project");
        await page.getByRole("button", { name: "Create" }).click();
        await page.waitForSelector(".ws-proj:not(.is-pending) .ws-proj__name:has-text('Smoke project')", { timeout: 20000 });
        ok("auth live: project created");
        if (isDev) {
          const r = await page.evaluate(async () => {
            const db = await import("/src/lib/data.ts");
            const projects = await db.listProjects();
            const saved = await db.saveRun({ model: "aeros", label: "Smoke run", payload: { station_id: "USW00013743", options: {} }, result: { ok: true, sample_paths: [[1, 2, 3]], value: 1 } }, projects[0].id);
            const full = await db.getRun(saved.id);
            await db.updateRun(saved.id, { label: "Smoke run (renamed)" });
            const exported = await db.exportRuns(projects[0].id);
            await db.renameProject(projects[0].id, "Smoke project 2");
            const prof = await db.updateProfile({ display_name: "Smoke Test", organization: "Example", role: "Student" });
            const wiped = await db.deleteAllMyData();
            const after = await db.listRuns();
            return { stripped: !("sample_paths" in full.result), exported: exported.length, prof: prof.display_name, wiped, after: after.length };
          });
          notes.push(`auth live data layer: ${JSON.stringify(r)}`);
          if (!r.stripped || r.exported !== 1 || r.after !== 0) fail(`auth live data layer unexpected: ${JSON.stringify(r)}`);
          else ok(`auth live data layer: save/get/update/export/rename/profile/delete-all ${JSON.stringify(r)}`);
        }
        await page.goto(`${base}#/app/account`, { waitUntil: "load" });
        await page.waitForSelector("[data-testid=account-page]", { timeout: 15000 });
        await page.screenshot({ path: shot("desktop-account-signed-in") });
        await page.getByTestId("sign-out").click();
        await page.waitForSelector("[data-testid=account-signed-out]", { timeout: 15000 });
        ok("auth live: sign out");
      } else if (inbox) {
        // Signing in before confirming must show the friendly "confirm your email" message.
        await page.locator("dialog[open]").getByRole("button", { name: "Keep exploring" }).click();
        await page.getByTestId("sign-in-button").first().click();
        await page.locator("dialog[open]").getByLabel("Email").fill(email);
        await page.locator("dialog[open]").getByLabel("Password", { exact: true }).fill(password);
        await page.locator('dialog[open] button[type="submit"]').click();
        await page.waitForSelector("dialog[open] .site-form__error", { timeout: 20000 }).catch(() => {});
        const m = (await page.locator("dialog[open] .site-form__error").textContent().catch(() => "")) ?? "";
        notes.push(`auth live sign-in before confirming: ${m}`);
        ok(`auth live: unconfirmed sign-in → “${m.trim()}”`);
        await page.screenshot({ path: shot("desktop-auth-unconfirmed") });
      }
    }
    report("desktop auth flows", errors);
    await ctx.close();
  },

  async reduced(browser, vp) {
    if (vp !== "desktop") return;
    const { ctx, page, errors } = await newPage(browser, vp, { reducedMotion: "reduce" });
    await page.goto(base, { waitUntil: "load" });
    await heroReady(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("reduced-motion-landing"), fullPage: true });
    report("reduced-motion landing", errors);
    await ctx.close();
  },
};

const browser = await chromium.launch();
try {
  for (const vp of Object.keys(VIEWPORTS)) {
    console.log(`[smoke-site] ${vp}`);
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
  staticServer?.close();
}

console.log(`\n[smoke-site] screenshots in ${OUT} (site-*.png)`);
notes.forEach((n) => console.log(`[smoke-site] ${n}`));
if (failures.length) {
  console.error(`[smoke-site] ${failures.length} failure(s)`);
  process.exit(1);
}
console.log("[smoke-site] all checks passed");
process.exit(0);
