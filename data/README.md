# Solaris bundled data

## Stations

**Solaris sample station set**: seasonal surface-air-temperature series (°C) for 45 weather
stations, ready to run in Aeros. 40 are in the Americas (26 United States, 14 Argentina) and 5
are world stations kept for the demo (`set: "world"`, not part of the Americas statistics).

> This is our own comparable sample set, assembled with the rules below. It is **not** the
> 40-station list used in the Solaris research poster, which we don't have.

### Files (`data/stations/`)

| File | What it is |
|---|---|
| `csv/<station_id>.csv` | Aeros input format: header `YEAR,D-J-F,J-J-A`, °C, 2 decimals, missing = empty cell. Years run from the first valid season at or after 1940 to the latest one. |
| `stations.json` | Array of station metadata objects (coordinates, elevation, brightness index, urban/rural class, pair, hemisphere and `local_season` map, coverage counts, source, retrieval date). |
| `stations_bundle.json` | One compact file for the web app: shared provenance plus metadata and series for every station (`years`, `D-J-F`, `J-J-A` arrays, `null` = missing). About 86 KB (21 KB gzipped). |
| `solaris_sample_stations.zip` | Download bundle: all CSVs, `stations.json`, README, template, formatting guide. |
| `aeros_input_template.csv`, `HOW_TO_FORMAT_YOUR_DATA.md` | Helpers for users who bring their own data. |
| `sanity_report.json` | Group-mean trend check and the list of dropped candidates. |
| `raw/` | Cached downloads. The large GHCN archive and the extracted files are git-ignored. |

Rebuild with `.venv/bin/python data/scripts/build_stations.py` (add `--refresh` to re-download).
The script uses only the standard library and numpy, and it reuses the cache, so a rerun makes no network
requests.

### Source and route

- **Monthly temperatures**: NOAA NCEI **GHCN-M v4 TAVG, adjusted (`qcf`)**,
  `https://www.ncei.noaa.gov/pub/data/ghcn/v4/ghcnm.tavg.latest.qcf.tar.gz`.
  The file used is `ghcnm.tavg.v4.0.1.20261117.qcf.dat`, retrieved on 2026-11-18. This adjusted GHCN-M v4
  data is the station input that NASA GISS GISTEMP v4 ingests.
- **Station inventory and night-light brightness index (BI)**: NASA GISS GISTEMP v4,
  `https://data.giss.nasa.gov/gistemp/station_data_v4_globe/v4.temperature.inv.txt`, retrieved 2026-11-18.
- **Why not the GISS per-station `station.csv`**: the intended route was
  `stdata_show_v4.cgi?id=<ID>&ds=14&dt=1` followed by the generated `station.csv`. During the build,
  `data.giss.nasa.gov` returned 404 for the CGI request and then refused all connections, as did
  `www.giss.nasa.gov`. So the documented fallback was used, and **all final data comes from the
  NCEI GHCN-M v4 bulk file** through one consistent route. We could not confirm the exact meaning of
  GISS `ds=14` from the NASA pages because they were unreachable. As a result, GISS's own extra
  cleaning and urban homogenization step is **not** applied, and values can differ from the series
  shown on GISS station pages, typically by a few tenths of a °C in places. For example, Rajkot D-J-F
  here differs from the `reference/golden/rajkot-djf.json` fixture by about +0.2 to +0.5 °C in
  some years. Parity tests should keep using the golden fixture's own embedded series.
- **Seasonal means** are computed by the script:
  - D-J-F of year Y = mean(December Y−1, January Y, February Y). This is the NASA GISS convention.
  - J-J-A of year Y = mean(June, July, August of Y).
  - A season needs all 3 monthly values present, each with a blank GHCN QC flag. No gaps are filled
    and nothing is interpolated.
  - The latest seasons (2026) come from the GHCN "latest" release and may still be revised by NOAA.

### Selection rules

- Coverage per station, counting from 1940 to the latest year: at least 60 valid values per season,
  at least 20 per season in 1940–1979 and at least 30 per season in 1980–latest. One exception is
  Rajkot (IN005150100), the Aeros golden-fixture station, whose GHCN record only starts in 1978. Its
  exemption is recorded in `coverage_note`.
- United States: 13 city/rural pairs across the Northeast, Mid-Atlantic (including **Washington, D.C.,
  Reagan National, USW00013743**), Southeast, Midwest, South-Central, Mountain, Southwest, Pacific
  Northwest and California. For each city, the partner is the nearest BI ≤ 10 record meeting the
  coverage rule, preferring similar elevation. Pair distances run from 44 to 150 km.
- Argentina: 6 city/rural pairs plus 2 unpaired city stations (Mendoza, Posadas). Argentine rural
  records with good 1940–1979 coverage are scarce. Gualeguaychú, San Juan and Reconquista were
  rejected because each has fewer than 20 seasonal values in 1940–1979. As a result, Argentine pair
  distances are 197–345 km, which is far looser than the U.S. pairs.
- World (`set: "world"`): Rajkot, Dublin, Tokyo, Sydney and Cape Town. Nairobi (Dagoretti) was a
  candidate but failed the coverage rule and was dropped.
- Pairing was chosen for geography and data coverage before any trends were computed. The list was
  **not** tuned to match the poster.

### Urban/rural classification

The classifier is reproducible from the GISS inventory alone. It uses the GISS night-light
**brightness index (BI)** classes from Hansen et al. (2010):

- `rural`: BI ≤ 10
- `periurban`: 11 ≤ BI ≤ 35
- `urban`: BI ≥ 36

Each station's BI and the rule are stored under `classifier` in `stations.json`, alongside a
convenience boolean `is_rural`. The inventory has no population class, so none is used. By
this rule several Argentine city stations (Rosario, Córdoba Aero, Mendoza Aero) are peri-urban,
and Salta Aero (BI 10) is rural. We report the classes as the rule gives them.

### Hemisphere

For Southern Hemisphere stations, D-J-F is local **summer** and J-J-A is local **winter**. Every
station carries a `local_season` map, for example `{"D-J-F": "summer", "J-J-A": "winter"}`, so the UI
can label seasons the way the poster did after adjusting seasonal alignment for the Southern
Hemisphere.

### Known limitations

- These are the GHCN-M v4 *adjusted* series (NOAA pairwise homogenization), not GISS's homogenized
  per-station product. Station moves and instrument changes are handled only as far as NOAA's
  adjustment handles them.
- The adjustment itself can change trends. Comparisons between urban and rural stations are
  therefore indicative, not a clean measurement of urban heat island.
- Pairing is approximate. Some pairs differ a lot in elevation (e.g. Los Angeles LAX vs Fairmont,
  about 900 m; Las Vegas vs Desert NWR, about 240 m), and the Argentine pairs are 200–345 km apart.
- Night-light brightness reflects the present day, not 1940 conditions, and describes the area
  around the station, not the station's exact siting.
- Several airport records start in the late 1940s or early 1950s, so their 1940–1979 trends rest
  on 25–35 years.
- This is **not the poster's dataset**, so trend numbers will not match the poster exactly.

### Citation

- GISTEMP Team (2026): GISS Surface Temperature Analysis (GISTEMP), version 4. NASA Goddard
  Institute for Space Studies. https://data.giss.nasa.gov/gistemp/ (station inventory and BI)
- Lenssen, N., G. Schmidt, J. Hansen, M. Menne, A. Persin, R. Ruedy, and D. Zyss (2019):
  Improvements in the GISTEMP uncertainty model. *J. Geophys. Res. Atmos.*, 124, 6307–6326.
- Lenssen, N., G. A. Schmidt, M. Hendrickson, P. Jacobs, M. Menne, and R. Ruedy (2024): A NASA
  GISTEMPv4 observational uncertainty ensemble. *J. Geophys. Res. Atmos.*, 129, e2023JD040179.
- Menne, M. J., C. N. Williams, B. E. Gleason, J. J. Rennie, and J. H. Lawrimore (2018): The Global
  Historical Climatology Network Monthly Temperature Dataset, Version 4. *J. Climate*, 31, 9835–9854.
- Hansen, J., R. Ruedy, M. Sato, and K. Lo (2010): Global surface temperature change. *Rev.
  Geophys.*, 48, RG4004. (Brightness-index urban/rural classes)
