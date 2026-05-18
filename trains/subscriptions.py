"""Parse subscription parameters from the URL.

A subscription is one station-complex card on /display, with:

- ``complex_id``  — MTA Complex ID (e.g. ``611`` for Times Sq)
- ``direction``   — ``N``, ``S``, or ``*``
- ``lines``       — tuple of route_ids to include. Empty = all lines at the complex.
- ``min_mins``    — minimum minutes-until-arrival; trains arriving sooner are hidden.

URL formats accepted:

- ``s=cx<complex_id>``                      — both directions, all lines
- ``s=cx<complex_id>:<dir>``                — one direction, all lines
- ``s=cx<complex_id>:<dir>:<line_csv>``     — one direction, only listed lines
- ``s=<stop_id>``                           — legacy: resolves to the stop's complex,
                                              both directions, only the stop's lines
- ``s=<stop_id>:<dir>``                     — legacy: same, with direction

Min-mins is a separate repeated param keyed by complex_id:

- ``m=cx<complex_id>:<min_minutes>`` (or ``m=<complex_id>:<min_minutes>`` — both work)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .stations import registry


@dataclass(frozen=True, slots=True)
class Subscription:
    complex_id: str
    direction: str           # "N", "S", or "*"
    lines: tuple[str, ...]   # empty tuple = all lines at this complex
    min_mins: int = 0

    @property
    def card_id(self) -> str:
        return f"card-cx{self.complex_id}-{self.direction}"


def _strip_cx(s: str) -> str:
    return s[2:] if s.startswith("cx") else s


def parse(
    raw_subs: Iterable[str],
    raw_mins: Iterable[str] = (),
) -> list[Subscription]:
    """Parse repeated ``s=`` and ``m=`` query params into a list of subs.

    Identical (complex_id, direction) entries merge — lines become the union,
    min_mins becomes the max. Order is first-seen.
    """
    # First pass: collect raw per-(complex, dir) records.
    pending: dict[tuple[str, str], dict] = {}
    order: list[tuple[str, str]] = []

    for raw in raw_subs:
        parsed = _parse_one_sub(raw)
        if parsed is None:
            continue
        key = (parsed["complex_id"], parsed["direction"])
        if key not in pending:
            pending[key] = {"lines": list(parsed["lines"])}
            order.append(key)
        else:
            existing = pending[key]
            # Union of lines. If either side has "all" (empty), result is "all".
            if not existing["lines"] or not parsed["lines"]:
                existing["lines"] = []
            else:
                for line in parsed["lines"]:
                    if line not in existing["lines"]:
                        existing["lines"].append(line)

    # Parse min-mins, keyed by complex_id.
    mins_by_complex: dict[str, int] = {}
    for raw in raw_mins:
        parts = raw.strip().split(":")
        if len(parts) != 2:
            continue
        cid_raw, mins_raw = parts[0].strip(), parts[1].strip()
        cid = _strip_cx(cid_raw)
        try:
            mins = int(mins_raw)
        except ValueError:
            continue
        mins = max(0, min(mins, 120))
        if mins <= 0:
            continue
        # If the cid is actually a stop_id, resolve to its complex (legacy).
        if not registry.get_complex(cid):
            complex_obj = registry.complex_for_stop(cid)
            if complex_obj:
                cid = complex_obj.id
        mins_by_complex[cid] = max(mins_by_complex.get(cid, 0), mins)

    out: list[Subscription] = []
    for cid, direction in order:
        bucket = pending[(cid, direction)]
        out.append(Subscription(
            complex_id=cid,
            direction=direction,
            lines=tuple(bucket["lines"]),
            min_mins=mins_by_complex.get(cid, 0),
        ))
    return out


def _parse_one_sub(raw: str) -> dict | None:
    """Parse a single ``s=`` value. Returns a dict with complex_id, direction,
    lines, or None for malformed input."""
    raw = raw.strip()
    if not raw:
        return None
    parts = raw.split(":")
    head = parts[0].strip()
    if not head:
        return None
    direction = (parts[1].strip().upper() if len(parts) >= 2 else "*") or "*"
    if direction not in ("N", "S", "*"):
        return None
    lines_raw = parts[2].strip() if len(parts) >= 3 else ""
    lines = tuple(p for p in (line.strip() for line in lines_raw.split(",")) if p)

    has_cx_prefix = head.startswith("cx")
    raw_id = _strip_cx(head)
    if not raw_id:
        return None

    # Explicit cx<id> reference: must be a known complex.
    if has_cx_prefix:
        if not registry.get_complex(raw_id):
            return None
        return {"complex_id": raw_id, "direction": direction, "lines": lines}

    # Unprefixed: 100+ stop_ids and complex_ids share the same numeric value
    # (e.g. "127" is both Times Sq 1/2/3 platform AND a different L-line
    # complex). Treat unprefixed as a stop_id first — that matches user
    # intent in pre-feature URLs and existing localStorage; only fall back to
    # complex_id when no such stop exists.
    complex_obj = registry.complex_for_stop(raw_id)
    if complex_obj:
        if not lines:
            station = registry.get(raw_id)
            if station and station.lines:
                lines = tuple(station.lines)
        return {"complex_id": complex_obj.id, "direction": direction, "lines": lines}

    if registry.get_complex(raw_id):
        return {"complex_id": raw_id, "direction": direction, "lines": lines}
    return None
