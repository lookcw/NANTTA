"""HTTP endpoints for arrivals, the React SPA shell, and the JSON APIs."""

from __future__ import annotations

import json
import time
from pathlib import Path

from django.conf import settings
from django.http import (
    HttpRequest,
    HttpResponseBadRequest,
    JsonResponse,
    StreamingHttpResponse,
)
from django.shortcuts import render
from django.views.decorators.http import require_GET

from .cache import cache
from .render import card_payload, feed_age_seconds
from .stations import registry
from .subscriptions import LineSpec, Subscription, parse as parse_subs


def _apply_legacy_hide_dest(subs: list[Subscription]) -> list[Subscription]:
    """Force show_dest=False on every line of every sub.

    Used for backward-compat with old URLs that carried ``d=0`` as a global
    "hide destinations" toggle (now expressed per-line on each ``s=`` value).
    """
    out: list[Subscription] = []
    for s in subs:
        out.append(Subscription(
            complex_id=s.complex_id,
            line_specs=tuple(LineSpec(line=ls.line, direction=ls.direction, show_dest=False) for ls in s.line_specs),
            min_mins=s.min_mins,
        ))
    return out


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


def _read_legacy_hide_dest(request: HttpRequest) -> bool:
    """Legacy ``d=0`` query param meant "hide destinations globally"; missing
    or any other value means honor each line's own show_dest setting."""
    raw = (request.GET.get("d") or "").strip().lower()
    return raw in ("0", "false", "no")


def _read_font_size(request: HttpRequest) -> str:
    raw = (request.GET.get("f") or "m").strip().lower()
    return raw if raw in ("s", "m", "l") else "m"


def _complex_catalog() -> list[dict]:
    """Build the per-complex catalog used by both the setup page and the
    JSON /api/stations endpoint.

    One row per MTA station complex (445-ish) with:
      - id, name, borough, lines (union of member lines)
      - line_info[]: per-line N/S labels + borough shorts so each line in a
        complex can render its own direction toggle.
      - haystack: extra tokens (member stop_ids, per-platform names) for the
        search box — typing "F09" or "Court Sq-23 St" finds the Court Sq complex.
    """
    from .stations import STATIONS_JSON, direction_borough_short
    try:
        with open(STATIONS_JSON, encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        raw = {}
    stops_raw = raw.get("stops") or {}
    complexes_raw = raw.get("complexes") or {}

    complexes_list: list[dict] = []
    for cid, row in complexes_raw.items():
        member_stops = [stops_raw[sid] for sid in row.get("stop_ids", []) if sid in stops_raw]

        line_info: list[dict] = []
        for line in row.get("lines") or []:
            n_label = ""
            s_label = ""
            for stop in member_stops:
                if line in (stop.get("lines") or []):
                    n_label = n_label or (stop.get("north_label") or "")
                    s_label = s_label or (stop.get("south_label") or "")
            line_info.append({
                "line": line,
                "n_label": n_label or None,
                "s_label": s_label or None,
                "n_short": direction_borough_short(n_label),
                "s_short": direction_borough_short(s_label),
            })

        haystack_tokens: set[str] = set()
        haystack_tokens.add(row.get("name") or "")
        haystack_tokens.add(cid)
        for sid in row.get("stop_ids", []):
            haystack_tokens.add(sid)
            stop = stops_raw.get(sid) or {}
            if stop.get("name"):
                haystack_tokens.add(stop["name"])
        haystack = " ".join(t for t in haystack_tokens if t).lower()

        complexes_list.append({
            "id": cid,
            "name": row.get("name") or cid,
            "borough": row.get("borough") or "",
            "lines": list(row.get("lines") or []),
            "line_info": line_info,
            "stop_ids": list(row.get("stop_ids") or []),
            "haystack": haystack,
        })
    complexes_list.sort(key=lambda c: c["name"])
    return complexes_list


def api_display_stream(request: HttpRequest):
    """SSE endpoint pushing JSON card payloads — React counterpart to /display/stream.

    Same cadence and same subscription parsing as the Turbo SSE; the only
    difference is the payload shape (JSON instead of <turbo-stream> HTML).
    """
    subs = parse_subs(request.GET.getlist("s"), request.GET.getlist("m"))
    if not subs:
        return HttpResponseBadRequest("missing 's' subscriptions")
    if _read_legacy_hide_dest(request):
        subs = _apply_legacy_hide_dest(subs)
    n = _read_n(request, default=3)

    interval = float(request.GET.get("interval", "5"))
    interval = max(1.0, min(interval, 30.0))

    def event_stream():
        while True:
            now = int(time.time())
            payload = {
                "server_now": now,
                "feed_age_seconds": feed_age_seconds(now),
                "subs": [card_payload(s, now=now, limit=n) for s in subs],
            }
            # JSON has no embedded newlines once compactly encoded, so the
            # message fits in a single SSE data: line.
            data = json.dumps(payload, separators=(",", ":"))
            yield "event: message\n"
            yield f"data: {data}\n"
            yield "\n"
            time.sleep(interval)

    resp = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    resp["Cache-Control"] = "no-cache"
    resp["X-Accel-Buffering"] = "no"
    return resp


def _vite_assets() -> dict:
    """Read the Vite manifest and return ``{js_entry, css_entries}`` paths
    relative to STATIC_URL (the {% static %} tag prepends STATIC_URL + handles
    WhiteNoise's content-hash post-processing).

    Returns empty paths if the bundle hasn't been built yet so dev servers
    don't 500 before the first ``npm run build``.
    """
    base = Path(settings.BASE_DIR) / "trains" / "static" / "trains" / "app"
    manifest_path = base / ".vite" / "manifest.json"
    try:
        with manifest_path.open(encoding="utf-8") as f:
            manifest = json.load(f)
    except FileNotFoundError:
        return {"js_entry": "", "css_entries": []}

    # Vite key is the entry's input path relative to the Vite root. Our root
    # is trains/frontend/ and the entry is index.html.
    entry = manifest.get("index.html") or {}
    js_file = entry.get("file") or ""
    css_files = entry.get("css") or []
    prefix = "trains/app/"
    return {
        "js_entry": f"{prefix}{js_file}" if js_file else "",
        "css_entries": [f"{prefix}{p}" for p in css_files],
    }


@require_GET
def spa_shell(request: HttpRequest):
    """Serve the React SPA shell. Used by /v2/* in Phase 4 and (after the
    Phase 5 cutover) by /, /setup, and /display."""
    return render(request, "trains/spa.html", _vite_assets())


@require_GET
def api_stations(request: HttpRequest):
    """Per-complex catalog for the React Setup page."""
    return JsonResponse({"complexes": _complex_catalog()})


@require_GET
def api_display(request: HttpRequest):
    """Initial payload for the React Display page.

    Accepts the same query params as /display (s=, m=, n=, f=, d=) so URL
    bookmarks stay compatible.
    """
    subs = parse_subs(request.GET.getlist("s"), request.GET.getlist("m"))
    if _read_legacy_hide_dest(request):
        subs = _apply_legacy_hide_dest(subs)
    font_size = _read_font_size(request)
    n = _read_n(request, default=3)
    now = int(time.time())
    return JsonResponse({
        "server_now": now,
        "feed_age_seconds": feed_age_seconds(now),
        "trains_per_card": n,
        "font_size": font_size,
        "subs": [card_payload(s, now=now, limit=n) for s in subs],
    })
