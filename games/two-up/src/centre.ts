import type { Decided } from "./school.js";

/**
 * The centre bet, and the ring covering it.
 *
 * The whole money model of the traditional school, and it is deliberately
 * small. There is no bank here and there must not be one, so the only thing
 * this file has to guarantee is that what goes out equals what came in — which
 * is a property a test can state in one line, and does.
 *
 * Side bets around the ring are not here. The authentic article is a shouted
 * order book between individual punters, and modelled digitally that is a
 * matching engine wearing a game's clothes. The centre is the heart of two-up
 * and it is a complete game without them.
 */

/** What the spinner has put up. */
export interface Centre {
  readonly seatId: string;
  readonly chips: number;
}

/** One of the ring, covering part of it. */
export interface Cover {
  readonly seatId: string;
  readonly chips: number;
}

/** What the ring has put in altogether. */
export function covered(covers: readonly Cover[]): number {
  return covers.reduce((sum, one) => sum + one.chips, 0);
}

/**
 * What of the centre is still open.
 *
 * Clamped at nought rather than trusted. The table refuses a cover that would
 * overshoot, and this is the second lock on the same door — an over-covered
 * centre would otherwise make the pot bigger than the chips that paid for it.
 */
export function uncovered(centre: Centre, covers: readonly Cover[]): number {
  return Math.max(0, centre.chips - covered(covers));
}

/**
 * What everybody gets back, now the run is over.
 *
 * Chips rather than profit, so the sum of this is the sum of what was staked
 * and the two can be compared directly. The spinner risked only what the ring
 * actually covered; the rest of their centre was never contested and comes
 * back to them whatever happened.
 */
export function payouts(
  centre: Centre,
  covers: readonly Cover[],
  decided: Decided,
): Map<string, number> {
  const out = new Map<string, number>();
  const matched = Math.min(centre.chips, covered(covers));
  const loose = centre.chips - matched;

  const give = (seatId: string, chips: number) => {
    out.set(seatId, (out.get(seatId) ?? 0) + chips);
  };

  if (decided === "oddedOut") {
    // Nobody won, so nobody pays. Every chip goes back where it came from.
    give(centre.seatId, centre.chips);
    for (const one of covers) {
      give(one.seatId, one.chips);
    }
    return out;
  }

  if (decided === "spinner") {
    give(centre.seatId, centre.chips + matched);
    return out;
  }

  give(centre.seatId, loose);
  /*
   * Doubled where it was matched. The covers cannot exceed the centre, so
   * every chip in the ring's side was contested and every one of them is paid
   * — which is why this needs no pro-rata arithmetic beyond the doubling.
   */
  for (const one of covers) {
    give(one.seatId, one.chips * 2);
  }
  return out;
}
