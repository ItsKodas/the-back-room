// @vitest-environment jsdom
import type { SeatView, TableView } from "@backroom/game-poker";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Actions } from "./Controls.js";
import { seat, stub, view } from "./fixtures.js";

describe("what you are offered", () => {
  it("offers the buy-in, and only that, to somebody with nothing in front of them", () => {
    const table = stub();
    const mine = seat({ id: "s1", name: "Ada", stack: 0 });
    render(
      <Actions
        table={table}
        state={view({ street: "waiting", seats: [mine] })}
        me={mine}
        intent={{ move: null, committed: null, send: vi.fn() }}
      />,
    );
    expect(screen.getByRole("button", { name: /Sit down/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fold" })).toBeNull();
  });

  it("gives somebody watching no controls at all", () => {
    const table = stub();
    render(
      <Actions
        table={table}
        state={view()}
        me={null}
        intent={{ move: null, committed: null, send: vi.fn() }}
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/watching/i)).toBeTruthy();
  });
});

describe("deciding before your turn", () => {
  const idle = { move: null, committed: null, send: vi.fn() };

  /** The bar while somebody else is thinking, and a way to hand the turn over. */
  function waiting(mineOver: Partial<SeatView> = {}) {
    const table = stub();
    const mine = seat({
      id: "s1",
      name: "Ada",
      hole: [
        { rank: "A", suit: "spades" },
        { rank: "K", suit: "diamonds" },
      ],
      ...mineOver,
    });
    const at = (own: TableView["you"], toAct: string) =>
      view({ toAct, you: own, street: "flop", seats: [mine, seat({ id: "s2", name: "Bram" })] });

    const shown = render(
      <Actions table={table} state={at(null, "s2")} me={mine} intent={idle} />,
    );
    const yourTurn = (own: NonNullable<TableView["you"]>) =>
      shown.rerender(<Actions table={table} state={at(own, "s1")} me={mine} intent={idle} />);
    return { table, yourTurn };
  }

  it("offers the choices while it is somebody else's turn", () => {
    waiting();
    for (const label of ["Fold", "Check / Fold", "Check", "Call any", "Bet pot"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("offers nothing to somebody who has folded out of the hand", () => {
    // Arming a move for a hand you are not in is arming nothing.
    waiting({ folded: true });
    expect(screen.queryByRole("button", { name: "Call any" })).toBeNull();
  });

  it("checks a free turn and folds one that costs something", () => {
    const free = waiting();
    fireEvent.click(screen.getByRole("button", { name: "Check / Fold" }));
    free.yourTurn({ toCall: 0, minRaiseTo: 40, maxRaiseTo: 2_000, canRaise: true });
    expect(free.table.sent).toEqual([{ type: "check" }]);

    cleanup();

    const owed = waiting();
    fireEvent.click(screen.getByRole("button", { name: "Check / Fold" }));
    owed.yourTurn({ toCall: 200, minRaiseTo: 400, maxRaiseTo: 2_000, canRaise: true });
    expect(owed.table.sent).toEqual([{ type: "fold" }]);
  });

  it("drops an armed check rather than turning it into a call", () => {
    /*
     * The one that would cost somebody a stack. You arm a check, somebody bets
     * behind you, and the nearest thing still legal is to call — which is a
     * different decision, and nobody made it. So it lapses, and the turn goes
     * back to the person whose turn it is.
     */
    const { table, yourTurn } = waiting();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    yourTurn({ toCall: 600, minRaiseTo: 1_200, maxRaiseTo: 2_000, canRaise: true });

    expect(table.sent).toEqual([]);
    expect(screen.getByRole("button", { name: "Call 600" })).toBeTruthy();
  });

  it("calls whatever it has come to when that is what was asked for", () => {
    const { table, yourTurn } = waiting();
    fireEvent.click(screen.getByRole("button", { name: "Call any" }));
    yourTurn({ toCall: 600, minRaiseTo: 1_200, maxRaiseTo: 2_000, canRaise: true });
    expect(table.sent).toEqual([{ type: "call" }]);
  });

  it("un-arms when the same choice is pressed twice", () => {
    const { table, yourTurn } = waiting();
    const fold = screen.getByRole("button", { name: "Fold" });
    fireEvent.click(fold);
    fireEvent.click(fold);
    yourTurn({ toCall: 200, minRaiseTo: 400, maxRaiseTo: 2_000, canRaise: true });
    expect(table.sent).toEqual([]);
  });

  it("lets an arming lapse when the next card comes out", () => {
    /*
     * A pre-selection is about the decision in front of you. Once there is a
     * new card there is a new decision, and a move chosen against the old one
     * is not an answer to it.
     */
    const table = stub();
    const mine = seat({
      id: "s1",
      name: "Ada",
      hole: [
        { rank: "A", suit: "spades" },
        { rank: "K", suit: "diamonds" },
      ],
    });
    const at = (street: TableView["street"], own: TableView["you"], toAct: string) =>
      view({ street, toAct, you: own, seats: [mine, seat({ id: "s2", name: "Bram" })] });

    const shown = render(
      <Actions table={table} state={at("flop", null, "s2")} me={mine} intent={idle} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fold" }));
    // The turn card, and now it is your go.
    shown.rerender(
      <Actions
        table={table}
        state={at("turn", { toCall: 0, minRaiseTo: 40, maxRaiseTo: 2_000, canRaise: true }, "s1")}
        me={mine}
        intent={idle}
      />,
    );
    expect(table.sent).toEqual([]);
  });
});
