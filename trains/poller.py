"""Background poller: fetches every MTA realtime feed on an interval and
replaces the in-memory arrivals cache with the freshly parsed result.
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

from apscheduler.schedulers.background import BackgroundScheduler

from .cache import cache
from .feeds import FEEDS
from .parser import fetch_feed, parse_feed

log = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = int(os.environ.get("NANTTA_POLL_SECONDS", "10"))

_scheduler: BackgroundScheduler | None = None


def poll_once() -> int:
    """Fetch all feeds in parallel, parse, replace cache. Returns # arrivals."""
    arrivals = []
    with ThreadPoolExecutor(max_workers=len(FEEDS)) as pool:
        futures = {pool.submit(fetch_feed, url): name for name, url in FEEDS.items()}
        for fut in as_completed(futures):
            name = futures[fut]
            try:
                payload = fut.result()
                arrivals.extend(parse_feed(payload))
            except Exception:  # noqa: BLE001
                log.exception("feed %s failed", name)
    cache.replace(arrivals)
    log.info("polled MTA feeds: %d arrivals across %d stops", len(arrivals), len({a.parent_stop_id for a in arrivals}))
    return len(arrivals)


def start() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    sched = BackgroundScheduler(daemon=True, timezone="UTC")
    sched.add_job(
        poll_once,
        "interval",
        seconds=POLL_INTERVAL_SECONDS,
        next_run_time=None,  # don't wait — kick off immediately below
        max_instances=1,
        coalesce=True,
    )
    sched.start()
    _scheduler = sched
    # Prime the cache synchronously on startup so the first request isn't empty.
    try:
        poll_once()
    except Exception:  # noqa: BLE001
        log.exception("initial poll failed; cache will fill on next tick")
