import { describe, expect, it } from "vitest";
import type { Bid, Face } from "./bid.js";
import { beats, countOf, FACES, isFace, key, leastCount, minRaise, says } from "./bid.js";

const bid = (count: number, face: Face): Bid => ({ count, face });

describe("what beats what, on a plain face", () => {
  it("takes more of anything", () => {
    expect(beats(bid(5, 2), bid(4, 6))).toBe(true);
  });

  it("takes the same count at a higher face", () => {
    expect(beats(bid(4, 6), bid(4, 5))).toBe(true);
    expect(beats(bid(4, 4), bid(4, 5))).toBe(false);
  });

  it("refuses the same bid back", () => {
    expect(beats(bid(4, 5), bid(4, 5))).toBe(false);
  });

  it("refuses fewer", () => {
    expect(beats(bid(3, 6), bid(4, 2))).toBe(false);
  });
});

describe("switching to ones", () => {
  it("takes half the count, rounded up", () => {
    // Four sixes standing: two ones is the cheapest switch.
    expect(beats(bid(2, 1), bid(4, 6))).toBe(true);
    expect(beats(bid(1, 1), bid(4, 6))).toBe(false);
  });

  it("rounds an odd count up", () => {
    // Three of anything needs two ones, not one and a half.
    expect(beats(bid(2, 1), bid(3, 2))).toBe(true);
    expect(beats(bid(1, 1), bid(3, 2))).toBe(false);
  });

  it("lets ones win the tie at equal doubled count", () => {
    // Two ones is worth four, and four ones outranks four sixes, because only
    // actual ones can fill a bid on ones.
    expect(beats(bid(2, 1), bid(4, 6))).toBe(true);
    expect(beats(bid(4, 6), bid(2, 1))).toBe(false);
  });
});

describe("switching off ones", () => {
  it("costs double and one", () => {
    expect(beats(bid(5, 2), bid(2, 1))).toBe(true);
    expect(beats(bid(4, 6), bid(2, 1))).toBe(false);
  });

  it("still takes more ones", () => {
    expect(beats(bid(3, 1), bid(2, 1))).toBe(true);
    expect(beats(bid(2, 1), bid(3, 1))).toBe(false);
  });
});

describe("an opening bid", () => {
  it("is anything at all", () => {
    expect(beats(bid(1, 2), null)).toBe(true);
    expect(beats(bid(1, 1), null)).toBe(true);
  });

  it("is never nothing, and never a fraction", () => {
    expect(beats(bid(0, 5), null)).toBe(false);
    expect(beats(bid(-1, 5), null)).toBe(false);
    expect(beats(bid(1.5, 5), null)).toBe(false);
  });
});

describe("the order underneath it", () => {
  it("is a strict total order over every bid up to fifty dice", () => {
    const all: Bid[] = [];
    for (let count = 1; count <= 50; count += 1) {
      for (const face of FACES) {
        all.push(bid(count, face));
      }
    }
    // Collect violations rather than call expect() 180k times.
    const violations: string[] = [];
    for (const a of all) {
      // Irreflexive: nothing beats itself.
      if (beats(a, a)) {
        violations.push(`${says(a)}: beats itself`);
      }
      for (const b of all) {
        if (a.count === b.count && a.face === b.face) {
          continue;
        }
        const ab = beats(a, b);
        const ba = beats(b, a);
        // Antisymmetric and total: for any two different bids, exactly one
        // beats the other. This protects the ordering across the ones/plain
        // boundary, where a face-only comparison would invert the pair.
        if (!(ab || ba)) {
          violations.push(`${says(a)} vs ${says(b)}: neither beats the other`);
        }
        if (ab && ba) {
          violations.push(`${says(a)} vs ${says(b)}: both beat each other`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("is transitive across the ones boundary", () => {
    // The case worth naming: four sixes < two ones < five twos, so four sixes
    // must be under five twos as well.
    expect(beats(bid(2, 1), bid(4, 6))).toBe(true);
    expect(beats(bid(5, 2), bid(2, 1))).toBe(true);
    expect(beats(bid(5, 2), bid(4, 6))).toBe(true);
  });

  it("gives ones a doubled key", () => {
    expect(key(bid(3, 1))[0]).toBe(6);
    expect(key(bid(3, 5))[0]).toBe(3);
  });
});

describe("the least count at a face", () => {
  it("is the cheapest legal bid there", () => {
    expect(leastCount(6, bid(4, 5), 30)).toBe(4);
    expect(leastCount(2, bid(4, 5), 30)).toBe(5);
    expect(leastCount(1, bid(4, 5), 30)).toBe(2);
  });

  it("is null when the ceiling puts it out of reach", () => {
    // Three ones standing with six dice in play: a plain face needs seven.
    expect(leastCount(6, bid(3, 1), 6)).toBe(null);
    // But more ones is still there.
    expect(leastCount(1, bid(3, 1), 6)).toBe(4);
  });
});

describe("the lowest legal raise", () => {
  it("opens as cheaply as the game allows", () => {
    expect(minRaise(null, 10)).toEqual(bid(1, 2));
  });

  it("is the same count at the next face up", () => {
    expect(minRaise(bid(4, 3), 30)).toEqual(bid(4, 4));
  });

  it("is two ones over four sixes", () => {
    expect(minRaise(bid(4, 6), 30)).toEqual(bid(2, 1));
  });

  it("is more ones when nothing else fits under the ceiling", () => {
    expect(minRaise(bid(3, 1), 6)).toEqual(bid(4, 1));
  });

  it("is null at the very top of the board", () => {
    // Every die in play, on the highest face, with ones already priced past it.
    expect(minRaise(bid(30, 1), 30)).toBe(null);
  });

  it("never names more dice than are on the table", () => {
    for (let total = 1; total <= 20; total += 1) {
      const raise = minRaise(bid(total, 6), total);
      if (raise !== null) {
        expect(raise.count).toBeLessThanOrEqual(total);
      }
    }
  });
});

describe("counting a face", () => {
  const hands: Face[][] = [
    [1, 5, 5],
    [1, 2, 6],
  ];

  it("counts ones as the face bid", () => {
    expect(countOf(hands, 5)).toBe(4);
  });

  it("counts ones as nothing but ones when ones are bid", () => {
    expect(countOf(hands, 1)).toBe(2);
  });

  it("counts a face nobody holds as none", () => {
    expect(countOf([[2, 3]], 6)).toBe(0);
  });
});

describe("saying a bid out loud", () => {
  it("names the count and pluralises the face", () => {
    expect(says(bid(1, 1))).toBe("one one");
    expect(says(bid(4, 5))).toBe("four fives");
    expect(says(bid(11, 6))).toBe("eleven sixes");
    expect(says(bid(21, 2))).toBe("twenty-one twos");
    expect(says(bid(50, 3))).toBe("fifty threes");
  });
});

describe("a face from the wire", () => {
  it("accepts one to six and nothing else", () => {
    for (const face of FACES) {
      expect(isFace(face)).toBe(true);
    }
    expect(isFace(0)).toBe(false);
    expect(isFace(7)).toBe(false);
    expect(isFace(2.5)).toBe(false);
    expect(isFace("3")).toBe(false);
    expect(isFace(null)).toBe(false);
  });
});
