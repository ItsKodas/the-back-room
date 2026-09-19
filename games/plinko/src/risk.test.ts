import { describe, expect, it } from "vitest";
import { BUCKETS } from "./board.js";
import { MULTS, RISKS, edgeOf, multOf, multText } from "./risk.js";

describe("the risks", () => {
  it("are the three the wire knows", () => {
    expect(RISKS).toEqual(["low", "medium", "high"]);
  });

  for (const risk of RISKS) {
    it(`${risk} has a multiplier for every bucket, mirrored`, () => {
      const mults = MULTS[risk];
      expect(mults).toHaveLength(BUCKETS);
      expect([...mults].reverse()).toEqual([...mults]);
    });

    it(`${risk} pays most at the edge`, () => {
      // The stake cap is built on the edge being the worst the bank can owe.
      const mults = MULTS[risk];
      for (let bucket = 1; bucket <= 6; bucket += 1) {
        expect(mults[bucket - 1]).toBeGreaterThanOrEqual(mults[bucket] as number);
      }
      expect(edgeOf(risk)).toBe(Math.max(...mults));
    });

    it(`${risk}'s edge is a whole multiple, so its divisor is exact`, () => {
      expect(edgeOf(risk) % 10).toBe(0);
    });
  }

  it("reads the tables the spec states", () => {
    expect(MULTS.low.slice(0, 7)).toEqual([80, 29, 17, 12, 11, 10, 5]);
    expect(MULTS.medium.slice(0, 7)).toEqual([330, 120, 35, 17, 11, 6, 4]);
    expect(MULTS.high.slice(0, 7)).toEqual([1700, 180, 80, 18, 7, 3, 2]);
    expect(multOf("high", 12)).toBe(1700);
  });

  it("writes a multiplier the way a person reads one", () => {
    expect(multText(1700)).toBe("170");
    expect(multText(5)).toBe("0.5");
    expect(multText(11)).toBe("1.1");
    expect(multText(10)).toBe("1");
  });
});
