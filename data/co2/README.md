# data/co2 — CO2 history and scenario pathways (CORe 4.0 / Catalyst 1.0 inputs)

Retrieved **2026-11-18**. Rebuild with (network + pandas needed; not part of the browser package):

```
.venv/bin/python data/co2/build_co2_data.py --raw-dir <some temp dir>
```

The raw RCMIP CSVs (21–48 MB each) are **not** stored here; only the small extracts below.

## Files

| File | Content |
|---|---|
| `noaa_co2_annmean_gl.txt` | Verbatim NOAA GML global marine-surface annual mean CO2, 1979–2025 (file header: "File Creation: Fri Oct 9 13:08:02 2026"). |
| `noaa_co2_annmean_mlo.txt` | Verbatim NOAA GML Mauna Loa annual mean CO2, 1959–2025 (context only; not used by the models). |
| `historical_co2_1940_2025.csv` | `year,co2_ppm,source` — the CORe 4.0 input, built exactly as notebook cell07: RCMIP `historical` World CO2 for 1940–1978 + NOAA global annual mean for 1979–2025. No bridging offset (no overlap years, as in the notebook). Full float precision. |
| `ssp_co2_concentrations.csv` | `year, historical, ssp119, ssp126, ssp245, ssp370, ssp434, ssp460, ssp585` — RCMIP World `Atmospheric Concentrations\|CO2` (ppm), 1750–2100. |
| `ssp_co2_emissions.csv` | Long format `scenario, year, co2_total_gtco2, co2_ffi_gtco2, co2_afolu_gtco2, interpolated` — RCMIP World CO2 emissions (GtCO2/yr), 1750–2100. |
| `ssp_erf.csv` | Long format `scenario, year, erf_total_wm2, erf_anthro_wm2, erf_anthro_co2_wm2` — RCMIP World effective radiative forcing (W/m²), 1750–2100. |
| `co2_bundle.json` | Everything above in one compact JSON (~150 kB) for the web app; pass it (or the needed parts) in model payloads. |
| `build_co2_data.py` | The extraction script (exact filters below). |

## Exact extraction filters

RCMIP v5.1.0 annual means (`Region == "World"`, `Scenario in {historical, ssp119, ssp126, ssp245, ssp370, ssp434, ssp460, ssp585}`, year columns 1750–2100):

- Concentrations: `Variable == "Atmospheric Concentrations|CO2"` (Unit `ppm`, Activity_Id `input4MIPs`, i.e. the CMIP6 greenhouse-gas concentrations of Meinshausen et al. 2017/2020).
- Emissions: `Variable in {"Emissions|CO2", "Emissions|CO2|MAGICC Fossil and Industrial", "Emissions|CO2|MAGICC AFOLU"}` (Unit `Mt CO2/yr`, divided by 1000 → GtCO2/yr). Historical rows are model `CEDS/UVA/GCP/PRIMAP`; SSP rows are the marker IAMs (IMAGE ssp119/ssp126, MESSAGE-GLOBIOM ssp245, AIM/CGE ssp370, GCAM4 ssp434/ssp460, REMIND-MAGPIE ssp585).
- Forcing: `Variable in {"Effective Radiative Forcing", "Effective Radiative Forcing|Anthropogenic", "Effective Radiative Forcing|Anthropogenic|CO2"}` (W/m²). "Non-CO2 anthropogenic ERF" used by Catalyst = `Anthropogenic − Anthropogenic|CO2`. `Effective Radiative Forcing` (total) also contains natural solar + volcanic forcing.
- Splicing: every SSP series = RCMIP `historical` for 1750–2014 and the SSP row from 2015 (RCMIP's own convention; for concentrations the SSP rows are identical to `historical` before 2015, which the script checks). In the bundle, `historical` is `null` after 2014.
- SSP emissions are only given at the IAM time steps 2015, 2020, 2030, …, 2100 (`rcmip.emissions_native_years` in the bundle). They are **linearly interpolated** to annual values (column `interpolated = True` in the CSV).

NOAA: data lines of `co2_annmean_gl.txt` (`year mean unc`), comment lines (`#`) skipped. `historical_co2_1940_2025.csv` uses years 1979–2025.

## `co2_bundle.json` shape

```jsonc
{
  "schema": "solaris.co2_bundle.v1",
  "retrieved": "2026-11-18",
  "notes": "...",
  "sources": {"noaa_global_annual": url, "noaa_mlo_annual": url, "rcmip_concentrations": url, "rcmip_emissions": url, "rcmip_erf": url},
  "historical_co2": {"description": "...", "years": [1940..2025], "ppm": [86 floats], "source": [86 labels]},   // CORe input
  "noaa_global_annual": {"years": [1979..2025], "ppm": [...], "unc_ppm": [...]},
  "noaa_mlo_annual":    {"years": [1959..2025], "ppm": [...], "unc_ppm": [...]},
  "rcmip": {
    "years": [1750..2100],                                   // 351 entries; every array below is aligned to it
    "scenarios": ["historical","ssp119","ssp126","ssp245","ssp370","ssp434","ssp460","ssp585"],
    "emissions_native_years": [2015,2020,2030,...,2100],
    "concentrations_ppm": {"ssp245": [351 floats], ..., "historical": [... null after 2014]},
    "emissions_gtco2":   {"ssp245": {"total": [...], "ffi": [...], "afolu": [...]}, ...},
    "erf_wm2":           {"ssp245": {"total": [...], "anthro": [...], "anthro_co2": [...]}, ...}
  }
}
```

Values in `rcmip` are rounded to 4 decimals; `historical_co2.ppm` keeps full precision (needed for exact CORe parity).

## Sources, licences and citations

- **NOAA GML** global and Mauna Loa annual mean CO2 — https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_gl.txt and https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_mlo.txt. Freely available U.S. Government data (see the "USE OF NOAA GML DATA" header kept in the files). Cite: Lan, X., Tans, P. and K.W. Thoning: Trends in globally-averaged CO2 determined from NOAA Global Monitoring Laboratory measurements, https://doi.org/10.15138/9N0H-ZH07; Mauna Loa: Keeling, C.D. et al. / NOAA GML. Recent years are subject to small revisions (see "vintage" note below).
- **RCMIP v5.1.0** — Nicholls, Z. and Lewis, J. (2021): Reduced Complexity Model Intercomparison Project (RCMIP) protocol, v5.1.0, Zenodo, https://doi.org/10.5281/zenodo.4589756 (record https://zenodo.org/records/4589756), licence CC BY-SA 4.0 (the extracts here are derived data and are shared under the same licence). Cite: Nicholls, Z. R. J. et al. (2020), Reduced Complexity Model Intercomparison Project Phase 1, *Geosci. Model Dev.* 13, 5175–5190, https://doi.org/10.5194/gmd-13-5175-2020. Concentrations are the CMIP6 input4MIPs series: Meinshausen, M. et al. (2017) *GMD* 10, 2057–2116 and Meinshausen, M. et al. (2020), The shared socio-economic pathway (SSP) greenhouse gas concentrations and their extensions to 2500, *GMD* 13, 3571–3605, https://doi.org/10.5194/gmd-13-3571-2020. Emissions: Gidden, M. J. et al. (2019) *GMD* 12, 1443–1475 (SSP harmonised emissions) and the historical CEDS/GCP/PRIMAP compilation as packaged by RCMIP.

## Data vintage note (why 620.86 vs 621.15)

The CORe 4.0 poster number (620.86 ppm in 2100) is reproduced **exactly** from these files (NOAA release of
9 Oct 2026, 2025 = 425.62 ppm). An earlier service reproduced 621.15 ppm with an older NOAA release. NOAA
revises recent annual values by ~0.01–0.02 ppm between releases, and CORe's 2100 value moves by roughly
0.1–0.3 ppm per such revision (see `models/NOTES.md`, "CORe / Catalyst").
