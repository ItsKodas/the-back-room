import { describe, expect, it } from "vitest";
import { ANTE, anteFor, DICE, diceFor, LIARS_DICE, STAKES } from "./listing.js";

describe("the listing", () => {
  it("is a table game for two to ten", () => {
    expect(LIARS_DICE.id).toBe("liars-dice");
    expect(LIARS_DICE.shape).toBe("table");
    expect(LIARS_DICE.minSeats).toBe(2);
    expect(LIARS_DICE.maxSeats).toBe(10);
    expect(LIARS_DICE.open).toBe(true);
  });

  it("writes its own name with the L lit", () => {
    expect(LIARS_DICE.mark).toEqual({ text: "LIAR'S DICE", accentAt: 0 });
  });
});

describe("the stake", () => {
  it("is the default for anything unusable", () => {
    expect(anteFor(undefined)).toBe(ANTE);
    expect(anteFor("lots")).toBe(ANTE);
    expect(anteFor(Number.NaN)).toBe(ANTE);
  });

  it("snaps to the nearest level", () => {
    expect(anteFor(90)).toBe(100);
    expect(anteFor(4_000)).toBe(5_000);
    expect(anteFor(1_000_000)).toBe(5_000);
  });

  it("puts a figure exactly between two levels on the cheaper one", () => {
    // 300 is 200 from both 100 and 500. A host who asks for something between
    // two stakes is put on the cheaper of them, the same answer every time.
    expect(anteFor(300)).toBe(100);
  });

  it("only offers levels that divide by a hundred", () => {
    for (const level of STAKES) {
      expect(level % 100).toBe(0);
    }
  });
});

describe("how many dice", () => {
  it("is five unless the host says otherwise", () => {
    expect(diceFor(undefined)).toBe(DICE);
    expect(diceFor("five")).toBe(DICE);
  });

  it("snaps to three or five", () => {
    expect(diceFor(3)).toBe(3);
    expect(diceFor(4)).toBe(3);
    expect(diceFor(9)).toBe(5);
  });
});
