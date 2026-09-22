// @vitest-environment jsdom
import type { Card as CardData, Rank, Suit } from "@backroom/game-baccarat";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Coup } from "./Coup.js";
import type { Shown } from "./reveal.js";

const card = (rank: Rank, suit: Suit = "spades"): CardData => ({ rank, suit });

const shown = (over: Partial<Shown> = {}): Shown => ({
  player: [],
  banker: [],
  playerTotal: null,
  bankerTotal: null,
  ...over,
});

describe("a coup on the felt", () => {
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
});
