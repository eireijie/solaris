"""Nexus 1.0: hindcast leakage, metric definitions, trend statistics, station-set tests, bias view."""
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from scipy import stats

MODELS = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
if str(MODELS) not in sys.path:
    sys.path.insert(0, str(MODELS))

from solaris_models import nexus  # noqa: E402
from solaris_models.api import run_aeros, run_nexus  # noqa: E402


@pytest.fixture(scope="module")
def dc():
    ref = json.loads((FIXTURES / "notebook_ref_dc_bundle.json").read_text(encoding="utf-8"))
    return {"station": {"id": "USW00013743", "name": "Washington Reagan", "lat": 38.85},
            "years": ref["input"]["years"], "seasons": ref["input"]["seasons"]}


@pytest.fixture(scope="module")
def dc_nexus(dc):
    return run_nexus(dict(dc, options={"mode": "fast"}))


def test_contract_and_json(dc_nexus):
    r = dc_nexus
    assert r["ok"], r.get("error")
    for key in ("model", "version", "inputs", "warnings", "provenance", "runtime_ms"):
        assert key in r
    assert r["model"] == "nexus" and r["version"] == "1.0"
    json.dumps(r, allow_nan=False)
    assert set(r["hindcast"]["seasons"]) == {"D-J-F", "J-J-A"}


def test_hindcast_metric_definitions(dc_nexus):
    for season, h in dc_nexus["hindcast"]["seasons"].items():
        rows = h["per_year"]
        pred = np.array([p["predicted"] for p in rows])
        obs = np.array([p["observed"] for p in rows])
        e = pred - obs
        assert h["test_years"][0] == 2001
        assert abs(h["mean_bias"] - e.mean()) < 1e-12          # sign: predicted − observed
        assert abs(h["mae"] - np.abs(e).mean()) < 1e-12
        assert abs(h["rmse"] - np.sqrt((e ** 2).mean())) < 1e-12
        lo = np.array([p["lower"] for p in rows]); hi = np.array([p["upper"] for p in rows])
        assert abs(h["interval_coverage_95"] - np.mean((obs >= lo) & (obs <= hi))) < 1e-12
        for name, b in h["baselines"].items():
            assert abs(b["aeros_skill_score_vs_this"] - (1 - h["rmse"] ** 2 / b["rmse"] ** 2)) < 1e-12
        assert 0 <= h["direction_accuracy"] <= 1


def test_hindcast_has_no_leakage(dc):
    """Changing every value after the cutoff must leave the hindcast forecast identical."""
    a = nexus.hindcast_audit("USW00013743", dc["years"], dc["seasons"], cutoff=2000, n_bootstrap=50)
    tampered = {k: [(v + 30.0 if (v is not None and y > 2000) else v) for y, v in zip(dc["years"], vals)]
                for k, vals in dc["seasons"].items()}
    b = nexus.hindcast_audit("USW00013743", dc["years"], tampered, cutoff=2000, n_bootstrap=50)
    for season in a["seasons"]:
        pa = [(p["year"], p["predicted"], p["lower"], p["upper"]) for p in a["seasons"][season]["per_year"]]
        pb = [(p["year"], p["predicted"], p["lower"], p["upper"]) for p in b["seasons"][season]["per_year"]]
        assert pa == pb
        assert a["seasons"][season]["ensemble_weights"] == b["seasons"][season]["ensemble_weights"]
        # ...while the scores do change, because the observations changed
        assert b["seasons"][season]["mean_bias"] < a["seasons"][season]["mean_bias"] - 20


def test_hindcast_baseline_uses_training_only(dc):
    a = nexus.hindcast_audit("x", dc["years"], dc["seasons"], cutoff=2000, n_bootstrap=20)
    h = a["seasons"]["J-J-A"]
    yrs = np.array(dc["years"]); v = np.array([np.nan if x is None else x for x in dc["seasons"]["J-J-A"]])
    m = (yrs > 1970) & (yrs <= 2000) & np.isfinite(v)
    clim = v[m].mean()
    obs = np.array([p["observed"] for p in h["per_year"]])
    assert abs(h["baselines"]["climatology_last30"]["mean_bias"] - (clim - obs).mean()) < 1e-10


def test_trend_statistics_match_scipy():
    rng = np.random.default_rng(3)
    years = np.arange(1940, 2026)
    temps = 12 + 0.015 * (years - 1940) + rng.normal(0, 0.5, len(years))
    ts = nexus.trend_statistics(years, temps)
    for key, (a, b) in {"early": (1940, 1979), "modern": (1980, 2025)}.items():
        m = (years >= a) & (years <= b)
        lr = stats.linregress(years[m], temps[m])
        assert abs(ts[key]["slope"] - lr.slope * 10) < 1e-10
        assert abs(ts[key]["se"] - lr.stderr * 10) < 1e-10
        assert abs(ts[key]["p_value"] - lr.pvalue) < 1e-10
        assert ts[key]["ci_low"] < ts[key]["slope"] < ts[key]["ci_high"]
    assert abs(ts["change"]["change"] - (ts["modern"]["slope"] - ts["early"]["slope"])) < 1e-12
    short = nexus.trend_statistics(np.arange(1970, 1990), np.ones(20), min_years=20)
    assert short["early"]["slope"] is None and short["change"]["change"] is None


def _synthetic_station(i, country, ur, lat, rng, accel):
    years = list(range(1940, 2026))
    t = np.array(years, float)
    base = 10 + 0.001 * (t - 1940) + accel * np.clip(t - 1980, 0, None) / 10
    return {"id": f"S{i}", "name": f"S{i}", "country": country, "urban_rural": ur, "lat": lat,
            "series": {"years": years, "D-J-F": list(base + rng.normal(0, 0.3, len(t))),
                       "J-J-A": list(base + 10 + rng.normal(0, 0.3, len(t)))}}


def test_station_set_paired_test_and_groups():
    rng = np.random.default_rng(4)
    sts = [_synthetic_station(i, "A" if i < 6 else "B", "urban" if i % 2 else "rural",
                              40.0 if i < 6 else -30.0, rng, 0.2) for i in range(10)]
    r = run_nexus({"stations": sts})
    assert r["ok"], r.get("error")
    json.dumps(r, allow_nan=False)
    g = r["station_set"]["groups"]["all"]["calendar"]["D-J-F"]
    early = np.array([s["seasons"]["D-J-F"]["early"]["slope"] for s in r["station_set"]["stations"]])
    modern = np.array([s["seasons"]["D-J-F"]["modern"]["slope"] for s in r["station_set"]["stations"]])
    t, p = stats.ttest_rel(modern, early)
    assert g["n"] == 10 and abs(g["t_statistic"] - t) < 1e-10 and abs(g["p_value"] - p) < 1e-12
    assert g["n_increased"] == int(np.sum(modern > early))
    assert g["ci_low"] < g["mean_change"] < g["ci_high"]
    # hemisphere-adjusted: southern D-J-F counts as summer
    hw = r["station_set"]["groups"]["all"]["hemisphere_adjusted"]
    assert hw["winter"]["n"] == 10 and hw["summer"]["n"] == 10
    assert set(hw["winter"]["station_ids"]) == {f"S{i}" for i in range(10)}
    assert set(r["station_set"]["groups"]["by"]["country"]) == {"A", "B"}
    assert r["station_set"]["groups"]["by"]["urban_rural"]["rural"]["calendar"]["D-J-F"]["n"] == 5


def test_bias_view_is_separate_and_baseline_untouched(dc):
    base = run_aeros(dict(dc, options={"mode": "fast"}))
    r = run_nexus(dict(dc, aeros_result=base, options={"mode": "fast", "shrinkage": 0.5}))
    bc = r["bias_correction"]
    for season, adj in bc["adjusted"].items():
        assert bc["aeros_baseline"][season]["projection"] == base["seasons"][season]["projection"]
        corr = 0.5 * -r["hindcast"]["seasons"][season]["mean_bias"]
        assert abs(adj["correction_c"] - corr) < 1e-12
        for a, b0 in zip(adj["projection"], base["seasons"][season]["projection"]):
            assert abs(a["mean"] - (b0["mean"] + corr)) < 1e-9
        assert "NOT the Aeros forecast" in adj["label"]
    # computing the baseline inside Nexus gives the same numbers as run_aeros
    r2 = run_nexus(dict(dc, options={"mode": "fast"}))
    for season in base["seasons"]:
        assert r2["bias_correction"]["aeros_baseline"][season]["projection"] == base["seasons"][season]["projection"]


def test_data_quality_report():
    years = list(range(1950, 1990))
    vals = [10.0 + 0.1 * (i % 5) for i in range(40)]
    vals[5] = None
    vals[6] = -9999
    vals[20] = 45.0  # outlier
    r = run_nexus({"years": years, "seasons": {"DJF": vals}, "options": {"analyses": ["data_quality"]}})
    q = r["data_quality"]["seasons"]["D-J-F"]
    assert q["missing_years_in_span"] == [1955, 1956]
    assert q["imputed_years"] == [1955, 1956]
    assert q["sentinel_values_removed"] == 1
    assert 1970 in q["outlier_years"]


def test_rolling_origin_and_short_series():
    rng = np.random.default_rng(5)
    years = list(range(1950, 2026))
    vals = list(14 + 0.02 * (np.array(years) - 1950) + rng.normal(0, 0.5, len(years)))
    r = run_nexus({"years": years, "seasons": {"J-J-A": vals},
                   "options": {"analyses": ["rolling_origin"], "rolling_cutoffs": [1955, 1990, 2005],
                               "rolling_n_bootstrap": 20}})
    assert r["ok"]
    ro = r["rolling_origin"]
    assert {row["cutoff"] for row in ro["rows"]} == {1990, 2005}  # 1955: only 6 training years
    assert any("1955" in w for w in r["warnings"])
    assert ro["summary"]["J-J-A"]["n_cutoffs"] == 2
    json.dumps(r, allow_nan=False)
    # too short for a hindcast -> graceful warning, not a crash
    r = run_nexus({"years": list(range(1995, 2010)), "seasons": {"D-J-F": [1.0 + 0.1 * i for i in range(15)]}})
    assert r["ok"] and any("hindcast not run" in w for w in r["warnings"])
    r = run_nexus({"years": [2000], "seasons": {}})
    assert r["ok"] is False
