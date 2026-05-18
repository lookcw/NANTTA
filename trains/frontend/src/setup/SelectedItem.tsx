import { useEffect, useRef, useState } from "react";
import { Bullet } from "../components/Bullet";
import { LineRow } from "./LineRow";
import type { Complex, Direction, Subscription } from "../lib/types";

interface SelectedItemProps {
  sub: Subscription;
  complex: Complex;
  expanded: boolean;
  onToggleExpanded: () => void;
  onRemove: () => void;
  onChange: (next: Subscription) => void;
}

export function SelectedItem({
  sub,
  complex,
  expanded,
  onToggleExpanded,
  onRemove,
  onChange,
}: SelectedItemProps) {
  // Local text state for the min-mins input so the user can clear and retype
  // without the displayed value snapping back on each keystroke.
  const [minsText, setMinsText] = useState(sub.mins > 0 ? String(sub.mins) : "");
  const minsInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (document.activeElement !== minsInputRef.current) {
      setMinsText(sub.mins > 0 ? String(sub.mins) : "");
    }
  }, [sub.mins]);

  function toggleLine(line: string) {
    const idx = sub.lines.findIndex((l) => l.line === line);
    let nextLines = sub.lines.slice();
    if (idx === -1) {
      nextLines.push({ line, dir: "*", showDest: true });
    } else {
      nextLines.splice(idx, 1);
    }
    // Keep complex-line order stable.
    nextLines.sort(
      (a, b) => complex.lines.indexOf(a.line) - complex.lines.indexOf(b.line),
    );
    onChange({ ...sub, lines: nextLines });
  }

  function setLineDir(line: string, dir: Direction) {
    onChange({
      ...sub,
      lines: sub.lines.map((l) => (l.line === line ? { ...l, dir } : l)),
    });
  }

  function setLineShowDest(line: string, showDest: boolean) {
    onChange({
      ...sub,
      lines: sub.lines.map((l) => (l.line === line ? { ...l, showDest } : l)),
    });
  }

  function commitMins(raw: string) {
    const v = parseInt(raw, 10);
    const next = Number.isFinite(v) && v > 0 ? Math.min(v, 120) : 0;
    if (next !== sub.mins) onChange({ ...sub, mins: next });
  }

  return (
    <li className="selected__item">
      <div className="selected__row">
        <button
          type="button"
          className="selected__toggle"
          title={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
          onClick={onToggleExpanded}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <div className="selected__main">
          <div className="selected__name">{complex.name}</div>
          <div className="selected__meta">
            <span className="mini-bullets">
              {complex.lines.map((l) => (
                <Bullet key={l} line={l} size="mini" />
              ))}
            </span>
            <span className="muted">{complex.borough || ""}</span>
          </div>
        </div>
        <label
          className="mins-inline"
          title="Hide trains arriving sooner than this (minutes from now)"
        >
          <input
            ref={minsInputRef}
            type="number"
            min={0}
            max={120}
            step={1}
            placeholder="0"
            value={minsText}
            onChange={(e) => {
              setMinsText(e.target.value);
              commitMins(e.target.value);
            }}
            onBlur={() => setMinsText(sub.mins > 0 ? String(sub.mins) : "")}
          />
          <span className="mins-inline__suffix">min+</span>
        </label>
        <button
          type="button"
          className="remove-btn"
          title="Remove"
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      <div className="selected__body" hidden={!expanded}>
        <p className="selected__body-note">
          Pick the lines and the direction for each. Trains arriving in less than the “min+” minutes won't be shown.
        </p>
        <div className="line-rows">
          {complex.lines.map((line) => (
            <LineRow
              key={line}
              complex={complex}
              line={line}
              spec={sub.lines.find((l) => l.line === line)}
              onToggle={() => toggleLine(line)}
              onSetDir={(dir) => setLineDir(line, dir)}
              onSetShowDest={(showDest) => setLineShowDest(line, showDest)}
            />
          ))}
        </div>
      </div>
    </li>
  );
}
