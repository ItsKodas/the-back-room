import { describe, expect, it } from "vitest";
import { BUCKETS, PATHS, ROWS, bucketOf, drawPath, pathOf, waysInto } from "./board.js";

describe("the board", () => {
  it("is twelve rows into thirteen buckets", () => {
    expect(ROWS).toBe(12);
    expect(BUCKETS).toBe(13);
    expect(PATHS).toBe(4096);
  });

  it("reads a draw top row first, from the high bit", () => {
    expect(pathOf(0)).toEqual(Array(12).fill(false));
    expect(pathOf(PATHS - 1)).toEqual(Array(12).fill(true));
    expect(pathOf(2048)[0]).toBe(true);
    expect(pathOf(2048).slice(1)).toEqual(Array(11).fill(false));
    expect(pathOf(1)[11]).toBe(true);
  });

  it("lands in the bucket numbered by how many times it went right", () => {
    expect(bucketOf(pathOf(0))).toBe(0);
    expect(bucketOf(pathOf(PATHS - 1))).toBe(12);
    expect(bucketOf(pathOf(0b101010101010))).toBe(6);
  });

  it("reaches each bucket by exactly Pascal's triangle of paths", () => {
    // The whole return rests on this: every draw is one path, every path is
    // equally likely, so a bucket's chance is its share of the 4,096.
    const seen = Array(BUCKETS).fill(0) as number[];
    for (let draw = 0; draw < PATHS; draw += 1) {
      seen[bucketOf(pathOf(draw))] += 1;
    }
    expect(seen).toEqual([1, 12, 66, 220, 495, 792, 924, 792, 495, 220, 66, 12, 1]);
    expect(seen.map((_, bucket) => waysInto(bucket))).toEqual(seen);
  });

  it("refuses anything that is not a path", () => {
    // A scaled float or an off-by-one would quietly bias the board; loud is better.
    for (const draw of [-1, PATHS, 1.5, Number.NaN]) {
      expect(() => pathOf(draw), String(draw)).toThrow(RangeError);
    }
  });

  it("draws from the source it is given", () => {
    expect(drawPath(() => 4095)).toEqual(Array(12).fill(true));
  });
});
