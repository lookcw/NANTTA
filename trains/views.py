"""HTTP endpoints for arrivals.

Phase 1 only exposes a JSON sanity-check endpoint. UI comes in Phase 3.
"""

from __future__ import annotations

import time

from django.http import HttpRequest, HttpResponseBadRequest, JsonResponse

from .cache import cache


def arrivals(request: HttpRequest):
    """GET /api/arrivals?stations=635,127&limit=8

    Returns the next ``limit`` arrivals per station, sorted by arrival time.
    """
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
        arrs = cache.for_stop(sid, limit=limit)
        out_stations.append({
            "stop_id": sid,
            "arrivals": [
                {
                    "route": a.route_id,
                    "direction": a.direction,
                    "platform_stop_id": a.stop_id,
                    "trip_id": a.trip_id,
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
    })
