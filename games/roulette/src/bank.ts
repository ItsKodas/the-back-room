import { type Spot, pays } from "./spots.js";
import { WHEEL } from "./wheel.js";

/**
 * What the table can be asked to pay, and what the bank must hold to promise it.
 *
 * Roulette differs from the other two banked games in one way that matters: a
 * wheel settles everybody at once. Blackjack and the machine ask what one seat
 * can win and cap that; here, a single spin pays every chip on the cloth, so a
 * cap derived per seat would be a promise about one player made in front of
 * six. At 35 to 1 that gap is not a rounding error — it is the whole bank.
 *
 * So the exposure is worked out across the whole cloth, exactly, every time a
 * chip goes down. That costs a loop over thirty-seven pockets and buys two
 * things: a promise that actually holds, and a table far more generous than a
 * per-seat cap could be. Equal chips on red and black can never both come in,
 * so between them they need no bank at all — and a table that understands that
 * takes bets all evening that a cruder one would refuse.
 */

/** A chip, or a pile of them, sitting on one spot. */
export interface Bet {
  readonly spot: Spot;
  readonly chips: number;
}

/**
 * What the bank must hold per chip of a lone straight-up.
 *
 * Not used to cap anything — {@link needed} does that exactly — but it is the
 * worst ratio the cloth can produce, and having it written down is what makes
 * the number in the tests something a person can check.
 */
export const STAKE_DIVISOR = 35;

/** Everything staked on the cloth this spin. */
export function staked(bets: readonly Bet[]): number {
  return bets.reduce((sum, one) => sum + one.chips, 0);
}

/** What one bet hands back if its pocket comes in, the stake included. */
const back = (one: Bet) => one.chips * (pays(one.spot) + 1);

/**
 * The most this cloth could pay out on one spin.
 *
 * The worst pocket, not the sum of every bet: the ball lands in one place, so
 * two straight-ups on different numbers expose the table to the larger of
 * them rather than to both.
 */
export function owed(bets: readonly Bet[]): number {
  let worst = 0;
  for (const pocket of WHEEL) {
    let here = 0;
    for (const one of bets) {
      if (one.spot.covers.includes(pocket)) here += back(one);
    }
    if (here > worst) worst = here;
  }
  return worst;
}

/**
 * What the bank has to be holding for this cloth to be safe.
 *
 * Every stake enters the bank before the wheel resolves, so the table pays out
 * of the bank *plus* what is on the cloth — which is why this is a difference
 * rather than the payout itself. Getting that wrong in the other direction is
 * the mistake the machine's bank documents making.
 */
export function needed(bets: readonly Bet[]): number {
  return Math.max(0, owed(bets) - staked(bets));
}

/**
 * The most that can still go on one spot, given what is already down.
 *
 * Solved rather than searched. Adding x chips to a spot raises what the worst
 * pocket owes by x * (pays + 1) and raises the stakes by x, so for every pocket
 * p the spot covers:
 *
 *     already[p] + x * (pays + 1)  <=  bank + staked + x
 *     x * pays                     <=  bank + staked - already[p]
 *
 * and the binding pocket is whichever already owes the most. Pockets the spot
 * does not cover only get easier as x grows, because the stake grows and their
 * payout does not.
 *
 * Floored, because half a chip of headroom is no headroom.
 *
 * The bank goes into that inequality as it is, never clamped up to nought
 * first. A clamp reads like tidying and is the opposite: it hands the
 * arithmetic a richer bank than exists while the chips already on the cloth
 * go on counting in full, and so offers a chip the table cannot pay. One
 * straight-up on every pocket is a legal cloth at a bank of -1, and a clamped
 * bank would then put a chip on red that owes 38 against 37. Only the result
 * is floored, which makes an overdrawn bank offer nothing, the honest answer.
 *
 * And the bank can be below nought. Every roulette table shares one, and a
 * cap measured at one table counts the chips another has put down, so that
 * table's payout can take the bank beneath this cloth's own stakes.
 */
export function headroom(bank: number, bets: readonly Bet[], spot: Spot): number {
  const already = staked(bets);
  let worst = Number.POSITIVE_INFINITY;
  for (const pocket of spot.covers) {
    let here = 0;
    for (const one of bets) {
      if (one.spot.covers.includes(pocket)) here += back(one);
    }
    const left = bank + already - here;
    if (left < worst) worst = left;
  }
  return Math.max(0, Math.floor(worst / pays(spot)));
}

/**
 * What a table playing for nothing starts with.
 *
 * Its purse and its bank both live at the table and are gone when it closes,
 * which is what lets every number above stay exactly as it is: the same cloth,
 * the same exact exposure, run against figures that were never anybody's.
 *
 * Seeded well past 35x the largest chip, so the whole tray is playable from
 * the first spin instead of greying out until an imaginary bank has filled.
 */
export const FUN_PURSE = 25_000;
export const FUN_BANK = 2_000_000;

/**
 * The chips this table takes, largest first.
 *
 * The same denominations the card tables mint, because they are the same
 * chips: somebody who has learned that purple is five hundred should not have
 * to learn it again across the room.
 */
export const CHIPS = [5000, 1000, 500, 250, 100, 50, 25] as const;

/** The smallest thing anybody can put on a spot. */
export const MIN_CHIP = CHIPS[CHIPS.length - 1];
