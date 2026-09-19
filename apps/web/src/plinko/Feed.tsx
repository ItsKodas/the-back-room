import { multText } from "@backroom/game-plinko";
import type { PlinkoDrop, PlinkoWatcher } from "@backroom/shared";
import type { CSSProperties } from "react";
import { exact } from "../game/money.js";

/**
 * What the floor has been doing. One markup: a phone shows a row of
 * multiplier chips, a desk the whole list — the arrangement is the stylesheet's.
 */
export function Feed({ drops, here }: { drops: PlinkoDrop[]; here: PlinkoWatcher[] }) {
  return (
    <section className="pk-feed well" aria-label="Recent drops">
      <p className="pk-feed__here">
        <span>{here.length === 0 ? "Nobody at the board" : `${here.length} at the board`}</span>
        <span className="pk-feed__dots" aria-hidden="true">
          {here.map((one) => (
            <i key={one.name} style={{ "--pk-who": `var(--pk-c${one.colour})` } as CSSProperties} />
          ))}
        </span>
      </p>
      {drops.length === 0 ? (
        <p className="pk-feed__empty">Nobody has dropped a ball yet.</p>
      ) : (
        <ol className="pk-feed__drops">
          {drops.map((drop) => (
            <li
              key={drop.id}
              className="pk-feed__drop"
              style={{ "--pk-who": `var(--pk-c${drop.by.colour})` } as CSSProperties}
            >
              <span className="pk-feed__who">{drop.by.name}</span>
              <span className="pk-feed__mult">{multText(drop.mult)}×</span>
              <span className="pk-feed__won">{drop.won > 0 ? `+${exact(drop.won)}` : "—"}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
