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
