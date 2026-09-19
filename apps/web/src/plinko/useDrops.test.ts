// @vitest-environment jsdom
import type { PlinkoResult } from "@backroom/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../game/useAccount.js";
import type { Ball } from "./Board.js";
import { NO_ANSWER, PATIENCE_MS, useDrops } from "./useDrops.js";

/**
 * The bargain in CLAUDE.md, tested on a clock rather than by eye: a stake is
 * the player's own number and leaves at once; a win is the server's fact and
 * does not show until the ball lands; a refusal or a silence hands the stake
 * straight back.
 */

function account(overrides: Partial<Account> = {}): Account {
  return {
    profile: {
      id: "ada",
      name: "Ada",
      avatar: null,
      accentColor: null,
      chips: 1_000,
      stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
      byGame: {},
    },
    available: true,
    loading: false,
    admin: false,
    refresh: vi.fn(),
    setChips: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  };
}

function ok(overrides: Partial<Extract<PlinkoResult, { ok: true }>> = {}): PlinkoResult {
  return {
    ok: true,
    path: Array(12).fill(false),
    bucket: 0,
    mult: 80,
    stake: 100,
    risk: "medium",
    won: 800,
    bank: 40_000,
    caps: { low: 1_000, medium: 1_000, high: 1_000 },
    balance: 1_700,
    ...overrides,
  };
}

describe("useDrops", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes the stake off the shown balance at the press", () => {
    const emit = vi.fn();
    const balls = { current: new Map<string, Ball>() };
    const acc = account();
    const { result } = renderHook(() => useDrops(emit, acc, balls, vi.fn()));

    act(() => {
      result.current.drop({ fun: false, stake: 100, risk: "medium" });
    });

    expect(acc.setChips).toHaveBeenCalledWith(900);
  });

  it("gives the stake back on a refusal, and says why", () => {
    const emit = vi.fn((_payload: unknown, ack: (result: PlinkoResult) => void) => {
      ack({ ok: false, error: "The bank is short." });
    });
    const balls = { current: new Map<string, Ball>() };
    const acc = account();
    const { result } = renderHook(() => useDrops(emit, acc, balls, vi.fn()));

    act(() => {
      result.current.drop({ fun: false, stake: 100, risk: "medium" });
    });

    expect(acc.setChips).toHaveBeenLastCalledWith(1_000);
    expect(result.current.notice).toBe("The bank is short.");
  });

  it("gives up after 10s of silence, then a late ok ack still lands without double counting", () => {
    let sendAck: ((result: PlinkoResult) => void) | null = null;
    const emit = vi.fn((_payload: unknown, ack: (result: PlinkoResult) => void) => {
      sendAck = ack;
    });
    const balls = { current: new Map<string, Ball>() };
    const acc = account();
    const onSign = vi.fn();
    const { result } = renderHook(() => useDrops(emit, acc, balls, onSign));

    act(() => {
      result.current.drop({ fun: false, stake: 100, risk: "medium" });
    });
    expect(acc.setChips).toHaveBeenLastCalledWith(900);

    act(() => {
      vi.advanceTimersByTime(PATIENCE_MS);
    });
    expect(acc.setChips).toHaveBeenLastCalledWith(1_000);
    expect(result.current.notice).toBe(NO_ANSWER);

    // The ball went through after all — the balance corrects, once, to
    // exactly what the server says, and the sign moves with it.
    act(() => {
      sendAck?.(ok());
    });
    expect(acc.setChips).toHaveBeenLastCalledWith(1_700);
    expect(acc.setChips).toHaveBeenCalledTimes(3);
    expect(onSign).toHaveBeenCalledWith(false, { bank: 40_000, caps: ok().caps });
  });

  it("does not show the win before the ball lands", () => {
    let sendAck: ((result: PlinkoResult) => void) | null = null;
    const emit = vi.fn((_payload: unknown, ack: (result: PlinkoResult) => void) => {
      sendAck = ack;
    });
    const balls = { current: new Map<string, Ball>() };
    const acc = account();
    let id: string | null = null;
    const { result } = renderHook(() => useDrops(emit, acc, balls, vi.fn()));

    act(() => {
      id = result.current.drop({ fun: false, stake: 100, risk: "medium" });
    });
    if (id === null) throw new Error("expected a ball id");

    act(() => {
      sendAck?.(ok());
    });
    // The server has already paid — 1,700 — but the win is held back until landing.
    expect(acc.setChips).toHaveBeenLastCalledWith(900);

    act(() => {
      result.current.land(id as string, false);
    });
    expect(acc.setChips).toHaveBeenLastCalledWith(1_700);
  });

  it("refreshes the account if a press is still unanswered when the page leaves", () => {
    const emit = vi.fn(); // never acks
    const balls = { current: new Map<string, Ball>() };
    const acc = account();
    const { result, unmount } = renderHook(() => useDrops(emit, acc, balls, vi.fn()));

    act(() => {
      result.current.drop({ fun: false, stake: 100, risk: "medium" });
    });
    unmount();

    expect(acc.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes the account if a give-up is still unanswered when the page leaves", () => {
    // giveUp empties the chips book's own pending map, so idle() alone would
    // say there is nothing left to worry about — even though a real answer
    // can still be on the wire, which is exactly what NO_ANSWER promises.
    const emit = vi.fn(); // never acks, not even late
    const balls = { current: new Map<string, Ball>() };
    const acc = account();
    const { result, unmount } = renderHook(() => useDrops(emit, acc, balls, vi.fn()));

    act(() => {
      result.current.drop({ fun: false, stake: 100, risk: "medium" });
    });
    act(() => {
      vi.advanceTimersByTime(PATIENCE_MS);
    });
    expect(result.current.busy).toBe(false); // the book itself is idle now
    unmount();

    expect(acc.refresh).toHaveBeenCalledTimes(1);
  });

  it("needs no refresh once a give-up's late ack has already landed", () => {
    let sendAck: ((result: PlinkoResult) => void) | null = null;
    const emit = vi.fn((_payload: unknown, ack: (result: PlinkoResult) => void) => {
      sendAck = ack;
    });
    const balls = { current: new Map<string, Ball>() };
    const acc = account();
    const { result, unmount } = renderHook(() => useDrops(emit, acc, balls, vi.fn()));

    act(() => {
      result.current.drop({ fun: false, stake: 100, risk: "medium" });
    });
    act(() => {
      vi.advanceTimersByTime(PATIENCE_MS);
    });
    act(() => {
      sendAck?.(ok());
    });
    unmount();

    expect(acc.refresh).not.toHaveBeenCalled();
  });

  it("does not refresh the account when nothing was left unanswered", () => {
    const emit = vi.fn((_payload: unknown, ack: (result: PlinkoResult) => void) =>
      ack({ ok: false, error: "no" }),
    );
    const balls = { current: new Map<string, Ball>() };
    const acc = account();
    const { result, unmount } = renderHook(() => useDrops(emit, acc, balls, vi.fn()));

    act(() => {
      result.current.drop({ fun: false, stake: 100, risk: "medium" });
    });
    unmount();

    expect(acc.refresh).not.toHaveBeenCalled();
  });

  it("plays for fun without touching the account at all", () => {
    const emit = vi.fn((_payload: unknown, ack: (result: PlinkoResult) => void) => ack(ok({ balance: 24_900 })));
    const balls = { current: new Map<string, Ball>() };
    const acc = account();
    let id: string | null = null;
    const { result } = renderHook(() => useDrops(emit, acc, balls, vi.fn()));

    act(() => {
      id = result.current.drop({ fun: true, stake: 100, risk: "medium" });
    });
    if (id === null) throw new Error("expected a ball id");
    expect(result.current.funPurse).toBe(24_900 - 800);
    expect(acc.setChips).not.toHaveBeenCalled();

    act(() => {
      result.current.land(id as string, true);
    });
    expect(result.current.funPurse).toBe(24_900);
    expect(acc.setChips).not.toHaveBeenCalled();
  });
});
