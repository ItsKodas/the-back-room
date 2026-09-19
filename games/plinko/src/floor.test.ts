import { describe, expect, it } from "vitest";
import { COLOURS, colourOf } from "./floor.js";

describe("a player's colour", () => {
  it("is the same every visit", () => {
    expect(colourOf("user-1")).toBe(colourOf("user-1"));
  });

  it("is one of the eight", () => {
    for (let n = 0; n < 200; n += 1) {
      const colour = colourOf(`u${n}`);
      expect(Number.isInteger(colour)).toBe(true);
      expect(colour).toBeGreaterThanOrEqual(0);
      expect(colour).toBeLessThan(COLOURS);
    }
  });

  it("spreads a room across all of them", () => {
    const used = new Set(Array.from({ length: 100 }, (_, n) => colourOf(`u${n}`)));
    expect(used.size).toBe(COLOURS);
  });
});
