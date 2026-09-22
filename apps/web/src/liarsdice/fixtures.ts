import type { SeatView, TableView } from "@backroom/game-liars-dice";

/*
 * Tables as the server describes them, for tests. Whole views rather than
 * casts, so a field the felt starts reading is a field these have to grow.
 */

export function seat(over: Partial<SeatView> = {}): SeatView {
  return {
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
  };
}

export function view(seats: SeatView[], over: Partial<TableView> = {}): TableView {
  return {
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
  };
}
