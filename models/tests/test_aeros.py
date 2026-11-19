"""Aeros 4.0 port: parity with the original notebook code, golden fixture, determinism, robustness."""
import json
import subprocess
import sys

import numpy as np
import pytest

from pathlib import Path

MODELS = Path(__file__).resolve().parents[1]
ROOT = MODELS.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
if str(MODELS) not in sys.path:
    sys.path.insert(0, str(MODELS))

from solaris_models import aeros  # noqa: E402
from solaris_models.api import dispatch, run_aeros  # noqa: E402


def _load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def golden_payload():
    return _load(ROOT / "reference" / "golden" / "rajkot-djf.json")


@pytest.fixture(scope="module")
def nb_rajkot():
    return _load(FIXTURES / "notebook_ref_rajkot_djf.json")


@pytest.fixture(scope="module")
def nb_dc():
    return _load(FIXTURES / "notebook_ref_dc_bundle.json")

# Port vs notebook: the only numerical difference is statsmodels' AR(1) MLE optimiser tolerance
# (|Δφ| ~ 1e-5), which moves projections by < 5e-5 °C. Allow 2e-4 °C.
TOL_C = 2e-4


def _compare_to_notebook(ref, label):
    inp = ref["input"]
    out = aeros.run_station(label, inp["years"], inp["seasons"], n_bootstrap=ref["n_boot"])
    assert set(out["seasons"]) == set(ref["seasons"])
    for season, r in ref["seasons"].items():
        p = out["seasons"][season]
        np.testing.assert_array_equal(p["historical_years"], r["years"])
        np.testing.assert_allclose(p["historical_values"], r["temps"], atol=1e-9)
        np.testing.assert_array_equal(p["future_years"], r["future_years"])
        for key in ("mean", "lower", "upper"):
            np.testing.assert_allclose(p[key], r[key], atol=TOL_C, rtol=0)
        s, rs = p["slopes"], r["summary"]
        pairs = [("modern", "MODERN_SLOPE_C_per_dec"), ("future_mean", "FUTURE_SLOPE_C_per_dec"),
                 ("future_ci_low", "FUTURE_SLOPE_CI_LO"), ("future_ci_high", "FUTURE_SLOPE_CI_HI"),
                 ("instantaneous_end", "INST_SLOPE_2100_C_per_dec"), ("acceleration", "ACCELERATION_RATE_C_per_dec"),
                 ("historical_1940_1979", "HIST_1940_1979_SLOPE_C_per_dec")]
        for mine, theirs in pairs:
            if rs[theirs] is None or (isinstance(rs[theirs], float) and np.isnan(rs[theirs])):
                assert np.isnan(s[mine])
            else:
                assert abs(s[mine] - rs[theirs]) < 1e-4, (season, mine, s[mine], rs[theirs])
        assert p["residual_model"]["label"] == rs["RESIDUAL_SIMULATOR"]


def test_parity_with_notebook_rajkot(nb_rajkot):
    _compare_to_notebook(nb_rajkot, nb_rajkot["city"])


def test_parity_with_notebook_washington_bundle(nb_dc):
    _compare_to_notebook(nb_dc, nb_dc["city"])


def test_golden_fixture_shape_and_imputation(golden_payload):
    r = run_aeros(golden_payload)
    assert r["ok"], r.get("error")
    s = r["seasons"]["D-J-F"]
    assert len(s["historical"]) == 47 and len(s["projection"]) == 75
    assert s["projection"][0]["year"] == 2026 and s["projection"][-1]["year"] == 2100
    assert s["residual_model"]["label"] == "AR1"
    # The golden series carries an already-imputed 1985; blanking it must reproduce that value.
    hist = [dict(h) for h in golden_payload["historical"]]
    for h in hist:
        if h["year"] == 1985:
            h["value"] = None
    r2 = run_aeros(dict(golden_payload, historical=hist))
    v1985 = [h for h in r2["seasons"]["D-J-F"]["historical"] if h["year"] == 1985][0]
    assert v1985["imputed"] is True
    assert abs(v1985["value"] - 21.022618) < 5e-7


def test_golden_fixture_statistical_parity(golden_payload):
    """The previous service's exact seed label is unknown (its code is not in reference/), so bit-for-bit
    reproduction of 24.398529 [22.603167, 26.239206] is not possible. Over 200 seed labels the
    notebook method gives 2100 mean 24.381 ± 0.070, lower 22.483 ± 0.191, upper 26.274 ± 0.170
    (see NOTES.md); the golden values lie within 1 SD. Check our default run is within 4 SD of them."""
    r = run_aeros(golden_payload)
    end = r["seasons"]["D-J-F"]["summary_end"]
    assert abs(end["mean"] - 24.398529) < 4 * 0.070
    assert abs(end["lower"] - 22.603167) < 4 * 0.191
    assert abs(end["upper"] - 26.239206) < 4 * 0.170


def test_determinism_and_seed_effect(golden_payload):
    a = json.dumps({k: v for k, v in run_aeros(golden_payload).items() if k != "runtime_ms"}, sort_keys=True)
    b = json.dumps({k: v for k, v in run_aeros(golden_payload).items() if k != "runtime_ms"}, sort_keys=True)
    assert a == b
    c = run_aeros(dict(golden_payload, seed=7))
    assert c["seasons"]["D-J-F"]["summary_end"] != json.loads(a)["seasons"]["D-J-F"]["summary_end"]


def _dc_payload(nb_dc, **opts):
    inp = nb_dc["input"]
    return {"station": {"id": "USW00013743", "name": "Washington Reagan", "lat": 38.85, "lon": -77.03},
            "years": inp["years"], "seasons": inp["seasons"], "options": opts}


def test_api_result_contract_and_json(nb_dc):
    r = dispatch("aeros", _dc_payload(nb_dc, sample_paths=3))
    assert r["ok"]
    for key in ("model", "version", "inputs", "warnings", "provenance", "runtime_ms"):
        assert key in r
    json.dumps(r, allow_nan=False)  # strict JSON: no NaN/inf anywhere
    s = r["seasons"]["D-J-F"]
    assert s["local_label"] == "winter" and r["seasons"]["J-J-A"]["local_label"] == "summer"
    assert len(s["sample_paths"]) == 3
    assert abs(sum(m["weight"] for m in s["ensemble"]["members"]) - 1) < 1e-9
    assert {m["name"] for m in s["ensemble"]["members"]} == {"poly2", "pchip", "ridge", "lin_modern"}
    assert all(p["lower"] <= p["mean"] <= p["upper"] for p in s["projection"])
    assert s["data_quality"]["imputed_years"] == [h["year"] for h in s["historical"] if h["imputed"]]
    # default run reproduces the notebook reference exactly as configured
    assert abs(s["summary_end"]["mean"] - nb_dc["seasons"]["D-J-F"]["mean"][-1]) < TOL_C


def test_southern_hemisphere_labels(nb_dc):
    p = _dc_payload(nb_dc)
    p["station"]["lat"] = -34.6
    r = run_aeros(p)
    assert r["seasons"]["D-J-F"]["local_label"] == "summer"
    assert r["seasons"]["J-J-A"]["local_label"] == "winter"


def test_fast_mode_and_options(nb_dc):
    r = run_aeros(_dc_payload(nb_dc, mode="fast", end_year=2060))
    assert r["ok"] and r["inputs"]["n_bootstrap"] == 100
    assert r["seasons"]["J-J-A"]["projection"][-1]["year"] == 2060
    assert any("bootstrap paths" in w for w in r["warnings"])


def test_train_end_year_has_no_leakage(nb_dc):
    base = _dc_payload(nb_dc, train_end_year=2000, rolling_cv=False)
    r1 = run_aeros(base)
    tampered = json.loads(json.dumps(base))
    for s in tampered["seasons"].values():
        for i, y in enumerate(tampered["years"]):
            if y > 2000 and s[i] is not None:
                s[i] = s[i] + 25.0
    r2 = run_aeros(tampered)
    assert r1["hist_end_year"] == 2000
    for season in r1["seasons"]:
        assert r1["seasons"][season]["projection"] == r2["seasons"][season]["projection"]
        assert r1["seasons"][season]["ensemble"] == r2["seasons"][season]["ensemble"]


def test_errors_are_graceful():
    short = {"years": list(range(2000, 2008)), "seasons": {"D-J-F": [1.0] * 8}}
    r = run_aeros(short)
    assert r["ok"] is False and "10" in r["error"]["message"]
    json.dumps(r, allow_nan=False)
    r = run_aeros({"years": [2000, 2001], "seasons": {"D-J-F": [None, None]}})
    assert r["ok"] is False
    r = run_aeros({"years": [2000, 2001], "seasons": {"D-J-F": [1.0]}})
    assert r["ok"] is False and "values" in r["error"]["message"]
    r = run_aeros({"years": [2000], "seasons": {"XYZ": [1.0]}})
    assert r["ok"] is False
    r = run_aeros({})
    assert r["ok"] is False
    r = dispatch("nope", {})
    assert r["ok"] is False


def test_gappy_series_runs_with_warnings():
    rng = np.random.default_rng(0)
    years = list(range(1950, 2025))
    vals = list(15 + 0.02 * (np.array(years) - 1950) + rng.normal(0, 0.6, len(years)))
    for i in range(10, 22):  # a 12-year hole
        vals[i] = None
    vals[30] = 999.9  # sentinel
    short = [None] * len(years)
    for i in range(5):
        short[-i - 1] = 20.0  # J-J-A has only 5 values -> skipped like the notebook
    r = run_aeros({"years": years, "seasons": {"D-J-F": vals, "J-J-A": short}, "options": {"mode": "fast"}})
    assert r["ok"], r.get("error")
    assert r["skipped_seasons"] == ["J-J-A"]
    q = r["seasons"]["D-J-F"]["data_quality"]
    assert q["sentinel_values_removed"] == 1
    assert len(q["imputed_years"]) == 13 and q["longest_internal_gap_years"] == 12
    assert any("gap" in w for w in r["warnings"])
    json.dumps(r, allow_nan=False)


def test_ridge_port_matches_sklearn():
    sk = pytest.importorskip("sklearn")  # noqa: F841
    from sklearn.linear_model import RidgeCV
    from sklearn.model_selection import TimeSeriesSplit
    rng = np.random.default_rng(1)
    for n in (8, 15, 47, 89):
        x = np.arange(1940, 1940 + n)
        y = 10 + 0.02 * (x - 1940) + rng.normal(0, 0.8, n)
        xc = x.mean()
        V = np.vstack([(x - xc) ** d for d in range(1, 4)]).T
        Vf = np.vstack([(np.arange(2026, 2101) - xc) ** d for d in range(1, 4)]).T
        ref = RidgeCV(alphas=[0.01, 0.1, 1.0], cv=TimeSeriesSplit(n_splits=3)).fit(V, y).predict(Vf)
        np.testing.assert_allclose(aeros.ridge_cv_predict(V, y, Vf), ref, rtol=1e-9, atol=1e-7)


def test_ar1_port_matches_statsmodels():
    pytest.importorskip("statsmodels")
    import warnings
    from statsmodels.tsa.arima.model import ARIMA
    from statsmodels.tsa.stattools import acf
    rng = np.random.default_rng(2)
    r = np.zeros(80)
    for t in range(1, 80):
        r[t] = 0.3 * r[t - 1] + rng.normal(0, 0.7)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = ARIMA(r, order=(1, 0, 0), enforce_stationarity=False).fit()
    _, label, params = aeros.fit_ar1(r)
    assert label == "AR1"
    assert abs(params["phi"] - fit.arparams[0]) < 1e-4
    assert abs(params["const"] - fit.params[0]) < 1e-4
    assert abs(params["innovation_sd"] - np.std(fit.resid)) < 1e-4
    np.testing.assert_allclose(aeros.acf_statsmodels(r, 50), acf(r, nlags=50, fft=True), atol=1e-12)


def test_runtime_imports_are_pyodide_safe():
    code = ("import sys; sys.path.insert(0, %r); from solaris_models import api; "
            "api.run_aeros({'years': list(range(1950, 2000)), 'seasons': {'D-J-F': [float(i %% 7) for i in range(50)]},"
            " 'options': {'mode': 'fast'}}); "
            "api.run_nexus({'years': list(range(1950, 2020)), 'seasons': {'D-J-F': [float(i %% 7) for i in range(70)]},"
            " 'options': {'mode': 'fast'}}); "
            "bad = [m for m in ('sklearn', 'pandas', 'statsmodels', 'matplotlib', 'joblib', 'multiprocessing', 'threading_x')"
            " if m in sys.modules]; print(bad)") % str(MODELS)
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "[]", out.stdout + out.stderr
