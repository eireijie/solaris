#!/usr/bin/env node
/**
 * Copy bundled datasets produced under ../data into public/ so the static site can
 * fetch them. Everything is optional — missing files are skipped with a note.
 *
 *   ../data/stations/stations_bundle.json   → public/data/stations_bundle.json
 *   ../data/co2/co2_bundle.json             → public/data/co2_bundle.json
 *   ../data/{,stations/,co2/,downloads/}*.zip|*.csv → public/data/downloads/
 *   ../data/stations/csv/*.csv              → public/data/stations-csv/
 *   ../data/precomputed/**                  → public/precomputed/**
 *
 * Also writes public/data/available.json describing what was found, so the UI can
 * hide download links for files that don't exist.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const DATA = resolve(web, "../data");
const OUT_DATA = join(web, "public/data");
const OUT_PRE = join(web, "public/precomputed");

rmSync(OUT_DATA, { recursive: true, force: true });
rmSync(OUT_PRE, { recursive: true, force: true });
mkdirSync(OUT_DATA, { recursive: true });

const available = { generated: new Date().toISOString(), bundles: {}, downloads: [], precomputed: {}, stationCsvDir: null };

const bundles = {
  stations: "stations/stations_bundle.json",
  co2: "co2/co2_bundle.json",
};
for (const [key, rel] of Object.entries(bundles)) {
  const src = join(DATA, rel);
  if (existsSync(src)) {
    const name = rel.split("/").pop();
    cpSync(src, join(OUT_DATA, name));
    available.bundles[key] = { path: `data/${name}`, bytes: statSync(src).size };
    console.log(`[sync-data] ${rel} (${(statSync(src).size / 1024).toFixed(0)} KB)`);
  } else {
    console.warn(`[sync-data] missing ../data/${rel} — skipped`);
  }
}

// Downloadable zip + CSVs (top level of data/, data/stations, data/co2, data/downloads).
const dlDirs = ["", "stations", "co2", "downloads"].map((d) => join(DATA, d)).filter((d) => existsSync(d));
const OUT_DL = join(OUT_DATA, "downloads");
for (const dir of dlDirs) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!statSync(p).isFile() || !/\.(zip|csv)$/i.test(name)) continue;
    mkdirSync(OUT_DL, { recursive: true });
    cpSync(p, join(OUT_DL, name));
    available.downloads.push({ name, path: `data/downloads/${name}`, bytes: statSync(p).size });
  }
}
if (available.downloads.length) console.log(`[sync-data] ${available.downloads.length} download file(s)`);

// Per-station CSVs (Aeros input format) for "download this station" links.
const STATION_CSV = join(DATA, "stations/csv");
if (existsSync(STATION_CSV)) {
  cpSync(STATION_CSV, join(OUT_DATA, "stations-csv"), { recursive: true });
  available.stationCsvDir = "data/stations-csv/";
  console.log(`[sync-data] ${readdirSync(STATION_CSV).length} per-station CSV(s) → data/stations-csv/`);
}

const PRE = join(DATA, "precomputed");
if (existsSync(PRE)) {
  cpSync(PRE, OUT_PRE, { recursive: true });
  for (const model of readdirSync(OUT_PRE)) {
    const d = join(OUT_PRE, model);
    if (statSync(d).isDirectory()) available.precomputed[model] = readdirSync(d).filter((n) => n.endsWith(".json")).length;
  }
  console.log(`[sync-data] precomputed: ${JSON.stringify(available.precomputed)}`);
} else {
  console.warn("[sync-data] ../data/precomputed not found — skipped");
}

writeFileSync(join(OUT_DATA, "available.json"), JSON.stringify(available, null, 2) + "\n");
