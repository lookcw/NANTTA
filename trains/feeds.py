"""MTA NYCT subway realtime feed URLs.

As of late 2023, no API key is required for subway feeds. Each URL serves a
GTFS-Realtime protobuf payload covering a group of lines.
"""

from __future__ import annotations

BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds"

FEEDS: dict[str, str] = {
    "ACE": f"{BASE}/nyct%2Fgtfs-ace",
    "BDFM": f"{BASE}/nyct%2Fgtfs-bdfm",
    "G": f"{BASE}/nyct%2Fgtfs-g",
    "JZ": f"{BASE}/nyct%2Fgtfs-jz",
    "NQRW": f"{BASE}/nyct%2Fgtfs-nqrw",
    "L": f"{BASE}/nyct%2Fgtfs-l",
    "1234567": f"{BASE}/nyct%2Fgtfs",
    "SIR": f"{BASE}/nyct%2Fgtfs-si",
}
