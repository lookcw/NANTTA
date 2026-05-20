"""Card-payload builders for the React display.

``upcoming`` merges arrivals across every stop in a subscription's complex,
filters by per-line direction + per-complex min-mins, and produces the
``TrainRow``s that ``card_payload`` packs into the JSON the API returns."""

from __future__ import annotations

import time
from dataclasses import dataclass  # noqa: F401 — used by TrainRow below

from .cache import cache
from .line_colors import color_for, text_color_for
from .parser import Arrival
from .stations import direction_borough_short, registry
from .subscriptions import Subscription


# Subscription IS the card; no separate grouping object needed — the parser
# already dedupes identical (complex_id, direction) pairs.


# ---------------- arrivals ----------------


@dataclass(frozen=True, slots=True)
class TrainRow:
    route: str             # display label ("6", "7" — express "X" stripped)
    route_color: str
    route_text_color: str
    is_express: bool       # true for routes whose ID ended in 'X' (e.g. 6X, 7X)
    direction: str
    terminus_name: str
    # Borough this train is heading toward as described on the platform sign:
    # derived from the *platform's* MTA direction label, not from the trip's
    # eventual terminus (an N at Queensboro southbound says "Manhattan" on the
    # platform even though it ends in Brooklyn).
    direction_borough_short: str  # "MAN"|"BK"|"QNS"|"BX"|"SI" or ""
    arrival_epoch: int
    seconds_until: int
    display: str  # "now" or "3 min" — JS may overwrite on per-second tick
    show_dest: bool = True  # per-line setting carried from the LineSpec


def upcoming(sub: Subscription, now: int, limit: int = 3) -> list[TrainRow]:
    """Merge upcoming arrivals across every stop in the subscription's
    complex, applying per-line direction filters + per-complex min-minutes,
    sort by arrival_epoch, and cap each ``(line, direction)`` bucket at
    ``limit`` rows. ``limit`` is per-bucket, not per-card.

    ``sub.line_specs`` is a tuple of ``(line, direction)``. A line not present
    in the tuple is excluded entirely. ``direction == "*"`` matches either way.
    Express route_ids (``6X``, ``7X``) are matched against their stripped form
    (``6``, ``7``) so the user picks "6" and the express trains come along.
    """
    cx = registry.get_complex(sub.complex_id)
    if cx is None or not sub.line_specs:
        return []

    line_dir: dict[str, str] = {ls.line: ls.direction for ls in sub.line_specs}
    line_show_dest: dict[str, bool] = {ls.line: ls.show_dest for ls in sub.line_specs}

    merged: list[Arrival] = []
    for sid in cx.stop_ids:
        merged.extend(cache.for_stop(sid, limit=30))
    merged.sort(key=lambda a: a.arrival_epoch)

    min_seconds = sub.min_mins * 60
    rows: list[TrainRow] = []
    seen_trips: set[str] = set()
    per_bucket: dict[tuple[str, str], int] = {}
    for a in merged:
        base_line = a.route_id[:-1] if a.route_id.endswith("X") and len(a.route_id) > 1 else a.route_id
        wanted_dir = line_dir.get(base_line)
        if wanted_dir is None:
            continue
        if wanted_dir != "*" and a.direction != wanted_dir:
            continue
        if min_seconds and (a.arrival_epoch - now) < min_seconds:
            continue
        if a.trip_id in seen_trips:
            continue
        bucket = (base_line, a.direction)
        if per_bucket.get(bucket, 0) >= limit:
            continue
        per_bucket[bucket] = per_bucket.get(bucket, 0) + 1
        seen_trips.add(a.trip_id)
        rows.append(_to_row(a, now, show_dest=line_show_dest.get(base_line, True)))
    return rows


def _to_row(a: Arrival, now: int, show_dest: bool = True) -> TrainRow:
    secs = max(0, a.arrival_epoch - now)
    is_express = bool(a.route_id) and a.route_id.endswith("X") and len(a.route_id) > 1
    display_route = a.route_id[:-1] if is_express else a.route_id
    platform_label = registry.direction_label(a.parent_stop_id, a.direction)
    dir_short = direction_borough_short(platform_label)
    return TrainRow(
        route=display_route,
        route_color=color_for(a.route_id),
        route_text_color=text_color_for(a.route_id),
        is_express=is_express,
        direction=a.direction,
        terminus_name=registry.name(a.terminus_stop_id),
        direction_borough_short=dir_short,
        arrival_epoch=a.arrival_epoch,
        seconds_until=secs,
        display=format_eta(secs),
        show_dest=show_dest,
    )


def format_eta(seconds: int) -> str:
    if seconds < 30:
        return "now"
    return f"{(seconds + 30) // 60} min"


# ---------------- top-level render ----------------


def card_payload(
    sub: Subscription,
    now: int | None = None,
    limit: int = 3,
) -> dict:
    """JSON-serializable shape of one card for the React client.

    Mirrors what ``render_card`` packs into the template — the React side
    decides chip vs train-row layout from ``any_show_dest`` the same way.
    """
    if now is None:
        now = int(time.time())
    cx = registry.get_complex(sub.complex_id)
    rows = upcoming(sub, now=now, limit=limit)
    any_show_dest = any(r.show_dest for r in rows) if rows else True
    return {
        "card_id": sub.card_id,
        "complex_id": sub.complex_id,
        "complex": {
            "id": cx.id,
            "name": cx.name,
            "borough": cx.borough,
            "lines": list(cx.lines),
        } if cx else None,
        "any_show_dest": any_show_dest,
        "rows": [
            {
                "route": r.route,
                "route_color": r.route_color,
                "route_text_color": r.route_text_color,
                "is_express": r.is_express,
                "direction": r.direction,
                "terminus_name": r.terminus_name,
                "direction_borough_short": r.direction_borough_short,
                "arrival_epoch": r.arrival_epoch,
                "seconds_until": r.seconds_until,
                "display": r.display,
                "show_dest": r.show_dest,
            }
            for r in rows
        ],
    }


def feed_age_seconds(now: int | None = None) -> int | None:
    if now is None:
        now = int(time.time())
    updated_at = int(cache.updated_at())
    if not updated_at:
        return None
    return max(0, now - updated_at)
