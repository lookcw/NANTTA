"""Download MTA Stations.csv and write trains/data/stations.json.

Run manually whenever you want to refresh the baked-in fallback:

    .venv/bin/python scripts/refresh_stations.py

The running app *also* refreshes this in memory hourly (see trains/stations.py);
this script is for updating the on-disk fallback that ships with the repo.
"""

from __future__ import annotations

import csv
import io
import json
import sys
from collections import Counter
from pathlib import Path

import requests

STATIONS_CSV_URL = "http://web.mta.info/developers/data/nyct/subway/Stations.csv"

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "trains" / "data" / "stations.json"

BOROUGH_NAMES = {
    "M": "Manhattan",
    "Bk": "Brooklyn",
    "Bx": "Bronx",
    "Q": "Queens",
    "SI": "Staten Island",
}


def fetch_csv() -> str:
    resp = requests.get(STATIONS_CSV_URL, timeout=30)
    resp.raise_for_status()
    return resp.text


def parse(text: str) -> dict:
    """Return ``{stops, complexes, stop_to_complex}`` ready to JSON-serialize.

    - ``stops``: keyed by GTFS stop_id; per-platform metadata + complex_id.
    - ``complexes``: keyed by MTA Complex ID; merged station-level view.
    - ``stop_to_complex``: fast stop_id -> complex_id lookup.
    """
    reader = csv.DictReader(io.StringIO(text))

    stops: dict[str, dict] = {}
    members: dict[str, list[dict]] = {}  # complex_id -> [stop record]

    for row in reader:
        stop_id = (row.get("GTFS Stop ID") or "").strip()
        if not stop_id:
            continue
        complex_id = (row.get("Complex ID") or "").strip()
        if not complex_id:
            continue
        borough_code = (row.get("Borough") or "").strip()
        borough = BOROUGH_NAMES.get(borough_code, borough_code)
        name = (row.get("Stop Name") or "").strip()
        lines = [r for r in (row.get("Daytime Routes") or "").split() if r]
        rec = {
            "name": name,
            "borough": borough,
            "borough_code": borough_code,
            "lines": lines,
            "north_label": (row.get("North Direction Label") or "").strip() or None,
            "south_label": (row.get("South Direction Label") or "").strip() or None,
            "lat": float(row["GTFS Latitude"]) if row.get("GTFS Latitude") else None,
            "lon": float(row["GTFS Longitude"]) if row.get("GTFS Longitude") else None,
            "complex_id": complex_id,
        }
        stops[stop_id] = rec
        members.setdefault(complex_id, []).append({"stop_id": stop_id, **rec})

    complexes: dict[str, dict] = {}
    for cid, member_list in members.items():
        # Display name: most common Stop Name across members (Times Sq has
        # 4× "Times Sq-42 St" + 1× "42 St-Port Authority Bus Terminal" — the
        # mode is what people actually call it). Tie-break to longest, then
        # alphabetical, so Court Sq + Court Sq + Court Sq-23 St picks the
        # more-descriptive "Court Sq" by mode.
        name_counts = Counter(m["name"] for m in member_list if m["name"])
        if name_counts:
            top_count = name_counts.most_common(1)[0][1]
            top_names = [n for n, c in name_counts.items() if c == top_count]
            display_name = sorted(top_names, key=lambda s: (-len(s), s))[0]
        else:
            display_name = ""

        # Borough: most common across members; tie-break alphabetical.
        borough_counts = Counter(m["borough"] for m in member_list if m["borough"])
        if borough_counts:
            top = borough_counts.most_common()
            top_count = top[0][1]
            top_boroughs = sorted(b for b, c in top if c == top_count)
            borough = top_boroughs[0]
        else:
            borough = ""

        # Lines: sorted union across members.
        all_lines = set()
        for m in member_list:
            all_lines.update(m["lines"])
        lines_sorted = sorted(all_lines, key=_line_sort_key)

        stop_ids_sorted = sorted(m["stop_id"] for m in member_list)

        complexes[cid] = {
            "id": cid,
            "name": display_name,
            "borough": borough,
            "lines": lines_sorted,
            "stop_ids": stop_ids_sorted,
        }

    stop_to_complex = {sid: rec["complex_id"] for sid, rec in stops.items()}

    return {
        "stops": stops,
        "complexes": complexes,
        "stop_to_complex": stop_to_complex,
    }


def _line_sort_key(line: str):
    """Sort lines so digits come before letters and naturally (1,2,...,7) then A,B,...."""
    return (0, int(line)) if line.isdigit() else (1, line)


def main() -> int:
    print(f"fetching {STATIONS_CSV_URL}")
    text = fetch_csv()
    data = parse(text)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    n_stops = len(data["stops"])
    n_complexes = len(data["complexes"])
    print(f"wrote {n_stops} stops in {n_complexes} complexes to {OUT_PATH.relative_to(REPO_ROOT)}")

    # Quick sanity assertions on known complexes.
    expected = {
        "606": {"719", "F09", "G22"},               # Court Sq
        "611": {"127", "R16", "725", "902"},        # Times Sq
        "617": {"235", "D24", "R31"},               # Atlantic Av-Barclays
    }
    for cid, want in expected.items():
        got = set(data["complexes"].get(cid, {}).get("stop_ids") or ())
        if not want.issubset(got):
            raise SystemExit(f"sanity check failed: complex {cid} missing stops {want - got}")
        print(f"  ok: complex {cid} = {data['complexes'][cid]['name']} {sorted(got)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
