// @vitest-environment jsdom
import type { SeatView, TableView } from "@backroom/game-poker";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Actions } from "./Controls.js";
import { seat, stub, view } from "./fixtures.js";

/*
 * The fittings the controls are built from, checked the way the reference
 * table (Blackjack's Controls.tsx) checks its own: one lit slab per state,
 * busy without being dead, and the pre-turn choices dressed as lamps rather
 * than the bespoke pk__prebtn this table used to carry.
 */
describe("the fittings", () => {
  const MINE = seat({
    id: "s1",
    name: "Ada",
    hole: [
      { rank: "A", suit: "spades" },
      { rank: "K", suit: "diamonds" },
    ],
  });
  const OTHER = seat({ id: "s2", name: "Bram" });

  function renderControls({ state, busy = false }: { state: TableView; busy?: boolean }) {
    const table = stub();
    table.busy = busy;
    render(
      <Actions
        table={table}
        state={state}
        me={MINE}
        intent={{ move: null, committed: null, send: vi.fn() }}
      />,
    );
  }

  /** The turn actually in front of you, with a raise on offer. */
  function onYourTurn({ toCall, busy = false }: { toCall: number; busy?: boolean }) {
    return {
      busy,
      state: view({
        toAct: "s1",
        street: "flop",
        you: { toCall, minRaiseTo: toCall + 20, maxRaiseTo: 2_000, canRaise: true },
        seats: [MINE, OTHER],
      }),
    };
  }

  /** Somebody else's turn, with Ada still in the hand to decide in advance about. */
  function somebodyElseDeciding() {
    return { state: view({ toAct: "s2", street: "flop", seats: [MINE, OTHER] }) };
  }

  it("lights exactly one action", () => {
    renderControls(onYourTurn({ toCall: 200 }));
    expect(document.querySelectorAll(".slab")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /call 200/i })).toHaveClass("slab");
  });

  it("lights check when checking is free", () => {
    renderControls(onYourTurn({ toCall: 0 }));
    expect(screen.getByRole("button", { name: /^check$/i })).toHaveClass("slab");
  });

  it("goes busy on the press rather than dead", () => {
    renderControls(onYourTurn({ toCall: 200, busy: true }));
    const call = screen.getByRole("button", { name: /call 200/i });
    expect(call).toHaveClass("is-busy");
    expect(call).not.toBeDisabled();
  });

  it("dresses the decide-in-advance group as lamps", () => {
    renderControls(somebodyElseDeciding());
    expect(document.querySelectorAll(".lamp").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".pk__prebtn")).toHaveLength(0);
  });

  /*
   * F4 binds every main action in this file, not only the on-turn Check/Call
   * — buying in, showing cards and cashing out are each their row's sole
   * slab too, so a press on any of them has to stay pressable rather than
   * going dead while the table has not yet answered.
   */
  it("goes busy on the press rather than dead, buying in", () => {
    const table = stub();
    table.busy = true;
    const mine = seat({ id: "s1", name: "Ada", stack: 0 });
    render(
      <Actions
        table={table}
        state={view({ street: "waiting", seats: [mine] })}
        me={mine}
        intent={{ move: null, committed: null, send: vi.fn() }}
      />,
    );
    const go = screen.getByRole("button", { name: /sit down/i });
    expect(go).toHaveClass("is-busy");
    expect(go).not.toBeDisabled();
  });

  it("goes busy on the press rather than dead, showing cards", () => {
    const table = stub();
    table.busy = true;
    const mine = seat({ id: "s1", name: "Ada" });
    render(
      <Actions
        table={table}
        state={view({ canShow: true, seats: [mine] })}
        me={mine}
        intent={{ move: null, committed: null, send: vi.fn() }}
      />,
    );
    const show = screen.getByRole("button", { name: /show cards/i });
    expect(show).toHaveClass("is-busy");
    expect(show).not.toBeDisabled();
  });

  it("goes busy on the press rather than dead, cashing out", () => {
    const table = stub();
    table.busy = true;
    const mine = seat({ id: "s1", name: "Ada" });
    render(
      <Actions
        table={table}
        state={view({ street: "waiting", canTakeOff: true, seats: [mine] })}
        me={mine}
        intent={{ move: null, committed: null, send: vi.fn() }}
      />,
    );
    const cashOut = screen.getByRole("button", { name: /off the table/i });
    expect(cashOut).toHaveClass("is-busy");
    expect(cashOut).not.toBeDisabled();
  });
});

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
