"""CORe 4.0 — one-pathway historical-continuation CO2 engine (headless port).

Port of notebook cell08 ("CORe 4.0 One-Pathway Full-Strength Carbon Engine") with the
notebook's behaviour and defaults preserved:

    historical CO2 series -> 10 candidate models -> rolling-origin backtest ->
    model selection (RMSE within 1.35x of best, EWMA kept if within 1.75x) ->
    inverse-squared-score weights (power 2.0) -> growth/acceleration-constrained
    ensemble pathway to 2100 -> conformal-style uncertainty -> CO2 forcing
    (5.35 ln(C/278.3)) -> simple one-box temperature response.

Differences from the notebook are implementation-only:
  * numpy/scipy instead of pandas/scikit-learn (Pyodide-friendly). Ridge and OLS use the
    closed form with intercept centring (what scikit-learn's Ridge/LinearRegression solve);
    HuberRegressor is re-implemented with the identical objective/gradient and the same
    scipy L-BFGS-B call scikit-learn makes.
  * No file or network access: the historical series arrives as arrays.
  * No plotting.
Parity against the original cell run on the same input is checked in models/tests/test_core.py.
"""

from __future__ import annotations

import math
from typing import Callable

import numpy as np

VERSION = "4.0"

# ---------------------------------------------------------------------------
# Notebook defaults (cell08 "USER SETTINGS"), unchanged.
# ---------------------------------------------------------------------------
DEFAULTS: dict = {
    "projection_end_year": 2100,
    "preindustrial_co2_ppm": 278.3,
    "ecs_c": 3.0,
    "heat_capacity": 8.0,
    "initial_temp_anomaly_c": 1.2,
    "validation_min_train_years": 40,
    "validation_test_horizon_years": 10,
    "validation_cutoff_step": 3,
    "abs_min_annual_growth_ppm": 0.05,
    "abs_max_annual_growth_ppm": 4.25,
    "abs_max_acceleration_ppm_per_year2": 0.06,
    "weight_power": 2.0,
    "keep_models_within_rmse_factor": 1.35,
    "ewma_keep_within_rmse_factor": 1.75,  # hard-coded 1.75 in the notebook
    "conformal_quantile": 0.90,
    "uncertainty_multiplier": 1.25,
}

# Constant in core4_temperature_response: lam = 3.7 / ECS  (W m^-2 per doubling, notebook value)
F2X_RESPONSE_WM2 = 3.7
# Constant in core4_co2_forcing: 5.35 * ln(C / C0)  (Myhre et al. 1998 simplified expression)
FORCING_ALPHA = 5.35


# ---------------------------------------------------------------------------
# Historical series cleaning (cell08 _core4_clean_year_ppm_df + gap interpolation)
# ---------------------------------------------------------------------------
def clean_historical(years, ppm) -> tuple[np.ndarray, np.ndarray]:
    """Annual-bin, range-filter, average duplicates, sort, and fill interior gaps linearly."""
    y = np.asarray([float("nan") if v is None else v for v in years], dtype=float)
    p = np.asarray([float("nan") if v is None else v for v in ppm], dtype=float)
    if y.shape != p.shape:
        raise ValueError("historical years and ppm must have the same length")
    ok = np.isfinite(y) & np.isfinite(p)
    y = np.round(y[ok]).astype(int)  # pandas .round() is half-to-even, as is np.round
    p = p[ok]
    keep = (y >= 1700) & (y <= 2100) & (p >= 250) & (p <= 800)
    y, p = y[keep], p[keep]
    if y.size == 0:
        raise ValueError("CO2 series became empty after cleaning.")
    uy = np.unique(y)
    means = np.array([p[y == v].mean() for v in uy])
    full = np.arange(uy.min(), uy.max() + 1)
    filled = np.interp(full, uy, means)  # interior linear interpolation only (endpoints are real)
    return full.astype(int), filled.astype(float)


# ---------------------------------------------------------------------------
# Adaptive constraints
# ---------------------------------------------------------------------------
def growth_stats(ppm: np.ndarray, s: dict) -> dict:
    ppm = np.asarray(ppm, dtype=float)
    growth = np.diff(ppm)
    recent = ppm[-min(25, len(ppm)):]
    recent_growth = np.diff(recent)
    if growth.size == 0:
        growth = np.array([1.8])
    if recent_growth.size == 0:
        recent_growth = growth

    q05, q50, q90, q95 = (float(np.quantile(growth, q)) for q in (0.05, 0.50, 0.90, 0.95))
    recent_mean = float(np.mean(recent_growth))
    recent_median = float(np.median(recent_growth))
    recent_q90 = float(np.quantile(recent_growth, 0.90))

    min_growth = max(s["abs_min_annual_growth_ppm"], min(0.60, q05))
    max_growth = min(s["abs_max_annual_growth_ppm"], max(2.25, recent_q90 * 1.35, q95 * 1.25))
    if max_growth <= min_growth:
        max_growth = min_growth + 1.0

    accel = np.diff(growth)
    if accel.size == 0:
        max_accel = 0.025
    else:
        max_accel = float(np.nanquantile(np.abs(accel), 0.90))
        max_accel = float(np.clip(max_accel, 0.015, s["abs_max_acceleration_ppm_per_year2"]))

    return {
        "growth_q05": q05,
        "growth_q50": q50,
        "growth_q90": q90,
        "growth_q95": q95,
        "recent_growth_mean": recent_mean,
        "recent_growth_median": recent_median,
        "recent_growth_q90": recent_q90,
        "min_growth": float(min_growth),
        "max_growth": float(max_growth),
        "max_accel": float(max_accel),
    }


def enforce_path(raw_pred, last_obs_ppm: float, info: dict) -> np.ndarray:
    """Sequential growth clamp: |growth_t - growth_{t-1}| <= max_accel, min <= growth <= max."""
    raw = np.asarray(raw_pred, dtype=float)
    out = np.zeros_like(raw)
    lo, hi, acc = float(info["min_growth"]), float(info["max_growth"]), float(info["max_accel"])
    prev_growth = None
    prev = float(last_obs_ppm)
    for i in range(raw.size):
        g = float(raw[i]) - prev
        if prev_growth is not None:
            g = min(max(g, prev_growth - acc), prev_growth + acc)
        g = min(max(g, lo), hi)
        prev = prev + g
        out[i] = prev
        prev_growth = g
    return out


# ---------------------------------------------------------------------------
# Regression helpers (scikit-learn-equivalent closed forms)
# ---------------------------------------------------------------------------
def _x_scaled(years, origin=None, scale=100.0):
    years = np.asarray(years, dtype=float)
    if origin is None:
        origin = float(np.min(years))
    return ((years - origin) / scale).reshape(-1, 1), origin


def _poly(x: np.ndarray, degree: int) -> np.ndarray:
    return np.hstack([x ** d for d in range(1, degree + 1)])


def _ridge_fit(X: np.ndarray, y: np.ndarray, alpha: float):
    """sklearn Ridge(fit_intercept=True, solver='auto'->cholesky) closed form."""
    xm = X.mean(axis=0)
    ym = y.mean()
    Xc = X - xm
    A = Xc.T @ Xc + alpha * np.eye(X.shape[1])
    coef = np.linalg.solve(A, Xc.T @ (y - ym))
    return coef, float(ym - xm @ coef)


def _ols_fit(X: np.ndarray, y: np.ndarray):
    xm = X.mean(axis=0)
    ym = y.mean()
    coef = np.linalg.lstsq(X - xm, y - ym, rcond=None)[0]
    return coef, float(ym - xm @ coef)


def _huber_loss_and_gradient(w, X, y, epsilon, alpha):
    """Identical objective to sklearn.linear_model._huber._huber_loss_and_gradient
    (fit_intercept=True, unit sample weights). BSD-3 scikit-learn algorithm."""
    n_features = X.shape[1]
    intercept = w[-2]
    sigma = w[-1]
    coef = w[:n_features]
    n_samples = float(X.shape[0])

    linear_loss = y - X @ coef - intercept
    abs_linear_loss = np.abs(linear_loss)
    outliers_mask = abs_linear_loss > epsilon * sigma
    outliers = abs_linear_loss[outliers_mask]
    n_out = float(np.count_nonzero(outliers_mask))
    outlier_loss = 2.0 * epsilon * np.sum(outliers) - sigma * n_out * epsilon ** 2

    non_outliers = linear_loss[~outliers_mask]
    squared_loss = float(np.dot(non_outliers, non_outliers)) / sigma

    grad = np.zeros(n_features + 2)
    X_non = -X[~outliers_mask]
    grad[:n_features] = 2.0 / sigma * (non_outliers @ X_non)
    signed = np.where(linear_loss[outliers_mask] < 0, -1.0, 1.0)
    grad[:n_features] -= 2.0 * epsilon * (signed @ X[outliers_mask])
    grad[:n_features] += alpha * 2.0 * coef
    grad[-1] = n_samples - n_out * epsilon ** 2 - squared_loss / sigma
    grad[-2] = -2.0 * np.sum(non_outliers) / sigma - 2.0 * epsilon * np.sum(signed)

    loss = n_samples * sigma + squared_loss + outlier_loss + alpha * float(np.dot(coef, coef))
    return loss, grad


def _huber_fit(X, y, epsilon=1.35, alpha=0.001, max_iter=500, tol=1e-5):
    from scipy import optimize  # imported lazily; only this candidate needs scipy

    params = np.zeros(X.shape[1] + 2)
    params[-1] = 1.0
    bounds = [(-np.inf, np.inf)] * (X.shape[1] + 1) + [(np.finfo(np.float64).eps * 10, np.inf)]
    res = optimize.minimize(
        _huber_loss_and_gradient, params, method="L-BFGS-B", jac=True,
        args=(X, y, epsilon, alpha), options={"maxiter": max_iter, "gtol": tol}, bounds=bounds,
    )
    if res.status == 2:
        raise ValueError("HuberRegressor convergence failed: " + str(res.message))
    return res.x[: X.shape[1]], float(res.x[-2])


# ---------------------------------------------------------------------------
# Candidate one-pathway models (cell08, same names, same maths)
# ---------------------------------------------------------------------------
def model_linear_level(ty, tp, py, s):
    x, o = _x_scaled(ty)
    xp, _ = _x_scaled(py, origin=o)
    c, b = _ols_fit(x, np.asarray(tp, float))
    return xp @ c + b


def model_huber_linear_level(ty, tp, py, s):
    x, o = _x_scaled(ty)
    xp, _ = _x_scaled(py, origin=o)
    c, b = _huber_fit(x, np.asarray(tp, float), epsilon=1.35, alpha=0.001, max_iter=500)
    return xp @ c + b


def model_quadratic_ridge_level(ty, tp, py, s):
    x, o = _x_scaled(ty)
    xp, _ = _x_scaled(py, origin=o)
    c, b = _ridge_fit(_poly(x, 2), np.asarray(tp, float), 0.20)
    return _poly(xp, 2) @ c + b


def model_cubic_ridge_level(ty, tp, py, s):
    x, o = _x_scaled(ty)
    xp, _ = _x_scaled(py, origin=o)
    c, b = _ridge_fit(_poly(x, 3), np.asarray(tp, float), 2.00)
    return _poly(xp, 3) @ c + b


def model_log_linear_level(ty, tp, py, s):
    x, o = _x_scaled(ty)
    xp, _ = _x_scaled(py, origin=o)
    c, b = _ridge_fit(x, np.log(np.maximum(np.asarray(tp, float), 1.0)), 0.02)
    return np.exp(xp @ c + b)


def model_growth_linear_ridge(ty, tp, py, s):
    ty = np.asarray(ty)
    tp = np.asarray(tp, float)
    order = np.argsort(ty, kind="stable")
    sy, sp = ty[order], tp[order]
    gy, g = sy[1:], np.diff(sp)
    if g.size < 8:
        return model_linear_level(ty, tp, py, s)
    x, o = _x_scaled(gy)
    c, b = _ridge_fit(x, g, 1.5)
    last_year = int(ty[-1])
    start = float(tp[-1])
    out = []
    for y in np.asarray(py):
        cur = start
        for yy in range(last_year + 1, int(y) + 1):
            xp, _ = _x_scaled(np.array([yy]), origin=o)
            cur += float((xp @ c + b)[0])
        out.append(cur)
    return np.asarray(out, dtype=float)


def _sorted_growth(ty, tp):
    ty = np.asarray(ty)
    tp = np.asarray(tp, float)
    order = np.argsort(ty, kind="stable")
    return np.diff(tp[order])


def model_recent_growth_median(ty, tp, py, s):
    growth_full = _sorted_growth(ty, tp)  # GROWTH column without its leading NaN
    n = len(tp)
    k = min(20, n)
    # tail(k) of a frame whose first GROWTH is NaN: drop that NaN only if the tail reaches row 0
    growth = growth_full[-k:] if k < n else growth_full
    if growth.size == 0:
        annual = 1.8
    else:
        annual = 0.65 * float(np.median(growth)) + 0.35 * float(np.mean(growth))
    return float(tp[-1]) + annual * (np.asarray(py) - int(ty[-1]))


def model_recent_growth_ewma(ty, tp, py, s):
    growth = _sorted_growth(ty, tp)
    if growth.size == 0:
        annual = 1.8
    else:
        w = np.exp(np.linspace(-2.0, 0.0, growth.size))
        w = w / w.sum()
        annual = float(np.sum(w * growth))
    return float(tp[-1]) + annual * (np.asarray(py) - int(ty[-1]))


def _soft(ty, tp, py, s, factor):
    base = model_recent_growth_ewma(ty, tp, py, s)
    last_year = int(ty[-1])
    last_ppm = float(tp[-1])
    t = np.asarray(py) - last_year
    annual = (base - last_ppm) / np.maximum(t, 1)
    frac = t / max(int(s["projection_end_year"]) - last_year, 1)
    return last_ppm + annual * (1.0 + factor * np.clip(frac, 0, 1)) * t


def model_recent_growth_soft_slowdown(ty, tp, py, s):
    return _soft(ty, tp, py, s, -0.22)


def model_recent_growth_soft_accel(ty, tp, py, s):
    return _soft(ty, tp, py, s, 0.18)


MODEL_FUNCS: dict[str, Callable] = {
    "linear_level": model_linear_level,
    "huber_linear_level": model_huber_linear_level,
    "quadratic_ridge_level": model_quadratic_ridge_level,
    "cubic_ridge_level": model_cubic_ridge_level,
    "log_linear_level": model_log_linear_level,
    "growth_linear_ridge": model_growth_linear_ridge,
    "recent_growth_median": model_recent_growth_median,
    "recent_growth_ewma": model_recent_growth_ewma,
    "recent_growth_soft_slowdown": model_recent_growth_soft_slowdown,
    "recent_growth_soft_accel": model_recent_growth_soft_accel,
}


# ---------------------------------------------------------------------------
# Backtests
# ---------------------------------------------------------------------------
def _cutoffs(years: np.ndarray, s: dict):
    first, last = int(years.min()), int(years.max())
    start = first + int(s["validation_min_train_years"])
    end = last - 3
    if end <= start:
        return
    for cutoff in range(start, end + 1, int(s["validation_cutoff_step"])):
        train = years <= cutoff
        test = (years > cutoff) & (years <= min(cutoff + int(s["validation_test_horizon_years"]), last))
        if train.sum() < int(s["validation_min_train_years"]) or test.sum() < 3:
            continue
        yield cutoff, train, test


def backtest_candidates(years, ppm, s, model_names=None):
    """Return {model: {"cutoff": [...], "year": [...], "error": [...]}} and failures list."""
    names = list(model_names or MODEL_FUNCS)
    pts = {m: {"cutoff": [], "year": [], "observed": [], "predicted": []} for m in names}
    failures = []
    for cutoff, tr, te in _cutoffs(years, s):
        ty, tp, vy, vp = years[tr], ppm[tr], years[te], ppm[te]
        info = growth_stats(tp, s)
        for m in names:
            try:
                pred = enforce_path(MODEL_FUNCS[m](ty, tp, vy, s), float(tp[-1]), info)
            except Exception as e:  # notebook records the failure and continues
                failures.append({"model": m, "cutoff": int(cutoff), "error": str(e)})
                continue
            pts[m]["cutoff"] += [int(cutoff)] * len(vy)
            pts[m]["year"] += [int(v) for v in vy]
            pts[m]["observed"] += [float(v) for v in vp]
            pts[m]["predicted"] += [float(v) for v in pred]
    return pts, failures


def summarize_validation(pts: dict, s: dict) -> list[dict]:
    rows = []
    for m in sorted(pts):  # pandas groupby order (alphabetical)
        err = np.asarray(pts[m]["predicted"]) - np.asarray(pts[m]["observed"])
        if err.size == 0:
            continue
        rows.append({
            "model": m,
            "mae_ppm": float(np.mean(np.abs(err))),
            "rmse_ppm": float(np.sqrt(np.mean(np.square(err)))),
            "bias_ppm": float(np.mean(err)),
            "n_validation_points": int(err.size),
        })
    if not rows:
        return [{"model": "recent_growth_ewma", "mae_ppm": None, "rmse_ppm": None, "bias_ppm": None,
                 "n_validation_points": 0, "selected_for_ensemble": True, "weight": 1.0}]
    rows.sort(key=lambda r: (r["rmse_ppm"], r["mae_ppm"]))  # stable, like pandas lexsort
    best = rows[0]["rmse_ppm"]
    for r in rows:
        r["selected_for_ensemble"] = bool(r["rmse_ppm"] <= best * s["keep_models_within_rmse_factor"])
        if r["model"] == "recent_growth_ewma" and r["rmse_ppm"] <= best * s["ewma_keep_within_rmse_factor"]:
            r["selected_for_ensemble"] = True
    sel = [r for r in rows if r["selected_for_ensemble"]]
    raw = np.array([1.0 / np.power(r["rmse_ppm"] + 0.25 * abs(r["bias_ppm"]) + 1e-6, s["weight_power"]) for r in sel])
    w = raw / raw.sum()
    wmap = {r["model"]: float(x) for r, x in zip(sel, w)}
    for r in rows:
        r["weight"] = wmap.get(r["model"], 0.0)
    return rows


def backtest_ensemble(years, ppm, selected: list[tuple[str, float]], s):
    errs, rows = [], []
    for cutoff, tr, te in _cutoffs(years, s):
        ty, tp, vy, vp = years[tr], ppm[tr], years[te], ppm[te]
        info = growth_stats(tp, s)
        preds, lw = [], []
        for m, w in selected:
            try:
                preds.append(enforce_path(MODEL_FUNCS[m](ty, tp, vy, s), float(tp[-1]), info))
                lw.append(w)
            except Exception:
                pass
        if not preds:
            continue
        lw = np.asarray(lw, float)
        lw = lw / lw.sum()
        ens = enforce_path(np.column_stack(preds) @ lw, float(tp[-1]), info)
        for yy, ob, pp in zip(vy, vp, ens):
            errs.append(float(pp - ob))
            rows.append({"cutoff_year": int(cutoff), "year": int(yy), "horizon": int(yy - cutoff),
                         "observed_ppm": float(ob), "predicted_ppm": float(pp)})
    return np.asarray(errs, float), rows


# ---------------------------------------------------------------------------
# Physics (cell08, verbatim formulas)
# ---------------------------------------------------------------------------
def co2_forcing(ppm, c0: float = 278.3) -> np.ndarray:
    """core4_co2_forcing: 5.35 * ln(max(C, 1) / C0)  [W m^-2]."""
    ppm = np.asarray(ppm, dtype=float)
    return FORCING_ALPHA * np.log(np.maximum(ppm, 1.0) / float(c0))


def temperature_response(years, forcing, ecs: float = 3.0, heat_capacity: float = 8.0,
                         initial_temp: float = 1.2) -> np.ndarray:
    """core4_temperature_response: explicit annual step of a single heat reservoir,
        T <- T + (F - lam*T) / C,   lam = 3.7 / ECS,  T(start) = initial_temp.
    One step per year (dt = max(year gap, 1)). Units: F W m^-2, C W yr m^-2 K^-1."""
    years = np.asarray(years, dtype=int)
    forcing = np.asarray(forcing, dtype=float)
    lam = F2X_RESPONSE_WM2 / max(float(ecs), 0.1)
    cap = max(float(heat_capacity), 0.1)
    temp = float(initial_temp)
    out = np.empty(forcing.size)
    prev = int(years[0]) if years.size else 0
    for i in range(forcing.size):
        y = int(years[i])
        for _ in range(max(y - prev, 1)):
            temp += (float(forcing[i]) - lam * temp) / cap
        out[i] = temp
        prev = y
    return out


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------
def run(years, ppm, settings: dict | None = None, include_points: bool = False) -> dict:
    """Run CORe 4.0. Returns plain-python/numpy results (api.py makes them JSON-safe)."""
    s = dict(DEFAULTS)
    if settings:
        unknown = set(settings) - set(DEFAULTS)
        if unknown:
            raise ValueError(f"Unknown CORe settings: {sorted(unknown)}")
        s.update(settings)

    hy, hp = clean_historical(years, ppm)
    info = growth_stats(hp, s)

    pts, failures = backtest_candidates(hy, hp, s)
    summary = summarize_validation(pts, s)

    last_year, last_ppm = int(hy[-1]), float(hp[-1])
    end_year = int(s["projection_end_year"])
    if end_year <= last_year:
        raise ValueError("projection_end_year must be after the last historical year")
    fy = np.arange(last_year + 1, end_year + 1)

    selected = [(r["model"], r["weight"]) for r in summary if r["weight"] > 0] or [("recent_growth_ewma", 1.0)]
    members = {}
    for m, _ in selected:
        try:
            members[m] = enforce_path(MODEL_FUNCS[m](hy, hp, fy, s), last_ppm, info)
        except Exception as e:
            failures.append({"model": m, "cutoff": None, "error": f"final projection: {e}"})
    if not members:
        members["recent_growth_ewma"] = enforce_path(model_recent_growth_ewma(hy, hp, fy, s), last_ppm, info)
        selected = [("recent_growth_ewma", 1.0)]
    selected = [(m, w) for m, w in selected if m in members]
    wsum = sum(w for _, w in selected)
    selected = [(m, (w / wsum) if wsum > 0 else 1.0 / len(selected)) for m, w in selected]

    mat = np.column_stack([members[m] for m, _ in selected])
    wv = np.array([w for _, w in selected])
    ens = enforce_path(mat @ wv, last_ppm, info)
    spread = np.sqrt(np.maximum(np.sum(wv.reshape(1, -1) * np.square(mat - ens.reshape(-1, 1)), axis=1), 0.0))

    ens_err, ens_rows = backtest_ensemble(hy, hp, selected, s)
    if ens_err.size == 0:
        vals = [r["rmse_ppm"] for r in summary if r.get("rmse_ppm")]
        base_error = float(np.mean(vals)) if vals else 4.0
        if not math.isfinite(base_error):
            base_error = 4.0
    else:
        base_error = float(np.quantile(np.abs(ens_err), s["conformal_quantile"]))
        if not math.isfinite(base_error) or base_error <= 0:
            base_error = float(np.sqrt(np.mean(np.square(ens_err))))

    horizon = fy - last_year
    hf = np.maximum(np.sqrt(np.maximum(horizon, 1) / max(1, int(s["validation_test_horizon_years"]))), 1.0)
    unc = s["uncertainty_multiplier"] * (base_error * hf + 0.85 * spread)
    lo = np.maximum(ens - unc, last_ppm)
    lo = np.maximum.accumulate(lo - 0.05) + 0.05
    hi = np.maximum(ens + unc, lo + 0.25)
    hi = np.maximum.accumulate(hi)

    c0 = s["preindustrial_co2_ppm"]
    forcing = co2_forcing(ens, c0)
    temp = temperature_response(fy, forcing, s["ecs_c"], s["heat_capacity"], s["initial_temp_anomaly_c"])

    out = {
        "settings": s,
        "historical_years": hy,
        "historical_ppm": hp,
        "growth_constraints": info,
        "validation_summary": summary,
        "failures": failures,
        "ensemble": selected,
        "members": members,
        "future_years": fy,
        "ppm_mean": ens,
        "ppm_lower": lo,
        "ppm_upper": hi,
        "model_spread_ppm": spread,
        "uncertainty_ppm": unc,
        "forcing_wm2": forcing,
        "forcing_lower_wm2": co2_forcing(lo, c0),
        "forcing_upper_wm2": co2_forcing(hi, c0),
        "historical_forcing_wm2": co2_forcing(hp, c0),
        "temperature_response_c": temp,
        "conformal_base_error_ppm": base_error,
        "ensemble_backtest": {
            "n_points": int(ens_err.size),
            "mae_ppm": float(np.mean(np.abs(ens_err))) if ens_err.size else None,
            "rmse_ppm": float(np.sqrt(np.mean(np.square(ens_err)))) if ens_err.size else None,
            "bias_ppm": float(np.mean(ens_err)) if ens_err.size else None,
        },
    }
    if include_points:
        out["validation_points"] = pts
        out["ensemble_validation_points"] = ens_rows
    return out
