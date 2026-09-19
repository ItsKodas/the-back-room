import { describe, expect, it } from "vitest";
import { BUCKETS } from "./board.js";
import {
  DIVISOR,
  MIN_STAKE,
  STAKE_DIVISOR,
  capsFor,
  isStake,
  maxStake,
  payout,
  worstCase,
} from "./bank.js";
import { RISKS } from "./risk.js";

describe("a stake", () => {
  it("is a positive whole number of tens", () => {
    expect([10, 20, 1000].every(isStake)).toBe(true);
    expect([0, 5, 15, -10, 10.5, Number.NaN].some(isStake)).toBe(false);
    expect(MIN_STAKE).toBe(10);
  });

  it("pays a whole number of chips in every bucket at every risk", () => {
    for (const risk of RISKS) {
      for (let bucket = 0; bucket < BUCKETS; bucket += 1) {
        for (const stake of [10, 20, 30, 70, 990]) {
          expect(Number.isInteger(payout(stake, risk, bucket))).toBe(true);
        }
      }
    }
    expect(payout(10, "low", 6)).toBe(5);
    expect(payout(50, "high", 0)).toBe(8500);
  });

  it("is refused by the arithmetic if it is not one", () => {
    expect(() => payout(15, "low", 0)).toThrow(RangeError);
  });
});

describe("the cap", () => {
  it("divides by the edge less the stake already in", () => {
    expect(DIVISOR).toEqual({ low: 7, medium: 32, high: 169 });
    expect(STAKE_DIVISOR).toBe(169);
  });

  it("gives what the spec promises a 50,000 float", () => {
    expect(capsFor(50_000)).toEqual({ low: 7140, medium: 1560, high: 290 });
  });

  it("offers nothing on an empty or overdrawn bank", () => {
    expect(capsFor(0)).toEqual({ low: 0, medium: 0, high: 0 });
    expect(maxStake(-500, "low")).toBe(0);
  });

  it("can always pay the worst ball it lets anybody drop", () => {
    /*
     * The property the whole game rests on, over many banks rather than one:
     * the stake is in the bank before the path is drawn, so the edge bucket
     * has `bank + stake` to pay from. And one ten over the cap cannot be
     * covered — the cap is the true limit, not a comfortable guess.
     */
    const banks = [0, 9, 69, 70, 169, 1_690, 1_699, 50_000, 123_457, 999_999, 8_000_000];
    for (const risk of RISKS) {
      for (const bank of banks) {
        const cap = maxStake(bank, risk);
        for (let stake = MIN_STAKE; stake <= cap; stake += Math.max(10, Math.floor(cap / 500 / 10) * 10)) {
          expect(worstCase(stake, risk), `${risk} ${bank} ${stake}`).toBeLessThanOrEqual(bank + stake);
        }
        if (cap >= MIN_STAKE) {
          expect(worstCase(cap, risk)).toBeLessThanOrEqual(bank + cap);
        }
        const over = cap + 10;
        expect(worstCase(over, risk), `${risk} ${bank} over`).toBeGreaterThan(bank + over);
      }
    }
  });
});
