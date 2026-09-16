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

  it("chimes for your own correct guess, and more softly for anybody else's", () => {
    const { rerender } = renderHook((log: ChatMessage[]) => useScribbleSound({ state: viewOf(), seatId: "s1", log, onRelay: quiet }), {
      initialProps: [] as ChatMessage[],
    });
    rerender([got("s1")]);
    expect(played).toHaveBeenLastCalledWith("scribbleGot");
    rerender([got("s1"), got("s2")]);
    expect(played).toHaveBeenLastCalledWith("scribbleGotOther");
  });

  it("plays the reveal once, as the turn ends", () => {
    const { rerender } = renderHook((state = viewOf()) => useScribbleSound({ state, seatId: "s1", log: [], onRelay: quiet }));
    const reveal = viewOf({ phase: "reveal" });
    rerender(reveal);
    rerender({ ...reveal });
    expect(played.mock.calls.filter(([cue]) => cue === "scribbleReveal")).toHaveLength(1);
  });

  it("ticks through the last ten seconds of drawing, and not before", () => {
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
    expect(played.mock.calls.filter(([cue]) => cue === "scribbleTick").length).toBeGreaterThanOrEqual(1);
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
