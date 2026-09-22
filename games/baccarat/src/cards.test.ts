import { describe, expect, it } from "vitest";
import { DECKS, freshDeck, freshShoe, RANKS, SUITS, shuffle } from "./cards.js";

/** A counter that cycles, so a shuffle can be pinned down exactly. */
function sequence(values: readonly number[]): () => number {
  let at = 0;
  return () => values[at++ % values.length] as number;
}

describe("the cards", () => {
  it("has fifty-two of them, each once", () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(52);
    const seen = new Set(deck.map((card) => `${card.rank}${card.suit}`));
    expect(seen.size).toBe(52);
  });

  it("deals from eight decks", () => {
    const shoe = freshShoe(() => 0.5);
    expect(shoe).toHaveLength(DECKS * 52);
    // Every rank of every suit, eight times over.
    const aces = shoe.filter((card) => card.rank === "A" && card.suit === "spades");
    expect(aces).toHaveLength(DECKS);
  });

  it("keeps every card when it shuffles", () => {
    const deck = freshDeck();
    const shuffled = shuffle(deck, sequence([0.1, 0.9, 0.4, 0.7, 0.2]));
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map((c) => `${c.rank}${c.suit}`)).size).toBe(52);
    // And does not move the original, which is what lets a caller keep one.
    expect(deck).not.toBe(shuffled);
  });

  it("actually moves them", () => {
    const deck = freshDeck();
    const shuffled = shuffle(deck, sequence([0.13, 0.77, 0.29, 0.61, 0.05, 0.94]));
    expect(shuffled.map((c) => `${c.rank}${c.suit}`)).not.toEqual(
      deck.map((c) => `${c.rank}${c.suit}`),
    );
  });

  it("names thirteen ranks and four suits", () => {
    expect(RANKS).toHaveLength(13);
    expect(SUITS).toHaveLength(4);
  });
});
