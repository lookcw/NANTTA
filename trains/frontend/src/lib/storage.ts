// localStorage round-trip with migrations for older shapes.
//
// Three generations of the saved config have existed:
//   1. ``{ id: <stop_id>, dir }`` — earliest, one entry per platform stop.
//   2. ``{ cx, dir, lines: [string], mins }`` — per-complex, single direction.
//   3. ``{ cx, mins, lines: [{ line, dir, showDest }] }`` — current per-line.
// Plus the legacy top-level ``showDest: false`` global toggle which the older
// shapes occasionally carried.

import type { Complex, Direction, LineSpec, Subscription, UserConfig } from "./types";
import type { ComplexIndex, StopIndex } from "./subscriptions";

const STORAGE_KEY = "nantta.config";

function isDirection(s: unknown): s is Direction {
  return s === "N" || s === "S" || s === "*";
}

function clampMins(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(raw, 120));
}

export function loadConfig(
  complexes: Complex[] | ComplexIndex,
  byStopId?: StopIndex,
): UserConfig | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const byId: ComplexIndex = Array.isArray(complexes)
    ? new Map(complexes.map((c) => [c.id, c]))
    : complexes;
  const stopIndex: StopIndex = byStopId ?? new Map();
  if (!byStopId && Array.isArray(complexes)) {
    for (const c of complexes) for (const sid of c.stop_ids) stopIndex.set(sid, c.id);
  }

  const cfg = parsed as Partial<UserConfig> & {
    showDest?: boolean; // legacy global toggle
  };
  const legacyHideAll = cfg.showDest === false;
  const subs: Subscription[] = [];

  if (Array.isArray(cfg.subs)) {
    for (const entry of cfg.subs as unknown[]) {
      if (!entry || typeof entry !== "object") continue;
      const sub = migrateOne(entry as Record<string, unknown>, byId, stopIndex, legacyHideAll);
      if (sub && !subs.some((s) => s.cx === sub.cx)) subs.push(sub);
    }
  }

  const nRaw = (cfg as { n?: unknown }).n;
  const n = typeof nRaw === "number" && Number.isFinite(nRaw) ? Math.max(1, Math.min(nRaw, 20)) : 3;

  const fontSizeRaw = (cfg as { fontSize?: unknown }).fontSize;
  const fontSize =
    fontSizeRaw === "s" || fontSizeRaw === "m" || fontSizeRaw === "l" ? fontSizeRaw : "m";

  return { subs, n, fontSize };
}

function migrateOne(
  entry: Record<string, unknown>,
  byId: ComplexIndex,
  byStopId: StopIndex,
  legacyHideAll: boolean,
): Subscription | null {
  // Current per-line shape.
  if (typeof entry.cx === "string" && Array.isArray(entry.lines)
      && entry.lines.length > 0 && typeof entry.lines[0] === "object") {
    const cx = byId.get(entry.cx);
    if (!cx) return null;
    const validLines = new Set(cx.lines);
    const lines: LineSpec[] = [];
    for (const l of entry.lines as unknown[]) {
      if (!l || typeof l !== "object") continue;
      const rec = l as Record<string, unknown>;
      if (typeof rec.line !== "string" || !validLines.has(rec.line)) continue;
      if (!isDirection(rec.dir)) continue;
      const showDest = legacyHideAll ? false : rec.showDest !== false;
      lines.push({ line: rec.line, dir: rec.dir, showDest });
    }
    return { cx: entry.cx, mins: clampMins(entry.mins), lines };
  }

  // Per-complex with single direction.
  if (typeof entry.cx === "string"
      && (typeof entry.dir === "string" || Array.isArray(entry.lines))) {
    const cx = byId.get(entry.cx);
    if (!cx) return null;
    const dir: Direction = isDirection(entry.dir) ? entry.dir : "*";
    const sourceLines =
      Array.isArray(entry.lines) && entry.lines.length
        ? (entry.lines as unknown[]).filter((l): l is string => typeof l === "string")
        : cx.lines;
    const lines: LineSpec[] = sourceLines
      .filter((l) => cx.lines.includes(l))
      .map((l) => ({ line: l, dir, showDest: !legacyHideAll }));
    return { cx: entry.cx, mins: clampMins(entry.mins), lines };
  }

  // Earliest shape: { id: <stop_id>, dir }.
  if (typeof entry.id === "string") {
    const cxId = byStopId.get(entry.id);
    if (!cxId) return null;
    const cx = byId.get(cxId);
    if (!cx) return null;
    const dir: Direction = isDirection(entry.dir) ? entry.dir : "*";
    return {
      cx: cxId,
      mins: 0,
      lines: cx.lines.map((line) => ({ line, dir, showDest: !legacyHideAll })),
    };
  }

  return null;
}

export function saveConfig(config: UserConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private mode / quota — ignore */
  }
}

export const STORAGE_KEY_NAME = STORAGE_KEY;
