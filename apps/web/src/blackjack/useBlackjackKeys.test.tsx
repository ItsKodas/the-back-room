// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableView } from "@backroom/game-blackjack";
import type { Move } from "./useIntent.js";
import { Controls } from "./Controls.js";
import { pairTurn, splitTurn, view, yourTurn } from "./fixtures.js";
import { useBlackjackKeys } from "./useBlackjackKeys.js";

const space = { key: " ", code: "Space" };

function Harness({
  state,
  move = null,
  onMove,
  onReady,
  onStake,
}: {
  state: TableView;
  move?: Move | null;
  onMove: (kind: Move) => void;
  onReady: (ready: boolean) => void;
  onStake: (amount: number) => void;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  useBlackjackKeys(root);
  return (
    <div ref={root}>
      <input aria-label="Message" />
      <textarea aria-label="Note" />
      <select aria-label="Pick">
        <option>one</option>
      </select>
      <div contentEditable suppressContentEditableWarning data-testid="editable">
        words
      </div>
      <div role="dialog" aria-label="Table">
        <button type="button">In the sheet</button>
      </div>
      <a href="#rules">Rules</a>
      <button type="button">Somebody else's key</button>
      <Controls
        state={state}
        me={state.seats[0] ?? null}
        mine={state.seats[0]?.bet ?? 0}
        chips={12_400}
        move={move}
        left={20}
        turnLeft={12}
        isHost={false}
        taunt={null}
        onStake={onStake}
        onReady={onReady}
        onDeal={() => {}}
        onMove={onMove}
      />
    </div>
  );
}

function table(state: TableView, move: Move | null = null) {
  const calls = { onMove: vi.fn(), onReady: vi.fn(), onStake: vi.fn() };
  render(<Harness state={state} move={move} {...calls} />);
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Space and the letters", () => {
  it("readies on Space while betting", () => {
    const calls = table(view());
    fireEvent.keyDown(window, space);
    expect(calls.onReady).toHaveBeenCalledWith(true);
  });

  it("hits on Space on your turn", () => {
    const calls = table(yourTurn());
    fireEvent.keyDown(window, space);
    expect(calls.onMove).toHaveBeenCalledWith("hit");
  });

  it("stands on S, doubles on D and splits on P, capitals included", () => {
    const calls = table(pairTurn());
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    fireEvent.keyDown(window, { key: "D", code: "KeyD" });
    fireEvent.keyDown(window, { key: "p", code: "KeyP" });
    expect(calls.onMove.mock.calls).toEqual([["stand"], ["double"], ["split"]]);
  });
});

describe("keys that leave the page alone", () => {
  it("do nothing in a field, a text area, a list or anything editable", () => {
    const calls = table(pairTurn());
    for (const place of [
      screen.getByRole("textbox", { name: "Message" }),
      screen.getByRole("textbox", { name: "Note" }),
      screen.getByRole("combobox", { name: "Pick" }),
      screen.getByTestId("editable"),
    ]) {
      fireEvent.keyDown(place, space);
      fireEvent.keyDown(place, { key: "s", code: "KeyS" });
    }
    expect(calls.onMove).not.toHaveBeenCalled();
  });

  it("do nothing inside a sheet", () => {
    const calls = table(pairTurn());
    fireEvent.keyDown(screen.getByRole("button", { name: "In the sheet" }), { key: "s", code: "KeyS" });
    expect(calls.onMove).not.toHaveBeenCalled();
  });

  it("leave Ctrl, Alt and Cmd to the browser", () => {
    const calls = table(pairTurn());
    fireEvent.keyDown(window, { key: "d", code: "KeyD", ctrlKey: true });
    fireEvent.keyDown(window, { key: "d", code: "KeyD", altKey: true });
    fireEvent.keyDown(window, { key: "d", code: "KeyD", metaKey: true });
    expect(calls.onMove).not.toHaveBeenCalled();
  });

  it("press once for a key held down", () => {
    const calls = table(pairTurn());
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    fireEvent.keyDown(window, { key: "s", code: "KeyS", repeat: true });
    expect(calls.onMove).toHaveBeenCalledOnce();
  });

  it("do nothing when the button the key stands for could not be pressed", () => {
    const calls = table(splitTurn());
    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    fireEvent.keyDown(window, { key: "p", code: "KeyP" });
    expect(calls.onMove).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    expect(calls.onMove).toHaveBeenCalledWith("stand");
  });

  it("do nothing while a move is still in the air", () => {
    const calls = table(yourTurn(), "hit");
    fireEvent.keyDown(window, space);
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    expect(calls.onMove).not.toHaveBeenCalled();
  });

  it("leave Space to a focused link, or a focused button that is not a chip", () => {
    const calls = table(yourTurn());
    expect(fireEvent.keyDown(screen.getByRole("link", { name: "Rules" }), space)).toBe(true);
    expect(fireEvent.keyDown(screen.getByRole("button", { name: "Somebody else's key" }), space)).toBe(true);
    expect(calls.onMove).not.toHaveBeenCalled();
  });
});

describe("a chip and the Space bar", () => {
  /*
   * Chrome reports a clicked button as :focus-visible the moment any key goes
   * down on it, so asking the browser would always say "keyboard" by the time
   * Space is read. Every element answers yes here, to prove it is not asked.
   */
  function focusVisibleEverywhere() {
    const original = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
      return selector === ":focus-visible" ? true : original.call(this, selector);
    });
  }

  it("hands Space to Ready after a chip is clicked", () => {
    const calls = table(view());
    focusVisibleEverywhere();
    const chip = screen.getByRole("radio", { name: "Bet 100" });
    fireEvent.pointerDown(chip);
    chip.focus();
    expect(fireEvent.keyDown(chip, space)).toBe(false);
    expect(calls.onReady).toHaveBeenCalledWith(true);
    expect(calls.onStake).not.toHaveBeenCalled();
  });

  it("keeps Space for a chip reached by keyboard", () => {
    const calls = table(view());
    focusVisibleEverywhere();
    const chip = screen.getByRole("radio", { name: "Bet 100" });
    chip.focus();
    expect(fireEvent.keyDown(chip, space)).toBe(true);
    expect(calls.onReady).not.toHaveBeenCalled();
  });

  it("forgets the click once focus goes somewhere else", () => {
    const calls = table(view());
    const chip = screen.getByRole("radio", { name: "Bet 100" });
    fireEvent.pointerDown(chip);
    screen.getByRole("button", { name: "Somebody else's key" }).focus();
    chip.focus();
    expect(fireEvent.keyDown(chip, space)).toBe(true);
    expect(calls.onReady).not.toHaveBeenCalled();
  });
});
