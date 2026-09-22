import type { Outcome } from "./coup.js";

/**
 * The cloth: the three bets the table takes, and what each gets back.
 *
 * Three and no more. Pair bets would add an eleven-to-one line to the worst
 * case the bank has to cover, which shrinks every other bet's headroom, and
 * they would crowd a cloth that has to be hittable with a thumb.
 *
 * A placed bet names a spot by id, so a message naming a bet nobody can make
 * has nothing to look up and buys nothing.
 */

export const SPOT_IDS = ["player", "banker", "tie"] as const;
export type SpotId = (typeof SPOT_IDS)[number];

export interface Spot {
  readonly id: SpotId;
  readonly label: string;
  /** What it says on the cloth. */
  readonly pays: string;
}

export const SPOTS: readonly Spot[] = [
  { id: "player", label: "Player", pays: "1 to 1" },
  { id: "banker", label: "Banker", pays: "1 to 1, less 5%" },
  { id: "tie", label: "Tie", pays: "8 to 1" },
];

export function spotAt(id: string): Spot | null {
  return SPOTS.find((spot) => spot.id === id) ?? null;
}

/**
 * The house's cut of a winning banker bet.
 *
 * Five per cent, rounded up to a whole chip. Chips are integers and five per
 * cent of the smallest one in the tray is 1.25, so it has to round somewhere —
 * and rounding down would thin the edge at small stakes, which is the one
 * thing that cannot happen here. A table that pays a lone player at all does
 * so on the strength of the bank never being the loser over an evening.
 *
 * Charged on the pile rather than per chip, so somebody stacking chips on
 * banker is charged once: a 25 pays 8%, a 50 pays 6%, a 100 pays exactly 5%,
 * and from there up nothing is more than a fifth of a per cent off it.
 */
export function commission(chips: number): number {
  return Math.ceil(chips / 20);
}

/**
 * What one pile on one spot hands back, the stake included.
 *
 * Nought is a bet that lost: the stake went into the bank when the chip went
 * down, so losing is simply not being paid. Keeping it that way is what makes
 * the sum of everything returned comparable against what the bank promised.
 *
 * A tie returns the two side bets in full. That is the standard rule and it
 * matters to the bank's arithmetic — on a tie, player and banker money is owed
 * back rather than kept.
 */
export function back(spot: SpotId, chips: number, outcome: Outcome): number {
  if (chips <= 0) {
    return 0;
  }
  if (outcome === "tie") {
    return spot === "tie" ? chips * 9 : chips;
  }
  if (spot !== outcome) {
    return 0;
  }
  return spot === "banker" ? chips * 2 - commission(chips) : chips * 2;
}
