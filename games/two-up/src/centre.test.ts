import { describe, expect, it } from "vitest";
import { type Centre, type Cover, covered, payouts, uncovered } from "./centre.js";

const centre: Centre = { seatId: "spin", chips: 1_000 };
const cover = (seatId: string, chips: number): Cover => ({ seatId, chips });

describe("covering the centre", () => {
  it("adds up what the ring has put in", () => {
    expect(covered([cover("a", 400), cover("b", 200)])).toBe(600);
  });

  it("knows what is still open", () => {
    expect(uncovered(centre, [cover("a", 400)])).toBe(600);
    expect(uncovered(centre, [cover("a", 1_000)])).toBe(0);
  });

  it("never reports the centre as over-covered", () => {
    // Defensive: the table refuses a cover past the centre, and this is the
    // second lock on the same door.
    expect(uncovered(centre, [cover("a", 1_500)])).toBe(0);
  });
});

describe("paying a finished round", () => {
  it("hands the spinner the covered money and their own stake back", () => {
    /*
     * The uncovered six hundred was never at risk, so it comes back too: the
     * spinner staked a thousand, contested six hundred of it, and won.
     */
    const paid = payouts(centre, [cover("a", 400), cover("b", 200)], "spinner");
    expect(paid.get("spin")).toBe(1_600);
    expect(paid.get("a")).toBeUndefined();
    expect(paid.get("b")).toBeUndefined();
  });

  it("pays the ring double what each of them put in, and returns the rest", () => {
    const paid = payouts(centre, [cover("a", 400), cover("b", 200)], "ring");
    expect(paid.get("a")).toBe(800);
    expect(paid.get("b")).toBe(400);
    expect(paid.get("spin")).toBe(400);
  });

  it("gives everything back when the spinner is odded out", () => {
    const paid = payouts(centre, [cover("a", 400), cover("b", 200)], "oddedOut");
    expect(paid.get("spin")).toBe(1_000);
    expect(paid.get("a")).toBe(400);
    expect(paid.get("b")).toBe(200);
  });

  it("returns the whole centre when nobody covered it", () => {
    expect(payouts(centre, [], "spinner").get("spin")).toBe(1_000);
    expect(payouts(centre, [], "ring").get("spin")).toBe(1_000);
  });

  it("pays out exactly what was staked, whoever won", () => {
    /*
     * The property that makes this school honest: no bank stands behind it, so
     * every chip paid out has to be a chip somebody in the ring put in. If
     * these two ever disagree the table is either minting or stealing.
     */
    const covers = [cover("a", 400), cover("b", 200)];
    const inPot = centre.chips + covered(covers);
    for (const decided of ["spinner", "ring", "oddedOut"] as const) {
      const out = [...payouts(centre, covers, decided).values()].reduce((sum, one) => sum + one, 0);
      expect(out).toBe(inPot);
    }
  });

  it("splits pro rata when the covers are uneven", () => {
    const covers = [cover("a", 1), cover("b", 2)];
    const small: Centre = { seatId: "spin", chips: 3 };
    const paid = payouts(small, covers, "ring");
    expect(paid.get("a")).toBe(2);
    expect(paid.get("b")).toBe(4);
    expect(paid.get("spin")).toBe(0);
  });

  it("returns what overshot instead of doubling it", () => {
    /*
     * The second lock on the door `uncovered` already guards. The table
     * refuses a cover past the centre, so this should be unreachable — but
     * doubling a raw cover here would mint the difference, and a school with
     * no bank behind it has nowhere for minted chips to come from. Three
     * staked against a centre of two: one chip contested, one overshot.
     */
    const small: Centre = { seatId: "spin", chips: 2 };
    const covers = [cover("a", 3)];
    const inPot = small.chips + covered(covers);
    for (const decided of ["spinner", "ring", "oddedOut"] as const) {
      const out = [...payouts(small, covers, decided).values()].reduce((sum, one) => sum + one, 0);
      expect(out).toBe(inPot);
    }
    // Contested doubled, overshot returned: 2 x 2 + 1.
    expect(payouts(small, covers, "ring").get("a")).toBe(5);
  });
});
