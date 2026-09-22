// @vitest-environment jsdom
import type { SeatView, TableView } from "@backroom/game-liars-dice";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Seats, seatState } from "./Seats.js";

const seat = (over: Partial<SeatView> = {}): SeatView => ({
  id: "s0",
  name: "Ada",
  connected: true,
  waiting: false,
  isBot: false,
  avatar: null,
  accentColor: null,
  ready: false,
  inGame: true,
  out: false,
  short: false,
  purse: null,
  dice: 5,
  hand: [null, null, null, null, null],
  ...over,
});

const view = (seats: SeatView[], over: Partial<TableView> = {}): TableView => ({
  code: "ABCDE",
  phase: "playing",
  seats,
  watching: 0,
  forFun: false,
  maxSeats: 10,
  ante: 500,
  startingDice: 5,
  pot: 1_000,
  total: 10,
  bid: null,
  bidder: null,
  toAct: "s0",
  turnEndsAt: null,
  turnMs: 30_000,
  order: seats.map((one) => one.id),
  live: seats.map((one) => one.id),
  round: 1,
  resolution: null,
  board: [],
  winnerIds: [],
  countdownEndsAt: null,
  readyCount: 0,
  waitingFor: null,
  lastEvent: null,
  eventSeq: 1,
  you: seats[0] ?? null,
  ...over,
});

describe("a seat's state", () => {
  it("lights the one whose turn it is", () => {
    const state = view([seat()]);
    expect(seatState(seat(), state).classes).toContain("is-turn");
  });

  it("outlines your own", () => {
    const state = view([seat()], { toAct: "other" });
    expect(seatState(seat(), state).classes).toContain("is-you");
  });

  it("dims somebody out, and says so", () => {
    const state = view([seat()], { toAct: "other" });
    const out = seatState(seat({ id: "s1", out: true, dice: 0 }), state);
    expect(out.classes).toContain("is-out");
    expect(out.word).toBe("Out");
  });

  it("dims somebody gone, and says so", () => {
    const state = view([seat()], { toAct: "other" });
    expect(seatState(seat({ id: "s1", connected: false }), state).word).toBe("Gone");
  });

  it("says who is sitting the game out", () => {
    const state = view([seat()], { toAct: "other" });
    expect(seatState(seat({ id: "s1", waiting: true }), state).word).toBe("Next game");
    expect(seatState(seat({ id: "s2", short: true }), state).word).toBe("Short");
  });

  it("says who is ready, between games", () => {
    const state = view([seat()], { phase: "waiting", toAct: null });
    expect(seatState(seat({ ready: true }), state).word).toBe("Ready");
  });
});

describe("the rail", () => {
  it("draws a plate for every seat, with a pip per die", () => {
    const seats = Array.from({ length: 10 }, (_, at) =>
      seat({ id: `s${at}`, name: `Player ${at}`, dice: 5 - (at % 5) }),
    );
    const { container } = render(<Seats state={view(seats)} seatId="s0" />);
    expect(container.querySelectorAll(".ld__seat")).toHaveLength(10);
    // Five pips per plate whatever the dice: the unlit ones say what was lost.
    expect(container.querySelectorAll(".ld__seat .pip")).toHaveLength(50);
    expect(container.querySelectorAll(".ld__seat .pip--on")).toHaveLength(
      seats.reduce((sum, one) => sum + one.dice, 0),
    );
  });

  it("says a dice count to a screen reader, since the pips are decoration", () => {
    const { container } = render(<Seats state={view([seat({ dice: 3 })])} seatId="s0" />);
    expect(container.textContent).toContain("3 dice");
  });

  it("marks the names not worth their width on a phone", () => {
    const seats = [seat(), seat({ id: "s1", name: "Bram" }), seat({ id: "s2", name: "Cleo" })];
    const { container } = render(<Seats state={view(seats, { toAct: "s1" })} seatId="s0" />);
    const quiet = [...container.querySelectorAll(".ld__name--quiet")].map(
      (node) => node.textContent,
    );
    expect(quiet).toEqual(["Cleo"]);
  });
});
