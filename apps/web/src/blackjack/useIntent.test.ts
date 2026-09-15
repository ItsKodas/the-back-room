// @vitest-environment jsdom
import type { TableView } from "@backroom/game-blackjack";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useIntent } from "./useIntent.js";

/**
 * Showing a press before the table has answered.
 *
 * Worth testing at this level because the thing it protects against does not
 * reproduce on a machine talking to itself: on localhost the answer arrives
 * inside a frame, so a version of this that never worked at all would look
 * perfect right up until somebody played from another continent.
 */

/** A table with one seat, holding whatever this test needs it to hold. */
function table(seat: Partial<TableView["seats"][number]> = {}, rest: Partial<TableView> = {}) {
  return {
    code: "TEST1",
    status: "playing",
    phase: "playing",
    hostId: "a",
    watching: 0,
    lastEvent: null,
    turnSeatId: "a",
    minBet: 100,
    maxBet: 10_000,
    forFun: false,
    deadline: null,
    bettingMs: 30_000,
    dealer: { cards: [], total: 0, hidden: true },
    seats: [
      {
        id: "a",
        name: "Ada",
        connected: true,
        waiting: false,
        isBot: false,
        avatar: null,
        accentColor: null,
        active: 0,
        bet: 0,
        purse: 0,
        hands: [
          {
            bet: 0,
            cards: [],
            total: 0,
            soft: false,
            bust: false,
            done: false,
            outcome: null,
            returned: 0,
            fromSplit: false,
          },
        ],
        ...seat,
      },
    ],
    ...rest,
  } as unknown as TableView;
}

const two = [
  { rank: "5", suit: "spades" },
  { rank: "6", suit: "spades" },
] as TableView["seats"][number]["hands"][number]["cards"];

describe("a stake, before the table has agreed to it", () => {
  it("shows the number this player asked for", () => {
    const view = table({ bet: 0 });
    const { result } = renderHook(() => useIntent(view, "a", null));

    act(() => result.current.place(500));

    expect(result.current.bet).toBe(500);
  });

  it("stops showing it the moment the table holds the same number", () => {
    const { result, rerender } = renderHook(
      ({ view }: { view: TableView }) => useIntent(view, "a", null),
      { initialProps: { view: table({ bet: 0 }) } },
    );
    act(() => result.current.place(500));

    rerender({ view: table({ bet: 500 }) });

    // The table's own word from here, which is the one that can be trusted.
    expect(result.current.bet).toBeNull();
  });

  it("gives up on a stake the table refused", () => {
    /*
     * A refusal does not move the table's stake, so nothing would ever clear
     * this on its own — and a number that stays on the felt after being turned
     * down is worse than never having shown it.
     */
    const view = table({ bet: 0 });
    const { result, rerender } = renderHook(
      ({ error }: { error: string | null }) => useIntent(view, "a", error),
      { initialProps: { error: null as string | null } },
    );
    act(() => result.current.place(500));

    rerender({ error: "Last call — you can only take chips back now." });

    expect(result.current.bet).toBeNull();
  });

  it("clears when the hand is dealt, whatever was on the felt", () => {
    const { result, rerender } = renderHook(
      ({ view }: { view: TableView }) => useIntent(view, "a", null),
      { initialProps: { view: table({ bet: 0 }, { phase: "betting" }) } },
    );
    act(() => result.current.place(500));

    rerender({ view: table({ bet: 0 }, { phase: "playing" }) });

    expect(result.current.bet).toBeNull();
  });
});

describe("a move, before the table has answered", () => {
  it("remembers what was sent", () => {
    const { result } = renderHook(() => useIntent(table(), "a", null));

    act(() => result.current.send("hit"));

    expect(result.current.move).toBe("hit");
  });

  it("forgets it once a card has arrived", () => {
    const { result, rerender } = renderHook(
      ({ view }: { view: TableView }) => useIntent(view, "a", null),
      { initialProps: { view: table() } },
    );
    act(() => result.current.send("hit"));

    rerender({ view: table({ hands: [{ cards: two }] as never }) });

    expect(result.current.move).toBeNull();
  });

  it("forgets it once the turn has moved on", () => {
    // Standing changes nothing about the hand, so the turn leaving is the only
    // thing that says the table heard.
    const { result, rerender } = renderHook(
      ({ view }: { view: TableView }) => useIntent(view, "a", null),
      { initialProps: { view: table() } },
    );
    act(() => result.current.send("stand"));

    rerender({ view: table({}, { turnSeatId: "b" }) });

    expect(result.current.move).toBeNull();
  });

  it("forgets it once a pair has become two hands", () => {
    const { result, rerender } = renderHook(
      ({ view }: { view: TableView }) => useIntent(view, "a", null),
      { initialProps: { view: table() } },
    );
    act(() => result.current.send("split"));

    rerender({ view: table({ hands: [{ cards: [] }, { cards: [] }] as never }) });

    expect(result.current.move).toBeNull();
  });

  it("gives up on a move the table refused", () => {
    const { result, rerender } = renderHook(
      ({ error }: { error: string | null }) => useIntent(table(), "a", error),
      { initialProps: { error: null as string | null } },
    );
    act(() => result.current.send("double"));

    rerender({ error: "You cannot cover that bet." });

    expect(result.current.move).toBeNull();
  });

  it("gives up on a move refused in the same words as the last refusal", () => {
    /*
     * The table said no, then this player tried again and it said no in the
     * same words. The words did not change, so only the count can say so.
     */
    const no = "You cannot cover that bet.";
    const { result, rerender } = renderHook(
      ({ key }: { key: number }) => useIntent(table(), "a", no, key),
      { initialProps: { key: 1 } },
    );
    act(() => result.current.send("double"));

    rerender({ key: 2 });

    expect(result.current.move).toBeNull();
  });
});
