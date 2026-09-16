// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { card, hand, seat } from "./fixtures.js";
import { MOMENT_MS, Moments } from "./Moments.js";

const natural = hand({ bet: 500, cards: [card("A"), card("K", "hearts")], total: 21, soft: true, done: true });
const busted = hand({ bet: 500, cards: [card("K"), card("9"), card("5")], total: 24, bust: true, done: true });
const live = hand({ bet: 500, cards: [card("K"), card("9")], total: 19 });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a blackjack", () => {
  it("gets a banner once, when it is dealt, and not again for the same hand", () => {
    const { container, rerender } = render(<Moments me={seat("a", "Ada")} />);
    expect(container.querySelector(".bj__banner")).toBeNull();

    rerender(<Moments me={seat("a", "Ada", { hands: [natural] })} />);
    expect(container.querySelector(".bj__banner")?.textContent).toBe("Blackjack");

    act(() => vi.advanceTimersByTime(MOMENT_MS));
    expect(container.querySelector(".bj__banner")).toBeNull();

    // The next broadcast about the same hand is not a second blackjack.
    rerender(<Moments me={seat("a", "Ada", { hands: [{ ...natural }] })} />);
    expect(container.querySelector(".bj__banner")).toBeNull();
  });

  it("is not celebrated for somebody arriving at a hand already dealt", () => {
    const { container } = render(<Moments me={seat("a", "Ada", { hands: [natural] })} />);
    expect(container.querySelector(".bj__banner")).toBeNull();
  });
});

describe("a bust", () => {
  it("gets a stamp once per hand that busts", () => {
    const { container, rerender } = render(<Moments me={seat("a", "Ada", { hands: [live, live] })} />);

    rerender(<Moments me={seat("a", "Ada", { hands: [busted, live] })} />);
    expect(container.querySelector(".bj__stamp")?.textContent).toBe("Bust");
    act(() => vi.advanceTimersByTime(MOMENT_MS));
    expect(container.querySelector(".bj__stamp")).toBeNull();

    rerender(<Moments me={seat("a", "Ada", { hands: [busted, busted] })} />);
    expect(container.querySelector(".bj__stamp")).not.toBeNull();
  });

  it("goes as soon as the felt clears for the next hand", () => {
    const { container, rerender } = render(<Moments me={seat("a", "Ada", { hands: [live] })} />);
    rerender(<Moments me={seat("a", "Ada", { hands: [busted] })} />);
    rerender(<Moments me={seat("a", "Ada")} />);
    expect(container.querySelector(".bj__stamp")).toBeNull();
  });

  it("gives a second bust inside the same moment its own full-length stamp", () => {
    const { container, rerender } = render(<Moments me={seat("a", "Ada", { hands: [live, live] })} />);

    rerender(<Moments me={seat("a", "Ada", { hands: [busted, live] })} />);
    act(() => vi.advanceTimersByTime(1_000));

    // The first bust's own deadline (1600ms after it) has now passed, but the
    // second bust just landed and earns its own full moment from here.
    rerender(<Moments me={seat("a", "Ada", { hands: [busted, busted] })} />);
    act(() => vi.advanceTimersByTime(700));
    expect(container.querySelector(".bj__stamp")).not.toBeNull();

    act(() => vi.advanceTimersByTime(MOMENT_MS - 700));
    expect(container.querySelector(".bj__stamp")).toBeNull();
  });
});
