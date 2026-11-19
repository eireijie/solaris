"""CORe 4.0 port: parity with the original notebook cell08, physics spot checks, API contract."""
import csv
import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

MODELS = Path(__file__).resolve().parents[1]
ROOT = MODELS.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
if str(MODELS) not in sys.path:
    sys.path.insert(0, str(MODELS))

from solaris_models import core  # noqa: E402
from solaris_models.api import dispatch, run_core  # noqa: E402


@pytest.fixture(scope="module")
def hist():
    rows = list(csv.DictReader(open(ROOT / "data" / "co2" / "historical_co2_1940_2025.csv")))
    return [int(r["year"]) for r in rows], [float(r["co2_ppm"]) for r in rows]


@pytest.fixture(scope="module")
def bundle():
    return json.loads((ROOT / "data" / "co2" / "co2_bundle.json").read_text())


@pytest.fixture(scope="module")
def ref():
    return json.loads((FIXTURES / "core4_notebook_reference.json").read_text())


@pytest.fixture(scope="module")
def run(hist):
    return core.run(*hist)


# --- parity with the notebook -------------------------------------------------------------

def test_input_series_matches_cell07_output(hist):
    years, ppm = hist
    assert years == list(range(1940, 2026))
    # values printed in cell07.out.txt
    assert ppm[0] == pytest.approx(311.356977, abs=1e-6)
    assert ppm[4] == pytest.approx(312.412971, abs=1e-6)
    assert ppm[-5:] == [414.70, 417.08, 419.35, 422.79, 425.62]


def test_poster_numbers(run):
    """Poster: 620.86 ppm by 2100, bounds 560.53-681.18 ppm (cell08.out.txt: 620.855023 / 560.533981 / 681.176065)."""
    assert run["future_years"][-1] == 2100
    assert run["ppm_mean"][-1] == pytest.approx(620.855023, abs=1e-6)
    assert run["ppm_lower"][-1] == pytest.approx(560.533981, abs=1e-6)
    assert run["ppm_upper"][-1] == pytest.approx(681.176065, abs=1e-6)
    assert round(run["ppm_mean"][-1], 2) == 620.86
    assert round(run["ppm_lower"][-1], 2) == 560.53
    assert round(run["ppm_upper"][-1], 2) == 681.18
    assert run["forcing_wm2"][-1] == pytest.approx(4.292829, abs=1e-6)
    assert run["forcing_lower_wm2"][-1] == pytest.approx(3.746018, abs=1e-6)
    assert run["forcing_upper_wm2"][-1] == pytest.approx(4.788898, abs=1e-6)
    assert run["temperature_response_c"][-1] == pytest.approx(3.368844, abs=1e-6)
    assert run["conformal_base_error_ppm"] == pytest.approx(4.590216, abs=1e-6)


def test_ensemble_weights_match_notebook(run):
    w = dict(run["ensemble"])
    assert list(w) == ["growth_linear_ridge", "recent_growth_median", "recent_growth_ewma"]
    assert w["growth_linear_ridge"] == pytest.approx(0.421413, abs=1e-6)
    assert w["recent_growth_median"] == pytest.approx(0.428672, abs=1e-6)
    assert w["recent_growth_ewma"] == pytest.approx(0.149915, abs=1e-6)


def test_validation_table_matches_notebook_output(run):
    # cell08.out.txt validation summary (6 d.p.)
    expected = [
        ("growth_linear_ridge", 2.004343, 2.456559, -1.956916, True),
        ("recent_growth_median", 1.977347, 2.484813, -1.743720, True),
        ("recent_growth_soft_accel", 3.295273, 3.993968, -3.272950, False),
        ("recent_growth_ewma", 3.375987, 4.100125, -3.355247, True),
        ("recent_growth_soft_slowdown", 3.474638, 4.230238, -3.455832, False),
        ("quadratic_ridge_level", 9.527343, 10.965181, -9.527343, False),
        ("log_linear_level", 9.716537, 11.266908, -9.716537, False),
        ("huber_linear_level", 9.725668, 11.282441, -9.725668, False),
        ("linear_level", 9.727264, 11.285483, -9.727264, False),
        ("cubic_ridge_level", 9.734798, 11.297019, -9.734798, False),
    ]
    rows = run["validation_summary"]
    assert [r["model"] for r in rows] == [e[0] for e in expected]
    for r, (m, mae, rmse, bias, sel) in zip(rows, expected):
        assert r["mae_ppm"] == pytest.approx(mae, abs=1e-6), m
        assert r["rmse_ppm"] == pytest.approx(rmse, abs=1e-6), m
        assert r["bias_ppm"] == pytest.approx(bias, abs=1e-6), m
        assert r["selected_for_ensemble"] is sel
        assert r["n_validation_points"] == 138


def test_growth_constraints_match_notebook(run):
    g = run["growth_constraints"]
    assert g["min_growth"] == pytest.approx(0.07600148518877177, abs=1e-12)
    assert g["max_growth"] == pytest.approx(3.7880999999999854, abs=1e-12)
    assert g["max_accel"] == pytest.approx(0.06, abs=1e-12)
    assert g["recent_growth_median"] == pytest.approx(2.25, abs=1e-12)


def test_full_series_parity_with_original_cell(run, ref):
    """Fixture = original cell08 code executed on the same CSV (models/tools/core_notebook_reference.py)."""
    assert list(run["future_years"]) == ref["years"]
    for k in ("ppm_mean", "ppm_lower", "ppm_upper", "forcing_wm2", "temperature_response_c", "model_spread_ppm"):
        np.testing.assert_allclose(run[k], ref[k], rtol=0, atol=1e-9, err_msg=k)
    for a, b in zip(run["validation_summary"], ref["validation_summary"]):
        assert a["model"] == b["model"]
        assert a["rmse_ppm"] == pytest.approx(b["rmse_ppm"], abs=1e-9)
        assert a["weight"] == pytest.approx(b["weight"], abs=1e-12)


# --- numerical building blocks vs scikit-learn (only if sklearn happens to be installed) ---

def test_regressions_match_sklearn(hist):
    sk = pytest.importorskip("sklearn.linear_model")
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import PolynomialFeatures

    years, ppm = np.array(hist[0]), np.array(hist[1])
    for cut in (1980, 1995, 2010, 2025):
        m = years <= cut
        x, _ = core._x_scaled(years[m])
        y = ppm[m]
        c, b = core._huber_fit(x, y)
        h = sk.HuberRegressor(epsilon=1.35, alpha=0.001, max_iter=500).fit(x, y)
        assert c[0] == pytest.approx(h.coef_[0], abs=1e-6)
        assert b == pytest.approx(h.intercept_, abs=1e-6)
        for deg, alpha in ((2, 0.2), (3, 2.0)):
            c, b = core._ridge_fit(core._poly(x, deg), y, alpha)
            p = make_pipeline(PolynomialFeatures(deg, include_bias=False), sk.Ridge(alpha=alpha)).fit(x, y)
            np.testing.assert_allclose(c, p[-1].coef_, atol=1e-8)
            assert b == pytest.approx(p[-1].intercept_, abs=1e-8)
        c, b = core._ols_fit(x, y)
        lr = sk.LinearRegression().fit(x, y)
        assert c[0] == pytest.approx(lr.coef_[0], abs=1e-8)


# --- physics spot checks --------------------------------------------------------------------

def test_forcing_formula():
    assert core.co2_forcing(278.3) == pytest.approx(0.0)
    # doubling: 5.35 ln 2 = 3.708 W/m2 (CORe uses 5.35 ln(C/278.3); its response uses lambda = 3.7/ECS)
    assert core.co2_forcing(2 * 278.3) == pytest.approx(5.35 * math.log(2), abs=1e-12)
    assert core.co2_forcing(2 * 278.3) == pytest.approx(3.708, abs=1e-3)
    assert core.co2_forcing(4 * 278.3) == pytest.approx(2 * 3.7083, abs=1e-3)


def test_temperature_response_equilibrium_and_start():
    yrs = np.arange(2026, 2526)
    f = np.full(yrs.size, core.co2_forcing(2 * 278.3))
    t = core.temperature_response(yrs, f, ecs=3.0, heat_capacity=8.0, initial_temp=1.2)
    # equilibrium = F2x / (3.7/ECS) = 3.0068 C (slightly above ECS because 5.35 ln2 = 3.708 != 3.7)
    assert t[-1] == pytest.approx(5.35 * math.log(2) / (3.7 / 3.0), abs=1e-9)
    # first step from the initial anomaly
    assert t[0] == pytest.approx(1.2 + (f[0] - (3.7 / 3.0) * 1.2) / 8.0)
    # e-folding time C/lambda = 6.5 yr
    t0 = core.temperature_response(yrs, f, initial_temp=0.0)
    teq = t0[-1]
    k = int(np.argmax(t0 >= teq * (1 - math.exp(-1))))
    assert 5 <= k <= 7


# --- behaviour --------------------------------------------------------------------------------

def test_settings_override_and_unknown(hist):
    r = core.run(*hist, settings={"ecs_c": 4.0})
    base = core.run(*hist)
    np.testing.assert_allclose(r["ppm_mean"], base["ppm_mean"])
    assert r["temperature_response_c"][-1] > base["temperature_response_c"][-1]
    with pytest.raises(ValueError):
        core.run(*hist, settings={"nope": 1})


def test_gap_filling_and_cleaning():
    y, p = core.clean_historical([2000, 2002, 2001.6, 1900, 2003], [370, 374, 372, 100, None])
    assert list(y) == [2000, 2001, 2002]
    # 2001.6 rounds to 2002 and is averaged with 374; 2001 is interpolated; 1900/100 ppm and None dropped
    assert list(p) == [370.0, 371.5, 373.0]


def test_api_contract_and_json(bundle):
    r = run_core({"historical_co2": bundle["historical_co2"]})
    assert r["ok"] is True and r["model"] == "core" and r["version"] == "4.0"
    for k in ("inputs", "warnings", "provenance", "runtime_ms"):
        assert k in r
    s = json.dumps(r, allow_nan=False)
    assert "NaN" not in s
    assert r["summary_end"]["ppm_mean"] == pytest.approx(620.855023, abs=1e-6)
    assert len(r["historical"]["years"]) == 86 and len(r["projection"]["years"]) == 75
    assert r["warnings"] == []
    # dispatch path + determinism
    r2 = dispatch("core", {"data": bundle})
    assert r2["projection"] == r["projection"]


def test_api_error_is_reported():
    r = run_core({})
    assert r["ok"] is False and r["error"]["type"] == "ValueError"
    json.dumps(r, allow_nan=False)


def test_validation_points_optional(bundle):
    r = run_core({"historical_co2": bundle["historical_co2"], "include_validation_points": True})
    pts = r["validation"]["points"]
    assert sum(len(v["year"]) for v in pts.values()) == 1380
    assert len(r["validation"]["ensemble_points"]) == 138
