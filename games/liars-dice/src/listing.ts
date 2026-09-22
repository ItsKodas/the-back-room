import type { GameListing } from "@backroom/core";

/** How Liar's Dice lists itself in the room. */
export const LIARS_DICE: GameListing = {
  id: "liars-dice",
  name: "Liar's Dice",
  blurb: "Everybody's dice are hidden. Raise the bid, or call the lie.",
  shape: "table",
  /*
   * Two to ten. Two is the game stripped to its bones — one bid, one call —
   * and ten is Poker's ceiling, which is as many people as one felt can show
   * who is who. Never one: a chips game does not run for one player, and this
   * one has no bank to play against.
   */
  minSeats: 2,
  maxSeats: 10,
  mark: { text: "LIAR'S DICE", accentAt: 0 },
  /*
   * The same values theme.css sets, repeated because the link cards are drawn
   * on the server where there is no stylesheet to read. They have to agree.
   */
  theme: { wall: "#17110d", felt: "#2e1c14", accent: "#e2622c", accentHi: "#ff9a63" },
  open: true,
};

/**
 * What a game may be played for.
 *
 * A list rather than a range, for the reason Death Roll's and Poker's are: a
 * room where every table is a different odd size is a room nobody can read at
 * a glance. The same four levels as Death Roll, so the floor reads the same
 * whichever dice table you walk up to.
 */
export const STAKES = [100, 500, 1_000, 5_000] as const;

/** What a game costs unless the host says otherwise. */
export const ANTE = 500;

/**
 * How many dice a player starts with.
 *
 * Five is the game everybody knows. Three is what makes a ten-handed game a
 * reasonable length — thirty dice and one lost per round is a long evening,
 * eighteen is one hand of an evening.
 */
export const DICE_LEVELS = [3, 5] as const;

/** The dice each unless the host says otherwise. */
export const DICE = 5;

/** How long somebody has to act before the clock bids for them. */
export const TURN_MS = 30_000;

/**
 * How long a revealed round stays up.
 *
 * Longer than Death Roll's three seconds because there is more to read: thirty
 * dice turning over, a count, and who it cost a die.
 */
export const REVEAL_MS = 6_000;

/** How long a finished game stays up to be read. */
export const RESULT_MS = 6_000;

/**
 * How long a table waits, once two are ready, for the rest to say they are in.
 *
 * The thing that stops a ready button being a way to hold a table shut: when
 * it runs out, whoever is ready is dealt, and whoever is not sits that game
 * out.
 */
export const COUNTDOWN_MS = 20_000;

/** Play money handed to a seat at a for-fun table, which dies with the table. */
export const FUN_PURSE = 10_000;

/**
 * The nearest level to a number, or the default for anything unusable.
 *
 * A number exactly between two levels goes to the lower one: the comparison is
 * strict and the lists are ascending, so the first level at the winning
 * distance keeps it. Deliberate — a host who asks for something between two
 * stakes is put on the cheaper of them rather than charged up to the dearer,
 * and it is the same answer every time.
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
 * Snapped here rather than trusted from the payload: this is the number that
 * decides how much of somebody's balance is at risk at a table they sat down
 * at, and a client that could name its own would be setting the stakes for
 * other people.
 */
export function anteFor(asked: unknown): number {
  return snap(asked, STAKES, ANTE);
}

/** How many dice the table deals each, snapped for the same reason. */
export function diceFor(asked: unknown): number {
  return snap(asked, DICE_LEVELS, DICE);
}
