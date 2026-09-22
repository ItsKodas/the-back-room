import { POINTS, spotAt } from "@backroom/game-craps";

/**
 * Where everything sits, in grid units rather than pixels.
 *
 * Units, so the second arrangement is a second table of numbers rather than a
 * second stylesheet — and so the cloth can be asserted rather than looked at.
 * Every property that matters here is arithmetic: nothing overlaps, nothing
 * escapes the grid, and every box is still a thumb wide at 375.
 *
 * Twenty-five boxes for a cloth with fifty-one spots on it, because odds and
 * travelled come bets have no box of their own. That is not a simplification:
 * it is where they sit on a real table. Odds go *behind* the line bet they
 * back, and a come bet that has travelled to the six sits in the six's box
 * above the place bets. `boxFor` and `slot` say which stack is which.
 */

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const box = (id: string, x: number, y: number, w: number, h: number): Box => ({ id, x, y, w, h });

/**
 * The cloth as a casino prints it — one end of it.
 *
 * A real table is double-ended only so two crews can reach it; one end is the
 * entire game, and drawing both would be drawing the same bets twice.
 */
export const WIDE = {
  cols: 28,
  rows: 24,
  boxes: [
    box("dontcome", 0, 0, 4, 6),
    box("place:4", 4, 0, 4, 6),
    box("place:5", 8, 0, 4, 6),
    box("place:6", 12, 0, 4, 6),
    box("place:8", 16, 0, 4, 6),
    box("place:9", 20, 0, 4, 6),
    box("place:10", 24, 0, 4, 6),

    box("come", 0, 6, 20, 6),

    // The middle, where the one-roll bets live and the shouting happens.
    box("hard:4", 20, 6, 4, 3),
    box("hard:10", 24, 6, 4, 3),
    box("hard:6", 20, 9, 4, 3),
    box("hard:8", 24, 9, 4, 3),
    box("any7", 20, 12, 8, 2),
    box("eleven", 20, 14, 4, 2),
    box("three", 24, 14, 4, 2),
    box("two", 20, 16, 2, 2),
    box("twelve", 22, 16, 2, 2),
    box("horn", 24, 16, 2, 2),
    box("ce", 26, 16, 2, 2),
    box("anycraps", 20, 18, 8, 2),

    box("field", 0, 12, 20, 5),
    box("big:6", 0, 17, 3, 3),
    box("big:8", 3, 17, 3, 3),
    box("dontpass", 6, 17, 14, 3),
    box("pass", 0, 20, 20, 4),
  ] as readonly Box[],
};

/**
 * The same cloth, stacked.
 *
 * Line, then numbers, then the field, then the middle — which is the order
 * somebody actually bets in, and the order that puts the two things you press
 * every hand nearest your thumb. Twelve columns, because at 375 that is a
 * unit of about twenty-eight pixels and the smallest box here is three of
 * them across.
 */
export const TALL = {
  cols: 12,
  rows: 50,
  boxes: [
    box("pass", 0, 0, 12, 5),
    box("dontpass", 0, 5, 12, 4),

    box("place:4", 0, 9, 4, 6),
    box("place:5", 4, 9, 4, 6),
    box("place:6", 8, 9, 4, 6),
    box("place:8", 0, 15, 4, 6),
    box("place:9", 4, 15, 4, 6),
    box("place:10", 8, 15, 4, 6),

    box("come", 0, 21, 6, 5),
    box("dontcome", 6, 21, 6, 5),

    box("field", 0, 26, 12, 5),
    box("big:6", 0, 31, 6, 4),
    box("big:8", 6, 31, 6, 4),

    box("hard:4", 0, 35, 6, 3),
    box("hard:10", 6, 35, 6, 3),
    box("hard:6", 0, 38, 6, 3),
    box("hard:8", 6, 38, 6, 3),

    box("any7", 0, 41, 6, 3),
    box("anycraps", 6, 41, 6, 3),
    box("two", 0, 44, 3, 3),
    box("three", 3, 44, 3, 3),
    box("eleven", 6, 44, 3, 3),
    box("twelve", 9, 44, 3, 3),
    box("horn", 0, 47, 6, 3),
    box("ce", 6, 47, 6, 3),
  ] as readonly Box[],
};

/**
 * The width below which the cloth stands up.
 *
 * Measured by the cloth against its own width rather than the viewport's,
 * because this is a question about the room it was given and not about the
 * device: the same cloth is narrow beside a rail on a desk and wide on a
 * tablet held sideways.
 */
export const TURNS_AT = 640;

/** Which box this bet's chips are drawn in. */
export function boxFor(spotId: string): string | null {
  const spot = spotAt(spotId);
  if (spot === null) {
    return null;
  }
  if (spot.kind === "travelled") {
    return `place:${spot.number}`;
  }
  if (spot.kind === "odds") {
    if (spot.id === "odds:pass") return "pass";
    if (spot.id === "odds:dontpass") return "dontpass";
    return `place:${spot.number}`;
  }
  return spot.id;
}

/**
 * Which stack inside that box.
 *
 * The six's box can be holding five things at once — a place bet, a come bet,
 * a don't come bet, and odds behind either of those last two — and any two of
 * them sharing a corner would draw on top of each other. A real table stacks
 * them in fixed positions for exactly this reason, and so does this.
 */
export function slot(spotId: string): "flat" | "come" | "dontcome" | "odds" | "darkodds" {
  const spot = spotAt(spotId);
  if (spot === null) {
    return "flat";
  }
  if (spot.kind === "travelled") {
    return spot.dark ? "dontcome" : "come";
  }
  if (spot.kind === "odds") {
    return spot.dark ? "darkodds" : "odds";
  }
  return "flat";
}

/** Every number a come bet can travel to, for the felt to outline them. */
export const NUMBER_BOXES: readonly string[] = POINTS.map((one) => `place:${one}`);
