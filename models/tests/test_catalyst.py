"""Catalyst 1.0: carbon-cycle validation, consistency with CORe, interventions, sanity, API contract."""
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import pytest

MODELS = Path(__file__).resolve().parents[1]
ROOT = MODELS.parent
if str(MODELS) not in sys.path:
    sys.path.insert(0, str(MODELS))

from solaris_models import catalyst  # noqa: E402
from solaris_models.api import dispatch, run_catalyst, run_core  # noqa: E402


@pytest.fixture(scope="module")
def bundle():
    return json.loads((ROOT / "data" / "co2" / "co2_bundle.json").read_text())


@pytest.fixture(scope="module")
def core_result(bundle):
    return run_core({"historical_co2": bundle["historical_co2"]})


@pytest.fixture(scope="module")
def core_pathway(core_result):
    return {"years": core_result["projection"]["years"], "ppm": core_result["projection"]["ppm_mean"]}


def cat(bundle, **kw):
    r = run_catalyst(dict(kw, data=bundle))
    assert r["ok"], r.get("error")
    return r


def at(r, side, key, year):
    return r[side][key][r["years"].index(year)]


# --- data bundle --------------------------------------------------------------------------------

def test_bundle_shape(bundle):
    rc = bundle["rcmip"]
    assert rc["years"][0] == 1750 and rc["years"][-1] == 2100
    for sc in ("ssp119", "ssp126", "ssp245", "ssp370", "ssp585"):
        assert len(rc["concentrations_ppm"][sc]) == 351
        e = rc["emissions_gtco2"][sc]["total"]
        assert None not in e
    assert rc["concentrations_ppm"]["ssp585"][-1] == pytest.approx(1135.2, abs=0.1)
    assert rc["emissions_gtco2"]["historical"]["total"][264] == pytest.approx(39.63, abs=0.01)  # 2014


# --- carbon-cycle validation (numbers quoted in models/NOTES.md) --------------------------------

@pytest.fixture(scope="module")
def validation(bundle):
    return cat(bundle, mode="validation")["validation"]


def test_validation_historical(validation):
    h = validation["fair_v1"]["historical"]
    assert h["vs_noaa_global"]["rmse_ppm"] < 4.0
    assert abs(h["vs_noaa_global"]["last_year_error_ppm"]) < 8.0
    assert h["vs_rcmip_historical"]["rmse_ppm"] < 6.0
    # the fixed-IRF option is documented as much worse over the historical period
    assert validation["joos2013"]["historical"]["vs_noaa_global"]["rmse_ppm"] > 20


def test_validation_ssp_2100(validation):
    rows = {r["scenario"]: r for r in validation["fair_v1"]["ssp"]}
    assert set(rows) >= {"ssp119", "ssp126", "ssp245", "ssp370", "ssp585"}
    for sc, r in rows.items():
        assert abs(r["error_2050_pct"]) < 1.0, sc
        assert abs(r["error_2100_pct"]) < 4.0, sc
    # ordering of the SSPs is preserved
    order = ["ssp119", "ssp126", "ssp245", "ssp460", "ssp370", "ssp585"]
    vals = [rows[s]["model_2100_ppm"] for s in order]
    assert vals == sorted(vals)


# --- consistency with CORe ------------------------------------------------------------------------

def test_concentration_mode_reproduces_core(bundle, core_result, core_pathway):
    r = cat(bundle, mode="concentration", baseline={"type": "core"}, core_pathway=core_pathway,
            scenario={"type": "ssp", "scenario": "ssp245"})
    np.testing.assert_allclose(r["baseline"]["ppm"], core_result["projection"]["ppm_mean"], atol=1e-12)
    np.testing.assert_allclose(r["baseline"]["forcing_wm2"], core_result["projection"]["forcing_wm2"], atol=1e-12)
    np.testing.assert_allclose(r["baseline"]["temperature_c"], core_result["projection"]["temperature_response_c"], atol=1e-12)
    assert r["years"][0] == 2026 and r["years"][-1] == 2100


def test_emissions_mode_core_baseline_reproduces_core_ppm(bundle, core_result, core_pathway):
    r = cat(bundle, mode="emissions", baseline={"type": "core"}, core_pathway=core_pathway)
    # Inversion targets end-of-year values built from CORe's annual means: first year within 0.2 ppm
    # (model's own end-2025 state), afterwards within ~0.003 ppm (curvature of the CORe path).
    d = np.abs(np.array(r["baseline"]["ppm"]) - np.array(core_result["projection"]["ppm_mean"]))
    assert d[0] < 0.2 and d[1:].max() < 0.01
    np.testing.assert_allclose(r["baseline"]["temperature_c"], core_result["projection"]["temperature_response_c"], atol=5e-3)
    # no interventions -> scenario == baseline
    np.testing.assert_allclose(r["scenario"]["ppm"], r["baseline"]["ppm"])
    assert r["delta"]["2100"]["temperature_c"] == pytest.approx(0.0, abs=1e-12)


def test_forcing_doubling_in_catalyst(bundle):
    r = cat(bundle, mode="concentration", baseline={"type": "custom", "years": [2100], "ppm": [425.62]},
            scenario={"type": "custom", "years": [2030, 2100], "ppm": [2 * 278.3, 2 * 278.3]}, uncertainty=False)
    assert at(r, "scenario", "forcing_wm2", 2100) == pytest.approx(5.35 * math.log(2), abs=1e-9)
    assert at(r, "scenario", "forcing_non_co2_wm2", 2100) == 0.0


# --- interventions and monotonic sanity -----------------------------------------------------------

def test_more_emissions_more_ppm_more_warming(bundle):
    yrs = [2026, 2100]
    outs = []
    for level in (20.0, 40.0, 60.0):
        r = cat(bundle, mode="emissions", baseline={"type": "custom", "years": yrs, "values": [level, level]},
                uncertainty=False)
        outs.append((at(r, "baseline", "ppm", 2100), at(r, "baseline", "temperature_c", 2100)))
    assert outs[0][0] < outs[1][0] < outs[2][0]
    assert outs[0][1] < outs[1][1] < outs[2][1]
    for tm in ("core4", "two_layer"):
        temps = [at(cat(bundle, mode="concentration", baseline={"type": "ssp", "scenario": "ssp245"},
                        scenario={"type": "ssp", "scenario": "ssp585"}, ecs=e, temperature_model=tm,
                        uncertainty=False), "scenario", "temperature_c", 2100) for e in (2.0, 3.0, 4.5)]
        assert temps == sorted(temps)


def test_net_zero_behaviour(bundle, core_pathway):
    r = cat(bundle, mode="emissions", baseline={"type": "ssp", "scenario": "ssp245"},
            interventions={"net_zero_year": 2050})
    e = np.array(r["scenario"]["emissions_gtco2"])
    y = np.array(r["years"])
    assert np.all(e[y >= 2050] <= 1e-9)
    assert np.all(np.diff(e[(y >= 2026) & (y <= 2050)]) <= 1e-9)  # linear ramp down
    ppm = np.array(r["scenario"]["ppm"])
    i50 = r["years"].index(2050)
    assert ppm[i50 + 10] < ppm[i50]  # CO2 falls after net zero (ocean/land uptake continues)
    assert np.all(np.array(r["scenario"]["temperature_c"]) <= np.array(r["baseline"]["temperature_c"]) + 1e-9)
    assert r["delta"]["2100"]["temperature_c"] < 0
    assert r["cumulative_emissions_gtco2"]["difference"] < 0
    assert any("Net-zero CO2 by 2050" in a for a in r["assumptions"])
    # two-layer: warming roughly stabilises after net zero (zero-emissions commitment ~ 0)
    r2 = cat(bundle, mode="emissions", baseline={"type": "ssp", "scenario": "ssp245"},
             interventions={"net_zero_year": 2050}, temperature_model="two_layer")
    t = np.array(r2["scenario"]["temperature_c"])
    assert abs(t[r2["years"].index(2100)] - t[r2["years"].index(2055)]) < 0.3


def test_peak_decline_and_removal(bundle, core_pathway):
    base_iv = {"peak_year": 2030, "decline_rate_pct": 3.0}
    r1 = cat(bundle, mode="emissions", core_pathway=core_pathway, interventions=base_iv)
    e = np.array(r1["scenario"]["emissions_gtco2"])
    i30 = r1["years"].index(2030)
    assert e[i30 + 1] == pytest.approx(e[i30] * 0.97, rel=1e-9)
    assert np.all(e <= np.array(r1["baseline"]["emissions_gtco2"]) + 1e-9)
    r2 = cat(bundle, mode="emissions", core_pathway=core_pathway,
             interventions=dict(base_iv, removal={"gtco2_per_yr": 5.0, "start_year": 2040, "ramp_years": 10}))
    assert at(r2, "scenario", "ppm", 2100) < at(r1, "scenario", "ppm", 2100)
    assert at(r2, "scenario", "emissions_gtco2", 2060) == pytest.approx(at(r1, "scenario", "emissions_gtco2", 2060) - 5.0)
    assert at(r2, "scenario", "emissions_gtco2", 2040) == pytest.approx(at(r1, "scenario", "emissions_gtco2", 2040) - 0.5)


def test_target_cut(bundle):
    r = cat(bundle, mode="emissions", baseline={"type": "ssp", "scenario": "ssp245"},
            interventions={"target_cut": {"pct": 43, "year": 2030, "reference_year": 2019}})
    ref2019 = bundle["rcmip"]["emissions_gtco2"]["ssp245"]["total"][2019 - 1750]
    assert at(r, "scenario", "emissions_gtco2", 2030) == pytest.approx(ref2019 * 0.57, rel=1e-3)
    assert at(r, "scenario", "emissions_gtco2", 2060) <= ref2019 * 0.57 + 1e-9


def test_concentration_edits(bundle):
    r = cat(bundle, mode="concentration", baseline={"type": "ssp", "scenario": "ssp245"},
            scenario={"type": "ssp", "scenario": "ssp245", "edits": {"years": [2060], "ppm": [480.0]}})
    assert at(r, "scenario", "ppm", 2060) == pytest.approx(480.0)
    off2060 = 480.0 - at(r, "baseline", "ppm", 2060)
    # offset tapers linearly from 0 in 2025 to the full edit in 2060
    assert at(r, "scenario", "ppm", 2026) - at(r, "baseline", "ppm", 2026) == pytest.approx(off2060 / 35, abs=1e-9)
    assert at(r, "scenario", "ppm", 2100) - at(r, "baseline", "ppm", 2100) == pytest.approx(off2060, abs=1e-9)
    assert r["baseline"]["ppm"][0] - bundle["historical_co2"]["ppm"][-1] < 4  # anchored, no jump


# --- options ---------------------------------------------------------------------------------------

def test_uncertainty_bands_bracket_central(bundle, core_pathway):
    r = cat(bundle, mode="emissions", core_pathway=core_pathway, interventions={"net_zero_year": 2070})
    for side in ("baseline", "scenario"):
        t = np.array(r[side]["temperature_c"])
        b = r[side]["temperature_band_c"]
        assert b["likely"]["ecs"] == [2.5, 4.0] and b["very_likely"]["ecs"] == [2.0, 5.0]
        assert np.all(np.array(b["very_likely"]["lower"]) <= np.array(b["likely"]["lower"]) + 1e-12)
        assert np.all(np.array(b["likely"]["lower"]) <= t + 1e-12)
        assert np.all(t <= np.array(b["likely"]["upper"]) + 1e-12)
        assert np.all(np.array(b["likely"]["upper"]) <= np.array(b["very_likely"]["upper"]) + 1e-12)


def test_non_co2_option(bundle):
    off = cat(bundle, mode="concentration", baseline={"type": "ssp", "scenario": "ssp245"},
              scenario={"type": "ssp", "scenario": "ssp370"}, uncertainty=False)
    on = cat(bundle, mode="concentration", baseline={"type": "ssp", "scenario": "ssp245"},
             scenario={"type": "ssp", "scenario": "ssp370"}, non_co2_forcing="scenario", uncertainty=False)
    assert all(v == 0 for v in off["scenario"]["forcing_non_co2_wm2"])
    assert at(on, "scenario", "forcing_non_co2_wm2", 2100) > 0.5
    assert any("CO2-only" in a for a in off["assumptions"])
    assert any("Non-CO2 forcing INCLUDED" in a for a in on["assumptions"])


def test_two_layer_equilibrium():
    f = np.full(5000, 5.35 * math.log(2))
    t = catalyst.two_layer_response(f, ecs=3.0)
    assert t[-1] == pytest.approx(3.0, abs=1e-3)


def test_two_layer_ssp245_in_assessed_range(bundle):
    r = cat(bundle, mode="concentration", baseline={"type": "ssp", "scenario": "ssp245"},
            scenario={"type": "ssp", "scenario": "ssp585"}, temperature_model="two_layer",
            non_co2_forcing="scenario", uncertainty=False)
    # AR6 SSP2-4.5 2081-2100 very likely 2.1-3.5 C vs 1850-1900; this model is relative to 1750
    assert 2.1 < at(r, "baseline", "temperature_c", 2100) < 3.5
    assert 1.0 < r["reference_state"]["temperature_c"] < 1.6


def test_local_scaling_off_by_default_and_labelled(bundle, core_pathway):
    r = cat(bundle, mode="emissions", core_pathway=core_pathway, interventions={"net_zero_year": 2060})
    assert "local_scaling" not in r
    yrs = list(range(2026, 2101))
    st = {"label": "demo", "years": yrs, "values": [20 + 0.03 * (y - 2025) for y in yrs]}
    r = cat(bundle, mode="emissions", core_pathway=core_pathway, interventions={"net_zero_year": 2060},
            local_scaling={"enabled": True, "station": st})
    ls = r["local_scaling"]
    assert ls["illustrative"] is True
    assert ls["values"][-1] < st["values"][-1]  # less global warming -> less local change
    assert any(a.startswith("ILLUSTRATIVE ONLY") for a in r["assumptions"])


# --- contract, determinism, speed ------------------------------------------------------------------

def test_contract_json_determinism(bundle, core_pathway):
    p = dict(mode="emissions", core_pathway=core_pathway, data=bundle,
             interventions={"peak_year": 2030, "decline_rate_pct": 4, "net_zero_year": 2065,
                            "removal": {"gtco2_per_yr": 3, "start_year": 2040}},
             temperature_model="two_layer", non_co2_forcing="scenario")
    a, b = run_catalyst(p), dispatch("catalyst", p)
    for k in ("model", "version", "inputs", "warnings", "provenance", "runtime_ms", "assumptions"):
        assert k in a
    assert a["model"] == "catalyst" and a["version"] == "1.0"
    json.dumps(a, allow_nan=False)
    a.pop("runtime_ms"), b.pop("runtime_ms")
    assert a == b
    assert set(a["delta"]) == {"2050", "2100"}
    assert a["scenario"]["peak_warming"]["year"] in a["years"]


def test_runtime_under_one_second(bundle, core_pathway):
    p = dict(mode="emissions", core_pathway=core_pathway, data=bundle, interventions={"net_zero_year": 2060},
             temperature_model="two_layer", non_co2_forcing="scenario")
    run_catalyst(p)
    t = time.perf_counter()
    for _ in range(5):
        run_catalyst(p)
    assert (time.perf_counter() - t) / 5 < 1.0


def test_errors_are_reported(bundle):
    r = run_catalyst({"data": bundle, "mode": "nope"})
    assert r["ok"] is False
    r = run_catalyst({"data": bundle, "mode": "emissions", "baseline": {"type": "ssp", "scenario": "ssp999"}})
    assert r["ok"] is False and "ssp999" in r["error"]["message"]
    r = run_catalyst({"mode": "emissions"})
    assert r["ok"] is False
    json.dumps(r, allow_nan=False)
