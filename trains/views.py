"""HTTP endpoints for arrivals.

Phase 2 enriches each arrival with friendly station name, borough, and
direction label (from MTA Stations.csv via the in-memory registry).
"""

from __future__ import annotations

import time

from django.http import HttpRequest, HttpResponseBadRequest, JsonResponse

from .cache import cache
from .stations import registry


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
