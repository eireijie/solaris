# Solaris models — implementation notes

Sections are owned per model; edit only your own.

## Aeros / Nexus

Files: `solaris_models/aeros.py` (science), `solaris_models/aeros_io.py` (payload/JSON),
`solaris_models/nexus.py`, the Aeros/Nexus section of `solaris_models/api.py`,
`tools/notebook_reference.py` (dev only: runs the original notebook code headless),
`tests/test_aeros.py`, `tests/test_nexus.py`, `tests/fixtures/notebook_ref_*.json`.
Runtime dependencies: numpy + scipy only. Verified to import and run in Pyodide 0.29.5
(Python 3.13.2, numpy 2.2.5, scipy 1.14.1) under Node.

### What was ported, and how

The notebook's recorded run (cell02 output) used `fast_mode=True`: 200 bootstrap paths, no GP,
no Prophet, no GARCH, no emcee, and it printed `Residual simulator: AR1`. That is the path that
was ported and is the default.

Ported verbatim (same logic, same order of random draws, same constants):
`stable_int_seed`, `infer_unit_scale`, sentinel handling in `preprocess_city`,
`impute_missing_years_pchip`, the four members `poly2`, `pchip`, `ridge`, `lin_modern` (dict
order kept), `decadal_hindcast_predictions` (validation year `min(2014, last−10)`, at least 1960),
`solve_stacking_weights` (SLSQP, inverse-RMSE fallback), `choose_block_size`,
`block_bootstrap_residuals`, `sanitize_prediction` (2 °C/decade), `bootstrap_iteration`
(re-anchoring to the quadratic trend, AR(1) residual path), per-path seeds from
`SeedSequence(42 + stable_int_seed(city, season)).spawn(N)`, nanmean / 2.5–97.5 percentiles,
`slope_summary`, the 1940–1979 / 1980–latest / future / instantaneous-2100 / acceleration
slopes, the city-level `hist_end_year`, the `MIN_YEARS=10` skip rule, the data-quality outlier
rule, and the rolling-CV diagnostic (`do_rolling_cv_diagnostics=True`; it never changes the
forecast).

Re-implemented without sklearn/statsmodels/pandas:

| notebook | port | difference measured |
|---|---|---|
| `RidgeCV(alphas=[.01,.1,1], cv=TimeSeriesSplit(3))` | closed-form Cholesky ridge, same CV split, R² scoring, tie and NaN rules | identical to 0.0 on the tested series (also unit-tested against sklearn, rtol 1e-9) |
| `LinearRegression` | centred `scipy.linalg.lstsq` | ~1e-12 |
| statsmodels `ARIMA(1,0,0, enforce_stationarity=False)` (Kalman MLE, approximate-diffuse start) | conditional least squares (the same estimator up to the diffuse prior) | φ, const, innovation sd differ by ~1e-5; this is the only source of port–notebook differences |
| statsmodels `acf`, `mad` | numpy | exact |
| joblib/dask parallel loop | plain loop (each path has its own seed, so the result is identical) | none |

Not ported (all inactive in the recorded run): GP, Prophet, GARCH(1,1) + parameter draws, emcee,
threshold / anomaly / spectral / regime / AIC-BIC diagnostics (their `do_*` flags were False),
plots, PDF, CSV/SQLite export, Colab upload. Quirks preserved on purpose for parity are listed
under the suggestions below.

Additions that do not change any Aeros number: per-member hindcast errors, sanity-filter pass
rates, `summary_end.mc_standard_error_of_mean`, data-quality fields, hemisphere labels,
`train_end_year` truncation (used by Nexus), `sample_paths`, and a `fast` mode (100 paths).

### Parity results (actual numbers)

The original notebook code was run headless (`tools/notebook_reference.py`: numpy 2.5.5,
scipy 1.18.1, pandas 3.1.1, scikit-learn 1.9.1, statsmodels 0.15.0) and compared with the port
on identical input and seed label:

| series | max abs difference, all years (mean / lower / upper) | 2100 notebook → port |
|---|---|---|
| Rajkot D-J-F (golden series, label `IN005150100`) | 5.2e-6 / 1.3e-5 / 1.1e-5 °C | 24.394845 [22.607759, 26.388179] → 24.394850 [22.607763, 26.388182] |
| Washington Reagan bundle, D-J-F (label `USW00013743`) | 3.2e-5 / 3.5e-5 / 3.4e-5 °C | 9.722586 [6.571327, 12.779834] → 9.722616 [6.571358, 12.779865] |
| Washington Reagan bundle, J-J-A | 4.7e-6 / 1.3e-5 / 1.0e-5 °C | 30.752310 [28.300434, 33.035515] → 30.752314 [28.300435, 33.035517] |

Slopes agree to < 1e-6 °C/decade. In Pyodide (scipy 1.14.1, whose SLSQP is the older Fortran
version) the maximum difference against the notebook is 3.3e-5 °C. These comparisons are pytest
cases (tolerance 2e-4 °C).

**Golden fixture (Rajkot D-J-F 2100: 24.398529 [22.603167, 26.239206]) — not reproduced exactly.**
`parity_check.py` calls `app.worker_aeros.run`, which is not in `reference/`. With 200 paths and
seed 42, the only unknown is the label that the previous service passed to `stable_int_seed`. I
tried about 130 label and season variants (`Rajkot`, `IN005150100`, `rajkot`, `RAJKOT`,
`Rajkot, India`, id+name combinations, `DJF`/`winter` season strings, empty label, and others).
None matched; the closest was 24.398875. Imputation does match exactly: blanking 1985
reproduces the fixture's 21.022618. Statistically, the golden numbers are a typical draw from
the same method. Over 200 seed labels the notebook method gives 2100 mean 24.381 ± 0.070,
lower 22.483 ± 0.191 and upper 26.274 ± 0.170. The golden values sit at z = +0.25, +0.63 and
−0.21. The site's default (label = station id `IN005150100`) gives
24.394850 [22.607763, 26.388182]: the mean is 0.004 °C from golden, the upper bound 0.15 °C.
So golden parity is **approximate (statistical), not exact**. Exact parity with the canonical
notebook code is demonstrated directly instead (table above).

### Runtimes (measured on this Mac, Apple M2)

| run | time |
|---|---|
| original notebook code, Washington, both seasons, 200 paths (sequential, headless) | 2.8 s |
| port, CPython 3.12, same run | 0.30 s (`fast`: 0.17 s) |
| port, Pyodide 0.29.5 in Node, same run | 0.59 s (`fast`: 0.32 s); Pyodide + numpy + scipy load 3.2 s |
| Nexus single station default (hindcast + baseline), CPython / Pyodide | 0.59 s / 1.1 s |
| Nexus with rolling origin (4 cutoffs × 100 paths), CPython | 1.2 s |
| Nexus station set, 40 stations, CPython | 0.04 s |
| Aeros for all 45 bundled stations, CPython | 13.8 s (all ran successfully) |

Phone timings were not measured.

### Washington, D.C. vs the poster (9.00 °C winter / 30.21 °C summer, 2100)

The poster used the team's own uploaded CSV (1938–2026, label `Washington, D.C.`, J-J-A ending
2025). That file is not in the repo. Its first values (cell03 output: 1938 D-J-F 3.38, 1939 4.12,
…) run about 0.17 °C above GHCN-M v4 adjusted values for the same years, so it is probably GISS's
own station product.

| input | D-J-F 2100 mean [95%] | J-J-A 2100 mean [95%] | D-J-F hist / modern / future slope | J-J-A hist / modern / future slope |
|---|---|---|---|---|
| poster / notebook output | 9.00 | 30.21 | −0.340 / +0.483 / +0.553 | −0.048 / +0.349 / +0.480 |
| GHCN-M v4 from 1938, GISS-like 2-of-3-month seasons, J-J-A 2026 dropped, label `Washington, D.C.` (closest reconstruction; scratch only) | 9.12 [5.70, 12.70] | 30.29 [28.33, 32.13] | −0.326 / +0.509 / +0.578 | −0.034 / +0.374 / +0.503 |
| site bundle `USW00013743` (1940–2026, all 3 months required), default label = id | 9.72 [6.57, 12.78] | 30.75 [28.30, 33.04] | −0.326 / +0.510 / +0.650 | −0.034 / +0.380 / +0.564 |
| same bundle, label `Washington, D.C.` | 10.21 [6.77, 13.94] | 30.75 [28.64, 32.75] | | |

The closest reconstruction is within 0.12 °C and 0.08 °C of the poster. Seed-label noise alone
is ±0.15 °C and ±0.06 °C (see below), and the input data differ. The bundled series gives
higher values because it starts in 1940 instead of 1938, uses a stricter seasonal-mean rule
(1998–1999 are imputed), includes summer 2026, and has a different seed label. The site should
show the bundle's numbers as the bundle's numbers. It should not present them as a
reproduction of 9.00 / 30.21.

### Nexus 1.0 (new, simplified) — Washington results on the bundle

Hindcast trained on years up to 2000 and scored on 2001–2026 (200 paths; error = predicted −
observed). D-J-F: MAE 1.55, RMSE 1.90, bias +1.17 °C (too warm, more than 2 SE), slope error
−0.10 °C/decade, coverage 88 %, direction accuracy 65 %. Skill vs last-30-year climatology is
0.13 and vs a linear trend 0.10. J-J-A: MAE 0.64, RMSE 0.79, bias −0.19 °C, slope error
−0.35 °C/decade, coverage 96 %, skill 0.67 / 0.41. Rolling origin (cutoffs 1980/1990/2000/2010,
10-year horizon, 100 paths): D-J-F mean RMSE 1.68 against baselines 1.65 / 1.74, coverage
95 %. J-J-A: 0.89 against 1.05 / 0.94, coverage 79 %. In plain terms, Aeros is about as good as
naive baselines in winter and somewhat better in summer, and its summer intervals are too
narrow at decade horizons. The 40-station Americas sample (not the poster's stations) gives a
hemisphere-adjusted winter change of +0.40 °C/decade (95 % CI 0.26–0.54, 31/40 increased) and a
summer change of +0.29 (0.23–0.35, 38/40). This matches `data/stations/sanity_report.json`.

### Scientific suggestions for the team (defaults unchanged)

1. **Monte-Carlo noise is as large as the precision quoted.** With 200 paths, re-seeding moves
   Washington's 2100 winter mean by ±0.15 °C (bounds ±0.36 °C). With 1000 paths that falls to
   ±0.05 °C. Quote "≈ 9 °C", or use ≥ 1000 paths (`options.n_bootstrap`) and report
   `mc_standard_error_of_mean`.
2. **Say what the interval is.** It is the 2.5–97.5 % range of a *single season's* value. It is
   dominated by interannual AR(1) noise (innovation sd ≈ 1.45 °C in Washington winters). It is
   not the uncertainty of the 2100 climate mean, and it has no structural or emissions-scenario
   component. Fix: also report a trend-only band (paths without the residual simulator) and
   label both.
3. **The ensemble is effectively one model.** `lin_modern` (OLS since 1980) gets 0.70–0.98 of the
   weight and ridge gets about 0. PCHIP *extrapolation* has a hindcast RMSE of about 180 °C and
   passes the sanity filter in 0 % of paths, yet SLSQP still gives it about 0.3 % weight. Drop
   PCHIP as a forecaster (keep it for imputation) and describe Aeros plainly as "1980-onward
   linear trend plus a quadratic component".
4. **The stacking weights measure the wrong skill.** The decadal folds start with 10–20 training
   years and score 10-year horizons. Folds stop at 2014, while the projection runs 75 years.
   Weight by rolling-origin skill with ≥ 30 training years at several horizons, or fix the
   weights a priori and validate them.
5. **"Acceleration" is mostly an artefact.** future − modern slope comes from the quadratic
   member's curvature and from the anchoring. Do not present it as a physical finding. Nexus
   shows slope errors of −0.04 to −0.35 °C/decade over 2001–2026.
6. **Projections are not conditioned on forcing.** A quadratic in calendar year extrapolated to
   2100 is not a climate projection. The standard upgrade is to regress station seasonal means
   on global mean temperature or forcing (pattern scaling), then drive them with CORe/Catalyst
   pathways. That makes Aeros scenario-conditional.
7. **Trend significance ignores autocorrelation.** Washington winter 1940–1979 residuals have
   lag-1 r = 0.42, so the effective n is 16 of 40 and the SE is ×1.6. Nexus reports
   `se_ar1_adjusted` next to the poster-style SE.
8. **The 40 stations are not independent.** Urban–rural pairs 44–150 km apart are strongly
   correlated, so the paired t-test across stations overstates n. Test pair differences, use a
   block or cluster bootstrap by pair or region, and report the Wilcoxon p (Nexus does). The
   1940–1979 vs 1980–present contrast is also sensitive to homogenisation (adjusted vs raw
   GHCN).
9. **Imputed years are used as data.** They enter trend fits, hindcast weights and slopes. Fit
   on observed years only and impute only for display. Nexus trend statistics already use
   observed values only (Washington modern winter slope 0.526 observed-only vs 0.510 in Aeros).
10. **Small code issues, preserved for parity:**
    - (a) The AR(1) recursion adds statsmodels' `const`, which is the process *mean*, as an
      intercept. It should be mean·(1−φ); the effect is negligible here because the mean is
      about 0.
    - (b) The outlier rule divides by 0.6745 twice, so it only flags points beyond about 7.7 raw
      MADs instead of the intended 5.2.
    - (c) `hist_end_year` is city-level. When summer lags (poster run: J-J-A ended 2025), the
      summer projection starts in 2027 and is anchored to the 2025 trend value. That is a
      2-year shift, about 0.07 °C.
    - (d) The bootstrap seed depends on the file name or station label, so the same data
      uploaded under another name gives a different answer within MC noise.
11. **Old validation numbers.** The previously recorded Dublin hindcast (bias +1.37 °C, sign
    convention unknown) cannot be reproduced from committed artefacts. Use Nexus outputs, which
    state the sign convention, instead.


---

## CORe / Catalyst

Files: `solaris_models/core.py`, `solaris_models/catalyst.py`, CORe/Catalyst section of `solaris_models/api.py`,
`tests/test_core.py`, `tests/test_catalyst.py`, `tools/core_notebook_reference.py`,
`tests/fixtures/core4_notebook_reference.json`; data in `data/co2/` (see its README).

### 1. CORe 4.0 port — what is verbatim and what changed

Verbatim (same maths, same constants, same order of operations): historical cleaning + interior
interpolation, `core4_growth_stats`, `core4_enforce_path`, all ten candidate models
(`linear_level`, `huber_linear_level`, `quadratic_ridge_level`, `cubic_ridge_level`, `log_linear_level`,
`growth_linear_ridge`, `recent_growth_median`, `recent_growth_ewma`, `recent_growth_soft_slowdown`,
`recent_growth_soft_accel`), the rolling-origin backtest, model selection (RMSE ≤ 1.35 × best; EWMA kept if
≤ 1.75 × best), weights `1/(RMSE + 0.25|bias| + 1e-6)^2`, the final constrained ensemble, the ensemble backtest
and conformal base error (90th percentile of |error|), the uncertainty envelope and its monotone clean-up,
`core4_co2_forcing` and `core4_temperature_response`. Defaults are the notebook's `USER SETTINGS`.

Changed (implementation only):
- pandas/scikit-learn replaced by numpy (+ scipy for one candidate). `Ridge`/`LinearRegression` → closed form
  with intercept centring (what scikit-learn solves). `HuberRegressor(epsilon=1.35, alpha=0.001, max_iter=500)` →
  the identical objective/gradient (`_huber_loss_and_gradient`) minimised with the same `scipy.optimize.minimize(
  method="L-BFGS-B", gtol=1e-5)` call; scipy is imported lazily, only for this candidate.
  Test `test_regressions_match_sklearn` checks coefficients against scikit-learn to 1e-6 (Huber) / 1e-8 (Ridge, OLS).
- No file/network/plotting. Historical data come in the payload. NOAA/MLO download fallbacks of the notebook
  are not ported (the browser passes `data/co2/co2_bundle.json → historical_co2`).
- Output names are snake_case; the hard-coded EWMA factor 1.75 is exposed as `ewma_keep_within_rmse_factor`
  (default unchanged). Optional `include_validation_points`.
- Not ported: cells 09/10 (seasonal per-city "shared atmospheric background" CO2 from the NOAA monthly cycle),
  which were marked low priority.

### 2. Parity

Reference run: the **original cell08 code** (only Colab/plot/install lines stripped; script
`tools/core_notebook_reference.py`) on `data/co2/historical_co2_1940_2025.csv` (cell07 recipe, NOAA release of
9 Oct 2026). Port vs original: **max |difference| = 0.0** for every 2026–2100 series (mean, lower, upper,
forcing, temperature, model spread) and every validation-table entry (one value differs by 1.8e-15). Tests use
1e-9.

| 2100 | port | notebook output (cell08.out.txt) | poster | earlier service (`reference/golden/parity_check.py`) |
|---|---|---|---|---|
| CO2 mean (ppm) | **620.855023** | 620.855023 | 620.86 | 621.146694 |
| lower / upper (ppm) | **560.533981 / 681.176065** | 560.533981 / 681.176065 | 560.53–681.18 | 560.726002 / 681.567387 |
| CO2 forcing (W/m²) | **4.292829** | 4.292829 | — | 4.295342 |
| temperature response (°C) | **3.368844** | 3.368844 | — | 3.370572 |
| conformal base error (ppm) | 4.590216 | 4.590216 | — | — |
| weights | 0.421413 / 0.428672 / 0.149915 | same | — | — |

**Which inputs give which number.** 620.86 comes from the NOAA global annual file as currently published
(2025 = 425.62 ppm; identical data to the notebook's own run, `cell07.out.txt`). 621.15 comes from an *older NOAA
release*. I reconstructed candidate vintages from the Wayback Machine (NOAA revises recent years by 0.01–0.02 ppm
per release, and the annual file only gained 2025 in 2026):

| input vintage (1979+ part; 1940–1978 RCMIP unchanged) | 2100 mean / lower / upper |
|---|---|
| NOAA annual, release 2026-10-09 (current, in repo) | 620.855 / 560.534 / 681.176 |
| NOAA annual, release 2026-09-05 (differs by 0.01 ppm in 1993, 2001, 2004, 2020) | 620.922 / 560.700 / 681.144 |
| NOAA annual release 2026-01-05 (ends 2024) + 2025 = mean of 12 months of the 2026-03-05 monthly file (425.6425) | 621.177 / 560.886 / 681.469 |
| all years annualised from the 2026-03-05 monthly file | 621.114 / 560.752 / 681.476 |
| target (earlier service) | 621.147 / 560.726 / 681.567 |

The exact file behind 621.146694 is not archived, so it is not reproduced bit-for-bit, but it is bracketed by
spring-2026 NOAA releases with 2025 ≈ 425.64 ppm. Conclusion: same code, different NOAA vintage. Note the
sensitivity: a 0.01 ppm revision of a few historical years moves the 2100 value by 0.07–0.3 ppm, because the
growth/acceleration clamps and model weights respond discretely. The repo pins the 2026-10-09 release.

### 3. Forcing and temperature — what CORe actually uses (quoted from cell08)

```python
PREINDUSTRIAL_CO2_PPM = 278.3
ECS_C = 3.0
HEAT_CAPACITY = 8.0
INITIAL_TEMP_ANOMALY_C = 1.2

def core4_co2_forcing(ppm, c0=PREINDUSTRIAL_CO2_PPM):
    return 5.35 * np.log(np.maximum(ppm, 1.0) / float(c0))

lam = 3.7 / max(float(ECS_C), 0.1)
...
temp += (float(f) - lam * temp) / cap      # one step per year, temp starts at INITIAL_TEMP_ANOMALY_C
```

- Forcing: the Myhre et al. (1998) simplified CO2 expression with C0 = 278.3 ppm. Doubling CO2 gives
  5.35 ln 2 = **3.708 W/m²** (the AR6 assessed 2×CO2 ERF is 3.93 W/m²). CO2 only.
- Response: a single heat reservoir, C = 8 W yr m⁻² K⁻¹ (≈ 60 m of ocean mixed layer averaged over the globe),
  feedback λ = 3.7/ECS = 1.233 W m⁻² K⁻¹, e-folding time C/λ ≈ 6.5 yr. Equilibrium for doubled CO2 is
  3.708/1.233 = 3.007 °C (the 3.7 vs 3.708 mismatch is negligible).
- Physically this is a fast mixed-layer response **with no deep ocean**, so it relaxes to equilibrium within a
  decade. It starts from 1.2 °C in 2025, while the CO2-only equilibrium for 2025 forcing (2.27 W/m²) is 1.84 °C,
  so the first projection years warm by 0.09, 0.08, 0.07 °C/yr (observed recent rate ≈ 0.02–0.03 °C/yr).
  In 2100 the value (3.37 °C) is 97% of the CO2-only equilibrium warming for 621 ppm (3.48 °C).
- **Comparability:** the 2100 number is not comparable to IPCC assessed warming. It (a) omits ocean heat
  uptake (too warm for a transient), (b) omits non-CO2 forcing (positive in most SSPs by 2100, too cool), and
  (c) has no defined baseline period for the 1.2 °C start. For context, Catalyst's two-layer model on the same
  CORe pathway gives 2.50 °C (CO2 only) and 2.88 °C (with SSP2-4.5 non-CO2 forcing) in 2100, and 1.66 / 1.96 °C
  in 2050 vs CORe's 2.28 °C. Label CORe's value "forcing response estimate", as the notebook does.

### 4. Catalyst 1.0 — design

- Concentration mode: pathway (RCMIP SSP, CORe pathway, or custom control points; optional point edits) →
  CORe forcing → temperature. Emissions shown are *implied* (carbon-cycle inversion).
- Emissions mode: baseline emissions (RCMIP SSP; "CORe-consistent" = emissions diagnosed by inverting the
  carbon cycle onto the CORe ppm path; or custom) + interventions (peak year, %/yr decline, target cut vs a
  reference year, net-zero year, CDR with ramp, explicit overrides; combined as min(baseline, caps), CDR
  subtracted) → carbon cycle → ppm → forcing → temperature.
- Carbon cycle (default `fair_v1`): 4-pool impulse response, Joos et al. 2013 multi-model mean coefficients
  (a = 0.2173, 0.2240, 0.2824, 0.2763; τ = ∞(10⁶), 394.4, 36.54, 4.304 yr), FaIR v1.x state-dependent
  time-constant scaling (Millar et al. 2017; Smith et al. 2018): iIRF100 = 35 + 0.019·C_uptake[GtC] + 4.165·T,
  capped at 97 yr; α solved by Newton each year. 2.124 GtC/ppm, 44.009/12.011 GtCO2/GtC, preindustrial
  277.147 ppm (RCMIP 1750). Annual-mean ppm = mean of consecutive year-end values. The temperature in the
  feedback term comes from an internal two-layer model (Geoffroy et al. 2013 CMIP5 mean C = 7.3,
  C_D = 106 W yr m⁻² K⁻¹, γ = 0.73 W m⁻² K⁻¹, λ = 3.708/ECS) with CO2 + the SSP's anthropogenic non-CO2 ERF.
  Option `joos2013`: fixed (present-day) impulse response.
- Temperature: default = CORe's own one-box response (so Catalyst ≡ CORe on the CORe pathway: tested to
  1e-12 in concentration mode). Option `two_layer`: same Geoffroy model, spun up from 1750 with historical CO2
  forcing (RCMIP to 1939 + the CORe input series) and, if enabled, non-CO2 ERF.
- Non-CO2 forcing: default off (CO2-only, stated in `assumptions`); option `scenario` adds RCMIP
  `ERF|Anthropogenic − ERF|Anthropogenic|CO2` of the SSP (SSP2-4.5 for CORe/custom pathways, configurable).
- Harmonisation (`anchor_to_observed`, default on): constant ppm offset so 2025 equals NOAA 425.62 ppm
  (−6.68 ppm for the carbon-cycle runs; −3.41 ppm for RCMIP SSP2-4.5 concentrations, which run above
  observations already in 2025). The offset is reported in `assumptions`.
- Uncertainty: deterministic re-runs at the AR6 ECS bounds (likely 2.5–4.0 °C, very likely 2.0–5.0 °C),
  including the ECS-dependence of the carbon-cycle feedback (`ppm_band`). No carbon-cycle-parameter,
  forcing or scenario uncertainty.
- Global→local: `local_scaling` (off by default) multiplies a station projection's change since the reference
  year by the ratio of scenario to baseline global warming since that year (blended to 1 while baseline
  warming < 0.1 °C). Flagged `illustrative: true` with an explicit assumption string.
- Known artefact: the CORe-consistent diagnosed emissions start 7.4 GtCO2/yr below the 2025 historical level
  (34.6 vs 42.1 GtCO2/yr) because this carbon cycle grows CO2 ~0.2 ppm/yr faster than observed over 2015–2025
  with SSP2-4.5 emissions; Catalyst emits a warning. CORe's pathway corresponds to roughly constant
  35–40 GtCO2/yr to 2100 in this model; its 2100 concentration (621 ppm) lies between RCMIP SSP2-4.5 (603) and
  SSP4-6.0 (668).
- SSP emissions are native only at 2015, 2020, 2030, …, 2100 and are linearly interpolated (RCMIP convention).

### 5. Carbon-cycle validation (the "how simplified is this" table)

ECS = 3 °C, each SSP's own non-CO2 forcing, no harmonisation. Reproduce with
`run_catalyst({"data": bundle, "mode": "validation"})`.

Historical (RCMIP historical emissions 1750–2014, SSP2-4.5 emissions 2015–2025):

| model | vs NOAA global 1979–2025: RMSE / bias / max / 2025 error (ppm) | vs RCMIP historical 1850–2014: RMSE / max / 2014 error (ppm) |
|---|---|---|
| **fair_v1 (default)** | **3.37 / +2.45 / 7.21 / +6.68** | **5.36 / 9.57 / +4.51** |
| joos2013 (fixed IRF) | 29.96 / +29.58 / 36.92 / +36.17 | 14.41 / 34.23 / +34.23 |

(For comparison, the RCMIP/MAGICC SSP2-4.5 concentration itself is 429.03 ppm in 2025 vs NOAA 425.62.)

Driven by RCMIP SSP emissions vs RCMIP SSP concentrations:

| SSP | 2050 model / RCMIP (ppm) | 2050 error | 2100 model / RCMIP (ppm) | 2100 error |
|---|---|---|---|---|
| SSP1-1.9 | 436.5 / 437.6 | −1.1 (−0.3%) | 388.0 / 393.5 | −5.5 (−1.4%) |
| SSP1-2.6 | 469.1 / 469.3 | −0.2 (−0.03%) | 439.6 / 445.6 | −6.1 (−1.4%) |
| SSP2-4.5 | 507.6 / 506.9 | +0.7 (+0.1%) | 589.2 / 602.8 | −13.5 (−2.2%) |
| SSP3-7.0 | 541.9 / 540.6 | +1.3 (+0.2%) | 843.4 / 867.2 | −23.8 (−2.7%) |
| SSP4-3.4 | 471.3 / 472.9 | −1.7 (−0.4%) | 456.3 / 473.4 | −17.1 (−3.6%) |
| SSP4-6.0 | 514.8 / 515.6 | −0.8 (−0.1%) | 645.5 / 668.4 | −22.9 (−3.4%) |
| SSP5-8.5 | 566.1 / 562.8 | +3.3 (+0.6%) | 1107.6 / 1135.2 | −27.6 (−2.4%) |

joos2013 2100 errors: +9.4, +6.1, −21.8, −84.2, −8.6, −43.4, −161.5 ppm (same order) — it is offered only for comparison.

Temperature sanity (two-layer, ECS 3, with non-CO2): SSP2-4.5 2100 = 2.83 °C and SSP5-8.5 = 4.95 °C relative
to 1750; 2025 state 1.38 °C (AR6: SSP2-4.5 2081–2100 2.7 °C [2.1–3.5], SSP5-8.5 4.4 °C [3.3–5.7] vs 1850–1900).

### 6. Runtimes (CPython 3.12, this Mac; median of repeated calls)

| call | ms |
|---|---|
| `run_core`, first call (includes scipy import) | ~300 |
| `run_core`, warm | ~41 |
| `run_catalyst` concentration mode (CORe baseline, bands) | ~14 |
| `run_catalyst` emissions mode, CORe baseline + interventions + ECS bands | ~70 |
| `run_catalyst` emissions mode, SSP baseline, no bands | ~10 |
| `run_catalyst` validation mode | ~37 |

Expect 2–5× slower in Pyodide (not measured here). Pass `core_pathway` from `run_core` into Catalyst so CORe is
not recomputed on every slider move.

### 7. Not done / not verified

- Not executed in Pyodide in this session (pure numpy + lazy scipy, no I/O, so it should run; scipy adds load
  time and is only needed for CORe's Huber candidate).
- The 621.146694 service number is explained (data vintage) but not reproduced bit-for-bit (file not archived).
- Cells 09/10 (seasonal city background CO2) not ported.

### 8. Scientific suggestions for the team (none of these change CORe defaults)

1. **CORe temperature response**: replace (in a future CORe version) the one-box, CO2-only, start-at-1.2 °C
   response with a spun-up two-layer model plus non-CO2 forcing, and state the baseline period (1850–1900).
   The current form warms 0.09 °C/yr in 2026 and reports near-equilibrium warming. Catalyst already offers this.
2. **Forcing constants**: use one consistent F2x (either 5.35 ln 2 = 3.708 in both places, or the AR6
   Meinshausen et al. 2020 CO2 ERF with λ = F2x/ECS).
3. **Backtest bias**: every CORe candidate under-predicts in backtests (ensemble bias −2.08 ppm, RMSE 2.67 ppm
   over ≤10-yr horizons) because CO2 growth has accelerated; the ensemble may be biased low for continuation.
   Also test 20–40-yr horizons before trusting the √(h/10) widening out to 75 years, and check empirical
   coverage of the band (it is "conformal-style", not a calibrated probability interval).
4. **Pin data vintages** (done in `data/co2/`), because ±0.01 ppm NOAA revisions move 2100 by up to ~0.3 ppm;
   quote 620.86 with that caveat rather than to two decimals.
5. **Context on the site**: show CORe next to the RCMIP SSP envelope (621 ppm sits between SSP2-4.5 and
   SSP4-6.0 in 2100) and say it corresponds to roughly flat ~35–40 GtCO2/yr emissions in Catalyst's carbon cycle.
6. **Catalyst carbon cycle**: calibrate r0/rC to the observed CO2 record (it overshoots 2025 by 6.7 ppm before
   harmonisation and undershoots SSP 2100 values by 1–4%), or adopt FaIR v2 if it can be packaged for Pyodide;
   add carbon-cycle parameter uncertainty to the bands.
7. **Global→local**: replace the illustrative ratio scaling with published regional pattern scaling (e.g.
   CMIP6-based patterns per grid cell) before presenting any station-level scenario numbers as results.
