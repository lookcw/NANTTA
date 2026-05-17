"""Thread-safe in-memory cache of the latest parsed arrivals across all feeds.

The cache is intentionally simple: one dict keyed by ``parent_stop_id`` whose
value is a sorted list of upcoming ``Arrival`` objects. Writers replace the
whole snapshot atomically; readers get a consistent view via the lock.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Iterable

from .parser import Arrival


class ArrivalsCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_parent: dict[str, list[Arrival]] = {}
        self._updated_at: float = 0.0

    def replace(self, arrivals: Iterable[Arrival]) -> None:
        grouped: dict[str, list[Arrival]] = defaultdict(list)
        for a in arrivals:
            grouped[a.parent_stop_id].append(a)
        for lst in grouped.values():
            lst.sort(key=lambda a: a.arrival_epoch)

        with self._lock:
            self._by_parent = dict(grouped)
            self._updated_at = time.time()

    def for_stop(self, parent_stop_id: str, limit: int = 10) -> list[Arrival]:
        with self._lock:
            return list(self._by_parent.get(parent_stop_id, ()))[:limit]

    def updated_at(self) -> float:
        with self._lock:
            return self._updated_at

    def is_empty(self) -> bool:
        with self._lock:
            return not self._by_parent


cache = ArrivalsCache()
