"""Shared rendering helpers for the wall display.

Subscriptions are per-stop in URLs/localStorage. Right before rendering, we
group them by ``(complex_id, direction)`` so all subscribed platforms in a
transfer complex merge into one card.

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
from .stations import Complex, direction_borough_short, registry
from .subscriptions import Subscription


# ---------------- grouping ----------------


@dataclass(frozen=True, slots=True)
class CardGroup:
    """One rendered card. Multiple subscribed platforms in the same complex +
    direction merge into one of these."""

    complex: Complex
    direction: str              # "N", "S", or "*"
    stop_ids: tuple[str, ...]   # subscribed stop_ids in this group (sorted)

    @property
    def card_id(self) -> str:
        return f"card-cx{self.complex.id}-{self.direction}"


def group_subscriptions(subs: list[Subscription]) -> list[CardGroup]:
    """Group per-stop subscriptions by (complex_id, direction).

    Order: groups appear in the order they first occur among ``subs``;
    stops within a group are sorted by stop_id so the card_id and merged
    contents are stable regardless of subscription order.

    Unknown stop_ids fall back to a one-stop synthetic complex so user URLs
    never produce a blank card.
    """
    members: dict[tuple[str, str], list[str]] = {}
    complex_by_id: dict[str, Complex] = {}
    order: list[tuple[str, str]] = []

    for s in subs:
        cx = registry.complex_for_stop(s.stop_id)
        if cx is None:
            cx = Complex(
                id=s.stop_id, name=s.stop_id, borough="",
                lines=(), stop_ids=(s.stop_id,),
            )
        complex_by_id.setdefault(cx.id, cx)

        key = (cx.id, s.direction)
        if key not in members:
            members[key] = []
            order.append(key)
        if s.stop_id not in members[key]:
            members[key].append(s.stop_id)

    return [
        CardGroup(
            complex=complex_by_id[cx_id],
            direction=direction,
            stop_ids=tuple(sorted(members[(cx_id, direction)])),
        )
        for cx_id, direction in order
    ]


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


def upcoming(group: CardGroup, now: int, limit: int = 3) -> list[TrainRow]:
    """Merge upcoming arrivals across every stop in the group's complex,
    filter by direction, sort by arrival_epoch, slice to ``limit``."""
    merged: list[Arrival] = []
    for sid in group.stop_ids:
        merged.extend(cache.for_stop(sid, limit=30))
    merged.sort(key=lambda a: a.arrival_epoch)

    rows: list[TrainRow] = []
    seen_trips: set[str] = set()  # dedupe in case the same trip appears at sibling platforms
    for a in merged:
        if group.direction != "*" and a.direction != group.direction:
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


def _group_direction_label(group: CardGroup) -> str | None:
    """Friendly direction subtitle for a card, only when every stop in the
    group agrees on the platform-level label for the chosen direction.

    Returns ``None`` for "*", for groups whose members disagree, or when any
    member is missing a label (e.g. terminal platforms).
    """
    if group.direction not in ("N", "S"):
        return None
    labels: set[str] = set()
    for sid in group.stop_ids:
        label = registry.direction_label(sid, group.direction)
        if not label:
            return None  # missing label on any stop → suppress
        labels.add(label)
    if len(labels) != 1:
        return None
    return next(iter(labels))


def _subscribed_lines(group: CardGroup) -> list[str]:
    """Union of the *subscribed* stops' lines (not the whole complex)."""
    seen: set[str] = set()
    out: list[str] = []
    for sid in group.stop_ids:
        st = registry.get(sid)
        if not st:
            continue
        for line in st.lines:
            if line not in seen:
                seen.add(line)
                out.append(line)
    # Stable sort — digits first, then letters.
    out.sort(key=lambda l: (0, int(l)) if l.isdigit() else (1, l))
    return out


# ---------------- top-level render ----------------


def render_card(
    group: CardGroup,
    now: int | None = None,
    limit: int = 3,
    show_dest: bool = True,
) -> str:
    if now is None:
        now = int(time.time())
    rows = upcoming(group, now=now, limit=limit)
    ctx = {
        "group": group,
        "complex": group.complex,
        "direction_label": _group_direction_label(group),
        "lines": _subscribed_lines(group),
        "is_multi_stop": len(group.stop_ids) > 1,
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
