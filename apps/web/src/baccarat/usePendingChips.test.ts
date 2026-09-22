// @vitest-environment jsdom
import type { Placed } from "@backroom/game-baccarat";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePendingChips } from "./usePendingChips.js";

/**
 * A chip on the cloth, before the table has said so.
 *
 * Worth testing at this level for the same reason blackjack's `useIntent`
 * is: the thing it protects against does not reproduce on a machine talking
 * to itself, because the answer arrives inside a frame there. This is what
 * task 17's real-browser check confirmed empirically — a chip did not appear
 * until the round trip actually finished, against the delay it stood in for.
 */

describe("a chip, before the table has agreed to it", () => {
  it("shows the amount this player asked for on the spot it went on", () => {
    const { result } = renderHook(() => usePendingChips([], "s1", null));

    act(() => result.current.add("player", 25));

    expect(result.current.pending["player"]).toBe(25);
  });

  it("stacks a second press on the same spot before the table answers either", () => {
    const { result } = renderHook(() => usePendingChips([], "s1", null));

    act(() => result.current.add("player", 25));
    act(() => result.current.add("player", 100));

    expect(result.current.pending["player"]).toBe(125);
  });

  it("retires the pending chip once the table's own figure on that spot catches up", () => {
    const { result, rerender } = renderHook(
      ({ placed }: { placed: readonly Placed[] }) => usePendingChips(placed, "s1", null),
      { initialProps: { placed: [] as readonly Placed[] } },
    );
    act(() => result.current.add("player", 25));
    expect(result.current.pending["player"]).toBe(25);

    // The table caught up: this seat's own confirmed total on "player" is now
    // the 25 that press was for.
    rerender({ placed: [{ seatId: "s1", spotId: "player", chips: 25 }] });

    expect(result.current.pending["player"]).toBeUndefined();
  });

  it("does not retire a pending chip on a spot somebody else's bet just landed on", () => {
    // A shared spot's total moving is not proof that THIS seat's own press
    // landed — only this seat's own confirmed figure is.
    const { result, rerender } = renderHook(
      ({ placed }: { placed: readonly Placed[] }) => usePendingChips(placed, "s1", null),
      { initialProps: { placed: [] as readonly Placed[] } },
    );
    act(() => result.current.add("player", 25));

    rerender({ placed: [{ seatId: "s2", spotId: "player", chips: 500 }] });

    expect(result.current.pending["player"]).toBe(25);
  });

  it("takes a pending chip back off when the table refuses", () => {
    const { result, rerender } = renderHook(
      ({ error }: { error: string | null }) => usePendingChips([], "s1", error),
      { initialProps: { error: null as string | null } },
    );
    act(() => result.current.add("player", 25));

    rerender({ error: "The bank cannot cover a bet there yet." });

    expect(result.current.pending["player"]).toBeUndefined();
  });

  it("gives up on an unanswered chip once it has waited long enough", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => usePendingChips([], "s1", null));
      act(() => result.current.add("player", 25));
      expect(result.current.pending["player"]).toBe(25);

      act(() => vi.advanceTimersByTime(2000));

      expect(result.current.pending["player"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
