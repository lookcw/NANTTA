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
from .render import feed_age_seconds, render_card
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


def _sub_to_url_value(sub) -> str:
    """Canonical URL form for a Subscription's ``s=`` param.

    - All complex lines + same direction + all show_dest=True → ``cx<id>[:<dir>]`` shorthand
    - Otherwise → ``cx<id>:line1=dir1[-],line2=dir2[-],...``
    """
    cx = registry.get_complex(sub.complex_id)
    if cx is None or not sub.line_specs:
        return f"cx{sub.complex_id}"

    dirs = {ls.direction for ls in sub.line_specs}
    sub_lines = {ls.line for ls in sub.line_specs}
    all_show = all(ls.show_dest for ls in sub.line_specs)
    if all_show and sub_lines == set(cx.lines) and len(dirs) == 1:
        only_dir = next(iter(dirs))
        return f"cx{sub.complex_id}" if only_dir == "*" else f"cx{sub.complex_id}:{only_dir}"

    parts = [f"{ls.line}={ls.direction}{'' if ls.show_dest else '-'}" for ls in sub.line_specs]
    return f"cx{sub.complex_id}:" + ",".join(parts)


@require_GET
def display(request: HttpRequest):
    subs = parse_subs(request.GET.getlist("s"), request.GET.getlist("m"))
    if _read_legacy_hide_dest(request):
        subs = _apply_legacy_hide_dest(subs)
    font_size = _read_font_size(request)
    n = _read_n(request, default=3)
    now = int(time.time())
    cards = [render_card(s, now=now, limit=n) for s in subs]

    common_params: list[tuple[str, str]] = [("s", _sub_to_url_value(s)) for s in subs]
    common_params.append(("n", str(n)))
    common_params.append(("f", font_size))
    # Min-mins is per-complex; emit one m= per distinct (complex, mins) pair.
    seen_mins: set[str] = set()
    for s in subs:
        if s.min_mins and s.complex_id not in seen_mins:
            common_params.append(("m", f"cx{s.complex_id}:{s.min_mins}"))
            seen_mins.add(s.complex_id)

    return render(request, "trains/display.html", {
        "subs": subs,
        "cards": cards,
        "stream_url": f"/display/stream?{urlencode(common_params)}" if subs else "",
        "setup_url": f"/setup?{urlencode(common_params)}" if subs else "/setup",
        "feed_age": feed_age_seconds(now),
        "trains_per_card": n,
        "font_size": font_size,
    })


def display_stream(request: HttpRequest):
    """SSE endpoint pushing Turbo Stream updates for every subscribed card."""
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
            payload_parts: list[str] = []
            for s in subs:
                html = render_card(s, now=now, limit=n)
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


@require_GET
def setup(request: HttpRequest):
    """Render the setup page with the complex list embedded as JSON.

    Setup now operates on complexes (one row per transfer station) rather
    than per-platform stop_ids. Each complex carries:
      - id, name, borough, lines (union of member lines)
      - n_short / s_short: best-effort borough codes for the direction toggle
      - search_haystack: extra tokens for the search box (member stop_ids and
        per-platform names) so typing "F09" or "Court Sq-23 St" still finds
        the Court Sq complex.
    """
    from .stations import STATIONS_JSON, direction_borough_short
    try:
        with open(STATIONS_JSON, encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        raw = {}
    stops_raw = raw.get("stops") or {}
    complexes_raw = raw.get("complexes") or {}

    complexes_list = []
    for cid, row in complexes_raw.items():
        member_stops = [stops_raw[sid] for sid in row.get("stop_ids", []) if sid in stops_raw]

        # Per-line direction labels: each line at this complex carries its
        # own N/S labels (from whichever platform actually serves that line).
        # Setup uses these so the per-line toggle says "QNS / MAN / Both"
        # with the correct codes for that line.
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
    return render(request, "trains/setup.html", {
        "stations_json": json.dumps(complexes_list),
    })
