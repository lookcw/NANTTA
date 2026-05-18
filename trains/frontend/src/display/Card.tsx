import { Chip } from "./Chip";
import { TrainRow } from "./TrainRow";
import type { CardPayload } from "../lib/types";

interface CardProps {
  card: CardPayload;
  now: number;
}

export function Card({ card, now }: CardProps) {
  const { complex, rows, any_show_dest } = card;
  const className = "card" + (any_show_dest ? "" : " card--compact");
  const displayName = complex?.name ?? card.complex_id;

  return (
    <article className={className} id={card.card_id} data-complex-id={card.complex_id}>
      <header className="card__header">
        <h2 className="card__name">{displayName}</h2>
        <div className="card__sub">
          {complex?.borough && <span className="card__borough">{complex.borough}</span>}
        </div>
      </header>
      {any_show_dest ? (
        <ul className="trains">
          {rows.length === 0 ? (
            <li className="train train--empty">no upcoming trains</li>
          ) : (
            rows.map((r, idx) => (
              <TrainRow key={`${r.route}-${r.arrival_epoch}-${idx}`} row={r} now={now} />
            ))
          )}
        </ul>
      ) : (
        <ul className="chips">
          {rows.length === 0 ? (
            <li className="chip chip--empty">no upcoming trains</li>
          ) : (
            rows.map((r, idx) => (
              <Chip key={`${r.route}-${r.arrival_epoch}-${idx}`} row={r} now={now} />
            ))
          )}
        </ul>
      )}
    </article>
  );
}
