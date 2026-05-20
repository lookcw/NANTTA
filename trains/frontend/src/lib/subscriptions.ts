// URL ↔ Subscription[] parser and serializer.
//
// Single source of truth for the s=/m=/n=/f=/d= query-string contract that
// both the Setup page (generates URLs) and the Display page (parses URLs)
// need to agree on. Ported from trains/subscriptions.py and the
// _resolveSubFromRaw / _parseLineSpecPart helpers in the old setup.js.

import type {
  Complex,
  Direction,
  FontSize,
  LineSpec,
  Subscription,
  UserConfig,
} from "./types";

const VALID_DIRS: Direction[] = ["N", "S", "*"];

function isDirection(s: string): s is Direction {
  return s === "N" || s === "S" || s === "*";
}

function isFontSize(s: string | null): s is FontSize {
  return s === "s" || s === "m" || s === "l";
}

/** Map of complex_id → Complex for fast lookup. */
export type ComplexIndex = Map<string, Complex>;

/** Map of stop_id → complex_id for the legacy ``s=<stop_id>`` shape. */
export type StopIndex = Map<string, string>;

export function indexComplexes(complexes: Complex[]): {
  byId: ComplexIndex;
  byStopId: StopIndex;
} {
  const byId = new Map<string, Complex>();
  const byStopId = new Map<string, string>();
  for (const c of complexes) {
    byId.set(c.id, c);
    for (const sid of c.stop_ids) byStopId.set(sid, c.id);
  }
  return { byId, byStopId };
}

/** If a line only has labels in one direction at a complex it's a terminus,
 *  so the UI defaults to that direction instead of dangling a "Both" choice. */
export function aliveDirection(complex: Complex, line: string): Direction | null {
  const info = complex.line_info.find((li) => li.line === line);
  if (!info) return null;
  const hasN = !!info.n_label;
  const hasS = !!info.s_label;
  if (hasN && !hasS) return "N";
  if (!hasN && hasS) return "S";
  return null;
}

export function defaultLineSpecs(complex: Complex): LineSpec[] {
  return complex.lines.map((line) => ({
    line,
    dir: aliveDirection(complex, line) ?? "*",
    showDest: false,
  }));
}

function parseLineSpecPart(spec: string, complex: Complex): LineSpec[] {
  if (!spec) return defaultLineSpecs(complex);
  if (isDirection(spec)) {
    return complex.lines.map((line) => ({ line, dir: spec, showDest: true }));
  }
  const validLines = new Set(complex.lines);
  const out: LineSpec[] = [];
  for (let entry of spec.split(",")) {
    entry = entry.trim();
    if (!entry) continue;
    let showDest = true;
    if (entry.endsWith("-")) {
      showDest = false;
      entry = entry.slice(0, -1);
    }
    let line: string;
    let dir: string;
    if (entry.includes("=")) {
      const [lineRaw, dirRaw] = entry.split("=");
      line = (lineRaw ?? "").trim();
      dir = ((dirRaw ?? "*").trim() || "*").toUpperCase();
    } else {
      line = entry;
      dir = "*";
    }
    if (!validLines.has(line)) continue;
    if (!isDirection(dir)) continue;
    out.push({ line, dir, showDest });
  }
  return out.length ? out : defaultLineSpecs(complex);
}

function resolveSubFromRaw(raw: string, idx: { byId: ComplexIndex; byStopId: StopIndex }): Subscription | null {
  const colonIdx = raw.indexOf(":");
  const head = colonIdx === -1 ? raw : raw.slice(0, colonIdx);
  const spec = colonIdx === -1 ? "" : raw.slice(colonIdx + 1);

  let cxId: string | null = null;
  let complex: Complex | undefined;
  let inheritLines: string[] | null = null;

  if (head.startsWith("cx")) {
    const candidate = head.slice(2);
    complex = idx.byId.get(candidate);
    if (complex) cxId = candidate;
  } else {
    // Unprefixed: try legacy stop_id first, then complex_id.
    const fromStop = idx.byStopId.get(head);
    if (fromStop) {
      cxId = fromStop;
      complex = idx.byId.get(fromStop);
      if (complex) inheritLines = complex.lines.slice();
    } else if (idx.byId.has(head)) {
      cxId = head;
      complex = idx.byId.get(head);
    }
  }
  if (!cxId || !complex) return null;

  let lines: LineSpec[];
  if (spec === "" && inheritLines) {
    lines = inheritLines.map((l) => ({ line: l, dir: "*", showDest: true }));
  } else {
    lines = parseLineSpecPart(spec, complex);
  }
  return { cx: cxId, mins: 0, lines };
}

/** Parse all s=/m=/n=/f=/d= params into a UserConfig. */
export function parseUrlConfig(
  params: URLSearchParams,
  complexes: Complex[] | ComplexIndex,
): { config: UserConfig; hasSubs: boolean } {
  const idx = Array.isArray(complexes)
    ? indexComplexes(complexes)
    : (() => {
        const byStopId = new Map<string, string>();
        for (const c of complexes.values()) {
          for (const sid of c.stop_ids) byStopId.set(sid, c.id);
        }
        return { byId: complexes, byStopId };
      })();

  const subs: Subscription[] = [];
  for (const raw of params.getAll("s")) {
    const parsed = resolveSubFromRaw(raw.trim(), idx);
    if (!parsed) continue;
    if (subs.some((s) => s.cx === parsed.cx)) continue;
    subs.push(parsed);
  }

  for (const raw of params.getAll("m")) {
    const parts = raw.trim().split(":");
    if (parts.length !== 2) continue;
    const head = parts[0];
    const minsRaw = parts[1];
    if (!head || !minsRaw) continue;
    const mins = parseInt(minsRaw, 10);
    if (!Number.isFinite(mins) || mins <= 0) continue;
    const cid = head.startsWith("cx") ? head.slice(2) : head;
    const sub = subs.find((s) => s.cx === cid);
    if (sub) sub.mins = Math.min(mins, 120);
  }

  // Legacy ``d=0`` was a global "hide destinations" toggle; apply per-line.
  const dParam = params.get("d");
  if (dParam === "0" || dParam === "false" || dParam === "no") {
    for (const sub of subs) for (const l of sub.lines) l.showDest = false;
  }

  const nRaw = parseInt(params.get("n") ?? "", 10);
  const n = Number.isFinite(nRaw) ? Math.max(1, Math.min(nRaw, 20)) : 2;

  const fRaw = params.get("f");
  const fontSize: FontSize = isFontSize(fRaw) ? fRaw : "m";

  return {
    config: { subs, n, fontSize },
    hasSubs: subs.length > 0,
  };
}

/** Serialize one subscription to its canonical ``s=`` value. */
export function subToUrlValue(sub: Subscription, complex: Complex): string | null {
  if (!sub.lines.length) return null;
  const dirs = new Set(sub.lines.map((l) => l.dir));
  const allLinesIncluded = sub.lines.length === complex.lines.length;
  const allShowDest = sub.lines.every((l) => l.showDest);
  if (allShowDest && allLinesIncluded && dirs.size === 1) {
    const only = sub.lines[0]!.dir;
    return only === "*" ? `cx${sub.cx}` : `cx${sub.cx}:${only}`;
  }
  const parts = sub.lines.map((l) => `${l.line}=${l.dir}${l.showDest ? "" : "-"}`);
  return `cx${sub.cx}:${parts.join(",")}`;
}

/** Build the query string for /display or /api/display from a UserConfig. */
export function buildSearch(config: UserConfig, byId: ComplexIndex): string {
  const params = new URLSearchParams();
  for (const sub of config.subs) {
    const cx = byId.get(sub.cx);
    if (!cx) continue;
    const v = subToUrlValue(sub, cx);
    if (v) params.append("s", v);
  }
  for (const sub of config.subs) {
    if (sub.mins > 0) params.append("m", `cx${sub.cx}:${sub.mins}`);
  }
  params.set("n", String(config.n));
  params.set("f", config.fontSize);
  return params.toString();
}

export const validDirections = VALID_DIRS;
