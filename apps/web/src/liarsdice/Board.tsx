import type { TableView } from "@backroom/game-liars-dice";
import { says } from "@backroom/game-liars-dice";

/**
 * The table's own record of what happened: the bid, what was under the cups,
 * and who paid for the difference.
 *
 * A board rather than the activity log. The log is the table's sentences; this
 * is the thing a player looks back at to work out what everybody has been
 * willing to claim, which is the only read there is in this game.
 */
export function Board({ state }: { state: TableView }) {
  const nameOf = (seatId: string) =>
    state.seats.find((seat) => seat.id === seatId)?.name ?? "Somebody";

  if (state.board.length === 0) {
    return <p className="quiet ld__quiet">No rounds yet.</p>;
  }

  return (
    <ol className="ld__rows table-scroll" aria-label="Rounds so far">
      {[...state.board].reverse().map((row) => (
        <li
          className={`ld__row${row.call === "exact" ? " ld__row--exact" : ""}`}
          key={`${row.round}-${row.bid.count}-${row.bid.face}`}
        >
          <span className="ld__row-round">{row.round}</span>
          <span className="ld__row-bid">{says(row.bid)}</span>
          <span className={`ld__row-count${row.right ? " is-good" : " is-bad"}`}>{row.count}</span>
          <span className="ld__row-cost">
            {row.losers.map((one) => nameOf(one)).join(", ")} −1
          </span>
        </li>
      ))}
    </ol>
  );
}
