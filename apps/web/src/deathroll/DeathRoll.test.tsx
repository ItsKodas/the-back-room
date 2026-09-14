// @vitest-environment jsdom
import type { SeatView, TableView } from "@backroom/game-death-roll";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../game/useAccount.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { Felt, Sit } from "./DeathRoll.js";

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
  ready: false,
  inGame: true,
  out: false,
  short: false,
  ...over,
});

const view = (over: Partial<TableView> = {}): TableView => ({
  code: "ABCDE",
  phase: "playing",
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
  passedTo: null,
  order: ["s1", "s2"],
  alive: ["s1", "s2"],
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
  it("says it is waiting for players, and offers nothing to press", () => {
    const state = view({
      phase: "waiting",
      waitingFor: "players",
      pot: 0,
      toRoll: null,
      seats: [seat({ id: "s1", name: "Ada" })],
      you: seat({ id: "s1", name: "Ada" }),
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);
    expect(screen.getByText(/Waiting for players\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Roll/ })).toBeNull();
  });

  it("shows the number the duel is being rolled against", () => {
    render(<Felt table={stub().table} state={view({ ceiling: 743 })} seatId="s1" />);
    expect(screen.getByText("743")).toBeTruthy();
  });

  it("shows the odds under it, so the moment to pass is visible", () => {
    // The odds line only holds for two players with nobody left holding a
    // pass — both have already spent theirs.
    const state = view({
      ceiling: 10,
      seats: [
        seat({ id: "s1", name: "Ada", passed: true }),
        seat({ id: "s2", name: "Bram", passed: true }),
      ],
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);
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

  it("says who takes the pot", () => {
    const state = view({
      phase: "over",
      toRoll: null,
      winnerIds: ["s2"],
      lastRoll: { seatId: "s1", from: 9, result: 1 },
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);
    expect(screen.getByText(/Bram takes the pot\./)).toBeTruthy();
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
      waitingFor: "players",
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
      waitingFor: "players",
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

/**
 * Six at a table rather than two, so the felt now has an order to draw
 * seats in, seats that can be out or dashed empty, and a ready screen
 * between games instead of only a duel already running.
 */
describe("the table of up to six", () => {
  it("lists seats in turn order and marks who is out, passed, and to roll", () => {
    const state = view({
      order: ["s3", "s1", "s2"],
      alive: ["s1", "s2", "s3"],
      seats: [
        seat({ id: "s1", name: "Ada", passed: true }),
        seat({ id: "s2", name: "Bram", out: true }),
        seat({ id: "s3", name: "Cleo" }),
      ],
      toRoll: "s3",
      you: seat({ id: "s3", name: "Cleo" }),
    });
    const { container } = render(<Felt table={stub().table} state={state} seatId="s3" />);

    // Drawn in state.order, not seating order — Cleo, then Ada, then Bram.
    const names = [...container.querySelectorAll(".dr__seat-name")].map((el) =>
      el.textContent?.trim(),
    );
    expect(names).toEqual(["Cleo (you)", "Ada", "Bram"]);
    expect(screen.getByText("out")).toBeTruthy();
  });

  it("hides pass on a roll passed to you, and says you must roll it", () => {
    const state = view({
      toRoll: "s1",
      passedTo: "s1",
      lastPass: { seatId: "s2", paid: 50, to: "s1" },
      you: seat({ id: "s1", name: "Ada" }),
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);

    expect(screen.queryByRole("button", { name: /Pass/i })).toBeNull();
    expect(screen.getByText(/so you must roll/)).toBeTruthy();
  });

  it("reads the odds off the same solver the bot plays, to one decimal", () => {
    const state = view({ toRoll: "s1", you: seat({ id: "s2", name: "Bram" }) });
    render(<Felt table={stub().table} state={state} seatId="s2" />);

    expect(screen.getByText(/goes out this round: \d+\.\d%/)).toBeTruthy();
  });

  it("shows the ready screen: the countdown, the ready count, and the open seats", () => {
    const state = view({
      phase: "waiting",
      waitingFor: null,
      toRoll: null,
      pot: 0,
      countdownEndsAt: Date.now() + 14_000,
      readyCount: 2,
      maxSeats: 6,
      order: ["s1", "s2", "s3", "s4"],
      alive: [],
      seats: [
        seat({ id: "s1", name: "Ada" }),
        seat({ id: "s2", name: "Bram" }),
        seat({ id: "s3", name: "Cleo" }),
        seat({ id: "s4", name: "Dee" }),
      ],
      you: seat({ id: "s1", name: "Ada" }),
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);

    expect(screen.getByText(/Dealing in/)).toBeTruthy();
    expect(screen.getByText(/2 of 4 ready/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /I'm ready/i })).toBeTruthy();
    expect(screen.getAllByText(/^Open seat$/i)).toHaveLength(2);
  });

  it("disables the ready button while its own press is outstanding", () => {
    // Roll and Pass already guard against a second press before the table
    // has answered the first (`busy` in Controls); the ready button shares
    // its slot but had no such guard, so this presses it once against an
    // `act` that never answers and checks it cannot be pressed again.
    const state = view({
      phase: "waiting",
      waitingFor: null,
      toRoll: null,
      pot: 0,
      seats: [seat({ id: "s1", name: "Ada" })],
      you: seat({ id: "s1", name: "Ada" }),
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);

    const button = screen.getByRole("button", { name: /I'm ready/i });
    fireEvent.click(button);

    expect(button).toBeDisabled();
  });

  it("shows the ready screen at a for-fun table too", () => {
    // M5 from the Task 6 review: the ready button at a for-fun table had no
    // test of its own.
    const state = view({
      phase: "waiting",
      forFun: true,
      waitingFor: null,
      toRoll: null,
      pot: 0,
      countdownEndsAt: null,
      readyCount: 1,
      maxSeats: 2,
      order: ["s1"],
      alive: [],
      seats: [seat({ id: "s1", name: "Ada", purse: 10_000 })],
      you: seat({ id: "s1", name: "Ada", purse: 10_000 }),
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);

    expect(screen.getByRole("button", { name: /I'm ready/i })).toBeTruthy();
    expect(screen.getByText(/1 of 1 ready/)).toBeTruthy();
  });

  it("says who just went out, between rounds", () => {
    const state = view({
      toRoll: null,
      lastOut: "s2",
      round: 2,
      rounds: 3,
      alive: ["s1"],
      seats: [seat({ id: "s1", name: "Ada" }), seat({ id: "s2", name: "Bram", out: true })],
      you: seat({ id: "s1", name: "Ada" }),
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);

    expect(screen.getByText(/Bram is out/)).toBeTruthy();
  });

  it("offers 2, 4 and 6 seats when hosting, and sends the choice on opening", () => {
    const create = vi.fn();
    const table = {
      busy: false,
      join: vi.fn(),
      watch: vi.fn(),
      create,
    } as unknown as TableSocketHook<TableView>;
    const account: Account = {
      profile: null,
      available: true,
      loading: false,
      refresh: vi.fn(),
      setChips: vi.fn(),
      signOut: vi.fn(),
    };

    render(<Sit table={table} invited="" account={account} />);

    expect(screen.getByRole("radio", { name: "2" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "4" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "6" })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Ada"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("radio", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: /Open a table/i }));

    expect(create).toHaveBeenCalledWith("Ada", expect.objectContaining({ maxSeats: 4 }));
  });

  it("lists a player who sat down mid-game, marked as sitting out rather than as an open seat", () => {
    const state = view({
      maxSeats: 4,
      order: ["ada", "bob"],
      alive: ["ada", "bob"],
      seats: [
        seat({ id: "ada", name: "Ada", inGame: true }),
        seat({ id: "bob", name: "Bob", inGame: true }),
        seat({ id: "cat", name: "Cat", inGame: false, waiting: true }),
      ],
      toRoll: "ada",
      you: seat({ id: "ada", name: "Ada", inGame: true }),
    });
    const { container } = render(<Felt table={stub().table} state={state} seatId="ada" />);

    const names = [...container.querySelectorAll(".dr__seat-name")].map((el) =>
      el.textContent?.trim(),
    );
    expect(names).toContain("Cat");
    expect(screen.getByText(/sitting out this game/)).toBeTruthy();
    // 4 seats − 3 actually seated (Ada, Bob, Cat) = one open seat, not three.
    expect(screen.getAllByText(/^Open seat$/i)).toHaveLength(1);
  });

  it("never draws a seat somebody is sitting in as an open one", () => {
    const state = view({
      maxSeats: 3,
      order: ["ada", "bob"],
      alive: ["ada", "bob"],
      seats: [
        seat({ id: "ada", name: "Ada", inGame: true }),
        seat({ id: "bob", name: "Bob", inGame: true }),
        seat({ id: "cat", name: "Cat", inGame: false, waiting: true }),
      ],
      toRoll: "ada",
      you: seat({ id: "ada", name: "Ada", inGame: true }),
    });
    render(<Felt table={stub().table} state={state} seatId="ada" />);

    expect(screen.queryByText(/^Open seat$/i)).toBeNull();
  });

  it("still pads to the table size between games", () => {
    const state = view({
      phase: "waiting",
      waitingFor: null,
      toRoll: null,
      pot: 0,
      maxSeats: 6,
      order: ["ada", "bob"],
      alive: [],
      seats: [seat({ id: "ada", name: "Ada" }), seat({ id: "bob", name: "Bob" })],
      you: seat({ id: "ada", name: "Ada" }),
    });
    render(<Felt table={stub().table} state={state} seatId="ada" />);

    expect(screen.getAllByText(/^Open seat$/i)).toHaveLength(4);
  });
});
