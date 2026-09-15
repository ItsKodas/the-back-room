// @vitest-environment jsdom
import { bustProbability, LETTER_RULESET } from "@backroom/rules";
import type { Die } from "@backroom/rules";
import type { RoomView, SeatView, TurnView } from "@backroom/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Table } from "./Table.js";
import type { RoomActions } from "./useRoom.js";

function seat(over: Partial<SeatView>): SeatView {
  return {
    id: "me",
    name: "Koda",
    score: 0,
    onBoard: false,
    connected: true,
    isHost: false,
    isBot: false,
    signedIn: true,
    waiting: false,
    avatar: null,
    accentColor: null,
    ...over,
  };
}

function turn(over: Partial<TurnView>): TurnView {
  return {
    seatId: "me",
    rollSeq: 0,
    dice: [2, 2, 2, 6, 3],
    held: [true, true, true, false, false],
    dead: [false, false, false, false, false],
    kept: 100,
    selection: 500,
    selectionValid: true,
    nextRollCount: 2,
    bustChance: 0.44,
    phase: "selecting",
    endsAt: null,
    ...over,
  };
}

function room(over: Partial<RoomView> = {}): RoomView {
  return {
    code: "XKQ37",
    status: "playing",
    seats: [
      seat({ id: "me", name: "Koda", score: 1850, onBoard: true }),
      seat({ id: "them", name: "Mara", score: 3400, onBoard: true }),
    ],
    watching: 0,
    turn: turn({}),
    ruleset: LETTER_RULESET,
    buyIn: 0,
    pot: 0,
    winnerIds: [],
    lastEvent: null,
    ...over,
  };
}

const actions = () =>
  ({ roll: vi.fn(), toggle: vi.fn(), bank: vi.fn(), leave: vi.fn(), playAgain: vi.fn() }) as unknown as RoomActions;

function table(view: RoomView, extra: { taunt?: React.ReactNode } = {}) {
  return render(
    <Table
      room={view}
      seatId="me"
      actions={actions()}
      heldLocally={null}
      pendingRoll={null}
      taunt={extra.taunt}
    />,
  );
}

describe("the Greed table", () => {
  it("prints the chance of busting on Roll, for the dice about to be thrown", () => {
    table(room());
    const roll = screen.getByRole("button", { name: /^Roll 2/ });
    expect(roll.textContent).toContain(`${Math.round(bustProbability(2, LETTER_RULESET) * 100)}% bust`);
  });

  it("puts a ghost on the roller's lane where banking now would take them", () => {
    const { container } = table(room());
    const ghost = container.querySelector<HTMLElement>(".lane--turn .lane__ghost");
    // 1,850 on the board plus 100 set aside and 500 picked up, of 5,000.
    expect(ghost?.style.getPropertyValue("--p")).toBe(`${((1850 + 600) / 5000) * 100}%`);
  });

  it("draws no ghost when the bank would not get a player on the board", () => {
    const { container } = table(
      room({
        seats: [seat({ id: "me", score: 0, onBoard: false }), seat({ id: "them", name: "Mara" })],
        turn: turn({ dice: [6, 3, 4], held: [true, false, false], dead: [false, false, false], kept: 0, selection: 100 }),
      }),
    );
    expect(container.querySelector(".lane__ghost")).toBeNull();
  });

  it("prints every letter in the gem its face is named for", () => {
    const dice: Die[] = [1, 2, 3, 4, 5, 6];
    const { container } = table(
      room({ turn: turn({ dice, held: dice.map(() => false), dead: dice.map(() => false), selection: 0, selectionValid: false }) }),
    );
    const tones = [...container.querySelectorAll(".gt__dice .die__letter")].map((letter) =>
      [...letter.classList].find((name) => name.startsWith("die__letter--")),
    );
    expect(tones).toEqual([
      "die__letter--silver",
      "die__letter--gold",
      "die__letter--ruby",
      "die__letter--ebony",
      "die__letter--emerald",
      "die__letter--diamond",
    ]);
  });

  it("lights the row on the card that the dice picked up land on", () => {
    const { container } = table(room());
    const lit = [...container.querySelectorAll(".gt__card .card__row--lit")].map((row) => row.textContent);
    expect(lit).toEqual(["GGGGold500"]);
  });

  describe("the space bar", () => {
    const space = { key: " ", code: "Space" };

    function withActions(view: RoomView) {
      const moves = actions();
      render(
        <>
          <input aria-label="Message" />
          <Table room={view} seatId="me" actions={moves} heldLocally={null} pendingRoll={null} />
        </>,
      );
      return moves;
    }

    it("rolls the dice Roll would throw", () => {
      const moves = withActions(room());
      fireEvent.keyDown(window, space);
      expect(moves.roll).toHaveBeenCalledWith(2);
    });

    it("rolls rather than toggling again when a die has the focus", () => {
      const moves = withActions(room());
      const die = screen.getAllByRole("button", { name: /^Die showing/ })[0] as HTMLElement;
      fireEvent.pointerDown(die);
      fireEvent.keyDown(die, space);
      expect(moves.roll).toHaveBeenCalledOnce();
      expect(moves.toggle).not.toHaveBeenCalled();
    });

    it("leaves a space typed into a field alone", () => {
      const moves = withActions(room());
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), space);
      expect(moves.roll).not.toHaveBeenCalled();
    });

    it("does nothing when Roll could not be pressed either", () => {
      const moves = withActions(room({ turn: turn({ seatId: "them" }) }));
      fireEvent.keyDown(window, space);
      const invalid = withActions(
        room({ turn: turn({ held: [false, false, false, false, true], selection: 0, selectionValid: false }) }),
      );
      fireEvent.keyDown(window, space);
      expect(moves.roll).not.toHaveBeenCalled();
      expect(invalid.roll).not.toHaveBeenCalled();
    });

    it("rolls after a click on a die, though the key press makes the browser call that keyboard focus", () => {
      /*
       * Chrome gives a clicked button :focus-visible the moment any key goes
       * down on it, so asking the browser whether focus came from a keyboard
       * always said yes by the time space was read — and the die dropped back
       * down instead of the dice being thrown.
       */
      const moves = withActions(room());
      const die = screen.getAllByRole("button", { name: /^Die showing/ })[0] as HTMLElement;
      fireEvent.pointerDown(die);
      die.focus();
      vi.spyOn(die, "matches").mockImplementation((selector: string) =>
        selector === ":focus-visible" ? true : Element.prototype.matches.call(die, selector),
      );
      fireEvent.keyDown(die, space);
      expect(moves.roll).toHaveBeenCalledOnce();
    });

    const ctrl = { key: "Control", code: "ControlLeft" };

    it("banks on Ctrl, once it is let go, when Bank itself could be pressed", () => {
      const moves = withActions(room());
      fireEvent.keyDown(window, { ...ctrl, ctrlKey: true });
      expect(moves.bank).not.toHaveBeenCalled();
      fireEvent.keyUp(window, ctrl);
      expect(moves.bank).toHaveBeenCalledOnce();
      expect(moves.roll).not.toHaveBeenCalled();
    });

    it("leaves Ctrl to a shortcut when another key goes down with it", () => {
      const moves = withActions(room());
      fireEvent.keyDown(window, { ...ctrl, ctrlKey: true });
      fireEvent.keyDown(window, { key: "c", code: "KeyC", ctrlKey: true });
      fireEvent.keyUp(window, ctrl);
      expect(moves.bank).not.toHaveBeenCalled();
    });

    it("does not bank on Ctrl with nothing worth banking picked up", () => {
      const moves = withActions(
        room({ turn: turn({ held: [false, false, false, false, true], selection: 0, selectionValid: false }) }),
      );
      fireEvent.keyDown(window, { ...ctrl, ctrlKey: true });
      fireEvent.keyUp(window, ctrl);
      expect(moves.bank).not.toHaveBeenCalled();
    });

    it("leaves a die reached by keyboard to its own space", () => {
      const moves = withActions(room());
      const die = screen.getAllByRole("button", { name: /^Die showing/ })[0] as HTMLElement;
      // Reached by Tab: focus with no pointer before it.
      die.focus();
      fireEvent.keyDown(die, space);
      expect(moves.roll).not.toHaveBeenCalled();
    });

    it("does not roll twice for a key held down", () => {
      const moves = withActions(room());
      fireEvent.keyDown(window, space);
      fireEvent.keyDown(window, { ...space, repeat: true });
      expect(moves.roll).toHaveBeenCalledOnce();
    });
  });

  it("offers the taunt only while somebody else has the dice", () => {
    const { unmount } = table(room(), { taunt: <button type="button">Taunt</button> });
    expect(screen.queryByRole("button", { name: "Taunt" })).toBeNull();
    unmount();

    table(room({ turn: turn({ seatId: "them" }) }), { taunt: <button type="button">Taunt</button> });
    expect(screen.getByRole("button", { name: "Taunt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mara's turn/ })).toHaveProperty("disabled", true);
  });
});
