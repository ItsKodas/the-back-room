import type { Bet } from "./bank.js";
import type { Roll } from "./dice.js";
import { after, back, type Hand, multiplier } from "./resolve.js";
import { spotAt } from "./spots.js";

/**
 * Chips on the cloth, and what the dice do to them.
 *
 * A placed bet names a spot by id rather than carrying its own odds. That is
 * the whole safety property of this file: a client says "put sixty on hard:8",
 * and a message naming a bet nobody can make has nothing to look up and so
 * buys nothing.
 *
 * What is different from the wheel is that settling produces a new cloth as
 * well as a set of payouts. Roulette sweeps everything every spin; here a pass
 * line bet waits for its point, a come bet travels to a number, and a place
 * bet is paid without being settled at all.
 */

/** One player's chips, on one spot. */
export interface Placed {
  readonly seatId: string;
  readonly spotId: string;
  readonly chips: number;
  /** Not acting this roll. Recomputed every seal, never carried across one. */
  readonly off: boolean;
}

/** What one seat got out of a roll. */
export interface Paid {
  /** Handed over. Stake included only for bets that actually ended. */
  back: number;
  /**
   * What this seat had **resolved** this roll, win or lose.
   *
   * Not everything they had down: a place bet that pays and stays up has not
   * been settled, so counting its stake here would call a paid bet a lost one
   * the moment it was paid. `back - staked` is the profit either way, which is
   * the only thing anything downstream actually wants.
   */
  staked: number;
  /** Which of their bets came in, for a felt that wants to point at them. */
  won: { spotId: string; back: number }[];
}

/**
 * What the bank reasons about: the same chips, with their spots resolved.
 *
 * Anything naming a spot that does not exist is dropped here rather than
 * defended against everywhere downstream. The table refuses those on the way
 * in; this is the second lock on the same door.
 */
export function toBets(placed: readonly Placed[]): Bet[] {
  const out: Bet[] = [];
  for (const one of placed) {
    const spot = spotAt(one.spotId);
    if (spot !== null) out.push({ spot, chips: one.chips, off: one.off });
  }
  return out;
}

/**
 * What every seat is handed, and what the cloth looks like afterwards.
 *
 * A losing bet returns nothing at all rather than a negative: the stake went
 * into the bank when the chip went down, so losing is simply not being paid.
 * Keeping it that way is what makes the sum of everything returned comparable
 * against what the bank promised — see the invariant in the tests, which is
 * the one property this whole package exists to keep.
 *
 * An off bet is untouched: it is handed nothing, it resolves nothing, and it
 * is back on the cloth with its flag cleared, because whether it acts next
 * roll is a question asked again at the next seal.
 */
export function settle(
  placed: readonly Placed[],
  roll: Roll,
  hand: Hand,
): { paid: Map<string, Paid>; cloth: Placed[] } {
  const paid = new Map<string, Paid>();
  /* Keyed by seat and spot, so two bets arriving on one spot become one pile. */
  const piles = new Map<string, Placed>();

  const keep = (seatId: string, spotId: string, chips: number) => {
    const key = `${seatId}|${spotId}`;
    const already = piles.get(key);
    piles.set(key, {
      seatId,
      spotId,
      chips: (already?.chips ?? 0) + chips,
      off: false,
    });
  };

  for (const one of placed) {
    const spot = spotAt(one.spotId);
    if (spot === null) {
      continue;
    }
    if (one.off) {
      keep(one.seatId, one.spotId, one.chips);
      continue;
    }

    const seat = paid.get(one.seatId) ?? { back: 0, staked: 0, won: [] };
    const paying = back(one.chips, multiplier(spot, roll, hand));
    const next = after(spot, roll, hand);
    const ended = next === null;

    if (paying > 0) {
      seat.back += paying;
    }
    /*
     * A win, and not merely being handed something.
     *
     * A bet that ends has to beat what it had at risk: the barred twelve
     * hands a don't pass bet its stake straight back, and a board that called
     * that a win would be a board that lies about the evening. A bet that
     * stays up risked nothing this roll, so anything at all is winnings.
     */
    if (paying > (ended ? one.chips : 0)) {
      seat.won.push({ spotId: one.spotId, back: paying });
    }
    if (ended) {
      seat.staked += one.chips;
    } else {
      keep(one.seatId, next, one.chips);
    }
    paid.set(one.seatId, seat);
  }

  return { paid, cloth: [...piles.values()] };
}
