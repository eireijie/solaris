"""Build the small CO2 / scenario data files in data/co2/ from the public sources.

Run from the repo root (needs network + pandas; NOT part of the browser package):

    .venv/bin/python data/co2/build_co2_data.py --raw-dir /some/tmp/dir

It downloads (or reuses, if already present in --raw-dir) the NOAA GML annual-mean
text files and the three RCMIP v5.1.0 annual-mean CSVs, then writes:

    data/co2/noaa_co2_annmean_gl.txt         (verbatim copy, NOAA global annual mean)
    data/co2/noaa_co2_annmean_mlo.txt        (verbatim copy, NOAA Mauna Loa annual mean)
    data/co2/historical_co2_1940_2025.csv    (notebook cell07 recipe: RCMIP 1940-1978 + NOAA global 1979+)
    data/co2/ssp_co2_concentrations.csv      (RCMIP World CO2 ppm, 1750-2100, wide by scenario)
    data/co2/ssp_co2_emissions.csv           (RCMIP World CO2 emissions GtCO2/yr, 1750-2100, long)
    data/co2/ssp_erf.csv                     (RCMIP World ERF W/m2, 1750-2100, long)
    data/co2/co2_bundle.json                 (all of the above in one compact JSON for the web app)

The raw RCMIP CSVs (21-48 MB) are deliberately NOT stored in the repo.
"""

from __future__ import annotations

import argparse
import json
import shutil
import urllib.request
from datetime import date
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent

URLS = {
    "noaa_gl": "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_gl.txt",
    "noaa_mlo": "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_mlo.txt",
    "rcmip_conc": "https://zenodo.org/records/4589756/files/rcmip-concentrations-annual-means-v5-1-0.csv?download=1",
    "rcmip_emis": "https://zenodo.org/records/4589756/files/rcmip-emissions-annual-means-v5-1-0.csv?download=1",
    "rcmip_erf": "https://zenodo.org/records/4589756/files/rcmip-radiative-forcing-annual-means-v5-1-0.csv?download=1",
}
RAW_NAMES = {
    "noaa_gl": "co2_annmean_gl.txt",
    "noaa_mlo": "co2_annmean_mlo.txt",
    "rcmip_conc": "rcmip-concentrations-annual-means-v5-1-0.csv",
    "rcmip_emis": "rcmip-emissions-annual-means-v5-1-0.csv",
    "rcmip_erf": "rcmip-radiative-forcing-annual-means-v5-1-0.csv",
}

SCENARIOS = ["ssp119", "ssp126", "ssp245", "ssp370", "ssp434", "ssp460", "ssp585"]
YEAR_MIN, YEAR_MAX = 1750, 2100
HIST_SPLICE_END = 2014  # RCMIP "historical" ends 2014; SSPs start 2015

CONC_VAR = "Atmospheric Concentrations|CO2"
EMIS_VARS = {
    "Emissions|CO2": "co2_total_gtco2",
    "Emissions|CO2|MAGICC Fossil and Industrial": "co2_ffi_gtco2",
    "Emissions|CO2|MAGICC AFOLU": "co2_afolu_gtco2",
}
ERF_VARS = {
    "Effective Radiative Forcing": "erf_total_wm2",
    "Effective Radiative Forcing|Anthropogenic": "erf_anthro_wm2",
    "Effective Radiative Forcing|Anthropogenic|CO2": "erf_anthro_co2_wm2",
}


def fetch(key: str, raw_dir: Path) -> Path:
    path = raw_dir / RAW_NAMES[key]
    if path.exists() and path.stat().st_size > 100:
        return path
    req = urllib.request.Request(URLS[key], headers={"User-Agent": "solaris-data-build/1.0"})
    with urllib.request.urlopen(req, timeout=600) as r, open(path, "wb") as f:
        shutil.copyfileobj(r, f)
    return path


def parse_noaa_annual(path: Path) -> pd.DataFrame:
    rows = []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        parts = s.split()
        rows.append((int(float(parts[0])), float(parts[1]), float(parts[2]) if len(parts) > 2 else float("nan")))
    return pd.DataFrame(rows, columns=["year", "co2_ppm", "unc_ppm"])


def year_cols(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if str(c).isdigit() and YEAR_MIN <= int(c) <= YEAR_MAX]


def select_world(df: pd.DataFrame, variables: list[str], scenarios: list[str]) -> pd.DataFrame:
    m = (df["Region"] == "World") & df["Variable"].isin(variables) & df["Scenario"].isin(scenarios)
    sub = df.loc[m].copy()
    dup = sub.duplicated(["Scenario", "Variable"])
    if dup.any():
        raise RuntimeError(f"Duplicate RCMIP rows: {sub.loc[dup, ['Scenario', 'Variable']]}")
    return sub


def to_long(sub: pd.DataFrame, name_map: dict[str, str], scale: float = 1.0) -> pd.DataFrame:
    ycols = year_cols(sub)
    long = sub.melt(id_vars=["Scenario", "Variable"], value_vars=ycols, var_name="year", value_name="value")
    long["year"] = long["year"].astype(int)
    long["value"] = pd.to_numeric(long["value"], errors="coerce") * scale
    long["Variable"] = long["Variable"].map(name_map)
    wide = long.pivot_table(index=["Scenario", "year"], columns="Variable", values="value").reset_index()
    wide = wide.rename(columns={"Scenario": "scenario"})
    wide.columns.name = None
    return wide


def splice_scenarios(long: pd.DataFrame, value_cols: list[str]) -> pd.DataFrame:
    """Each SSP: RCMIP 'historical' up to 2014, the SSP row from 2015 (RCMIP's own convention)."""
    hist = long[(long["scenario"] == "historical") & (long["year"] <= HIST_SPLICE_END)]
    out = [hist.assign(scenario="historical")]
    for sc in SCENARIOS:
        fut = long[(long["scenario"] == sc) & (long["year"] > HIST_SPLICE_END)]
        out.append(pd.concat([hist.assign(scenario=sc), fut]))
    res = pd.concat(out, ignore_index=True)[["scenario", "year"] + value_cols]
    return res.sort_values(["scenario", "year"]).reset_index(drop=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", required=True, type=Path)
    ap.add_argument("--retrieved", default=date.today().isoformat())
    args = ap.parse_args()
    args.raw_dir.mkdir(parents=True, exist_ok=True)
    raw = {k: fetch(k, args.raw_dir) for k in URLS}

    # --- NOAA (verbatim copies) ---
    shutil.copyfile(raw["noaa_gl"], HERE / "noaa_co2_annmean_gl.txt")
    shutil.copyfile(raw["noaa_mlo"], HERE / "noaa_co2_annmean_mlo.txt")
    noaa_gl = parse_noaa_annual(raw["noaa_gl"])
    noaa_mlo = parse_noaa_annual(raw["noaa_mlo"])

    # --- RCMIP concentrations ---
    conc = pd.read_csv(raw["rcmip_conc"])
    csub = select_world(conc, [CONC_VAR], SCENARIOS + ["historical"])
    clong = to_long(csub, {CONC_VAR: "co2_ppm"})
    # Check the SSP rows agree with 'historical' over the shared period (they should be identical).
    h = clong[clong.scenario == "historical"].set_index("year")["co2_ppm"]
    for sc in SCENARIOS:
        s = clong[clong.scenario == sc].set_index("year")["co2_ppm"]
        diff = (s.loc[YEAR_MIN:HIST_SPLICE_END] - h.loc[YEAR_MIN:HIST_SPLICE_END]).abs().max()
        if diff > 1e-6:
            raise RuntimeError(f"{sc} disagrees with historical before 2015 by {diff}")
    conc_sp = splice_scenarios(clong, ["co2_ppm"])
    conc_wide = conc_sp.pivot(index="year", columns="scenario", values="co2_ppm").reset_index()
    conc_wide = conc_wide[["year", "historical"] + SCENARIOS]
    conc_wide.to_csv(HERE / "ssp_co2_concentrations.csv", index=False, float_format="%.6f")

    # --- cell07 historical series: RCMIP historical 1940-1978 + NOAA global annual 1979-2025 ---
    r = clong[(clong.scenario == "historical") & clong.year.between(1940, 1978)][["year", "co2_ppm"]]
    r = r.assign(source="RCMIP_historical_concentration")
    n = noaa_gl[noaa_gl.year.between(1979, 2025)][["year", "co2_ppm"]].assign(source="NOAA_global_annual")
    hist = pd.concat([r, n], ignore_index=True).sort_values("year").reset_index(drop=True)
    if sorted(hist.year) != list(range(1940, 2026)):
        raise RuntimeError("historical_co2_1940_2025 is missing years")
    hist.to_csv(HERE / "historical_co2_1940_2025.csv", index=False)  # full precision (CORe parity)

    # --- RCMIP emissions (Mt CO2/yr -> Gt CO2/yr) ---
    emis = pd.read_csv(raw["rcmip_emis"])
    esub = select_world(emis, list(EMIS_VARS), SCENARIOS + ["historical"])
    if set(esub["Unit"]) != {"Mt CO2/yr"}:
        raise RuntimeError(f"Unexpected emission units {set(esub['Unit'])}")
    elong = to_long(esub, EMIS_VARS, scale=1e-3)
    emis_sp = splice_scenarios(elong, list(EMIS_VARS.values()))
    # SSP emissions are only given at the IAM time steps (2015, 2020, 2030, ..., 2100).
    # Linearly interpolate to annual values (the RCMIP/MAGICC convention) and flag them.
    filled = []
    for sc, g in emis_sp.groupby("scenario"):
        vcols = list(EMIS_VARS.values())
        g = g.set_index("year")[vcols].reindex(range(YEAR_MIN, YEAR_MAX + 1 if sc != "historical" else HIST_SPLICE_END + 1))
        native = g["co2_total_gtco2"].notna()
        g = g.astype(float).interpolate(method="index", limit_area="inside")
        g["scenario"] = sc
        g["interpolated"] = ~native
        filled.append(g.reset_index().rename(columns={"index": "year"}))
    emis_sp = pd.concat(filled, ignore_index=True)[["scenario", "year"] + list(EMIS_VARS.values()) + ["interpolated"]]
    emis_native_years = sorted(int(y) for y in emis_sp.loc[(emis_sp.scenario == "ssp245") & ~emis_sp.interpolated & (emis_sp.year > HIST_SPLICE_END), "year"])
    emis_sp.to_csv(HERE / "ssp_co2_emissions.csv", index=False, float_format="%.6f")

    # --- RCMIP effective radiative forcing ---
    erf = pd.read_csv(raw["rcmip_erf"])
    fsub = select_world(erf, list(ERF_VARS), SCENARIOS + ["historical"])
    flong = to_long(fsub, ERF_VARS)
    erf_sp = splice_scenarios(flong, list(ERF_VARS.values()))
    erf_sp.to_csv(HERE / "ssp_erf.csv", index=False, float_format="%.6f")

    # --- Compact JSON bundle ---
    years = list(range(YEAR_MIN, YEAR_MAX + 1))

    def series(df: pd.DataFrame, sc: str, col: str, nd: int) -> list:
        s = df[df.scenario == sc].set_index("year")[col].reindex(years)
        return [None if pd.isna(v) else round(float(v), nd) for v in s]

    all_sc = ["historical"] + SCENARIOS
    bundle = {
        "schema": "solaris.co2_bundle.v1",
        "retrieved": args.retrieved,
        "notes": (
            "SSP series are spliced: RCMIP 'historical' for 1750-2014, the SSP row from 2015 "
            "(identical to RCMIP's own SSP rows before 2015 for concentrations). 'historical' "
            "entries are null after 2014. Emissions in GtCO2/yr (RCMIP Mt CO2/yr / 1000); SSP "
            "emissions are native only at rcmip.emissions_native_years after 2014 and linearly "
            "interpolated in between. ERF in W/m2 (total includes natural solar+volcanic)."
        ),
        "sources": {
            "noaa_global_annual": URLS["noaa_gl"],
            "noaa_mlo_annual": URLS["noaa_mlo"],
            "rcmip_concentrations": URLS["rcmip_conc"],
            "rcmip_emissions": URLS["rcmip_emis"],
            "rcmip_erf": URLS["rcmip_erf"],
        },
        "historical_co2": {
            "description": "CORe 4.0 input (notebook cell07): RCMIP historical 1940-1978 + NOAA GML global annual mean 1979-2025",
            "years": [int(y) for y in hist.year],
            "ppm": [float(v) for v in hist.co2_ppm],
            "source": list(hist.source),
        },
        "noaa_global_annual": {
            "years": [int(y) for y in noaa_gl.year],
            "ppm": [float(v) for v in noaa_gl.co2_ppm],
            "unc_ppm": [float(v) for v in noaa_gl.unc_ppm],
        },
        "noaa_mlo_annual": {
            "years": [int(y) for y in noaa_mlo.year],
            "ppm": [float(v) for v in noaa_mlo.co2_ppm],
            "unc_ppm": [float(v) for v in noaa_mlo.unc_ppm],
        },
        "rcmip": {
            "years": years,
            "scenarios": all_sc,
            "emissions_native_years": emis_native_years,
            "concentrations_ppm": {sc: series(conc_sp, sc, "co2_ppm", 4) for sc in all_sc},
            "emissions_gtco2": {
                sc: {
                    "total": series(emis_sp, sc, "co2_total_gtco2", 4),
                    "ffi": series(emis_sp, sc, "co2_ffi_gtco2", 4),
                    "afolu": series(emis_sp, sc, "co2_afolu_gtco2", 4),
                }
                for sc in all_sc
            },
            "erf_wm2": {
                sc: {
                    "total": series(erf_sp, sc, "erf_total_wm2", 4),
                    "anthro": series(erf_sp, sc, "erf_anthro_wm2", 4),
                    "anthro_co2": series(erf_sp, sc, "erf_anthro_co2_wm2", 4),
                }
                for sc in all_sc
            },
        },
    }
    (HERE / "co2_bundle.json").write_text(json.dumps(bundle, separators=(",", ":")), encoding="utf-8")
    print("wrote", sorted(p.name for p in HERE.iterdir()))


if __name__ == "__main__":
    main()
