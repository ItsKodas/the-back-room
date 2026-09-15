import { describe, expect, it } from "vitest";
import { normalise } from "../guess.js";
import { PACK_IDS, PACKS } from "./index.js";
import { drawChoices, MAX_CUSTOM, parseCustomWords, poolFor, wordProblem } from "./rules.js";

describe("the built-in packs", () => {
  it("has all eight", () => {
    expect(PACK_IDS).toEqual(["everyday", "animals", "food", "films", "places", "sport", "music", "hard"]);
  });

  for (const id of ["everyday", "animals", "food", "films", "places", "sport", "music", "hard"] as const) {
    it(`${id}: every word is a word the table accepts, and none is there twice`, () => {
      const words = PACKS[id].words;
      expect(words.length).toBeGreaterThanOrEqual(40);
      for (const word of words) {
        expect(wordProblem(word), word).toBeNull();
      }
      expect(new Set(words.map(normalise)).size).toBe(words.length);
    });
  }
});

describe("what makes a word", () => {
  it("accepts letters, spaces, hyphens and apostrophes, 3 to 24 long, at most 3 words", () => {
    expect(wordProblem("fish and chips")).toBeNull();
    expect(wordProblem("Kev's van")).toBeNull();
    expect(wordProblem("ice-cream")).toBeNull();
  });

  it("refuses what cannot be drawn fairly or typed back", () => {
    expect(wordProblem("ox")).not.toBeNull();
    expect(wordProblem("a".repeat(25))).not.toBeNull();
    expect(wordProblem("corn on the cob")).not.toBeNull();
    expect(wordProblem("R2D2")).not.toBeNull();
    expect(wordProblem("déjà vu")).not.toBeNull();
  });
});

describe("the host's own words", () => {
  it("splits on commas, tidies spaces, and counts what it dropped", () => {
    expect(parseCustomWords(" Kev's van,  the   jukebox , x, pint of mild,THE JUKEBOX,")).toEqual({
      words: ["Kev's van", "the jukebox", "pint of mild"],
      skipped: 2,
    });
  });

  it("keeps at most two hundred", () => {
    const many = Array.from({ length: 205 }, (_, index) => `word ${"abcdefghijklmnopqrstuvwxyz"[index % 26]}${"abcdefghijklmnopqrstuvwxyz"[Math.floor(index / 26)]}`);
    const parsed = parseCustomWords(many.join(","));
    expect(parsed.words).toHaveLength(MAX_CUSTOM);
    expect(parsed.skipped).toBe(5);
  });
});

describe("the pool and the draw", () => {
  it("uses the packs plus custom words, or custom words alone", () => {
    expect(poolFor(["animals"], ["the jukebox"], false)).toContain("the jukebox");
    expect(poolFor(["animals"], ["the jukebox"], false)).toContain("elephant");
    expect(poolFor(["animals"], ["the jukebox"], true)).toEqual(["the jukebox"]);
  });

  it("does not list a word twice when a pack and the host both have it", () => {
    const pool = poolFor(["animals"], ["Elephant"], false);
    expect(pool.filter((word) => normalise(word) === "elephant")).toHaveLength(1);
  });

  it("draws three different words, skipping ones already played", () => {
    const pool = ["a1a", "b2b", "c3c", "d4d"].map((w) => w.replace(/\d/g, "x"));
    const played = new Set([normalise(pool[0] as string)]);
    const choices = drawChoices(pool, played, () => 0);
    expect(choices).toHaveLength(3);
    expect(new Set(choices).size).toBe(3);
    expect(choices).not.toContain(pool[0]);
  });

  it("lets words repeat rather than leave a turn with nothing to draw", () => {
    const pool = ["one", "two", "six"];
    const played = new Set(pool.map(normalise));
    expect(drawChoices(pool, played, () => 0.99)).toHaveLength(3);
  });
});
