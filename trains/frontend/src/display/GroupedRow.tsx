import { Bullet } from "../components/Bullet";
import type { TrainRow } from "../lib/types";

export interface RowGroup {
  key: string;
  route: string;
  route_color: string;
  route_text_color: string;
  is_express: boolean;
  direction: string;
  direction_borough_short: string;
  show_dest: boolean;
  terminus_name: string;
  times: TrainRow[];
}

interface GroupedRowProps {
  group: RowGroup;
  now: number;
}

export function GroupedRow({ group, now }: GroupedRowProps) {
  const className = "grouped-row" + (group.show_dest && group.terminus_name ? "" : " grouped-row--no-dest");
  const times = group.times.map((t) => {
    const seconds = Math.max(0, t.arrival_epoch - now);
    return {
      arrival_epoch: t.arrival_epoch,
      label: seconds <= 30 ? "now" : String(Math.round(seconds / 60)),
      isNow: seconds <= 30,
    };
  });
  const hasNumeric = times.some((t) => !t.isNow);
  return (
    <li className={className}>
      <Bullet
        line={group.route}
        background={group.route_color}
        foreground={group.route_text_color}
        express={group.is_express}
      />
      {group.direction_borough_short && (
        <span className="grouped-row__dir">{group.direction_borough_short}</span>
      )}
      {group.show_dest && group.terminus_name && (
        <span className="grouped-row__dest">{group.terminus_name}</span>
      )}
      <span className="grouped-row__times">
        {times.map((t, idx) => (
          <span
            key={`${t.arrival_epoch}-${idx}`}
            className="grouped-row__time"
            data-arrival-epoch={t.arrival_epoch}
          >
            {t.label}
          </span>
        ))}
        {hasNumeric && <span className="grouped-row__unit">min</span>}
      </span>
    </li>
  );
}
