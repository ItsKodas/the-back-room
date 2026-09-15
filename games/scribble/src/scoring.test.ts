import { describe, expect, it } from "vitest";
import { drawerPoints, guesserPoints } from "./scoring.js";

describe("a guesser's points", () => {
  it("is fifty, plus up to 250 for speed", () => {
    expect(guesserPoints(80_000, 80_000)).toBe(300);
    expect(guesserPoints(40_000, 80_000)).toBe(175);
    expect(guesserPoints(0, 80_000)).toBe(50);
  });

  it("never goes below fifty or above 300, whatever the clock says", () => {
    expect(guesserPoints(-5_000, 80_000)).toBe(50);
    expect(guesserPoints(99_000, 80_000)).toBe(300);
  });
});

describe("a drawer's points", () => {
  it("is 250 times the share of guessers who got it", () => {
    expect(drawerPoints(3, 4)).toBe(188);
    expect(drawerPoints(4, 4)).toBe(250);
    expect(drawerPoints(0, 4)).toBe(0);
  });

  it("is nothing when there was nobody to guess", () => {
    expect(drawerPoints(0, 0)).toBe(0);
  });
});
