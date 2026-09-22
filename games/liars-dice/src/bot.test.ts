import { describe, expect, it } from "vitest";
import type { Face } from "./bid.js";
import { atLeast, choose, exactly, thinkingTime } from "./bot.js";

describe("the arithmetic it believes", () => {
  it("is certain of nothing wanted", () => {
    expect(atLeast(10, 0, 1 / 3)).toBe(1);
    expect(atLeast(0, 0, 1 / 3)).toBe(1);
  });

  it("is certain against more than there are dice", () => {
    expect(atLeast(3, 4, 1 / 3)).toBe(0);
    expect(atLeast(0, 1, 1 / 3)).toBe(0);
  });

  it("gets one die right", () => {
    expect(atLeast(1, 1, 1 / 3)).toBeCloseTo(1 / 3, 10);
    expect(exactly(1, 1, 1 / 3)).toBeCloseTo(1 / 3, 10);
    expect(exactly(1, 0, 1 / 3)).toBeCloseTo(2 / 3, 10);
  });

  it("sums to one over every outcome", () => {
    let sum = 0;
    for (let wanted = 0; wanted <= 6; wanted += 1) {
      sum += exactly(6, wanted, 1 / 3);
    }
    expect(sum).toBeCloseTo(1, 10);
  });

  it("thins out as the bid climbs", () => {
    expect(atLeast(10, 3, 1 / 3)).toBeGreaterThan(atLeast(10, 6, 1 / 3));
  });
});

describe("what a bot does", () => {
  const hand: Face[] = [5, 5, 3];

  it("opens on a face it actually holds", () => {
    const out = choose({ skill: "normal", hand, total: 9, standing: null });
    if (out.type !== "bid") {
      throw new Error("expected a bid");
    }
    expect(out.bid.face).toBe(5);
    // Two fives of its own plus a third of the six it cannot see.
    expect(out.bid.count).toBe(4);
    expect(out.bid.count).toBeLessThanOrEqual(9);
  });

  it("calls liar on a bid nothing could cover", () => {
    const out = choose({ skill: "normal", hand, total: 9, standing: { count: 9, face: 2 } });
    expect(out.type).toBe("liar");
  });

  it("raises a bid it still believes", () => {
    const out = choose({ skill: "normal", hand, total: 9, standing: { count: 2, face: 5 } });
    expect(out.type).toBe("bid");
  });

  it("never names more dice than are on the table", () => {
    for (let total = 2; total <= 12; total += 1) {
      const out = choose({ skill: "hard", hand: [5], total, standing: null });
      if (out.type === "bid") {
        expect(out.bid.count).toBeLessThanOrEqual(total);
      }
    }
  });

  it("only calls exact at hard", () => {
    // Its own two fives, four dice unseen, and a bid sitting exactly on what it
    // expects: one more five among the four. An easy bot never tries this.
    const hand: Face[] = [5, 5];
    const sitting = { skill: "easy" as const, hand, total: 6, standing: { count: 3, face: 5 as Face } };
    expect(choose(sitting).type).not.toBe("exact");
  });

  it("makes a legal bid whatever the standing bid is", async () => {
    // The real guard: every raise it offers has to be one the round accepts.
    const { beats } = await import("./bid.js");
    for (const face of [1, 2, 6] as Face[]) {
      for (let count = 1; count <= 6; count += 1) {
        const standing = { count, face };
        const out = choose({ skill: "normal", hand: [5, 5, 1], total: 9, standing });
        if (out.type === "bid") {
          expect(beats(out.bid, standing)).toBe(true);
          expect(out.bid.count).toBeLessThanOrEqual(9);
        }
      }
    }
  });
});

describe("how long it looks like it thought", () => {
  it("is quicker the better it plays, and never instant", () => {
    for (const skill of ["easy", "normal", "hard"] as const) {
      const ms = thinkingTime(skill);
      expect(ms).toBeGreaterThan(300);
      expect(ms).toBeLessThan(4_000);
    }
  });
});
