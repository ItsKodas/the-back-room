// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seat, view } from "./fixtures.js";
import { Board } from "./Board.js";

const rows = [
  {
    round: 1,
    bid: { count: 4, face: 5 as const },
    call: "liar" as const,
    caller: "s1",
    count: 6,
    right: true,
    losers: ["s1"],
  },
  {
    round: 2,
    bid: { count: 3, face: 2 as const },
    call: "exact" as const,
    caller: "s0",
    count: 3,
    right: true,
    losers: ["s1"],
  },
];

describe("the board", () => {
  it("says nothing before anything has happened", () => {
    render(<Board state={view([seat()], { board: [] })} />);
    expect(screen.getByText(/No rounds yet/)).toBeInTheDocument();
  });

  it("keeps a row per round, with the bid, the count and who paid", () => {
    const state = view([seat({ id: "s0", name: "Ada" }), seat({ id: "s1", name: "Bram" })], {
      board: rows,
    });
    const { container } = render(<Board state={state} />);
    expect(container.querySelectorAll(".ld__row")).toHaveLength(2);
    expect(screen.getByText(/four fives/)).toBeInTheDocument();
    expect(container.textContent).toContain("Bram");
  });

  it("marks an exact apart from a liar call", () => {
    const state = view([seat({ id: "s0" }), seat({ id: "s1" })], { board: rows });
    const { container } = render(<Board state={state} />);
    expect(container.querySelectorAll(".ld__row--exact")).toHaveLength(1);
  });
});
