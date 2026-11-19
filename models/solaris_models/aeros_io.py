"""Payload parsing and JSON result building shared by Aeros and Nexus (pure Python + numpy)."""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from . import aeros

DISCLAIMER = ("Conditional model output: a statistical extrapolation of this station's own seasonal record "
              "under the Aeros 4.0 method. It is not a verified prediction and contains no emissions scenario.")


def jsonable(obj: Any) -> Any:
    """Recursively convert numpy types to plain Python; NaN/inf -> None."""
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [jsonable(v) for v in obj.tolist()]
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        f = float(obj)
        return f if math.isfinite(f) else None
    return obj


def station_hemisphere(station: Dict[str, Any]) -> Tuple[str, bool]:
    """Return (hemisphere, inferred_from_latitude). 'unknown' if neither given."""
    hemi = (station or {}).get("hemisphere")
    if isinstance(hemi, str) and hemi.lower().startswith(("n", "s")):
        return ("northern" if hemi.lower().startswith("n") else "southern"), False
    lat = (station or {}).get("lat", (station or {}).get("latitude"))
    try:
        latf = float(lat)
        return ("southern" if latf < 0 else "northern"), True
    except (TypeError, ValueError):
        return "unknown", False


def local_season_label(season: str, hemisphere: str) -> Optional[str]:
    if hemisphere == "unknown":
        return None
    nh = {"D-J-F": "winter", "J-J-A": "summer"}
    sh = {"D-J-F": "summer", "J-J-A": "winter"}
    return (nh if hemisphere == "northern" else sh)[season]


def parse_station_series(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], List[int], Dict[str, List]]:
    """Accept the documented format and two convenience formats.

    1. {"station": {...}, "years": [...], "seasons": {"D-J-F": [...], "J-J-A": [...]}}
    2. bundle station: {"station": {..., "series": {"years": [...], "D-J-F": [...], ...}}} or the
       bundle station object itself as the payload.
    3. legacy golden fixture: {"station": {...}, "season": "D-J-F", "historical": [{"year","value"}]}
    """
    station = dict(payload.get("station") or {})
    if "series" in payload and "station" not in payload:  # a bundle station object passed directly
        station = {k: v for k, v in payload.items() if k != "series"}
    series = payload.get("series") or station.pop("series", None)
    if "historical" in payload and payload.get("historical") is not None:
        season = aeros.SEASON_ALIASES.get(payload.get("season", "D-J-F"))
        if season is None:
            raise aeros.AerosInputError(f"Unknown season '{payload.get('season')}'.")
        hist = payload["historical"]
        years = [int(h["year"]) for h in hist]
        return station, years, {season: [h.get("value") for h in hist]}
    if series is not None:
        years = list(series.get("years") or [])
        seasons = {k: series[k] for k in series if k != "years"}
        return station, years, seasons
    years = payload.get("years")
    seasons = payload.get("seasons")
    if seasons is None:
        seasons = {k: payload[k] for k in ("D-J-F", "J-J-A", "DJF", "JJA") if k in payload}
    if years is None:
        raise aeros.AerosInputError("Payload needs 'years' and 'seasons' (or 'series', or 'historical').")
    return station, list(years), dict(seasons or {})


def seed_label(station: Dict[str, Any], options: Dict[str, Any]) -> str:
    """City label fed to stable_int_seed (the notebook used the uploaded CSV file name)."""
    for key in ("seed_label",):
        if options.get(key):
            return str(options[key])
    for key in ("id", "name", "display_name"):
        if station.get(key):
            return str(station[key])
    return "station"


AEROS_MODES = {
    "notebook": 200,  # notebook fast_mode=True (the recorded run) -> N_BOOT_FAST = 200
    "fast": 100,      # phones: fewer bootstrap paths, everything else identical
}


def aeros_options(payload: Dict[str, Any]) -> Dict[str, Any]:
    o = dict(payload.get("options") or {})
    # legacy golden-fixture keys
    if "bootstrapPaths" in payload and "n_bootstrap" not in o:
        o["n_bootstrap"] = payload["bootstrapPaths"]
    if "projectionEndYear" in payload and "end_year" not in o:
        o["end_year"] = payload["projectionEndYear"]
    if "seed" in payload and "seed" not in o:
        o["seed"] = payload["seed"]
    mode = str(o.get("mode", "notebook"))
    if mode not in AEROS_MODES:
        raise aeros.AerosInputError(f"Unknown mode '{mode}'; use one of {sorted(AEROS_MODES)}.")
    n_boot = int(o.get("n_bootstrap") or AEROS_MODES[mode])
    if n_boot < 10 or n_boot > 20000:
        raise aeros.AerosInputError("n_bootstrap must be between 10 and 20000.")
    end_year = int(o.get("end_year", 2100))
    tey = o.get("train_end_year")
    return {
        "mode": mode,
        "n_bootstrap": n_boot,
        "seed": int(o.get("seed", 42)),
        "end_year": end_year,
        "train_end_year": int(tey) if tey is not None else None,
        "impute_missing_years": bool(o.get("impute_missing_years", True)),
        "unit_mode": str(o.get("unit_mode", "celsius")),
        "rolling_cv": bool(o.get("rolling_cv", True)),
        "include_rolling_cv_rows": bool(o.get("include_rolling_cv_rows", False)),
        "sample_paths": int(o.get("sample_paths", 0)),
        "seed_label": o.get("seed_label"),
    }


def format_aeros_result(raw: Dict[str, Any], station: Dict[str, Any], opts: Dict[str, Any],
                        label: str) -> Dict[str, Any]:
    hemi, inferred = station_hemisphere(station)
    seasons_out = {}
    for season, r in raw["seasons"].items():
        hy, hv, hi = r["historical_years"], r["historical_values"], r["historical_imputed"]
        fy = r["future_years"]
        rolling = dict(r["rolling_cv"])
        if not opts["include_rolling_cv_rows"]:
            rolling.pop("rows", None)
        s = {
            "season": season,
            "local_label": local_season_label(season, hemi),
            "historical": [{"year": int(y), "value": float(v), "imputed": bool(m)} for y, v, m in zip(hy, hv, hi)],
            "trend": {
                "type": "quadratic least-squares fit to the (imputed) historical series",
                "coefficients_high_to_low": r["trend_coefficients"],
                "fitted": [{"year": int(y), "value": float(v)} for y, v in zip(hy, r["trend_fitted"])],
            },
            "projection": [{"year": int(y), "mean": float(m), "lower": float(lo), "upper": float(up)}
                           for y, m, lo, up in zip(fy, r["mean"], r["lower"], r["upper"])],
            "interval": "2.5th–97.5th percentile of bootstrap paths (95%)",
            "summary_end": {"year": int(fy[-1]), "mean": float(r["mean"][-1]),
                            "lower": float(r["lower"][-1]), "upper": float(r["upper"][-1]),
                            "mc_standard_error_of_mean": float(r["mc_se_mean"][-1])},
            "slopes": r["slopes"],
            "ensemble": r["ensemble"],
            "residual_model": r["residual_model"],
            "rolling_cv": rolling,
            "n_bootstrap": r["n_bootstrap"],
            "data_quality": raw["quality"].get(season),
        }
        if "sample_paths" in r:
            s["sample_paths"] = r["sample_paths"]
        seasons_out[season] = s
    return {
        "station": {"id": station.get("id"), "name": station.get("display_name") or station.get("name"),
                    "lat": station.get("lat"), "lon": station.get("lon"), "country": station.get("country"),
                    "hemisphere": hemi, "hemisphere_inferred_from_latitude": inferred},
        "seed_label": label,
        "hist_start_year": raw["hist_start_year"],
        "hist_end_year": raw["hist_end_year"],
        "end_year": raw["config"]["FUT_END"],
        "seasons": seasons_out,
        "skipped_seasons": sorted(set(raw["quality"]) - set(raw["seasons"])),
        "data_quality": raw["quality"],
        "disclaimer": DISCLAIMER,
    }
