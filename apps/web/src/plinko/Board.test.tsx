// @vitest-environment jsdom
import { MULTS, ROWS, multText } from "@backroom/game-plinko";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Ball, Board } from "./Board.js";
import { CHUTE_MS, FALL_MS, SETTLE_MS } from "./flight.js";

afterEach(cleanup);

/** A ball dropped at t0 and answered at once, landing in the leftmost bucket. */
function ball(id: string): Ball {
  return {
    id,
    mine: true,
    colour: 0,
    name: null,
    risk: "low",
    path: new Array(ROWS).fill(false),
    bucket: 0,
    mult: 80,
    stake: 10,
    won: 0,
    fun: false,
    droppedAt: 0,
    answeredAt: 0,
    refusedAt: null,
  };
}

const LANDS_AT = CHUTE_MS + FALL_MS;
const GONE_AT = LANDS_AT + SETTLE_MS;

/**
 * A regression for the bug where `tick()` checked `where().phase === "gone"`
 * before running `touches()`, so a ball whose landing and settle both fell
 * inside one frame gap — a backgrounded tab, a stalled main thread — was
 * dropped from the map without ever calling `onLand`. The page holds a ball's
 * win out of the balance until `onLand` fires, so a skipped landing there is a
 * win the player is never shown, not just a missed animation.
 */
describe("a ball landing", () => {
  it("calls onLand exactly once across several frames that step through the landing", () => {
    let raf: ((now: number) => void) | null = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: (now: number) => void) => {
        raf = cb;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(performance, "now").mockReturnValue(0);

    const balls = { current: new Map<string, Ball>([["b1", ball("b1")]]) };
    const onLand = vi.fn();
    render(<Board risk="low" balls={balls} onLand={onLand} />);

    for (const now of [100, 500, 1000, LANDS_AT + 20]) {
      act(() => raf?.(now));
    }
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(balls.current.has("b1")).toBe(true);

    act(() => raf?.(GONE_AT + 100));
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(balls.current.has("b1")).toBe(false);

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("still calls onLand exactly once when the landing and the settle fall in the same frame gap", () => {
    let raf: ((now: number) => void) | null = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: (now: number) => void) => {
        raf = cb;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(performance, "now").mockReturnValue(0);

    const balls = { current: new Map<string, Ball>([["b2", ball("b2")]]) };
    const onLand = vi.fn();
    render(<Board risk="low" balls={balls} onLand={onLand} />);

    // One frame that jumps straight past both the landing and the settle —
    // exactly the gap a paused tab or a stalled main thread produces.
    act(() => raf?.(GONE_AT + 500));

    expect(onLand).toHaveBeenCalledTimes(1);
    expect(balls.current.has("b2")).toBe(false);

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

/**
 * Bucket labels are the viewer's own risk (design spec, "The shared board"):
 * a High player landing in the same bucket as a Low one is paid something
 * else, and the board has to say so under whichever risk *this* seat picked.
 */
describe("bucket labels", () => {
  it("read the multiplier for the viewer's own risk, and follow it when it changes", () => {
    const balls = { current: new Map<string, Ball>() };
    const { rerender } = render(<Board risk="low" balls={balls} onLand={() => {}} />);
    for (const mult of MULTS.low) {
      expect(screen.getAllByText(multText(mult)).length).toBeGreaterThan(0);
    }

    rerender(<Board risk="high" balls={balls} onLand={() => {}} />);
    for (const mult of MULTS.high) {
      expect(screen.getAllByText(multText(mult)).length).toBeGreaterThan(0);
    }
  });
});
