import { describe, expect, it } from "vitest";
import { owed, staked } from "./bank.js";
import { type Placed, settle, toBets } from "./bets.js";

const on = (seatId: string, spotId: string, chips: number): Placed => ({ seatId, spotId, chips });

describe("reading the cloth", () => {
  it("resolves every chip to the spot it is on", () => {
    expect(toBets([on("a", "player", 100)])).toEqual([{ spot: "player", chips: 100 }]);
  });

  it("drops anything naming a bet the table does not take", () => {
    // The table refuses these on the way in; this is the second lock on the
    // same door, so nothing downstream has to defend against them.
    expect(toBets([on("a", "dragon", 100), on("a", "tie", 25)])).toEqual([
      { spot: "tie", chips: 25 },
    ]);
  });
});

describe("settling a coup", () => {
  it("pays the winning side and takes the rest", () => {
    const cloth = [on("a", "player", 100), on("b", "banker", 100), on("c", "tie", 50)];
    const paid = settle(cloth, "player");
    expect(paid.get("a")).toEqual({
      back: 200,
      staked: 100,
      won: [{ spotId: "player", back: 200 }],
    });
    expect(paid.get("b")).toEqual({ back: 0, staked: 100, won: [] });
    expect(paid.get("c")).toEqual({ back: 0, staked: 50, won: [] });
  });

  it("takes the commission out of a banker win", () => {
    const paid = settle([on("a", "banker", 100)], "banker");
    expect(paid.get("a")?.back).toBe(195);
  });

  it("pushes the two sides on a tie and pays the tie eight to one", () => {
    const cloth = [on("a", "player", 100), on("a", "tie", 25), on("b", "banker", 200)];
    const paid = settle(cloth, "tie");
    // A push is not a win: the stake comes back and nothing is added to it.
    expect(paid.get("a")?.back).toBe(100 + 225);
    expect(paid.get("a")?.staked).toBe(125);
    expect(paid.get("b")?.back).toBe(200);
  });

  it("adds up one seat's several piles", () => {
    const paid = settle([on("a", "player", 100), on("a", "player", 50)], "player");
    expect(paid.get("a")?.staked).toBe(150);
    expect(paid.get("a")?.back).toBe(300);
  });

  it("never hands back more than the cloth promised", () => {
    const cloth = [on("a", "player", 375), on("b", "banker", 125), on("c", "tie", 25)];
    for (const outcome of ["player", "banker", "tie"] as const) {
      const paid = settle(cloth, outcome);
      let handed = 0;
      for (const one of paid.values()) {
        handed += one.back;
      }
      expect(handed, outcome).toBeLessThanOrEqual(owed(toBets(cloth)));
    }
  });

  it("accounts for every chip that went down", () => {
    const cloth = [on("a", "player", 100), on("b", "tie", 25)];
    const paid = settle(cloth, "banker");
    let counted = 0;
    for (const one of paid.values()) {
      counted += one.staked;
    }
    expect(counted).toBe(staked(toBets(cloth)));
  });
});
