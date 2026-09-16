import type { TableView } from "@backroom/game-blackjack";
import { availableTo, doubleOffer, fmt, splitOffer } from "./hands.js";

export const PAYS_SHEET_ID = "bj-pays";

export type PayRow = "blackjack" | "win" | "push" | "dealer" | "double" | "split";

/** Which rows apply right now, and what Double and Split would cost if they are on offer. */
export interface Pays {
  lit: PayRow[];
  double: number | null;
  split: number | null;
}

/**
 * What the rules card lights: the moves open to you on your turn, and the rows
 * your hands were paid at once it is over. Asked of the same functions the keys
 * ask, so the card and the controls cannot disagree.
 */
export function paysFor(state: TableView, seatId: string | null, chips: number | null): Pays {
  const me = state.seats.find((seat) => seat.id === seatId) ?? null;
  const lit = new Set<PayRow>();
  let double: number | null = null;
  let split: number | null = null;

  const hand = me?.hands[me.active];
  if (me !== null && hand !== undefined && state.phase === "playing" && state.turnSeatId === me.id) {
    const available = availableTo(state, me, chips, me.bet);
    const doubling = doubleOffer(hand, available);
    const splitting = splitOffer(me, hand, available);
    if (doubling.ok) {
      lit.add("double");
      double = doubling.cost;
    }
    if (splitting.ok) {
      lit.add("split");
      split = splitting.cost;
    }
  }

  if (me !== null && state.phase === "settled") {
    for (const one of me.hands) {
      if (one.outcome === "blackjack") {
        lit.add("blackjack");
      } else if (one.outcome === "won") {
        lit.add("win");
      } else if (one.outcome === "push") {
        lit.add("push");
      }
    }
  }

  return { lit: [...lit], double, split };
}

const ROWS: ReadonlyArray<{ row: PayRow; term: string; value: string }> = [
  { row: "blackjack", term: "Blackjack pays", value: "3 to 2" },
  { row: "win", term: "A win pays", value: "1 to 1" },
  { row: "push", term: "A push returns", value: "the stake" },
  { row: "dealer", term: "Dealer stands on", value: "17" },
  { row: "double", term: "Double on your first two cards", value: "" },
  { row: "split", term: "Split a pair, once", value: "" },
];

const cost = (amount: number | null) => (amount === null ? "—" : `+${fmt(amount)}`);

export function HowItPays({ pays }: { pays: Pays }) {
  return (
    <dl className="bj__pays">
      {ROWS.map(({ row, term, value }) => (
        <div key={row} className={`bj__pay${pays.lit.includes(row) ? " bj__pay--lit" : ""}`}>
          <dt>{term}</dt>
          <dd>{row === "double" ? cost(pays.double) : row === "split" ? cost(pays.split) : value}</dd>
        </div>
      ))}
    </dl>
  );
}
