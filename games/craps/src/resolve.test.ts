import { describe, expect, it } from "vitest";
import { CHIPS, HORN_STEP, MIN_CHIP } from "./bank.js";
import { OUTCOMES, type Roll, total } from "./dice.js";
import {
  after,
  back,
  decided,
  type Hand,
  maxOdds,
  multiplier,
  nextPoint,
  ratioOf,
  sleeps,
} from "./resolve.js";
import { POINTS, SPOTS, type Spot, spotAt } from "./spots.js";

const at = (id: string) => spotAt(id) as Spot;
const comeOut: Hand = { point: null };
const on = (point: number): Hand => ({ point });
/** The first roll with this total, which is all most of these need. */
const rollOf = (n: number): Roll => OUTCOMES.find((one) => total(one) === n) as Roll;
const pair = (n: number): Roll => OUTCOMES.find((one) => total(one) === n && one[0] === one[1]) as Roll;
const easy = (n: number): Roll => OUTCOMES.find((one) => total(one) === n && one[0] !== one[1]) as Roll;
const hands: Hand[] = [comeOut, ...POINTS.map(on)];

describe("the pass line", () => {
  it("wins on seven and eleven and loses to the craps numbers, on a come-out", () => {
    for (const n of [7, 11]) expect(multiplier(at("pass"), rollOf(n), comeOut)).toEqual([2, 1]);
    for (const n of [2, 3, 12]) expect(multiplier(at("pass"), rollOf(n), comeOut)).toEqual([0, 1]);
    for (const n of [7, 11, 2, 3, 12]) expect(after(at("pass"), rollOf(n), comeOut)).toBeNull();
  });

  it("stays put while a point is being set", () => {
    for (const n of POINTS) {
      expect(multiplier(at("pass"), rollOf(n), comeOut)).toEqual([0, 1]);
      expect(after(at("pass"), rollOf(n), comeOut)).toBe("pass");
    }
  });

  it("wins on its point and loses to the seven", () => {
    expect(multiplier(at("pass"), rollOf(6), on(6))).toEqual([2, 1]);
    expect(after(at("pass"), rollOf(6), on(6))).toBeNull();
    expect(multiplier(at("pass"), rollOf(7), on(6))).toEqual([0, 1]);
    expect(after(at("pass"), rollOf(7), on(6))).toBeNull();
    expect(after(at("pass"), rollOf(5), on(6))).toBe("pass");
  });
});

describe("don't pass", () => {
  it("bars the twelve rather than winning on it", () => {
    // The whole house edge on the dark side. A twelve that paid would make
    // don't pass strictly better than pass, and the bank would never fill.
    expect(multiplier(at("dontpass"), rollOf(12), comeOut)).toEqual([1, 1]);
    expect(after(at("dontpass"), rollOf(12), comeOut)).toBeNull();
  });

  it("wins on two and three, loses to seven and eleven", () => {
    for (const n of [2, 3]) expect(multiplier(at("dontpass"), rollOf(n), comeOut)).toEqual([2, 1]);
    for (const n of [7, 11]) expect(multiplier(at("dontpass"), rollOf(n), comeOut)).toEqual([0, 1]);
  });

  it("wins on the seven once a point is on", () => {
    expect(multiplier(at("dontpass"), rollOf(7), on(8))).toEqual([2, 1]);
    expect(multiplier(at("dontpass"), rollOf(8), on(8))).toEqual([0, 1]);
  });
});

describe("come bets travel", () => {
  it("moves to the number it rolled rather than resolving", () => {
    expect(after(at("come"), rollOf(5), on(9))).toBe("come:5");
    expect(multiplier(at("come"), rollOf(5), on(9))).toEqual([0, 1]);
    expect(after(at("dontcome"), rollOf(5), on(9))).toBe("dontcome:5");
  });

  it("acts as its own come-out in the box, whatever the table's point is", () => {
    expect(multiplier(at("come"), rollOf(7), on(9))).toEqual([2, 1]);
    expect(multiplier(at("dontcome"), rollOf(11), on(9))).toEqual([0, 1]);
    expect(multiplier(at("dontcome"), rollOf(12), on(9))).toEqual([1, 1]);
  });

  it("wins on its own number once it has travelled", () => {
    expect(multiplier(at("come:5"), rollOf(5), on(9))).toEqual([2, 1]);
    expect(multiplier(at("come:5"), rollOf(7), on(9))).toEqual([0, 1]);
    expect(multiplier(at("dontcome:5"), rollOf(7), on(9))).toEqual([2, 1]);
    expect(multiplier(at("dontcome:5"), rollOf(5), on(9))).toEqual([0, 1]);
  });
});

describe("odds pay true, which is the whole point of them", () => {
  it("pays taken odds at the real chance of the number", () => {
    // Two ways to make a four against six ways to make a seven: 2 to 1.
    expect(multiplier(at("odds:pass"), rollOf(4), on(4))).toEqual([3, 1]);
    expect(multiplier(at("odds:pass"), rollOf(5), on(5))).toEqual([5, 2]);
    expect(multiplier(at("odds:pass"), rollOf(6), on(6))).toEqual([11, 5]);
    // And in chips, which is the claim that matters: exact, at every
    // denomination in the tray.
    expect(back(MIN_CHIP, multiplier(at("odds:pass"), rollOf(5), on(5)))).toBe(75);
  });

  it("pays laid odds the other way up", () => {
    expect(multiplier(at("odds:dontpass"), rollOf(7), on(4))).toEqual([3, 2]);
    expect(multiplier(at("odds:dontpass"), rollOf(7), on(5))).toEqual([5, 3]);
    expect(multiplier(at("odds:dontpass"), rollOf(7), on(6))).toEqual([11, 6]);
    expect(back(MIN_CHIP, multiplier(at("odds:dontpass"), rollOf(7), on(6)))).toBe(55);
  });

  it("takes its number from the spot when it is behind a come bet", () => {
    // The table's point is nine; this bet is backing a come bet on six.
    expect(multiplier(at("odds:come:6"), rollOf(6), on(9))).toEqual([11, 5]);
    expect(multiplier(at("odds:come:6"), rollOf(9), on(9))).toEqual([0, 1]);
  });

  it("caps taken odds at three, four and five times the line", () => {
    expect(maxOdds(4, 100, false)).toBe(300);
    expect(maxOdds(10, 100, false)).toBe(300);
    expect(maxOdds(5, 100, false)).toBe(400);
    expect(maxOdds(6, 100, false)).toBe(500);
    // Which is what three-four-five is for: the win is six times the line,
    // every point, so the table's exposure does not lurch about with the dice.
    for (const point of POINTS) {
      const odds = maxOdds(point, 100, false);
      // Through back(), not ratioOf() times chips. The claim being made here
      // is that the cap pays exactly six times the line, and the float route
      // gives 600.0000000000001 on the six — which a loosened assertion would
      // accept along with prices that are actually wrong.
      expect(back(odds, multiplier(at("odds:pass"), rollOf(point), on(point))) - odds).toBe(600);
    }
  });

  it("caps a lay at whatever would win the same", () => {
    for (const point of POINTS) {
      const lay = maxOdds(point, 100, true);
      const win = back(lay, multiplier(at("odds:dontpass"), rollOf(7), on(point))) - lay;
      expect(win).toBeLessThanOrEqual(600);
      // And not meanly under it: the cap is the largest lay that fits.
      expect(win).toBeGreaterThan(599);
    }
  });
});

describe("the numbers stay up when they win", () => {
  it("hands over winnings only and keeps the bet on the cloth", () => {
    // 7/6 and not 13/6. The six is still on the felt, so handing it back
    // would be paying it out twice — and the bank arithmetic is built on it.
    expect(multiplier(at("place:6"), rollOf(6), on(9))).toEqual([7, 6]);
    expect(after(at("place:6"), rollOf(6), on(9))).toBe("place:6");
    expect(multiplier(at("place:4"), rollOf(4), on(9))).toEqual([9, 5]);
    expect(multiplier(at("place:5"), rollOf(5), on(9))).toEqual([7, 5]);
    expect(multiplier(at("big:8"), rollOf(8), on(9))).toEqual([1, 1]);
    // A thirty on the six hands over exactly thirty-five. Not 35.000000000000004,
    // which is what a float multiplier gives and why there is a ratio here.
    expect(back(MIN_CHIP, multiplier(at("place:6"), rollOf(6), on(9)))).toBe(35);
    expect(after(at("big:8"), rollOf(8), on(9))).toBe("big:8");
  });

  it("is taken down by the seven", () => {
    for (const id of ["place:6", "place:4", "big:8"]) {
      expect(multiplier(at(id), rollOf(7), on(9))).toEqual([0, 1]);
      expect(after(at(id), rollOf(7), on(9))).toBeNull();
    }
  });
});

describe("the field, the hardways and the middle", () => {
  it("pays the field its three different prices", () => {
    for (const n of [3, 4, 9, 10, 11]) {
      expect(multiplier(at("field"), rollOf(n), on(8))).toEqual([2, 1]);
    }
    expect(multiplier(at("field"), rollOf(2), on(8))).toEqual([3, 1]);
    expect(multiplier(at("field"), rollOf(12), on(8))).toEqual([4, 1]);
    for (const n of [5, 6, 7, 8]) expect(multiplier(at("field"), rollOf(n), on(8))).toEqual([0, 1]);
    // One roll, always. It is never there afterwards, win or lose.
    for (const one of OUTCOMES) expect(after(at("field"), one, on(8))).toBeNull();
  });

  it("pays a hardway only on the pair, and stays up when it does", () => {
    expect(multiplier(at("hard:8"), pair(8), on(9))).toEqual([9, 1]);
    expect(after(at("hard:8"), pair(8), on(9))).toBe("hard:8");
    expect(multiplier(at("hard:4"), pair(4), on(9))).toEqual([7, 1]);
  });

  it("loses a hardway to the easy way and to the seven", () => {
    expect(multiplier(at("hard:8"), easy(8), on(9))).toEqual([0, 1]);
    expect(after(at("hard:8"), easy(8), on(9))).toBeNull();
    expect(after(at("hard:8"), rollOf(7), on(9))).toBeNull();
    // And is simply still there after a roll that was none of its business.
    expect(after(at("hard:8"), rollOf(5), on(9))).toBe("hard:8");
  });

  it("prices the one-roll propositions", () => {
    expect(multiplier(at("any7"), rollOf(7), on(9))).toEqual([5, 1]);
    expect(multiplier(at("anycraps"), rollOf(3), on(9))).toEqual([8, 1]);
    expect(multiplier(at("two"), rollOf(2), on(9))).toEqual([31, 1]);
    expect(multiplier(at("twelve"), rollOf(12), on(9))).toEqual([31, 1]);
    expect(multiplier(at("three"), rollOf(3), on(9))).toEqual([16, 1]);
    expect(multiplier(at("eleven"), rollOf(11), on(9))).toEqual([16, 1]);
  });

  it("splits the horn four ways and the C and E two", () => {
    // A horn of sixty is fifteen on each of 2, 3, 11 and 12. A two pays that
    // fifteen at thirty to one and the other forty-five is gone: 465 back.
    expect(back(HORN_STEP, multiplier(at("horn"), rollOf(2), on(9)))).toBe(465);
    expect(back(HORN_STEP, multiplier(at("horn"), rollOf(3), on(9)))).toBe(240);
    expect(back(HORN_STEP, multiplier(at("horn"), rollOf(11), on(9)))).toBe(240);
    expect(back(HORN_STEP, multiplier(at("horn"), rollOf(12), on(9)))).toBe(465);
    expect(multiplier(at("horn"), rollOf(7), on(9))).toEqual([0, 1]);
    expect(back(MIN_CHIP, multiplier(at("ce"), rollOf(12), on(9)))).toBe(120);
    expect(back(MIN_CHIP, multiplier(at("ce"), rollOf(11), on(9)))).toBe(240);
  });
});

describe("the hand itself", () => {
  it("sets a point from a come-out and then keeps it", () => {
    for (const n of POINTS) expect(nextPoint(comeOut, rollOf(n))).toBe(n);
    for (const n of [2, 3, 7, 11, 12]) expect(nextPoint(comeOut, rollOf(n))).toBeNull();
    expect(nextPoint(on(6), rollOf(5))).toBe(6);
  });

  it("ends on the point or on the seven", () => {
    expect(nextPoint(on(6), rollOf(6))).toBeNull();
    expect(nextPoint(on(6), rollOf(7))).toBeNull();
    expect(decided(on(6), rollOf(6))).toBe("made");
    expect(decided(on(6), rollOf(7))).toBe("sevenOut");
    expect(decided(comeOut, rollOf(6))).toBe("set");
    expect(decided(comeOut, rollOf(7))).toBeNull();
    expect(decided(on(6), rollOf(5))).toBeNull();
  });

  it("sleeps the numbers and the odds on a come-out, and nothing else", () => {
    expect(sleeps(at("place:6"), comeOut, false)).toBe(true);
    expect(sleeps(at("big:6"), comeOut, false)).toBe(true);
    // Working them is the player's own call, and the toggle is what makes it.
    expect(sleeps(at("place:6"), comeOut, true)).toBe(false);
    // Odds sleep whatever the toggle says: there is no number to back yet.
    expect(sleeps(at("odds:pass"), comeOut, true)).toBe(true);
    expect(sleeps(at("pass"), comeOut, false)).toBe(false);
    expect(sleeps(at("field"), comeOut, false)).toBe(false);
    expect(sleeps(at("hard:8"), comeOut, false)).toBe(false);
    for (const one of SPOTS.values()) expect(sleeps(one, on(6), false)).toBe(false);
  });
});

describe("the rulebook as a whole", () => {
  it("never sends chips to a spot that does not exist", () => {
    for (const spot of SPOTS.values()) {
      for (const one of OUTCOMES) {
        for (const hand of hands) {
          const next = after(spot, one, hand);
          if (next !== null) expect(spotAt(next), `${spot.id} -> ${next}`).not.toBeNull();
        }
      }
    }
  });

  it("never pays a fraction of a chip, for any chip in the tray", () => {
    // Which is the entire reason the tray is multiples of thirty. A
    // twenty-five on the six owes 29.166, and there is no such chip.
    for (const spot of SPOTS.values()) {
      const step = spot.id === "horn" ? HORN_STEP : MIN_CHIP;
      for (const chips of CHIPS.filter((one) => one % step === 0)) {
        for (const one of OUTCOMES) {
          for (const hand of hands) {
            const paid = back(chips, multiplier(spot, one, hand));
            expect(Number.isInteger(paid), `${spot.id} ${chips} ${one} ${hand.point}`).toBe(true);
          }
        }
      }
    }
  });

  it("only ever pays a standing bet without settling it", () => {
    // A bet still on the cloth has not been settled, so handing over its stake
    // now would hand it over twice — unless it is one of the kinds that pay
    // winnings only and stay. Anything else doing both is a leak.
    const standing = new Set(["place", "big", "hard"]);
    for (const spot of SPOTS.values()) {
      if (standing.has(spot.kind)) continue;
      for (const one of OUTCOMES) {
        for (const hand of hands) {
          if (after(spot, one, hand) !== null) {
            expect(multiplier(spot, one, hand), `${spot.id}`).toEqual([0, 1]);
          }
        }
      }
    }
  });

  it("never pays more than thirty-one times a chip, which is what the cap rests on", () => {
    for (const spot of SPOTS.values()) {
      for (const one of OUTCOMES) {
        for (const hand of hands) {
          expect(ratioOf(multiplier(spot, one, hand)), `${spot.id}`).toBeLessThanOrEqual(31);
        }
      }
    }
  });
});
