// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_DELAY_MS, HOLD_EVERY_MS, useHold } from "./useHold.js";

/**
 * Holding the key down, tested on a clock.
 *
 * Every question here is about timing, and the one thing that must not happen
 * — a plain tap costing two stakes — is invisible by eye at any speed a hand
 * can press.
 */

describe("useHold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once on the press, before any clock has run", () => {
    const fire = vi.fn();
    const { result } = renderHook(() => useHold(fire));

    act(() => result.current.start());

    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("costs a tap exactly one, however slow the tap", () => {
    const fire = vi.fn();
    const { result } = renderHook(() => useHold(fire));

    act(() => {
      result.current.start();
      vi.advanceTimersByTime(HOLD_DELAY_MS - 1);
      result.current.stop();
      vi.advanceTimersByTime(10_000);
    });

    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("repeats once the grace is up, and not before", () => {
    const fire = vi.fn();
    const { result } = renderHook(() => useHold(fire));

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS - 1));
    expect(fire).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1 + HOLD_EVERY_MS * 4));
    expect(fire).toHaveBeenCalledTimes(5);
  });

  it("lets go when the finger does", () => {
    const fire = vi.fn();
    const { result } = renderHook(() => useHold(fire));

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_EVERY_MS * 2));
    const held = fire.mock.calls.length;

    act(() => result.current.stop());
    act(() => vi.advanceTimersByTime(10_000));

    expect(fire).toHaveBeenCalledTimes(held);
  });

  it("stops on a pointerup the key never saw", () => {
    // The key goes `disabled` the moment the board is full, and a disabled
    // button reports no pointer events of its own — including the release.
    const fire = vi.fn();
    const { result } = renderHook(() => useHold(fire));

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_EVERY_MS));
    const held = fire.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });
    act(() => vi.advanceTimersByTime(10_000));

    expect(fire).toHaveBeenCalledTimes(held);
  });

  it("stops when the window is left behind", () => {
    const fire = vi.fn();
    const { result } = renderHook(() => useHold(fire));

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_EVERY_MS));
    const held = fire.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    act(() => vi.advanceTimersByTime(10_000));

    expect(fire).toHaveBeenCalledTimes(held);
  });

  it("stops when the page goes away under it", () => {
    const fire = vi.fn();
    const { result, unmount } = renderHook(() => useHold(fire));

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_EVERY_MS));
    const held = fire.mock.calls.length;

    unmount();
    act(() => vi.advanceTimersByTime(10_000));

    expect(fire).toHaveBeenCalledTimes(held);
  });

  it("fires whatever the page is holding now, not what it held at the press", () => {
    // `drop` is rebuilt on every render of the page — a stake nudged mid-hold
    // would otherwise keep dropping the old one.
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ fire }) => useHold(fire), {
      initialProps: { fire: first },
    });

    act(() => result.current.start());
    rerender({ fire: second });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_EVERY_MS * 2));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("does not stack a second run on a repeated press", () => {
    const fire = vi.fn();
    const { result } = renderHook(() => useHold(fire));

    act(() => {
      result.current.start();
      result.current.start();
    });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_EVERY_MS * 3));

    expect(fire).toHaveBeenCalledTimes(4);
  });
});
