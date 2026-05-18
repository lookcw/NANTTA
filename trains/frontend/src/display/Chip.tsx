import { Bullet } from "../components/Bullet";
import { formatEta } from "../lib/eta";
import type { TrainRow } from "../lib/types";

interface ChipProps {
  row: TrainRow;
  now: number;
}

export function Chip({ row, now }: ChipProps) {
  const seconds = Math.max(0, row.arrival_epoch - now);
  const eta = formatEta(seconds);
  return (
    <li className="chip">
      <Bullet
        line={row.route}
        background={row.route_color}
        foreground={row.route_text_color}
        size="sm"
        express={row.is_express}
      />
      <span className="chip__eta" data-arrival-epoch={row.arrival_epoch}>
        {eta}
      </span>
      {row.direction_borough_short && (
        <span className="chip__dir">{row.direction_borough_short}</span>
      )}
    </li>
  );
}
