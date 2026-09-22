// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seat, view } from "./fixtures.js";
import { Seats, seatState } from "./Seats.js";

describe("a seat's state", () => {
  it("lights the one whose turn it is", () => {
    const state = view([seat()]);
    expect(seatState(seat(), state).classes).toContain("is-turn");
  });

  it("outlines your own", () => {
    const state = view([seat()], { toAct: "other" });
    expect(seatState(seat(), state).classes).toContain("is-you");
  });

  it("dims somebody out, and says so", () => {
    const state = view([seat()], { toAct: "other" });
    const out = seatState(seat({ id: "s1", out: true, dice: 0 }), state);
    expect(out.classes).toContain("is-out");
    expect(out.word).toBe("Out");
  });

  it("dims somebody gone, and says so", () => {
    const state = view([seat()], { toAct: "other" });
    expect(seatState(seat({ id: "s1", connected: false }), state).word).toBe("Gone");
  });

  it("says who is sitting the game out", () => {
    const state = view([seat()], { toAct: "other" });
    expect(seatState(seat({ id: "s1", waiting: true }), state).word).toBe("Next game");
    expect(seatState(seat({ id: "s2", short: true }), state).word).toBe("Short");
  });

  it("says who is ready, between games", () => {
    const state = view([seat()], { phase: "waiting", toAct: null });
    expect(seatState(seat({ ready: true }), state).word).toBe("Ready");
  });
});

describe("the rail", () => {
  it("draws a plate for every seat, with a pip per die", () => {
    const seats = Array.from({ length: 10 }, (_, at) =>
      seat({ id: `s${at}`, name: `Player ${at}`, dice: 5 - (at % 5) }),
    );
    const { container } = render(<Seats state={view(seats)} seatId="s0" />);
    expect(container.querySelectorAll(".ld__seat")).toHaveLength(10);
    // Five pips per plate whatever the dice: the unlit ones say what was lost.
    expect(container.querySelectorAll(".ld__seat .pip")).toHaveLength(50);
    expect(container.querySelectorAll(".ld__seat .pip--on")).toHaveLength(
      seats.reduce((sum, one) => sum + one.dice, 0),
    );
  });

  it("says a dice count to a screen reader, since the pips are decoration", () => {
    const { container } = render(<Seats state={view([seat({ dice: 3 })])} seatId="s0" />);
    expect(container.textContent).toContain("3 dice");
  });

  it("marks the names not worth their width on a phone", () => {
    const seats = [seat(), seat({ id: "s1", name: "Bram" }), seat({ id: "s2", name: "Cleo" })];
    const { container } = render(<Seats state={view(seats, { toAct: "s1" })} seatId="s0" />);
    const quiet = [...container.querySelectorAll(".ld__name--quiet")].map(
      (node) => node.textContent,
    );
    expect(quiet).toEqual(["Cleo"]);
  });
});
