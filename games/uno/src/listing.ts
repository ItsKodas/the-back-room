import type { GameListing } from "@backroom/core";

/** How Uno lists itself in the room. */
export const UNO: GameListing = {
  id: "uno",
  name: "Uno",
  blurb: "Match the colour or the number, and shout when you are down to one.",
  shape: "table",
  /*
   * Two to eight, as the tabletop dealt it: its oval seats eight round the
   * rim and no more. Never one: a chips game does not run for one player, and
   * this one has no bank to play against.
   */
  minSeats: 2,
  maxSeats: 8,
  mark: { text: "UNO", accentAt: 0 },
  /*
   * The same values theme.css sets, repeated because the link cards are drawn
   * on the server where there is no stylesheet to read. They have to agree.
   */
  theme: { wall: "#1d1410", felt: "#17703f", accent: "#f5c21b", accentHi: "#ffe06b" },
  open: true,
};

/**
 * What a game may be played for. The same four levels as the dice tables, so
 * the floor reads the same whichever pot you walk up to.
 */
export const STAKES = [100, 500, 1_000, 5_000] as const;

/** What a game costs unless the host says otherwise. */
export const ANTE = 500;

/**
 * How long somebody has to move before the clock moves for them.
 *
 * Shorter than Liar's Dice's thirty: an Uno turn is one card, and a table of
 * ten waiting half a minute on each of them is an evening of waiting.
 */
export const TURN_MS = 20_000;

/** How long a finished round's hands stay face up before the next deal. */
export const ROUND_MS = 6_000;

/** How long a finished game stays up to be read. */
export const RESULT_MS = 8_000;

/**
 * How long a table waits, once two are ready, for the rest to say they are in.
 * When it runs out, whoever is ready is dealt.
 */
export const COUNTDOWN_MS = 20_000;

/** Play money handed to a seat at a for-fun table, which dies with the table. */
export const FUN_PURSE = 10_000;

/**
 * The stake a table plays for, snapped to a level rather than trusted from the
 * payload: a client naming its own would be setting the stakes for everybody
 * who sits down. A number exactly between two levels goes to the cheaper.
 */
export function anteFor(asked: unknown): number {
  const want = typeof asked === "number" && Number.isFinite(asked) ? asked : ANTE;
  let best: number = STAKES[0];
  for (const level of STAKES) {
    if (Math.abs(level - want) < Math.abs(best - want)) {
      best = level;
    }
  }
  return best;
}

/**
 * How quickly bots move, the tabletop's own setting: a multiplier on how long
 * one looks like it is thinking. The host picks it with the rules, because it
 * is everybody's evening that waits on them.
 */
export const BOT_SPEEDS = { slow: 1.6, normal: 1, fast: 0.55, turbo: 0.2 } as const;
export type BotSpeed = keyof typeof BOT_SPEEDS;

/** A speed the host asked for, or normal for anything that is not one. */
export function botSpeedOf(asked: unknown): BotSpeed {
  return typeof asked === "string" && Object.hasOwn(BOT_SPEEDS, asked) ? (asked as BotSpeed) : "normal";
}
