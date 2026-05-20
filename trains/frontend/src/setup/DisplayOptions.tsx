import { useEffect, useRef, useState } from "react";
import type { FontSize } from "../lib/types";

interface DisplayOptionsProps {
  n: number;
  fontSize: FontSize;
  onNChange: (n: number) => void;
  onFontSizeChange: (size: FontSize) => void;
}

export function DisplayOptions({ n, fontSize, onNChange, onFontSizeChange }: DisplayOptionsProps) {
  const [text, setText] = useState(String(n));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(String(n));
  }, [n]);

  return (
    <>
      <div className="options-grid">
        <div className="option option--inline">
          <label htmlFor="opt-n">Trains per direction</label>
          <input
            ref={inputRef}
            id="opt-n"
            type="number"
            min={1}
            max={20}
            step={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) onNChange(Math.max(1, Math.min(v, 20)));
            }}
            onBlur={() => setText(String(n))}
          />
        </div>
        <div className="option option--inline">
          <label>Text size</label>
          <div id="size-toggle" className="size-toggle" role="radiogroup">
            {(["s", "m", "l"] as const).map((s) => (
              <button
                key={s}
                type="button"
                data-size={s}
                aria-pressed={fontSize === s}
                onClick={() => onFontSizeChange(s)}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="muted options-note">
        Pick destinations on each line, in the Selected list.
      </p>
    </>
  );
}
