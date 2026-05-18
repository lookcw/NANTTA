import { lineBackground, lineForeground } from "../lib/lineColors";

interface BulletProps {
  /** Line letter/number, e.g. "A", "6", "7X". */
  line: string;
  /** Override colors (Display payloads carry server-supplied colors). */
  background?: string;
  foreground?: string;
  /** Trains-list bullet vs the smaller chip / mini-bullet. */
  size?: "lg" | "sm" | "mini";
  /** Render an express diamond instead of a circle. */
  express?: boolean;
}

/** Line bullet shared between Setup and Display. */
export function Bullet({
  line,
  background,
  foreground,
  size = "lg",
  express = false,
}: BulletProps) {
  const bg = background ?? lineBackground(line);
  const fg = foreground ?? lineForeground(line);

  if (size === "mini") {
    return (
      <span className="mini-bullet" style={{ background: bg, color: fg }}>
        {line}
      </span>
    );
  }

  const sizeClass = size === "sm" ? "bullet bullet--sm" : "bullet";
  const className = express ? `${sizeClass} bullet--express` : sizeClass;
  return (
    <span className={className} style={{ background: bg, color: fg }}>
      <span className="bullet__label">{line}</span>
    </span>
  );
}
