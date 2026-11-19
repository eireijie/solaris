"""Precompute model results for every bundled station so the site can show them instantly.

Run from the repo root:  .venv/bin/python data/scripts/precompute.py
Results use each model's default options, so a live in-browser run reproduces them.
"""
import json, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "models"))
from solaris_models import api  # noqa: E402

OUT = ROOT / "data" / "precomputed"


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), allow_nan=False))


def main() -> None:
    stations = json.loads((ROOT / "data/stations/stations_bundle.json").read_text())
    co2 = json.loads((ROOT / "data/co2/co2_bundle.json").read_text())
    index = {"generated": time.strftime("%Y-%m-%d"), "aeros": [], "nexus": [], "failed": []}

    for st in stations["stations"]:
        for model in ("aeros", "nexus"):
            res = api.dispatch(model, st)
            if not res.get("ok", True):
                index["failed"].append({"model": model, "id": st["id"], "warnings": res.get("warnings")})
                continue
            dump(OUT / model / f"{st['id']}.json", res)
            index[model].append(st["id"])
        print("done", st["id"], flush=True)

    americas = [s for s in stations["stations"] if s["set"] == "americas"]
    dump(OUT / "nexus" / "station_set_americas.json",
         api.dispatch("nexus", {"stations": americas, "options": {"group_by": ["country", "urban_rural"]}}))

    core = api.dispatch("core", {"historical_co2": co2["historical_co2"]})
    dump(OUT / "core" / "default.json", core)
    pathway = {"years": core["projection"]["years"], "ppm": core["projection"]["ppm_mean"]}

    dump(OUT / "catalyst" / "validation.json", api.dispatch("catalyst", {"data": co2, "mode": "validation"}))
    for ssp in ("ssp119", "ssp126", "ssp245", "ssp370", "ssp585"):
        dump(OUT / "catalyst" / f"concentration_{ssp}.json", api.dispatch("catalyst", {
            "data": co2, "mode": "concentration", "baseline": {"type": "core"},
            "scenario": {"type": "ssp", "scenario": ssp}, "core_pathway": pathway,
            "temperature_model": "two_layer"}))
    dump(OUT / "index.json", index)
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in index.items()}))


if __name__ == "__main__":
    main()
