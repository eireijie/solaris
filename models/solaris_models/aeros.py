"""Aeros 4.0 — headless, Pyodide-compatible port of the Solaris Aeros 4.0 notebook.

Source: reference/notebook_cells/cell01.py (feature add-on) + cell02.py (main cell).

What is preserved from the notebook's *recorded* run (fast_mode=True, the configuration that
produced the poster's Washington, D.C. numbers):

* CSV-equivalent ingestion: sentinel values (999.9, -999.9, 9999, -9999) -> missing, unit scaling
  (``infer_unit_scale``; default "celsius" = values used as supplied).
* Missing-year imputation (``impute_missing_years_pchip``): PCHIP inside each season's observed
  span only, then linear/ffill/bfill fallback.
* Ensemble members poly2, pchip, ridge (RidgeCV, alphas 0.01/0.1/1, TimeSeriesSplit(3)),
  lin_modern (OLS on years >= 1980). GP / Prophet are only used by the notebook's full mode and
  were *not* active in the recorded run, so they are not ported.
* Decadal hindcast (1940.., folds clipped to the validation year) -> SLSQP stacking weights
  (sum to 1, bounds [0, 1]); inverse-RMSE fallback; uniform weights if there are no folds.
* Residual model: quadratic trend residuals -> AR(1) (the recorded run printed
  "Residual simulator: AR1"); SIMPLE_NOISE when < 30 years. GARCH is full-mode only (dropped).
* Bootstrap: per-path seeds from ``SeedSequence(seed + stable_int_seed(city, season)).spawn(N)``,
  residual block bootstrap with ACF-chosen block size, +N(0, 0.15 °C) observation noise, refit of
  every member, physical sanity filter (2 °C/decade), weighted stack re-anchored to the quadratic
  trend at the last observed year, plus a simulated AR(1) residual path.
* Summary: ensemble mean (nanmean), 2.5/97.5 percentiles, future slope mean + 2.5/97.5 percentile,
  instantaneous 2100 slope (last 5 years of the mean), 1940–1979 and 1980–latest slopes,
  acceleration = future − modern.

Numerical re-implementations (no sklearn / statsmodels at runtime):

* ``RidgeCV`` + ``TimeSeriesSplit`` -> closed-form Cholesky ridge with the same CV/selection rule.
* ``LinearRegression`` -> centred least squares.
* statsmodels ``ARIMA(1,0,0, enforce_stationarity=False)`` (Kalman filter MLE with approximate
  diffuse initialisation) -> conditional least squares, which is the same estimator up to the
  diffuse-prior approximation and optimiser tolerance (|Δφ| ~ 1e-5).
* statsmodels ``acf`` / ``mad`` -> direct numpy equivalents (exact).

Everything here is pure numpy + scipy, has no I/O and no threads.
"""
from __future__ import annotations

import hashlib
import math
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy.interpolate import PchipInterpolator
from scipy.linalg import lstsq as _sp_lstsq
from scipy.linalg import solve as _sp_solve
from scipy.optimize import minimize
from scipy.stats import norm as _norm

AEROS_VERSION = "4.0"
PORT_REVISION = "solaris-summit-1"

SEASONS = ("D-J-F", "J-J-A")
SEASON_ALIASES = {
    "D-J-F": "D-J-F", "DJF": "D-J-F", "djf": "D-J-F", "d-j-f": "D-J-F",
    "J-J-A": "J-J-A", "JJA": "J-J-A", "jja": "J-J-A", "j-j-a": "J-J-A",
}
SENTINELS = (999.9, -999.9, 9999.0, -9999.0)

# Notebook CONFIG (cell02.py) — only the keys that influence the numbers.
NOTEBOOK_CONFIG: Dict[str, Any] = {
    "N_BOOT_FAST": 200,           # recorded run: fast_mode=True
    "N_BOOT_FULL": 500,
    "RNG_SEED": 42,
    "OBS_ERR_STD": 0.15,          # °C
    "BLOCK_SIZE_DEFAULT": 5,
    "CALIB_START": 1940, "CALIB_END": 1979,
    "MODERN_START": 1980,
    "FUT_END": 2100,
    "FROZEN_VALIDATION_YEAR": 2014,
    "MIN_YEARS": 10,
    "AEROS4_DRIFT_PER_DECADE": 2.0,
    "INPUT_UNIT_MODE": "celsius",
    "IMPUTE_MISSING_YEARS": True,
    "DO_ROLLING_CV_DIAGNOSTICS": True,
    "USE_CV_MODEL_FILTER": False,
}

MODEL_DESCRIPTIONS = {
    "poly2": "Quadratic polynomial in year (numpy.polyfit, degree 2)",
    "pchip": "Shape-preserving PCHIP interpolant, extrapolated (scipy PchipInterpolator)",
    "ridge": "Cubic polynomial ridge regression, alpha by 3-fold time-series CV (0.01/0.1/1)",
    "lin_modern": "Ordinary least-squares line fitted to years >= 1980",
}


class AerosInputError(ValueError):
    """Raised for payloads Aeros cannot run on (too short, malformed, ...)."""


# ---------------------------------------------------------------------------
# cell01 helpers
# ---------------------------------------------------------------------------

def stable_int_seed(*parts, max_value=2 ** 31 - 1):
    """Verbatim from cell01: reproducible seed independent of Python's hash()."""
    text = "|".join(map(str, parts)).encode("utf-8")
    digest = hashlib.blake2s(text, digest_size=4).hexdigest()
    return int(digest, 16) % max_value


def infer_unit_scale(values, mode="celsius"):
    """Port of cell01 ``infer_unit_scale`` (pandas quantile == numpy linear quantile)."""
    vals = np.asarray([v for v in values if v is not None], dtype=float)
    vals = vals[np.isfinite(vals)]
    if mode == "celsius":
        return 1.0, "degrees_C_as_uploaded"
    if mode == "hundredths_c":
        return 0.01, "hundredths_C_scaled_to_C"
    if len(vals) == 0:
        return 1.0, "auto_unknown_assumed_C"
    if np.quantile(np.abs(vals), 0.95) > 10 and np.median(np.abs(vals)) > 2:
        return 0.01, "auto_detected_hundredths_C_scaled_to_C"
    return 1.0, "auto_detected_C_as_uploaded"


def impute_missing_years_pchip(years: np.ndarray, temps: np.ndarray):
    """Port of cell01 ``impute_missing_years_pchip`` for one city/season.

    Returns (full_years, filled_temps, imputed_mask). Only fills inside [min(year), max(year)].
    """
    order = np.argsort(years)
    years = np.asarray(years, dtype=int)[order]
    temps = np.asarray(temps, dtype=float)[order]
    full = np.arange(years.min(), years.max() + 1)
    vals = np.full(len(full), np.nan)
    vals[years - years.min()] = temps
    imputed = ~np.isfinite(vals)
    known = ~imputed
    if known.sum() >= 4:
        interp = PchipInterpolator(full[known].astype(float), vals[known], extrapolate=False)
        fill = interp(full.astype(float))
        vals = np.where(imputed, fill, vals)
    # pandas .interpolate() (linear on position) then ffill/bfill
    ok = np.isfinite(vals)
    if not ok.all() and ok.any():
        idx = np.arange(len(vals))
        first, last = idx[ok][0], idx[ok][-1]
        inner = (~ok) & (idx > first) & (idx < last)
        vals[inner] = np.interp(idx[inner], idx[ok], vals[ok])
        vals[idx < first] = vals[first]
        vals[idx > last] = vals[last]
    return full, vals, imputed


# ---------------------------------------------------------------------------
# statsmodels / sklearn replacements
# ---------------------------------------------------------------------------

_MAD_C = float(_norm.ppf(0.75))  # statsmodels.robust.scale.mad normalisation constant


def mad_statsmodels(a) -> float:
    """statsmodels.robust.scale.mad: median(|a - median(a)|) / 0.6745."""
    a = np.asarray(a, dtype=float)
    return float(np.median(np.abs(a - np.median(a))) / _MAD_C)


def acf_statsmodels(x, nlags: int) -> np.ndarray:
    """statsmodels.tsa.stattools.acf(x, nlags, fft=True) for a series without NaNs."""
    x = np.asarray(x, dtype=float)
    n = len(x)
    xd = x - x.mean()
    denom = float(np.dot(xd, xd))
    if denom == 0:
        return np.full(nlags + 1, np.nan)
    full = np.correlate(xd, xd, mode="full")[n - 1:]
    return full[: nlags + 1] / denom


def _r2(y_true, y_pred) -> float:
    """sklearn.metrics.r2_score (force_finite=True; NaN for < 2 samples)."""
    y_true = np.asarray(y_true, dtype=float)
    if len(y_true) < 2:
        return float("nan")
    ss_res = float(np.sum((y_true - y_pred) ** 2))
    ss_tot = float(np.sum((y_true - y_true.mean()) ** 2))
    if ss_tot == 0:
        return 1.0 if ss_res == 0 else 0.0
    return 1.0 - ss_res / ss_tot


def _ridge_fit(X: np.ndarray, y: np.ndarray, alpha: float):
    """sklearn Ridge(fit_intercept=True, solver='auto'->'cholesky') on dense data."""
    x_off = X.mean(axis=0)
    y_off = y.mean()
    Xc = X - x_off
    yc = y - y_off
    A = Xc.T @ Xc
    A.flat[:: X.shape[1] + 1] += alpha
    coef = _sp_solve(A, Xc.T @ yc, assume_a="pos", overwrite_a=True)
    intercept = y_off - x_off @ coef
    return coef, intercept


def _time_series_split(n: int, n_splits: int = 3):
    """sklearn TimeSeriesSplit(n_splits) index generator (gap=0, no max_train_size)."""
    n_folds = n_splits + 1
    if n_folds > n:
        raise ValueError("Cannot have number of folds greater than the number of samples.")
    test_size = n // n_folds
    if n - test_size * n_splits <= 0:
        raise ValueError("Too many splits for number of samples.")
    for start in range(n - n_splits * test_size, n, test_size):
        yield np.arange(0, start), np.arange(start, start + test_size)


def ridge_cv_predict(V: np.ndarray, y: np.ndarray, Vf: np.ndarray,
                     alphas=(0.01, 0.1, 1.0), n_splits: int = 3) -> np.ndarray:
    """RidgeCV(alphas, cv=TimeSeriesSplit(n_splits)).fit(V, y).predict(Vf), closed form.

    GridSearchCV semantics: mean R² over folds; NaN folds -> NaN mean, ranked worst;
    ties -> first alpha; refit on all rows with the best alpha.
    """
    splits = list(_time_series_split(len(y), n_splits))
    means = []
    for a in alphas:
        scores = []
        for tr, te in splits:
            coef, icpt = _ridge_fit(V[tr], y[tr], a)
            scores.append(_r2(y[te], V[te] @ coef + icpt))
        means.append(float(np.mean(scores)))
    means = np.asarray(means)
    if np.isnan(means).all():
        best = 0
    else:
        filled = np.where(np.isnan(means), np.nanmin(means) - 1, means)
        best = int(np.argmax(filled))  # first maximum == rank 'min' argmin
    coef, icpt = _ridge_fit(V, y, alphas[best])
    return Vf @ coef + icpt


def _linear_regression_predict(x: np.ndarray, y: np.ndarray, xf: np.ndarray) -> np.ndarray:
    """sklearn LinearRegression on one feature (centred scipy lstsq)."""
    x = np.asarray(x, dtype=float)
    xm, ym = x.mean(), y.mean()
    coef = _sp_lstsq((x - xm).reshape(-1, 1), y - ym)[0]
    return (np.asarray(xf, dtype=float) - xm) * coef[0] + ym


# ---------------------------------------------------------------------------
# Ensemble members (cell02) — same structure, same fallbacks
# ---------------------------------------------------------------------------

def make_model_funcs(cfg: Dict[str, Any]) -> Dict[str, Callable]:
    modern_start = cfg["MODERN_START"]

    def model_poly2(Xtr, ytr, Xte):
        try:
            return np.poly1d(np.polyfit(Xtr, ytr, 2))(Xte)
        except Exception:
            return np.poly1d(np.polyfit(Xtr, ytr, 1))(Xte)

    def model_lin_modern(Xtr, ytr, Xte):
        try:
            modern_mask = Xtr >= modern_start
            if modern_mask.sum() < 5:
                modern_mask = np.ones_like(Xtr, dtype=bool)
            return _linear_regression_predict(Xtr[modern_mask], ytr[modern_mask], Xte)
        except Exception:
            return np.poly1d(np.polyfit(Xtr, ytr, 1))(Xte)

    def model_pchip(Xtr, ytr, Xte):
        try:
            order = np.argsort(Xtr)
            Xs, ys = Xtr[order], ytr[order]
            if len(np.unique(Xs)) < len(Xs):
                ux, inv = np.unique(Xs, return_inverse=True)
                ys = np.bincount(inv, weights=ys) / np.bincount(inv)
                Xs = ux
            return PchipInterpolator(Xs, ys, extrapolate=True)(Xte)
        except Exception:
            return model_poly2(Xtr, ytr, Xte)

    def model_ridge(Xtr, ytr, Xte):
        try:
            xc = Xtr.mean()
            V = np.vstack([(Xtr - xc) ** d for d in range(1, 4)]).T
            Vf = np.vstack([(Xte - xc) ** d for d in range(1, 4)]).T
            return ridge_cv_predict(V, np.asarray(ytr, dtype=float), Vf)
        except Exception:
            return model_poly2(Xtr, ytr, Xte)

    # dict order matters (stacking column order, SLSQP start) — same as the notebook
    return {
        "poly2": model_poly2,
        "pchip": model_pchip,
        "ridge": model_ridge,
        "lin_modern": model_lin_modern,
    }


# ---------------------------------------------------------------------------
# Hindcast weights, residual model, bootstrap (cell02)
# ---------------------------------------------------------------------------

def rolling_forecast_cv(years, temps, model_funcs, min_train_years=30, horizon=10, step=5):
    """Port of cell01 ``rolling_forecast_cv_generic`` (diagnostic only; returns row dicts)."""
    rows = []
    years = np.asarray(years, dtype=int)
    temps = np.asarray(temps, dtype=float)
    for cutoff in range(int(years.min() + min_train_years - 1), int(years.max() - horizon) + 1, step):
        train = years <= cutoff
        test = (years > cutoff) & (years <= cutoff + horizon)
        if train.sum() < min_train_years or test.sum() < 3:
            continue
        Xtr, ytr, Xte, yte = years[train], temps[train], years[test], temps[test]
        for name, func in model_funcs.items():
            try:
                pred = np.asarray(func(Xtr, ytr, Xte), dtype=float)
                err = pred - yte
                rows.append({"cutoff": int(cutoff), "test_start": int(Xte.min()), "test_end": int(Xte.max()),
                             "model": name, "mae": float(np.mean(np.abs(err))),
                             "rmse": float(np.sqrt(np.mean(err ** 2))), "bias": float(np.mean(err))})
            except Exception as exc:  # pragma: no cover - mirrors notebook
                rows.append({"cutoff": int(cutoff), "model": name, "mae": None, "rmse": None,
                             "bias": None, "error": str(exc)})
    return rows


def decadal_hindcast_predictions(years, temps, model_funcs, validation_year, calib_start):
    targets, target_years, preds, folds = [], [], {n: [] for n in model_funcs}, []
    for d in range(calib_start, validation_year, 10):
        test_end = min(d + 10, validation_year)
        train_mask = years < d
        test_mask = (years >= d) & (years < test_end)
        if test_mask.sum() < 3 or train_mask.sum() < 5:
            continue
        Xtr, ytr = years[train_mask], temps[train_mask]
        Xte, yte = years[test_mask], temps[test_mask]
        targets.append(yte)
        target_years.append(Xte)
        folds.append({"train_end": int(d - 1), "test_start": int(d), "test_end": int(test_end - 1),
                      "n_train": int(train_mask.sum()), "n_test": int(test_mask.sum())})
        for name, func in model_funcs.items():
            try:
                preds[name].append(np.asarray(func(Xtr, ytr, Xte), dtype=float))
            except Exception:
                preds[name].append(np.full_like(yte, np.nan, dtype=float))
    if not targets:
        return None, None, None, folds
    return (np.concatenate(targets), {n: np.concatenate(p) for n, p in preds.items()},
            np.concatenate(target_years), folds)


def solve_stacking_weights(targets, preds_by_model):
    """Verbatim logic of cell02 ``solve_stacking_weights``. Returns (weights, method)."""
    names = list(preds_by_model.keys())
    P = np.column_stack([preds_by_model[n] for n in names])
    valid_rows = ~np.any(np.isnan(P), axis=1) & ~np.isnan(targets)
    if valid_rows.sum() < len(names) + 1:
        return {n: 1.0 / len(names) for n in names}, "uniform (too few valid hindcast rows)"
    P, t = P[valid_rows], targets[valid_rows]
    n_models = len(names)
    w0 = np.full(n_models, 1.0 / n_models)
    constraints = ({"type": "eq", "fun": lambda w: np.sum(w) - 1.0},)
    bounds = [(0.0, 1.0)] * n_models

    def loss(w):
        return np.mean((P @ w - t) ** 2)

    try:
        res = minimize(loss, w0, method="SLSQP", bounds=bounds, constraints=constraints,
                       options={"maxiter": 200, "ftol": 1e-9})
        if not res.success:
            raise RuntimeError(res.message)
        w = np.clip(res.x, 0, 1)
        s = w.sum()
        w = w / s if s > 0 else w0
        return {n: float(w[i]) for i, n in enumerate(names)}, "SLSQP stacking on decadal hindcast"
    except Exception:
        rmse = np.sqrt(np.mean((P - t[:, None]) ** 2, axis=0))
        inv = 1.0 / (rmse + 1e-12)
        inv /= inv.sum()
        return {n: float(inv[i]) for i, n in enumerate(names)}, "inverse-RMSE (SLSQP failed)"


def fit_ar1(resid: np.ndarray):
    """Active path of cell02 ``fit_ar_garch(resid, use_garch=False)``.

    Returns (simulate, label, params). ``simulate(n, rng)`` draws one residual path.
    The notebook adds statsmodels' ``const`` (which is the process *mean*) as an intercept in
    the recursion; that is preserved (the mean of quadratic-fit residuals is ~0 anyway).
    """
    resid = np.asarray(resid, dtype=float)
    if len(resid) < 30 or np.allclose(np.std(resid), 0):
        sd = float(np.std(resid)) if len(resid) > 1 else 0.1

        def simulate(n_sim, rng):
            return rng.normal(0, sd, size=n_sim)

        return simulate, "SIMPLE_NOISE", {"sd": sd, "reason": "fewer than 30 years" if len(resid) < 30 else "zero variance"}
    try:
        X = np.column_stack([np.ones(len(resid) - 1), resid[:-1]])
        c, phi = np.linalg.lstsq(X, resid[1:], rcond=None)[0]
        if not np.isfinite(phi) or abs(1.0 - phi) < 1e-12:
            raise RuntimeError("degenerate AR(1) fit")
        mean = float(c / (1.0 - phi))
        ar_resid = np.empty_like(resid)
        ar_resid[0] = resid[0] - mean
        ar_resid[1:] = resid[1:] - mean - phi * (resid[:-1] - mean)
        sd = float(np.std(ar_resid))
        phi = float(phi)
        start = float(resid[-1])

        def simulate(n_sim, rng):
            eps = rng.normal(0, sd, size=n_sim)  # identical stream to n scalar draws
            sim = np.empty(n_sim)
            prev = start
            for t in range(n_sim):
                prev = mean + phi * prev + eps[t]
                sim[t] = prev
            return sim

        return simulate, "AR1", {"phi": phi, "const": mean, "innovation_sd": sd, "start_value": start}
    except Exception as exc:
        sd = float(np.std(resid))

        def simulate(n_sim, rng):
            return rng.normal(0, sd, size=n_sim)

        return simulate, "SIMPLE_NOISE", {"sd": sd, "reason": f"AR(1) fit failed: {exc}"}


def choose_block_size(resid, default_block):
    if len(resid) < 10:
        return default_block
    ac = acf_statsmodels(resid, nlags=min(50, len(resid) - 1))
    lags = np.where(ac < math.exp(-1))[0]
    if len(lags) >= 1:
        return max(1, min(int(lags[0]), 20))
    l2 = np.where(ac < 0.5)[0]
    if len(l2) >= 1:
        return max(1, min(int(l2[0]), 20))
    return default_block


def block_bootstrap_residuals(resid, n_target, block_size, rng):
    n = len(resid)
    if block_size <= 1 or n < 2:
        return rng.choice(resid, size=n_target, replace=True)
    nblocks = int(np.ceil(n_target / block_size))
    starts = rng.integers(0, max(1, n - block_size + 1), size=nblocks)
    out = np.concatenate([resid[s:s + block_size] for s in starts])
    return out[:n_target]


def sanitize_prediction(pred, ytr, future_years, drift_per_decade):
    if not np.all(np.isfinite(pred)):
        return None
    last_obs = ytr[-5:].mean()
    n_decades = max((future_years[-1] - future_years[0]) / 10.0, 1.0)
    change = drift_per_decade * n_decades
    if abs(pred[-1] - last_obs) > change:
        return None
    if (pred.max() - pred.min()) > change * 1.5:
        return None
    return pred


def bootstrap_iteration(seed, years, future_years, model_funcs, weights, q_trend, resid,
                        block, simulator, obs_err_std, drift_per_decade):
    """cell02 ``bootstrap_iteration``; also returns which members passed the sanity filter."""
    rng = np.random.default_rng(seed)
    boot_resid = block_bootstrap_residuals(resid, len(years), block, rng)
    yb = q_trend(years) + boot_resid
    yb = yb + rng.normal(0, obs_err_std, size=len(yb))

    valid_preds, valid_weights = {}, {}
    for name, func in model_funcs.items():
        clean = sanitize_prediction(func(years, yb, future_years), yb, future_years, drift_per_decade)
        if clean is not None:
            valid_preds[name] = clean
            valid_weights[name] = weights[name]

    if not valid_preds:
        stacked = model_funcs["lin_modern"](years, yb, future_years)
    else:
        wsum = sum(valid_weights.values())
        if wsum <= 0:
            stacked = np.mean(np.column_stack(list(valid_preds.values())), axis=1)
        else:
            valid_weights = {k: v / wsum for k, v in valid_weights.items()}
            stacked = sum(valid_weights[m] * np.asarray(valid_preds[m]) for m in valid_weights)

    offset = q_trend(years.max()) - stacked[0]
    stacked = stacked + offset
    temps_future = stacked + simulator(len(future_years), rng)
    slope = np.polyfit(future_years - future_years[0], temps_future, 1)[0] * 10.0
    return temps_future, slope, tuple(valid_preds.keys())


def slope_summary(slope_samples):
    if slope_samples.size == 0 or np.all(np.isnan(slope_samples)):
        return np.nan, np.nan, np.nan
    clean = slope_samples[~np.isnan(slope_samples)]
    if clean.size < 5:
        return float(np.nanmean(slope_samples)), np.nan, np.nan
    return float(np.mean(clean)), float(np.percentile(clean, 2.5)), float(np.percentile(clean, 97.5))


def _ols_slope_per_decade(x, y):
    return float(np.polyfit(x, y, 1)[0] * 10.0)


# ---------------------------------------------------------------------------
# One season (cell02 run_projection_for_city, per-season body)
# ---------------------------------------------------------------------------

def project_season(city_name: str, season: str, years: np.ndarray, temps: np.ndarray,
                   hist_end_year: int, cfg: Dict[str, Any], n_boot: int, seed: int,
                   n_paths_out: int = 0, rolling_cv: bool = True) -> Dict[str, Any]:
    """Run the Aeros 4.0 season pipeline on an (already imputed) series.

    ``hist_end_year`` is the *city-level* last year (max over all seasons), as in the notebook.
    """
    years = np.asarray(years, dtype=int)
    temps = np.asarray(temps, dtype=float)
    order = np.argsort(years)
    years, temps = years[order], temps[order]

    future_years = np.arange(hist_end_year + 1, cfg["FUT_END"] + 1)
    if len(future_years) < 2:
        raise AerosInputError("end_year must be at least two years after the last observed year.")
    validation_year = min(cfg["FROZEN_VALIDATION_YEAR"], hist_end_year - 10)
    validation_year = max(validation_year, cfg["CALIB_START"] + 20)

    try:
        coeffs = np.polyfit(years, temps, 2)
    except Exception:
        coeffs = np.polyfit(years, temps, 1)
    q_trend = np.poly1d(coeffs)
    resid = temps - q_trend(years)

    model_funcs = make_model_funcs(cfg)

    cv_rows = []
    if rolling_cv:
        cv_rows = rolling_forecast_cv(years, temps, model_funcs, min_train_years=30, horizon=10, step=5)

    targets, fold_preds, target_years, folds = decadal_hindcast_predictions(
        years, temps, model_funcs, validation_year, cfg["CALIB_START"])
    if targets is None:
        weights = {m: 1.0 / len(model_funcs) for m in model_funcs}
        weight_method = "uniform (no hindcast folds)"
    else:
        weights, weight_method = solve_stacking_weights(targets, fold_preds)

    simulator, sim_label, sim_params = fit_ar1(resid)
    block = choose_block_size(resid, cfg["BLOCK_SIZE_DEFAULT"])

    seed_seq = np.random.SeedSequence(seed + stable_int_seed(city_name, season))
    seeds = [int(s.generate_state(1)[0]) for s in seed_seq.spawn(n_boot)]

    paths = np.empty((n_boot, len(future_years)))
    slopes = np.empty(n_boot)
    kept_counts = {m: 0 for m in model_funcs}
    n_all_rejected = 0
    for i, s in enumerate(seeds):
        p, sl, kept = bootstrap_iteration(s, years, future_years, model_funcs, weights, q_trend, resid,
                                          block, simulator, cfg["OBS_ERR_STD"], cfg["AEROS4_DRIFT_PER_DECADE"])
        paths[i] = p
        slopes[i] = sl
        for k in kept:
            kept_counts[k] += 1
        if not kept:
            n_all_rejected += 1

    ens_mean = np.nanmean(paths, axis=0)
    # extra diagnostic (not in the notebook): Monte-Carlo standard error of the ensemble mean
    mc_se = np.nanstd(paths, axis=0, ddof=1) / math.sqrt(max(n_boot, 1))
    ci_lower = np.nanpercentile(paths, 2.5, axis=0)
    ci_upper = np.nanpercentile(paths, 97.5, axis=0)
    inst_slope = float(np.polyfit(future_years[-5:] - future_years[-5:].mean(), ens_mean[-5:], 1)[0] * 10.0)
    fut_mean, fut_lo, fut_hi = slope_summary(slopes)

    calib_mask = (years >= cfg["CALIB_START"]) & (years <= cfg["CALIB_END"])
    modern_mask = (years >= cfg["MODERN_START"]) & (years <= hist_end_year)
    hist_slope = _ols_slope_per_decade(years[calib_mask], temps[calib_mask]) if calib_mask.sum() >= 2 else float("nan")
    modern_slope = _ols_slope_per_decade(years[modern_mask], temps[modern_mask]) if modern_mask.sum() >= 2 else float("nan")
    acceleration = fut_mean - modern_slope

    # hindcast errors per member (prediction − observed) on the decadal folds used for weights
    member_rows = []
    for name in model_funcs:
        row = {"name": name, "weight": float(weights[name]), "description": MODEL_DESCRIPTIONS[name],
               "sanity_pass_fraction": kept_counts[name] / n_boot}
        if targets is not None:
            err = fold_preds[name] - targets
            ok = np.isfinite(err)
            row.update({
                "hindcast_mae": float(np.mean(np.abs(err[ok]))) if ok.any() else None,
                "hindcast_rmse": float(np.sqrt(np.mean(err[ok] ** 2))) if ok.any() else None,
                "hindcast_bias": float(np.mean(err[ok])) if ok.any() else None,
            })
        else:
            row.update({"hindcast_mae": None, "hindcast_rmse": None, "hindcast_bias": None})
        member_rows.append(row)
    stacked_hindcast = None
    if targets is not None:
        P = np.column_stack([fold_preds[n] for n in model_funcs])
        w = np.array([weights[n] for n in model_funcs])
        ok = ~np.any(np.isnan(P), axis=1)
        e = P[ok] @ w - targets[ok]
        stacked_hindcast = {"mae": float(np.mean(np.abs(e))), "rmse": float(np.sqrt(np.mean(e ** 2))),
                            "bias": float(np.mean(e)), "n_points": int(ok.sum())}

    cv_summary = []
    for name in model_funcs:
        rows = [r for r in cv_rows if r["model"] == name and r.get("rmse") is not None]
        if rows:
            cv_summary.append({"model": name, "n_cutoffs": len(rows),
                               "mean_rmse": float(np.mean([r["rmse"] for r in rows])),
                               "mean_mae": float(np.mean([r["mae"] for r in rows])),
                               "mean_bias": float(np.mean([r["bias"] for r in rows]))})

    out = {
        "future_years": future_years, "mean": ens_mean, "lower": ci_lower, "upper": ci_upper,
        "mc_se_mean": mc_se,
        "trend_coefficients": [float(c) for c in coeffs], "trend_fitted": q_trend(years),
        "slopes": {
            "historical_1940_1979": hist_slope,
            "historical_range": f"{cfg['CALIB_START']}-{cfg['CALIB_END']}",
            "historical_n_years": int(calib_mask.sum()),
            "modern": modern_slope,
            "modern_range": f"{cfg['MODERN_START']}-{hist_end_year}",
            "modern_n_years": int(modern_mask.sum()),
            "future_mean": fut_mean, "future_ci_low": fut_lo, "future_ci_high": fut_hi,
            "future_range": f"{int(future_years[0])}-{int(future_years[-1])}",
            "instantaneous_end": inst_slope,
            "acceleration": acceleration,
            "units": "°C/decade",
        },
        "ensemble": {
            "members": member_rows,
            "weighting_method": weight_method,
            "validation_year": int(validation_year),
            "hindcast_folds": folds,
            "hindcast_points": int(len(targets)) if targets is not None else 0,
            "stacked_hindcast": stacked_hindcast,
            "error_sign_convention": "error = prediction − observed (positive = model too warm)",
            "paths_with_all_members_rejected": n_all_rejected,
        },
        "residual_model": dict({"label": sim_label, "block_size": int(block),
                                "observation_noise_sd": cfg["OBS_ERR_STD"]}, **sim_params),
        "rolling_cv": {"enabled": bool(rolling_cv), "min_train_years": 30, "horizon": 10, "step": 5,
                       "by_model": cv_summary, "rows": cv_rows},
        "n_bootstrap": int(n_boot),
        "boot_slopes": slopes,
    }
    if n_paths_out:
        out["sample_paths"] = paths[: int(n_paths_out)]
    out["_paths"] = paths  # internal (stripped by the API layer)
    return out


# ---------------------------------------------------------------------------
# Data handling + data-quality report (cell02 preprocess_city / generate_data_quality_report)
# ---------------------------------------------------------------------------

def clean_series(years: Sequence, values: Sequence, scale: float = 1.0):
    """Drop missing/sentinel values. Returns (years int array, temps float array, n_sentinels)."""
    ys, ts, n_sent = [], [], 0
    for y, v in zip(years, values):
        if y is None or v is None:
            continue
        try:
            fv = float(v)
            iy = int(y)
        except (TypeError, ValueError):
            continue
        if any(abs(fv - s) < 1e-9 for s in SENTINELS):
            n_sent += 1
            continue
        if not math.isfinite(fv):
            continue
        ys.append(iy)
        ts.append(fv * scale)
    ys = np.asarray(ys, dtype=int)
    ts = np.asarray(ts, dtype=float)
    if len(ys):
        # duplicate years -> mean (defensive; the notebook's CSV has one row per year)
        uy, inv = np.unique(ys, return_inverse=True)
        if len(uy) < len(ys):
            ts = np.bincount(inv, weights=ts) / np.bincount(inv)
            ys = uy
        order = np.argsort(ys)
        ys, ts = ys[order], ts[order]
    return ys, ts, n_sent


def notebook_outliers(years: np.ndarray, temps: np.ndarray) -> List[int]:
    """Verbatim rule from generate_data_quality_report (statsmodels mad, 0.6745 factor, |z|>3.5)."""
    madv = mad_statsmodels(temps)
    if madv > 0:
        z = 0.6745 * (temps - np.median(temps)) / madv
        return [int(y) for y in years[np.abs(z) > 3.5]]
    return []


def data_quality(season: str, obs_years: np.ndarray, obs_temps: np.ndarray, city_min: int, city_max: int,
                 imputed_years: List[int], n_sentinels: int, min_years: int, unit_note: str) -> Dict[str, Any]:
    span_years = set(range(city_min, city_max + 1))
    present = set(int(y) for y in obs_years)
    missing_raw = sorted(span_years - present)
    after_impute = present | set(imputed_years)
    longest_gap = 0
    if len(obs_years) > 1:
        longest_gap = int(max(np.diff(np.sort(obs_years)) - 1))
    q = {
        "season": season,
        "first_year": int(obs_years.min()) if len(obs_years) else None,
        "last_year": int(obs_years.max()) if len(obs_years) else None,
        "n_observed": int(len(obs_years)),
        "city_span": [int(city_min), int(city_max)],
        "missing_years_in_span": missing_raw,
        "imputed_years": sorted(int(y) for y in imputed_years),
        "missing_after_imputation": sorted(span_years - after_impute),
        "longest_internal_gap_years": longest_gap,
        "sentinel_values_removed": int(n_sentinels),
        "outlier_years": notebook_outliers(obs_years, obs_temps) if len(obs_years) else [],
        "outlier_rule": "notebook rule: z = 0.6745·(x − median)/MAD_sm, |z| > 3.5, where MAD_sm = statsmodels mad (already ÷0.6745)",
        "unit_handling": unit_note,
        "sufficient": bool(len(obs_years) >= min_years),
        "n_years_1940_1979": int(np.sum((obs_years >= 1940) & (obs_years <= 1979))),
    }
    return q


def run_station(station_name: str, years: Sequence, season_values: Dict[str, Sequence], *,
                end_year: int = 2100, n_bootstrap: int = 200, seed: int = 42,
                train_end_year: Optional[int] = None, impute: bool = True, unit_mode: str = "celsius",
                rolling_cv: bool = True, n_paths_out: int = 0,
                config_overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Run Aeros 4.0 for one station (all supplied seasons). Returns numpy-bearing internal dict.

    ``train_end_year`` truncates the input *before anything else* (as if the uploaded CSV ended
    that year) — used by Nexus hindcasts; nothing after it can influence the result.
    """
    cfg = dict(NOTEBOOK_CONFIG)
    cfg["FUT_END"] = int(end_year)
    if config_overrides:
        cfg.update(config_overrides)
    warnings: List[str] = []

    if years is None or len(years) == 0:
        raise AerosInputError("No years supplied.")
    seasons_in = {}
    for key, vals in (season_values or {}).items():
        canon = SEASON_ALIASES.get(key)
        if canon is None:
            warnings.append(f"Ignored unknown season key '{key}' (expected D-J-F or J-J-A).")
            continue
        if vals is None:
            continue
        if len(vals) != len(years):
            raise AerosInputError(f"Season '{key}' has {len(vals)} values but there are {len(years)} years.")
        seasons_in[canon] = vals
    if not seasons_in:
        raise AerosInputError("No seasonal series supplied (need D-J-F and/or J-J-A).")

    all_vals = [v for vals in seasons_in.values() for v in vals if v is not None]
    scale, unit_note = infer_unit_scale(
        [v for v in all_vals if not any(abs(float(v) - s) < 1e-9 for s in SENTINELS)], unit_mode)

    cleaned = {}
    for season in SEASONS:
        if season not in seasons_in:
            continue
        ys, ts, n_sent = clean_series(years, seasons_in[season], scale)
        if train_end_year is not None:
            keep = ys <= int(train_end_year)
            ys, ts = ys[keep], ts[keep]
        cleaned[season] = (ys, ts, n_sent)

    nonempty = [c for c in cleaned.values() if len(c[0])]
    if not nonempty:
        raise AerosInputError("All supplied values are missing" +
                              (f" up to train_end_year={train_end_year}." if train_end_year else "."))
    city_min = int(min(c[0].min() for c in nonempty))
    city_max = int(max(c[0].max() for c in nonempty))  # notebook: CONFIG['MODERN_END'] / hist_end_year
    if city_max + 2 > cfg["FUT_END"]:
        raise AerosInputError(f"end_year ({cfg['FUT_END']}) must be at least 2 years after the last observed year ({city_max}).")

    results, quality = {}, {}
    for season, (ys, ts, n_sent) in cleaned.items():
        imputed_years: List[int] = []
        if len(ys) and impute:
            full, filled, imp_mask = impute_missing_years_pchip(ys, ts)
            imputed_years = [int(y) for y in full[imp_mask]]
            proc_years, proc_temps = full, filled
        else:
            proc_years, proc_temps, imp_mask = ys, ts, np.zeros(len(ys), dtype=bool)
        q = data_quality(season, ys, ts, city_min, city_max, imputed_years, n_sent, cfg["MIN_YEARS"], unit_note)
        quality[season] = q
        if len(proc_years) < cfg["MIN_YEARS"]:
            warnings.append(f"{season}: only {len(proc_years)} years (< {cfg['MIN_YEARS']}); season skipped, as in the notebook.")
            continue
        if q["imputed_years"]:
            warnings.append(f"{season}: {len(q['imputed_years'])} missing year(s) filled by PCHIP imputation: {q['imputed_years']}.")
        if q["longest_internal_gap_years"] >= 5:
            warnings.append(f"{season}: longest internal gap is {q['longest_internal_gap_years']} years; imputed values there are interpolation, not data.")
        if int(proc_years.max()) < city_max:
            warnings.append(f"{season}: last value is {int(proc_years.max())} but projections start after {city_max} "
                            f"(notebook behaviour: city-level last year).")
        res = project_season(station_name, season, proc_years, proc_temps, city_max, cfg,
                             int(n_bootstrap), int(seed), n_paths_out=n_paths_out, rolling_cv=rolling_cv)
        res["historical_years"] = proc_years
        res["historical_values"] = proc_temps
        res["historical_imputed"] = imp_mask
        if res["residual_model"]["label"] != "AR1":
            warnings.append(f"{season}: residual simulator is {res['residual_model']['label']} "
                            f"({res['residual_model'].get('reason', '')}).")
        results[season] = res
    if not results:
        raise AerosInputError(f"No season has at least {cfg['MIN_YEARS']} years of data.")
    return {"seasons": results, "quality": quality, "warnings": warnings, "config": cfg,
            "hist_end_year": city_max, "hist_start_year": city_min, "unit_note": unit_note, "unit_scale": scale}
