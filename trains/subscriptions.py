"""Parse subscription parameters from the URL.

Format: repeated ``s`` query params, each ``<stop_id>:<dir>`` where dir is
``N``, ``S``, or ``*``. A missing dir is treated as ``*``.

Examples:
    /display?s=127:N&s=127:S&s=R31:N
    /display?s=127&s=R31         # both directions
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True, slots=True)
class Subscription:
    stop_id: str
    direction: str  # "N", "S", or "*"

    @property
    def card_id(self) -> str:
        return f"card-{self.stop_id}-{self.direction}"


def parse(raw: Iterable[str]) -> list[Subscription]:
    out: list[Subscription] = []
    seen: set[tuple[str, str]] = set()
    for item in raw:
        item = item.strip()
        if not item:
            continue
        if ":" in item:
            sid, _, d = item.partition(":")
            sid = sid.strip()
            d = d.strip().upper() or "*"
        else:
            sid = item
            d = "*"
        if d not in ("N", "S", "*"):
            continue
        if not sid:
            continue
        key = (sid, d)
        if key in seen:
            continue
        seen.add(key)
        out.append(Subscription(stop_id=sid, direction=d))
    return out
