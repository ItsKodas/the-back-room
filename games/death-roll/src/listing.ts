import type { GameListing } from "@backroom/core";

/** How Death Roll lists itself in the room. */
export const DEATH_ROLL: GameListing = {
  id: "death-roll",
  name: "Death Rolling",
  blurb: "Halve the number or pay. Last one to roll a one loses.",
  shape: "table",
  /*
   * Two, and it cannot be fewer or more. A death roll is a duel — the whole
   * game is the number coming down between two people — so this is the game in
   * the building that refuses a lone player rather than building a bank for
   * them.
   */
  minSeats: 2,
  maxSeats: 2,
  mark: { text: "DEATH ROLL", accentAt: 0 },
  /*
   * The same values theme.css sets, repeated because the link cards are drawn
   * on the server where there is no stylesheet to read. They have to agree.
   */
  theme: { wall: "#16141c", felt: "#241f33", accent: "#6b4bd6", accentHi: "#b39cff" },
  open: true,
};

/**
 * What a duel may be played for.
 *
 * A list rather than a range, for the reason poker's is: a room where every
 * table is a different odd size is a room nobody can read at a glance. Every
 * level divides by ten, which is what keeps a pass price a whole number of
 * chips at all of them.
 */
export const STAKES = [100, 500, 1_000, 5_000] as const;

/** What a duel costs unless the host says otherwise. */
export const ANTE = 500;

/**
 * Where a duel starts.
 *
 * A thousand is the number everybody who has played this before expects, and
 * the other two are an evening's difference either side of it: a hundred is
 * over in four or five rolls, ten thousand takes a while to get interesting.
 */
export const CEILINGS = [100, 1_000, 10_000] as const;

/** The opening ceiling unless the host says otherwise. */
export const OPENING = 1_000;

/**
 * What a pass costs, as a fraction of the ante.
 *
 * A tenth, which puts the break-even at ceiling eight — roughly the last two
 * or three rolls of a duel. Dearer and the button is worth pressing on at most
 * one turn, which is a decision in name only; cheaper and it is simply always
 * right to spend it. See odds.ts for the arithmetic this came out of.
 */
export const PASS_DIVISOR = 10;

/** Play money handed to a seat at a for-fun table, which dies with the table. */
export const FUN_PURSE = 10_000;

/** How long somebody has to act before the table rolls for them. */
export const TURN_MS = 30_000;

/** How long a finished duel stays up to be read. */
export const RESULT_MS = 5_000;

/** How long a funded table waits before starting the next duel. */
export const DEAL_MS = 2_000;

/**
 * How long the table leaves it before trying a refused ante again.
 *
 * Longer than DEAL_MS, and deliberately so. A table whose player cannot cover
 * the ante would otherwise retry every two seconds for as long as they sat
 * there — asking the economy for chips that are not coming and sending a state
 * to everybody each time. Ten seconds is slow enough to be no burden and quick
 * enough that somebody who has just topped up is not left staring at the felt.
 */
export const SHORT_RETRY_MS = 10_000;

/** What a pass costs at this stake. Never nothing, whatever the arithmetic. */
export function passPrice(ante: number): number {
  return Math.max(1, Math.round(ante / PASS_DIVISOR));
}

/**
 * The nearest level to a number, or the default for anything unusable.
 *
 * A number exactly between two levels goes to the lower one: the comparison is
 * strict and the lists are ascending, so the first level at the winning
 * distance is the one that keeps it. Deliberate — a host who asks for
 * something between two stakes is put on the cheaper of them rather than
 * charged up to the dearer, and it is the same answer every time.
 */
function snap(asked: unknown, levels: readonly number[], fallback: number): number {
  const want = typeof asked === "number" && Number.isFinite(asked) ? asked : fallback;
  let best = levels[0] as number;
  for (const level of levels) {
    if (Math.abs(level - want) < Math.abs(best - want)) {
      best = level;
    }
  }
  return best;
}

/**
 * The stake a table actually plays for.
 *
 * Snapped here rather than trusted from the payload, the way poker snaps its
 * buy-in: this is the number that decides how much of somebody's balance is at
 * risk at a table they sat down at, and a client that could name its own would
 * be setting the stakes for other people.
 */
export function anteFor(asked: unknown): number {
  return snap(asked, STAKES, ANTE);
}

/** Where the table's duels start, snapped for the same reason. */
export function openingFor(asked: unknown): number {
  return snap(asked, CEILINGS, OPENING);
}
