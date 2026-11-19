"""Solaris Python <-> browser interface (see CONTRACT.md and models/API.md).

Every public function takes and returns JSON-serialisable dicts (NaN -> None). Every result has
``model``, ``version``, ``inputs``, ``warnings``, ``provenance`` and ``runtime_ms``.

Sections are owned by different people: keep edits inside your own section.
CORe / Catalyst live in ``core.py`` / ``catalyst.py`` and are imported lazily in ``dispatch``.
"""
from __future__ import annotations

import time
from typing import Any, Dict


# ===========================================================================
# Shared helpers
# ===========================================================================

def _error_result(model: str, version: str, exc: Exception, payload_inputs: Any, t0: float) -> Dict[str, Any]:
    return {
        "model": model, "version": version, "ok": False,
        "error": {"type": type(exc).__name__, "message": str(exc)},
        "inputs": payload_inputs, "warnings": [str(exc)], "provenance": {},
        "runtime_ms": round((time.perf_counter() - t0) * 1000.0, 1),
    }


# ===========================================================================
# Aeros 4.0 + Nexus 1.0 section (owner: Aeros/Nexus models)
# ===========================================================================

_AEROS_PROVENANCE_METHOD = [
    "Port of the Solaris Aeros 4.0 notebook (cells 01+02), recorded configuration fast_mode=True: "
    "ensemble poly2 + pchip + ridge + lin_modern, weights from SLSQP stacking on decadal hindcasts "
    "(validation year min(2014, last−10)), quadratic-trend residuals, AR(1) residual simulator, "
    "residual block bootstrap + N(0, 0.15 °C) observation noise, 2 °C/decade sanity filter, "
    "2.5–97.5 percentile bounds.",
    "Missing years inside each season's span are filled by PCHIP interpolation (flagged 'imputed').",
    "Re-implemented without sklearn/statsmodels; matches the notebook code to ~4e-5 °C on test series "
    "(difference comes from statsmodels' AR(1) optimiser tolerance).",
    "Not ported (inactive in the recorded run): Gaussian process, Prophet, GARCH, emcee.",
]


def _station_provenance(station: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    src = payload.get("provenance") or {}
    return {
        "data_source": src.get("data_source") or station.get("source") or station.get("source_file")
        or "supplied by caller",
        "source_url": src.get("source_url") or station.get("source_url"),
        "station_id": station.get("id"),
    }


def run_aeros(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Aeros 4.0 seasonal projection for one station. See models/API.md#aeros."""
    from . import aeros
    from .aeros_io import (aeros_options, format_aeros_result, jsonable, parse_station_series, seed_label)

    t0 = time.perf_counter()
    try:
        station, years, seasons = parse_station_series(payload or {})
        opts = aeros_options(payload or {})
        label = seed_label(station, opts)
        raw = aeros.run_station(
            label, years, seasons, end_year=opts["end_year"], n_bootstrap=opts["n_bootstrap"],
            seed=opts["seed"], train_end_year=opts["train_end_year"], impute=opts["impute_missing_years"],
            unit_mode=opts["unit_mode"], rolling_cv=opts["rolling_cv"], n_paths_out=opts["sample_paths"])
        body = format_aeros_result(raw, station, opts, label)
        warnings = list(raw["warnings"])
        if body["station"]["hemisphere"] == "unknown":
            warnings.append("No latitude/hemisphere supplied: seasons are reported as D-J-F / J-J-A without "
                            "winter/summer labels.")
        if opts["n_bootstrap"] < 200:
            warnings.append(f"{opts['n_bootstrap']} bootstrap paths (notebook default 200): interval bounds are "
                            "noisier than the reference configuration.")
        result = {
            "model": "aeros", "version": aeros.AEROS_VERSION, "port_revision": aeros.PORT_REVISION, "ok": True,
            "inputs": dict(opts, seed_label=label, n_years_supplied=len(years),
                           seasons_supplied=sorted(seasons.keys())),
            "warnings": warnings,
            "provenance": dict(_station_provenance(station, payload or {}), method=_AEROS_PROVENANCE_METHOD,
                               units="°C; slopes °C/decade"),
            **body,
        }
        result["runtime_ms"] = round((time.perf_counter() - t0) * 1000.0, 1)
        return jsonable(result)
    except (aeros.AerosInputError, ValueError, TypeError, KeyError) as exc:
        return jsonable(_error_result("aeros", aeros.AEROS_VERSION, exc, (payload or {}).get("options"), t0))


_NEXUS_DEFAULT_ANALYSES = ("data_quality", "trends", "hindcast", "bias_correction")


def run_nexus(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Nexus 1.0 validation/context layer. See models/API.md#nexus.

    Single station: same station/years/seasons fields as run_aeros, plus options.
    Station set: {"stations": [...bundle station objects...], "options": {...}}.
    """
    from . import aeros, nexus
    from .aeros_io import (aeros_options, format_aeros_result, jsonable, parse_station_series, seed_label)

    t0 = time.perf_counter()
    payload = payload or {}
    o = dict(payload.get("options") or {})
    try:
        warnings = []
        if payload.get("stations") is not None:
            min_years = int(o.get("min_years_per_window", 20))
            group_by = tuple(o.get("group_by", ("country", "urban_rural")))
            res = nexus.station_set_trends(payload["stations"], group_by=group_by, min_years=min_years)
            warnings += res.pop("warnings")
            result = {
                "model": "nexus", "version": nexus.NEXUS_VERSION, "ok": True, "mode": "station_set",
                "inputs": {"n_stations": len(payload["stations"]), "group_by": list(group_by),
                           "min_years_per_window": min_years},
                "warnings": warnings,
                "provenance": {"method": res["method"], "data_source": (payload.get("provenance") or {}).get(
                    "data_source", "supplied by caller"),
                    "note": "Nexus 1.0 is new and simplified; statistics are computed on the supplied series."},
                "station_set": res,
            }
            result["runtime_ms"] = round((time.perf_counter() - t0) * 1000.0, 1)
            return jsonable(result)

        station, years, seasons = parse_station_series(payload)
        if not any(aeros.SEASON_ALIASES.get(k) and v is not None and any(x is not None for x in v)
                   for k, v in seasons.items()):
            raise aeros.AerosInputError("No seasonal values supplied (need D-J-F and/or J-J-A).")
        a_opts = aeros_options({"options": {k: v for k, v in o.items() if k in (
            "seed", "end_year", "mode", "n_bootstrap", "seed_label", "unit_mode")}})
        label = seed_label(station, a_opts)
        analyses = tuple(o.get("analyses", _NEXUS_DEFAULT_ANALYSES))
        cutoff = int(o.get("train_end_year", 2000))
        shrinkage = float(o.get("shrinkage", 0.5))
        min_years = int(o.get("min_years_per_window", 20))
        out: Dict[str, Any] = {}

        if "data_quality" in analyses:
            out["data_quality"] = nexus.data_quality_report(years, seasons, a_opts["unit_mode"])

        if "trends" in analyses:
            hemi = aeros_io_hemisphere(station)
            trends = {}
            for key, vals in seasons.items():
                canon = aeros.SEASON_ALIASES.get(key)
                if canon is None or vals is None:
                    continue
                oy, ot, _ = aeros.clean_series(years, vals)
                if len(oy) == 0:
                    continue
                ts = nexus.trend_statistics(oy, ot, min_years=min_years)
                ts["local_label"] = _local_label(canon, hemi)
                trends[canon] = ts
            out["trends"] = {"method": ("OLS slope (°C/decade) on observed (non-imputed) values, t-based 95% CI; "
                                        f"≥{min_years} valid years per window. 'se_ar1_adjusted' is an extra, "
                                        "autocorrelation-aware SE (not used by the poster)."),
                             "seasons": trends}

        hindcast = None
        if "hindcast" in analyses or "bias_correction" in analyses:
            try:
                hindcast = nexus.hindcast_audit(label, years, seasons, cutoff=cutoff,
                                                n_bootstrap=a_opts["n_bootstrap"], seed=a_opts["seed"],
                                                end_year=a_opts["end_year"])
                warnings += [f"hindcast: {w}" for w in hindcast.pop("warnings")]
                out["hindcast"] = dict(hindcast, n_bootstrap=a_opts["n_bootstrap"],
                                       leakage_guard=("Input truncated to years <= cutoff before imputation, "
                                                      "weighting, residual fitting and bootstrap."))
            except aeros.AerosInputError as exc:
                warnings.append(f"hindcast not run: {exc}")

        if "rolling_origin" in analyses:
            cutoffs = tuple(int(c) for c in o.get("rolling_cutoffs", (1980, 1990, 2000, 2010)))
            ro = nexus.rolling_origin(label, years, seasons, cutoffs=cutoffs,
                                      horizon=int(o.get("rolling_horizon", 10)),
                                      n_bootstrap=int(o.get("rolling_n_bootstrap", 100)), seed=a_opts["seed"],
                                      end_year=a_opts["end_year"])
            warnings += [f"rolling origin: {w}" for w in ro.pop("warnings")]
            out["rolling_origin"] = ro

        if "bias_correction" in analyses and hindcast is not None:
            base = payload.get("aeros_result")
            if not base or "seasons" not in base:
                raw = aeros.run_station(label, years, seasons, end_year=a_opts["end_year"],
                                        n_bootstrap=a_opts["n_bootstrap"], seed=a_opts["seed"],
                                        unit_mode=a_opts["unit_mode"], rolling_cv=False)
                base = jsonable(format_aeros_result(raw, station, dict(a_opts, include_rolling_cv_rows=False), label))
                base_note = "Aeros baseline computed by Nexus with the same seed/options (identical to run_aeros)."
            else:
                base_note = "Aeros baseline taken from payload['aeros_result'] unchanged."
            out["bias_correction"] = {
                "aeros_baseline": {s: {"projection": v["projection"], "summary_end": v["summary_end"]}
                                   for s, v in base["seasons"].items()},
                "aeros_baseline_note": base_note,
                "adjusted": nexus.bias_corrected_view(base["seasons"], hindcast, shrinkage),
            }

        result = {
            "model": "nexus", "version": nexus.NEXUS_VERSION, "ok": True, "mode": "station",
            "inputs": {"mode": a_opts["mode"], "n_bootstrap": a_opts["n_bootstrap"], "seed": a_opts["seed"],
                       "end_year": a_opts["end_year"], "unit_mode": a_opts["unit_mode"],
                       "analyses": list(analyses), "train_end_year": cutoff, "shrinkage": shrinkage,
                       "min_years_per_window": min_years, "seed_label": label,
                       "rolling_cutoffs": list(o.get("rolling_cutoffs", (1980, 1990, 2000, 2010)))
                       if "rolling_origin" in analyses else None,
                       "rolling_n_bootstrap": int(o.get("rolling_n_bootstrap", 100))
                       if "rolling_origin" in analyses else None},
            "warnings": warnings,
            "provenance": dict(_station_provenance(station, payload),
                               method=["Nexus 1.0 (new, simplified validation layer). Never modifies Aeros output.",
                                       nexus.ERROR_CONVENTION]),
            "station": {"id": station.get("id"), "name": station.get("display_name") or station.get("name"),
                        "hemisphere": aeros_io_hemisphere(station)},
            **out,
        }
        result["runtime_ms"] = round((time.perf_counter() - t0) * 1000.0, 1)
        return jsonable(result)
    except (aeros.AerosInputError, ValueError, TypeError, KeyError) as exc:
        return jsonable(_error_result("nexus", nexus.NEXUS_VERSION, exc, o, t0))


def aeros_io_hemisphere(station):
    from .aeros_io import station_hemisphere
    return station_hemisphere(station)[0]


def _local_label(season, hemi):
    from .aeros_io import local_season_label
    return local_season_label(season, hemi)


# ===========================================================================
# CORe 4.0 + Catalyst 1.0 section (owner: CORe/Catalyst models) — science in core.py / catalyst.py
# ===========================================================================

def _cc_jsonable(obj: Any) -> Any:
    """numpy -> plain python, NaN/inf -> None (CORe/Catalyst results)."""
    import math
    import numpy as np

    if isinstance(obj, dict):
        return {str(k): _cc_jsonable(v) for k, v in obj.items() if not str(k).startswith("_")}
    if isinstance(obj, (list, tuple)):
        return [_cc_jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return _cc_jsonable(obj.tolist())
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        v = float(obj)
        return v if math.isfinite(v) else None
    return obj


_CO2_SOURCES = {
    "noaa_gml": "NOAA GML global annual mean CO2 (Lan, Tans & Thoning), "
                "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_gl.txt",
    "rcmip": "RCMIP v5.1.0 (Nicholls et al. 2020; Meinshausen et al. 2020 CMIP6 concentrations), "
             "https://zenodo.org/records/4589756",
}


def run_core(payload: Dict[str, Any]) -> Dict[str, Any]:
    """CORe 4.0 historical-continuation CO2 pathway. See models/API.md#core."""
    t0 = time.perf_counter()
    payload = payload or {}
    try:
        from . import core

        hist = payload.get("historical_co2") or (payload.get("data") or {}).get("historical_co2")
        if not hist or "years" not in hist or "ppm" not in hist:
            raise ValueError("payload.historical_co2 {years, ppm} (or payload.data.historical_co2) is required")
        settings = payload.get("settings") or {}
        r = core.run(hist["years"], hist["ppm"], settings, include_points=bool(payload.get("include_validation_points")))
        s = r["settings"]
        hy, hp = r["historical_years"], r["historical_ppm"]
        warnings = []
        if int(hy[0]) != 1940 or int(hy[-1]) != 2025:
            warnings.append(f"Historical input covers {int(hy[0])}-{int(hy[-1])}; the poster/notebook run used 1940-2025, "
                            "so numbers will differ from 620.86 ppm.")
        changed = {k: v for k, v in s.items() if core.DEFAULTS[k] != v}
        if changed:
            warnings.append("Non-default CORe settings: " + ", ".join(f"{k}={v}" for k, v in sorted(changed.items())))
        if r["failures"]:
            warnings.append(f"{len(r['failures'])} candidate-model fits failed and were skipped (as in the notebook).")
        fy = r["future_years"]
        i_end = len(fy) - 1
        src = hist.get("source")
        result = {
            "model": "core", "version": core.VERSION, "ok": True,
            "inputs": {"settings": s, "historical": {
                "first_year": int(hy[0]), "last_year": int(hy[-1]), "n_years": int(len(hy)),
                "last_ppm": float(hp[-1]),
                "source": sorted(set(src)) if isinstance(src, list) else (src or "supplied by caller")}},
            "warnings": warnings,
            "provenance": {
                "data_sources": [_CO2_SOURCES["rcmip"] + " (1940-1978, historical)",
                                 _CO2_SOURCES["noaa_gml"] + " (1979 onward)"],
                "method": [
                    "Port of the Solaris CORe 4.0 notebook (cells 07+08): one validation-weighted historical-continuation "
                    "CO2 pathway, not an IPCC/SSP emissions scenario.",
                    "10 candidate trend/growth models; rolling-origin backtest (40-yr minimum training, 10-yr horizon, "
                    "cutoff every 3 yr); models within 1.35x of the best RMSE kept (EWMA kept within 1.75x); "
                    "weights 1/(RMSE + 0.25|bias|)^2; growth/acceleration-constrained ensemble.",
                    "Uncertainty: 1.25 x (90th-percentile ensemble backtest error x sqrt(horizon/10) + 0.85 x model spread). "
                    "Conformal-style, not a probabilistic interval.",
                    "Forcing 5.35 ln(C/278.3) W/m2 (CO2 only). Temperature response: one-box T += (F - (3.7/ECS) T)/C with "
                    "ECS 3.0 C, C = 8 W yr/m2/K, starting at 1.2 C in 2025; close to CO2-only equilibrium warming.",
                    "numpy/scipy re-implementation; matches the original cell on identical input to floating-point "
                    "precision (see models/NOTES.md).",
                ],
                "conditional": "Conditional model output, not a prediction.",
            },
            "historical": {"years": hy, "ppm": hp, "forcing_wm2": r["historical_forcing_wm2"]},
            "projection": {
                "years": fy, "ppm_mean": r["ppm_mean"], "ppm_lower": r["ppm_lower"], "ppm_upper": r["ppm_upper"],
                "forcing_wm2": r["forcing_wm2"], "forcing_lower_wm2": r["forcing_lower_wm2"],
                "forcing_upper_wm2": r["forcing_upper_wm2"], "temperature_response_c": r["temperature_response_c"],
                "model_spread_ppm": r["model_spread_ppm"], "uncertainty_ppm": r["uncertainty_ppm"],
            },
            "summary_end": {
                "year": int(fy[i_end]), "ppm_mean": r["ppm_mean"][i_end], "ppm_lower": r["ppm_lower"][i_end],
                "ppm_upper": r["ppm_upper"][i_end], "forcing_wm2": r["forcing_wm2"][i_end],
                "forcing_lower_wm2": r["forcing_lower_wm2"][i_end], "forcing_upper_wm2": r["forcing_upper_wm2"][i_end],
                "temperature_response_c": r["temperature_response_c"][i_end],
                "conformal_base_error_ppm": r["conformal_base_error_ppm"],
            },
            "ensemble": [{"model": m, "weight": w} for m, w in r["ensemble"]],
            "members": r["members"],
            "growth_constraints": r["growth_constraints"],
            "validation": {"candidates": r["validation_summary"], "ensemble_backtest": r["ensemble_backtest"],
                           "failures": r["failures"]},
        }
        if payload.get("include_validation_points"):
            result["validation"]["points"] = r["validation_points"]
            result["validation"]["ensemble_points"] = r["ensemble_validation_points"]
        result["runtime_ms"] = round((time.perf_counter() - t0) * 1000.0, 1)
        return _cc_jsonable(result)
    except (ValueError, TypeError, KeyError, IndexError) as exc:
        return _cc_jsonable(_error_result("core", "4.0", exc, {k: v for k, v in payload.items()
                                                                if k not in ("historical_co2", "data")}, t0))


def run_catalyst(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Catalyst 1.0 what-if scenario engine. See models/API.md#catalyst."""
    t0 = time.perf_counter()
    payload = payload or {}
    try:
        from . import catalyst

        r = catalyst.run(payload)
        cfg = r.pop("config")
        warnings = r.pop("warnings")
        result = {
            "model": "catalyst", "version": catalyst.VERSION, "ok": True,
            "inputs": cfg, "warnings": warnings,
            "provenance": {
                "data_sources": [_CO2_SOURCES["rcmip"] + ": SSP CO2 concentrations, CO2 emissions, effective radiative forcing",
                                 _CO2_SOURCES["noaa_gml"]],
                "method": [
                    "Catalyst 1.0 (new, simplified): CO2 concentration or emissions pathway -> CORe 4.0 forcing -> "
                    "CORe 4.0 temperature response (default) or two-layer energy balance model.",
                    "Carbon cycle: FaIR v1.x-style state-dependent impulse response (Millar et al. 2017, ACP 17:7213; "
                    "Smith et al. 2018, GMD 11:2273) with Joos et al. 2013 (ACP 13:2793) coefficients; "
                    "option: fixed Joos et al. 2013 impulse response.",
                    "Two-layer model: Held et al. 2010; Geoffroy et al. 2013 (J. Climate 26:1841) CMIP5 mean parameters.",
                    "ECS ranges: IPCC AR6 WG1 (likely 2.5-4.0 C, very likely 2.0-5.0 C).",
                ],
                "conditional": "Conditional what-if output from a simplified model, not a prediction or policy assessment.",
            },
            **r,
        }
        result["runtime_ms"] = round((time.perf_counter() - t0) * 1000.0, 1)
        return _cc_jsonable(result)
    except (ValueError, TypeError, KeyError, IndexError) as exc:
        return _cc_jsonable(_error_result("catalyst", "1.0", exc, {k: v for k, v in payload.items()
                                                                   if k not in ("data", "core_pathway")}, t0))


# ===========================================================================
# Dispatcher
# ===========================================================================

def dispatch(model: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Route to a model by name: "aeros" | "core" | "catalyst" | "nexus"."""
    name = (model or "").strip().lower()
    if name == "aeros":
        return run_aeros(payload)
    if name == "nexus":
        return run_nexus(payload)
    if name == "core":
        return run_core(payload)  # lazy import of core.py inside
    if name == "catalyst":
        return run_catalyst(payload)  # lazy import of catalyst.py inside
    msg = f"Unknown model '{model}'. Expected one of: aeros, core, catalyst, nexus."
    return {"model": name, "version": None, "ok": False, "error": {"type": "ValueError", "message": msg},
            "inputs": payload, "warnings": [msg], "provenance": {}, "runtime_ms": 0.0}
