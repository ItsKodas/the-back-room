import { describe, expect, it } from "vitest";
import { FACES, isHard, OUTCOMES, roll, total } from "./dice.js";

describe("two dice", () => {
  it("has every ordered pair exactly once", () => {
    expect(OUTCOMES).toHaveLength(36);
    const seen = new Set(OUTCOMES.map(([a, b]) => `${a}-${b}`));
    expect(seen.size).toBe(36);
  });

  it("is ordered rather than summed, because a hardway is the pair", () => {
    // 4+4 and 5+3 are both eight and only one of them pays the hard eight.
    // A module that worked in totals could not tell them apart at all.
    const eights = OUTCOMES.filter((one) => total(one) === 8);
    expect(eights).toHaveLength(5);
    expect(eights.filter(isHard)).toHaveLength(1);
  });

  it("counts the sums the way the odds actually fall", () => {
    const counts = new Map<number, number>();
    for (const one of OUTCOMES) counts.set(total(one), (counts.get(total(one)) ?? 0) + 1);
    // Pascal for two dice. A wrong OUTCOMES would still have 36 entries and
    // would be caught here rather than by a bank that quietly misprices.
    expect([...counts.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6],
      [8, 5], [9, 4], [10, 3], [11, 2], [12, 1],
    ]);
  });

  it("asks the source for a face each, never for a total", () => {
    // Two draws, not one: a single draw over eleven sums would make the seven
    // as likely as the two, which is a different game entirely.
    const drawn: number[] = [];
    const thrown = roll((faces) => {
      drawn.push(faces);
      return drawn.length - 1;
    });
    expect(drawn).toEqual([6, 6]);
    expect(thrown).toEqual([1, 2]);
  });

  it("can reach every face", () => {
    for (let at = 0; at < 6; at += 1) {
      expect(roll(() => at)).toEqual([FACES[at], FACES[at]]);
    }
  });
});
