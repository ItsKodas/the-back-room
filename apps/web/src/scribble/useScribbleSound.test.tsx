// @vitest-environment jsdom
import type { ChatMessage, TableRelay } from "@backroom/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { viewOf } from "./testView.js";

const played = vi.fn();
vi.mock("../game/audio.js", () => ({ play: (cue: string) => played(cue) }));

import { useScribbleSound } from "./useScribbleSound.js";

const got = (seatId: string): ChatMessage => ({ seatId, name: seatId, text: "got it", at: Math.random(), kind: "got" });

beforeEach(() => played.mockClear());
afterEach(() => vi.useRealTimers());

describe("scribble's sound", () => {
  const quiet = () => () => {};

  it("chimes for your own correct guess, and more softly for anybody else's, and only once each", () => {
    const mine = got("s1");
    const theirs = got("s2");
    const { rerender } = renderHook((log: ChatMessage[]) => useScribbleSound({ state: viewOf(), seatId: "s1", log, onRelay: quiet }), {
      initialProps: [] as ChatMessage[],
    });
    rerender([mine]);
    expect(played.mock.calls.map(([cue]) => cue)).toEqual(["scribbleGot"]);
    // `mine` reappearing alongside a new message must not chime a second time.
    rerender([mine, theirs]);
    expect(played.mock.calls.map(([cue]) => cue)).toEqual(["scribbleGot", "scribbleGotOther"]);
  });

  /*
   * `useTableSocket` caps `chat` at 60 lines, so once a table has talked that
   * much the array's length stops changing on every new message — a cursor
   * kept as a plain count (`log.slice(heard.current)`) would then compare
   * against a position the array can no longer reach. Reproduced here at a
   * length of two rather than sixty: the defect is the cursor being a
   * position at all, not the number 60 — `GuessLog` hit the identical bug on
   * the same log and pinned it the same way in af23bbd.
   */
  it("keeps chiming once the chat log holds steady at its length", () => {
    const a = got("s2");
    const b = got("s1");
    const c = got("s2");
    const { rerender } = renderHook((log: ChatMessage[]) => useScribbleSound({ state: viewOf(), seatId: "s1", log, onRelay: quiet }), {
      initialProps: [] as ChatMessage[],
    });
    rerender([a, b]);
    played.mockClear();
    // Same length as before (2): `a` fell off the front, `b` is already
    // sounded, and `c` is the one genuinely new message.
    rerender([b, c]);
    expect(played.mock.calls.map(([cue]) => cue)).toEqual(["scribbleGotOther"]);
  });

  it("plays the reveal once, as the turn ends", () => {
    const { rerender } = renderHook((state = viewOf()) => useScribbleSound({ state, seatId: "s1", log: [], onRelay: quiet }));
    const reveal = viewOf({ phase: "reveal" });
    rerender(reveal);
    rerender({ ...reveal });
    expect(played.mock.calls.filter(([cue]) => cue === "scribbleReveal")).toHaveLength(1);
  });

  it("ticks through the last ten seconds of drawing, and not before, once per second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000_000);
    renderHook(() => useScribbleSound({ state: viewOf({ now: 2_000_000_000, deadline: 2_000_015_000 }), seatId: "s1", log: [], onRelay: quiet }));
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(played).not.toHaveBeenCalledWith("scribbleTick");
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    // Seven seconds in, three second-boundaries have been crossed (10, 9, 8)
    // — one tick each, not a poll's worth every 200ms.
    expect(played.mock.calls.filter(([cue]) => cue === "scribbleTick")).toHaveLength(3);
  });

  /*
   * `offset` used to be read straight off `state.now - Date.now()` in the
   * hook body rather than memoized, so it came out different on every render
   * — including a render with nothing to do with the clock — because
   * `Date.now()` moves on even when `state.now` does not. That made it a
   * dependency that changes on almost every render, tearing the tick's
   * interval down and rebuilding it each time; on a table re-rendering faster
   * than the 200ms poll, the interval could be rebuilt before it ever got a
   * chance to fire, silencing the tick for as long as the re-renders kept
   * coming — which is exactly the busiest stretch of a turn.
   */
  it("still ticks while the felt re-renders for reasons that have nothing to do with the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000_000);
    // A single, unchanging view: every rerender below is "unrelated" in the
    // sense that matters — nothing about the clock or the turn moves.
    const view = viewOf({ now: 2_000_000_000, deadline: 2_000_011_000 });
    const { rerender } = renderHook(() => useScribbleSound({ state: view, seatId: "s1", log: [], onRelay: quiet }));
    act(() => {
      vi.advanceTimersByTime(800);
    });
    // Ten renders, 50ms apart — well inside the interval's own 200ms poll, so
    // an interval rebuilt on every one of them never survives to fire. Each
    // step gets its own `act` so the effect it triggers actually commits
    // before the next one, rather than all ten being batched into one flush
    // at the end (which would leave the original interval running throughout
    // and hide the very restart this test exists to catch).
    for (let i = 0; i < 10; i += 1) {
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        rerender();
      });
    }
    expect(played.mock.calls.filter(([cue]) => cue === "scribbleTick")).toHaveLength(1);
  });

  /*
   * A correct guess inside the final ten seconds makes the table rebroadcast,
   * which moves `state.now` on and — correctly — restarts the tick interval
   * so it polls against a fresh offset. `last`, if it lived inside that
   * interval's own closure, would be reborn at -1 on that restart and let the
   * very next poll re-announce whichever second it was already sitting on.
   */
  it("does not repeat a tick when a resync nudges the clock without moving the deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000_000);
    const { rerender } = renderHook(
      (now: number) => useScribbleSound({ state: viewOf({ now, deadline: 2_000_015_000 }), seatId: "s1", log: [], onRelay: quiet }),
      { initialProps: 2_000_000_000 },
    );
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(played.mock.calls.filter(([cue]) => cue === "scribbleTick")).toHaveLength(1);
    // A fresh broadcast corrects the clock without starting a new turn: the
    // deadline is unchanged, only the server's own `now` moved — enough to
    // change `offset` and restart the interval, but not enough to move the
    // second the player is already hearing counted down.
    act(() => {
      rerender(2_000_005_500);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(played.mock.calls.filter(([cue]) => cue === "scribbleTick")).toHaveLength(1);
  });

  it("scratches once per partner's line, not once per batch, and swipes on a clear", () => {
    let hear: (relay: TableRelay) => void = () => {};
    renderHook(() =>
      useScribbleSound({
        state: viewOf(),
        seatId: "s1",
        log: [],
        onRelay: (listener) => {
          hear = listener;
          return () => {};
        },
      }),
    );
    const batch = (seq: number) => ({ seatId: "s0", payload: { kind: "stroke", id: "k", by: "s0", ink: "red", size: 1, seq, pts: [1, 1] } });
    hear(batch(0));
    hear(batch(1));
    hear(batch(2));
    hear({ seatId: "s0", payload: { kind: "clear" } });
    expect(played.mock.calls.map(([cue]) => cue)).toEqual(["scribbleScratch", "scribbleSwipe"]);
  });
});
