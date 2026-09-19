import { ROWS } from "@backroom/game-plinko";

/*
 * The board in its own units: one unit between neighbouring pegs, one row per
 * unit down. The SVG scales the lot, so nothing here knows about pixels.
 */
export const PEG_R = 0.11;
export const BALL_R = 0.22;
/** Other players' balls, a size smaller so a player's own always reads as theirs. */
export const OTHER_R = 0.17;
/** Where a ball appears, above the top peg. */
export const CHUTE_Y = -1.6;
export const BUCKET_Y = ROWS + 0.45;
export const VIEW = { x: -7.6, y: -2.3, w: 15.2, h: ROWS + 3.7 };

/** Row `row` has `row + 3` pegs, centred: three at the top, fourteen at the bottom. */
export function pegXs(row: number): number[] {
  return Array.from({ length: row + 3 }, (_, index) => index - (row + 2) / 2);
}

export function bucketX(bucket: number): number {
  return bucket - ROWS / 2;
}

/** Where a ball sits on a peg of this row: on top of it, touching. */
export function restY(row: number): number {
  return row - PEG_R - BALL_R;
}
