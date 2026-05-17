"""Station metadata: names, boroughs, direction labels.

Backed by ``trains/data/stations.json`` (committed, refreshed at build time via
``scripts/refresh_stations.py``). At runtime we also re-fetch the MTA CSV
hourly and update the in-memory map; if a refresh fails we keep last-known-good.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import requests

log = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent / "data"
STATIONS_JSON = DATA_DIR / "stations.json"
OVERRIDES_JSON = DATA_DIR / "direction_overrides.json"
STATIONS_CSV_URL = "http://web.mta.info/developers/data/nyct/subway/Stations.csv"

BOROUGH_NAMES = {
    "M": "Manhattan",
    "Bk": "Brooklyn",
    "Bx": "Bronx",
    "Q": "Queens",
    "SI": "Staten Island",
}


@dataclass(frozen=True, slots=True)
class Station:
    stop_id: str
    name: str
    borough: str
    lines: tuple[str, ...]
    north_label: str | None
    south_label: str | None


class StationRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stations: dict[str, Station] = {}
        self._overrides: dict[str, dict[str, str]] = {}

    def load_from_disk(self) -> int:
        with open(STATIONS_JSON, encoding="utf-8") as f:
            raw = json.load(f)
        stations = {sid: _to_station(sid, row) for sid, row in raw.items()}
        overrides = _load_overrides()
        with self._lock:
            self._stations = stations
            self._overrides = overrides
        return len(stations)

    def refresh_from_mta(self) -> int:
        resp = requests.get(STATIONS_CSV_URL, timeout=30)
        resp.raise_for_status()
        stations = _parse_csv(resp.text)
        with self._lock:
            self._stations = stations
            self._overrides = _load_overrides()
        log.info("station registry refreshed: %d stations", len(stations))
        return len(stations)

    def get(self, stop_id: str) -> Station | None:
        with self._lock:
            return self._stations.get(stop_id)

    def name(self, stop_id: str) -> str:
        s = self.get(stop_id)
        return s.name if s else stop_id

    def direction_label(self, stop_id: str, ns: str) -> str | None:
        """Return the friendly direction label for ``N`` or ``S`` at this stop,
        applying any direction_overrides.json entry."""
        if not ns:
            return None
        with self._lock:
            override = self._overrides.get(stop_id, {})
            station = self._stations.get(stop_id)
        key = "north" if ns == "N" else "south"
        if key in override:
            return override[key]
        if station is None:
            return None
        return station.north_label if ns == "N" else station.south_label

    def size(self) -> int:
        with self._lock:
            return len(self._stations)


def _to_station(stop_id: str, row: dict) -> Station:
    return Station(
        stop_id=stop_id,
        name=row.get("name") or stop_id,
        borough=row.get("borough") or "",
        lines=tuple(row.get("lines") or ()),
        north_label=row.get("north_label"),
        south_label=row.get("south_label"),
    )


def _parse_csv(text: str) -> dict[str, Station]:
    reader = csv.DictReader(io.StringIO(text))
    out: dict[str, Station] = {}
    for row in reader:
        stop_id = (row.get("GTFS Stop ID") or "").strip()
        if not stop_id:
            continue
        borough_code = (row.get("Borough") or "").strip()
        out[stop_id] = Station(
            stop_id=stop_id,
            name=(row.get("Stop Name") or "").strip(),
            borough=BOROUGH_NAMES.get(borough_code, borough_code),
            lines=tuple(r for r in (row.get("Daytime Routes") or "").split() if r),
            north_label=(row.get("North Direction Label") or "").strip() or None,
            south_label=(row.get("South Direction Label") or "").strip() or None,
        )
    return out


def _load_overrides() -> dict[str, dict[str, str]]:
    if not OVERRIDES_JSON.exists():
        return {}
    try:
        raw = json.loads(OVERRIDES_JSON.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        log.exception("failed to parse %s; ignoring overrides", OVERRIDES_JSON)
        return {}
    return {k: v for k, v in raw.items() if isinstance(v, dict) and not k.startswith("_")}


registry = StationRegistry()
