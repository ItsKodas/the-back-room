// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seat, view } from "./fixtures.js";
import { Reveal } from "./Reveal.js";

const revealed = () =>
  view(
    [
      seat({ id: "s0", name: "Ada", dice: 3, hand: [5, 5, 2] }),
      // Bram calls and loses this round, so by the time this view is built
      // Game.call has already taken his die: dice is one lower than the
      // hand he was actually judged on. That gap between dice and hand is
      // the real shape of a reveal window, not a fixture quirk — a fixture
      // where the two agree can't tell Reveal reading `hand` apart from one
      // reading `dice`.
      seat({ id: "s1", name: "Bram", dice: 2, hand: [1, 6, 6] }),
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

  it("still shows a seat this very call knocked out, whole hand and all", () => {
    // Bram entered this round with three dice, was judged on all three, and
    // this call took his last one — dice is 0, but the hand that put him
    // out is the hand the felt has to show. A reveal that filters seats by
    // `dice` instead of `hand` would drop the very player it just decided,
    // which would mean the felt never showed the hand that put somebody out.
    const state = view(
      [
        seat({ id: "s0", name: "Ada", dice: 3, hand: [5, 5, 2] }),
        seat({ id: "s1", name: "Bram", dice: 0, hand: [1, 6, 6] }),
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
    render(<Reveal state={state} />);
    const bram = screen.getByLabelText("Bram's dice");
    expect(bram.querySelectorAll(".ld-die")).toHaveLength(3);
  });
});
