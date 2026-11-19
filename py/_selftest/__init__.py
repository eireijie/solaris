"""Runtime self-test: proves numpy + scipy work inside Pyodide and that
JSON in/out (incl. NaN -> null, numpy scalars) crosses the worker boundary.

Called from the dev page (#/dev/runtime) and scripts/smoke.mjs.
"""
import time

import numpy as np
from scipy import optimize, stats


def run(payload):
    t0 = time.perf_counter()
    seed = int(payload.get("seed", 42))
    n = int(payload.get("n", 60))
    rng = np.random.default_rng(seed)
    years = np.arange(1960, 1960 + n)
    temps = 12.0 + 0.02 * (years - 1960) + rng.normal(0, 0.3, n)

    # Linear trend with scipy.stats + a curve_fit, like the models do.
    lr = stats.linregress(years, temps)
    popt, _ = optimize.curve_fit(lambda x, a, b: a + b * (x - 1960), years, temps)

    return {
        "ok": True,
        "numpy": np.__version__,
        "scipy": __import__("scipy").__version__,
        "slope_per_decade": float(lr.slope * 10),
        "curve_fit_slope_per_decade": popt[1] * 10,  # numpy scalar -> converted by the bridge
        "r2": lr.rvalue ** 2,
        "p_value": lr.pvalue,
        "nan_becomes_null": float("nan"),
        "series_head": temps[:5],  # ndarray -> list
        "elapsed_ms": (time.perf_counter() - t0) * 1000,
    }


def fail(payload):
    """Raises on purpose so the UI can show Python tracebacks."""
    raise ValueError("Self-test error: " + str(payload.get("reason", "intentional")))
