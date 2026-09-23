import { describe, expect, it } from "vitest";
import { back, commission, spotAt, SPOTS } from "./spots.js";

describe("the cloth", () => {
  it("takes three bets and no more", () => {
    expect(SPOTS.map((spot) => spot.id)).toEqual(["player", "banker", "tie"]);
  });

  it("knows nothing of a bet that is not on it", () => {
    expect(spotAt("player")).not.toBeNull();
    expect(spotAt("pair")).toBeNull();
    expect(spotAt("")).toBeNull();
    expect(spotAt("dragon")).toBeNull();
  });
});

describe("the commission", () => {
  /*
   * Five per cent of the smallest chip in the tray is 1.25, so it has to round
   * somewhere. It rounds up, so the house's edge can never round away.
   */
  it("rounds up to a whole chip", () => {
    expect(commission(25)).toBe(2); // 1.25 → 2
    expect(commission(50)).toBe(3); // 2.5  → 3
    expect(commission(100)).toBe(5); // exact
    expect(commission(250)).toBe(13); // 12.5 → 13
    expect(commission(500)).toBe(25); // exact
    expect(commission(5000)).toBe(250); // exact
  });

  it("is never nothing on a winning bet", () => {
    // A commission that floored would be nought below twenty, and a banker bet
    // that paid full even money is a bet the player is favoured on.
    for (let chips = 1; chips <= 100; chips += 1) {
      expect(commission(chips), `${chips}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("never turns the edge over", () => {
    /*
     * Banker wins 45.86% of coups, player 44.62%. Paying the banker
     * (1 - rate) even money leaves the house ahead only while the commission
     * is real, so the effective rate is asserted to stay above four per cent
     * at every chip in the tray.
     */
    for (const chips of [25, 50, 100, 250, 500, 1000, 5000]) {
      expect(commission(chips) / chips, `${chips}`).toBeGreaterThanOrEqual(0.05);
    }
  });
});

describe("what a chip gets back", () => {
  it("pays the player even money and takes the banker and the tie", () => {
    expect(back("player", 100, "player")).toBe(200);
    expect(back("banker", 100, "player")).toBe(0);
    expect(back("tie", 100, "player")).toBe(0);
  });

  it("pays the banker even money less commission", () => {
    expect(back("banker", 100, "banker")).toBe(195); // 200 - 5
    expect(back("banker", 25, "banker")).toBe(48); // 50 - 2
    expect(back("player", 100, "banker")).toBe(0);
  });

  it("pays the tie eight to one and pushes the two sides", () => {
    expect(back("tie", 100, "tie")).toBe(900);
    // A push is the stake back, not a loss and not a win.
    expect(back("player", 100, "tie")).toBe(100);
    expect(back("banker", 100, "tie")).toBe(100);
  });

  it("gives nothing back for nothing staked", () => {
    for (const outcome of ["player", "banker", "tie"] as const) {
      expect(back("player", 0, outcome)).toBe(0);
      expect(back("banker", 0, outcome)).toBe(0);
      expect(back("tie", 0, outcome)).toBe(0);
    }
  });
});
