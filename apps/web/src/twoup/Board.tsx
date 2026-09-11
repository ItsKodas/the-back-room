import type { Outcome } from "@backroom/game-two-up";

/**
 * The board of recent throws.
 *
 * Every school chalks one, and it is the only record of what the coins have
 * done. An odds throw is not a result — neither school settles on it — but it
 * is emphatically something that happened, so it goes on the board exactly
 * like a head or a tail. Leaving it off would misreport an evening where the
 * coins came down split nine times running.
 *
 * Newest last, the way it is printed on a real board.
 */
const MARK: Record<Outcome, string> = { heads: "H", tails: "T", odds: "O" };
const NAME: Record<Outcome, string> = { heads: "Heads", tails: "Tails", odds: "Odds" };

export function Board({ throws }: { throws: readonly Outcome[] }) {
  if (throws.length === 0) {
    return null;
  }
  return (
    <div className="scroller">
      <ol className="tu__board" aria-label="Recent throws, oldest first">
        {throws.map((outcome, at) => (
          <li
            /* The position is the identity: the same outcome comes up again,
               and what tells two heads apart is which throw each was. */
            key={`${at}:${outcome}`}
            className={`tu__past tu__past--${outcome}${
              at === throws.length - 1 ? " tu__past--latest" : ""
            }`}
            title={NAME[outcome]}
          >
            {MARK[outcome]}
          </li>
        ))}
      </ol>
    </div>
  );
}
