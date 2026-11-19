"""Nexus 1.0 — validation and context layer for Aeros (new, simplified; numpy + scipy only).

Nexus never alters Aeros output. It provides:

* ``hindcast_audit``     — strict out-of-sample test: Aeros is re-run on data truncated at a cutoff
                            year (nothing after the cutoff is visible, not even to imputation), and
                            its projection is scored against the later observations, next to naive
                            baselines fitted on the same training data.
* ``rolling_origin``     — the same audit repeated for several cutoffs with a fixed horizon.
* ``trend_statistics``   — the poster's method: OLS slope (°C/decade) for 1940–1979 and
                            1980–latest with SE / 95% CI, and the change between the periods.
* ``station_set_trends`` — across many stations: paired t-test and 95% CI on the change, counts of
                            stations that increased, grouped by country / urban–rural.
* ``bias_corrected_view``— optional, separately labelled series: Aeros + shrinkage × mean(obs − pred)
                            from the hindcast. The Aeros baseline is returned untouched next to it.
* ``data_quality``       — span, missing years, imputed points, outliers.

Error sign convention everywhere: error = predicted − observed (positive = model too warm).
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
from scipy import stats

from . import aeros
from .aeros_io import local_season_label, station_hemisphere

NEXUS_VERSION = "1.0"
ERROR_CONVENTION = "error = predicted − observed (°C); positive mean bias = model too warm"


# ---------------------------------------------------------------------------
# Trend statistics
# ---------------------------------------------------------------------------

def ols_trend(years: Sequence[int], temps: Sequence[float], min_years: int = 10) -> Dict[str, Any]:
    """OLS slope in °C/decade with SE, t-based 95% CI, p-value, and an AR(1)-aware SE (extra field)."""
    x = np.asarray(years, dtype=float)
    y = np.asarray(temps, dtype=float)
    ok = np.isfinite(x) & np.isfinite(y)
    x, y = x[ok], y[ok]
    n = int(len(x))
    out: Dict[str, Any] = {"n": n, "first_year": int(x.min()) if n else None,
                           "last_year": int(x.max()) if n else None}
    if n < max(min_years, 3):
        out.update({"slope": None, "se": None, "ci_low": None, "ci_high": None, "p_value": None,
                    "note": f"fewer than {max(min_years, 3)} valid years"})
        return out
    xm = x.mean()
    sxx = float(np.sum((x - xm) ** 2))
    b = float(np.sum((x - xm) * (y - y.mean())) / sxx)
    a = y.mean() - b * xm
    resid = y - (a + b * x)
    s2 = float(np.sum(resid ** 2) / (n - 2))
    se = math.sqrt(s2 / sxx)
    tcrit = float(stats.t.ppf(0.975, n - 2))
    p = float(2 * stats.t.sf(abs(b / se), n - 2)) if se > 0 else 0.0
    # Lag-1 autocorrelation of residuals -> effective sample size (Santer et al. 2000 style); extra only
    r1 = float(np.corrcoef(resid[:-1], resid[1:])[0, 1]) if n > 3 and np.std(resid) > 0 else 0.0
    n_eff = n * (1 - r1) / (1 + r1) if r1 > 0 else float(n)
    se_adj = math.sqrt(s2 * (n - 2) / max(n_eff - 2, 1) / sxx) if n_eff > 2 else None
    out.update({
        "slope": b * 10.0, "se": se * 10.0,
        "ci_low": (b - tcrit * se) * 10.0, "ci_high": (b + tcrit * se) * 10.0,
        "p_value": p, "units": "°C/decade",
        "lag1_autocorrelation": r1, "n_effective": n_eff,
        "se_ar1_adjusted": se_adj * 10.0 if se_adj is not None else None,
    })
    return out


def trend_change(early: Dict[str, Any], modern: Dict[str, Any]) -> Dict[str, Any]:
    if early.get("slope") is None or modern.get("slope") is None:
        return {"change": None, "se": None, "ci_low": None, "ci_high": None, "p_value": None}
    d = modern["slope"] - early["slope"]
    se = math.sqrt(early["se"] ** 2 + modern["se"] ** 2)
    df = early["n"] + modern["n"] - 4
    tcrit = float(stats.t.ppf(0.975, df))
    p = float(2 * stats.t.sf(abs(d / se), df)) if se > 0 else 0.0
    return {"change": d, "se": se, "ci_low": d - tcrit * se, "ci_high": d + tcrit * se, "p_value": p,
            "df": df, "method": "difference of independent OLS slopes; SE = sqrt(se1² + se2²); t with n1+n2−4 df"}


def trend_statistics(years: Sequence[int], temps: Sequence[float], early=(1940, 1979), modern_start=1980,
                     min_years: int = 20) -> Dict[str, Any]:
    years = np.asarray(years, dtype=int)
    temps = np.asarray(temps, dtype=float)
    last = int(years.max()) if len(years) else modern_start
    m_e = (years >= early[0]) & (years <= early[1])
    m_m = (years >= modern_start) & (years <= last)
    e = ols_trend(years[m_e], temps[m_e], min_years)
    m = ols_trend(years[m_m], temps[m_m], min_years)
    e["window"] = f"{early[0]}-{early[1]}"
    m["window"] = f"{modern_start}-{last}"
    return {"early": e, "modern": m, "change": trend_change(e, m)}


# ---------------------------------------------------------------------------
# Hindcast audit
# ---------------------------------------------------------------------------

def _metrics(pred: np.ndarray, obs: np.ndarray) -> Dict[str, Any]:
    e = pred - obs
    return {"mae": float(np.mean(np.abs(e))), "rmse": float(np.sqrt(np.mean(e ** 2))),
            "mean_bias": float(np.mean(e)), "n": int(len(e))}


def _slope_dec(x, y):
    return float(np.polyfit(np.asarray(x, float), np.asarray(y, float), 1)[0] * 10.0) if len(x) >= 3 else None


def _baselines(train_years: np.ndarray, train_temps: np.ndarray, test_years: np.ndarray) -> Dict[str, np.ndarray]:
    out = {}
    last = train_years.max()
    recent = train_years > last - 30
    out["climatology_last30"] = np.full(len(test_years), float(np.mean(train_temps[recent])))
    if len(train_years) >= 3:
        out["linear_trend_full"] = np.poly1d(np.polyfit(train_years, train_temps, 1))(test_years)
    return out


BASELINE_DESCRIPTIONS = {
    "climatology_last30": "Persistence: mean of the last 30 training years (observed values only)",
    "linear_trend_full": "OLS straight line fitted to all training years, extrapolated",
}


def score_season(season: str, aeros_season: Dict[str, Any], obs_years: np.ndarray, obs_temps: np.ndarray,
                 cutoff: int, horizon_end: Optional[int] = None) -> Dict[str, Any]:
    """Score one season of a truncated Aeros run against observations after ``cutoff``."""
    fy = np.asarray(aeros_season["future_years"], dtype=int)
    mean = np.asarray(aeros_season["mean"])
    lo = np.asarray(aeros_season["lower"])
    hi = np.asarray(aeros_season["upper"])
    end = horizon_end if horizon_end is not None else int(obs_years.max()) if len(obs_years) else cutoff
    test = (obs_years > cutoff) & (obs_years <= end) & np.isin(obs_years, fy)
    ty, to = obs_years[test], obs_temps[test]
    if len(ty) < 3:
        return {"season": season, "n_test": int(len(ty)), "note": "fewer than 3 observed test years; not scored"}
    idx = np.searchsorted(fy, ty)
    p, l, h = mean[idx], lo[idx], hi[idx]

    train = obs_years <= cutoff
    try_, tro = obs_years[train], obs_temps[train]
    m = _metrics(p, to)
    base_mean = float(np.mean(tro[try_ > try_.max() - 30]))
    obs_slope, pred_slope = _slope_dec(ty, to), _slope_dec(ty, p)
    dir_obs = np.sign(to - base_mean)
    dir_pred = np.sign(p - base_mean)

    baselines = {}
    for name, bp in _baselines(try_, tro, ty).items():
        bm = _metrics(bp, to)
        bm["description"] = BASELINE_DESCRIPTIONS[name]
        mse_m, mse_b = m["rmse"] ** 2, bm["rmse"] ** 2
        bm["aeros_skill_score_vs_this"] = (1 - mse_m / mse_b) if mse_b > 0 else None
        baselines[name] = bm

    # residual test of the mean bias (is it distinguishable from 0?)
    e = p - to
    se_bias = float(np.std(e, ddof=1) / math.sqrt(len(e))) if len(e) > 1 else None

    return {
        "season": season,
        "test_years": [int(ty.min()), int(ty.max())],
        "n_test": int(len(ty)),
        **m,
        "mean_bias_se": se_bias,
        "error_convention": ERROR_CONVENTION,
        "observed_slope": obs_slope, "predicted_slope": pred_slope,
        "slope_error": (pred_slope - obs_slope) if (obs_slope is not None and pred_slope is not None) else None,
        "slope_units": "°C/decade over the test years (predicted = slope of the Aeros ensemble mean)",
        "interval_coverage_95": float(np.mean((to >= l) & (to <= h))),
        "mean_interval_width": float(np.mean(h - l)),
        "direction_accuracy": float(np.mean(dir_obs == dir_pred)),
        "direction_definition": ("share of test years where Aeros and the observation agree on being warmer or "
                                 f"cooler than the last-30-training-year mean ({base_mean:.2f} °C)"),
        "trend_direction_correct": (bool(np.sign(obs_slope) == np.sign(pred_slope))
                                    if obs_slope is not None and pred_slope is not None else None),
        "baselines": baselines,
        "skill_score_definition": "1 − MSE(Aeros)/MSE(baseline); > 0 means Aeros beat the baseline",
        "per_year": [{"year": int(y), "observed": float(o), "predicted": float(pp), "lower": float(ll),
                      "upper": float(hh)} for y, o, pp, ll, hh in zip(ty, to, p, l, h)],
    }


def _observed(years, values) -> Tuple[np.ndarray, np.ndarray]:
    ys, ts, _ = aeros.clean_series(years, values)
    return ys, ts


def hindcast_audit(label: str, years: Sequence[int], seasons: Dict[str, Sequence], cutoff: int = 2000,
                   n_bootstrap: int = 200, seed: int = 42, end_year: int = 2100,
                   horizon_end: Optional[int] = None) -> Dict[str, Any]:
    """Train Aeros on years <= cutoff only, score the forecast for cutoff+1 .. latest observation."""
    run = aeros.run_station(label, years, seasons, end_year=end_year, n_bootstrap=n_bootstrap, seed=seed,
                            train_end_year=cutoff, rolling_cv=False)
    out = {"cutoff": int(cutoff), "training_last_year": run["hist_end_year"], "seasons": {},
           "warnings": list(run["warnings"])}
    for season, vals in seasons.items():
        canon = aeros.SEASON_ALIASES.get(season)
        if canon is None or canon not in run["seasons"]:
            continue
        oy, ot = _observed(years, vals)
        sc = score_season(canon, run["seasons"][canon], oy, ot, cutoff, horizon_end)
        sc["ensemble_weights"] = {m["name"]: m["weight"] for m in run["seasons"][canon]["ensemble"]["members"]}
        sc["training_years_used"] = int(np.sum(oy <= cutoff))
        out["seasons"][canon] = sc
    return out


def rolling_origin(label: str, years, seasons, cutoffs: Iterable[int] = (1980, 1990, 2000, 2010), horizon: int = 10,
                   n_bootstrap: int = 100, seed: int = 42, end_year: int = 2100) -> Dict[str, Any]:
    rows, warnings = [], []
    for c in cutoffs:
        try:
            r = hindcast_audit(label, years, seasons, cutoff=int(c), n_bootstrap=n_bootstrap, seed=seed,
                               end_year=end_year, horizon_end=int(c) + horizon)
        except aeros.AerosInputError as exc:
            warnings.append(f"cutoff {c}: {exc}")
            continue
        for season, sc in r["seasons"].items():
            if "mae" not in sc:
                continue
            rows.append({"cutoff": int(c), "season": season, "test_years": sc["test_years"], "n_test": sc["n_test"],
                         "mae": sc["mae"], "rmse": sc["rmse"], "mean_bias": sc["mean_bias"],
                         "interval_coverage_95": sc["interval_coverage_95"],
                         "baseline_rmse": {k: v["rmse"] for k, v in sc["baselines"].items()}})
    summary = {}
    for season in sorted({r["season"] for r in rows}):
        rs = [r for r in rows if r["season"] == season]
        summary[season] = {
            "n_cutoffs": len(rs),
            "mean_mae": float(np.mean([r["mae"] for r in rs])),
            "mean_rmse": float(np.mean([r["rmse"] for r in rs])),
            "mean_bias": float(np.mean([r["mean_bias"] for r in rs])),
            "mean_coverage_95": float(np.mean([r["interval_coverage_95"] for r in rs])),
            "mean_baseline_rmse": {k: float(np.mean([r["baseline_rmse"][k] for r in rs if k in r["baseline_rmse"]]))
                                   for k in BASELINE_DESCRIPTIONS},
            "cutoffs_where_aeros_beat_all_baselines": int(sum(
                all(r["rmse"] < v for v in r["baseline_rmse"].values()) for r in rs)),
        }
    return {"cutoffs": [int(c) for c in cutoffs], "horizon_years": int(horizon), "n_bootstrap": int(n_bootstrap),
            "rows": rows, "summary": summary, "warnings": warnings, "error_convention": ERROR_CONVENTION}


# ---------------------------------------------------------------------------
# Bias-corrected view (separate series; Aeros output untouched)
# ---------------------------------------------------------------------------

def bias_corrected_view(aeros_seasons: Dict[str, Any], hindcast: Dict[str, Any], shrinkage: float = 0.5) -> Dict[str, Any]:
    """``aeros_seasons``: formatted Aeros result 'seasons' dict (projection lists)."""
    out = {}
    for season, s in aeros_seasons.items():
        h = hindcast["seasons"].get(season)
        if not h or "mean_bias" not in h:
            out[season] = {"available": False, "reason": "no scored hindcast for this season"}
            continue
        mean_actual_minus_pred = -h["mean_bias"]
        corr = float(shrinkage) * mean_actual_minus_pred
        se = h.get("mean_bias_se")
        significant = bool(se is not None and se > 0 and abs(mean_actual_minus_pred) > 2 * se)
        out[season] = {
            "available": True,
            "label": "Nexus bias-adjusted view (experimental; NOT the Aeros forecast)",
            "formula": "corrected = Aeros + shrinkage × mean(observed − predicted) from the hindcast",
            "shrinkage": float(shrinkage),
            "hindcast_cutoff": hindcast["cutoff"],
            "hindcast_mean_observed_minus_predicted": mean_actual_minus_pred,
            "correction_c": corr,
            "hindcast_bias_distinguishable_from_zero": significant,
            "caveat": ("Assumes the hindcast bias persists to 2100. A constant offset does not change any "
                       "slope or the interval width." + ("" if significant else
                       " The hindcast bias is within ±2 standard errors of zero, so this correction is within noise.")),
            "projection": [{"year": p["year"], "mean": p["mean"] + corr, "lower": p["lower"] + corr,
                            "upper": p["upper"] + corr} for p in s["projection"]],
        }
    return out


# ---------------------------------------------------------------------------
# Station-set statistics (poster method)
# ---------------------------------------------------------------------------

def _station_series(st: Dict[str, Any]):
    series = st.get("series") or {}
    years = series.get("years") or st.get("years")
    seasons = {k: v for k, v in series.items() if k != "years"} if series else (st.get("seasons") or {})
    return years, seasons


def _paired(early: np.ndarray, modern: np.ndarray) -> Dict[str, Any]:
    n = len(early)
    d = modern - early
    out = {"n": int(n), "mean_early": float(np.mean(early)) if n else None,
           "mean_modern": float(np.mean(modern)) if n else None,
           "mean_change": float(np.mean(d)) if n else None,
           "sd_change": float(np.std(d, ddof=1)) if n > 1 else None,
           "n_increased": int(np.sum(d > 0)), "n_decreased": int(np.sum(d < 0))}
    if n >= 2:
        t, p = stats.ttest_rel(modern, early)
        se = float(np.std(d, ddof=1) / math.sqrt(n))
        tcrit = float(stats.t.ppf(0.975, n - 1))
        out.update({"t_statistic": float(t), "p_value": float(p), "ci_low": out["mean_change"] - tcrit * se,
                    "ci_high": out["mean_change"] + tcrit * se, "df": n - 1})
        if n >= 6 and np.any(d != 0):
            try:
                w = stats.wilcoxon(d)
                out["wilcoxon_p_value"] = float(w.pvalue)
            except Exception:  # pragma: no cover
                pass
    return out


def station_set_trends(stations: List[Dict[str, Any]], group_by: Sequence[str] = ("country", "urban_rural"),
                       min_years: int = 20, early=(1940, 1979), modern_start=1980) -> Dict[str, Any]:
    per_station, warnings = [], []
    for st in stations:
        years, seasons = _station_series(st)
        if not years:
            warnings.append(f"{st.get('id') or st.get('name')}: no series; skipped")
            continue
        hemi, _ = station_hemisphere(st)
        rec = {"id": st.get("id"), "name": st.get("display_name") or st.get("name"),
               "country": st.get("country"), "urban_rural": st.get("urban_rural"), "hemisphere": hemi,
               "set": st.get("set"), "seasons": {}}
        for key, vals in seasons.items():
            canon = aeros.SEASON_ALIASES.get(key)
            if canon is None:
                continue
            oy, ot = _observed(years, vals)
            if len(oy) == 0:
                continue
            ts = trend_statistics(oy, ot, early, modern_start, min_years)
            ts["local_label"] = local_season_label(canon, hemi)
            rec["seasons"][canon] = ts
        per_station.append(rec)

    def collect(recs, key_fn):
        groups: Dict[str, Tuple[List[float], List[float], List[str]]] = {}
        for r in recs:
            for canon, ts in r["seasons"].items():
                k = key_fn(canon, ts)
                if k is None:
                    continue
                if ts["early"]["slope"] is None or ts["modern"]["slope"] is None:
                    continue
                g = groups.setdefault(k, ([], [], []))
                g[0].append(ts["early"]["slope"]); g[1].append(ts["modern"]["slope"]); g[2].append(r["id"])
        return {k: dict(_paired(np.array(v[0]), np.array(v[1])), station_ids=v[2]) for k, v in sorted(groups.items())}

    def season_views(recs):
        return {
            "calendar": collect(recs, lambda c, ts: c),
            "hemisphere_adjusted": collect(recs, lambda c, ts: ts.get("local_label")),
        }

    result = {"all": season_views(per_station), "by": {}}
    for attr in group_by:
        vals = sorted({str(r.get(attr)) for r in per_station if r.get(attr) is not None})
        result["by"][attr] = {v: season_views([r for r in per_station if str(r.get(attr)) == v]) for v in vals}
    excluded = [f"{r['id']} {c}" for r in per_station for c, ts in r["seasons"].items()
                if ts["early"]["slope"] is None or ts["modern"]["slope"] is None]
    if excluded:
        warnings.append(f"{len(excluded)} station-season(s) lack {min_years} valid years in a window and are "
                        f"excluded from the paired tests: {excluded}")
    return {
        "method": (f"Per station and season: OLS slope (°C/decade) for {early[0]}–{early[1]} and {modern_start}–latest "
                   f"(observed values only, ≥{min_years} valid years per window). Across stations: paired t-test of "
                   "modern vs early slope, t-based 95% CI on the mean change, Wilcoxon signed-rank p as a robustness check."),
        "n_stations": len(per_station),
        "groups": result,
        "stations": per_station,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Data-quality report (single station)
# ---------------------------------------------------------------------------

def data_quality_report(years, seasons: Dict[str, Sequence], unit_mode: str = "celsius") -> Dict[str, Any]:
    vals = [v for s in seasons.values() for v in (s or []) if v is not None]
    scale, note = aeros.infer_unit_scale(
        [v for v in vals if not any(abs(float(v) - x) < 1e-9 for x in aeros.SENTINELS)], unit_mode)
    cleaned = {}
    for key, v in seasons.items():
        canon = aeros.SEASON_ALIASES.get(key)
        if canon and v is not None:
            cleaned[canon] = aeros.clean_series(years, v, scale)
    nonempty = [c for c in cleaned.values() if len(c[0])]
    if not nonempty:
        return {"seasons": {}, "note": "no valid values"}
    cmin = int(min(c[0].min() for c in nonempty))
    cmax = int(max(c[0].max() for c in nonempty))
    out = {}
    for canon, (ys, ts, ns) in cleaned.items():
        imputed = []
        if len(ys) >= 1:
            full, _, mask = aeros.impute_missing_years_pchip(ys, ts) if len(ys) else (ys, ts, [])
            imputed = [int(y) for y in full[mask]]
        out[canon] = aeros.data_quality(canon, ys, ts, cmin, cmax, imputed, ns,
                                        aeros.NOTEBOOK_CONFIG["MIN_YEARS"], note)
    return {"span": [cmin, cmax], "seasons": out}
