"""Dev tool (not shipped to the browser): run the ORIGINAL Aeros 4.0 notebook code headless.

It reads reference/notebook_cells/cell01.py + cell02.py, strips only the Colab / pip / plotting /
PDF / dask / prophet / arch / emcee lines (none of which run in fast_mode), replaces joblib with
an in-order loop (results are identical: every bootstrap path has its own seed), and runs the
same steps as the notebook's main(): preprocess_city -> impute_missing_years_pchip ->
CONFIG year updates -> run_projection_for_city. Requires pandas, scikit-learn and statsmodels.

usage:
  python models/tools/notebook_reference.py <input.csv> <city_name> <out.json> [n_boot]

The output JSON embeds the input series so tests are self-contained.
"""
from __future__ import annotations

import csv
import json
import logging
import sys
import time
import warnings
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CELLS = ROOT / "reference" / "notebook_cells"

_DROP = ("!pip", "from prophet", "import cmdstanpy", "import dask", "from dask", "import plotly",
         "import matplotlib", "from reportlab", "from arch", "import emcee")


def build_notebook_namespace() -> dict:
    c1 = (CELLS / "cell01.py").read_text(encoding="utf-8")
    lines = []
    for line in (CELLS / "cell02.py").read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith(_DROP):
            lines.append(line[: len(line) - len(line.lstrip())] + "pass  # stripped: " + s)
        else:
            lines.append(line)
    c2 = "\n".join(lines)
    c2 = c2.replace('if __name__ == "__main__":\n    all_results = main()', "")
    c2 = c2.replace(
        "from joblib import Parallel, delayed",
        "def delayed(f):\n    return f\nclass Parallel:\n    def __init__(self, **k): pass\n"
        "    def __call__(self, it): return list(it)")
    ns = {"__name__": "aeros_notebook_reference"}
    src = "import numpy as np, pandas as pd\n" + c1 + "\n\n" + c2 + "\n"
    exec(compile(src, "aeros_notebook_reference.py", "exec"), ns)
    return ns


def run(csv_path: str, city: str, n_boot: int | None = None) -> dict:
    warnings.filterwarnings("ignore")
    logging.disable(logging.CRITICAL)
    ns = build_notebook_namespace()
    cfg = ns["CONFIG"]
    if n_boot:
        cfg["N_BOOT_FAST"] = int(n_boot)
    run_config = ns["get_run_config"](cfg)
    df = ns["preprocess_city"](csv_path, city_name=city)
    if ns["impute_missing_years"]:
        df = ns["impute_missing_years_pchip"](df)
    y = int(df["YEAR"].max())
    cfg["HIST_FULL_END"] = y
    cfg["MODERN_END"] = y
    cfg["FUT_START"] = y + 1
    t0 = time.perf_counter()
    res = ns["run_projection_for_city"](df, run_config)
    elapsed = time.perf_counter() - t0

    with open(csv_path, newline="") as f:
        rows = list(csv.DictReader(f))
    inp_years = [int(r["YEAR"]) for r in rows]
    inp = {k: [float(r[k]) if r[k] not in ("", None) else None for r in rows] for k in rows[0] if k != "YEAR"}

    out = {"city": city, "n_boot": run_config["N_BOOT"], "runtime_s": elapsed,
           "input": {"years": inp_years, "seasons": inp}, "seasons": {}}
    for season, r in res.items():
        s, p = r["summary"], r["plot_data"]
        out["seasons"][season] = {
            "summary": {k: (float(v) if isinstance(v, (float, np.floating)) else
                            int(v) if isinstance(v, (np.integer,)) else v) for k, v in s.items()},
            "years": [int(v) for v in p["years_full"]], "temps": [float(v) for v in p["temps_full"]],
            "future_years": [int(v) for v in p["future_years"]],
            "mean": [float(v) for v in p["ens_mean"]], "lower": [float(v) for v in p["ci_lower"]],
            "upper": [float(v) for v in p["ci_upper"]],
        }
    return out


if __name__ == "__main__":
    csv_path, city, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    nb = int(sys.argv[4]) if len(sys.argv) > 4 else None
    result = run(csv_path, city, nb)
    Path(out_path).write_text(json.dumps(result, indent=1), encoding="utf-8")
    for season, r in result["seasons"].items():
        print(season, "2100 mean %.6f [%.6f, %.6f]" % (r["mean"][-1], r["lower"][-1], r["upper"][-1]),
              "sim", r["summary"]["RESIDUAL_SIMULATOR"])
    print("runtime %.2fs" % result["runtime_s"])
