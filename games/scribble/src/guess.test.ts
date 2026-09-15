import { describe, expect, it } from "vitest";
import { containsWord, editDistance, isClose, isCorrect, normalise } from "./guess.js";

describe("normalising", () => {
  it("ignores case, accents, apostrophes and how words are joined", () => {
    expect(normalise("  Crème-Brûlée ")).toBe("creme brulee");
    expect(normalise("Kev's   van")).toBe("kevs van");
  });
});

describe("a correct guess", () => {
  it("matches however it was typed", () => {
    expect(isCorrect("LIGHTHOUSE", "lighthouse")).toBe(true);
    expect(isCorrect("fish-and chips", "Fish and chips")).toBe(true);
  });

  it("does not match a longer message that only contains the word", () => {
    expect(isCorrect("the lighthouse", "lighthouse")).toBe(false);
  });
});

describe("a close guess", () => {
  it("is one edit away from a word of five letters or more", () => {
    expect(editDistance("lighthose", "lighthouse")).toBe(1);
    expect(isClose("lighthose", "lighthouse")).toBe(true);
    expect(isClose("lightouse", "lighthouse")).toBe(true);
  });

  it("is never close for a short word, where one letter off is a different word", () => {
    expect(isClose("cat", "bat")).toBe(false);
    expect(isClose("lamp", "lame")).toBe(false);
  });

  it("is not close when it is exactly right, or two edits off", () => {
    expect(isClose("lighthouse", "lighthouse")).toBe(false);
    expect(isClose("lihthose", "lighthouse")).toBe(false);
  });
});

describe("containing the word", () => {
  it("sees through spaces, punctuation and case", () => {
    expect(containsWord("it's a light house!", "lighthouse")).toBe(true);
    expect(containsWord("L.I.G.H.T-H.O.U.S.E", "lighthouse")).toBe(true);
    expect(containsWord("a tower by the sea", "lighthouse")).toBe(false);
  });
});
