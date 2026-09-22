// @vitest-environment jsdom
import type { SeatView, TableView } from "@backroom/game-poker";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnTurn } from "./Amount.js";
import { Actions } from "./Controls.js";
import { seat, stub, view } from "./fixtures.js";
import type { Move } from "./useIntent.js";

describe("what you are offered", () => {
  const acting = (own: TableView["you"], me: Partial<SeatView> = {}) => {
    const table = stub();
    const mine = seat({ id: "s1", name: "Ada", ...me });
    render(
      <Actions
        table={table}
        state={view({ toAct: "s1", you: own, seats: [mine, seat({ id: "s2", name: "Bram" })] })}
        me={mine}
        intent={{ move: null, committed: null, send: vi.fn() }}
      />,
    );
    return table;
  };

  it("offers a check when nothing is owed, and a call when something is", () => {
    acting({ toCall: 0, minRaiseTo: 40, maxRaiseTo: 2_000, canRaise: true });
    expect(screen.getByRole("button", { name: "Check" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Call/ })).toBeNull();
  });

  it("says what a call costs rather than what it comes to", () => {
    // The number a player needs is what leaves their stack, not the total they
    // will have put in — those differ every time they have already bet.
    acting({ toCall: 80, minRaiseTo: 200, maxRaiseTo: 2_000, canRaise: true }, { committed: 20 });
    expect(screen.getByRole("button", { name: "Call 80" })).toBeTruthy();
  });

  it("takes the slider's ends from the table rather than working them out", () => {
    /*
     * The smallest legal raise depends on the size of the last one, which is
     * nowhere in the view. A felt that guessed it would spend half the slider
     * on amounts the table refuses.
     */
    acting({ toCall: 100, minRaiseTo: 400, maxRaiseTo: 2_000, canRaise: true });
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.min).toBe("400");
    expect(slider.max).toBe("2000");
  });

  it("offers no raise to somebody who cannot cover one", () => {
    acting({ toCall: 100, minRaiseTo: 400, maxRaiseTo: 2_000, canRaise: false });
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("button", { name: /Raise/ })).toBeNull();
  });

  it("calls all in rather than for more than is there", () => {
    // Owing more than you have is not a call, and sending one would be
    // refused. The button says what pressing it actually does.
    acting({ toCall: 900, minRaiseTo: 1_000, maxRaiseTo: 500, canRaise: false }, { stack: 500 });
    expect(screen.getByRole("button", { name: "All in 500" })).toBeTruthy();
  });

  it("reads the two-line buttons as words with spaces in them", () => {
    /*
     * The figure sits under the word, and two spans with nothing between them
     * give an accessible name of "Call80" — which is what a screen reader says
     * out loud. The label is written once rather than left to how the markup
     * happens to sit, so what it looks like and what it reads as cannot drift.
     */
    acting({ toCall: 80, minRaiseTo: 200, maxRaiseTo: 2_000, canRaise: true }, { committed: 20 });
    expect(screen.getByRole("button", { name: "Call 80" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Raise to 200" })).toBeTruthy();
  });

  it("lights the call, never the raise beside it", () => {
    /*
     * F2 (the building's fittings spec) settles this the other way from how
     * this table used to draw it: exactly one lit thing per state, so there
     * is never a question which button is the obvious one. Raising is a
     * second decision on top of the first, so it stays a plain key even
     * though it sits right beside the slab.
     */
    acting({ toCall: 80, minRaiseTo: 200, maxRaiseTo: 2_000, canRaise: true }, { committed: 20 });
    const call = screen.getByRole("button", { name: "Call 80" });
    const raise = screen.getByRole("button", { name: "Raise to 200" });
    expect(call).toHaveClass("slab");
    expect(raise).toHaveClass("key");
    expect(document.querySelectorAll(".slab")).toHaveLength(1);
  });
});

describe("a raise you can type", () => {
  /*
   * `@testing-library/user-event` is not a dependency of this repo (checked:
   * absent from every package.json and node_modules) — Slots.test.tsx drives
   * its own typed box with `fireEvent`, so this follows that idiom rather
   * than adding a new package for one file.
   */
  const renderAmount = ({
    minRaiseTo,
    maxRaiseTo,
    toCall = 0,
    onAct = vi.fn(),
  }: {
    minRaiseTo: number;
    maxRaiseTo: number;
    toCall?: number;
    onAct?: (kind: Move, to: number, action: Record<string, unknown>) => void;
  }) => {
    const you: NonNullable<TableView["you"]> = { toCall, minRaiseTo, maxRaiseTo, canRaise: true, hand: null };
    const me = seat({ id: "s1", name: "Ada" });
    render(<OnTurn you={you} me={me} pot={30} blind={20} busy={false} onAct={onAct} />);
  };

  it("shows what is typed as it is typed", () => {
    renderAmount({ minRaiseTo: 200, maxRaiseTo: 4_000 });
    const box = screen.getByLabelText(/how much/i);
    fireEvent.change(box, { target: { value: "750" } });
    expect(box).toHaveValue("750");
  });

  it("holds a typed figure over the cap to the cap, on commit", () => {
    const onAct = vi.fn();
    renderAmount({ minRaiseTo: 200, maxRaiseTo: 4_000, onAct });
    const box = screen.getByLabelText(/how much/i);
    fireEvent.change(box, { target: { value: "99999" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box).toHaveValue("4,000");
  });

  it("keeps what was there when nothing is typed", () => {
    renderAmount({ minRaiseTo: 200, maxRaiseTo: 4_000 });
    const box = screen.getByLabelText(/how much/i);
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);
    expect(box).toHaveValue("200");
  });

  it("never sends on a keystroke", () => {
    const onAct = vi.fn();
    renderAmount({ minRaiseTo: 200, maxRaiseTo: 4_000, onAct });
    const box = screen.getByLabelText(/how much/i);
    // The figure is the player's, so it moves at once; the chips are the table's.
    fireEvent.change(box, { target: { value: "7" } });
    expect(onAct).not.toHaveBeenCalled();
  });

  it("holds a typed figure under the minimum up to the minimum, on commit, and says so", () => {
    // The case a player hits most often: typing a small number because they
    // do not yet know the minimum raise.
    renderAmount({ minRaiseTo: 200, maxRaiseTo: 4_000 });
    const box = screen.getByLabelText(/how much/i);
    fireEvent.change(box, { target: { value: "5" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box).toHaveValue("200");
    expect(screen.getByText("Held to the least you can bet, 200.")).toBeTruthy();
  });
});
