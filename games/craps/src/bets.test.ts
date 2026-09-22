import { describe, expect, it } from "vitest";
import { owed, staked as stakedOf } from "./bank.js";
import { type Placed, settle, toBets } from "./bets.js";
import { OUTCOMES, type Roll, total } from "./dice.js";
import type { Hand } from "./resolve.js";
import { POINTS } from "./spots.js";

const down = (seatId: string, spotId: string, chips: number, off = false): Placed => ({
  seatId,
  spotId,
  chips,
  off,
});
const comeOut: Hand = { point: null };
const on = (point: number): Hand => ({ point });
const rollOf = (n: number): Roll => OUTCOMES.find((one) => total(one) === n) as Roll;

describe("reading the cloth", () => {
  it("drops chips on a spot that does not exist", () => {
    // The table refuses these on the way in; this is the second lock on the
    // same door, so nothing downstream has to defend against it.
    expect(toBets([down("a", "hard:7", 30)])).toHaveLength(0);
    expect(settle([down("a", "hard:7", 30)], rollOf(7), on(6)).cloth).toHaveLength(0);
  });

  it("carries the off flag through to the bank", () => {
    expect(toBets([down("a", "pass", 30, true)])[0]?.off).toBe(true);
  });
});

describe("what a roll pays", () => {
  it("returns nothing at all for a loser, never a negative", () => {
    // The stake went into the bank when the chip went down, so losing is
    // simply not being paid. Keeping it that way is what makes the sum of
    // everything returned comparable against what the bank promised.
    const { paid } = settle([down("a", "pass", 300)], rollOf(7), on(6));
    expect(paid.get("a")).toEqual({ back: 0, staked: 300, won: [] });
  });

  it("hands back stake and winnings for a bet that ends", () => {
    const { paid, cloth } = settle([down("a", "pass", 300)], rollOf(6), on(6));
    expect(paid.get("a")?.back).toBe(600);
    expect(paid.get("a")?.staked).toBe(300);
    expect(cloth).toHaveLength(0);
  });

  it("hands back winnings only for a bet that stays, and leaves it there", () => {
    const { paid, cloth } = settle([down("a", "place:6", 300)], rollOf(6), on(9));
    expect(paid.get("a")?.back).toBe(350);
    // Nothing resolved, so nothing was staked this roll: the profit is 350.
    expect(paid.get("a")?.staked).toBe(0);
    expect(cloth).toEqual([down("a", "place:6", 300)]);
  });

  it("pushes a barred twelve back without calling it a win", () => {
    const { paid } = settle([down("a", "dontpass", 300)], rollOf(12), comeOut);
    expect(paid.get("a")?.back).toBe(300);
    expect(paid.get("a")?.staked).toBe(300);
    expect(paid.get("a")?.won).toHaveLength(0);
  });

  it("travels a come bet rather than settling it", () => {
    const { paid, cloth } = settle([down("a", "come", 300)], rollOf(5), on(9));
    expect(paid.get("a")?.back).toBe(0);
    expect(paid.get("a")?.staked).toBe(0);
    expect(cloth).toEqual([down("a", "come:5", 300)]);
  });

  it("leaves an off bet exactly where it was, neither won nor lost", () => {
    // The seven takes every place bet on the cloth — unless it is off, in
    // which case it is not on the cloth as far as the dice are concerned.
    const { paid, cloth } = settle([down("a", "place:6", 300, true)], rollOf(7), on(9));
    expect(paid.get("a")?.back ?? 0).toBe(0);
    expect(paid.get("a")?.staked ?? 0).toBe(0);
    // Back on the cloth with the flag cleared: it is recomputed every seal.
    expect(cloth).toEqual([down("a", "place:6", 300)]);
  });

  it("merges two bets that land on the same spot", () => {
    // Two piles on one spot would draw as two stacks and take back as one.
    const { cloth } = settle([down("a", "come", 300), down("a", "come", 600)], rollOf(5), on(9));
    expect(cloth).toEqual([down("a", "come:5", 900)]);
  });

  it("keeps every seat's chips apart", () => {
    const { paid } = settle(
      [down("a", "pass", 300), down("b", "dontpass", 300)],
      rollOf(7),
      on(6),
    );
    expect(paid.get("a")?.back).toBe(0);
    expect(paid.get("b")?.back).toBe(600);
  });
});

describe("what settling and the bank say about each other", () => {
  it("never pays more on any outcome than the bank was told to expect", () => {
    // The invariant the whole package exists to keep. owed() is what the cap
    // was worked out against; settle() is what actually gets handed over. If
    // these two ever disagree, the table is either refusing bets it could
    // carry or paying money it does not have.
    const cloth: Placed[] = [
      down("a", "pass", 300),
      down("a", "place:6", 600),
      down("b", "dontpass", 300),
      down("b", "hard:8", 60),
      down("b", "horn", 60),
      down("a", "field", 150),
      down("a", "come:5", 300),
      down("b", "odds:come:5", 600),
    ];
    for (const hand of [comeOut, ...POINTS.map(on)]) {
      const promised = owed(toBets(cloth), hand);
      for (const roll of OUTCOMES) {
        const { paid } = settle(cloth, roll, hand);
        let handed = 0;
        for (const one of paid.values()) handed += one.back;
        expect(handed, `${roll} on ${hand.point}`).toBeLessThanOrEqual(promised);
      }
      // And the promise is not idle padding: some outcome actually costs it.
      const worst = Math.max(
        ...OUTCOMES.map((roll) => {
          let handed = 0;
          for (const one of settle(cloth, roll, hand).paid.values()) handed += one.back;
          return handed;
        }),
      );
      expect(worst).toBe(promised);
    }
  });

  it("never loses a chip between the old cloth and the new one", () => {
    // Everything on the cloth either went back to somebody or is still down.
    const cloth: Placed[] = [down("a", "pass", 300), down("a", "place:6", 600)];
    for (const roll of OUTCOMES) {
      const { paid, cloth: next } = settle(cloth, roll, on(6));
      let resolved = 0;
      for (const one of paid.values()) resolved += one.staked;
      expect(resolved + stakedOf(toBets(next))).toBe(900);
    }
  });
});
