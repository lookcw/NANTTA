"""Station + complex metadata.

Backed by ``trains/data/stations.json`` (committed, refreshed at build time via
``scripts/refresh_stations.py``). At runtime we also re-fetch the MTA CSV
hourly and update the in-memory map atomically; if a refresh fails we keep
last-known-good.

A *station* (here: ``Station``) is one GTFS stop_id — a single platform with
its own N/S direction labels.

A *complex* is MTA's "Complex ID" grouping — multiple physical platforms that
transfer to each other (e.g. Court Sq's 7, G, and E/F platforms). 496 stops
collapse to 445 complexes.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import threading
from collections import Counter
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


# Keyword → 3-letter borough code. Specific neighborhoods first so things like
# "Coney Island - Bay Ridge" classify as Brooklyn even though Manhattan-bound
# trains might also touch Manhattan in their label. Order matters.
_LABEL_BOROUGH_KEYWORDS: tuple[tuple[str, str], ...] = (
    ("coney island", "BK"),
    ("bay ridge", "BK"),
    ("flatbush", "BK"),
    ("brooklyn", "BK"),
    ("astoria", "QNS"),
    ("flushing", "QNS"),
    ("forest hills", "QNS"),
    ("jamaica", "QNS"),
    ("rockaway", "QNS"),
    ("queens", "QNS"),
    ("the bronx", "BX"),
    ("bronx", "BX"),
    ("staten", "SI"),
    ("manhattan", "MAN"),
    ("uptown", "BX"),    # paired labels like "Uptown & The Bronx" — Bronx wins above
    ("downtown", "MAN"),
)


def direction_borough_short(label: str | None) -> str:
    """Return a 3-letter borough code (MAN/BK/BX/QNS/SI) derived from an MTA
    direction label string. Empty string when no keyword matches."""
    if not label:
        return ""
    lower = label.lower()
    for needle, code in _LABEL_BOROUGH_KEYWORDS:
        if needle in lower:
            return code
    return ""


@dataclass(frozen=True, slots=True)
class Station:
    stop_id: str
    name: str
    borough: str
    lines: tuple[str, ...]
    north_label: str | None
    south_label: str | None
    complex_id: str  # always present; solo stations have their own complex_id


@dataclass(frozen=True, slots=True)
class Complex:
    id: str
    name: str                  # display name — most common Stop Name across members
    borough: str
    lines: tuple[str, ...]     # sorted union of Daytime Routes across members
    stop_ids: tuple[str, ...]  # sorted member stop_ids


class StationRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stations: dict[str, Station] = {}
        self._complexes: dict[str, Complex] = {}
        self._stop_to_complex: dict[str, str] = {}
        self._overrides: dict[str, dict[str, str]] = {}

    # --------- loaders ---------

    def load_from_disk(self) -> int:
        with open(STATIONS_JSON, encoding="utf-8") as f:
            raw = json.load(f)
        stations, complexes, stop_to_complex = _from_json_doc(raw)
        overrides = _load_overrides()
        with self._lock:
            self._stations = stations
            self._complexes = complexes
            self._stop_to_complex = stop_to_complex
            self._overrides = overrides
        return len(stations)

    def refresh_from_mta(self) -> int:
        resp = requests.get(STATIONS_CSV_URL, timeout=30)
        resp.raise_for_status()
        stations, complexes, stop_to_complex = _from_csv(resp.text)
        overrides = _load_overrides()
        with self._lock:
            self._stations = stations
            self._complexes = complexes
            self._stop_to_complex = stop_to_complex
            self._overrides = overrides
        log.info(
            "station registry refreshed: %d stations / %d complexes",
            len(stations), len(complexes),
        )
        return len(stations)

    # --------- stop accessors ---------

    def get(self, stop_id: str) -> Station | None:
        with self._lock:
            return self._stations.get(stop_id)

    def name(self, stop_id: str) -> str:
        s = self.get(stop_id)
        return s.name if s else stop_id

    def direction_label(self, stop_id: str, ns: str) -> str | None:
        """Friendly direction label for ``N`` or ``S`` at this stop, with
        direction_overrides.json applied."""
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

    # --------- complex accessors ---------

    def get_complex(self, complex_id: str) -> Complex | None:
        with self._lock:
            return self._complexes.get(complex_id)

    def complex_for_stop(self, stop_id: str) -> Complex | None:
        with self._lock:
            cid = self._stop_to_complex.get(stop_id)
            return self._complexes.get(cid) if cid else None

    def complex_size(self) -> int:
        with self._lock:
            return len(self._complexes)


# ----------------- helpers -----------------


def _to_station(stop_id: str, row: dict) -> Station:
    return Station(
        stop_id=stop_id,
        name=row.get("name") or stop_id,
        borough=row.get("borough") or "",
        lines=tuple(row.get("lines") or ()),
        north_label=row.get("north_label"),
        south_label=row.get("south_label"),
        complex_id=row.get("complex_id") or stop_id,
    )


def _from_json_doc(doc: dict) -> tuple[dict[str, Station], dict[str, Complex], dict[str, str]]:
    stops_raw = doc.get("stops") or {}
    complexes_raw = doc.get("complexes") or {}
    stop_to_complex = dict(doc.get("stop_to_complex") or {})

    stations = {sid: _to_station(sid, row) for sid, row in stops_raw.items()}
    complexes = {
        cid: Complex(
            id=cid,
            name=row.get("name") or cid,
            borough=row.get("borough") or "",
            lines=tuple(row.get("lines") or ()),
            stop_ids=tuple(row.get("stop_ids") or ()),
        )
        for cid, row in complexes_raw.items()
    }
    return stations, complexes, stop_to_complex


def _from_csv(text: str) -> tuple[dict[str, Station], dict[str, Complex], dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    stations: dict[str, Station] = {}
    members: dict[str, list[dict]] = {}

    for row in reader:
        stop_id = (row.get("GTFS Stop ID") or "").strip()
        if not stop_id:
            continue
        complex_id = (row.get("Complex ID") or "").strip() or stop_id
        borough_code = (row.get("Borough") or "").strip()
        borough = BOROUGH_NAMES.get(borough_code, borough_code)
        lines = tuple(r for r in (row.get("Daytime Routes") or "").split() if r)
        name = (row.get("Stop Name") or "").strip()
        north_label = (row.get("North Direction Label") or "").strip() or None
        south_label = (row.get("South Direction Label") or "").strip() or None

        stations[stop_id] = Station(
            stop_id=stop_id,
            name=name,
            borough=borough,
            lines=lines,
            north_label=north_label,
            south_label=south_label,
            complex_id=complex_id,
        )
        members.setdefault(complex_id, []).append({
            "stop_id": stop_id,
            "name": name,
            "borough": borough,
            "lines": lines,
        })

    complexes: dict[str, Complex] = {}
    for cid, member_list in members.items():
        name_counts = Counter(m["name"] for m in member_list if m["name"])
        if name_counts:
            top_count = name_counts.most_common(1)[0][1]
            top_names = [n for n, c in name_counts.items() if c == top_count]
            display_name = sorted(top_names, key=lambda s: (-len(s), s))[0]
        else:
            display_name = ""

        borough_counts = Counter(m["borough"] for m in member_list if m["borough"])
        borough = ""
        if borough_counts:
            top_count = borough_counts.most_common(1)[0][1]
            borough = sorted(b for b, c in borough_counts.items() if c == top_count)[0]

        line_set: set[str] = set()
        for m in member_list:
            line_set.update(m["lines"])
        lines_sorted = tuple(sorted(line_set, key=_line_sort_key))
        stop_ids_sorted = tuple(sorted(m["stop_id"] for m in member_list))

        complexes[cid] = Complex(
            id=cid,
            name=display_name,
            borough=borough,
            lines=lines_sorted,
            stop_ids=stop_ids_sorted,
        )

    stop_to_complex = {sid: s.complex_id for sid, s in stations.items()}
    return stations, complexes, stop_to_complex


def _line_sort_key(line: str):
    return (0, int(line)) if line.isdigit() else (1, line)


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
