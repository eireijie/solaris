# How to format your data for Aeros

Aeros reads a plain CSV with one row per year and two seasonal columns:

```
YEAR,D-J-F,J-J-A
1940,1.93,24.87
1941,,25.10
1942,0.47,
```

- `YEAR`: four-digit year.
- `D-J-F`: mean surface air temperature (°C) for December–January–February. NASA GISS
  convention: the D-J-F value for year Y uses **December of Y−1** plus January and February of Y.
- `J-J-A`: mean surface air temperature (°C) for June–July–August of year Y.
- Missing values: leave the cell **empty**. (NASA's `999.9` missing marker is also recognised
  and treated as missing.) Do not fill gaps yourself.
- Units: degrees Celsius.
- Aliases accepted by Aeros: `Year`/`year`, `DJF`, `JJA`. Extra columns (e.g. monthly values or
  `J-D`) are ignored.
- One season column is enough; Aeros will run whichever seasons are present.
- Southern Hemisphere: keep the calendar labels. D-J-F is local *summer* and J-J-A local
  *winter* there; the site labels them accordingly.

Recommended: at least ~60 valid years per season, with data both before and after 1980, so the
1940–1979 vs 1980–present comparison is meaningful.

Where to get station data: NASA GISS GISTEMP v4 station pages
(https://data.giss.nasa.gov/gistemp/station_data_v4_globe/) let you download a `station.csv`
that already contains `YEAR`, `D-J-F` and `J-J-A` columns in this format.

A blank template is included as `aeros_input_template.csv`.
