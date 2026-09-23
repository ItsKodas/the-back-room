import type { Die } from "@backroom/rules";

/**
 * Two dice, and the thirty-six ways they land.
 *
 * Ordered pairs rather than the eleven totals, and that is the whole reason
 * this file exists separately from the arithmetic that uses it. The cloth can
 * tell a 4+4 from a 5+3 and pays them differently — a hardway is the pair, not
 * the sum — so every module that reasons about what a roll can cost walks all
 * thirty-six rather than eleven weighted ones.
 */

export type Roll = readonly [Die, Die];

export const FACES: readonly Die[] = [1, 2, 3, 4, 5, 6];

/** Every ordered pair, all thirty-six, in a fixed order. */
export const OUTCOMES: readonly Roll[] = FACES.flatMap((a) =>
  FACES.map((b): Roll => [a, b]),
);

export const total = ([a, b]: Roll): number => a + b;

/** Both dice the same, which is what a hardway is betting on. */
export const isHard = ([a, b]: Roll): boolean => a === b;

/**
 * What the dice do.
 *
 * The source is always handed in, never defaulted. This module is imported by
 * the felt as well as by the server — the client needs the faces to draw them
 * — and a default would have meant reaching for `node:crypto` in a file that
 * has to run in a browser.
 *
 * Asked for a face at a time rather than for a total, which is not a detail: a
 * single draw over the eleven sums would make the seven as likely as the two,
 * and every price on this cloth would be wrong. The server passes the same
 * cryptographic source the reels and the shoe come from, because a table hands
 * every watcher its whole result every roll, which is exactly the run of
 * observations needed to recover `Math.random`'s state.
 */
export function roll(pick: (faces: number) => number): Roll {
  return [FACES[pick(FACES.length)] as Die, FACES[pick(FACES.length)] as Die];
}
