// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hand } from "./Cards.js";
import type { Card as CardData } from "./deck.js";

/**
 * A card asked for, and the card that comes back.
 *
 * This is the part that only goes wrong with a connection worth the name. On a
 * machine talking to itself the reply lands inside a frame and none of it is
 * visible; over a real one, getting it wrong shows a back appear from nowhere
 * and then a different card fly in behind it, which is what this arrangement
 * exists to stop. So it is tested on the clock rather than by eye.
 */

const five: CardData = { rank: "5", suit: "spades" };
const six: CardData = { rank: "6", suit: "hearts" };
const king: CardData = { rank: "K", suit: "clubs" };

/** Every card on screen, and how each one arrived. */
function shown(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".card")].map((card) => {
    const how = ["deal", "turn", "fold", "unfold"].find((name) =>
      card.classList.contains(`card--${name}`),
    );
    const face = card.classList.contains("card--down") ? "back" : "face";
    return `${face}:${how ?? "none"}`;
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a card on its way", () => {
  it("puts a back on the felt, dealt out of the shoe like any other card", () => {
    const { container } = render(<Hand cards={[five, six]} arriving />);

    // Three places: two cards, and one holding a card that has been asked for.
    expect(shown(container)).toEqual(["face:deal", "face:deal", "back:deal"]);
  });

  it("turns that same back over rather than dealing a second card", () => {
    /*
     * The whole point. One arrival, not two — the back that landed is the card
     * that opens, so nothing appears from nowhere and nothing flies in twice.
     */
    const { container, rerender } = render(<Hand cards={[five, six]} arriving />);
    expect(shown(container)).toEqual(["face:deal", "face:deal", "back:deal"]);

    rerender(<Hand cards={[five, six, king]} />);
    // Still the back: it has not finished landing yet.
    expect(shown(container)).toEqual(["face:deal", "face:deal", "back:deal"]);

    // It lands, and folds away.
    act(() => vi.advanceTimersByTime(400));
    expect(shown(container)).toEqual(["face:deal", "face:deal", "back:fold"]);

    // And opens out in its place — unfolding, never dealt a second time.
    act(() => vi.advanceTimersByTime(140));
    expect(shown(container)).toEqual(["face:deal", "face:deal", "face:unfold"]);
  });

  it("waits for the back to land before turning it, however fast the reply", () => {
    // A card that answers instantly must not fold a back that is still in the
    // air: two motions fighting over one card is the thing being avoided.
    const { container, rerender } = render(<Hand cards={[five]} arriving />);
    rerender(<Hand cards={[five, king]} />);

    act(() => vi.advanceTimersByTime(100));
    expect(shown(container)).toEqual(["face:deal", "back:deal"]);
  });

  it("deals a card that was never asked for, without any of this", () => {
    // Everybody else's cards, and your own once the table has them: they come
    // out of the shoe and that is all.
    const { container, rerender } = render(<Hand cards={[five]} />);
    rerender(<Hand cards={[five, six]} />);

    expect(shown(container)).toEqual(["face:deal", "face:deal"]);
  });

  it("turns the dealer's hole card over instead of dealing it in", () => {
    const { container } = render(<Hand cards={[five, king]} turnedFrom={1} />);

    expect(shown(container)).toEqual(["face:deal", "face:turn"]);
  });

  it("counts a card on its way when deciding a hand has outgrown its row", () => {
    const { container } = render(<Hand cards={[five, six, king]} arriving />);

    expect(container.querySelector(".bj-hand--tight")).not.toBeNull();
  });
});

describe("a hand's length", () => {
  it("tells the felt how many places it holds, a card on its way and a hole card included", () => {
    const hand = (node: HTMLElement) => node.querySelector<HTMLElement>(".bj-hand");
    // The felt overlaps a hand by as much as its places need to fit the row.
    expect(hand(render(<Hand cards={[five, six]} arriving />).container)?.style.getPropertyValue("--bj-places")).toBe("3");
    expect(hand(render(<Hand cards={[king]} hidden />).container)?.style.getPropertyValue("--bj-places")).toBe("2");
  });
});
