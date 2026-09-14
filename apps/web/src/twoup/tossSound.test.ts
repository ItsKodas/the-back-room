// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCalledSound, useTossSound } from "./useTossSound.js";

/**
 * The hook's own contract, not the synthesis behind it.
 *
 * `spinSound.test.ts` calls the real `spinWheel`/`play` because jsdom's
 * missing `AudioContext` already makes them safe no-ops — there is nothing to
 * assert about *scheduling* that way. What these hooks are responsible for is
 * whether the building's one sound module gets asked at the right moment and
 * not asked twice, and that only shows up by stubbing `tossCoins`/`play` and
 * counting: the same shape of mock `Tips.test.tsx` and `TauntStage.test.tsx`
 * use for the same reason.
 */
const calls = vi.hoisted(() => ({
  tossCoins: [] as unknown[],
  stopped: 0,
  played: [] as string[],
}));
vi.mock("../game/audio.js", () => ({
  tossCoins: (options: unknown) => {
    calls.tossCoins.push(options);
    return () => {
      calls.stopped += 1;
    };
  },
  play: (cue: string) => {
    calls.played.push(cue);
  },
}));

const shape = { landings: [0.84, 1], rattle: [0.1, 0.35, 0.6, 0.8, 0.92] };

beforeEach(() => {
  calls.tossCoins.length = 0;
  calls.stopped = 0;
  calls.played.length = 0;
});

describe("useTossSound", () => {
  it("schedules once per throw, not once per render", () => {
    const { rerender } = renderHook(({ flying }: { flying: boolean }) => useTossSound(flying, 1_500, shape), {
      initialProps: { flying: true },
    });
    expect(calls.tossCoins).toHaveLength(1);

    // A fresh `shape` object is exactly what a felt re-render mid-flight hands
    // in — a chip going down must not cut the coins off and start them again.
    rerender({ flying: true });
    rerender({ flying: true });
    expect(calls.tossCoins).toHaveLength(1);
  });

  it("stops everything it started once the throw ends", () => {
    const { rerender } = renderHook(({ flying }: { flying: boolean }) => useTossSound(flying, 1_500, shape), {
      initialProps: { flying: true },
    });
    expect(calls.stopped).toBe(0);
    rerender({ flying: false });
    expect(calls.stopped).toBe(1);
  });

  it("stops on unmount too, the way a remount mid-flight would", () => {
    const { unmount } = renderHook(() => useTossSound(true, 1_500, shape));
    expect(calls.stopped).toBe(0);
    unmount();
    expect(calls.stopped).toBe(1);
  });
});

type Outcome = "heads" | "tails" | "odds";

describe("useCalledSound", () => {
  it("fires once per result, not once per render", () => {
    const { rerender } = renderHook(
      ({ outcome, flying }: { outcome: Outcome | null; flying: boolean }) => useCalledSound(outcome, flying),
      { initialProps: { outcome: null, flying: true } },
    );
    rerender({ outcome: "heads", flying: false });
    expect(calls.played).toEqual(["headsUp"]);

    // Re-rendering with the same settled result must not say it again.
    rerender({ outcome: "heads", flying: false });
    expect(calls.played).toEqual(["headsUp"]);
  });

  it("sounds again when the same result comes up twice running", () => {
    const { rerender } = renderHook(
      ({ outcome, flying }: { outcome: Outcome | null; flying: boolean }) => useCalledSound(outcome, flying),
      { initialProps: { outcome: null, flying: true } },
    );
    rerender({ outcome: "heads", flying: false });
    expect(calls.played).toEqual(["headsUp"]);

    // A new throw clears the memo, so back-to-back identical results both say
    // something — the bug this guards against is two heads running silent
    // the second time because nothing looked new.
    rerender({ outcome: null, flying: true });
    rerender({ outcome: "heads", flying: false });
    expect(calls.played).toEqual(["headsUp", "headsUp"]);
  });
});
