// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { seat, view } from "./fixtures.js";

const played: string[] = [];
vi.mock("../game/audio.js", () => ({ play: (cue: string) => played.push(cue) }));

import { useDiceSound } from "./useDiceSound.js";

beforeEach(() => {
  played.length = 0;
});

describe("the table's own sound", () => {
  /*
   * The whole point of this hook: a table resends the same view for reasons
   * that have nothing to do with a new event — somebody sitting down, a
   * taunt landing — and none of that may replay as a sound. Every case below
   * pairs two *different* states and asserts on the change between them,
   * never on a state simply being present.
   */
  it("says nothing on arrival, however the table's state reads", () => {
    const arriving = view([seat({ id: "s0" }), seat({ id: "s1" })], {
      round: 3,
      bid: { count: 4, face: 3 },
      resolution: { bid: { count: 4, face: 3 }, call: "exact", caller: "s1", count: 5, right: true, losers: [] },
      toAct: "s0",
    });
    renderHook((state) => useDiceSound(state, "s0"), { initialProps: arriving });
    expect(played).toEqual([]);
  });

  it("shakes when a new round is dealt", () => {
    const one = view([seat({ id: "s0" }), seat({ id: "s1" })], { round: 1, phase: "playing" });
    const two = { ...one, round: 2 };
    const { rerender } = renderHook((state) => useDiceSound(state, "s0"), { initialProps: one });
    rerender(two);
    expect(played).toEqual(["shake"]);
  });

  it("does not shake when the round clears back to nothing between games", () => {
    const last = view([seat({ id: "s0" }), seat({ id: "s1" })], { round: 4, phase: "over", winnerIds: ["s1"] });
    const cleared = { ...last, round: 0, phase: "waiting" as const, winnerIds: [] };
    const { rerender } = renderHook((state) => useDiceSound(state, "s0"), { initialProps: last });
    rerender(cleared);
    expect(played).not.toContain("shake");
  });

  it("says a raise when the standing bid changes by value, and not on a resend of the same one", () => {
    const opened = view([seat({ id: "s0" }), seat({ id: "s1" })], { bid: { count: 3, face: 2 }, bidder: "s0" });
    const raised = { ...opened, bid: { count: 4, face: 2 }, bidder: "s1" };
    const { rerender } = renderHook((state) => useDiceSound(state, "s0"), { initialProps: opened });
    rerender({ ...opened });
    expect(played).toEqual([]);
    rerender(raised);
    expect(played).toEqual(["sayRaise"]);
  });

  it("plays sayExact and the reveal when an exact call resolves", () => {
    const bidding = view([seat({ id: "s0" }), seat({ id: "s1" })], { bid: { count: 3, face: 2 }, resolution: null });
    const resolved = {
      ...bidding,
      resolution: { bid: { count: 3, face: 2 }, call: "exact" as const, caller: "s1", count: 3, right: true, losers: ["s0"] },
    };
    const { rerender } = renderHook((state) => useDiceSound(state, "s0"), { initialProps: bidding });
    rerender(resolved);
    expect(played).toEqual(["sayExact", "reveal"]);
  });

  it("plays sayCall and the reveal when a liar call resolves", () => {
    const bidding = view([seat({ id: "s0" }), seat({ id: "s1" })], { bid: { count: 3, face: 2 }, resolution: null });
    const resolved = {
      ...bidding,
      resolution: { bid: { count: 3, face: 2 }, call: "liar" as const, caller: "s1", count: 2, right: true, losers: ["s0"] },
    };
    const { rerender } = renderHook((state) => useDiceSound(state, "s0"), { initialProps: bidding });
    rerender(resolved);
    expect(played).toEqual(["sayCall", "reveal"]);
  });

  it("rings yourTurn only for the seat the turn actually arrives on", () => {
    const theirs = view([seat({ id: "s0" }), seat({ id: "s1" })], { toAct: "s1" });
    const mine = { ...theirs, toAct: "s0" };
    const { rerender } = renderHook((state) => useDiceSound(state, "s0"), { initialProps: theirs });
    rerender(mine);
    expect(played).toEqual(["yourTurn"]);
  });

  it("says nothing when the turn moves to somebody who is not you", () => {
    const mine = view([seat({ id: "s0" }), seat({ id: "s1" })], { toAct: "s0" });
    const theirs = { ...mine, toAct: "s1" };
    const { rerender } = renderHook((state) => useDiceSound(state, "s0"), { initialProps: mine });
    rerender(theirs);
    expect(played).toEqual([]);
  });

  it("pushes the pot when the game ends, and rings win only for the seat that won", () => {
    const playing = view([seat({ id: "s0" }), seat({ id: "s1" })], { phase: "playing", winnerIds: [] });
    const over = { ...playing, phase: "over" as const, winnerIds: ["s0"] };
    const { rerender } = renderHook((state) => useDiceSound(state, "s0"), { initialProps: playing });
    rerender(over);
    expect(played).toEqual(["potPush", "win"]);
  });

  /*
   * The brief this shipped against expected `win` on any game end. That is
   * wrong: a win cue for the seat that just lost is a table cheering at the
   * wrong person. This is the corrected case — the same ending, watched from
   * the loser's seat, gets the pot push and nothing else.
   */
  it("does not ring win for a seat that was not the winner", () => {
    const playing = view([seat({ id: "s0" }), seat({ id: "s1" })], { phase: "playing", winnerIds: [] });
    const over = { ...playing, phase: "over" as const, winnerIds: ["s1"] };
    const { rerender } = renderHook((state) => useDiceSound(state, "s0"), { initialProps: playing });
    rerender(over);
    expect(played).toEqual(["potPush"]);
  });

  it("says nothing for a watcher with no seat of their own", () => {
    const playing = view([seat({ id: "s0" }), seat({ id: "s1" })], { phase: "playing", toAct: "s1", winnerIds: [] });
    const over = { ...playing, phase: "over" as const, toAct: null, winnerIds: ["s0"] };
    const { rerender } = renderHook((state) => useDiceSound(state, null), { initialProps: playing });
    rerender(over);
    expect(played).toEqual(["potPush"]);
  });
});
