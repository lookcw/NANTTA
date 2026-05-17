"""Shared rendering helpers for the wall display.

Both the initial page render and the SSE Turbo Stream updates build their HTML
through ``render_card`` so they're guaranteed to stay in sync.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from django.template.loader import render_to_string

from .cache import cache
from .line_colors import color_for, text_color_for
from .parser import Arrival
from .stations import registry
from .subscriptions import Subscription


@dataclass(frozen=True, slots=True)
class TrainRow:
    route: str
    route_color: str
    route_text_color: str
    direction: str
    terminus_name: str
    arrival_epoch: int
    seconds_until: int
    display: str  # "now" or "3 min" — JS may overwrite on per-second tick


def upcoming(sub: Subscription, now: int, limit: int = 6) -> list[TrainRow]:
    arrivals = cache.for_stop(sub.stop_id, limit=30)
    rows: list[TrainRow] = []
    for a in arrivals:
        if sub.direction != "*" and a.direction != sub.direction:
            continue
        rows.append(_to_row(a, now))
        if len(rows) >= limit:
            break
    return rows


def _to_row(a: Arrival, now: int) -> TrainRow:
    secs = max(0, a.arrival_epoch - now)
    return TrainRow(
        route=a.route_id,
        route_color=color_for(a.route_id),
        route_text_color=text_color_for(a.route_id),
        direction=a.direction,
        terminus_name=registry.name(a.terminus_stop_id),
        arrival_epoch=a.arrival_epoch,
        seconds_until=secs,
        display=format_eta(secs),
    )


def format_eta(seconds: int) -> str:
    if seconds < 30:
        return "now"
    return f"{(seconds + 30) // 60} min"


def render_card(sub: Subscription, now: int | None = None) -> str:
    if now is None:
        now = int(time.time())
    station = registry.get(sub.stop_id)
    direction_label = (
        registry.direction_label(sub.stop_id, sub.direction)
        if sub.direction in ("N", "S")
        else None
    )
    rows = upcoming(sub, now=now)
    ctx = {
        "sub": sub,
        "station": station,
        "direction_label": direction_label,
        "rows": rows,
        "now": now,
    }
    return render_to_string("trains/_station_card.html", ctx)


def feed_age_seconds(now: int | None = None) -> int | None:
    if now is None:
        now = int(time.time())
    updated_at = int(cache.updated_at())
    if not updated_at:
        return None
    return max(0, now - updated_at)
