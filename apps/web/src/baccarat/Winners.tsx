import type { Outcome, Win } from "@backroom/game-baccarat";

/**
 * The board of who has been paid.
 *
 * Roulette's own `Winners.tsx`, moved to baccarat's shape: a coup number
 * standing in for a spin, and three outcomes standing in for thirty-seven
 * pockets. See that file for the reasoning this one shares — winners only,
 * and the profit rather than what came back, because every bet on the cloth
 * returns its stake with the payout, so "was handed chips" is true of half
 * the table most coups and means nothing on its own.
 *
 * Newest last, the same way the bead plate beside it is, because the two
 * boards are read together.
 */
const fmt = (n: number) => n.toLocaleString("en-US");

const LETTER: Record<Outcome, string> = {
  player: "P",
  banker: "B",
  tie: "T",
};

export function Winners({ winners }: { winners: readonly Win[] }) {
  if (winners.length === 0) {
    return null;
  }
  return (
    <ol className="bc__winners" aria-label="Recent winners, oldest first">
      {winners.map((win, at) => (
        /*
         * The coup and the seat together, because neither is enough alone:
         * one coup pays several people, and one person is paid across several
         * coups.
         */
        <li
          key={`${win.coup}:${win.seatId}`}
          className={`bc__won${at === winners.length - 1 ? " bc__won--latest" : ""}`}
        >
          {/* The outcome they were paid on, in its own colour — the same mark
              the bead plate beside this one uses, so the two read as one thing. */}
          <span className={`bc__won-outcome bc__won-outcome--${win.outcome}`}>
            {LETTER[win.outcome]}
          </span>
          <span className="bc__won-name">{win.name}</span>
          <span className="bc__won-up">+{fmt(win.up)}</span>
        </li>
      ))}
    </ol>
  );
}
