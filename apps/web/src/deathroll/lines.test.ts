import { lossOdds } from "@backroom/game-death-roll";
import type { SeatView, TableView } from "@backroom/game-death-roll";
import { describe, expect, it } from "vitest";
import { goesOut, moveLine } from "./lines.js";

const seat = (id: string, over: Partial<SeatView> = {}): SeatView => ({
  id,
  name: id[0]?.toUpperCase() + id.slice(1),
  connected: true,
  waiting: false,
  isBot: false,
  avatar: null,
  accentColor: null,
  ready: false,
  inGame: true,
  out: false,
  passed: false,
  short: false,
  purse: null,
  ...over,
});

const playing = (over: Partial<TableView> = {}): TableView => ({
  code: "ABCDE",
  phase: "playing",
  seats: [seat("ada"), seat("bob"), seat("cat")],
  watching: 0,
  forFun: false,
  maxSeats: 6,
  ante: 500,
  opening: 1_000,
  passPrice: 50,
  ceiling: 12,
  pot: 1_500,
  toRoll: "ada",
  turnEndsAt: null,
  passedTo: null,
  order: ["ada", "bob", "cat"],
  alive: ["ada", "bob", "cat"],
  round: 1,
  rounds: 2,
  lastRoll: null,
  lastPass: null,
  history: [],
  lastOut: null,
  winnerIds: [],
  countdownEndsAt: null,
  readyCount: 0,
  waitingFor: null,
  lastEvent: null,
  you: null,
  ...over,
});

describe("the odds under the number", () => {
  it("is the duel's closed form when two are left and nobody holds a pass", () => {
    const state = playing({
      seats: [seat("ada", { passed: true }), seat("bob", { passed: true })],
      alive: ["ada", "bob"],
      order: ["ada", "bob"],
      ceiling: 40,
    });

    expect(goesOut(state)).toBeCloseTo(lossOdds(40), 12);
  });

  it("is nothing between games or between rounds", () => {
    expect(goesOut(playing({ phase: "waiting", toRoll: null }))).toBeNull();
    expect(goesOut(playing({ toRoll: null }))).toBeNull();
  });

  it("is a real chance of going out at a table of three", () => {
    const chance = goesOut(playing()) as number;

    expect(chance).toBeGreaterThan(0);
    expect(chance).toBeLessThan(1);
  });
});

describe("the move, in words", () => {
  it("offers you the pass, naming who it would land on", () => {
    expect(moveLine(playing(), "ada")).toBe("Your roll — roll it, or pass it to Bob");
  });

  it("tells you that you must roll a roll passed to you", () => {
    const state = playing({
      toRoll: "bob",
      passedTo: "bob",
      lastPass: { seatId: "ada", paid: 50, to: "bob" },
    });

    expect(moveLine(state, "bob")).toBe("Your roll — Ada passed it to you, so you must roll");
    expect(moveLine(state, "cat")).toBe("Bob's roll — Ada passed it to them, so they must roll");
  });

  it("does not offer a pass you have already spent", () => {
    const state = playing({ seats: [seat("ada", { passed: true }), seat("bob"), seat("cat")] });

    expect(moveLine(state, "ada")).toBe("Your roll");
  });

  it("names whoever is to roll for everybody else", () => {
    expect(moveLine(playing(), "bob")).toBe("Ada to roll");
  });

  it("says nothing when nobody is to roll", () => {
    expect(moveLine(playing({ toRoll: null }), "ada")).toBeNull();
  });
});
