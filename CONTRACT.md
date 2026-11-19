# Solaris summit build — shared contract

Deadline: climate summit presentation tomorrow, with a funding opportunity. Everything must
actually work, be honest about what it is, and look excellent.

## What we are building

One repo (`/Users/yugpatel/Desktop/Solaris/solaris-summit`), statically hostable, no server:

- `models/solaris_models/` — Python package, the single source of truth for the science.
  Runs in CPython (tests, precompute) **and in the browser via Pyodide**.
- `data/` — bundled real datasets with provenance (NASA GISTEMP station series, NOAA/RCMIP CO2,
  SSP pathways) and `data/precomputed/` model results for every bundled station.
- `web/` — Vite + React + TypeScript. Two entry points from one codebase:
  - `/demo/` — one-page, no-sign-in summit demo (kiosk + QR code to the full site).
  - `/` — the full Solaris platform (landing with scroll-driven Earth, sign-in, workspace).
- `reference/` — read-only inputs: notebook cells (`notebook_cells/cellNN.py` + outputs),
  poster (`poster.png`), knowledge base, golden fixtures, pieces of the previous website.

## Models

| Model | Role | Status |
|---|---|---|
| Aeros 4.0 | Seasonal (DJF/JJA) station surface-air-temperature ensemble forecast to 2100 with bootstrap 2.5–97.5% bounds | Port of notebook cell01+cell02, behaviour preserved |
| CORe 4.0 | Global CO2 historical-continuation projection to 2100, log forcing, simple temperature response | Port of notebook cell07+cell08 |
| Catalyst 1.0 | What-if scenario engine on top of CORe physics (SSP pathways, custom emissions edits, ECS/heat capacity) | New |
| Nexus 1.0 | Validation + context layer: strict hindcast audit of Aeros, historical trend statistics (1940–1979 vs 1980–2026), cited evidence registry | New |

## Python ↔ browser interface

`solaris_models/api.py` exposes pure functions taking and returning JSON-serialisable dicts
(plain floats/ints/str/lists, NaN → None):

```python
run_aeros(payload: dict) -> dict
run_core(payload: dict) -> dict
run_catalyst(payload: dict) -> dict
run_nexus(payload: dict) -> dict
dispatch(model: str, payload: dict) -> dict   # model in {"aeros","core","catalyst","nexus"}
```

Every result dict includes: `model`, `version`, `inputs` (echo of effective config),
`warnings: list[str]`, `provenance` (data sources + method notes), `runtime_ms`.
Exact payload/result schemas are documented by each model owner in `models/API.md`
(one section per model, with a real example). The frontend reads that file.

Constraints so it runs in Pyodide: dependencies limited to numpy + scipy (+ scikit-learn /
pandas only if truly needed — prefer not; every extra package slows first load on a phone).
No network access, no file I/O, no matplotlib, no threads/multiprocessing inside the package.
All data comes in through the payload. Deterministic for a given seed.
Target: a single Aeros run (one station, both seasons) under ~10 s in CPython.

## Honesty rules (non-negotiable — scientists and funders will read this)

- Do not invent metrics, validations, endorsements, or affiliations. Numbers shown on the
  site must come from the poster, the notebook outputs, or code we actually run.
- Projections are "conditional model outputs", not verified predictions. Say so, briefly.
- No "NASA-approved/validated" language. Data is *from* NASA GISS / NOAA GML / RCMIP.
- New models (Catalyst, Nexus) are labelled as new/v1.0 and "simplified" where they are.
- Prefer "machine learning" and "research" over hype-y "AI" wording.

## People (from the poster)

Jeff Minsona Leba, Yug Patel (Academy of Health Sciences at Prince George's Community College);
mentor Kurt Lienau (William S. Schmidt Outdoor Education Center). Yug: technical/coding lead.
Jeff: research/scientific framing.

## Key poster facts (may be quoted on the site)

- 40 urban and rural study locations across the United States and Argentina; DJF and JJA,
  hemisphere-adjusted; trends compared 1940–1979 vs 1980–2026.
- Mean trend increase between periods: +0.189 °C/decade winter (95% CI 0.085–0.294, p=0.0007),
  +0.211 °C/decade summer (95% CI 0.132–0.290, p<0.001). 29 of 40 stations increased in winter,
  34 of 40 in summer.
- 1980–2026 mean warming: U.S. 0.225 (winter) / 0.280 (summer) °C/decade; Argentina 0.156 / 0.230.
- Aeros 4.0, Washington D.C. case: 9.00 °C winter and 30.21 °C summer by 2100.
- CORe 4.0: 620.86 ppm CO2 by 2100 (bounds 560.53–681.18 ppm), historical-continuation pathway,
  not an IPCC emissions scenario.

## Phase 2 — feature seam (models, data and web foundation are done)

Read first: `web/README.md` (foundation, runtime API, charts, conventions), `models/API.md`
(exact payload/result shapes), `models/NOTES.md` (parity, validation tables, candid limitations),
`data/README.md`, `data/co2/README.md`. Precomputed results exist in `data/precomputed/`
(`aeros/<id>.json`, `nexus/<id>.json`, `nexus/station_set_americas.json`, `core/default.json`,
`catalyst/validation.json`, `catalyst/concentration_<ssp>.json`, `index.json`) and are copied to
`web/public/data/precomputed/` by `npm run sync` scripts.

Two agents work in `web/src` at the same time. Ownership:

- **Workbench agent** owns `web/src/features/models/**` only. Public surface in
  `web/src/features/models/index.ts` (create this file with typed stubs FIRST, within minutes):

  ```ts
  export type SavedRun = { model: 'aeros'|'core'|'catalyst'|'nexus'; label: string;
                           modelVersion?: string; payload: unknown; result: unknown };
  export type WorkbenchProps = {
    compact?: boolean;                         // tighter layout for the one-page demo
    initialRun?: SavedRun;                     // restore a saved run (show result without re-running)
    onRunComplete?: (run: SavedRun) => void;   // fired after each successful run (payload without bulky data bundles)
    onSaveRequest?: (run: SavedRun) => void;   // if provided, show a "Save to project" button
  };
  export function AerosWorkbench(p: WorkbenchProps & { initialStationId?: string }): JSX.Element;
  export function NexusWorkbench(p: WorkbenchProps & { initialStationId?: string }): JSX.Element;
  export function CoreWorkbench(p: WorkbenchProps): JSX.Element;
  export function CatalystWorkbench(p: WorkbenchProps): JSX.Element;
  export function DatasetLibrary(p: { compact?: boolean }): JSX.Element;   // browse/download bundled stations + template
  export function RuntimeStatusPill(): JSX.Element;                        // "Python ready / loading…" indicator
  export const MODEL_INFO: Record<'aeros'|'core'|'catalyst'|'nexus',
    { name: string; version: string; tagline: string; status: 'ported'|'new'; summary: string }>;
  ```

- **Site agent** owns everything else under `web/src/apps/**`, `web/src/features/site/**`,
  `web/src/features/auth/**`, `web/src/lib/**`: landing page, story content, team dialog,
  how-to, sign-in, dashboard, projects and saved runs (Supabase), and the composition of the
  one-page demo. It imports the workbenches only through `features/models/index.ts`.

Shared foundation files (`src/components/**`, `src/styles/**`, `src/runtime/**`, `src/data/**`,
`scripts/**`, `package.json`): fix real bugs if you must, keep changes minimal and additive, and
say so in your report. Run `npm install <pkg>` one at a time and re-read `package.json` before
editing it — the other agent may have changed it.

Supabase (public values, already in `web/.env`): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`. Tables `profiles`, `projects`, `runs` with owner-only RLS — see
`supabase/schema.sql`. Public site URL for the QR code: env `VITE_PUBLIC_SITE_URL`, default
`https://eireijie.github.io/solaris/` (GitHub Pages project site → the build must work under the
`/solaris/` sub-path; the foundation's relative `base` already handles this).

Wording for the bundled stations: "Solaris sample station set — NOAA GHCN-M v4 (adjusted),
the station record NASA GISTEMP is built on". Not "NASA GISTEMP station data". Sample-set
statistics are ours; poster statistics are the poster's — never mix them in one figure without labels.
