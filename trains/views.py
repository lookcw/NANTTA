"""HTTP endpoints for arrivals, the wall display, and the setup UI."""

from __future__ import annotations

import json
import time
from urllib.parse import urlencode

from django.http import (
    HttpRequest,
    HttpResponseBadRequest,
    JsonResponse,
    StreamingHttpResponse,
)
from django.shortcuts import render
from django.views.decorators.http import require_GET

from .cache import cache
from .render import feed_age_seconds, group_subscriptions, render_card
from .stations import registry
from .subscriptions import parse as parse_subs


def arrivals(request: HttpRequest):
    """GET /api/arrivals?stations=635,127&limit=8"""
    raw = request.GET.get("stations", "").strip()
    if not raw:
        return HttpResponseBadRequest("missing 'stations' query param")
    try:
        limit = max(1, min(int(request.GET.get("limit", "8")), 30))
    except ValueError:
        return HttpResponseBadRequest("'limit' must be an integer")

    station_ids = [s.strip() for s in raw.split(",") if s.strip()]
    now = int(time.time())
    updated_at = int(cache.updated_at())

    out_stations = []
    for sid in station_ids:
        meta = registry.get(sid)
        arrs = cache.for_stop(sid, limit=limit)
        out_stations.append({
            "stop_id": sid,
            "name": meta.name if meta else sid,
            "borough": meta.borough if meta else None,
            "lines": list(meta.lines) if meta else [],
            "arrivals": [
                {
                    "route": a.route_id,
                    "direction": a.direction,
                    "direction_label": registry.direction_label(a.parent_stop_id, a.direction),
                    "platform_stop_id": a.stop_id,
                    "trip_id": a.trip_id,
                    "terminus_stop_id": a.terminus_stop_id,
                    "terminus_name": registry.name(a.terminus_stop_id),
                    "arrival_epoch": a.arrival_epoch,
                    "seconds_until": max(0, a.arrival_epoch - now),
                }
                for a in arrs
            ],
        })

    return JsonResponse({
        "server_now": now,
        "feed_updated_at": updated_at,
        "feed_age_seconds": max(0, now - updated_at) if updated_at else None,
        "stations": out_stations,
    })


def health(request: HttpRequest):
    now = int(time.time())
    updated_at = int(cache.updated_at())
    return JsonResponse({
        "ok": not cache.is_empty(),
        "feed_updated_at": updated_at,
        "feed_age_seconds": max(0, now - updated_at) if updated_at else None,
        "stations_loaded": registry.size(),
    })


def _read_n(request: HttpRequest, default: int) -> int:
    try:
        n = int(request.GET.get("n", str(default)))
    except ValueError:
        n = default
    return max(1, min(n, 20))


def _read_show_dest(request: HttpRequest) -> bool:
    raw = request.GET.get("d", "1").strip().lower()
    return raw not in ("0", "false", "no")


@require_GET
def display(request: HttpRequest):
    subs = parse_subs(request.GET.getlist("s"))
    show_dest = _read_show_dest(request)
    # When destinations are hidden, default n bumps from 3 to 6 — rows are
    # visually shorter so we can fit more before getting cluttered.
    n = _read_n(request, default=6 if not show_dest else 3)
    now = int(time.time())
    groups = group_subscriptions(subs)
    cards = [render_card(g, now=now, limit=n, show_dest=show_dest) for g in groups]
    stream_params: list[tuple[str, str]] = [("s", f"{s.stop_id}:{s.direction}") for s in subs]
    stream_params.append(("n", str(n)))
    stream_params.append(("d", "1" if show_dest else "0"))
    stream_qs = urlencode(stream_params)
    setup_qs = urlencode(
        [("s", f"{s.stop_id}:{s.direction}") for s in subs]
        + [("n", str(n)), ("d", "1" if show_dest else "0")]
    )
    return render(request, "trains/display.html", {
        "subs": subs,
        "cards": cards,
        "stream_url": f"/display/stream?{stream_qs}" if subs else "",
        "setup_url": f"/setup?{setup_qs}" if subs else "/setup",
        "feed_age": feed_age_seconds(now),
        "trains_per_card": n,
        "show_destination": show_dest,
    })


def display_stream(request: HttpRequest):
    """SSE endpoint pushing Turbo Stream updates for every subscribed card."""
    subs = parse_subs(request.GET.getlist("s"))
    if not subs:
        return HttpResponseBadRequest("missing 's' subscriptions")
    show_dest = _read_show_dest(request)
    n = _read_n(request, default=6 if not show_dest else 3)
    groups = group_subscriptions(subs)

    interval = float(request.GET.get("interval", "5"))
    interval = max(1.0, min(interval, 30.0))

    def event_stream():
        # First message immediately so the client gets fresh content on connect.
        while True:
            now = int(time.time())
            payload_parts: list[str] = []
            for g in groups:
                html = render_card(g, now=now, limit=n, show_dest=show_dest)
                payload_parts.append(
                    f'<turbo-stream action="replace" target="{g.card_id}">'
                    f'<template>{html}</template></turbo-stream>'
                )
            # SSE: collapse any newlines in the payload into one "data:" line
            # by emitting each line as its own data: field per the SSE spec.
            data = "".join(payload_parts)
            lines = data.split("\n")
            yield "event: message\n"
            for line in lines:
                yield f"data: {line}\n"
            yield "\n"
            time.sleep(interval)

    resp = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    resp["Cache-Control"] = "no-cache"
    resp["X-Accel-Buffering"] = "no"
    return resp


@require_GET
def setup(request: HttpRequest):
    """Render the setup page with all stations embedded as JSON for the client.

    Per the design: /setup search and Selected list stay per-stop. The
    complex grouping is applied at render time on /display, not here.
    """
    from .stations import STATIONS_JSON
    try:
        with open(STATIONS_JSON, encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        raw = {}
    stops_raw = raw.get("stops") or {}
    stations_list = []
    for stop_id, row in stops_raw.items():
        stations_list.append({
            "id": stop_id,
            "name": row.get("name") or stop_id,
            "borough": row.get("borough") or "",
            "lines": row.get("lines") or [],
            "n_label": row.get("north_label"),
            "s_label": row.get("south_label"),
        })
    stations_list.sort(key=lambda s: s["name"])
    return render(request, "trains/setup.html", {
        "stations_json": json.dumps(stations_list),
    })
