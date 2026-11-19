# Solaris models — Python ↔ browser API

All functions live in `solaris_models/api.py`, take one JSON-serialisable dict and return one
(numpy → plain lists, NaN/inf → `null`). Every result has `model`, `version`, `ok`, `inputs`,
`warnings`, `provenance`, `runtime_ms`; on failure `ok: false` and `error: {type, message}`.
`dispatch(model, payload)` routes `"aeros" | "core" | "catalyst" | "nexus"` and imports model modules lazily.

Sections are owned per model; edit only your own.

<!-- ===================== AEROS (owner: Aeros/Nexus) ===================== -->
## Aeros

Aeros 4.0 — seasonal (D-J-F / J-J-A) station temperature projection to 2100 with bootstrap
2.5–97.5 % bounds. Port of the notebook (cell01 + cell02) in its recorded configuration
(`fast_mode=True`, 200 bootstrap paths). Output is a *conditional model output*, not a
verified prediction (`disclaimer` field). Bad input never raises: `ok: false` + `error`.

### Payload

```jsonc
{
  "station": {                      // all optional, but id/lat recommended
    "id": "USW00013743",            // also the bootstrap seed label (see below)
    "name": "...", "display_name": "...",
    "lat": 38.85, "lon": -77.03,    // lat < 0 → southern hemisphere: D-J-F labelled "summer"
    "hemisphere": "northern",       // optional override of the lat rule
    "country": "United States"
  },
  "years":   [1940, 1941, ...],     // one entry per row
  "seasons": {                      // °C, null (or 999.9 / -999.9 / 9999 / -9999) = missing
    "D-J-F": [0.70, 2.70, ...],     // aliases DJF / JJA accepted
    "J-J-A": [23.75, 23.94, ...]    // either season may be omitted
  },
  "options": {
    "mode": "notebook",             // "notebook" = 200 paths (default, = notebook) | "fast" = 100 paths (phones)
    "n_bootstrap": null,            // explicit path count overrides mode (10..20000)
    "seed": 42,                     // notebook RNG_SEED
    "end_year": 2100,
    "train_end_year": null,         // truncate input at this year BEFORE anything else (hindcasts)
    "impute_missing_years": true,   // notebook default (PCHIP inside each season's span)
    "unit_mode": "celsius",         // "celsius" | "hundredths_c" | "auto"  (notebook infer_unit_scale)
    "rolling_cv": true,             // notebook's rolling-CV diagnostic (does not change the forecast)
    "include_rolling_cv_rows": false,
    "sample_paths": 0,              // return the first k bootstrap paths (for spaghetti plots)
    "seed_label": null              // override the seed label
  },
  "provenance": {"data_source": "...", "source_url": "..."}   // optional, echoed in result.provenance
}
```

Convenience forms also accepted: a station object from `data/stations/stations_bundle.json`
passed as `{"station": <bundle station>}` (its `series: {years, D-J-F, J-J-A}` is used), and the
legacy golden-fixture form `{"station", "season", "historical": [{year, value}], "bootstrapPaths",
"seed", "projectionEndYear"}`.

**Seed label.** As in the notebook, each season's bootstrap stream is
`SeedSequence(seed + stable_int_seed(label, season))`; the notebook's label was the uploaded file
name. Here it is `options.seed_label` → `station.id` → `station.name` → `"station"`, so uploading
`USW00013743.csv` to the notebook reproduces the site's numbers for that station. Changing the
label changes the Monte-Carlo draw: with 200 paths the 2100 mean moves by ≈ ±0.15 °C (D-J-F,
Washington); `summary_end.mc_standard_error_of_mean` reports this per run.

### Result

| field | meaning |
|---|---|
| `station` | id, name, lat, lon, country, `hemisphere` (`northern`/`southern`/`unknown`) |
| `seed_label`, `hist_start_year`, `hist_end_year`, `end_year` | `hist_end_year` = last year with data in *any* season (notebook behaviour: projections of both seasons start the year after) |
| `seasons[S]` | one block per season with ≥ 10 years (others listed in `skipped_seasons`) |
| `seasons[S].local_label` | `"winter"`/`"summer"` after hemisphere adjustment, `null` if hemisphere unknown |
| `seasons[S].historical[]` | `{year, value, imputed}` — the series Aeros actually used (imputed years flagged) |
| `seasons[S].trend` | quadratic trend (`coefficients_high_to_low`, `fitted[] {year, value}`) — the notebook's "Hist. Trend" line and the residual base |
| `seasons[S].projection[]` | `{year, mean, lower, upper}` for `hist_end_year+1 … end_year`; mean = nanmean of paths, bounds = 2.5/97.5 percentiles |
| `seasons[S].summary_end` | the `end_year` row plus `mc_standard_error_of_mean` (extra diagnostic: sd of paths / √N) |
| `seasons[S].slopes` | °C/decade: `historical_1940_1979`, `modern` (1980–hist_end_year, `modern_range`), `future_mean`, `future_ci_low/high` (2.5/97.5 % of per-path OLS slopes), `instantaneous_end` (slope of the last 5 years of the mean), `acceleration` = future_mean − modern. NaN → `null` (e.g. < 2 years in 1940–1979) |
| `seasons[S].ensemble.members[]` | `{name, weight, description, hindcast_mae, hindcast_rmse, hindcast_bias, sanity_pass_fraction}`; errors are prediction − observed on the decadal hindcast folds; `sanity_pass_fraction` = share of bootstrap paths in which the member passed the 2 °C/decade filter |
| `seasons[S].ensemble` (other) | `weighting_method`, `validation_year`, `hindcast_folds[]`, `hindcast_points`, `stacked_hindcast {mae, rmse, bias, n_points}`, `paths_with_all_members_rejected` |
| `seasons[S].residual_model` | `label` (`AR1`, or `SIMPLE_NOISE` when < 30 years), `phi`, `const`, `innovation_sd`, `start_value`, `block_size`, `observation_noise_sd` |
| `seasons[S].rolling_cv` | notebook rolling-origin diagnostic per member (`by_model[] {model, n_cutoffs, mean_rmse, mean_mae, mean_bias}`) |
| `seasons[S].data_quality` | `first_year, last_year, n_observed, city_span, missing_years_in_span, imputed_years, missing_after_imputation, longest_internal_gap_years, sentinel_values_removed, outlier_years, outlier_rule, unit_handling, sufficient, n_years_1940_1979` |
| `seasons[S].sample_paths` | only if `options.sample_paths > 0` |
| `disclaimer` | one-sentence "conditional model output" note |

### Real example (Washington Reagan National, `data/stations` bundle, default options; arrays trimmed)

```json
{
 "model": "aeros", "version": "4.0", "port_revision": "solaris-summit-1", "ok": true,
 "inputs": {"mode": "notebook", "n_bootstrap": 200, "seed": 42, "end_year": 2100, "train_end_year": null,
            "impute_missing_years": true, "unit_mode": "celsius", "rolling_cv": true,
            "include_rolling_cv_rows": false, "sample_paths": 0, "seed_label": "USW00013743",
            "n_years_supplied": 87, "seasons_supplied": ["D-J-F", "J-J-A"]},
 "warnings": ["D-J-F: 2 missing year(s) filled by PCHIP imputation: [1998, 1999].",
              "J-J-A: 1 missing year(s) filled by PCHIP imputation: [1998]."],
 "provenance": {"data_source": "supplied by caller", "source_url": null, "station_id": "USW00013743",
                "method": ["Port of the Solaris Aeros 4.0 notebook ...", "..."], "units": "°C; slopes °C/decade"},
 "station": {"id": "USW00013743", "name": "Washington, D.C. (Reagan National)", "lat": 38.8483, "lon": -77.0342,
             "country": "United States", "hemisphere": "northern", "hemisphere_inferred_from_latitude": true},
 "seed_label": "USW00013743", "hist_start_year": 1940, "hist_end_year": 2026, "end_year": 2100,
 "seasons": {
  "D-J-F": {
   "season": "D-J-F", "local_label": "winter",
   "historical": [{"year": 1940, "value": 0.7, "imputed": false}, "... 87 rows"],
   "trend": {"type": "quadratic least-squares fit to the (imputed) historical series",
             "coefficients_high_to_low": [0.0008, -3.1354, 3087.1853], "fitted": [{"year": 1940, "value": 3.0382}, "..."]},
   "projection": [{"year": 2027, "mean": 4.3353, "lower": 1.8465, "upper": 7.0858}, "... 74 rows"],
   "interval": "2.5th–97.5th percentile of bootstrap paths (95%)",
   "summary_end": {"year": 2100, "mean": 9.7226, "lower": 6.5714, "upper": 12.7799, "mc_standard_error_of_mean": 0.1220},
   "slopes": {"historical_1940_1979": -0.3264, "historical_range": "1940-1979", "historical_n_years": 40,
              "modern": 0.5103, "modern_range": "1980-2026", "modern_n_years": 47,
              "future_mean": 0.6501, "future_ci_low": 0.3305, "future_ci_high": 0.9718, "future_range": "2027-2100",
              "instantaneous_end": 0.0938, "acceleration": 0.1399, "units": "°C/decade"},
   "ensemble": {
     "members": [
       {"name": "poly2", "weight": 0.1435, "description": "Quadratic polynomial in year (numpy.polyfit, degree 2)",
        "sanity_pass_fraction": 0.83, "hindcast_mae": 2.8627, "hindcast_rmse": 3.6197, "hindcast_bias": -0.7605},
       {"name": "pchip", "weight": 0.0032, "sanity_pass_fraction": 0.0, "hindcast_rmse": 181.82, "...": "..."},
       {"name": "ridge", "weight": 0.0, "...": "..."},
       {"name": "lin_modern", "weight": 0.8533, "...": "..."}],
     "weighting_method": "SLSQP stacking on decadal hindcast", "validation_year": 2014,
     "hindcast_folds": [{"train_end": 1949, "test_start": 1950, "test_end": 1959, "n_train": 10, "n_test": 10}, "..."],
     "hindcast_points": 64, "stacked_hindcast": {"mae": 1.6606, "rmse": 1.8876, "bias": 0.2148, "n_points": 64},
     "error_sign_convention": "error = prediction − observed (positive = model too warm)",
     "paths_with_all_members_rejected": 0},
   "residual_model": {"label": "AR1", "block_size": 1, "observation_noise_sd": 0.15, "phi": 0.2588, "const": 0.0239,
                      "innovation_sd": 1.4522, "start_value": -3.1469},
   "rolling_cv": {"enabled": true, "min_train_years": 30, "horizon": 10, "step": 5,
                  "by_model": [{"model": "poly2", "n_cutoffs": 10, "mean_rmse": 2.0253, "mean_mae": 1.799, "mean_bias": -0.8472}, "..."]},
   "n_bootstrap": 200,
   "data_quality": {"season": "D-J-F", "first_year": 1940, "last_year": 2026, "n_observed": 85, "city_span": [1940, 2026],
                    "missing_years_in_span": [1998, 1999], "imputed_years": [1998, 1999], "missing_after_imputation": [],
                    "longest_internal_gap_years": 2, "sentinel_values_removed": 0, "outlier_years": [],
                    "unit_handling": "degrees_C_as_uploaded", "sufficient": true, "n_years_1940_1979": 40, "outlier_rule": "..."}
  },
  "J-J-A": {"local_label": "summer", "summary_end": {"year": 2100, "mean": 30.7523, "lower": 28.3004, "upper": 33.0355}, "...": "same structure"}
 },
 "skipped_seasons": [],
 "data_quality": {"D-J-F": "... same objects as seasons[S].data_quality ...", "J-J-A": "..."},
 "disclaimer": "Conditional model output: a statistical extrapolation of this station's own seasonal record under the Aeros 4.0 method. It is not a verified prediction and contains no emissions scenario.",
 "runtime_ms": 304
}
```

Runtime: ≈0.3 s (both seasons, 200 paths) in CPython 3.12; ≈0.6 s in Pyodide 0.29.5 under Node
(desktop); `mode: "fast"` roughly halves it.

---

<!-- ===================== NEXUS (owner: Aeros/Nexus) ===================== -->
## Nexus

Nexus 1.0 (new, simplified) — validation and context layer around Aeros. It **never alters Aeros
output**: the optional bias-adjusted series is returned separately and labelled, next to the
untouched Aeros baseline. Error sign convention everywhere: **error = predicted − observed**
(positive mean bias = model too warm).

Two modes, chosen by the payload:

### 1. Single station

Payload = the Aeros station payload (`station`, `years`, `seasons` or bundle `series`) plus:

```jsonc
{
  "options": {
    "analyses": ["data_quality", "trends", "hindcast", "bias_correction"],  // default; add "rolling_origin"
    "train_end_year": 2000,          // hindcast cutoff: Aeros sees years <= 2000 only
    "mode": "notebook", "n_bootstrap": null, "seed": 42, "end_year": 2100, "seed_label": null,
    "shrinkage": 0.5,                // bias view: correction = shrinkage × mean(observed − predicted)
    "min_years_per_window": 20,      // trend windows need >= this many observed years
    "rolling_cutoffs": [1980, 1990, 2000, 2010], "rolling_horizon": 10, "rolling_n_bootstrap": 100
  },
  "aeros_result": null               // optional: a run_aeros result to use as the baseline (avoids a rerun)
}
```

Result blocks (each present only if requested):

- `data_quality` — `{span, seasons[S]}` with the same fields as Aeros `data_quality`.
- `trends` — `seasons[S] = {early, modern, change, local_label}`. `early`/`modern`:
  `{window, n, first_year, last_year, slope, se, ci_low, ci_high, p_value, units,
  lag1_autocorrelation, n_effective, se_ar1_adjusted}` (OLS on *observed, non-imputed* values,
  t-based 95 % CI with n−2 df; `se_ar1_adjusted` is an extra autocorrelation-aware SE, not used by
  the poster). `change = {change, se, ci_low, ci_high, p_value, df, method}` (modern − early;
  SE = √(se₁² + se₂²), t with n₁+n₂−4 df).
- `hindcast` — `{cutoff, training_last_year, n_bootstrap, leakage_guard, seasons[S]}` with
  `seasons[S] = {test_years [first,last], n_test, mae, rmse, mean_bias, mean_bias_se, observed_slope,
  predicted_slope, slope_error, interval_coverage_95, mean_interval_width, direction_accuracy,
  direction_definition, trend_direction_correct, baselines{climatology_last30, linear_trend_full:
  {mae, rmse, mean_bias, description, aeros_skill_score_vs_this}}, per_year[] {year, observed,
  predicted, lower, upper}, ensemble_weights, training_years_used}`. Only real observations after the
  cutoff are scored (imputed values never). Skill score = 1 − MSE(Aeros)/MSE(baseline).
- `rolling_origin` — `{cutoffs, horizon_years, n_bootstrap, rows[] {cutoff, season, test_years, n_test,
  mae, rmse, mean_bias, interval_coverage_95, baseline_rmse}, summary[S] {n_cutoffs, mean_mae,
  mean_rmse, mean_bias, mean_coverage_95, mean_baseline_rmse, cutoffs_where_aeros_beat_all_baselines}}`.
  Cutoffs with too little training data are skipped with a warning.
- `bias_correction` — `{aeros_baseline[S] {projection, summary_end}, aeros_baseline_note,
  adjusted[S] {available, label, formula, shrinkage, hindcast_cutoff,
  hindcast_mean_observed_minus_predicted, correction_c, hindcast_bias_distinguishable_from_zero,
  caveat, projection[] {year, mean, lower, upper}}}`. Display `adjusted` only as a clearly labelled
  alternative view ("Nexus bias-adjusted view (experimental; NOT the Aeros forecast)").

Real example (Washington Reagan, `mode: "fast"`; trimmed):

```json
{
 "model": "nexus", "version": "1.0", "ok": true, "mode": "station",
 "inputs": {"mode": "fast", "n_bootstrap": 100, "seed": 42, "end_year": 2100, "unit_mode": "celsius",
            "analyses": ["data_quality", "trends", "hindcast", "bias_correction"], "train_end_year": 2000,
            "shrinkage": 0.5, "min_years_per_window": 20, "seed_label": "USW00013743",
            "rolling_cutoffs": null, "rolling_n_bootstrap": null},
 "warnings": ["hindcast: D-J-F: 2 missing year(s) filled by PCHIP imputation: [1998, 1999].", "..."],
 "provenance": {"data_source": "supplied by caller", "station_id": "USW00013743",
                "method": ["Nexus 1.0 (new, simplified validation layer). Never modifies Aeros output.",
                           "error = predicted − observed (°C); positive mean bias = model too warm"]},
 "station": {"id": "USW00013743", "name": "Washington, D.C. (Reagan National)", "hemisphere": "northern"},
 "trends": {"method": "...", "seasons": {"D-J-F": {
   "early":  {"window": "1940-1979", "n": 40, "slope": -0.3264, "se": 0.2183, "ci_low": -0.7682, "ci_high": 0.1155, "p_value": 0.1431,
              "lag1_autocorrelation": 0.4198, "n_effective": 16.35, "se_ar1_adjusted": 0.3552, "units": "°C/decade"},
   "modern": {"window": "1980-2026", "n": 45, "slope": 0.526, "se": 0.1552, "ci_low": 0.213, "ci_high": 0.839, "p_value": 0.0015, "...": "..."},
   "change": {"change": 0.8524, "se": 0.2678, "ci_low": 0.3195, "ci_high": 1.3852, "p_value": 0.0021, "df": 81, "method": "..."},
   "local_label": "winter"}, "J-J-A": "..."}},
 "hindcast": {"cutoff": 2000, "training_last_year": 2000, "n_bootstrap": 100, "leakage_guard": "...", "seasons": {"D-J-F": {
   "test_years": [2001, 2026], "n_test": 26, "mae": 1.5677, "rmse": 1.9253, "mean_bias": 1.1908, "mean_bias_se": 0.3026,
   "observed_slope": 0.9309, "predicted_slope": 0.892, "slope_error": -0.0389,
   "interval_coverage_95": 0.8462, "mean_interval_width": 5.9154, "direction_accuracy": 0.6538,
   "direction_definition": "share of test years where Aeros and the observation agree on being warmer or cooler than the last-30-training-year mean (2.83 °C)",
   "trend_direction_correct": true,
   "baselines": {"climatology_last30": {"mae": 1.6872, "rmse": 2.0356, "mean_bias": -1.1781, "aeros_skill_score_vs_this": 0.1055, "description": "..."},
                 "linear_trend_full":  {"mae": 1.6646, "rmse": 2.0004, "mean_bias": -1.1365, "aeros_skill_score_vs_this": 0.0737, "description": "..."}},
   "per_year": [{"year": 2001, "observed": 2.02, "predicted": 4.0773, "lower": 1.2657, "upper": 6.7331}, "..."],
   "ensemble_weights": {"poly2": 0.2036, "pchip": 0.0051, "ridge": 0.0, "lin_modern": 0.7913}, "training_years_used": 59},
   "J-J-A": "..."}},
 "bias_correction": {
   "aeros_baseline": {"D-J-F": {"projection": [{"year": 2027, "mean": 4.2754, "lower": 1.5386, "upper": 7.1796}, "..."],
                                "summary_end": {"year": 2100, "mean": 9.6065, "lower": 6.5555, "upper": 12.6073}}, "J-J-A": "..."},
   "aeros_baseline_note": "Aeros baseline computed by Nexus with the same seed/options (identical to run_aeros).",
   "adjusted": {"D-J-F": {"available": true, "label": "Nexus bias-adjusted view (experimental; NOT the Aeros forecast)",
     "formula": "corrected = Aeros + shrinkage × mean(observed − predicted) from the hindcast", "shrinkage": 0.5,
     "hindcast_cutoff": 2000, "hindcast_mean_observed_minus_predicted": -1.1908, "correction_c": -0.5954,
     "hindcast_bias_distinguishable_from_zero": true, "caveat": "...",
     "projection": [{"year": 2027, "mean": 3.6799, "lower": 0.9431, "upper": 6.5842}, "..."]}, "J-J-A": "..."}},
 "data_quality": {"span": [1940, 2026], "seasons": {"D-J-F": {"...": "as in Aeros"}, "J-J-A": "..."}},
 "runtime_ms": 309
}
```

### 2. Station set (poster-style statistics)

```jsonc
{
  "stations": [ <bundle station objects: {id, display_name, country, urban_rural, lat|hemisphere,
                 series: {years, D-J-F, J-J-A}}> ],     // or {id, ..., years, seasons}
  "options": {"group_by": ["country", "urban_rural"], "min_years_per_window": 20}
}
```

Result: `station_set = {method, n_stations, groups, stations[]}`.
`groups.all` and `groups.by[attr][value]` each hold two views:
`calendar` (keys `D-J-F`, `J-J-A`) and `hemisphere_adjusted` (keys `winter`, `summer`; southern
stations' D-J-F counts as summer). Each cell: `{n, mean_early, mean_modern, mean_change,
sd_change, n_increased, n_decreased, t_statistic, p_value, ci_low, ci_high, df,
wilcoxon_p_value, station_ids}` (paired t-test of modern vs early slopes, t-based 95 % CI on the
mean change). `stations[]` holds each station's per-season `trends` blocks (as above).

Example (the 40 bundled Americas stations, hemisphere-adjusted winter):
`{"n": 40, "mean_early": -0.1289, "mean_modern": 0.2739, "mean_change": 0.4028, "ci_low": 0.2614,
"ci_high": 0.5442, "p_value": 1.1e-06, "n_increased": 31, "n_decreased": 9}` — computed on the Solaris
sample set (GHCN-M v4), **not** the poster's 40 stations, so it does not reproduce the poster's
+0.189 °C/decade.

Runtimes (CPython 3.12): single station default ≈0.6 s (hindcast + baseline, 200 paths),
`mode: "fast"` ≈0.3 s, with `rolling_origin` ≈1.2 s; station set of 40 ≈0.04 s.


---

## CORe

CORe 4.0 — one validation-weighted **historical-continuation** CO2 pathway to 2100 (not an IPCC/SSP
scenario), its CO2 forcing and a simple temperature response. Port of notebook cells 07+08; on the
bundled data it reproduces the poster numbers exactly (620.86 ppm, 560.53–681.18 ppm in 2100).

### Payload

```jsonc
{
  "historical_co2": {               // required (or "data": <co2_bundle.json>, which contains it)
    "years": [1940, ..., 2025],     // annual; duplicates averaged, interior gaps linearly filled
    "ppm":   [311.357, ..., 425.62],
    "source": ["RCMIP_historical_concentration", ..., "NOAA_global_annual"]   // optional, echoed
  },
  "settings": {                     // optional overrides; defaults = notebook values (leave empty for the poster run)
    "projection_end_year": 2100, "preindustrial_co2_ppm": 278.3,
    "ecs_c": 3.0, "heat_capacity": 8.0, "initial_temp_anomaly_c": 1.2,
    "validation_min_train_years": 40, "validation_test_horizon_years": 10, "validation_cutoff_step": 3,
    "abs_min_annual_growth_ppm": 0.05, "abs_max_annual_growth_ppm": 4.25,
    "abs_max_acceleration_ppm_per_year2": 0.06, "weight_power": 2.0,
    "keep_models_within_rmse_factor": 1.35, "ewma_keep_within_rmse_factor": 1.75,
    "conformal_quantile": 0.9, "uncertainty_multiplier": 1.25
  },
  "include_validation_points": false   // true adds every backtest point (1380 + 138 rows)
}
```

Browser usage: load `data/co2/co2_bundle.json` once and call
`run_core({"historical_co2": bundle.historical_co2})`. Unknown setting keys → `ok: false`.

### Result

| key | type | meaning |
|---|---|---|
| `inputs.settings` | object | effective settings (all keys above) |
| `inputs.historical` | object | `first_year`, `last_year`, `n_years`, `last_ppm`, `source` |
| `historical` | object | `years`, `ppm` (cleaned input), `forcing_wm2` (same forcing formula) |
| `projection` | object | `years` (last+1 … end), `ppm_mean`, `ppm_lower`, `ppm_upper`, `forcing_wm2`, `forcing_lower_wm2`, `forcing_upper_wm2`, `temperature_response_c`, `model_spread_ppm`, `uncertainty_ppm` |
| `summary_end` | object | values in the end year (2100): `year`, `ppm_mean`, `ppm_lower`, `ppm_upper`, `forcing_wm2`, `forcing_lower_wm2`, `forcing_upper_wm2`, `temperature_response_c`, `conformal_base_error_ppm` |
| `ensemble` | list | `{model, weight}` of the models in the ensemble (weights sum to 1) |
| `members` | object | constrained 2026–2100 path of each ensemble member (ppm) |
| `growth_constraints` | object | adaptive growth limits (`min_growth`, `max_growth`, `max_accel`, quantiles) |
| `validation.candidates` | list | per candidate: `model, mae_ppm, rmse_ppm, bias_ppm, n_validation_points, selected_for_ensemble, weight` (sorted by RMSE) |
| `validation.ensemble_backtest` | object | `n_points, mae_ppm, rmse_ppm, bias_ppm` of the weighted ensemble backtest |
| `validation.failures` | list | candidate fits that raised (skipped, as in the notebook) |
| `validation.points`, `validation.ensemble_points` | | only with `include_validation_points` |

`temperature_response_c` is CORe's one-box response to **CO2-only** forcing, started at 1.2 °C in 2025
(see NOTES: it is close to CO2-only *equilibrium* warming and is not comparable to IPCC assessed
transient warming). Label it "forcing response estimate", as the notebook does.

### Example (real output, arrays truncated)

Payload: `{"historical_co2": bundle.historical_co2}` → runtime ~40 ms warm, ~300 ms first call (scipy import) in CPython.

```json
{
 "model": "core", "version": "4.0", "ok": true,
 "inputs": {"settings": {"projection_end_year": 2100, "preindustrial_co2_ppm": 278.3, "ecs_c": 3.0, "heat_capacity": 8.0,
            "initial_temp_anomaly_c": 1.2, "...": "..."},
            "historical": {"first_year": 1940, "last_year": 2025, "n_years": 86, "last_ppm": 425.62,
                           "source": ["NOAA_global_annual", "RCMIP_historical_concentration"]}},
 "warnings": [],
 "provenance": {"data_sources": ["RCMIP v5.1.0 ... (1940-1978, historical)", "NOAA GML global annual mean CO2 ... (1979 onward)"],
                "method": ["Port of the Solaris CORe 4.0 notebook (cells 07+08): ...", "..."],
                "conditional": "Conditional model output, not a prediction."},
 "historical": {"years": [1940, 1941, 1942, "..."], "ppm": [311.356977, 311.810974, 312.171977, "..."],
                "forcing_wm2": [0.600486, 0.608282, 0.614472, "..."]},
 "projection": {"years": [2026, 2027, 2028, "..."], "ppm_mean": [427.865347, 430.120818, 432.386412, "..."],
                "ppm_lower": [425.62, 425.62, 425.964713, "..."], "ppm_upper": [433.824025, 436.307351, 438.808112, "..."],
                "forcing_wm2": [2.301082, 2.329211, 2.357317, "..."], "temperature_response_c": [1.302635, 1.392964, 1.47288, "..."],
                "model_spread_ppm": [0.207913, 0.422365, 0.643699, "..."], "uncertainty_ppm": [5.958677, 6.186533, 6.4217, "..."]},
 "summary_end": {"year": 2100, "ppm_mean": 620.855023, "ppm_lower": 560.533981, "ppm_upper": 681.176065,
                 "forcing_wm2": 4.292829, "forcing_lower_wm2": 3.746018, "forcing_upper_wm2": 4.788898,
                 "temperature_response_c": 3.368844, "conformal_base_error_ppm": 4.590216},
 "ensemble": [{"model": "growth_linear_ridge", "weight": 0.421413}, {"model": "recent_growth_median", "weight": 0.428672},
              {"model": "recent_growth_ewma", "weight": 0.149915}],
 "members": {"growth_linear_ridge": [427.99723, 430.398483, 432.823758, "..."], "...": "..."},
 "growth_constraints": {"min_growth": 0.076001, "max_growth": 3.7881, "max_accel": 0.06, "recent_growth_median": 2.25, "...": "..."},
 "validation": {"candidates": [{"model": "growth_linear_ridge", "mae_ppm": 2.004343, "rmse_ppm": 2.456559, "bias_ppm": -1.956916,
                                "n_validation_points": 138, "selected_for_ensemble": true, "weight": 0.421413}, "... 9 more"],
                "ensemble_backtest": {"n_points": 138, "mae_ppm": 2.174316, "rmse_ppm": 2.666816, "bias_ppm": -2.075156},
                "failures": []},
 "runtime_ms": 41.4
}
```

---

## Catalyst

Catalyst 1.0 — **new, simplified** what-if engine on CORe physics: baseline vs scenario for a CO2
concentration pathway (concentration mode) or a CO2 emissions pathway with interventions (emissions
mode). ~10–70 ms per run in CPython (see NOTES), so it can be driven from sliders.

### Payload

```jsonc
{
  "data": <co2_bundle.json>,          // required: needs "rcmip" (+ "historical_co2", "noaa_global_annual")
  "mode": "emissions",                // "emissions" | "concentration" | "validation"
  "end_year": 2100,                   // <= 2100; projection years = last observed year + 1 (2026) .. end_year

  // ---- pathway specs ----
  // emissions mode baseline:
  //   {"type": "core"}                                  CORe-consistent emissions (diagnosed by inverting the carbon cycle)  [default]
  //   {"type": "ssp", "scenario": "ssp245"}             RCMIP SSP emissions (ssp119/126/245/370/434/460/585)
  //   {"type": "custom", "years": [...], "values": [...]}  GtCO2/yr control points for 2026+, linear between, held after
  // concentration mode baseline AND scenario (default scenario = ssp245):
  //   {"type": "core"} | {"type": "ssp", "scenario": "ssp126"} | {"type": "custom", "years": [...], "ppm": [...]}
  //   optional "edits": {"years": [2060], "ppm": [480]}  user edits: offsets at points, linear in between,
  //                                                     tapering to 0 at 2025, held after the last point
  "baseline": {"type": "core"},
  "scenario": {"type": "ssp", "scenario": "ssp245"},       // concentration mode only
  "core_pathway": {"years": [2026, ...], "ppm": [...]},    // recommended for type "core": run_core().projection.{years, ppm_mean};
                                                           // if absent CORe is run internally (+~300 ms first time)
  "core_settings": null,                                   // passed to the internal CORe run if core_pathway is absent

  // ---- emissions-mode interventions (all optional; applied in this order) ----
  "interventions": {
    "start_year": 2026,             // first year interventions act (default first projection year)
    "peak_year": 2030,              // follow baseline until peak_year, never exceed that year's level afterwards
    "decline_rate_pct": 3.0,        // compound %/yr decline after peak_year (or after start_year-1 if no peak_year)
    "target_cut": {"pct": 43, "year": 2030, "reference_year": 2019},  // straight line to pct below the reference-year level, then held
    "net_zero_year": 2070,          // linear ramp from the level at max(peak_year, start_year-1) to 0, <= 0 afterwards
    "removal": {"gtco2_per_yr": 5, "start_year": 2050, "ramp_years": 10},   // extra CDR subtracted from net emissions
    "custom_emissions": {"years": [...], "values": [...]}                 // explicit GtCO2/yr overrides within their year span
  },
  // Caps are combined with min(baseline, caps): interventions never raise emissions above the baseline.

  // ---- physics ----
  "ecs": 3.0,                        // °C, 0.5–10
  "heat_capacity": 8.0,              // W yr m-2 K-1, CORe one-box only
  "initial_temp_anomaly_c": 1.2,     // CORe one-box start value in the last observed year
  "preindustrial_co2_ppm": 278.3,    // forcing reference (CORe value)
  "temperature_model": "core4",      // "core4" (CORe response, default) | "two_layer" (Geoffroy et al. 2013, spun up from 1750)
  "non_co2_forcing": "none",         // "none" (CO2-only, default) | "scenario" (RCMIP anthropogenic non-CO2 ERF)
  "non_co2_scenario": "ssp245",      // SSP used for non-CO2 forcing / recent emission history when the pathway is core/custom
  "carbon_cycle": "fair_v1",         // "fair_v1" (default) | "joos2013" (fixed IRF; validates poorly, for comparison)
  "anchor_to_observed": true,        // shift model/SSP ppm by a constant so 2025 = observed 425.62 ppm
  "uncertainty": true,               // ECS bands (AR6 likely 2.5–4.0, very likely 2.0–5.0) by deterministic re-runs
  "two_layer": {},                   // optional overrides {c_upper, c_deep, gamma}
  "fair": {},                        // optional overrides {r0, rc, rt, iirf_max}

  // ---- optional, ILLUSTRATIVE global -> local link (off by default) ----
  "local_scaling": {"enabled": true, "reference_year": 2025, "min_baseline_warming_c": 0.1,
                    "station": {"label": "Washington DC JJA", "years": [...], "values": [...], "lower": [...], "upper": [...]}}
}
```

Unknown top-level keys → `ok: false`.

### Result (emissions / concentration modes)

| key | meaning |
|---|---|
| `inputs` | effective configuration (payload minus `data`/`core_pathway`, defaults filled) |
| `years` | projection years (2026 … end_year) |
| `baseline`, `scenario` | `label`; `emissions_gtco2` (`emissions_kind`: `"input"` in emissions mode, `"implied"` = diagnosed by carbon-cycle inversion in concentration mode); `ppm`; `forcing_wm2` = `forcing_co2_wm2` + `forcing_non_co2_wm2`; `temperature_c`; `temperature_band_c.{likely,very_likely}.{ecs:[lo,hi], lower[], upper[]}`; emissions mode also `ppm_band` (ECS-dependent carbon-cycle feedback); `peak_warming {value_c, year}` |
| `delta."2050"`, `delta."2100"` | scenario − baseline for `emissions_gtco2`, `ppm`, `forcing_wm2`, `temperature_c`, plus `baseline{}` and `scenario{}` values in that year |
| `cumulative_emissions_gtco2` | `period`, `baseline`, `scenario`, `difference` (GtCO2 over the projection period), `kind` |
| `history` | `years` 1940–2025, `ppm_observed` (CORe input), `emissions_gtco2` (RCMIP historical + SSP after 2014), `emissions_source` |
| `reference_state` | `year` 2025, `ppm_observed`, `temperature_c` (CORe initial 1.2 °C, or two-layer spun-up value), `temperature_note` |
| `assumptions` | list of plain-language statements of everything actually applied — show these in the UI |
| `local_scaling` | only if enabled: `label, years, reference_year, ratio[], values[], lower[], upper[], illustrative: true, assumption` |

### Result (validation mode)

`{"mode": "validation", "validation": {"fair_v1": {...}, "joos2013": {...}}, "assumptions": [...]}`; per carbon-cycle model:
`historical.vs_noaa_global {years, rmse_ppm, bias_ppm, max_abs_ppm, last_year_error_ppm}`,
`historical.vs_rcmip_historical {years, rmse_ppm, max_abs_ppm, error_2014_ppm}`, and `ssp[]` rows
`{scenario, model_2050_ppm, rcmip_2050_ppm, error_2050_ppm, error_2050_pct, model_2100_ppm, rcmip_2100_ppm, error_2100_ppm, error_2100_pct, max_abs_error_2015_2100_ppm}`.
This is the "how simplified is this" table (numbers in NOTES.md).

### Example (real output, arrays truncated)

Payload:

```json
{"data": "<co2_bundle.json>", "mode": "emissions", "baseline": {"type": "core"},
 "core_pathway": {"years": [2026, "..."], "ppm": [427.865347, "..."]},
 "interventions": {"peak_year": 2030, "decline_rate_pct": 3, "net_zero_year": 2070,
                   "removal": {"gtco2_per_yr": 5, "start_year": 2050, "ramp_years": 10}}}
```

Result (66 ms):

```json
{
 "model": "catalyst", "version": "1.0", "ok": true,
 "inputs": {"mode": "emissions", "end_year": 2100, "baseline": {"type": "core"},
            "interventions": {"peak_year": 2030, "decline_rate_pct": 3, "net_zero_year": 2070,
                              "removal": {"gtco2_per_yr": 5, "start_year": 2050, "ramp_years": 10}},
            "ecs": 3.0, "heat_capacity": 8.0, "initial_temp_anomaly_c": 1.2, "preindustrial_co2_ppm": 278.3,
            "temperature_model": "core4", "non_co2_forcing": "none", "non_co2_scenario": "ssp245",
            "carbon_cycle": "fair_v1", "anchor_to_observed": true, "uncertainty": true, "...": "..."},
 "warnings": ["Diagnosed CORe-consistent emissions start -7.4 GtCO2/yr away from the 2025 historical value: the simplified carbon cycle grows CO2 slightly faster than observed over 2015-2025, so it needs lower emissions to follow CORe's ppm path."],
 "provenance": {"data_sources": ["RCMIP v5.1.0 ...", "NOAA GML ..."], "method": ["Catalyst 1.0 (new, simplified): ...", "..."],
                "conditional": "Conditional what-if output from a simplified model, not a prediction or policy assessment."},
 "mode": "emissions",
 "years": [2026, 2027, 2028, "..."],
 "baseline": {"label": "CORe-consistent emissions (diagnosed)", "emissions_kind": "input",
              "emissions_gtco2": [34.6296, 36.6266, 36.4957, "..."], "ppm": [428.0302, 430.1233, 432.3889, "..."],
              "forcing_wm2": [2.3031, 2.3292, 2.3573, "..."], "forcing_co2_wm2": ["..."], "forcing_non_co2_wm2": [0.0, 0.0, 0.0, "..."],
              "temperature_c": [1.3029, 1.3932, 1.4731, "..."],
              "temperature_band_c": {"likely": {"ecs": [2.5, 4.0], "lower": [1.2658, "..."], "upper": [1.3493, "..."]},
                                     "very_likely": {"ecs": [2.0, 5.0], "lower": [1.2102, "..."], "upper": [1.3771, "..."]}},
              "ppm_band": {"likely": {"ecs": [2.5, 4.0], "lower": [427.9798, "..."], "upper": [428.1123, "..."]}, "very_likely": {"...": "..."}},
              "peak_warming": {"value_c": 3.3688, "year": 2100}},
 "scenario": {"label": "CORe-consistent emissions (diagnosed) + interventions", "...": "same keys",
              "peak_warming": {"value_c": 2.2188, "year": 2060}},
 "delta": {"2050": {"emissions_gtco2": -19.5808, "ppm": -19.7396, "forcing_wm2": -0.2224, "temperature_c": -0.1138,
                    "baseline": {"emissions_gtco2": 37.2628, "ppm": 484.7932, "temperature_c": 2.2766},
                    "scenario": {"emissions_gtco2": 17.6821, "ppm": 465.0536, "temperature_c": 2.1628}},
           "2100": {"emissions_gtco2": -44.1888, "ppm": -193.465, "forcing_wm2": -1.9977, "temperature_c": -1.4643,
                    "baseline": {"emissions_gtco2": 39.1888, "ppm": 620.855, "temperature_c": 3.3688},
                    "scenario": {"emissions_gtco2": -5.0, "ppm": 427.3901, "temperature_c": 1.9046}}},
 "cumulative_emissions_gtco2": {"period": [2026, 2100], "baseline": 2859.0021, "scenario": 651.5668, "difference": -2207.4353, "kind": "input"},
 "history": {"years": [1940, "..."], "ppm_observed": [311.357, "..."], "emissions_gtco2": [8.1569, "..."],
             "emissions_source": "RCMIP v5.1.0 historical (to 2014) + SSP245 (2015 onward)"},
 "assumptions": [
  "Catalyst 1.0 is a new, simplified scenario engine; results are conditional model outputs, not predictions.",
  "CO2 forcing F = 5.35 ln(C/278.3) W/m2 (CORe 4.0 expression).",
  "CO2-only forcing: methane, nitrous oxide, aerosols and other non-CO2 agents are NOT included in the displayed temperature.",
  "Temperature: CORe 4.0 one-box response (lambda = 3.7/ECS, ECS = 3.00 C, heat capacity 8.0 W yr/m2/K) starting from 1.20 C in the last observed year. Its ~6-7 yr response time makes it close to equilibrium warming; it has no deep ocean.",
  "Carbon cycle: FaIR v1.x-style state-dependent impulse response (...); its warming feedback uses an internal two-layer temperature with CO2 + anthropogenic non-CO2 forcing.",
  "Bands: deterministic re-runs at the IPCC AR6 ECS ranges (likely 2.5-4.0 C, very likely 2.0-5.0 C); they do not include carbon-cycle, forcing or scenario uncertainty.",
  "CORe-consistent baseline: emissions diagnosed by inverting the carbon-cycle model so that it reproduces the CORe 4.0 ppm pathway (after removing the model's own 2025 bias of +6.68 ppm). These are model-implied, not observed or projected emissions.",
  "Emissions follow the baseline until 2030, then may not exceed the 2030 level (36.4 GtCO2/yr) and decline 3.0%/yr.",
  "Net-zero CO2 by 2070: emissions ramp linearly from 36.4 GtCO2/yr in 2030 to 0 and stay at or below 0 afterwards (gross negative baseline values are kept).",
  "Additional carbon dioxide removal of 5.0 GtCO2/yr from 2050 (linear ramp over 10 yr); assumed permanent storage, no carbon-cycle rebound beyond the impulse response.",
  "Interventions never raise emissions above the baseline (except explicit custom emissions).",
  "Carbon-cycle output harmonised to the observed 2025 concentration (425.62 ppm) by a constant offset of -6.68 ppm."],
 "reference_state": {"year": 2025, "ppm_observed": 425.62, "temperature_c": 1.2, "temperature_note": "CORe 4.0 initial anomaly (assumed, not simulated)"},
 "runtime_ms": 66.6
}
```

UI notes: show `assumptions` and `warnings` next to every Catalyst chart; label Catalyst "v1.0 (new, simplified)";
the CORe one-box temperature is a "forcing response estimate"; offer "two-layer" as the more physical transient option.
