"""Catalyst 1.0 — transparent what-if scenario engine built on CORe 4.0 physics.

NEW in this build (v1.0) and deliberately SIMPLIFIED. It is a reduced-complexity
("simple climate model") tool for comparing a baseline with a user scenario. It is not an
Earth-system model and its outputs are conditional on the stated assumptions.

Pipeline
--------
Concentration mode:  CO2 pathway (ppm) -> forcing -> temperature response
Emissions mode:      CO2 emissions (GtCO2/yr) + interventions -> carbon cycle -> ppm -> forcing -> temperature

Components (all citable, all reproduced in plain numpy / math):
  * Forcing: CORe 4.0's own expression, F = 5.35 ln(C / 278.3) W m^-2 (Myhre et al. 1998 form,
    preindustrial 278.3 ppm as in the notebook). Optional anthropogenic non-CO2 ERF from RCMIP
    (Effective Radiative Forcing|Anthropogenic minus ...|Anthropogenic|CO2).
  * Temperature (default "core4"): CORe 4.0's single-reservoir response, unchanged
    (T <- T + (F - (3.7/ECS) T)/C, C = 8 W yr m^-2 K^-1, T(2025) = 1.2 C).
    Option "two_layer": two-layer energy balance model (Held et al. 2010; Geoffroy et al. 2013,
    CMIP5 multi-model mean C = 7.3, C_D = 106 W yr m^-2 K^-1, gamma = 0.73 W m^-2 K^-1) with the
    feedback parameter set to F2x/ECS, spun up from 1750 with historical forcing.
  * Carbon cycle (default "fair_v1"): four-pool impulse response with the Joos et al. (2013)
    multi-model-mean coefficients and FaIR v1.x state-dependent time constants
    (Millar et al. 2017; Smith et al. 2018: iIRF100 = r0 + rC*C_uptake + rT*T,
    r0 = 35 yr, rC = 0.019 yr/GtC, rT = 4.165 yr/K, cap 97 yr). Option "joos2013": the same
    impulse response with fixed (present-day) time constants, as used for AR5 metrics.
    The temperature that drives the carbon-cycle feedback is computed internally with the
    two-layer model above (CO2 + anthropogenic non-CO2 forcing of the reference SSP).
"""

from __future__ import annotations

import math

import numpy as np

from . import core as core_mod

VERSION = "1.0"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
GTC_PER_PPM = 2.124  # Global Carbon Budget conversion (Friedlingstein et al.; Ballantyne et al. 2012)
GTCO2_PER_GTC = 44.009 / 12.011
JOOS_A = (0.2173, 0.2240, 0.2824, 0.2763)  # Joos et al. 2013 multi-model mean (PD100), a0..a3
JOOS_TAU = (1.0e6, 394.4, 36.54, 4.304)  # yr; a0 pool is effectively permanent
FAIR_DEFAULTS = {"r0": 35.0, "rc": 0.019, "rt": 4.165, "iirf_max": 97.0, "iirf_horizon": 100.0}
TWO_LAYER_DEFAULTS = {"c_upper": 7.3, "c_deep": 106.0, "gamma": 0.73}  # Geoffroy et al. 2013a MMM
F2X_TWO_LAYER = core_mod.FORCING_ALPHA * math.log(2.0)  # 3.708 W m^-2, consistent with CORe forcing
ECS_RANGES = {"likely": (2.5, 4.0), "very_likely": (2.0, 5.0)}  # IPCC AR6 WG1 assessed ECS
SSP_NAMES = ("ssp119", "ssp126", "ssp245", "ssp370", "ssp434", "ssp460", "ssp585")
FIRST_YEAR = 1750


# ---------------------------------------------------------------------------
# Data access (everything comes from the payload; no I/O)
# ---------------------------------------------------------------------------
def _arr(values) -> np.ndarray:
    return np.asarray([np.nan if v is None else v for v in values], dtype=float)


class Data:
    """Thin wrapper around the co2_bundle.json structure (see data/co2/README.md)."""

    def __init__(self, bundle: dict):
        if not isinstance(bundle, dict) or "rcmip" not in bundle:
            raise ValueError("payload.data must contain the co2_bundle 'rcmip' block")
        r = bundle["rcmip"]
        self.years = np.asarray(r["years"], dtype=int)
        if int(self.years[0]) != FIRST_YEAR:
            raise ValueError("rcmip.years must start in 1750")
        self.conc = {k: _arr(v) for k, v in r["concentrations_ppm"].items()}
        self.emis = {k: _arr(v["total"]) for k, v in r["emissions_gtco2"].items()}
        self.erf_nonco2 = {k: _arr(v["anthro"]) - _arr(v["anthro_co2"]) for k, v in r.get("erf_wm2", {}).items()}
        h = bundle.get("historical_co2")
        if h:
            self.hist_years = np.asarray(h["years"], dtype=int)
            self.hist_ppm = _arr(h["ppm"])
        else:
            hy = self.years[self.years <= 2014]
            self.hist_years, self.hist_ppm = hy, self.conc["historical"][: hy.size]
        self.last_hist_year = int(self.hist_years[-1])
        self.obs_last_ppm = float(self.hist_ppm[-1])
        n = bundle.get("noaa_global_annual")
        self.noaa = dict(zip(n["years"], n["ppm"])) if n else {}

    def idx(self, year: int) -> int:
        return int(year) - FIRST_YEAR

    def ssp(self, name: str) -> str:
        name = str(name).lower()
        if name not in self.conc or name == "historical":
            raise ValueError(f"Unknown scenario '{name}'. Available: {sorted(k for k in self.conc if k != 'historical')}")
        return name

    def concentration_history(self) -> np.ndarray:
        """Observed-concentration history 1750..last_hist_year: RCMIP historical before the CORe
        input series starts, then the CORe input series (RCMIP 1940-1978 + NOAA global 1979+)."""
        n = self.last_hist_year - FIRST_YEAR + 1
        out = np.full(n, np.nan)
        rc = self.conc["historical"]
        m = min(n, rc.size)
        out[:m] = rc[:m]
        out[self.hist_years - FIRST_YEAR] = self.hist_ppm
        if np.isnan(out).any():  # gap between RCMIP history (to 2014) and the payload series
            good = ~np.isnan(out)
            out = np.interp(np.arange(n), np.flatnonzero(good), out[good])
        return out

    def emissions_history(self, ssp_for_recent: str = "ssp245") -> np.ndarray:
        """1750..last_hist_year: RCMIP historical (to 2014) + the given SSP (2015 onward)."""
        e = self.emis[self.ssp(ssp_for_recent)]
        return e[: self.last_hist_year - FIRST_YEAR + 1].copy()

    def nonco2(self, ssp: str, end_year: int) -> np.ndarray:
        if not self.erf_nonco2:
            return np.zeros(end_year - FIRST_YEAR + 1)
        v = self.erf_nonco2[self.ssp(ssp)][: end_year - FIRST_YEAR + 1]
        return np.nan_to_num(v, nan=0.0)


# ---------------------------------------------------------------------------
# Carbon cycle
# ---------------------------------------------------------------------------
def _solve_alpha(iirf: float, guess: float) -> float:
    """Find alpha with sum_i a_i*alpha*tau_i*(1 - exp(-H/(alpha*tau_i))) = iIRF_H  (Newton)."""
    h = FAIR_DEFAULTS["iirf_horizon"]
    al = max(guess, 1e-3)
    for _ in range(50):
        f = -iirf
        df = 0.0
        for a, t in zip(JOOS_A, JOOS_TAU):
            x = h / (al * t)
            e = math.exp(-x)
            f += a * al * t * (1.0 - e)
            df += a * t * ((1.0 - e) - x * e)
        step = f / df
        new = al - step
        if new <= 0:
            new = al / 2.0
        if abs(new - al) < 1e-12 * max(al, 1.0):
            return new
        al = new
    return al


def carbon_cycle(emissions_gtco2: np.ndarray, nonco2_wm2: np.ndarray, *, ecs: float = 3.0,
                 model: str = "fair_v1", invert_from: int | None = None,
                 target_end_ppm: np.ndarray | None = None, c_pi: float | None = None,
                 fair: dict | None = None, two_layer: dict | None = None) -> dict:
    """Annual carbon cycle from 1750 (index 0).

    Forward mode: emissions given for every year. Inverse mode (invert_from=i): emissions from
    index i on are diagnosed so that the end-of-year concentration equals target_end_ppm.
    Returns end-of-year and annual-mean (mid-year: mean of consecutive year ends) ppm,
    the emissions actually used, internal temperature and the alpha time-scale factor.
    """
    if model not in ("fair_v1", "joos2013"):
        raise ValueError("carbon_cycle model must be 'fair_v1' or 'joos2013'")
    p = dict(FAIR_DEFAULTS, **(fair or {}))
    tl = dict(TWO_LAYER_DEFAULTS, **(two_layer or {}))
    n = len(emissions_gtco2)
    e_all = np.array(emissions_gtco2, dtype=float)
    cpi = float(c_pi)
    lam = F2X_TWO_LAYER / max(float(ecs), 0.1)
    cu, cd, g = tl["c_upper"], tl["c_deep"], tl["gamma"]
    decay_fixed = [math.exp(-1.0 / t) for t in JOOS_TAU]
    boxes = [0.0, 0.0, 0.0, 0.0]
    c_acc = 0.0
    temp = 0.0
    temp_d = 0.0
    alpha = 0.16
    c_prev = cpi
    e_prev = 0.0
    c_end = np.empty(n)
    t_int = np.empty(n)
    alphas = np.empty(n)
    for i in range(n):
        if model == "fair_v1":
            iirf = min(p["r0"] + p["rc"] * c_acc + p["rt"] * temp, p["iirf_max"])
            alpha = _solve_alpha(iirf, alpha)
            decay = [math.exp(-1.0 / (alpha * t)) for t in JOOS_TAU]
        else:
            alpha = 1.0
            decay = decay_fixed
        decayed = [b * d for b, d in zip(boxes, decay)]
        if invert_from is not None and i >= invert_from:
            # sum(a) == 1, so C_end = cpi + sum(decayed) + E/GTC_PER_PPM
            e_gtc = (float(target_end_ppm[i]) - cpi - sum(decayed)) * GTC_PER_PPM
            e_all[i] = e_gtc * GTCO2_PER_GTC
        else:
            e_gtc = e_all[i] / GTCO2_PER_GTC
        boxes = [d + a * e_gtc / GTC_PER_PPM for d, a in zip(decayed, JOOS_A)]
        c = cpi + sum(boxes)
        c_acc += 0.5 * (e_gtc + e_prev) - (c - c_prev) * GTC_PER_PPM
        e_prev, c_prev = e_gtc, c
        c_end[i] = c
        alphas[i] = alpha
        f = core_mod.FORCING_ALPHA * math.log(max(c, 1.0) / cpi) + float(nonco2_wm2[i])
        temp, temp_d = temp + (f - lam * temp - g * (temp - temp_d)) / cu, temp_d + g * (temp - temp_d) / cd
        t_int[i] = temp
    c_mid = np.empty(n)
    c_mid[0] = 0.5 * (cpi + c_end[0])
    c_mid[1:] = 0.5 * (c_end[1:] + c_end[:-1])
    return {"ppm_end": c_end, "ppm": c_mid, "emissions_gtco2": e_all, "temperature_internal_c": t_int, "alpha": alphas}


# ---------------------------------------------------------------------------
# Temperature models
# ---------------------------------------------------------------------------
def two_layer_response(forcing: np.ndarray, ecs: float, params: dict | None = None) -> np.ndarray:
    """Two-layer EBM, explicit annual step from equilibrium (T = T_D = 0) at index 0."""
    tl = dict(TWO_LAYER_DEFAULTS, **(params or {}))
    lam = F2X_TWO_LAYER / max(float(ecs), 0.1)
    cu, cd, g = tl["c_upper"], tl["c_deep"], tl["gamma"]
    t = td = 0.0
    out = np.empty(len(forcing))
    for i, f in enumerate(forcing):
        t, td = t + (float(f) - lam * t - g * (t - td)) / cu, td + g * (t - td) / cd
        out[i] = t
    return out


# ---------------------------------------------------------------------------
# Pathway helpers
# ---------------------------------------------------------------------------
def _interp_points(years, values, target_years) -> np.ndarray:
    y = np.asarray(years, dtype=float)
    v = _arr(values)
    ok = np.isfinite(y) & np.isfinite(v)
    y, v = y[ok], v[ok]
    if y.size == 0:
        raise ValueError("custom series has no valid points")
    o = np.argsort(y)
    return np.interp(np.asarray(target_years, float), y[o], v[o])


def apply_point_edits(years: np.ndarray, series: np.ndarray, edit_years, edit_values,
                      anchor_year: int) -> np.ndarray:
    """User edits as control points: the OFFSET (edit - original) is interpolated linearly
    between points, tapering from 0 at anchor_year to the first point, held after the last."""
    years = np.asarray(years, int)
    ey = np.asarray(edit_years, float)
    off = _arr(edit_values) - np.interp(ey, years.astype(float), series)
    px = np.concatenate([[anchor_year], ey])
    pv = np.concatenate([[0.0], off])
    o = np.argsort(px)
    return series + np.interp(years.astype(float), px[o], pv[o])


def apply_interventions(years: np.ndarray, baseline: np.ndarray, iv: dict, data: "Data | None" = None,
                        full_baseline: np.ndarray | None = None) -> tuple[np.ndarray, list[str]]:
    """Apply emission interventions to a baseline (GtCO2/yr) over `years` (the projection years).
    Returns (scenario, list of human-readable assumptions actually applied)."""
    years = np.asarray(years, int)
    b = np.asarray(baseline, float)
    out = b.copy()
    notes: list[str] = []
    if not iv:
        return out, ["No interventions: scenario emissions equal the baseline."]
    start = int(iv.get("start_year") or years[0])
    start = max(start, int(years[0]))
    pre_val = lambda y: float(np.interp(y, years, b)) if y >= years[0] else (  # noqa: E731
        float(full_baseline[int(y) - FIRST_YEAR]) if full_baseline is not None else float(b[0]))
    active = years >= start
    cap = np.full(years.size, np.inf)

    peak = iv.get("peak_year")
    rate = iv.get("decline_rate_pct")
    if peak is not None or rate is not None:
        p = int(peak) if peak is not None else start - 1
        p = max(p, start - 1)
        level = pre_val(p)
        r = float(rate or 0.0) / 100.0
        if not 0.0 <= r < 1.0:
            raise ValueError("decline_rate_pct must be in [0, 100)")
        after = years > p
        c = level * np.power(1.0 - r, years - p) if level > 0 else np.full(years.size, level)
        cap = np.where(after, np.minimum(cap, c), cap)
        if peak is not None:
            notes.append(f"Emissions follow the baseline until {p}, then may not exceed the {p} level "
                         f"({level:.1f} GtCO2/yr)" + (f" and decline {r * 100:.1f}%/yr" if r > 0 else "") + ".")
        else:
            notes.append(f"Emissions decline {r * 100:.1f}%/yr (compound) from the {p} level ({level:.1f} GtCO2/yr).")

    tc = iv.get("target_cut")
    if tc:
        pct = float(tc["pct"])
        ty = int(tc["year"])
        ry = int(tc.get("reference_year", 2019))
        if ty < start:
            raise ValueError("target_cut.year must be >= start_year")
        ref = pre_val(ry)
        tgt = ref * (1.0 - pct / 100.0)
        s0 = pre_val(start - 1)
        ramp = np.interp(years, [start - 1, ty], [s0, tgt])
        cap = np.minimum(cap, np.where(years >= start, ramp, np.inf))
        notes.append(f"Emissions capped on a straight line to {pct:.0f}% below {ry} "
                     f"({ref:.1f} -> {tgt:.1f} GtCO2/yr) by {ty}, then held at or below that level.")

    out = np.where(active, np.minimum(b, cap), b)

    nz = iv.get("net_zero_year")
    if nz is not None:
        nz = int(nz)
        rs = max(start - 1, int(peak) if peak is not None else start - 1)
        if nz <= rs:
            raise ValueError("net_zero_year must be after the peak/start year")
        lvl = float(np.interp(rs, years, out)) if rs >= years[0] else pre_val(rs)
        ramp = np.interp(years, [rs, nz], [max(lvl, 0.0), 0.0])
        out = np.where(years > rs, np.minimum(out, ramp), out)
        notes.append(f"Net-zero CO2 by {nz}: emissions ramp linearly from {max(lvl, 0.0):.1f} GtCO2/yr in {rs} "
                     f"to 0 and stay at or below 0 afterwards (gross negative baseline values are kept).")

    rem = iv.get("removal")
    if rem and float(rem.get("gtco2_per_yr", 0)) != 0:
        amt = float(rem["gtco2_per_yr"])
        if amt < 0:
            raise ValueError("removal.gtco2_per_yr must be >= 0")
        ry0 = int(rem.get("start_year", start))
        ramp_years = max(float(rem.get("ramp_years", 0)), 0.0)
        frac = np.clip((years - ry0 + 1) / ramp_years, 0, 1) if ramp_years > 0 else (years >= ry0).astype(float)
        frac = np.where(years >= ry0, frac, 0.0)
        out = out - amt * frac
        notes.append(f"Additional carbon dioxide removal of {amt:.1f} GtCO2/yr from {ry0}"
                     + (f" (linear ramp over {ramp_years:.0f} yr)" if ramp_years > 0 else "")
                     + "; assumed permanent storage, no carbon-cycle rebound beyond the impulse response.")

    ce = iv.get("custom_emissions")
    if ce:
        cy = np.asarray(ce["years"], float)
        vals = _interp_points(cy, ce["values"], years)
        m = (years >= cy.min()) & (years <= cy.max()) & (years >= start)
        out = np.where(m, vals, out)
        notes.append(f"User-specified emissions between {int(cy.min())} and {int(cy.max())} "
                     "(linear between control points) replace the computed pathway.")
    notes.append("Interventions never raise emissions above the baseline (except explicit custom emissions).")
    return out, notes


# ---------------------------------------------------------------------------
# Scenario evaluation
# ---------------------------------------------------------------------------
def _temperature(model: str, years: np.ndarray, forcing_future: np.ndarray, forcing_hist: np.ndarray,
                 ecs: float, heat_capacity: float, initial_temp: float, two_layer: dict | None) -> np.ndarray:
    if model == "core4":
        return core_mod.temperature_response(years, forcing_future, ecs, heat_capacity, initial_temp)
    if model == "two_layer":
        full = two_layer_response(np.concatenate([forcing_hist, forcing_future]), ecs, two_layer)
        return full[forcing_hist.size:]
    raise ValueError("temperature_model must be 'core4' or 'two_layer'")


def _band(fn, ecs_central):
    out = {}
    for name, (lo, hi) in ECS_RANGES.items():
        a, b = fn(lo), fn(hi)
        out[name] = {"ecs": [lo, hi], "lower": np.minimum(a, b), "upper": np.maximum(a, b)}
    return out


def _forcing_parts(ppm_future, nonco2_future, cfg):
    f_co2 = core_mod.co2_forcing(ppm_future, cfg["preindustrial_co2_ppm"])
    f_non = nonco2_future if cfg["non_co2_forcing"] == "scenario" else np.zeros_like(f_co2)
    return f_co2, f_non


def _hist_forcing(data: Data, nonco2_hist: np.ndarray, cfg) -> np.ndarray:
    f = core_mod.co2_forcing(data.concentration_history(), cfg["preindustrial_co2_ppm"])
    if cfg["non_co2_forcing"] == "scenario":
        f = f + nonco2_hist
    return f


DEFAULTS: dict = {
    "mode": "emissions",
    "end_year": 2100,
    "baseline": {"type": "core"},
    "scenario": {"type": "ssp", "scenario": "ssp245"},  # concentration mode only
    "interventions": {},  # emissions mode only
    "ecs": 3.0,
    "heat_capacity": 8.0,
    "initial_temp_anomaly_c": 1.2,
    "preindustrial_co2_ppm": 278.3,
    "temperature_model": "core4",
    "non_co2_forcing": "none",
    "non_co2_scenario": "ssp245",
    "carbon_cycle": "fair_v1",
    "anchor_to_observed": True,
    "uncertainty": True,
    "two_layer": {},
    "fair": {},
    "core_pathway": None,
    "core_settings": None,
    "local_scaling": None,
}


def _cfg(payload: dict) -> dict:
    cfg = dict(DEFAULTS)
    unknown = set(payload) - set(DEFAULTS) - {"data"}
    if unknown:
        raise ValueError(f"Unknown Catalyst payload keys: {sorted(unknown)}")
    cfg.update({k: v for k, v in payload.items() if k != "data"})
    if cfg["mode"] not in ("emissions", "concentration", "validation"):
        raise ValueError("mode must be 'emissions', 'concentration' or 'validation'")
    if cfg["non_co2_forcing"] not in ("none", "scenario"):
        raise ValueError("non_co2_forcing must be 'none' or 'scenario'")
    if cfg["temperature_model"] not in ("core4", "two_layer"):
        raise ValueError("temperature_model must be 'core4' or 'two_layer'")
    if not 0.5 <= float(cfg["ecs"]) <= 10.0:
        raise ValueError("ecs must be between 0.5 and 10 C")
    if not 0.5 <= float(cfg["heat_capacity"]) <= 200.0:
        raise ValueError("heat_capacity must be between 0.5 and 200 W yr m^-2 K^-1")
    cfg["ecs"] = float(cfg["ecs"])
    cfg["heat_capacity"] = float(cfg["heat_capacity"])
    cfg["end_year"] = int(cfg["end_year"])
    if cfg["end_year"] > 2100:
        raise ValueError("end_year must be <= 2100 (scenario data end in 2100)")
    return cfg


def _core_pathway(cfg: dict, data: Data, warnings: list) -> tuple[np.ndarray, np.ndarray]:
    cp = cfg.get("core_pathway")
    if cp:
        y = np.asarray(cp["years"], int)
        v = _arr(cp["ppm"])
    else:
        r = core_mod.run(data.hist_years, data.hist_ppm, cfg.get("core_settings") or None)
        y, v = r["future_years"], r["ppm_mean"]
        warnings.append("CORe pathway computed inside Catalyst (pass core_pathway from run_core to skip this).")
    if int(y[0]) != data.last_hist_year + 1:
        raise ValueError(f"core_pathway must start in {data.last_hist_year + 1}")
    if int(y[-1]) < cfg["end_year"]:
        raise ValueError("core_pathway does not reach end_year")
    return y, v


def _nonco2_name(spec: dict, cfg: dict) -> str:
    return spec["scenario"] if spec.get("type") == "ssp" else cfg["non_co2_scenario"]


def _target_end(target_mid: np.ndarray) -> np.ndarray:
    """End-of-year targets from annual means (mean of consecutive annual means)."""
    out = np.empty_like(target_mid)
    out[:-1] = 0.5 * (target_mid[:-1] + target_mid[1:])
    out[-1] = target_mid[-1] + 0.5 * (target_mid[-1] - target_mid[-2]) if target_mid.size > 1 else target_mid[-1]
    return out


def _invert(data: Data, cfg: dict, hist_emis: np.ndarray, future_mid_ppm: np.ndarray, nonco2: np.ndarray,
            ecs: float) -> tuple[np.ndarray, float]:
    """Diagnose emissions reproducing a future annual-mean ppm path (shifted by the model's own
    2025 bias so the diagnosed emissions are not distorted by it). Returns (full emissions, offset)."""
    h = data.last_hist_year - FIRST_YEAR
    n = h + 1 + future_mid_ppm.size
    cpi = float(data.conc["historical"][0])
    fwd = carbon_cycle(np.concatenate([hist_emis, np.zeros(future_mid_ppm.size)]), nonco2[:n], ecs=ecs,
                       model=cfg["carbon_cycle"], c_pi=cpi, fair=cfg["fair"], two_layer=cfg["two_layer"])
    offset = float(fwd["ppm"][h] - data.obs_last_ppm)
    tmid = np.concatenate([[data.obs_last_ppm], future_mid_ppm]) + offset
    tend = np.full(n, np.nan)
    tend[h:] = _target_end(tmid)
    inv = carbon_cycle(np.concatenate([hist_emis, np.zeros(future_mid_ppm.size)]), nonco2[:n], ecs=ecs,
                       model=cfg["carbon_cycle"], invert_from=h + 1, target_end_ppm=tend, c_pi=cpi,
                       fair=cfg["fair"], two_layer=cfg["two_layer"])
    return inv["emissions_gtco2"], offset


def _concentration_path(spec: dict, cfg: dict, data: Data, fy: np.ndarray, warnings: list, notes: list) -> np.ndarray:
    t = spec.get("type", "ssp")
    obs = data.obs_last_ppm
    if t == "ssp":
        sc = data.ssp(spec["scenario"])
        series = data.conc[sc]
        v = series[fy - FIRST_YEAR]
        if cfg["anchor_to_observed"]:
            off = float(series[data.last_hist_year - FIRST_YEAR] - obs)
            v = v - off
            notes.append(f"RCMIP {sc.upper()} concentrations shifted by {-off:+.2f} ppm so that "
                         f"{data.last_hist_year} matches the observed {obs:.2f} ppm.")
        label = f"RCMIP {sc.upper()} concentrations"
    elif t == "core":
        cy, cv = _core_pathway(cfg, data, warnings)
        v = cv[(fy - cy[0]).astype(int)]
        label = "CORe 4.0 historical-continuation pathway"
    elif t == "custom":
        v = _interp_points(np.concatenate([[data.last_hist_year], np.asarray(spec["years"], float)]),
                           np.concatenate([[obs], _arr(spec["ppm"])]), fy)
        label = "Custom concentration pathway"
        notes.append("Custom concentration pathway: linear between user control points, starting from the "
                     f"observed {data.last_hist_year} value; held constant after the last point.")
    else:
        raise ValueError("pathway type must be 'ssp', 'core' or 'custom'")
    ed = spec.get("edits")
    if ed:
        v = apply_point_edits(fy, v, ed["years"], ed["ppm"], data.last_hist_year)
        notes.append(f"{label}: user edits applied as offsets at {', '.join(str(int(y)) for y in ed['years'])} "
                     "(linear between edit points, tapering to zero at the last observed year).")
        label += " (edited)"
    if np.any(v <= 0) or not np.all(np.isfinite(v)):
        raise ValueError("concentration pathway must be positive and finite")
    spec["_label"] = label
    return v


def _emissions_baseline(spec: dict, cfg: dict, data: Data, n: int, warnings: list, notes: list):
    """Full (1750..end) baseline emissions and the SSP whose recent history / non-CO2 is used."""
    t = spec.get("type", "core")
    h = data.last_hist_year - FIRST_YEAR
    fy = np.arange(data.last_hist_year + 1, cfg["end_year"] + 1)
    if t == "ssp":
        sc = data.ssp(spec["scenario"])
        e = data.emis[sc][:n].copy()
        spec["_label"] = f"RCMIP {sc.upper()} emissions"
        return e, sc
    sc = data.ssp(cfg["non_co2_scenario"])
    hist = data.emissions_history(sc)
    if t == "custom":
        fut = _interp_points(spec["years"], spec["values"], fy)
        spec["_label"] = "Custom emissions pathway"
        notes.append("Custom baseline emissions: linear between user control points, held after the last point.")
        return np.concatenate([hist, fut]), sc
    if t == "core":
        cy, cv = _core_pathway(cfg, data, warnings)
        fut_ppm = cv[(fy - cy[0]).astype(int)]
        e, off = _invert(data, cfg, hist, fut_ppm, data.nonco2(sc, cfg["end_year"]), cfg["ecs"])
        spec["_label"] = "CORe-consistent emissions (diagnosed)"
        notes.append("CORe-consistent baseline: emissions diagnosed by inverting the carbon-cycle model so that "
                     "it reproduces the CORe 4.0 ppm pathway (after removing the model's own "
                     f"{data.last_hist_year} bias of {off:+.2f} ppm). These are model-implied, not observed or "
                     "projected emissions.")
        return e, sc
    raise ValueError("baseline type must be 'ssp', 'core' or 'custom'")


def _summ(years, arr, y):
    i = int(y) - int(years[0])
    return float(arr[i]) if 0 <= i < len(arr) else None


def run(payload: dict) -> dict:
    data = Data(payload.get("data") or {})
    cfg = _cfg(payload)
    if cfg["mode"] == "validation":
        return {"mode": "validation", "config": cfg, "validation": validate(data, cfg),
                "warnings": [], "assumptions": _validation_assumptions(cfg)}
    warnings: list[str] = []
    notes: list[str] = []
    end = cfg["end_year"]
    if end <= data.last_hist_year + 1:
        raise ValueError("end_year must be after the first projection year")
    fy = np.arange(data.last_hist_year + 1, end + 1)
    n = end - FIRST_YEAR + 1
    h = data.last_hist_year - FIRST_YEAR
    cpi = float(data.conc["historical"][0])
    ecs_c = cfg["ecs"]
    base_spec = dict(cfg["baseline"] or {"type": "core"})

    def temps(ppm_future, nonco2_full, ecs):
        f_co2, f_non = _forcing_parts(ppm_future, nonco2_full[h + 1:n], cfg)
        fh = _hist_forcing(data, nonco2_full[: h + 1], cfg)
        tt = _temperature(cfg["temperature_model"], fy, f_co2 + f_non, fh, ecs, cfg["heat_capacity"],
                          cfg["initial_temp_anomaly_c"], cfg["two_layer"])
        return f_co2, f_non, tt

    sides = {}
    if cfg["mode"] == "concentration":
        scen_spec = dict(cfg["scenario"] or {})
        for key, spec in (("baseline", base_spec), ("scenario", scen_spec)):
            ppm = _concentration_path(spec, cfg, data, fy, warnings, notes)
            sc_non = data.ssp(_nonco2_name(spec, cfg))
            nonco2 = data.nonco2(sc_non, end)
            e_full, _ = _invert(data, cfg, data.emissions_history(sc_non), ppm, nonco2, ecs_c)
            sides[key] = {"label": spec["_label"], "ppm": ppm, "nonco2": nonco2, "emissions": e_full[h + 1:n],
                          "emissions_kind": "implied"}
        notes.append("Emissions shown in concentration mode are implied by inverting the simplified carbon-cycle "
                     "model; they are diagnostic only.")
    else:
        e_base, sc_non = _emissions_baseline(base_spec, cfg, data, n, warnings, notes)
        if np.isnan(e_base).any():
            raise ValueError("baseline emissions contain gaps")
        e_scen_future, iv_notes = apply_interventions(fy, e_base[h + 1:n], cfg["interventions"] or {}, data, e_base)
        notes.extend(iv_notes)
        e_scen = np.concatenate([e_base[: h + 1], e_scen_future])
        nonco2 = data.nonco2(sc_non, end)
        offsets = {}

        def ppm_from(e_full, ecs):
            r = carbon_cycle(e_full, nonco2, ecs=ecs, model=cfg["carbon_cycle"], c_pi=cpi,
                             fair=cfg["fair"], two_layer=cfg["two_layer"])
            off = float(r["ppm"][h] - data.obs_last_ppm) if cfg["anchor_to_observed"] else 0.0
            return r["ppm"][h + 1:n] - off, off

        for key, e_full, label in (("baseline", e_base, base_spec["_label"]),
                                   ("scenario", e_scen, base_spec["_label"] + " + interventions")):
            ppm, off = ppm_from(e_full, ecs_c)
            offsets[key] = off
            sides[key] = {"label": label, "ppm": ppm, "nonco2": nonco2, "emissions": e_full[h + 1:n],
                          "emissions_kind": "input", "e_full": e_full}
        if cfg["anchor_to_observed"]:
            notes.append(f"Carbon-cycle output harmonised to the observed {data.last_hist_year} concentration "
                         f"({data.obs_last_ppm:.2f} ppm) by a constant offset of {-offsets['baseline']:+.2f} ppm.")

    for key, sd in sides.items():
        f_co2, f_non, tt = temps(sd["ppm"], sd["nonco2"], ecs_c)
        sd.update(forcing_co2=f_co2, forcing_non_co2=f_non, forcing=f_co2 + f_non, temperature=tt)
        if cfg["uncertainty"]:
            def tfun(ecs, sd=sd):
                if cfg["mode"] == "emissions":
                    ppm, _ = ppm_from(sd["e_full"], ecs)
                else:
                    ppm = sd["ppm"]
                return temps(ppm, sd["nonco2"], ecs)[2]
            sd["band"] = _band(tfun, ecs_c)
            if cfg["mode"] == "emissions":
                sd["ppm_band"] = _band(lambda ecs, sd=sd: ppm_from(sd["e_full"], ecs)[0], ecs_c)

    def side_out(sd):
        o = {
            "label": sd["label"],
            "emissions_gtco2": sd["emissions"],
            "emissions_kind": sd["emissions_kind"],
            "ppm": sd["ppm"],
            "forcing_wm2": sd["forcing"],
            "forcing_co2_wm2": sd["forcing_co2"],
            "forcing_non_co2_wm2": sd["forcing_non_co2"],
            "temperature_c": sd["temperature"],
        }
        if "band" in sd:
            o["temperature_band_c"] = sd["band"]
        if "ppm_band" in sd:
            o["ppm_band"] = sd["ppm_band"]
        pk = int(np.argmax(sd["temperature"]))
        o["peak_warming"] = {"value_c": float(sd["temperature"][pk]), "year": int(fy[pk])}
        return o

    b, s = sides["baseline"], sides["scenario"]
    delta = {}
    for y in (2050, 2100):
        if fy[0] <= y <= fy[-1]:
            delta[str(y)] = {k: _summ(fy, s[v], y) - _summ(fy, b[v], y)
                             for k, v in (("emissions_gtco2", "emissions"), ("ppm", "ppm"),
                                          ("forcing_wm2", "forcing"), ("temperature_c", "temperature"))}
            delta[str(y)]["baseline"] = {k: _summ(fy, b[v], y) for k, v in (("emissions_gtco2", "emissions"), ("ppm", "ppm"), ("temperature_c", "temperature"))}
            delta[str(y)]["scenario"] = {k: _summ(fy, s[v], y) for k, v in (("emissions_gtco2", "emissions"), ("ppm", "ppm"), ("temperature_c", "temperature"))}
    cum_b, cum_s = float(np.sum(b["emissions"])), float(np.sum(s["emissions"]))

    hist_e = data.emissions_history(_nonco2_name(base_spec, cfg) if base_spec.get("type") == "ssp" else cfg["non_co2_scenario"])
    hist_mask = data.hist_years >= 1940
    result = {
        "mode": cfg["mode"],
        "config": {k: v for k, v in cfg.items() if k not in ("core_pathway",)},
        "years": fy,
        "baseline": side_out(b),
        "scenario": side_out(s),
        "delta": delta,
        "cumulative_emissions_gtco2": {"period": [int(fy[0]), int(fy[-1])], "baseline": cum_b,
                                        "scenario": cum_s, "difference": cum_s - cum_b,
                                        "kind": b["emissions_kind"]},
        "history": {
            "years": data.hist_years[hist_mask],
            "ppm_observed": data.hist_ppm[hist_mask],
            "emissions_gtco2": hist_e[data.hist_years[hist_mask] - FIRST_YEAR],
            "emissions_source": "RCMIP v5.1.0 historical (to 2014) + "
                                + (base_spec["scenario"] if base_spec.get("type") == "ssp" else cfg["non_co2_scenario"]).upper()
                                + " (2015 onward)",
        },
        "assumptions": _assumptions(cfg) + notes,
        "warnings": warnings,
    }
    if cfg["temperature_model"] == "core4":
        t_last = float(cfg["initial_temp_anomaly_c"])
    else:
        t_last = float(two_layer_response(_hist_forcing(data, b["nonco2"][: h + 1], cfg), ecs_c, cfg["two_layer"])[-1])
    result["reference_state"] = {"year": data.last_hist_year, "ppm_observed": data.obs_last_ppm, "temperature_c": t_last,
                                 "temperature_note": ("CORe 4.0 initial anomaly (assumed, not simulated)"
                                                      if cfg["temperature_model"] == "core4" else
                                                      "two-layer model state after spin-up from 1750 (simulated)")}
    e_jump = float(b["emissions"][0] - hist_e[-1])
    if cfg["mode"] == "emissions" and base_spec.get("type") == "core" and abs(e_jump) > 3.0:
        warnings.append(f"Diagnosed CORe-consistent emissions start {e_jump:+.1f} GtCO2/yr away from the "
                        f"{data.last_hist_year} historical value: the simplified carbon cycle grows CO2 slightly faster "
                        "than observed over 2015-2025, so it needs lower emissions to follow CORe's ppm path.")
    if cfg.get("local_scaling") and cfg["local_scaling"].get("enabled"):
        result["local_scaling"] = scale_local_projection(cfg["local_scaling"], fy, b["temperature"], s["temperature"],
                                                         t_last, data.last_hist_year)
        result["assumptions"].append(result["local_scaling"]["assumption"])
    return result


def _assumptions(cfg: dict) -> list[str]:
    a = [
        "Catalyst 1.0 is a new, simplified scenario engine; results are conditional model outputs, not predictions.",
        f"CO2 forcing F = 5.35 ln(C/{cfg['preindustrial_co2_ppm']}) W/m2 (CORe 4.0 expression).",
    ]
    if cfg["non_co2_forcing"] == "scenario":
        a.append("Non-CO2 forcing INCLUDED: RCMIP anthropogenic non-CO2 effective radiative forcing of the "
                 "associated SSP (core/custom pathways use " + cfg["non_co2_scenario"].upper() + "). Natural forcing excluded.")
    else:
        a.append("CO2-only forcing: methane, nitrous oxide, aerosols and other non-CO2 agents are NOT included "
                 "in the displayed temperature.")
    if cfg["temperature_model"] == "core4":
        a.append(f"Temperature: CORe 4.0 one-box response (lambda = 3.7/ECS, ECS = {cfg['ecs']:.2f} C, heat capacity "
                 f"{cfg['heat_capacity']:.1f} W yr/m2/K) starting from {cfg['initial_temp_anomaly_c']:.2f} C in the last "
                 "observed year. Its ~6-7 yr response time makes it close to equilibrium warming; it has no deep ocean.")
    else:
        tl = dict(TWO_LAYER_DEFAULTS, **(cfg["two_layer"] or {}))
        a.append(f"Temperature: two-layer energy balance model (Geoffroy et al. 2013 multi-model mean C={tl['c_upper']}, "
                 f"C_D={tl['c_deep']}, gamma={tl['gamma']}) with lambda = {F2X_TWO_LAYER:.3f}/ECS (ECS = {cfg['ecs']:.2f} C), "
                 "spun up from 1750 with the historical forcing; the heat-capacity setting applies to the CORe response only.")
    if cfg["mode"] in ("emissions", "concentration"):
        cc = cfg["carbon_cycle"]
        a.append("Carbon cycle: " + ("FaIR v1.x-style state-dependent impulse response (Millar et al. 2017; Joos et al. "
                 "2013 coefficients; r0=35, rC=0.019, rT=4.165)" if cc == "fair_v1" else
                 "Joos et al. (2013) fixed impulse response (AR5)") +
                 "; its warming feedback uses an internal two-layer temperature with CO2 + anthropogenic non-CO2 forcing.")
    if cfg["uncertainty"]:
        a.append("Bands: deterministic re-runs at the IPCC AR6 ECS ranges (likely 2.5-4.0 C, very likely 2.0-5.0 C); "
                 "they do not include carbon-cycle, forcing or scenario uncertainty.")
    return a


def _validation_assumptions(cfg: dict) -> list[str]:
    return ["Validation runs use ECS = 3.0 C for the carbon-cycle warming feedback and each SSP's own RCMIP "
            "anthropogenic non-CO2 forcing; historical run uses RCMIP historical emissions to 2014 and SSP2-4.5 "
            "emissions for 2015 onward (no anchoring/harmonisation)."]


# ---------------------------------------------------------------------------
# Validation (the honest "how simplified is this" table)
# ---------------------------------------------------------------------------
def validate(data: Data, cfg: dict | None = None) -> dict:
    cfg = dict(DEFAULTS, **(cfg or {}))
    cpi = float(data.conc["historical"][0])
    out = {}
    for model in ("fair_v1", "joos2013"):
        e = data.emis["ssp245"]
        non = data.nonco2("ssp245", 2100)
        r = carbon_cycle(e, non, ecs=3.0, model=model, c_pi=cpi, fair=cfg.get("fair"), two_layer=cfg.get("two_layer"))
        ppm = r["ppm"]
        noaa_years = [y for y in sorted(data.noaa) if 1979 <= y <= data.last_hist_year]
        err = np.array([ppm[y - FIRST_YEAR] - data.noaa[y] for y in noaa_years])
        rc = data.conc["historical"]
        yy = np.arange(1850, 2015)
        err2 = ppm[yy - FIRST_YEAR] - rc[yy - FIRST_YEAR]
        hist = {
            "vs_noaa_global": {"years": [noaa_years[0], noaa_years[-1]] if noaa_years else None,
                               "rmse_ppm": float(np.sqrt(np.mean(err ** 2))) if err.size else None,
                               "bias_ppm": float(np.mean(err)) if err.size else None,
                               "max_abs_ppm": float(np.max(np.abs(err))) if err.size else None,
                               "last_year_error_ppm": float(err[-1]) if err.size else None},
            "vs_rcmip_historical": {"years": [1850, 2014], "rmse_ppm": float(np.sqrt(np.mean(err2 ** 2))),
                                    "max_abs_ppm": float(np.max(np.abs(err2))), "error_2014_ppm": float(err2[-1])},
        }
        ssps = []
        for sc in SSP_NAMES:
            if sc not in data.emis:
                continue
            rr = carbon_cycle(data.emis[sc], data.nonco2(sc, 2100), ecs=3.0, model=model, c_pi=cpi,
                              fair=cfg.get("fair"), two_layer=cfg.get("two_layer"))
            row = {"scenario": sc}
            for y in (2050, 2100):
                m, ref = float(rr["ppm"][y - FIRST_YEAR]), float(data.conc[sc][y - FIRST_YEAR])
                row[f"model_{y}_ppm"] = m
                row[f"rcmip_{y}_ppm"] = ref
                row[f"error_{y}_ppm"] = m - ref
                row[f"error_{y}_pct"] = 100.0 * (m - ref) / ref
            fut = np.arange(2015, 2101) - FIRST_YEAR
            row["max_abs_error_2015_2100_ppm"] = float(np.max(np.abs(rr["ppm"][fut] - data.conc[sc][fut])))
            ssps.append(row)
        out[model] = {"historical": hist, "ssp": ssps}
    return out


# ---------------------------------------------------------------------------
# Optional, ILLUSTRATIVE global -> local link (off by default)
# ---------------------------------------------------------------------------
def scale_local_projection(spec: dict, years: np.ndarray, global_baseline: np.ndarray,
                           global_scenario: np.ndarray, t_last_obs: float, last_obs_year: int) -> dict:
    """Heuristic: scale a station projection's change since `reference_year` by the ratio of
    scenario to baseline GLOBAL warming since that year. Not a downscaling method.

    Both global series share the state `t_last_obs` in `last_obs_year` (they only differ after it)."""
    st = spec.get("station") or {}
    if "years" not in st or "values" not in st:
        raise ValueError("local_scaling.station needs 'years' and 'values'")
    sy = np.asarray(st["years"], int)
    ref = int(spec.get("reference_year", last_obs_year))
    min_w = float(spec.get("min_baseline_warming_c", 0.1))
    gy = np.concatenate([[last_obs_year], np.asarray(years, int)])
    gb = np.concatenate([[t_last_obs], global_baseline])
    gs = np.concatenate([[t_last_obs], global_scenario])
    if not gy[0] <= ref <= gy[-1]:
        raise ValueError(f"local_scaling.reference_year must be between {gy[0]} and {gy[-1]}")
    db = np.interp(sy, gy, gb) - np.interp(ref, gy, gb)
    ds = np.interp(sy, gy, gs) - np.interp(ref, gy, gs)
    w = np.clip(np.abs(db) / min_w, 0.0, 1.0)  # blend to ratio 1 while baseline warming is tiny
    with np.errstate(divide="ignore", invalid="ignore"):
        raw = np.where(np.abs(db) > 1e-9, ds / db, 1.0)
    ratio = np.where((sy > ref) & (sy <= gy[-1]), w * raw + (1.0 - w), 1.0)
    ratio = np.where(np.isfinite(ratio), ratio, 1.0)
    out = {"label": st.get("label", "station"), "years": sy, "reference_year": ref, "ratio": ratio,
           "illustrative": True,
           "assumption": ("ILLUSTRATIVE ONLY (local scaling): the station's projected change since "
                          f"{ref} is multiplied by the ratio of scenario to baseline global warming since {ref}. "
                          "This pattern-scaling heuristic is not a validated downscaling method and ignores "
                          "regional circulation, land-use and aerosol effects.")}
    for k in ("values", "lower", "upper"):
        if st.get(k) is not None:
            v = _arr(st[k])
            r0 = float(np.interp(ref, sy, v))
            out[k] = np.where(sy > ref, r0 + (v - r0) * ratio, v)
    return out
