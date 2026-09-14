// @vitest-environment jsdom
import type { TableView } from "@backroom/game-death-roll";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PATIENCE_MS, useIntent } from "./useIntent.js";

/**
 * The bargain in CLAUDE.md, tested on a clock rather than by eye.
 *
 * A number the player chose can be shown at once; a fact only the server knows
 * cannot be. On a machine talking to itself the reply lands inside a frame, so
 * a version of this that never worked would look perfect right up until
 * somebody played from another continent. Every test here holds the reply.
 */

/** A duel with two seats, holding whatever this test needs it to hold. */
function dueling(overrides: Partial<TableView> = {}): TableView {
  const seat = (id: string, name: string) => ({
    id,
    name,
    connected: true,
    waiting: false,
    isBot: false,
    avatar: null,
    accentColor: null,
    passed: false,
    purse: null,
  });
  return {
    code: "ABCDE",
    phase: "dueling",
    seats: [seat("ada", "Ada"), seat("bram", "Bram")],
    watching: 0,
    forFun: false,
    maxSeats: 2,
    ante: 500,
    opening: 1_000,
    passPrice: 50,
    ceiling: 1_000,
    pot: 1_000,
    toRoll: "ada",
    turnEndsAt: null,
    lastRoll: null,
    lastPass: null,
    history: [],
    loserId: null,
    winnerIds: [],
    waitingFor: null,
    shortId: null,
    lastEvent: null,
    you: seat("ada", "Ada"),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pressing roll", () => {
  it("starts the number tumbling before the server has answered", () => {
    const act_ = vi.fn();
    const { result } = renderHook(() => useIntent(dueling(), "ada", act_, null));

    act(() => result.current.roll());

    // Tumbling is not a guessed result — the digits are visibly unresolved.
    // What must never happen is a number appearing and then changing.
    expect(result.current.rolling).toBe(true);
    expect(act_).toHaveBeenCalledWith({ type: "roll" });
  });

  it("settles when the table speaks, and not before", () => {
    const act_ = vi.fn();
    const { result, rerender } = renderHook(
      ({ state }: { state: TableView }) => useIntent(state, "ada", act_, null),
      { initialProps: { state: dueling() } },
    );

    act(() => result.current.roll());
    expect(result.current.rolling).toBe(true);

    rerender({ state: dueling({ ceiling: 743 }) });

    expect(result.current.rolling).toBe(false);
  });

  it("gives up on it the instant the table refuses, not on a timer", () => {
    /*
     * A refusal never sends a state of its own — the felt never moves to
     * explain it — so the only honest signal is the table's own `error`,
     * caught the moment it arrives rather than inferred from how long the
     * ack took to come back.
     */
    const act_ = vi.fn();
    const { result, rerender } = renderHook(
      ({ error }: { error: string | null }) => useIntent(dueling(), "ada", act_, error),
      { initialProps: { error: null as string | null } },
    );

    act(() => result.current.roll());
    expect(result.current.rolling).toBe(true);

    rerender({ error: "Not your roll." });
    expect(result.current.rolling).toBe(false);
  });

  it("does not give up on a slow-but-successful roll — only on a refusal or an answer", () => {
    // A roll's own gap between ack and broadcast is a microtask in practice,
    // but nothing here should depend on that: sitting well past where the
    // old ack-plus-grace timer would have fired must change nothing.
    vi.useFakeTimers();
    const act_ = vi.fn();
    const { result } = renderHook(() => useIntent(dueling(), "ada", act_, null));

    act(() => result.current.roll());
    expect(result.current.rolling).toBe(true);

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.rolling).toBe(true);
  });

  it("gives up on it if the answer never comes", () => {
    // Held past the timeout with fake timers; rolling must go back to false
    // rather than spinning for ever. The one legitimate use of a timer here:
    // a reply that never arrives at all, not a refusal.
    vi.useFakeTimers();
    const act_ = vi.fn();
    const { result } = renderHook(() => useIntent(dueling(), "ada", act_, null));

    act(() => result.current.roll());
    expect(result.current.rolling).toBe(true);

    act(() => vi.advanceTimersByTime(PATIENCE_MS + 1));

    expect(result.current.rolling).toBe(false);
  });
});

describe("pressing pass", () => {
  it("puts the chips down on the press, because the price is not a guess", () => {
    // The stake is the player's own number, so it may be shown at once —
    // unlike a roll, which is the server's to know.
    const act_ = vi.fn();
    const { result } = renderHook(() => useIntent(dueling(), "ada", act_, null));

    act(() => result.current.pass());

    expect(result.current.pending).toBe(50);
  });

  it("does not give up on a slow-but-successful write, only on a refusal or an answer", () => {
    /*
     * `pass` does a real economy write between the ack and the broadcast —
     * unlike `roll`, where the gap is a microtask. The ack fires the instant
     * the server has dealt with the message, refused or not, strictly before
     * the state that actually answers it. A grace timer started from the ack
     * cannot tell "refused" from "still writing", so it must not exist: this
     * sits well past where the old 400ms grace timer would have fired, with
     * nothing else having happened, and the pot must still be sitting there.
     */
    vi.useFakeTimers();
    const act_ = vi.fn();
    const { result } = renderHook(() => useIntent(dueling(), "ada", act_, null));

    act(() => result.current.pass());
    expect(result.current.pending).toBe(50);

    // Well past the old grace period, with no refusal and no new state —
    // exactly what a slow-but-accepted write looks like from here.
    act(() => vi.advanceTimersByTime(500));

    expect(result.current.pending).toBe(50);
  });

  it("takes them back the instant the table refuses, not on a timer", () => {
    // Anything shown early is given up on if it is refused — the moment the
    // table says so, whatever a slow write elsewhere might otherwise suggest.
    const act_ = vi.fn();
    const { result, rerender } = renderHook(
      ({ error }: { error: string | null }) => useIntent(dueling(), "ada", act_, error),
      { initialProps: { error: null as string | null } },
    );

    act(() => result.current.pass());
    expect(result.current.pending).toBe(50);

    rerender({ error: "Already passed." });
    expect(result.current.pending).toBe(0);
  });
});
