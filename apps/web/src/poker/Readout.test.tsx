import type { TableView } from "@backroom/game-poker";
import { describe, expect, it } from "vitest";
import { seat, view } from "./fixtures.js";
import { readoutFor } from "./Readout.js";

/** A hand in progress, with a decision on the felt somewhere. */
function dealtState(
  over: Partial<Omit<TableView, "you">> & { you?: Partial<NonNullable<TableView["you"]>> } = {},
): TableView {
  const { you, ...rest } = over;
  return view({
    street: "preflop",
    pot: 150,
    turnEndsAt: 9_000,
    turnMs: 30_000,
    seats: [seat({ id: "me", name: "Me", stack: 1_800 }), seat({ id: "other", name: "Other" })],
    you:
      you === undefined
        ? null
        : { toCall: 0, minRaiseTo: 40, maxRaiseTo: 2_000, canRaise: true, hand: null, ...you },
    ...rest,
  });
}

/** Nobody dealt in yet: the table between hands. */
function waitingState({ seats }: { seats: number }): TableView {
  return view({
    street: "waiting",
    pot: 0,
    turnEndsAt: null,
    seats: Array.from({ length: seats }, (_, at) => seat({ id: `s${at}`, name: `P${at}`, stack: 2_000 })),
  });
}

/**
 * A hand that has just paid out.
 *
 * `pot` is zero here on purpose — that is what `award()` actually leaves it
 * at, the same way it is on the real table by the time anybody's browser sees
 * a `street: "showdown"` view. `paid` is what stays true: the server's own
 * record of who got what, which is the only thing a showdown readout is
 * allowed to read a figure off.
 */
function showdownState(over: Partial<TableView> = {}): TableView {
  return view({
    street: "showdown",
    pot: 0,
    toAct: null,
    turnEndsAt: null,
    lastEvent: "Ada won 500 with two pair",
    seats: [seat({ id: "me", name: "Me", stack: 1_500 }), seat({ id: "other", name: "Other", stack: 2_000 })],
    ...over,
  });
}

describe("readoutFor", () => {
  it("names what this decision costs when it is yours", () => {
    const model = readoutFor({ state: dealtState({ toAct: "me", you: { toCall: 200 } }), seatId: "me" });
    expect(model).toMatchObject({ label: "To call", figure: "200", tone: "chips" });
  });

  it("says checking is free rather than saying zero", () => {
    const model = readoutFor({ state: dealtState({ toAct: "me", you: { toCall: 0 } }), seatId: "me" });
    expect(model.label).toBe("To check");
    expect(model.figure).toBe("Free");
  });

  it("says what the table is waiting for between hands", () => {
    const model = readoutFor({ state: waitingState({ seats: 1 }), seatId: "me" });
    expect(model.note).toMatch(/another player/i);
    expect(model.endsAt).toBeNull();
  });

  it("puts the clock on the readout only while somebody is on it", () => {
    expect(readoutFor({ state: dealtState({ toAct: "other", turnEndsAt: 9_000 }), seatId: "me" }).endsAt).toBe(9_000);
  });
});

describe("readoutFor at showdown", () => {
  it("shows what you actually took, off state.paid, rather than the pot the table has already zeroed", () => {
    const state = showdownState({
      paid: [{ pot: 0, seatId: "me", name: "Me", chips: 500, said: "two pair" }],
    });
    const model = readoutFor({ state, seatId: "me" });
    expect(model.figure).toBe("500");
    expect(model.tone).toBe("chips");
    expect(model.label).toMatch(/won/i);
  });

  it("sums every pot you won, for a split or side-pot hand", () => {
    const state = showdownState({
      paid: [
        { pot: 0, seatId: "me", name: "Me", chips: 300, said: "a straight" },
        { pot: 1, seatId: "me", name: "Me", chips: 150, said: "a straight" },
        { pot: 1, seatId: "other", name: "Other", chips: 150, said: "a straight" },
      ],
    });
    expect(readoutFor({ state, seatId: "me" }).figure).toBe("450");
  });

  it("says something true rather than a manufactured loss when you were in the hand and were not paid", () => {
    const state = showdownState({
      paid: [{ pot: 0, seatId: "other", name: "Other", chips: 500, said: "two pair" }],
    });
    const model = readoutFor({ state, seatId: "me" });
    // Not a number: nothing here was computed by subtracting a bet the view
    // does not carry any more — `seat.committed`/`seat.paid` are already zero
    // by the time this state exists, on the real table.
    expect(model.figure).not.toMatch(/\d/);
    expect(model.tone).toBe("plain");
  });

  it("never says 'Pot 0' to somebody watching the felt", () => {
    const state = showdownState({
      seats: [seat({ id: "other", name: "Other", stack: 2_500 })],
      paid: [{ pot: 0, seatId: "other", name: "Other", chips: 500, said: "two pair" }],
    });
    const model = readoutFor({ state, seatId: null });
    expect(model.figure).toBe("500");
    expect(model.figure).not.toBe("0");
  });
});
