// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSecondsLeft } from "./useSecondsLeft.js";

/*
 * Fixed system time so `Date.now()` and the injected `serverNow` agree
 * (offset 0) unless a test deliberately pulls them apart — the whole point
 * of this hook is to answer from the server's clock, not the browser's.
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(2_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the seconds-left clock", () => {
  it("reads zero rather than negative once the deadline is already past", () => {
    const { result } = renderHook(() => useSecondsLeft(2_000_000_000 - 5_000, 2_000_000_000));
    expect(result.current).toBe(0);
  });

  it("never shows zero while any part of the last second remains", () => {
    const { result } = renderHook(() => useSecondsLeft(2_000_000_100, 2_000_000_000));
    expect(result.current).toBe(1);
  });

  it("restarts at once when the deadline changes mid-countdown", () => {
    const { result, rerender } = renderHook(({ deadline, now }) => useSecondsLeft(deadline, now), {
      initialProps: { deadline: 2_000_010_000, now: 2_000_000_000 },
    });
    expect(result.current).toBe(10);
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(result.current).toBe(6);
    // A fresh turn's deadline can land mid-tick; the old countdown must not linger even a moment.
    rerender({ deadline: 2_000_024_000, now: 2_000_004_000 });
    expect(result.current).toBe(20);
  });

  it("keeps counting straight if the server's own clock steps backwards", () => {
    const { result, rerender } = renderHook(({ deadline, now }) => useSecondsLeft(deadline, now), {
      initialProps: { deadline: 2_000_010_000, now: 2_000_000_000 },
    });
    expect(result.current).toBe(10);
    // The server reports 5s earlier than before — meaning less time has passed
    // there than we'd assumed, so more of the deadline is still ahead of it.
    rerender({ deadline: 2_000_010_000, now: 1_999_995_000 });
    expect(result.current).toBe(15);
  });

  it("clears its interval when the caller unmounts", () => {
    const { unmount } = renderHook(() => useSecondsLeft(2_000_010_000, 2_000_000_000));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts no interval at all once there is no deadline to count down to", () => {
    const { unmount } = renderHook(() => useSecondsLeft(null, 2_000_000_000));
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it("re-renders only when the visible second actually changes, not on every quarter-second tick", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useSecondsLeft(2_000_010_000, 2_000_000_000);
    });
    const before = renders;
    /*
     * One `act` per tick, not one `act` spanning all sixteen: batched inside
     * a single `act`, React collapses every queued update — real browser or
     * not — into one commit regardless of how this hook is written, which
     * would make the two implementations indistinguishable here. A real
     * clock ticks as sixteen separate events, so this does too.
     */
    for (let tick = 0; tick < 16; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(250);
      });
    }
    // Four seconds pass, so the visible number changes four times. A naive
    // per-tick update renders on all sixteen; this stays well under that.
    expect(renders - before).toBeLessThanOrEqual(10);
  });
});
