"""HTTP endpoints for arrivals and the wall display."""

from __future__ import annotations

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
from .render import feed_age_seconds, render_card
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


@require_GET
def display(request: HttpRequest):
    subs = parse_subs(request.GET.getlist("s"))
    now = int(time.time())
    cards = [render_card(s, now=now) for s in subs]
    stream_qs = urlencode([("s", f"{s.stop_id}:{s.direction}") for s in subs])
    return render(request, "trains/display.html", {
        "subs": subs,
        "cards": cards,
        "stream_url": f"/display/stream?{stream_qs}" if subs else "",
        "feed_age": feed_age_seconds(now),
    })


def display_stream(request: HttpRequest):
    """SSE endpoint pushing Turbo Stream updates for every subscribed card."""
    subs = parse_subs(request.GET.getlist("s"))
    if not subs:
        return HttpResponseBadRequest("missing 's' subscriptions")

    interval = float(request.GET.get("interval", "5"))
    interval = max(1.0, min(interval, 30.0))

    def event_stream():
        # First message immediately so the client gets fresh content on connect.
        while True:
            now = int(time.time())
            payload_parts: list[str] = []
            for s in subs:
                html = render_card(s, now=now)
                payload_parts.append(
                    f'<turbo-stream action="replace" target="{s.card_id}">'
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
