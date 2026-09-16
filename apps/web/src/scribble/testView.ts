import type { SeatView, TableView } from "@backroom/game-scribble";

export const seat = (id: string, over: Partial<SeatView> = {}): SeatView => ({
  id,
  name: id.toUpperCase(),
  connected: true,
  team: null,
  score: 0,
  drawing: false,
  guessed: false,
  ready: false,
  ...over,
});

/** A whole view mid-drawing: s0 drawing, s1 looking at it, a minute on the clock. */
export function viewOf(over: Partial<TableView> = {}): TableView {
  const seats = over.seats ?? [seat("s0", { drawing: true }), seat("s1"), seat("s2")];
  return {
    code: "ABCDE",
    phase: "drawing",
    deadline: 2_000_060_000,
    now: 2_000_000_000,
    mode: "solo",
    rounds: 3,
    round: 1,
    drawMs: 80_000,
    hints: "few",
    minimum: 3,
    readyCount: 0,
    maxSeats: 8,
    seats,
    teams: [],
    you: seats[1] ?? null,
    hostId: "s0",
    watching: 0,
    lastEvent: null,
    turn: { drawers: ["s0"], picker: "s0", team: null, startedAt: 1_999_980_000 },
    choices: null,
    word: null,
    mask: [null, null, null, null],
    ink: [],
    reveal: null,
    winners: [],
    ...over,
  };
}
