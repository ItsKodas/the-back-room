import { describe, expect, it } from "vitest";
import {
  type Bet,
  type BetOn,
  FIVE_ODDS_PAYS,
  MIN_CHIP,
  STAKE_DIVISOR,
  headroom,
  needed,
  on,
  owed,
  staked,
} from "./bank.js";

const bet = (which: BetOn, chips: number): Bet => ({ on: which, chips });

describe("what the table can cover", () => {
  it("owes twice a lone even-money bet", () => {
    expect(owed([bet("heads", 100)])).toBe(200);
    expect(staked([bet("heads", 100)])).toBe(100);
    expect(needed([bet("heads", 100)])).toBe(100);
  });

  it("asks nothing of the bank when heads and tails cancel out", () => {
    /*
     * The point of working the whole cloth out exactly. Two coins land one way
     * or the other, so equal money on each side pays one and keeps the other —
     * and a cap that charged each player for their own worst case would refuse
     * perfectly safe bets all night.
     */
    expect(needed([bet("heads", 500), bet("tails", 500)])).toBe(0);
  });

  it("takes the worse side, not the sum of both", () => {
    expect(owed([bet("heads", 300), bet("tails", 100)])).toBe(600);
    expect(needed([bet("heads", 300), bet("tails", 100)])).toBe(200);
  });

  it("prices five odds at thirty-one back for one staked", () => {
    expect(FIVE_ODDS_PAYS).toBe(30);
    expect(owed([bet("fiveOdds", 100)])).toBe(3_100);
    expect(needed([bet("fiveOdds", 100)])).toBe(3_000);
    expect(needed([bet("fiveOdds", 100)])).toBe(STAKE_DIVISOR * 100);
  });

  it("knows five odds and the even money cannot both come in", () => {
    // Five odds is exactly the throw where heads and tails have both lost, so
    // the table is exposed to the larger of the two worlds and never to both.
    expect(owed([bet("heads", 1_000), bet("fiveOdds", 10)])).toBe(2_000);
  });

  it("adds up what is on one side", () => {
    expect(on([bet("heads", 100), bet("heads", 50), bet("tails", 25)], "heads")).toBe(150);
  });
});

describe("what a side can still take", () => {
  it("lets a bank of nothing cover money that is already matched", () => {
    /*
     * A table that works on its first night. There is nothing in the bank, but
     * a hundred is already on tails, so a hundred on heads is riskless and the
     * hundred-and-first is not.
     */
    expect(headroom(0, [bet("tails", 100)], "heads")).toBe(100);
    expect(headroom(0, [bet("tails", 100), bet("heads", 100)], "heads")).toBe(0);
  });

  it("divides the bank by thirty for five odds, and floors it", () => {
    expect(headroom(3_000, [], "fiveOdds")).toBe(100);
    expect(headroom(3_029, [], "fiveOdds")).toBe(100);
    expect(headroom(0, [], "fiveOdds")).toBe(0);
  });

  it("never offers more than the bank can actually pay", () => {
    /*
     * The guarantee, as a property rather than an example. Whatever is already
     * down, the largest chip this function will allow must leave the table
     * still able to pay the worst outcome — and one chip more must not.
     */
    const sides: BetOn[] = ["heads", "tails", "fiveOdds"];
    for (const bank of [-1, 0, 25, 500, 10_000, 250_000]) {
      for (const h of [0, 100, 5_000]) {
        for (const t of [0, 100, 5_000]) {
          for (const f of [0, 25, 400]) {
            const down = [bet("heads", h), bet("tails", t), bet("fiveOdds", f)];
            /*
             * Only positions the table could actually have reached. Several of
             * these combinations are already over the bank's head — a bank of
             * nothing with four hundred on the side bet was never allowed to
             * happen — and asking what may still go down on a cloth that is
             * already unsafe is a question with no honest answer.
             */
            if (owed(down) > bank + staked(down)) {
              continue;
            }
            for (const side of sides) {
              const most = headroom(bank, down, side);
              const withIt = [...down, bet(side, most)];
              expect(owed(withIt)).toBeLessThanOrEqual(bank + staked(withIt));
              const overIt = [...down, bet(side, most + 1)];
              expect(owed(overIt)).toBeGreaterThan(bank + staked(overIt));
            }
          }
        }
      }
    }
  });

  it("never goes negative on a bank that is already overdrawn", () => {
    expect(headroom(-500, [], "heads")).toBe(0);
    expect(headroom(-500, [], "fiveOdds")).toBe(0);
  });

  it("offers nothing on an overdrawn bank, even where the cloth looks matched", () => {
    /*
     * The case a clamped bank gets wrong, and it is an overdraw rather than a
     * rounding difference. Fifty on each side needs no bank, so the position is
     * legal even at -1 — but the side bet's chip is not covered, and a version
     * that clamped the bank to nought before the arithmetic would offer a chip
     * on heads that leaves the table owing 102 against 101.
     */
    const down = [bet("heads", 50), bet("tails", 50), bet("fiveOdds", 1)];
    expect(owed(down)).toBeLessThanOrEqual(-1 + staked(down));
    expect(headroom(-1, down, "heads")).toBe(0);
  });
});

describe("the chips this table takes", () => {
  it("starts at the same smallest chip as the rest of the building", () => {
    expect(MIN_CHIP).toBe(25);
  });
});
