// @vitest-environment jsdom
import type { Card, TableView } from "@backroom/game-uno";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealt } from "./fixtures.js";
import { PATIENCE_MS, useIntent } from "./useIntent.js";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

const first = (view: TableView) => view.hand?.cards[0] as Card;

describe("playing a card", () => {
  it("puts it on the pile on the press, because its face is the player's own", async () => {
    const { view } = await dealt();
    const state = view();
    const { result } = renderHook(() => useIntent(state, null));
    act(() => result.current.play(first(state), "red"));
    expect(result.current.played?.card.id).toBe(first(state).id);
    expect(result.current.played?.color).toBe("red");
    expect(result.current.busy).toBe(true);
  });

  it("gives way once the card is gone from the hand the table sends", async () => {
    const { view } = await dealt();
    const state = view();
    const card = first(state);
    const { result, rerender } = renderHook(({ s }: { s: TableView }) => useIntent(s, null), {
      initialProps: { s: state },
    });
    act(() => result.current.play(card, null));
    const after = { ...state, hand: { ...(state.hand as NonNullable<TableView["hand"]>), cards: state.hand?.cards.slice(1) ?? [] } };
    rerender({ s: after });
    expect(result.current.played).toBe(null);
  });

  it("is given up on, on a clock, when the table never answers", async () => {
    const { view } = await dealt();
    const state = view();
    const { result } = renderHook(() => useIntent(state, null));
    act(() => result.current.play(first(state), null));
    act(() => void vi.advanceTimersByTime(PATIENCE_MS - 1));
    expect(result.current.played).not.toBe(null);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.played).toBe(null);
  });

  it("is dropped on a refusal, even one in the same words as the last", async () => {
    const { view } = await dealt();
    const state = view();
    const { result, rerender } = renderHook(
      ({ error, key }: { error: string | null; key: number }) => useIntent(state, error, key),
      { initialProps: { error: "No." as string | null, key: 1 } },
    );
    act(() => result.current.play(first(state), null));
    rerender({ error: "No.", key: 2 });
    expect(result.current.played).toBe(null);
  });
});

describe("drawing", () => {
  it("shows a card arriving face down, and nothing about what it is", async () => {
    const { view } = await dealt();
    const state = view();
    const { result } = renderHook(() => useIntent(state, null));
    act(() => result.current.draw(7));
    expect(result.current.drawing).toBe(7);
    expect(result.current.played).toBe(null);
  });

  it("stops once the table has said anything", async () => {
    const { view } = await dealt();
    const state = view();
    const { result, rerender } = renderHook(({ s }: { s: TableView }) => useIntent(s, null), {
      initialProps: { s: state },
    });
    act(() => result.current.draw(7));
    rerender({ s: { ...state, eventSeq: state.eventSeq + 1 } });
    expect(result.current.drawing).toBe(null);
  });
});
