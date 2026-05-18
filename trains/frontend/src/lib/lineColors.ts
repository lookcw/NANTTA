// Port of setup.js's LINE_COLORS / DARK_TEXT. The wall display gets colors
// from the backend (line_colors.py colors the bullets server-side), but
// Setup needs them client-side for the search-results and per-line bullets.

const LINE_COLORS: Record<string, string> = {
  "1": "#EE352E", "2": "#EE352E", "3": "#EE352E",
  "4": "#00933C", "5": "#00933C", "6": "#00933C", "6X": "#00933C",
  "7": "#B933AD", "7X": "#B933AD",
  "A": "#0039A6", "C": "#0039A6", "E": "#0039A6",
  "B": "#FF6319", "D": "#FF6319", "F": "#FF6319", "M": "#FF6319",
  "G": "#6CBE45",
  "J": "#996633", "Z": "#996633",
  "L": "#A7A9AC",
  "N": "#FCCC0A", "Q": "#FCCC0A", "R": "#FCCC0A", "W": "#FCCC0A",
  "S": "#808183", "SI": "#0078C6", "SIR": "#0078C6",
};

const DARK_TEXT = new Set(["N", "Q", "R", "W", "L"]);

export function lineBackground(line: string): string {
  return LINE_COLORS[line] ?? "#666";
}

export function lineForeground(line: string): string {
  return DARK_TEXT.has(line) ? "#000" : "#fff";
}
