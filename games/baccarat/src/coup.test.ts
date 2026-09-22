import { describe, expect, it } from "vitest";
import type { Card, Rank } from "./cards.js";
import { bankerDraws, coupFrom, deal, playerDraws, totalOf, valueOf } from "./coup.js";

/** A card of this rank, suit irrelevant — nothing in baccarat reads a suit. */
const card = (rank: Rank): Card => ({ rank, suit: "spades" });

/**
 * A shoe that deals these ranks in this order.
 *
 * Written out rather than produced by a seeded shuffle, because what these
 * tests are about is the tableau and not the shuffle. A test that has to be
 * read backwards through a PRNG to see which hand it is asserting about is a
 * test nobody will maintain.
 */
const shoe = (...ranks: Rank[]): Card[] => ranks.map(card);

describe("what a card is worth", () => {
  it("counts the ace as one", () => {
    expect(valueOf(card("A"))).toBe(1);
  });

  it("counts two through nine as themselves", () => {
    for (const rank of ["2", "3", "4", "5", "6", "7", "8", "9"] as Rank[]) {
      expect(valueOf(card(rank)), rank).toBe(Number(rank));
    }
  });

  it("counts the ten and the court as nothing", () => {
    for (const rank of ["10", "J", "Q", "K"] as Rank[]) {
      expect(valueOf(card(rank)), rank).toBe(0);
    }
  });

  it("totals modulo ten", () => {
    expect(totalOf([card("9"), card("7")])).toBe(6);
    expect(totalOf([card("K"), card("K")])).toBe(0);
    expect(totalOf([card("5"), card("5"), card("5")])).toBe(5);
  });
});

describe("the player's rule", () => {
  it("draws on nought to five", () => {
    for (const total of [0, 1, 2, 3, 4, 5]) {
      expect(playerDraws(total), `${total}`).toBe(true);
    }
  });

  it("stands on six and seven", () => {
    expect(playerDraws(6)).toBe(false);
    expect(playerDraws(7)).toBe(false);
  });
});

describe("the banker's rule, when the player stood", () => {
  it("draws on nought to five and stands on six and seven", () => {
    for (const total of [0, 1, 2, 3, 4, 5]) {
      expect(bankerDraws(total, null), `${total}`).toBe(true);
    }
    expect(bankerDraws(6, null)).toBe(false);
    expect(bankerDraws(7, null)).toBe(false);
  });
});

/*
 * The whole table, every total against every third card.
 *
 * Written out as a grid rather than as the rule itself, on purpose: a test
 * that restates the implementation's condition proves only that it was typed
 * twice. This is the table as it is printed on a dealer's card, and it is the
 * thing the implementation has to agree with.
 */
describe("the banker's rule, when the player drew", () => {
  //                          third card value: 0  1  2  3  4  5  6  7  8  9
  const TABLE: Record<number, boolean[]> = {
    0: [true, true, true, true, true, true, true, true, true, true],
    1: [true, true, true, true, true, true, true, true, true, true],
    2: [true, true, true, true, true, true, true, true, true, true],
    3: [true, true, true, true, true, true, true, true, false, true],
    4: [false, false, true, true, true, true, true, true, false, false],
    5: [false, false, false, false, true, true, true, true, false, false],
    6: [false, false, false, false, false, false, true, true, false, false],
    7: [false, false, false, false, false, false, false, false, false, false],
  };

  for (const [total, draws] of Object.entries(TABLE)) {
    for (const [third, expected] of draws.entries()) {
      it(`banker ${total} against a ${third} ${expected ? "draws" : "stands"}`, () => {
        expect(bankerDraws(Number(total), third)).toBe(expected);
      });
    }
  }
});

describe("a coup", () => {
  it("stands both sides on a natural nine", () => {
    // Player 4+5 = 9, banker 3+2 = 5. Dealt P, B, P, B.
    const coup = coupFrom(shoe("4", "3", "5", "2"));
    expect(coup.natural).toBe(true);
    expect(coup.player).toHaveLength(2);
    expect(coup.banker).toHaveLength(2);
    expect(coup.playerTotal).toBe(9);
    expect(coup.bankerTotal).toBe(5);
    expect(coup.outcome).toBe("player");
  });

  it("stands both sides on a natural eight, even against a drawing total", () => {
    // Player 2+3 = 5, banker 4+4 = 8.
    const coup = coupFrom(shoe("2", "4", "3", "4"));
    expect(coup.natural).toBe(true);
    expect(coup.player).toHaveLength(2);
    expect(coup.banker).toHaveLength(2);
    expect(coup.outcome).toBe("banker");
  });

  it("is a tie when two naturals match", () => {
    // Both 9.
    const coup = coupFrom(shoe("4", "4", "5", "5"));
    expect(coup.natural).toBe(true);
    expect(coup.outcome).toBe("tie");
  });

  it("gives the player a third card on five and the banker one on four", () => {
    // Player 2+3 = 5 draws; banker 2+2 = 4 against a third card of 6 draws.
    const coup = coupFrom(shoe("2", "2", "3", "2", "6", "5"));
    expect(coup.player.map((c) => c.rank)).toEqual(["2", "3", "6"]);
    expect(coup.banker.map((c) => c.rank)).toEqual(["2", "2", "5"]);
    expect(coup.playerTotal).toBe(1); // 2+3+6 = 11 → 1
    expect(coup.bankerTotal).toBe(9); // 2+2+5 = 9
    expect(coup.outcome).toBe("banker");
  });

  it("stands the player on six and still lets the banker draw on five", () => {
    // Player 2+4 = 6 stands; banker 2+3 = 5 draws because the player stood.
    const coup = coupFrom(shoe("2", "2", "4", "3", "9"));
    expect(coup.player).toHaveLength(2);
    expect(coup.banker.map((c) => c.rank)).toEqual(["2", "3", "9"]);
    expect(coup.bankerTotal).toBe(4);
    expect(coup.outcome).toBe("player");
  });

  it("ties when the totals match", () => {
    // Player 3+4 = 7 stands, banker 3+4 = 7 stands.
    const coup = coupFrom(shoe("3", "3", "4", "4"));
    expect(coup.outcome).toBe("tie");
    expect(coup.natural).toBe(false);
  });

  it("deals a whole coup from a shuffle", () => {
    const coup = deal(() => 0.5);
    expect(coup.player.length).toBeGreaterThanOrEqual(2);
    expect(coup.player.length).toBeLessThanOrEqual(3);
    expect(coup.banker.length).toBeGreaterThanOrEqual(2);
    expect(coup.banker.length).toBeLessThanOrEqual(3);
    expect(["player", "banker", "tie"]).toContain(coup.outcome);
  });
});
