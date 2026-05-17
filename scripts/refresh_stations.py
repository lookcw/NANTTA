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


def parse_csv(text: str) -> dict[str, dict]:
    reader = csv.DictReader(io.StringIO(text))
    out: dict[str, dict] = {}
    for row in reader:
        stop_id = row["GTFS Stop ID"].strip()
        if not stop_id:
            continue
        borough_code = row["Borough"].strip()
        routes = [r for r in row["Daytime Routes"].split() if r]
        out[stop_id] = {
            "name": row["Stop Name"].strip(),
            "borough": BOROUGH_NAMES.get(borough_code, borough_code),
            "borough_code": borough_code,
            "lines": routes,
            "north_label": row["North Direction Label"].strip() or None,
            "south_label": row["South Direction Label"].strip() or None,
            "lat": float(row["GTFS Latitude"]) if row["GTFS Latitude"] else None,
            "lon": float(row["GTFS Longitude"]) if row["GTFS Longitude"] else None,
        }
    return out


def main() -> int:
    print(f"fetching {STATIONS_CSV_URL}")
    text = fetch_csv()
    stations = parse_csv(text)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(stations, indent=2, sort_keys=True) + "\n")
    print(f"wrote {len(stations)} stations to {OUT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
