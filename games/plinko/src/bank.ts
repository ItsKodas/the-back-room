import type { PlinkoCaps } from "@backroom/shared";
import { RISKS, type Risk, edgeOf, multOf } from "./risk.js";

/** Stakes move in tens, because multipliers are in tenths — see `payout`. */
export const STAKE_STEP = 10;
export const MIN_STAKE = STAKE_STEP;

/**
 * What the bank has to hold per chip staked, at each risk.
 *
 * The worst ball is the edge bucket. Its stake is in the bank by then, so
 * `edge × stake ≤ bank + stake`, i.e. `stake ≤ bank / (edge − 1)`. Derived
 * from the table rather than written down, so a retuned edge moves its cap
 * with it; every edge is a whole multiple, so the divisor is exact.
 */
export const DIVISOR: Record<Risk, number> = {
  low: edgeOf("low") / 10 - 1,
  medium: edgeOf("medium") / 10 - 1,
  high: edgeOf("high") / 10 - 1,
};

/** The worst of the three: what the admin bank route asks when it means "any stake at all". */
export const STAKE_DIVISOR = Math.max(...RISKS.map((risk) => DIVISOR[risk]));

export function isStake(stake: number): boolean {
  return Number.isInteger(stake) && stake >= MIN_STAKE && stake % STAKE_STEP === 0;
}

/**
 * The largest stake this bank can certainly pay at this risk.
 *
 * A cap rather than a refusal: a thin bank offers smaller High balls, never a
 * dark board and never a short payout. Rounded down to a ten, because a stake
 * that is not a ten is not a stake.
 */
export function maxStake(bank: number, risk: Risk): number {
  const most = Math.floor(Math.max(0, bank) / DIVISOR[risk]);
  return Math.floor(most / STAKE_STEP) * STAKE_STEP;
}

export function capsFor(bank: number): PlinkoCaps {
  return { low: maxStake(bank, "low"), medium: maxStake(bank, "medium"), high: maxStake(bank, "high") };
}

/** Exact: a stake in tens times a multiplier in tenths is whole chips. */
export function payout(stake: number, risk: Risk, bucket: number): number {
  if (!isStake(stake)) {
    throw new RangeError(`not a stake: ${stake}`);
  }
  return (stake / STAKE_STEP) * multOf(risk, bucket);
}

/** The most one ball at this stake could owe: the edge. Exists so the cap can be tested as a property. */
export function worstCase(stake: number, risk: Risk): number {
  return payout(stake, risk, 0);
}

/**
 * What a board playing for nothing starts with. Both live at the board and go
 * when the player does; the bank is seeded deep so the full range of stakes is
 * open from the first ball.
 */
export const FUN_PURSE = 25_000;
export const FUN_BANK = 8_000_000;
