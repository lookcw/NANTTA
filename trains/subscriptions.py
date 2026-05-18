"""Parse subscription parameters from the URL.

A subscription is one station-complex card on /display, with per-line
direction filtering:

- ``complex_id``  — MTA Complex ID (e.g. ``611`` for Times Sq)
- ``line_specs``  — tuple of ``LineSpec(line, direction)``. Empty tuple = all
                    lines at the complex with direction "*".
- ``min_mins``    — minimum minutes-until-arrival; trains arriving sooner are
                    hidden (applies to the whole complex).

URL formats accepted:

- ``s=cx<complex_id>``                  — all lines, both directions (the default)
- ``s=cx<complex_id>:<dir>``            — all lines, one direction (``N|S|*``)
- ``s=cx<complex_id>:<spec>``           — per-line: comma-separated ``line[=dir][-]``
                                          entries, e.g. ``1=N,2=*,3=S-``.
                                          Trailing ``-`` on an entry hides the
                                          destination terminus for that line.
- ``s=<stop_id>``                       — legacy: resolves to the stop's complex,
                                          lines = the stop's daytime routes,
                                          all direction "*"
- ``s=<stop_id>:<dir>``                 — legacy: as above with one direction

Min-mins is a repeated separate param keyed by complex_id:

- ``m=cx<complex_id>:<min_minutes>`` (or ``m=<complex_id>:<min_minutes>``)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .stations import registry


@dataclass(frozen=True, slots=True)
class LineSpec:
    line: str
    direction: str  # "N", "S", or "*"
    show_dest: bool = True


@dataclass(frozen=True, slots=True)
class Subscription:
    complex_id: str
    line_specs: tuple[LineSpec, ...]
    min_mins: int = 0

    @property
    def card_id(self) -> str:
        return f"card-cx{self.complex_id}"


def _strip_cx(s: str) -> str:
    return s[2:] if s.startswith("cx") else s


def parse(
    raw_subs: Iterable[str],
    raw_mins: Iterable[str] = (),
) -> list[Subscription]:
    """Parse repeated ``s=`` and ``m=`` query params into a list of subs.

    Multiple entries for the same complex are merged — line_specs union (with
    a per-line direction conflict resolving to "*"), min_mins taking the max.
    """
    # complex_id -> {line -> (dir, show_dest)}
    pending: dict[str, dict[str, tuple[str, bool]]] = {}
    order: list[str] = []

    for raw in raw_subs:
        parsed = _parse_one_sub(raw)
        if parsed is None:
            continue
        cx_id, specs = parsed
        if cx_id not in pending:
            pending[cx_id] = {}
            order.append(cx_id)
        for line, direction, show_dest in specs:
            existing = pending[cx_id].get(line)
            if existing is None:
                pending[cx_id][line] = (direction, show_dest)
            else:
                prev_dir, prev_show = existing
                # Direction conflict resolves to "*"; show_dest conflict resolves
                # to True (show), favoring the more-informative display.
                merged_dir = prev_dir if prev_dir == direction else "*"
                merged_show = prev_show or show_dest
                pending[cx_id][line] = (merged_dir, merged_show)

    mins_by_complex: dict[str, int] = {}
    for raw in raw_mins:
        parts = raw.strip().split(":")
        if len(parts) != 2:
            continue
        cid_raw, mins_raw = parts[0].strip(), parts[1].strip()
        cid = _strip_cx(cid_raw)
        try:
            mins = int(mins_raw)
        except ValueError:
            continue
        mins = max(0, min(mins, 120))
        if mins <= 0:
            continue
        if not registry.get_complex(cid):
            complex_obj = registry.complex_for_stop(cid)
            if complex_obj:
                cid = complex_obj.id
        mins_by_complex[cid] = max(mins_by_complex.get(cid, 0), mins)

    out: list[Subscription] = []
    for cx_id in order:
        line_specs = tuple(
            LineSpec(line=line, direction=direction, show_dest=show_dest)
            for line, (direction, show_dest) in pending[cx_id].items()
        )
        out.append(Subscription(
            complex_id=cx_id,
            line_specs=line_specs,
            min_mins=mins_by_complex.get(cx_id, 0),
        ))
    return out


def _parse_one_sub(raw: str) -> tuple[str, list[tuple[str, str, bool]]] | None:
    """Return ``(complex_id, [(line, dir, show_dest), ...])`` for one ``s=`` value, or None."""
    raw = raw.strip()
    if not raw:
        return None
    parts = raw.split(":", 1)
    head = parts[0].strip()
    if not head:
        return None
    has_cx_prefix = head.startswith("cx")
    raw_id = _strip_cx(head)
    if not raw_id:
        return None

    # Resolve to a complex first.
    complex_obj = None
    inherit_lines: tuple[str, ...] | None = None
    if has_cx_prefix:
        complex_obj = registry.get_complex(raw_id)
        if complex_obj is None:
            return None
    else:
        # Unprefixed: try stop_id first (legacy URLs typically referenced a
        # specific platform), then complex_id.
        complex_obj = registry.complex_for_stop(raw_id)
        if complex_obj:
            station = registry.get(raw_id)
            if station and station.lines:
                inherit_lines = tuple(station.lines)
        else:
            complex_obj = registry.get_complex(raw_id)
            if complex_obj is None:
                return None

    cx_id = complex_obj.id
    spec_str = parts[1].strip() if len(parts) > 1 else ""

    # Default: all complex lines (or inherited stop lines), direction "*"
    if not spec_str:
        lines = inherit_lines or complex_obj.lines
        return cx_id, [(line, "*", True) for line in lines]

    # Direction-only form: "N", "S", "*" — applies to all complex/inherited lines.
    if spec_str in ("N", "S", "*"):
        lines = inherit_lines or complex_obj.lines
        return cx_id, [(line, spec_str, True) for line in lines]

    # Per-line form: comma-separated "line[=dir][-]".  Trailing "-" hides the
    # destination terminus for that line.
    valid_lines = set(complex_obj.lines)
    specs: list[tuple[str, str, bool]] = []
    for entry in spec_str.split(","):
        entry = entry.strip()
        if not entry:
            continue
        show_dest = True
        if entry.endswith("-"):
            show_dest = False
            entry = entry[:-1]
        if "=" in entry:
            line, _, dir_raw = entry.partition("=")
            line = line.strip()
            direction = dir_raw.strip().upper() or "*"
        else:
            line = entry
            direction = "*"
        if line not in valid_lines:
            continue
        if direction not in ("N", "S", "*"):
            continue
        specs.append((line, direction, show_dest))

    if not specs:
        # Malformed spec → fall back to all lines, both directions.
        lines = inherit_lines or complex_obj.lines
        return cx_id, [(line, "*", True) for line in lines]

    return cx_id, specs
