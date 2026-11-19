# Solaris sample station set

Seasonal surface-air-temperature series (°C) for a sample of U.S., Argentine and world
weather stations, ready to run in the Aeros model.

**This is our own comparable sample set. It is not the 40-station list used in the Solaris
research poster.**

## Contents

- `csv/<station_id>.csv` — one file per station, columns `YEAR,D-J-F,J-J-A`, °C,
  missing values left empty. Series start in 1940 (or the first valid year after it).
- `stations.json` — metadata for every station: name, coordinates, elevation, urban/rural
  class and the brightness value it is based on, urban–rural pair, hemisphere, coverage counts,
  source and retrieval date.
- `aeros_input_template.csv` and `HOW_TO_FORMAT_YOUR_DATA.md` — for preparing your own data.

## Source and method

- Monthly mean temperatures: NOAA NCEI GHCN-M v4 TAVG, adjusted (`qcf`) — the station
  input used by NASA GISS GISTEMP v4. https://www.ncei.noaa.gov/pub/data/ghcn/v4/
- Station inventory and night-light brightness index (BI): NASA GISS GISTEMP v4,
  https://data.giss.nasa.gov/gistemp/station_data_v4_globe/v4.temperature.inv.txt
- Seasons: D-J-F of year Y = mean of December Y−1, January Y and February Y (NASA GISS
  convention); J-J-A = June–August of year Y. A season is only computed when all three months
  are present. No gaps are filled.
- Urban/rural: GISS brightness classes — rural BI ≤ 10, peri-urban 11–35, urban ≥ 36.
- Southern Hemisphere stations: D-J-F is local summer, J-J-A local winter.

GISS's own urban homogenization is **not** applied; values may differ from the per-station
series shown on the GISS website.

## Citation

- GISTEMP Team: GISS Surface Temperature Analysis (GISTEMP), version 4. NASA Goddard Institute
  for Space Studies. https://data.giss.nasa.gov/gistemp/
- Lenssen, N. et al. (2019), Improvements in the GISTEMP uncertainty model, J. Geophys. Res.
  Atmos., 124, 6307–6326; Lenssen, N. et al. (2024), A NASA GISTEMPv4 observational uncertainty
  ensemble, J. Geophys. Res. Atmos., 129, e2023JD040179.
- Menne, M. J. et al. (2018), The Global Historical Climatology Network Monthly Temperature
  Dataset, Version 4, J. Climate, 31, 9835–9854.

Build script: `data/scripts/build_stations.py` in the Solaris repository.
