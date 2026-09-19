import { MIN_STAKE, STAKE_STEP } from "@backroom/game-plinko";

/** The step at this size: fine where stakes are small, coarse where they are not. */
function band(stake: number): number {
  if (stake < 100) return 10;
  if (stake < 1_000) return 50;
  if (stake < 10_000) return 500;
  return 5_000;
}

/** One press of + or −, snapping onto the next step rather than keeping an odd remainder. */
export function nudge(stake: number, dir: 1 | -1): number {
  if (dir === 1) {
    const step = band(stake);
    return Math.floor(stake / step) * step + step;
  }
  const step = band(stake - 1);
  return Math.max(MIN_STAKE, Math.ceil(stake / step) * step - step);
}

export function halve(stake: number): number {
  return Math.max(MIN_STAKE, Math.floor(stake / 2 / STAKE_STEP) * STAKE_STEP);
}

export function double(stake: number): number {
  return stake * 2;
}

/** Inside what the bank and the balance allow; never below the smallest stake. */
export function fit(stake: number, limit: number): number {
  const most = Math.floor(limit / STAKE_STEP) * STAKE_STEP;
  return Math.max(MIN_STAKE, Math.min(stake, most));
}
