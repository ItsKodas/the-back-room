import type { Bet, BetOn } from "./bank.js";
import { FIVE_ODDS_PAYS } from "./bank.js";
import type { Called } from "./casino.js";

/**
 * Chips on the cloth, and what the coins do to them.
 *
 * Simpler than the wheel's, and the difference is worth naming. A roulette bet
 * names a spot by id, so a client can say something that does not exist and the
 * lookup is the safety property. Here there are three sides and they are a
 * union type, so a message naming a fourth cannot be built at all — the check
 * is at the door, in the adapter, and there is no id to resolve.
 */

/** One player's chips, on one side. */
export interface Placed {
  readonly seatId: string;
  readonly on: BetOn;
  readonly chips: number;
}

/** What one seat got out of a round. */
export interface Paid {
  /** Handed back, stake included. Zero is a bet that lost. */
  back: number;
  /** What that seat had on the cloth, win or lose. */
  staked: number;
  /** Which of their bets came in, for a felt that wants to point at them. */
  won: { on: BetOn; back: number }[];
}

/** What the bank reasons about: the same chips, without the seats. */
export function toBets(placed: readonly Placed[]): Bet[] {
  return placed.map((one) => ({ on: one.on, chips: one.chips }));
}

/** What one side pays back per chip, stake included. */
const back = (on: BetOn, chips: number) => chips * (on === "fiveOdds" ? FIVE_ODDS_PAYS + 1 : 2);

/**
 * What every seat gets back, now the coins are down.
 *
 * A losing bet returns nothing at all rather than a negative: the stake went
 * into the bank when the chip went down, so losing is simply not being paid.
 * Keeping it that way is what makes the sum of everything returned comparable
 * against what the bank promised.
 */
export function settle(placed: readonly Placed[], called: Called): Map<string, Paid> {
  const out = new Map<string, Paid>();
  for (const one of placed) {
    const seat = out.get(one.seatId) ?? { back: 0, staked: 0, won: [] };
    seat.staked += one.chips;
    if (one.on === called) {
      const paid = back(one.on, one.chips);
      seat.back += paid;
      seat.won.push({ on: one.on, back: paid });
    }
    out.set(one.seatId, seat);
  }
  return out;
}
