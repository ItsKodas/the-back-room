// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGhostChips } from "./useGhostChips.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("chips that land before the server has heard of them", () => {
  it("shows the chip on the press", () => {
    // A stake is the player's own number, so there is nothing to invent. On
    // a bad connection this is the difference between a table and a button
    // that appears broken.
    const { result } = renderHook(() => useGhostChips([], "s1"));
    act(() => result.current.press("field", 30));
    expect(result.current.cloth).toEqual([
      { seatId: "s1", spotId: "field", chips: 30, off: false },
    ]);
  });

  it("gives the chip up when the table refuses it", () => {
    const { result } = renderHook(() => useGhostChips([], "s1"));
    act(() => result.current.press("field", 30));
    act(() => result.current.refused("field"));
    expect(result.current.cloth).toEqual([]);
  });

  it("gives the chip up when the answer never comes", () => {
    // Tested on a clock rather than by eye. On a machine talking to itself
    // the reply lands inside a frame, so a version that never worked at all
    // looks perfect right up until somebody plays from another continent.
    const { result } = renderHook(() => useGhostChips([], "s1"));
    act(() => result.current.press("field", 30));
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.cloth).toEqual([]);
  });

  it("replaces the guess the moment the table speaks, without double-counting", () => {
    const { result, rerender } = renderHook(
      ({ placed }) => useGhostChips(placed, "s1"),
      { initialProps: { placed: [] as never[] } },
    );
    act(() => result.current.press("field", 30));
    rerender({
      placed: [{ seatId: "s1", spotId: "field", chips: 30, off: false }] as never,
    });
    expect(result.current.cloth).toHaveLength(1);
    expect(result.current.cloth[0]?.chips).toBe(30);
  });

  it("adds to a pile the table already knows about", () => {
    const { result } = renderHook(() =>
      useGhostChips([{ seatId: "s1", spotId: "field", chips: 30, off: false }], "s1"),
    );
    act(() => result.current.press("field", 60));
    expect(result.current.cloth[0]?.chips).toBe(90);
  });

  it("gives up one guess per acknowledgement, not the whole burst", () => {
    /*
     * Three presses in a second all read "the table has said nothing" at the
     * moment they are made. Remembering only what the table already showed
     * would give all three the same figure to wait for, so the first
     * acknowledgement retires all three at once and the felt drops from
     * ninety to thirty before climbing back — chips a player watched
     * themselves put down, vanishing.
     *
     * So each guess remembers the ones pressed onto that spot before it.
     */
    const { result, rerender } = renderHook(({ placed }) => useGhostChips(placed, "s1"), {
      initialProps: { placed: [] as never[] },
    });
    act(() => {
      result.current.press("field", 30);
      result.current.press("field", 30);
      result.current.press("field", 30);
    });
    expect(result.current.cloth[0]?.chips).toBe(90);

    rerender({
      placed: [{ seatId: "s1", spotId: "field", chips: 30, off: false }] as never,
    });
    expect(result.current.cloth).toHaveLength(1);
    expect(result.current.cloth[0]?.chips).toBe(90);
  });

  it("never invents somebody else's chips", () => {
    const { result } = renderHook(() =>
      useGhostChips([{ seatId: "s2", spotId: "field", chips: 30, off: false }], "s1"),
    );
    act(() => result.current.press("field", 30));
    const mine = result.current.cloth.filter((one) => one.seatId === "s1");
    expect(mine).toHaveLength(1);
    expect(result.current.cloth).toHaveLength(2);
  });
});
