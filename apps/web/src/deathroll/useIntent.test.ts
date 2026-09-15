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

/** A game with two seats, holding whatever this test needs it to hold. */
function playing(overrides: Partial<TableView> = {}): TableView {
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
    ready: false,
    inGame: true,
    out: false,
    short: false,
  });
  return {
    code: "ABCDE",
    phase: "playing",
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
    passedTo: null,
    order: ["ada", "bram"],
    alive: ["ada", "bram"],
    round: 1,
    rounds: 1,
    lastRoll: null,
    lastPass: null,
    history: [],
    lastOut: null,
    winnerIds: [],
    countdownEndsAt: null,
    readyCount: 0,
    waitingFor: null,
    lastEvent: null,
    you: seat("ada", "Ada"),
    ...overrides,
  };
}

/** This seat, not yet ready for the next game. Named so a test can build on it without a non-null assertion. */
const notReady = {
  id: "ada",
  name: "Ada",
  connected: true,
  waiting: false,
  isBot: false,
  avatar: null,
  accentColor: null,
  passed: false,
  purse: null,
  ready: false,
  inGame: true,
  out: false,
  short: false,
};

/** A table between games, holding whatever this test needs it to hold. */
function waiting(overrides: Partial<TableView> = {}): TableView {
  return { ...playing({ phase: "waiting", toRoll: null, you: notReady }), ...overrides };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pressing roll", () => {
  it("starts the number tumbling before the server has answered", () => {
    const act_ = vi.fn();
    const { result } = renderHook(() => useIntent(playing(), "ada", act_, null));

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
      { initialProps: { state: playing() } },
    );

    act(() => result.current.roll());
    expect(result.current.rolling).toBe(true);

    rerender({ state: playing({ ceiling: 743 }) });

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
      ({ error }: { error: string | null }) => useIntent(playing(), "ada", act_, error),
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
    const { result } = renderHook(() => useIntent(playing(), "ada", act_, null));

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
    const { result } = renderHook(() => useIntent(playing(), "ada", act_, null));

    act(() => result.current.roll());
    expect(result.current.rolling).toBe(true);

    act(() => vi.advanceTimersByTime(PATIENCE_MS + 1));

    expect(result.current.rolling).toBe(false);
  });

  it("gives up on a roll refused in the same words as the last refusal", () => {
    const act_ = vi.fn();
    const { result, rerender } = renderHook(
      ({ key }: { key: number }) => useIntent(playing(), "ada", act_, "Not your roll.", key),
      { initialProps: { key: 1 } },
    );

    act(() => result.current.roll());
    expect(result.current.rolling).toBe(true);

    rerender({ key: 2 });
    expect(result.current.rolling).toBe(false);
  });
});

describe("pressing pass", () => {
  it("puts the chips down on the press, because the price is not a guess", () => {
    // The stake is the player's own number, so it may be shown at once —
    // unlike a roll, which is the server's to know.
    const act_ = vi.fn();
    const { result } = renderHook(() => useIntent(playing(), "ada", act_, null));

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
    const { result } = renderHook(() => useIntent(playing(), "ada", act_, null));

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
      ({ error }: { error: string | null }) => useIntent(playing(), "ada", act_, error),
      { initialProps: { error: null as string | null } },
    );

    act(() => result.current.pass());
    expect(result.current.pending).toBe(50);

    rerender({ error: "Already passed." });
    expect(result.current.pending).toBe(0);
  });
});

describe("pressing ready", () => {
  it("shows ready on the press, before the table has answered", () => {
    const act_ = vi.fn();
    const { result } = renderHook(() => useIntent(waiting(), "ada", act_, null));

    act(() => result.current.ready(true));

    expect(result.current.readying).toBe(true);
    expect(act_).toHaveBeenCalledWith({ type: "ready", ready: true });
  });

  it("gives way to the table once it agrees", () => {
    const act_ = vi.fn();
    const { result, rerender } = renderHook(
      ({ state }: { state: TableView }) => useIntent(state, "ada", act_, null),
      { initialProps: { state: waiting() } },
    );
    act(() => result.current.ready(true));

    rerender({ state: waiting({ you: { ...notReady, ready: true } }) });

    expect(result.current.readying).toBeNull();
  });

  it("is given up the moment the table refuses it", () => {
    const act_ = vi.fn();
    const { result, rerender } = renderHook(
      ({ error }: { error: string | null }) => useIntent(waiting(), "ada", act_, error),
      { initialProps: { error: null as string | null } },
    );
    act(() => result.current.ready(true));

    rerender({ error: "You can get ready once this game is over." });

    expect(result.current.readying).toBeNull();
  });

  it("is given up if no answer ever comes", () => {
    vi.useFakeTimers();
    try {
      const act_ = vi.fn();
      const { result } = renderHook(() => useIntent(waiting(), "ada", act_, null));
      act(() => result.current.ready(true));

      act(() => {
        vi.advanceTimersByTime(PATIENCE_MS + 1);
      });

      expect(result.current.readying).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let an answered press's own timer clear a later, unrelated one", () => {
    /*
     * Each press winds its own PATIENCE_MS clock without cancelling an
     * earlier press's clock. An answer clears the intent but not the timer
     * that was armed for it, so that timer is still ticking — and, unfixed,
     * still reaches for `setSent(null)` when it fires, however outdated the
     * intent it was armed for has become. Here a second, still-outstanding
     * press must survive past the first press's own deadline.
     */
    vi.useFakeTimers();
    try {
      const act_ = vi.fn();
      const { result, rerender } = renderHook(
        ({ state }: { state: TableView }) => useIntent(state, "ada", act_, null),
        { initialProps: { state: waiting() } },
      );

      act(() => result.current.ready(true)); // t=0: timer A armed for t=1600.
      act(() => vi.advanceTimersByTime(50));
      rerender({ state: waiting({ you: { ...notReady, ready: true } }) }); // t=50: answered.
      expect(result.current.readying).toBeNull();

      act(() => vi.advanceTimersByTime(250)); // t=300.
      act(() => result.current.ready(false)); // timer B armed for t=1900.
      expect(result.current.readying).toBe(false);

      act(() => vi.advanceTimersByTime(1301)); // t=1601: just past timer A's deadline.
      expect(result.current.readying).toBe(false);

      act(() => vi.advanceTimersByTime(300)); // t=1901: just past timer B's deadline.
      expect(result.current.readying).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
