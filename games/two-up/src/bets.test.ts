import { describe, expect, it } from "vitest";
import { type Placed, settle, toBets } from "./bets.js";

const down = (seatId: string, on: Placed["on"], chips: number): Placed => ({ seatId, on, chips });

describe("what the coins do to the chips", () => {
  it("pays an even-money winner double and the loser nothing", () => {
    const paid = settle([down("a", "heads", 100), down("b", "tails", 100)], "heads");
    expect(paid.get("a")).toEqual({ back: 200, staked: 100, won: [{ on: "heads", back: 200 }] });
    expect(paid.get("b")).toEqual({ back: 0, staked: 100, won: [] });
  });

  it("takes both sides when five odds comes in, and pays the side bet", () => {
    const paid = settle(
      [down("a", "heads", 100), down("b", "tails", 100), down("c", "fiveOdds", 10)],
      "fiveOdds",
    );
    expect(paid.get("a")?.back).toBe(0);
    expect(paid.get("b")?.back).toBe(0);
    expect(paid.get("c")?.back).toBe(310);
  });

  it("loses the side bet whenever the coins agree", () => {
    expect(settle([down("c", "fiveOdds", 10)], "heads").get("c")?.back).toBe(0);
  });

  it("adds up one seat's several piles", () => {
    const paid = settle([down("a", "heads", 100), down("a", "heads", 50), down("a", "tails", 25)], "heads");
    expect(paid.get("a")).toEqual({
      back: 300,
      staked: 175,
      won: [
        { on: "heads", back: 200 },
        { on: "heads", back: 100 },
      ],
    });
  });

  it("never pays more than the bank was told to hold", () => {
    /*
     * The two files agreeing, which is the property that matters. Whatever is
     * on the cloth and whatever the coins do, what settlement hands out must
     * not exceed what `owed` promised the bank would cover.
     */
    const cloth = [down("a", "heads", 700), down("b", "tails", 300), down("c", "fiveOdds", 20)];
    for (const called of ["heads", "tails", "fiveOdds"] as const) {
      const out = [...settle(cloth, called).values()].reduce((sum, one) => sum + one.back, 0);
      expect(out).toBeLessThanOrEqual(1_400);
    }
  });
});

describe("handing the cloth to the bank", () => {
  it("keeps every chip, since there are no ids to mistype", () => {
    expect(toBets([down("a", "heads", 100), down("b", "fiveOdds", 25)])).toEqual([
      { on: "heads", chips: 100 },
      { on: "fiveOdds", chips: 25 },
    ]);
  });
});
