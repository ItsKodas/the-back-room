// @vitest-environment jsdom
import type { SeatView, TableView } from "@backroom/game-death-roll";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { Felt } from "./DeathRoll.js";

afterEach(cleanup);

/**
 * What the felt says, and what it refuses to say.
 *
 * The client may show every rule in CLAUDE.md and must never be the thing
 * enforcing one, so these are about what a player can read rather than about
 * what they are prevented from doing.
 */

const seat = (over: Partial<SeatView> & { id: string; name: string }): SeatView => ({
  connected: true,
  waiting: false,
  isBot: false,
  avatar: null,
  accentColor: null,
  passed: false,
  purse: null,
  ...over,
});

const view = (over: Partial<TableView> = {}): TableView => ({
  code: "ABCDE",
  phase: "dueling",
  seats: [seat({ id: "s1", name: "Ada" }), seat({ id: "s2", name: "Bram" })],
  watching: 0,
  forFun: false,
  maxSeats: 2,
  ante: 500,
  opening: 1_000,
  passPrice: 50,
  ceiling: 1_000,
  pot: 1_000,
  toRoll: "s1",
  turnEndsAt: null,
  lastRoll: null,
  lastPass: null,
  history: [],
  loserId: null,
  winnerIds: [],
  waitingFor: null,
  shortId: null,
  lastEvent: null,
  you: seat({ id: "s1", name: "Ada" }),
  ...over,
});

const stub = () => {
  const act = vi.fn();
  const addBot = vi.fn();
  return {
    table: { act, addBot, busy: false } as unknown as TableSocketHook<TableView>,
    act,
    addBot,
  };
};

describe("the death roll felt", () => {
  it("says it is waiting for an opponent, and offers nothing to press", () => {
    const state = view({
      phase: "waiting",
      waitingFor: "opponent",
      pot: 0,
      toRoll: null,
      seats: [seat({ id: "s1", name: "Ada" })],
      you: seat({ id: "s1", name: "Ada" }),
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);
    expect(screen.getByText(/waiting for an opponent/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Roll/ })).toBeNull();
  });

  it("shows the number the duel is being rolled against", () => {
    render(<Felt table={stub().table} state={view({ ceiling: 743 })} seatId="s1" />);
    expect(screen.getByText("743")).toBeTruthy();
  });

  it("shows the odds under it, so the moment to pass is visible", () => {
    render(<Felt table={stub().table} state={view({ ceiling: 10 })} seatId="s1" />);
    expect(screen.getByText(/50\.9%/)).toBeTruthy();
  });

  it("offers a pass with its price on it", () => {
    render(<Felt table={stub().table} state={view({ passPrice: 50 })} seatId="s1" />);
    expect(screen.getByRole("button", { name: /Pass.*50/i })).toBeTruthy();
  });

  it("takes the pass away once it is spent", () => {
    const state = view({ you: seat({ id: "s1", name: "Ada", passed: true }) });
    render(<Felt table={stub().table} state={state} seatId="s1" />);
    expect(screen.queryByRole("button", { name: /Pass/i })).toBeNull();
  });

  it("says who lost, and on what", () => {
    const state = view({
      phase: "over",
      toRoll: null,
      loserId: "s1",
      winnerIds: ["s2"],
      lastRoll: { seatId: "s1", from: 9, result: 1 },
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);
    // "Ada" is also the name on her own seat, so this checks the sentence
    // that actually says what happened rather than any mention of her name.
    expect(screen.getByText(/^Ada rolled a 1 out of 9/)).toBeTruthy();
  });

  it("says a for-fun table is a for-fun table", () => {
    const state = view({
      forFun: true,
      seats: [
        seat({ id: "s1", name: "Ada", purse: 4_000 }),
        seat({ id: "s2", name: "Bram", purse: 4_000 }),
      ],
      you: seat({ id: "s1", name: "Ada", purse: 4_000 }),
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);
    expect(screen.getAllByText(/play money/i).length).toBeGreaterThan(0);
    // A player must never be unsure whether they are spending real chips or
    // not, which means the word this table never uses is "chips" itself.
    expect(screen.queryByText(/\bchips\b/i)).toBeNull();
  });

  it("offers to deal a bot in at a for-fun table with a seat free", () => {
    /*
     * The reason bots exist at all: a for-fun table is meant to be worth
     * sitting at on your own, and a duel needs two. Without this control the
     * one player who opened it waits for an opponent for ever.
     */
    const stubbed = stub();
    const state = view({
      forFun: true,
      phase: "waiting",
      waitingFor: "opponent",
      pot: 0,
      toRoll: null,
      seats: [seat({ id: "s1", name: "Ada", purse: 10_000 })],
      you: seat({ id: "s1", name: "Ada", purse: 10_000 }),
    });
    render(<Felt table={stubbed.table} state={state} seatId="s1" />);

    const normal = screen.getByRole("button", { name: /normal/i });
    normal.click();

    expect(stubbed.addBot).toHaveBeenCalledWith("normal");
  });

  it("offers no bot at a table playing for chips", () => {
    /*
     * Chips are only won from real people. The table refuses a bot whatever
     * the browser shows and that is the rule — this only stops the felt
     * offering something it knows would be turned down.
     */
    const state = view({
      phase: "waiting",
      waitingFor: "opponent",
      pot: 0,
      toRoll: null,
      seats: [seat({ id: "s1", name: "Ada" })],
      you: seat({ id: "s1", name: "Ada" }),
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);

    expect(screen.queryByText(/deal somebody in/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /normal/i })).toBeNull();
  });

  it("says which of the two is a bot", () => {
    const state = view({
      forFun: true,
      seats: [
        seat({ id: "s1", name: "Ada", purse: 10_000 }),
        seat({ id: "s2", name: "Bram", isBot: true, purse: 10_000 }),
      ],
      you: seat({ id: "s1", name: "Ada", purse: 10_000 }),
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);

    expect(screen.getByText(/^bot$/i)).toBeTruthy();
  });
});
