// @vitest-environment jsdom
import type { Roll, SeatView, TableView } from "@backroom/game-craps";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { Felt } from "./Craps.js";

afterEach(cleanup);

/**
 * The felt, given a table.
 *
 * Rendered against a real view rather than checked piecemeal, because the
 * mistakes worth catching here only exist once the two are put together: a
 * felt reading a field the view has not got, a control offered to somebody who
 * may not press it, or the result on screen before the dice have stopped.
 */

const seat = (over: Partial<SeatView> & { id: string; name: string }): SeatView => ({
  connected: true,
  waiting: false,
  isBot: false,
  avatar: null,
  accentColor: null,
  staked: 0,
  paid: null,
  purse: null,
  shooter: false,
  works: false,
  ...over,
});

const you = seat({ id: "s1", name: "Ada" });

const view = (over: Partial<TableView> = {}): TableView => ({
  code: "ABCDE",
  phase: "betting",
  // Ten seconds into a thirty-second window: past the floor the shooter has
  // to clear before the dice are theirs, and well clear of last call.
  deadline: Date.now() + 20_000,
  lastCall: false,
  point: null,
  dice: null,
  history: [],
  offByBank: [],
  placed: [],
  paid: [],
  winners: [],
  canRepeat: false,
  bank: 1_000_000,
  shooterId: "s1",
  canRoll: false,
  seats: [you],
  you,
  forFun: false,
  hostId: "s1",
  watching: 0,
  lastEvent: null,
  window: 30_000,
  ...over,
});

const stub = () => {
  const act = vi.fn();
  return {
    table: { act, busy: false, error: null, errorKey: 0 } as unknown as TableSocketHook<TableView>,
    act,
  };
};

/** The line above the felt, which is where the table says what it is doing. */
const standing = (container: HTMLElement) =>
  container.querySelector(".cr__standing")?.textContent ?? "";

describe("the craps table", () => {
  it("says the bank is empty before anybody presses anything", () => {
    /*
     * This table pays from chips other players staked, and a new one has none
     * until an admin floats it — so "nothing can be bet here" is a fact about
     * the table, not a refusal of your press, and it belongs on screen while
     * you are still deciding rather than after you have tried.
     */
    const { container } = render(
      <Felt table={stub().table} state={view({ bank: 0 })} seatId="s1" />,
    );
    expect(standing(container)).toMatch(/nothing to play for yet/i);
  });

  it("says whether the point is off or on, and which number", () => {
    // Every bet on this cloth resolves differently depending on the answer,
    // so it is said in words as well as sat on by the puck.
    const off = render(<Felt table={stub().table} state={view()} seatId="s1" />);
    expect(standing(off.container)).toMatch(/coming out/i);
    expect(screen.getByLabelText("The puck is off")).toBeTruthy();
    cleanup();

    const on = render(<Felt table={stub().table} state={view({ point: 6 })} seatId="s1" />);
    expect(standing(on.container)).toMatch(/point is 6/i);
    expect(screen.getByLabelText("The puck is on 6")).toBeTruthy();
  });

  it("offers the dice to the shooter and nobody else", () => {
    const shooter = seat({ id: "s1", name: "Ada", shooter: true });
    render(
      <Felt
        table={stub().table}
        state={view({ you: shooter, seats: [shooter], canRoll: true })}
        seatId="s1"
      />,
    );
    const roll = screen.getByRole("button", { name: "Throw the dice" }) as HTMLButtonElement;
    expect(roll.disabled).toBe(false);
    cleanup();

    // Somebody else has them. Not a disabled button but no button at all:
    // the dice are never this seat's to press.
    const other = seat({ id: "s1", name: "Ada", shooter: false });
    render(
      <Felt
        table={stub().table}
        state={view({ you: other, seats: [other], shooterId: "s2", canRoll: false })}
        seatId="s1"
      />,
    );
    expect(screen.queryByRole("button", { name: "Throw the dice" })).toBeNull();
  });

  it("says what the table is doing and how long it has to do it in", () => {
    // A betting window with no clock on it is a window that shuts while
    // somebody is still deciding.
    const open = render(<Felt table={stub().table} state={view()} seatId="s1" />);
    expect(standing(open.container)).toContain("Place your bets");
    expect(standing(open.container)).toMatch(/\d+s/);
    cleanup();

    const last = render(
      <Felt table={stub().table} state={view({ lastCall: true })} seatId="s1" />,
    );
    expect(standing(last.container)).toContain("Last call");
    cleanup();

    const out = render(
      <Felt
        table={stub().table}
        state={view({ phase: "rolling", dice: [3, 4] as Roll, deadline: null })}
        seatId="s1"
      />,
    );
    expect(standing(out.container)).toMatch(/dice are out/i);
  });

  it("says which bets the bank could not carry, in words", () => {
    /*
     * Nothing was lost — an off bet neither wins nor loses — but a stack that
     * merely dimmed would be a fact somebody has to already be looking at to
     * find. This is the difference between a rule of the game and software
     * that quietly ignored you.
     */
    const { container } = render(
      <Felt
        table={stub().table}
        state={view({
          phase: "rolling",
          dice: [3, 4] as Roll,
          deadline: null,
          offByBank: ["place:6", "hard:8"],
          placed: [
            { seatId: "s1", spotId: "place:6", chips: 30, off: true },
            { seatId: "s1", spotId: "hard:8", chips: 30, off: true },
          ],
        })}
        seatId="s1"
      />,
    );
    expect(standing(container)).toContain("Place 6");
    expect(standing(container)).toContain("Hard 8");
  });

  it("greys out a spot the bank cannot cover, and says why when pressed", () => {
    /*
     * The cap is the server's and it refuses in words, but the felt does not
     * send a chip it already knows is too big — which would leave a press
     * that did nothing and said nothing either.
     */
    const { table, act } = stub();
    const { container } = render(<Felt table={table} state={view({ bank: 0 })} seatId="s1" />);
    const field = screen.getByRole("button", { name: "Field" });
    expect(field).toHaveAttribute("data-full", "true");

    fireEvent.click(field);
    expect(act).not.toHaveBeenCalled();
    expect(standing(container)).toMatch(/bank/i);
  });

  it("lays odds behind rather than on when the odds toggle is lit", () => {
    const { table, act } = stub();
    render(
      <Felt
        table={table}
        state={view({
          point: 6,
          placed: [{ seatId: "s1", spotId: "pass", chips: 30, off: false }],
        })}
        seatId="s1"
      />,
    );

    // Off, a press on the line is another bet on the line.
    fireEvent.click(screen.getByRole("button", { name: "Pass Line" }));
    expect(act).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "place", spotId: "pass" }),
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Lay odds behind a bet instead of putting a new one on" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pass Line" }));
    expect(act).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "place", spotId: "odds:pass" }),
    );
  });

  it("works the numbers through a come-out when the seat asks it to", () => {
    const { table, act } = stub();
    render(<Felt table={table} state={view()} seatId="s1" />);
    const working = screen.getByRole("switch", {
      name: "Work your numbers through the come-out roll",
    }) as HTMLButtonElement;
    expect(working.disabled).toBe(false);
    fireEvent.click(working);
    expect(act).toHaveBeenCalledWith({ type: "working", on: true });
  });

  it("will not offer to work the numbers once the dice are out", () => {
    /*
     * The server refuses `working` outside a betting window, and the table
     * reverts every seat's numbers at each fresh come-out anyway. Hiding a
     * control is a courtesy and refusing the message is the rule — but the
     * two should agree, or the felt offers something it knows will be thrown
     * back.
     */
    render(
      <Felt
        table={stub().table}
        state={view({ phase: "rolling", dice: [3, 4] as Roll, deadline: null })}
        seatId="s1"
      />,
    );
    const working = screen.getByRole("switch", {
      name: "Work your numbers through the come-out roll",
    }) as HTMLButtonElement;
    expect(working.disabled).toBe(true);
  });

  it("puts the chip on the cloth before the server has answered", () => {
    /*
     * The whole of the bargain, on a real render. A stake is a number this
     * player chose, so there is nothing to invent and nothing to wait for —
     * and on a bad connection this is the difference between a table and a
     * button that appears broken.
     */
    const { table } = stub();
    const { container } = render(<Felt table={table} state={view()} seatId="s1" />);
    expect(container.querySelector(".cr__stack")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Field" }));
    // The view has not moved: this is the felt's own chip, not the table's.
    expect(container.querySelector(".cr__stack")).not.toBeNull();
  });

  it("keeps the result off the cloth until the dice have stopped", () => {
    /*
     * The view carries the dice all through the throw, because the felt needs
     * them to settle onto the real faces. A felt that passed them straight
     * through would light the winning boxes several seconds early.
     */
    const rolling = render(
      <Felt
        table={stub().table}
        state={view({ phase: "rolling", dice: [3, 4] as Roll, deadline: null })}
        seatId="s1"
      />,
    );
    expect(rolling.container.querySelector("[data-lit]")).toBeNull();
    cleanup();

    const settled = render(
      <Felt
        table={stub().table}
        state={view({
          phase: "settling",
          dice: [3, 4] as Roll,
          history: [{ dice: [3, 4] as Roll, point: null, what: "set" }],
        })}
        seatId="s1"
      />,
    );
    // Seven, on a come-out: the pass line came in.
    expect(settled.container.querySelector("[data-lit]")).not.toBeNull();
  });

  it("offers a watcher no controls at all", () => {
    render(<Felt table={stub().table} state={view({ you: null })} seatId={null} />);
    expect(screen.queryByRole("button", { name: /Take back everything/ })).toBeNull();
    expect(screen.getByText(/Take a seat to play/)).toBeTruthy();
  });
});
