import { Bullet } from "../components/Bullet";
import { formatEta } from "../lib/eta";
import type { TrainRow as TrainRowData } from "../lib/types";

interface TrainRowProps {
  row: TrainRowData;
  now: number;
}

export function TrainRow({ row, now }: TrainRowProps) {
  const seconds = Math.max(0, row.arrival_epoch - now);
  const eta = formatEta(seconds);
  const className = "train" + (row.show_dest ? "" : " train--no-dest");
  return (
    <li className={className}>
      <Bullet
        line={row.route}
        background={row.route_color}
        foreground={row.route_text_color}
        express={row.is_express}
      />
      <span className="train__eta" data-arrival-epoch={row.arrival_epoch}>
        {eta}
      </span>
      {row.direction_borough_short && (
        <span className="train__dir">{row.direction_borough_short}</span>
      )}
      {row.show_dest && <span className="train__dest">{row.terminus_name}</span>}
    </li>
  );
}
