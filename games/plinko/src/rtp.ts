import { BUCKETS, PATHS, waysInto } from "./board.js";
import { type Risk, multOf } from "./risk.js";

/** Exact, over the 4,096 paths, with multipliers in tenths. */
export const RTP_DENOMINATOR = PATHS * 10;
export const RTP_NUMERATOR = 39_730;

/** What a risk returns, as the numerator over `RTP_DENOMINATOR`. */
export function returnOf(risk: Risk): number {
  let paid = 0;
  for (let bucket = 0; bucket < BUCKETS; bucket += 1) {
    paid += waysInto(bucket) * multOf(risk, bucket);
  }
  return paid;
}
