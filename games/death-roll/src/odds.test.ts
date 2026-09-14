import { describe, expect, it } from "vitest";
import { edge, lossOdds, passGain, worthPassing } from "./odds.js";

/**
 * The closed form against the definition.
 *
 * `lossOdds` is a one-line formula standing in for a recursion, which is the
 * kind of thing that is either exactly right or quietly wrong by a hair that
 * no example test would catch. So the definition is written out here in full
 * and the formula is checked against it for every ceiling a table can reach.
 */
function bruteForce(upTo: number): number[] {
  // L[N] = chance the player about to roll at ceiling N eventually rolls the 1.
  const loss = new Array<number>(upTo + 1).fill(0);
  loss[1] = 1;
  for (let ceiling = 2; ceiling <= upTo; ceiling++) {
    // L(N) = (N - sum of L(2..N-1)) / (N + 1), which is the recursion
    // 1/N + (1/N) * sum over r in 2..N of (1 - L(r)) solved for L(N).
    let below = 0;
    for (let r = 2; r <= ceiling - 1; r++) {
      below += loss[r] as number;
    }
    loss[ceiling] = (ceiling - below) / (ceiling + 1);
  }
  return loss;
}

describe("the odds of being the one who rolls the 1", () => {
  it("matches the recursion it stands in for, at every ceiling", () => {
    const loss = bruteForce(400);
    for (let ceiling = 2; ceiling <= 400; ceiling++) {
      expect(lossOdds(ceiling), `ceiling ${ceiling}`).toBeCloseTo(
        loss[ceiling] as number,
        12,
      );
    }
  });

  it("is certain at a ceiling of one", () => {
    // There is nothing to roll but the 1. The game never reaches this — a 1
    // ends the duel rather than becoming the ceiling — but the formula should
    // still be telling the truth at its own edge.
    expect(lossOdds(1)).toBe(1);
  });

  it("makes the roller the underdog, always, by less and less", () => {
    let previous = lossOdds(2);
    expect(previous).toBeCloseTo(2 / 3, 12);
    for (let ceiling = 3; ceiling <= 400; ceiling++) {
      const odds = lossOdds(ceiling);
      expect(odds, `ceiling ${ceiling}`).toBeGreaterThan(0.5);
      expect(odds, `ceiling ${ceiling}`).toBeLessThan(previous);
      previous = odds;
    }
  });

  it("shrinks the edge to nothing at a table's opening number", () => {
    expect(edge(1_000)).toBeCloseTo(1 / 1_001_000, 12);
  });
});

describe("whether a pass is worth paying for", () => {
  /** The break-even ceiling for a price, found by asking rather than by hand. */
  const breakEven = (ante: number, price: number): number => {
    let highest = 0;
    for (let ceiling = 2; ceiling <= 1_000; ceiling++) {
      if (worthPassing(ceiling, ante, price)) {
        highest = ceiling;
      }
    }
    return highest;
  };

  it("turns correct at ceiling eight when a pass costs a tenth", () => {
    // The figure the spec chose the price from. If this moves, the game has
    // changed and the spec is out of date, not this test.
    expect(breakEven(500, 50)).toBe(8);
  });

  it("turns correct at ceiling five for a quarter and three for a half", () => {
    expect(breakEven(500, 125)).toBe(5);
    expect(breakEven(500, 250)).toBe(3);
  });

  it("is never worth it at a table's opening number", () => {
    expect(worthPassing(1_000, 500, 50)).toBe(false);
  });

  it("is worth many times its price when the number is nearly gone", () => {
    // A third of the ante swings on one pass at ceiling two, which is what
    // makes holding yours the only skill this game has.
    expect(passGain(2, 500)).toBeCloseTo(500 / 1.5, 6);
  });
});
