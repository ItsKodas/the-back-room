import type { GameListing } from "@backroom/core";

/** How Death Roll lists itself in the room. */
export const DEATH_ROLL: GameListing = {
  id: "death-roll",
  name: "Death Rolling",
  blurb: "Halve the number or pay. Roll a one and you're out.",
  shape: "table",
  /*
   * Two to six. Two is the duel death roll always was, and it is still the
   * last round of every bigger game; six is what a phone's seat grid holds
   * without scrolling. Never one: a chips game does not run for one player,
   * and this one has no bank to play against.
   */
  minSeats: 2,
  maxSeats: 6,
  mark: { text: "DEATH ROLL", accentAt: 0 },
  /*
   * The same values theme.css sets, repeated because the link cards are drawn
   * on the server where there is no stylesheet to read. They have to agree.
   */
  theme: { wall: "#16141c", felt: "#241f33", accent: "#6b4bd6", accentHi: "#b39cff" },
  open: true,
};

/**
 * What a game may be played for.
 *
 * A list rather than a range, for the reason poker's is: a room where every
 * table is a different odd size is a room nobody can read at a glance. Every
 * level divides by ten, which is what keeps a pass price a whole number of
 * chips at all of them.
 */
export const STAKES = [100, 500, 1_000, 5_000] as const;

/** What a game costs unless the host says otherwise. */
export const ANTE = 500;

/**
 * Where a game's first round starts.
 *
 * A thousand is the number everybody who has played this before expects, and
 * the other two are an evening's difference either side of it.
 */
export const CEILINGS = [100, 1_000, 10_000] as const;

/** The opening ceiling unless the host says otherwise. */
export const OPENING = 1_000;

/**
 * Where every round after the first starts, whatever the table opened at.
 *
 * What keeps a full table near thirty rolls rather than forty: a round from a
 * thousand averages eight and a half rolls, and one from a hundred six.
 */
export const RESET_CEILING = 100;

/**
 * What a pass costs, as a fraction of the ante.
 *
 * A tenth. With a pass that cannot be handed back, that puts the first pass at
 * ceiling 3 in a duel and 8 at six players, and nobody ever passes above 8 —
 * see odds.ts, which solves it.
 */
export const PASS_DIVISOR = 10;

/** Play money handed to a seat at a for-fun table, which dies with the table. */
export const FUN_PURSE = 10_000;

/** How long somebody has to act before the table rolls for them. */
export const TURN_MS = 30_000;

/** How long a finished game stays up to be read. */
export const RESULT_MS = 5_000;

/** How long the felt shows who just went out before the next round starts. */
export const ROUND_MS = 3_000;

/**
 * How long a table waits, once two are ready, for the rest to say they are in.
 *
 * The thing that stops a ready button being a way to hold a table shut: when
 * it runs out, whoever is ready is dealt, and whoever is not sits that game
 * out.
 */
export const COUNTDOWN_MS = 20_000;

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

/** Where the table's first rounds start, snapped for the same reason. */
export function openingFor(asked: unknown): number {
  return snap(asked, CEILINGS, OPENING);
}
