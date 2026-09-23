import type { Bet } from "./bank.js";
import type { Outcome } from "./coup.js";
import { back, spotAt } from "./spots.js";

/**
 * Chips on the cloth, and what the coup does to them.
 *
 * A placed bet names a spot by id rather than carrying its own odds. That is
 * the safety property of this file: a client says "put fifty on banker", and a
 * message naming a bet nobody can make has nothing to look up and so buys
 * nothing.
 */

/** One player's chips, on one spot. */
export interface Placed {
  readonly seatId: string;
  readonly spotId: string;
  readonly chips: number;
}

/** What one seat got out of a coup. */
export interface Paid {
  /** Handed back, stake included. Nought is a bet that lost. */
  back: number;
  /** What that seat had on the cloth, win or lose. */
  staked: number;
  /** Which of their bets came in, for a felt that wants to point at them. */
  won: { spotId: string; back: number }[];
}

/**
 * What the bank reasons about: the same chips, with their spots resolved.
 *
 * Anything naming a spot that does not exist is dropped here rather than
 * defended against everywhere downstream.
 */
export function toBets(placed: readonly Placed[]): Bet[] {
  const out: Bet[] = [];
  for (const one of placed) {
    const spot = spotAt(one.spotId);
    if (spot !== null) {
      out.push({ spot: spot.id, chips: one.chips });
    }
  }
  return out;
}

/**
 * What every seat gets back, now the coup is decided.
 *
 * A losing bet returns nothing at all rather than a negative: the stake went
 * into the bank when the chip went down, so losing is simply not being paid.
 * Keeping it that way is what makes the sum of everything returned comparable
 * against what the bank promised.
 *
 * A push is recorded as chips back and nothing won, which is what it is: on a
 * tie, player and banker money comes home having neither won nor lost, and a
 * felt that lit those spots up would be a felt that lies about the coup.
 */
export function settle(placed: readonly Placed[], outcome: Outcome): Map<string, Paid> {
  const out = new Map<string, Paid>();
  for (const one of placed) {
    const seat = out.get(one.seatId) ?? { back: 0, staked: 0, won: [] };
    const spot = spotAt(one.spotId);
    if (spot !== null) {
      seat.staked += one.chips;
      const paid = back(spot.id, one.chips, outcome);
      seat.back += paid;
      if (paid > one.chips) {
        seat.won.push({ spotId: one.spotId, back: paid });
      }
    }
    out.set(one.seatId, seat);
  }
  return out;
}
