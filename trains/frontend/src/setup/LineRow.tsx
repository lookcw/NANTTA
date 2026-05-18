import { Bullet } from "../components/Bullet";
import { aliveDirection } from "../lib/subscriptions";
import type { Complex, Direction, LineSpec } from "../lib/types";

interface LineRowProps {
  complex: Complex;
  line: string;
  /** Current spec for this line, or undefined when the line is toggled off. */
  spec: LineSpec | undefined;
  onToggle: () => void;
  onSetDir: (dir: Direction) => void;
  onSetShowDest: (showDest: boolean) => void;
}

export function LineRow({ complex, line, spec, onToggle, onSetDir, onSetShowDest }: LineRowProps) {
  const isOn = !!spec;
  const info = complex.line_info.find((li) => li.line === line) ?? null;
  const alive = aliveDirection(complex, line);
  const currentDir: Direction = spec ? spec.dir : (alive ?? "*");
  const destOn = spec ? spec.showDest : true;

  const rowClass = "line-row" + (isOn ? "" : " line-row--off");

  return (
    <div className={rowClass}>
      <label className="line-row__cb">
        <input type="checkbox" checked={isOn} onChange={onToggle} />
      </label>
      <Bullet line={line} size="mini" />

      {alive ? (
        <div className="line-row__static-dir">
          <span
            className="line-row__dir-label"
            title={alive === "N" ? (info?.n_label ?? "Northbound") : (info?.s_label ?? "Southbound")}
          >
            {alive === "N" ? (info?.n_short || "N") : (info?.s_short || "S")}
          </span>
          <span className="line-row__terminus">terminus</span>
        </div>
      ) : (
        <div className="dir-toggle dir-toggle--row" role="radiogroup">
          {(
            [
              ["N", info?.n_short || "N", info?.n_label || "Northbound"],
              ["S", info?.s_short || "S", info?.s_label || "Southbound"],
              ["*", "Both", "Both directions"],
            ] as const
          ).map(([dir, text, title]) => (
            <button
              key={dir}
              type="button"
              title={title}
              aria-pressed={currentDir === dir}
              data-dir={dir}
              disabled={!isOn}
              onClick={() => isOn && onSetDir(dir as Direction)}
            >
              {text}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className={"line-row__dest-toggle" + (destOn ? " line-row__dest-toggle--on" : "")}
        title={destOn ? "Hide destination on this line" : "Show destination on this line"}
        aria-pressed={destOn}
        disabled={!isOn}
        onClick={() => isOn && onSetShowDest(!destOn)}
      >
        {destOn ? "Dest. on" : "Dest. off"}
      </button>
    </div>
  );
}
