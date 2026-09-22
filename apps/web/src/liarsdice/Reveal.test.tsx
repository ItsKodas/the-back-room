// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seat, view } from "./fixtures.js";
import { Reveal } from "./Reveal.js";

const revealed = () =>
  view(
    [
      seat({ id: "s0", name: "Ada", dice: 3, hand: [5, 5, 2] }),
      seat({ id: "s1", name: "Bram", dice: 3, hand: [1, 6, 6] }),
    ],
    {
      toAct: null,
      bid: { count: 3, face: 5 },
      bidder: "s0",
      resolution: {
        call: "liar",
        caller: "s1",
        bid: { count: 3, face: 5 },
        bidder: "s0",
        count: 3,
        right: true,
        losers: ["s1"],
      },
    },
  );

describe("the reveal", () => {
  it("shows nothing until a round is called", () => {
    const { container } = render(<Reveal state={view([seat()])} />);
    expect(container.firstChild).toBe(null);
  });

  it("turns every hand up, named", () => {
    render(<Reveal state={revealed()} />);
    expect(screen.getByLabelText("Ada's dice")).toBeInTheDocument();
    expect(screen.getByLabelText("Bram's dice")).toBeInTheDocument();
  });

  it("lights the dice the count was about, wilds included", () => {
    const { container } = render(<Reveal state={revealed()} />);
    // Ada's two fives and Bram's one.
    expect(container.querySelectorAll(".ld-die--matched")).toHaveLength(3);
  });

  it("says the count against the bid", () => {
    render(<Reveal state={revealed()} />);
    expect(screen.getByText(/three fives/)).toBeInTheDocument();
    expect(screen.getByText("3", { selector: ".ld__tally-count" })).toBeInTheDocument();
  });

  it("marks who lost a die", () => {
    const { container } = render(<Reveal state={revealed()} />);
    const losing = container.querySelector(".ld__shown.is-loser");
    expect(losing?.textContent).toContain("Bram");
  });
});
