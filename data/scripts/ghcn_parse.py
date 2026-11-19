"""Helpers for parsing GHCN-M v4 monthly TAVG files and the GISS v4 station inventory.

Used by build_stations.py. Stdlib + numpy only.
"""
from __future__ import annotations

import numpy as np

MISSING_RAW = -9999


def parse_giss_inventory(path):
    """Parse GISS v4.temperature.inv.txt -> {id: {lat, lon, elev, name, bi}}.

    Columns: ID, Lat, Lon, Elev-m, Station Name, BI (night-light brightness index).
    """
    out = {}
    with open(path, encoding="latin-1") as fh:
        next(fh)  # header line
        for line in fh:
            parts = line.split()
            if len(parts) < 5:
                continue
            sid = parts[0]
            lat, lon, elev = float(parts[1]), float(parts[2]), float(parts[3])
            try:
                bi = int(parts[-1])
                name = " ".join(parts[4:-1])
            except ValueError:
                bi = None
                name = " ".join(parts[4:])
            out[sid] = {"lat": lat, "lon": lon, "elev": elev, "name": name, "bi": bi}
    return out


def parse_ghcn_dat(path, wanted):
    """Parse a GHCN-M v4 .dat file -> {id: {year: np.array(12) degC, NaN = missing}}.

    Record layout (GHCN-M v4 readme): ID 1-11, YEAR 12-15, ELEMENT 16-19, then for each
    month VALUE (5 chars, hundredths of degC, -9999 missing), DMFLAG, QCFLAG, DSFLAG.
    Values with a non-blank QC flag are treated as missing (conservative).
    """
    data = {}
    with open(path, encoding="latin-1") as fh:
        for line in fh:
            sid = line[0:11]
            if sid not in wanted:
                continue
            year = int(line[11:15])
            vals = np.full(12, np.nan)
            for m in range(12):
                off = 19 + m * 8
                raw = int(line[off:off + 5])
                qc = line[off + 6:off + 7]
                if raw != MISSING_RAW and qc.strip() == "":
                    vals[m] = raw / 100.0
            data.setdefault(sid, {})[year] = vals
    return data


def seasonal(monthly):
    """{year: array(12)} -> (years, djf, jja) numpy arrays (NaN = missing).

    D-J-F for year Y = mean(Dec of Y-1, Jan Y, Feb Y)  (NASA GISS convention).
    J-J-A for year Y = mean(Jun Y, Jul Y, Aug Y).
    A seasonal value requires all three monthly values; no gap filling.
    """
    if not monthly:
        return np.array([], int), np.array([]), np.array([])
    years = np.arange(min(monthly), max(monthly) + 1)
    djf = np.full(len(years), np.nan)
    jja = np.full(len(years), np.nan)
    for i, y in enumerate(years):
        cur, prev = monthly.get(y), monthly.get(y - 1)
        if cur is not None and prev is not None:
            v = np.array([prev[11], cur[0], cur[1]])
            if not np.isnan(v).any():
                djf[i] = float(v.mean())
        if cur is not None:
            v = cur[5:8]
            if not np.isnan(v).any():
                jja[i] = float(v.mean())
    return years, djf, jja
