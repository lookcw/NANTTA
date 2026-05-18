"""Shared rendering helpers for the wall display.

Subscriptions are per-stop in URLs/localStorage. Right before rendering, we
group them by ``(complex_id, direction)`` so all subscribed platforms in a
transfer complex merge into one card.

Both the initial page render and the SSE Turbo Stream updates build their HTML
through ``render_card`` so they're guaranteed to stay in sync.
"""

from __future__ import annotations

import time
from dataclasses import dataclass  # noqa: F401 — used by TrainRow below

from django.template.loader import render_to_string

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
    sort by arrival_epoch, slice to ``limit``.

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
        seen_trips.add(a.trip_id)
        rows.append(_to_row(a, now, show_dest=line_show_dest.get(base_line, True)))
        if len(rows) >= limit:
            break
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


def render_card(
    sub: Subscription,
    now: int | None = None,
    limit: int = 3,
) -> str:
    if now is None:
        now = int(time.time())
    cx = registry.get_complex(sub.complex_id)
    rows = upcoming(sub, now=now, limit=limit)
    # If every row on the card hides its destination, fall back to the
    # compact chip layout for density. Mixed cards use the per-row "trains"
    # layout with each row's destination shown or hidden individually.
    any_show_dest = any(r.show_dest for r in rows) if rows else True
    ctx = {
        "sub": sub,
        "complex": cx,
        # No card-level direction subtitle in the per-line model — each train
        # chip carries its own borough badge instead.
        "direction_label": None,
        "rows": rows,
        "now": now,
        "any_show_dest": any_show_dest,
    }
    return render_to_string("trains/_station_card.html", ctx)


def feed_age_seconds(now: int | None = None) -> int | None:
    if now is None:
        now = int(time.time())
    updated_at = int(cache.updated_at())
    if not updated_at:
        return None
    return max(0, now - updated_at)
