import { coupFrom, schedule } from "@backroom/game-baccarat";
import type { Rank } from "@backroom/game-baccarat";
import { describe, expect, it } from "vitest";
import { shownAt } from "./reveal.js";

const shoe = (...ranks: Rank[]) => ranks.map((rank) => ({ rank, suit: "spades" as const }));
const BOTH = coupFrom(shoe("2", "2", "3", "2", "6", "5"));
const NATURAL = coupFrom(shoe("4", "3", "5", "2"));

describe("what is on the felt at a given moment", () => {
  it("shows nothing before the first card is out", () => {
    const shown = shownAt(BOTH, -1);
    expect(shown.player.every((slot) => slot === null)).toBe(true);
    expect(shown.banker.every((slot) => slot === null)).toBe(true);
  });

  it("shows a card face down once it is out and before it turns", () => {
    const first = schedule(BOTH).cards[0];
    const shown = shownAt(BOTH, (first?.outAt ?? 0) + 1);
    expect(shown.player[0]).not.toBeNull();
    expect(shown.player[0]?.turned).toBe(false);
  });

  /*
   * The whole of "never invent a fact". A card the table has not turned over
   * is not this browser's to show, even though the payload is holding it.
   */
  it("does not show a total for a hand nobody has turned over", () => {
    const shown = shownAt(BOTH, 100);
    expect(shown.playerTotal).toBeNull();
    expect(shown.bankerTotal).toBeNull();
  });

  it("turns a pair together and totals it then", () => {
    const made = schedule(NATURAL);
    const turn = made.cards.find((one) => one.side === "player")?.turnAt ?? 0;
    const shown = shownAt(NATURAL, turn + 1);
    expect(shown.player.every((slot) => slot?.turned === true)).toBe(true);
    expect(shown.playerTotal).toBe(NATURAL.playerTotal);
    // The banker's pair turns later, so it is still face down and untotalled.
    expect(shown.bankerTotal).toBeNull();
  });

  it("shows the whole coup once the schedule is done", () => {
    const shown = shownAt(BOTH, schedule(BOTH).total);
    expect(shown.player.filter((slot) => slot !== null)).toHaveLength(3);
    expect(shown.banker.filter((slot) => slot !== null)).toHaveLength(3);
    expect(shown.playerTotal).toBe(BOTH.playerTotal);
    expect(shown.bankerTotal).toBe(BOTH.bankerTotal);
  });

  it("lands somebody arriving late on the right card", () => {
    // Which is the whole reason the schedule is shared rather than copied.
    const late = shownAt(BOTH, schedule(BOTH).total - 1);
    expect(late.player.filter((slot) => slot !== null)).toHaveLength(3);
  });
});
