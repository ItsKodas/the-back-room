// @vitest-environment jsdom
import type { TableView } from "@backroom/game-liars-dice";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seat, view } from "./fixtures.js";
import { useIntent } from "./useIntent.js";

const table = (over: Partial<TableView> = {}): TableView =>
  view([seat(), seat({ id: "s1", name: "Bram" })], { toAct: "s0", total: 10, ...over });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a bid", () => {
  it("shows on the press, because the number is the player's own", () => {
    const { result } = renderHook(() => useIntent(table(), "s0", null));
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    expect(result.current.bid).toEqual({ count: 3, face: 5 });
    expect(result.current.busy).toBe(true);
  });

  it("gives way the moment the table says the same thing", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: TableView }) => useIntent(state, "s0", null),
      { initialProps: { state: table() } },
    );
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    rerender({ state: table({ bid: { count: 3, face: 5 }, bidder: "s0", toAct: "s1" }) });
    expect(result.current.bid).toBe(null);
    expect(result.current.busy).toBe(false);
  });

  it("is given up on when the table never answers", () => {
    const { result } = renderHook(() => useIntent(table(), "s0", null));
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    act(() => void vi.advanceTimersByTime(2_000));
    expect(result.current.bid).toBe(null);
    expect(result.current.busy).toBe(false);
  });

  it("is dropped on a refusal", () => {
    const { result, rerender } = renderHook(
      ({ error, key }: { error: string | null; key: number }) =>
        useIntent(table(), "s0", error, key),
      { initialProps: { error: null as string | null, key: 0 } },
    );
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    rerender({ error: "Not your turn.", key: 1 });
    expect(result.current.bid).toBe(null);
  });

  it("is dropped again on a refusal in the very same words", () => {
    const { result, rerender } = renderHook(
      ({ error, key }: { error: string | null; key: number }) =>
        useIntent(table(), "s0", error, key),
      { initialProps: { error: "Not your turn." as string | null, key: 1 } },
    );
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    // The same words, a second time. Only the counter moves.
    rerender({ error: "Not your turn.", key: 2 });
    expect(result.current.bid).toBe(null);
  });
});

describe("a second press", () => {
  it("outlives the first press's patience timer", () => {
    const { result } = renderHook(() => useIntent(table(), "s0", null));
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    act(() => void vi.advanceTimersByTime(1_500));
    act(() => result.current.sendBid({ count: 3, face: 6 }));
    // The first press's timer fires here. It must not clear the second.
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current.bid).toEqual({ count: 3, face: 6 });
    expect(result.current.busy).toBe(true);
  });

  it("is still given up on, in its own turn", () => {
    const { result } = renderHook(() => useIntent(table(), "s0", null));
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    act(() => void vi.advanceTimersByTime(1_500));
    act(() => result.current.sendBid({ count: 3, face: 6 }));
    act(() => void vi.advanceTimersByTime(1_600));
    expect(result.current.bid).toBe(null);
    expect(result.current.busy).toBe(false);
  });
});

describe("a call", () => {
  it("holds the button down without inventing a count", () => {
    const { result } = renderHook(() => useIntent(table({ bid: { count: 3, face: 5 } }), "s0", null));
    act(() => result.current.sendCall("liar"));
    expect(result.current.busy).toBe(true);
    // Nothing is guessed about the answer.
    expect(result.current.bid).toBe(null);
  });

  it("lets go when the reveal lands", () => {
    const standing = { bid: { count: 3, face: 5 }, bidder: "s1" };
    const { result, rerender } = renderHook(
      ({ state }: { state: TableView }) => useIntent(state, "s0", null),
      { initialProps: { state: table(standing) } },
    );
    act(() => result.current.sendCall("liar"));
    rerender({
      state: table({
        ...standing,
        toAct: null,
        resolution: {
          call: "liar",
          caller: "s0",
          bid: { count: 3, face: 5 },
          bidder: "s1",
          count: 4,
          right: true,
          losers: ["s0"],
        },
      }),
    });
    expect(result.current.busy).toBe(false);
  });
});

describe("readiness", () => {
  it("shows on the tap and gives way when the table agrees", () => {
    const waiting = table({ phase: "waiting", toAct: null });
    const { result, rerender } = renderHook(
      ({ state }: { state: TableView }) => useIntent(state, "s0", null),
      { initialProps: { state: waiting } },
    );
    act(() => result.current.setReady(true));
    expect(result.current.ready).toBe(true);
    rerender({
      state: view([seat({ ready: true }), seat({ id: "s1" })], { phase: "waiting", toAct: null }),
    });
    expect(result.current.ready).toBe(null);
  });
});

describe("a new round", () => {
  it("forgets whatever was outstanding", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: TableView }) => useIntent(state, "s0", null),
      { initialProps: { state: table() } },
    );
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    rerender({ state: table({ round: 2 }) });
    expect(result.current.bid).toBe(null);
    expect(result.current.busy).toBe(false);
  });
});
