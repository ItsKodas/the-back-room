import { describe, expect, it } from "vitest";
import { COURT_EMBLEM, COURTS, isCourt, pipsFor, RANKS, SUITS, SUIT_PATH } from "./deck.js";

/**
 * The deck's geometry.
 *
 * Worth asserting because the failure is quiet: a card with the wrong number
 * of pips, or its odd one in the wrong place, looks almost right and nobody
 * finds it in a game. These are the rules a real deck follows, written down.
 */

describe("the pips on a card", () => {
  it("puts as many on as the rank says", () => {
    for (const rank of ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10"] as const) {
      const wanted = rank === "A" ? 1 : Number(rank);
      expect(pipsFor(rank), `${rank} should have ${wanted}`).toHaveLength(wanted);
    }
  });

  it("gives a court card none, because it has a panel instead", () => {
    for (const rank of COURTS) {
      expect(pipsFor(rank)).toHaveLength(0);
      expect(isCourt(rank)).toBe(true);
    }
  });

  it("turns the bottom half upside down, exactly as a real card does", () => {
    // Not decoration: it is what makes a card read the same either way up.
    const ten = pipsFor("10");
    const low = ten.filter((pip) => pip.turned);

    expect(low).toHaveLength(5);
    expect(ten.every((pip) => pip.turned === pip.y > 70)).toBe(true);
  });

  it("stands the seven's odd pip between the top pair and the middle pair", () => {
    /*
     * The detail that separates a deck somebody drew from a deck somebody
     * copied. A seven with its odd pip in the middle is subtly wrong in a way
     * people notice without being able to say why.
     */
    const seven = pipsFor("7");
    const centre = seven.filter((pip) => pip.x === 50);
    const left = seven.filter((pip) => pip.x !== 50 && !pip.turned).map((pip) => pip.y);

    expect(centre).toHaveLength(1);
    const odd = centre[0]?.y ?? 0;
    expect(odd).toBeGreaterThan(Math.min(...left));
    expect(odd).toBeLessThan(70);
  });

  it("keeps every card inside its own edges", () => {
    // A pip is about sixteen units across at the scale they are drawn, in a
    // card a hundred wide with a seven-unit margin. Nothing may reach the edge.
    for (const rank of RANKS) {
      for (const pip of pipsFor(rank)) {
        const reach = pip.big === true ? 18 : 9;
        expect(pip.x - reach, `${rank} left`).toBeGreaterThan(7);
        expect(pip.x + reach, `${rank} right`).toBeLessThan(93);
        expect(pip.y - reach, `${rank} top`).toBeGreaterThan(7);
        expect(pip.y + reach, `${rank} bottom`).toBeLessThan(133);
      }
    }
  });

  it("balances every column it draws", () => {
    // A layout with three pips down one side and two down the other is the
    // other quiet failure. Left and right always match.
    for (const rank of RANKS) {
      const pips = pipsFor(rank);
      const left = pips.filter((pip) => pip.x < 50).map((pip) => pip.y);
      const right = pips.filter((pip) => pip.x > 50).map((pip) => pip.y);
      expect(left, `${rank} columns`).toEqual(right);
    }
  });
});

describe("what every card is drawn from", () => {
  it("has a shape for all four suits", () => {
    for (const suit of SUITS) {
      expect(SUIT_PATH[suit]).toMatch(/^M/);
    }
  });

  it("has an emblem for each court, and none for anything else", () => {
    for (const rank of RANKS) {
      expect(COURT_EMBLEM[rank] !== undefined, rank).toBe(isCourt(rank));
    }
  });

  it("knows a court from a number", () => {
    expect(isCourt("K")).toBe(true);
    expect(isCourt("10")).toBe(false);
    expect(isCourt("A")).toBe(false);
  });
});
