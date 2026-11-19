/**
 * Result shapes used by the workbenches (subset of models/API.md — only fields we read).
 * Everything is optional-tolerant: model output is JSON from Python, NaN → null.
 */
import type { SeasonKey } from "../../data";

export type Num = number | null | undefined;

export type ModelError = { type?: string; message: string };

export type BaseResult = {
  model: string;
  version: string;
  ok?: boolean;
  error?: ModelError;
  inputs: Record<string, unknown>;
  warnings: string[];
  provenance: Record<string, unknown>;
  runtime_ms: number;
};

/* ---------------- Aeros ---------------- */

export type AerosMember = {
  name: string;
  weight: number;
  description?: string;
  hindcast_mae?: Num;
  hindcast_rmse?: Num;
  hindcast_bias?: Num;
  sanity_pass_fraction?: Num;
};

export type DataQuality = {
  season: SeasonKey;
  first_year: number;
  last_year: number;
  n_observed: number;
  city_span?: [number, number];
  missing_years_in_span: number[];
  imputed_years: number[];
  missing_after_imputation: number[];
  longest_internal_gap_years: number;
  sentinel_values_removed: number;
  outlier_years: number[];
  outlier_rule?: string;
  unit_handling?: string;
  sufficient: boolean;
  n_years_1940_1979?: number;
};

export type AerosSeason = {
  season: SeasonKey;
  local_label: "winter" | "summer" | null;
  historical: { year: number; value: Num; imputed: boolean }[];
  trend: { fitted: { year: number; value: Num }[]; coefficients_high_to_low?: number[] };
  projection: { year: number; mean: Num; lower: Num; upper: Num }[];
  interval?: string;
  summary_end: { year: number; mean: Num; lower: Num; upper: Num; mc_standard_error_of_mean?: Num };
  slopes: {
    historical_1940_1979: Num;
    historical_range?: string;
    historical_n_years?: number;
    modern: Num;
    modern_range?: string;
    modern_n_years?: number;
    future_mean: Num;
    future_ci_low: Num;
    future_ci_high: Num;
    future_range?: string;
    instantaneous_end?: Num;
    acceleration?: Num;
  };
  ensemble: {
    members: AerosMember[];
    weighting_method?: string;
    validation_year?: number;
    hindcast_points?: number;
    stacked_hindcast?: { mae: Num; rmse: Num; bias: Num; n_points: number };
    error_sign_convention?: string;
    paths_with_all_members_rejected?: number;
  };
  residual_model?: { label: string; phi?: Num; innovation_sd?: Num };
  n_bootstrap?: number;
  data_quality: DataQuality;
};

export type AerosResult = BaseResult & {
  station: { id?: string | null; name?: string | null; lat?: Num; lon?: Num; country?: string | null; hemisphere: string };
  seed_label: string;
  hist_start_year: number;
  hist_end_year: number;
  end_year: number;
  seasons: Partial<Record<SeasonKey, AerosSeason>>;
  skipped_seasons: string[];
  disclaimer: string;
};

/* ---------------- Nexus ---------------- */

export type TrendWindow = {
  window: string;
  n: number;
  first_year?: number;
  last_year?: number;
  slope: Num;
  se: Num;
  ci_low: Num;
  ci_high: Num;
  p_value: Num;
  lag1_autocorrelation?: Num;
  n_effective?: Num;
  se_ar1_adjusted?: Num;
};

export type TrendChange = { change: Num; se: Num; ci_low: Num; ci_high: Num; p_value: Num; df?: number; method?: string };

export type NexusTrendSeason = { early: TrendWindow | null; modern: TrendWindow | null; change: TrendChange | null; local_label?: string | null };

export type Baseline = { mae: Num; rmse: Num; mean_bias: Num; description?: string; aeros_skill_score_vs_this: Num };

export type HindcastSeason = {
  test_years: [number, number];
  n_test: number;
  mae: Num;
  rmse: Num;
  mean_bias: Num;
  mean_bias_se: Num;
  observed_slope: Num;
  predicted_slope: Num;
  slope_error: Num;
  interval_coverage_95: Num;
  mean_interval_width: Num;
  direction_accuracy: Num;
  direction_definition?: string;
  trend_direction_correct?: boolean | null;
  baselines: { climatology_last30?: Baseline; linear_trend_full?: Baseline };
  per_year: { year: number; observed: Num; predicted: Num; lower: Num; upper: Num }[];
  ensemble_weights?: Record<string, number>;
  training_years_used?: number;
};

export type BiasAdjusted = {
  available: boolean;
  label: string;
  formula?: string;
  shrinkage?: number;
  hindcast_cutoff?: number;
  hindcast_mean_observed_minus_predicted?: Num;
  correction_c?: Num;
  hindcast_bias_distinguishable_from_zero?: boolean;
  caveat?: string;
  reason?: string;
  projection?: { year: number; mean: Num; lower: Num; upper: Num }[];
};

export type NexusStationResult = BaseResult & {
  mode: "station";
  station: { id?: string | null; name?: string | null; hemisphere?: string };
  data_quality?: { span: [number, number]; seasons: Partial<Record<SeasonKey, DataQuality>> };
  trends?: { method?: string; seasons: Partial<Record<SeasonKey, NexusTrendSeason>> };
  hindcast?: { cutoff: number; training_last_year?: number; n_bootstrap?: number; leakage_guard?: string; seasons: Partial<Record<SeasonKey, HindcastSeason>> };
  bias_correction?: {
    aeros_baseline: Partial<Record<SeasonKey, { projection: { year: number; mean: Num; lower: Num; upper: Num }[]; summary_end?: { year: number; mean: Num; lower: Num; upper: Num } }>>;
    aeros_baseline_note?: string;
    adjusted: Partial<Record<SeasonKey, BiasAdjusted>>;
  };
};

export type GroupCell = {
  n: number;
  mean_early: Num;
  mean_modern: Num;
  mean_change: Num;
  sd_change?: Num;
  n_increased: number;
  n_decreased: number;
  t_statistic?: Num;
  p_value: Num;
  ci_low: Num;
  ci_high: Num;
  df?: number;
  wilcoxon_p_value?: Num;
  station_ids?: string[];
};

export type GroupViews = {
  calendar: Partial<Record<SeasonKey, GroupCell>>;
  hemisphere_adjusted: Partial<Record<"winter" | "summer", GroupCell>>;
};

export type NexusSetResult = BaseResult & {
  mode: "station_set";
  station_set: {
    method: string;
    n_stations: number;
    groups: { all: GroupViews; by: Record<string, Record<string, GroupViews>> };
    stations: { id: string; name: string; country: string; urban_rural: string; hemisphere: string; seasons: Partial<Record<SeasonKey, NexusTrendSeason>> }[];
  };
};

/* ---------------- CORe ---------------- */

export type CoreResult = BaseResult & {
  inputs: { settings: Record<string, number>; historical: { first_year: number; last_year: number; n_years: number; last_ppm: number; source: string[] } };
  historical: { years: number[]; ppm: number[]; forcing_wm2: number[] };
  projection: {
    years: number[];
    ppm_mean: number[];
    ppm_lower: number[];
    ppm_upper: number[];
    forcing_wm2: number[];
    forcing_lower_wm2?: number[];
    forcing_upper_wm2?: number[];
    temperature_response_c: number[];
  };
  summary_end: {
    year: number;
    ppm_mean: number;
    ppm_lower: number;
    ppm_upper: number;
    forcing_wm2: number;
    forcing_lower_wm2?: number;
    forcing_upper_wm2?: number;
    temperature_response_c: number;
    conformal_base_error_ppm?: number;
  };
  ensemble: { model: string; weight: number }[];
  growth_constraints: Record<string, number | null>;
  validation: {
    candidates: { model: string; mae_ppm: Num; rmse_ppm: Num; bias_ppm: Num; n_validation_points: number; selected_for_ensemble: boolean; weight: Num }[];
    ensemble_backtest: { n_points: number; mae_ppm: Num; rmse_ppm: Num; bias_ppm: Num };
    failures: unknown[];
  };
};

/* ---------------- Catalyst ---------------- */

export type Band = { ecs: [number, number]; lower: Num[]; upper: Num[] };

export type CatalystPath = {
  label: string;
  emissions_gtco2: Num[];
  emissions_kind?: string;
  ppm: Num[];
  forcing_wm2: Num[];
  forcing_co2_wm2?: Num[];
  forcing_non_co2_wm2?: Num[];
  temperature_c: Num[];
  temperature_band_c?: { likely?: Band; very_likely?: Band };
  ppm_band?: { likely?: Band; very_likely?: Band };
  peak_warming?: { value_c: Num; year: number | null };
};

export type CatalystDeltaYear = {
  emissions_gtco2: Num;
  ppm: Num;
  forcing_wm2: Num;
  temperature_c: Num;
  baseline: { emissions_gtco2?: Num; ppm?: Num; temperature_c?: Num };
  scenario: { emissions_gtco2?: Num; ppm?: Num; temperature_c?: Num };
};

export type CatalystResult = BaseResult & {
  mode: "emissions" | "concentration";
  years: number[];
  baseline: CatalystPath;
  scenario: CatalystPath;
  delta: Record<string, CatalystDeltaYear>;
  cumulative_emissions_gtco2?: { period: [number, number]; baseline: Num; scenario: Num; difference: Num; kind?: string };
  history?: { years: number[]; ppm_observed: Num[]; emissions_gtco2: Num[]; emissions_source?: string };
  reference_state?: { year: number; ppm_observed: Num; temperature_c: Num; temperature_note?: string };
  assumptions: string[];
};

export type ValidationRow = {
  scenario: string;
  model_2050_ppm: Num;
  rcmip_2050_ppm: Num;
  error_2050_ppm: Num;
  error_2050_pct: Num;
  model_2100_ppm: Num;
  rcmip_2100_ppm: Num;
  error_2100_ppm: Num;
  error_2100_pct: Num;
  max_abs_error_2015_2100_ppm?: Num;
};

export type CatalystValidation = BaseResult & {
  validation: Record<
    string,
    {
      historical: {
        vs_noaa_global: { years: number[]; rmse_ppm: Num; bias_ppm: Num; max_abs_ppm: Num; last_year_error_ppm: Num };
        vs_rcmip_historical: { years: number[]; rmse_ppm: Num; max_abs_ppm: Num; error_2014_ppm: Num };
      };
      ssp: ValidationRow[];
    }
  >;
  assumptions: string[];
};
