"""Regenerate the CORe 4.0 parity fixture by running the ORIGINAL notebook cell08 code.

Dev-only (needs pandas + scikit-learn). From the repo root:

    .venv/bin/python models/tools/core_notebook_reference.py

What it does:
  1. Reads reference/notebook_cells/cell08.py verbatim.
  2. Strips only Colab/plotting/install lines: IPython display import, pip installs, matplotlib /
     plotly imports and the two graph sections (static + interactive), and sets
     HISTORICAL_SOURCE="csv_file" + HISTORICAL_CSV_PATH=data/co2/historical_co2_1940_2025.csv and an
     output directory in a temporary folder. All modelling code is untouched.
  3. Executes it and writes models/tests/fixtures/core4_notebook_reference.json with the full
     2026-2100 time series, the 2100 summary, growth constraints and the validation table.
"""

from __future__ import annotations

import json
import re
import runpy
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CELL = ROOT / "reference" / "notebook_cells" / "cell08.py"
CSV = ROOT / "data" / "co2" / "historical_co2_1940_2025.csv"
OUT = ROOT / "models" / "tests" / "fixtures" / "core4_notebook_reference.json"


def build_script(out_dir: Path) -> str:
    lines = CELL.read_text(encoding="utf-8").splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith("# Static graph")) - 1
    end = next(i for i, l in enumerate(lines) if l.startswith("# Display summary")) - 1
    text = "\n".join(lines[:start] + lines[end:])
    text = text.replace("from IPython.display import display, HTML", "display = lambda *a, **k: None\nHTML = str")
    text = re.sub(r"^_core4_install_if_missing\(.*$", "", text, flags=re.M)
    text = text.replace("import matplotlib.pyplot as plt\n", "").replace("import plotly.graph_objects as go\n", "")
    text = text.replace("import requests\n", "requests = None  # not used with csv_file source\n")
    text = text.replace('Path("/content/core4_one_pathway_outputs")', f'Path(r"{out_dir}")')
    text = text.replace('HISTORICAL_SOURCE = "auto"', 'HISTORICAL_SOURCE = "csv_file"')
    text = text.replace('HISTORICAL_CSV_PATH = "/content/historical_co2_1880_2025.csv"', f'HISTORICAL_CSV_PATH = r"{CSV}"')
    # the summary prints reference the removed plot paths
    text = text.replace('print("Static plot:", static_png)', "").replace('print("Interactive HTML:", interactive_html)', "")
    return text


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "cell08_stripped.py"
        script.write_text(build_script(Path(tmp) / "out"), encoding="utf-8")
        g = runpy.run_path(str(script), run_name="__main__")
    fut = g["future_df"]
    vs = g["validation_summary"]
    ref = {
        "description": "Original notebook cell08 (CORe 4.0) executed on data/co2/historical_co2_1940_2025.csv "
                       "by models/tools/core_notebook_reference.py",
        "years": [int(v) for v in fut["YEAR"]],
        "ppm_mean": [float(v) for v in fut["CO2_PPM_MEAN"]],
        "ppm_lower": [float(v) for v in fut["CO2_PPM_LO"]],
        "ppm_upper": [float(v) for v in fut["CO2_PPM_HI"]],
        "forcing_wm2": [float(v) for v in fut["CO2_FORCING_WM2"]],
        "temperature_response_c": [float(v) for v in fut["TEMP_RESPONSE_C"]],
        "model_spread_ppm": [float(v) for v in fut["MODEL_SPREAD_PPM"]],
        "conformal_base_error_ppm": float(g["base_error"]),
        "growth_constraints": g["growth_info"],
        "validation_summary": [
            {"model": r.MODEL, "mae_ppm": float(r.MAE_PPM), "rmse_ppm": float(r.RMSE_PPM), "bias_ppm": float(r.BIAS_PPM),
             "n_validation_points": int(r.N_VALIDATION_POINTS), "selected_for_ensemble": bool(r.SELECTED_FOR_ENSEMBLE),
             "weight": float(r.WEIGHT)}
            for r in vs.itertuples()
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(ref, indent=1), encoding="utf-8")
    print("wrote", OUT, "2100:", ref["ppm_mean"][-1], ref["ppm_lower"][-1], ref["ppm_upper"][-1])


if __name__ == "__main__":
    main()
