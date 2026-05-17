"""Decode MTA GTFS-Realtime protobuf payloads into normalized Arrival objects.

MTA stop_ids in the realtime feed look like ``635N`` / ``635S`` — the trailing
``N``/``S`` is the direction. We keep the platform stop_id intact (so callers
can match on the exact platform if they want) but also expose ``parent_stop_id``
(``635``) and ``direction`` (``N`` or ``S``) for grouping.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Iterable

import requests
from google.transit import gtfs_realtime_pb2

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Arrival:
    stop_id: str          # e.g. "635N"
    parent_stop_id: str   # e.g. "635"
    direction: str        # "N" or "S"
    route_id: str         # e.g. "6", "Q", "A"
    trip_id: str
    arrival_epoch: int    # seconds since unix epoch


def _split_stop_id(raw: str) -> tuple[str, str, str]:
    if raw and raw[-1] in ("N", "S"):
        return raw, raw[:-1], raw[-1]
    return raw, raw, ""


def fetch_feed(url: str, timeout: float = 8.0) -> bytes:
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.content


def parse_feed(payload: bytes, now: int | None = None) -> list[Arrival]:
    if now is None:
        now = int(time.time())

    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(payload)

    out: list[Arrival] = []
    for entity in feed.entity:
        if not entity.HasField("trip_update"):
            continue
        tu = entity.trip_update
        route_id = tu.trip.route_id
        trip_id = tu.trip.trip_id

        for stu in tu.stop_time_update:
            t = 0
            if stu.HasField("arrival") and stu.arrival.time:
                t = stu.arrival.time
            elif stu.HasField("departure") and stu.departure.time:
                t = stu.departure.time
            if t <= now:
                continue
            stop_id, parent, direction = _split_stop_id(stu.stop_id)
            out.append(
                Arrival(
                    stop_id=stop_id,
                    parent_stop_id=parent,
                    direction=direction,
                    route_id=route_id,
                    trip_id=trip_id,
                    arrival_epoch=t,
                )
            )
    return out


def parse_many(payloads: Iterable[bytes]) -> list[Arrival]:
    out: list[Arrival] = []
    for p in payloads:
        try:
            out.extend(parse_feed(p))
        except Exception:  # noqa: BLE001
            log.exception("failed to parse one feed payload")
    return out
