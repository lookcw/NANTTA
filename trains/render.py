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


def upcoming(sub: Subscription, now: int, limit: int = 3) -> list[TrainRow]:
    """Merge upcoming arrivals across every stop in the subscription's
    complex, filter by direction + included lines + per-complex min-minutes,
    sort by arrival_epoch, slice to ``limit``.
    """
    cx = registry.get_complex(sub.complex_id)
    if cx is None:
        return []
    allowed_lines = set(sub.lines) if sub.lines else None

    merged: list[Arrival] = []
    for sid in cx.stop_ids:
        merged.extend(cache.for_stop(sid, limit=30))
    merged.sort(key=lambda a: a.arrival_epoch)

    min_seconds = sub.min_mins * 60
    rows: list[TrainRow] = []
    seen_trips: set[str] = set()
    for a in merged:
        if sub.direction != "*" and a.direction != sub.direction:
            continue
        if allowed_lines is not None and a.route_id not in allowed_lines:
            continue
        if min_seconds and (a.arrival_epoch - now) < min_seconds:
            continue
        if a.trip_id in seen_trips:
            continue
        seen_trips.add(a.trip_id)
        rows.append(_to_row(a, now))
        if len(rows) >= limit:
            break
    return rows


def _to_row(a: Arrival, now: int) -> TrainRow:
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
    )


def format_eta(seconds: int) -> str:
    if seconds < 30:
        return "now"
    return f"{(seconds + 30) // 60} min"


# ---------------- card subtitle ----------------


def _sub_direction_label(sub: Subscription) -> str | None:
    """Friendly direction subtitle for a card. Only shown when every stop in
    the subscription's complex that *carries one of the included lines* agrees
    on the platform-level label for the chosen direction.

    Returns ``None`` for "*", for disagreement across stops, or when any
    relevant stop is missing a label (terminal platforms).
    """
    if sub.direction not in ("N", "S"):
        return None
    cx = registry.get_complex(sub.complex_id)
    if cx is None:
        return None
    allowed_lines = set(sub.lines) if sub.lines else None
    labels: set[str] = set()
    for sid in cx.stop_ids:
        st = registry.get(sid)
        if not st:
            continue
        if allowed_lines is not None and not (set(st.lines) & allowed_lines):
            continue
        label = registry.direction_label(sid, sub.direction)
        if not label:
            return None
        labels.add(label)
    if len(labels) != 1:
        return None
    return next(iter(labels))


# ---------------- top-level render ----------------


def render_card(
    sub: Subscription,
    now: int | None = None,
    limit: int = 3,
    show_dest: bool = True,
) -> str:
    if now is None:
        now = int(time.time())
    cx = registry.get_complex(sub.complex_id)
    rows = upcoming(sub, now=now, limit=limit)
    ctx = {
        "sub": sub,
        "complex": cx,
        "direction_label": _sub_direction_label(sub),
        "rows": rows,
        "now": now,
        "show_dest": show_dest,
    }
    return render_to_string("trains/_station_card.html", ctx)


def feed_age_seconds(now: int | None = None) -> int | None:
    if now is None:
        now = int(time.time())
    updated_at = int(cache.updated_at())
    if not updated_at:
        return None
    return max(0, now - updated_at)
