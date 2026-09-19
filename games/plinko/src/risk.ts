import { PLINKO_RISKS, type PlinkoRisk } from "@backroom/shared";

export const RISKS = PLINKO_RISKS;
export type Risk = PlinkoRisk;

/*
 * Edge to centre, in tenths of the stake. Tuned so every risk returns the same
 * 39,730 in 40,960 — see rtp.ts, whose test fails if a figure here moves alone.
 */
const HALVES: Record<Risk, readonly number[]> = {
  low: [80, 29, 17, 12, 11, 10, 5],
  medium: [330, 120, 35, 17, 11, 6, 4],
  high: [1700, 180, 80, 18, 7, 3, 2],
};

function mirror(half: readonly number[]): readonly number[] {
  return [...half, ...half.slice(0, -1).reverse()];
}

/** All thirteen buckets at each risk, left to right, in tenths. */
export const MULTS: Record<Risk, readonly number[]> = {
  low: mirror(HALVES.low),
  medium: mirror(HALVES.medium),
  high: mirror(HALVES.high),
};

export function multOf(risk: Risk, bucket: number): number {
  const mult = MULTS[risk][bucket];
  if (mult === undefined) {
    throw new RangeError(`no bucket ${bucket}`);
  }
  return mult;
}

/** The most one ball can pay at this risk: the stake cap is built on it. */
export function edgeOf(risk: Risk): number {
  return MULTS[risk][0] as number;
}

/** 1700 → "170", 5 → "0.5". */
export function multText(mult: number): string {
  return mult % 10 === 0 ? String(mult / 10) : (mult / 10).toFixed(1);
}
