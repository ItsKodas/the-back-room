/**
 * The tray, and why it is what it is.
 *
 * Thirty rather than the twenty-five the wheel and the card tables use, and
 * the reason is arithmetic rather than taste. Craps pays in sixths, fifths,
 * halves and quarters — 7 to 6 on the six, 3 to 2 on odds behind the five, a
 * horn split four ways — and a tray of twenty-fives cannot pay any of them in
 * whole chips. A twenty-five on the six owes 29.166.
 *
 * A real table solves this by demanding multiples: the six and eight take
 * multiples of six, the odds behind the five take an even number. Thirty is
 * divisible by 2, 3, 5 and 6, so every denomination here pays every bet on
 * this cloth exactly and no spot has to demand anything — which is a much
 * better table to sit at than one that refuses your chip and explains why.
 *
 * Rounding was considered and rejected in both directions. Rounding down
 * shaves the player on free odds, whose entire point is that they carry no
 * edge. Rounding up pays 30 on a 30 place-six, which is true odds — it deletes
 * the house edge and the bank never fills.
 */
export const CHIPS = [3000, 1500, 600, 300, 150, 60, 30] as const;

/** The smallest thing anybody can put on a spot. */
export const MIN_CHIP = CHIPS[CHIPS.length - 1];

/**
 * The one exception to "every chip pays every bet".
 *
 * The horn splits four ways, so it needs a multiple of four min-chips to pay
 * in whole ones. Sixty is in the tray, so this costs nobody a bet they wanted.
 */
export const HORN_STEP = MIN_CHIP * 2;
