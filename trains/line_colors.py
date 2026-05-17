"""Official MTA line colors for the line-bullet badges on the wall display."""

from __future__ import annotations

# Source: https://new.mta.info/document/8506 — MTA line colors style guide.
LINE_COLORS: dict[str, str] = {
    "1": "#EE352E", "2": "#EE352E", "3": "#EE352E",
    "4": "#00933C", "5": "#00933C", "6": "#00933C", "6X": "#00933C",
    "7": "#B933AD", "7X": "#B933AD",
    "A": "#0039A6", "C": "#0039A6", "E": "#0039A6",
    "B": "#FF6319", "D": "#FF6319", "F": "#FF6319", "M": "#FF6319", "FX": "#FF6319",
    "G": "#6CBE45",
    "J": "#996633", "Z": "#996633",
    "L": "#A7A9AC",
    "N": "#FCCC0A", "Q": "#FCCC0A", "R": "#FCCC0A", "W": "#FCCC0A",
    "S": "#808183", "GS": "#6CBE45", "FS": "#808183", "H": "#808183",
    "SI": "#0078C6", "SIR": "#0078C6",
}

# Lines whose bullets need dark text on a light/yellow background.
DARK_TEXT_LINES: set[str] = {"N", "Q", "R", "W", "L"}


def color_for(route_id: str) -> str:
    return LINE_COLORS.get(route_id, "#666666")


def text_color_for(route_id: str) -> str:
    return "#000000" if route_id in DARK_TEXT_LINES else "#ffffff"
