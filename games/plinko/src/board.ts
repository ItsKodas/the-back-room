/** Twelve rows: enough for a 170× edge, few enough to read on a phone. */
export const ROWS = 12;
export const BUCKETS = ROWS + 1;
/** Every left-or-right sequence the board can produce. */
export const PATHS = 2 ** ROWS;

/**
 * A draw in `[0, PATHS)` as a path, top row first.
 *
 * One integer for the whole fall rather than twelve coin flips, so the server
 * asks its source once and every path is exactly as likely as every other.
 */
export function pathOf(draw: number): boolean[] {
  if (!Number.isInteger(draw) || draw < 0 || draw >= PATHS) {
    throw new RangeError(`not a path: ${draw}`);
  }
  return Array.from({ length: ROWS }, (_, row) => ((draw >> (ROWS - 1 - row)) & 1) === 1);
}

/** Buckets count from the left, so the bucket is how many times it went right. */
export function bucketOf(path: readonly boolean[]): number {
  return path.filter(Boolean).length;
}

/** A path from a source of integers in `[0, PATHS)`. */
export function drawPath(draw: () => number): boolean[] {
  return pathOf(draw());
}

/** How many of the 4,096 paths end in this bucket: C(12, bucket). */
export function waysInto(bucket: number): number {
  let ways = 1;
  for (let step = 1; step <= bucket; step += 1) {
    ways = (ways * (ROWS - step + 1)) / step;
  }
  return ways;
}
