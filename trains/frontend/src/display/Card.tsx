import { GroupedRow, type RowGroup } from "./GroupedRow";
import type { CardPayload, TrainRow } from "../lib/types";

interface CardProps {
  card: CardPayload;
  now: number;
}

function groupRows(rows: TrainRow[], lineOrder: string[]): RowGroup[] {
  const groups = new Map<string, RowGroup & { _termCounts: Map<string, number> }>();
  for (const r of rows) {
    const key = `${r.route}|${r.direction}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        route: r.route,
        route_color: r.route_color,
        route_text_color: r.route_text_color,
        is_express: r.is_express,
        direction: r.direction,
        direction_borough_short: r.direction_borough_short,
        show_dest: false,
        terminus_name: "",
        times: [],
        _termCounts: new Map(),
      };
      groups.set(key, g);
    }
    g.times.push(r);
    if (r.show_dest) g.show_dest = true;
    if (r.terminus_name) {
      g._termCounts.set(r.terminus_name, (g._termCounts.get(r.terminus_name) ?? 0) + 1);
    }
  }
  const lineIdx = (route: string) => {
    const i = lineOrder.indexOf(route);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const dirIdx = (d: string) => (d === "N" ? 0 : d === "S" ? 1 : 2);
  return Array.from(groups.values())
    .map((g) => {
      let topName = "";
      let topCount = 0;
      for (const [name, count] of g._termCounts) {
        if (count > topCount) {
          topName = name;
          topCount = count;
        }
      }
      const { _termCounts: _drop, ...rest } = g;
      return { ...rest, terminus_name: topName };
    })
    .sort((a, b) => {
      const d = lineIdx(a.route) - lineIdx(b.route);
      if (d !== 0) return d;
      return dirIdx(a.direction) - dirIdx(b.direction);
    });
}

export function Card({ card, now }: CardProps) {
  const { complex, rows } = card;
  const groups = groupRows(rows, complex?.lines ?? []);
  const anyDest = groups.some((g) => g.show_dest && g.terminus_name);
  const className = "card" + (anyDest ? "" : " card--compact");
  const displayName = complex?.name ?? card.complex_id;

  return (
    <article className={className} id={card.card_id} data-complex-id={card.complex_id}>
      <header className="card__header">
        <h2 className="card__name">{displayName}</h2>
      </header>
      <ul className="grouped-rows">
        {groups.length === 0 ? (
          <li className="grouped-row grouped-row--empty">no upcoming trains</li>
        ) : (
          groups.map((g) => <GroupedRow key={g.key} group={g} now={now} />)
        )}
      </ul>
    </article>
  );
}
