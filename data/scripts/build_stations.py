#!/usr/bin/env python3
"""Build the "Solaris sample station set": seasonal (D-J-F / J-J-A) surface-air-temperature
series for ~46 stations, in the exact Aeros input format, with provenance metadata.

Run:
    .venv/bin/python data/scripts/build_stations.py            # uses cache in data/stations/raw/
    .venv/bin/python data/scripts/build_stations.py --refresh  # re-download source files

Data route (see data/README.md, "Stations"):
  * Station inventory + night-light brightness (BI): NASA GISS GISTEMP v4
    https://data.giss.nasa.gov/gistemp/station_data_v4_globe/v4.temperature.inv.txt
  * Monthly mean temperatures: NOAA NCEI GHCN-M v4 TAVG, adjusted ("qcf") bulk file
    https://www.ncei.noaa.gov/pub/data/ghcn/v4/ghcnm.tavg.latest.qcf.tar.gz
    This is the adjusted GHCN-M v4 input that GISTEMP v4 itself ingests. It is NOT the GISS
    per-station "homogenized" product (GISS's own urban adjustment is not applied here).
    The GISS per-station station.csv endpoint (stdata_show_v4.cgi) was unreachable
    (connection refused) at build time, so seasonal means are computed here:
      - D-J-F of year Y = mean(Dec Y-1, Jan Y, Feb Y)   (same convention as NASA GISS)
      - J-J-A of year Y = mean(Jun, Jul, Aug of Y)
      - a season requires all 3 months present and QC-flag blank; no gap filling.

Stdlib + numpy only. Writes only under data/stations/.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ghcn_parse import parse_ghcn_dat, parse_giss_inventory, seasonal  # noqa: E402

DATA = Path(__file__).resolve().parents[1]
OUT = DATA / "stations"
RAW = OUT / "raw"
CSV_DIR = OUT / "csv"

UA = "SolarisClimateResearch/1.0 (educational)"
INV_URL = "https://data.giss.nasa.gov/gistemp/station_data_v4_globe/v4.temperature.inv.txt"
GHCN_URL = "https://www.ncei.noaa.gov/pub/data/ghcn/v4/ghcnm.tavg.latest.qcf.tar.gz"
GISS_STATION_PAGE = "https://data.giss.nasa.gov/cgi-bin/gistemp/stdata_show_v4.cgi?id={id}&ds=14&dt=1"
DATASET_LABEL = ("GHCN-M v4 TAVG adjusted (qcf), NOAA NCEI; seasonal means computed by Solaris "
                 "build script; station metadata + brightness index from NASA GISS GISTEMP v4 inventory")
SET_LABEL = "Solaris sample station set"

START_YEAR = 1940          # series are trimmed to start here (Aeros / poster analysis window)
MIN_VALID = 60             # min valid seasonal values per season, START_YEAR..latest
MIN_EARLY = 20             # min valid values per season in 1940-1979
MIN_LATE = 30              # min valid values per season in 1980-latest

# GISS brightness-index classes (Hansen et al. 2010, Rev. Geophys., GISTEMP):
#   BI <= 10 rural, 11-35 peri-urban, > 35 urban.
BI_RURAL_MAX = 10
BI_URBAN_MIN = 36

# ---------------------------------------------------------------------------------------
# Station selection. Pairs = (city station, rural partner). Selection made by
# data/scripts scouting: urban = BI>35 where available (Argentina: city stations are often
# peri-urban by BI), rural = BI<=10, partner = nearby rural record meeting coverage rules.
# ---------------------------------------------------------------------------------------
US_PAIRS = [
    # pair_id, region, (city_id, display), (rural_id, display)
    ("US-NE-BOS", "Northeast", ("USW00014739", "Boston, MA (Logan Intl)"), ("USC00196938", "Rochester, MA")),
    ("US-MA-DCA", "Mid-Atlantic", ("USW00013743", "Washington, D.C. (Reagan National)"), ("USC00187806", "Royal Oak, MD")),
    ("US-MA-PHL", "Mid-Atlantic", ("USW00013739", "Philadelphia, PA (Intl)"), ("USW00013735", "Millville, NJ")),
    ("US-SE-ATL", "Southeast", ("USW00013874", "Atlanta, GA (Hartsfield)"), ("USC00018469", "Valley Head, AL")),
    ("US-SE-BNA", "Southeast", ("USW00013897", "Nashville, TN (Intl)"), ("USC00405187", "Lewisburg, TN (Exp. Stn)")),
    ("US-MW-ORD", "Midwest", ("USW00094846", "Chicago, IL (O'Hare)"), ("USC00116526", "Ottawa, IL")),
    ("US-MW-MSP", "Midwest", ("USW00014922", "Minneapolis-St. Paul, MN"), ("USC00213290", "Grand Meadow, MN")),
    ("US-SC-DAL", "South-Central", ("USW00013960", "Dallas, TX (Love Field)"), ("USC00413420", "Gainesville, TX")),
    ("US-SC-IAH", "South-Central", ("USW00012960", "Houston, TX (Intercontinental)"), ("USC00412266", "Danevang, TX")),
    ("US-MT-DEN", "Mountain", ("USW00023062", "Denver, CO (Stapleton)"), ("USC00058839", "Waterdale, CO")),
    ("US-SW-LAS", "Southwest", ("USW00023169", "Las Vegas, NV (McCarran)"), ("USC00262243", "Desert NWR, NV")),
    ("US-PNW-PDX", "Pacific Northwest", ("USW00024229", "Portland, OR (Intl)"), ("USC00350897", "Bonneville Dam, OR")),
    ("US-CA-LAX", "California", ("USW00023174", "Los Angeles, CA (LAX)"), ("USC00042941", "Fairmont, CA")),
]

AR_PAIRS = [
    ("AR-BA", "Buenos Aires / Pampas", ("AR000875850", "Buenos Aires (Observatorio)"), ("ARM00087648", "Dolores")),
    ("AR-COR", "Córdoba", ("AR000087344", "Córdoba (Aero)"), ("ARM00087453", "Río Cuarto")),
    # Gualeguaychú (closer to Rosario) has only 16 D-J-F values in 1940-1979 -> Pehuajó used.
    ("AR-ROS", "Pampas / Litoral", ("ARM00087480", "Rosario"), ("AR000875440", "Pehuajó")),
    # Reconquista (closer) has only 17 values in 1940-1979 -> Paso de los Libres used.
    ("AR-NEA", "Northeast", ("AR000087155", "Resistencia"), ("ARM00087289", "Paso de los Libres")),
    ("AR-NOA", "Northwest", ("AR000087129", "Santiago del Estero"), ("AR000870470", "Salta (Aero)")),
    ("AR-PAT", "Patagonia", ("AR000087860", "Comodoro Rivadavia"), ("AR000087828", "Trelew")),
]

# City stations kept without a rural partner (no rural record nearby meets the coverage rule;
# e.g. San Juan / San Rafael for Mendoza have < 20 seasonal values in 1940-1979).
AR_UNPAIRED = [
    ("Cuyo", "AR000087418", "Mendoza (Aero)"),
    ("Northeast", "ARM00087178", "Posadas"),
]

WORLD = [
    # id, display, country, region, exempt_from_coverage_rule(reason or None)
    ("IN005150100", "Rajkot, India", "India", "South Asia",
     "Golden-fixture station for Aeros parity tests; GHCN record only starts 1979."),
    ("EI000003969", "Dublin, Ireland (Phoenix Park)", "Ireland", "Europe", None),
    ("JA000047662", "Tokyo, Japan", "Japan", "East Asia", None),
    ("ASN00066062", "Sydney, Australia (Observatory Hill)", "Australia", "Oceania", None),
    ("KEM00063741", "Nairobi, Kenya (Dagoretti)", "Kenya", "East Africa", None),
    ("SFM00068816", "Cape Town, South Africa (Intl)", "South Africa", "Southern Africa", None),
]

COUNTRY = {"US": "United States", "AR": "Argentina"}


def fetch(url, dest, refresh=False, delay=1.5):
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 0 and not refresh:
        return dest
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    print(f"  downloading {url}")
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as fh:
        fh.write(r.read())
    time.sleep(delay)
    return dest


def km(a, b):
    p = math.radians
    dlat, dlon = p(b["lat"] - a["lat"]), p(b["lon"] - a["lon"])
    h = math.sin(dlat / 2) ** 2 + math.cos(p(a["lat"])) * math.cos(p(b["lat"])) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def bi_class(bi):
    if bi is None:
        return "unknown"
    if bi <= BI_RURAL_MAX:
        return "rural"
    if bi >= BI_URBAN_MIN:
        return "urban"
    return "periurban"


def ols_slope_per_decade(years, vals, lo, hi, min_n=20):
    m = (years >= lo) & (years <= hi) & ~np.isnan(vals)
    if m.sum() < min_n:
        return None
    return float(np.polyfit(years[m], vals[m], 1)[0] * 10.0)


def fmt(v):
    return "" if v is None or (isinstance(v, float) and math.isnan(v)) else f"{v:.2f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download source files")
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    CSV_DIR.mkdir(parents=True, exist_ok=True)

    print("1. Source files")
    inv_path = fetch(INV_URL, RAW / "v4.temperature.inv.txt", args.refresh)
    tar_path = fetch(GHCN_URL, RAW / "ghcnm.tavg.latest.qcf.tar.gz", args.refresh)
    with tarfile.open(tar_path) as tf:
        members = [m for m in tf.getmembers() if m.name.endswith(".qcf.dat")]
        dat_member = members[0]
        dat_path = RAW / "ncei" / dat_member.name
        if not dat_path.exists() or args.refresh:
            tf.extractall(RAW / "ncei", members=[m for m in tf.getmembers()
                                                  if m.name.endswith((".dat", ".inv"))])
    ghcn_version = Path(dat_member.name).name.replace(".qcf.dat", "")  # e.g. ghcnm.tavg.v4.0.1.20261117
    # retrieval date = cached file mtime (reproducible on reruns)
    retrieved = dt.date.fromtimestamp(tar_path.stat().st_mtime).isoformat()
    inv_retrieved = dt.date.fromtimestamp(inv_path.stat().st_mtime).isoformat()

    inv = parse_giss_inventory(inv_path)

    # Assemble candidate list -------------------------------------------------------------
    cands = []
    for group, pairs in (("US", US_PAIRS), ("AR", AR_PAIRS)):
        for pair_id, region, city, rural in pairs:
            for (sid, disp), role in ((city, "city"), (rural, "rural_partner")):
                cands.append(dict(id=sid, display_name=disp, country=COUNTRY[group], region=region,
                                  pair_id=pair_id, pair_role=role, set="americas", exempt=None))
    for region, sid, disp in AR_UNPAIRED:
        cands.append(dict(id=sid, display_name=disp, country="Argentina", region=region,
                          pair_id=None, pair_role="unpaired", set="americas", exempt=None))
    for sid, disp, country, region, exempt in WORLD:
        cands.append(dict(id=sid, display_name=disp, country=country, region=region,
                          pair_id=None, pair_role=None, set="world", exempt=exempt))

    print("2. Parsing GHCN-M v4 monthly data for", len(cands), "candidate stations")
    monthly = parse_ghcn_dat(dat_path, {c["id"] for c in cands})

    stations, series, dropped = [], {}, []
    for c in cands:
        sid = c["id"]
        meta = inv.get(sid)
        if meta is None or sid not in monthly:
            dropped.append((sid, c["display_name"], "not found in inventory / GHCN file"))
            continue
        years, djf, jja = seasonal(monthly[sid])
        keep = years >= START_YEAR
        years, djf, jja = years[keep], djf[keep], jja[keep]
        valid = ~np.isnan(djf) | ~np.isnan(jja)
        if not valid.any():
            dropped.append((sid, c["display_name"], "no valid seasons since 1940"))
            continue
        first, last = int(years[valid].min()), int(years[valid].max())
        sel = (years >= first) & (years <= last)
        years, djf, jja = years[sel], djf[sel], jja[sel]

        def cnt(a, lo, hi):
            return int(np.sum(~np.isnan(a[(years >= lo) & (years <= hi)])))
        counts = {
            "D-J-F": cnt(djf, 0, 9999), "J-J-A": cnt(jja, 0, 9999),
            "D-J-F_1940_1979": cnt(djf, 1940, 1979), "J-J-A_1940_1979": cnt(jja, 1940, 1979),
            "D-J-F_1980_latest": cnt(djf, 1980, 9999), "J-J-A_1980_latest": cnt(jja, 1980, 9999),
        }
        ok = (min(counts["D-J-F"], counts["J-J-A"]) >= MIN_VALID
              and min(counts["D-J-F_1940_1979"], counts["J-J-A_1940_1979"]) >= MIN_EARLY
              and min(counts["D-J-F_1980_latest"], counts["J-J-A_1980_latest"]) >= MIN_LATE)
        if not ok and not c["exempt"]:
            dropped.append((sid, c["display_name"], f"coverage below rule: {counts}"))
            continue

        south = meta["lat"] < 0
        bi = meta["bi"]
        cls = bi_class(bi)
        st = {
            "id": sid,
            "name": meta["name"],
            "display_name": c["display_name"],
            "country": c["country"],
            "region": c["region"],
            "lat": meta["lat"],
            "lon": meta["lon"],
            "elevation_m": meta["elev"],
            "urban_rural": cls,
            "is_rural": cls == "rural",
            "classifier": {
                "method": "GISS night-light brightness index (BI) from GISTEMP v4 station inventory",
                "brightness_index": bi,
                "rule": f"rural if BI<={BI_RURAL_MAX}; periurban if {BI_RURAL_MAX + 1}<=BI<={BI_URBAN_MIN - 1}; "
                        f"urban if BI>={BI_URBAN_MIN} (Hansen et al. 2010 GISTEMP classes)",
            },
            "pair_id": c["pair_id"],
            "pair_role": c["pair_role"],
            "pair_partner_id": None,
            "pair_distance_km": None,
            "set": c["set"],
            "hemisphere": "southern" if south else "northern",
            "local_season": ({"D-J-F": "summer", "J-J-A": "winter"} if south
                             else {"D-J-F": "winter", "J-J-A": "summer"}),
            "first_year": first,
            "last_year": last,
            "valid_counts": counts,
            "meets_coverage_rule": ok,
            "coverage_note": c["exempt"],
            "csv_path": f"csv/{sid}.csv",
            "source_url": GHCN_URL,
            "source_file": ghcn_version + ".qcf.dat",
            "inventory_url": INV_URL,
            "giss_station_page": GISS_STATION_PAGE.format(id=sid),
            "retrieved": retrieved,
            "inventory_retrieved": inv_retrieved,
            "dataset": DATASET_LABEL,
            "station_set": SET_LABEL,
        }
        stations.append(st)
        series[sid] = (years, djf, jja)

    # Pair bookkeeping (drop a pair member whose partner was dropped -> keep but unpaired)
    by_pair = {}
    for s in stations:
        if s["pair_id"]:
            by_pair.setdefault(s["pair_id"], []).append(s)
    for pid, mem in by_pair.items():
        if len(mem) == 2:
            a, b = mem
            d = round(km(a, b), 1)
            a["pair_partner_id"], b["pair_partner_id"] = b["id"], a["id"]
            a["pair_distance_km"] = b["pair_distance_km"] = d
        else:
            for s in mem:
                s["pair_role"] = "unpaired (partner dropped)"

    # 3. Write CSVs ----------------------------------------------------------------------
    print("3. Writing", len(stations), "station CSVs")
    for old in CSV_DIR.glob("*.csv"):
        old.unlink()
    for s in stations:
        years, djf, jja = series[s["id"]]
        lines = ["YEAR,D-J-F,J-J-A"]
        for y, a, b in zip(years, djf, jja):
            lines.append(f"{int(y)},{fmt(a)},{fmt(b)}")
        (CSV_DIR / f"{s['id']}.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")

    (OUT / "stations.json").write_text(json.dumps(stations, indent=2, ensure_ascii=False) + "\n",
                                       encoding="utf-8")

    # 4. Bundle --------------------------------------------------------------------------
    def r2(v):
        return None if math.isnan(v) else round(float(v), 2)
    bundle = {
        "schema": "solaris.stations_bundle/1",
        "station_set": SET_LABEL,
        "generated": dt.date.today().isoformat(),
        "dataset": DATASET_LABEL,
        "source_url": GHCN_URL,
        "inventory_url": INV_URL,
        "source_file": ghcn_version + ".qcf.dat",
        "units": "degC",
        "season_convention": "D-J-F of year Y = Dec(Y-1)+Jan(Y)+Feb(Y); J-J-A = Jun-Aug of Y; "
                             "all 3 months required; no gap filling",
        "note": "Our own comparable sample set, not the research poster's 40-station list.",
        "stations": [],
    }
    for s in stations:
        years, djf, jja = series[s["id"]]
        meta = {k: s[k] for k in ("id", "name", "display_name", "country", "region", "lat", "lon",
                                  "elevation_m", "urban_rural", "pair_id", "pair_role",
                                  "pair_partner_id", "pair_distance_km", "set", "hemisphere",
                                  "local_season", "first_year", "last_year", "coverage_note")}
        meta["brightness_index"] = s["classifier"]["brightness_index"]
        meta["valid_counts"] = {"D-J-F": s["valid_counts"]["D-J-F"], "J-J-A": s["valid_counts"]["J-J-A"]}
        meta["series"] = {"years": [int(y) for y in years],
                          "D-J-F": [r2(v) for v in djf], "J-J-A": [r2(v) for v in jja]}
        bundle["stations"].append(meta)
    (OUT / "stations_bundle.json").write_text(
        json.dumps(bundle, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    # 5. Templates + zip -----------------------------------------------------------------
    (OUT / "aeros_input_template.csv").write_text("YEAR,D-J-F,J-J-A\n", encoding="utf-8")
    zip_path = OUT / "solaris_sample_stations.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for s in stations:
            zf.write(CSV_DIR / f"{s['id']}.csv", f"solaris_sample_stations/csv/{s['id']}.csv")
        zf.write(OUT / "stations.json", "solaris_sample_stations/stations.json")
        zf.write(OUT / "aeros_input_template.csv", "solaris_sample_stations/aeros_input_template.csv")
        zf.write(OUT / "HOW_TO_FORMAT_YOUR_DATA.md", "solaris_sample_stations/HOW_TO_FORMAT_YOUR_DATA.md")
        zf.write(OUT / "ZIP_README.md", "solaris_sample_stations/README.md")

    # 6. Sanity report -------------------------------------------------------------------
    report = sanity(stations, series)
    report["dropped"] = [{"id": a, "display_name": b, "reason": c} for a, b, c in dropped]
    (OUT / "sanity_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n",
                                            encoding="utf-8")
    print_report(stations, report)


def sanity(stations, series):
    groups = {}
    for s in stations:
        if s["set"] != "americas":
            continue
        keys = ["Americas (all)", s["country"], f"{s['country']} / {s['urban_rural']}",
                f"{s['country']} / {'rural' if s['is_rural'] else 'non-rural (urban+periurban)'}"]
        for k in dict.fromkeys(keys):
            groups.setdefault(k, []).append(s)
    out = {"method": "per-station OLS slope (degC/decade), windows 1940-1979 and 1980-latest, "
                     "min 20 valid years per window; group = simple mean across stations",
           "groups": {}}
    for g, mem in groups.items():
        row = {"n": len(mem)}
        for season in ("D-J-F", "J-J-A", "local_winter", "local_summer"):
            e, l, d = [], [], []
            for s in mem:
                years, djf, jja = series[s["id"]]
                if season in ("D-J-F", "J-J-A"):
                    key = season
                else:  # hemisphere-adjusted, as on the poster
                    want = season.split("_")[1]
                    key = "D-J-F" if s["local_season"]["D-J-F"] == want else "J-J-A"
                v = djf if key == "D-J-F" else jja
                a = ols_slope_per_decade(years, v, 1940, 1979)
                b = ols_slope_per_decade(years, v, 1980, 9999)
                if a is not None:
                    e.append(a)
                if b is not None:
                    l.append(b)
                if a is not None and b is not None:
                    d.append(b - a)
            row[season] = {
                "trend_1940_1979": round(float(np.mean(e)), 3) if e else None,
                "trend_1980_latest": round(float(np.mean(l)), 3) if l else None,
                "mean_change": round(float(np.mean(d)), 3) if d else None,
                "n_increase": int(sum(x > 0 for x in d)), "n_with_both": len(d),
            }
        out["groups"][g] = row
    return out


def print_report(stations, report):
    from collections import Counter
    print("\nStations:", len(stations))
    print(Counter((s["set"], s["country"], s["urban_rural"]) for s in stations))
    for g, r in report["groups"].items():
        print(g, r)
    for d in report["dropped"]:
        print("DROPPED", d)


if __name__ == "__main__":
    main()
