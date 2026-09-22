// @vitest-environment jsdom
import type { Card as CardData, Rank, Suit } from "@backroom/game-baccarat";
import { coupFrom, schedule } from "@backroom/game-baccarat";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Coup } from "./Coup.js";
import type { Shown } from "./reveal.js";
import { shownAt } from "./reveal.js";

const card = (rank: Rank, suit: Suit = "spades"): CardData => ({ rank, suit });

/** A coup where both sides draw a third card: six places, six moments. */
const BOTH = coupFrom((["2", "2", "3", "2", "6", "5"] as Rank[]).map((rank) => card(rank)));

const shown = (over: Partial<Shown> = {}): Shown => ({
  player: [],
  banker: [],
  playerTotal: null,
  bankerTotal: null,
  ...over,
});

describe("a coup on the felt", () => {
  /*
   * The deal itself, on the clock rather than by eye.
   *
   * A place `shownAt` has not dealt yet used to render as a full face-down
   * card, which is indistinguishable on screen from a card that is out — so
   * every place the coup would ever hold stood on the felt from the first
   * frame, the schedule's stagger was never seen, and the four shoe sounds
   * fired over cards that were already there. Worse, a hand that goes on to
   * draw a third card stood three backs deep before either pair had turned,
   * which announces a two-card total of five or less seconds before the table
   * says so.
   */
  it("brings each card out at its own moment, not the whole coup at once", () => {
    const outs = schedule(BOTH).cards.map((one) => one.outAt);
    expect(outs).toHaveLength(6);

    const { container, rerender } = render(
      <Coup shown={shownAt(BOTH, outs[0] ?? 0)} outcome={null} />,
    );
    expect(container.querySelectorAll(".card")).toHaveLength(1);

    for (const [index, at] of outs.slice(1).entries()) {
      // A frame short of its moment the card is not on the felt at all —
      // which, for the last two, is the coup not saying a third is coming.
      rerender(<Coup shown={shownAt(BOTH, at - 1)} outcome={null} />);
      expect(container.querySelectorAll(".card")).toHaveLength(index + 1);

      rerender(<Coup shown={shownAt(BOTH, at)} outcome={null} />);
      expect(container.querySelectorAll(".card")).toHaveLength(index + 2);
    }
  });

  it("shows a card that is out but not turned as a face-down back", () => {
    const { container } = render(
      <Coup shown={shown({ player: [{ card: card("7"), turned: false }] })} outcome={null} />,
    );
    expect(container.querySelector('[aria-label="face down"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="7 of spades"]')).toBeNull();
  });

  it("shows a turned card as its rank and suit", () => {
    const { container } = render(
      <Coup shown={shown({ player: [{ card: card("7"), turned: true }] })} outcome={null} />,
    );
    expect(container.querySelector('[aria-label="7 of spades"]')).not.toBeNull();
  });

  /*
   * "Never invent a fact" holds even once the cards are all showing: a total
   * is a fact about a hand the table has not turned over yet, whatever the
   * two cards on screen would add to by eye.
   */
  it("shows no total for a hand nobody has turned over", () => {
    const { container } = render(
      <Coup shown={shown({ player: [{ card: card("7"), turned: false }] })} outcome={null} />,
    );
    expect(container.querySelector(".bc__hand-total")).toBeNull();
  });

  it("shows a hand's total once it has actually turned", () => {
    const { container } = render(
      <Coup
        shown={shown({ player: [{ card: card("7"), turned: true }], playerTotal: 7 })}
        outcome={null}
      />,
    );
    expect(container.querySelector(".bc__hand-total")?.textContent).toBe("7");
  });

  it("marks the winning side only once the table has actually said so", () => {
    const both = shown({
      player: [{ card: card("7"), turned: true }],
      banker: [{ card: card("3"), turned: true }],
      playerTotal: 7,
      bankerTotal: 3,
    });
    const { container, rerender } = render(<Coup shown={both} outcome={null} />);
    expect(container.querySelector(".bc__hand--won")).toBeNull();

    rerender(<Coup shown={both} outcome="player" />);
    expect(container.querySelector(".bc__hand--player.bc__hand--won")).not.toBeNull();
    expect(container.querySelector(".bc__hand--banker.bc__hand--won")).toBeNull();
  });

  /*
   * useReveal calls shownAt fresh on every requestAnimationFrame, which
   * means the real caller never hands Coup the same object twice — every
   * prop is a brand-new Shown, with brand-new arrays and brand-new slot
   * objects, even when nothing about the deal has actually changed. An
   * effect that keys its fold timer on that object's identity restarts the
   * timer on every one of those frames and the timer never survives long
   * enough to fire, so nothing ever visibly turns over during a real deal.
   */
  it("turns a card over as the deal goes on, even though a fresh Shown arrives every frame", () => {
    vi.useFakeTimers();
    try {
      const facedown = (): Shown => shown({ player: [{ card: card("7"), turned: false }] });
      // Same values, but shownAt would never hand back this exact object —
      // a new one every call is the whole point of the reproduction.
      const faceup = (): Shown => shown({ player: [{ card: card("7"), turned: true }] });

      const { container, rerender } = render(<Coup shown={facedown()} outcome={null} />);
      expect(container.querySelector('[aria-label="7 of spades"]')).toBeNull();

      // The RAF loop's own cadence: a fresh, structurally identical Shown
      // roughly every 16ms, well inside the fold's own 120ms.
      for (let waited = 0; waited < 200; waited += 16) {
        rerender(<Coup shown={faceup()} outcome={null} />);
        act(() => {
          vi.advanceTimersByTime(16);
        });
      }

      expect(container.querySelector('[aria-label="7 of spades"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
