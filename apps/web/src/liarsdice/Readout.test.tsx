// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seat, view } from "./fixtures.js";
import { Readout, readoutFor } from "./Readout.js";

describe("what the readout says", () => {
  it("says nothing has been bid yet, with the pot beside it", () => {
    const model = readoutFor({ state: view([seat()], { bid: null }), seatId: "s0", turnLeft: null });
    expect(model.figure).toBe("No bid yet");
    expect(model.stats.some((stat) => stat.term === "Pot" && stat.chips)).toBe(true);
  });

  it("says the standing bid in words, and who said it", () => {
    const state = view([seat(), seat({ id: "s1", name: "Bram" })], {
      bid: { count: 4, face: 5 },
      bidder: "s1",
      toAct: "s0",
    });
    const model = readoutFor({ state, seatId: "s0", turnLeft: null });
    expect(model.figure).toBe("four fives");
    expect(model.note).toContain("Bram");
  });

  it("counts the dice still on the table", () => {
    const model = readoutFor({ state: view([seat()], { total: 27 }), seatId: "s0", turnLeft: null });
    expect(model.stats.some((stat) => stat.term === "Dice" && stat.value === "27")).toBe(true);
  });

  it("drains the clock as a fraction of a turn", () => {
    const state = view([seat()], { turnMs: 30_000 });
    expect(readoutFor({ state, seatId: "s0", turnLeft: 15 }).clock).toBeCloseTo(0.5, 5);
    expect(readoutFor({ state, seatId: "s0", turnLeft: 0 }).clock).toBe(0);
    expect(readoutFor({ state, seatId: "s0", turnLeft: null }).clock).toBe(null);
  });

  it("says the count and who paid, once a round is revealed", () => {
    const state = view([seat(), seat({ id: "s1", name: "Bram" })], {
      bid: { count: 4, face: 5 },
      bidder: "s0",
      toAct: null,
      resolution: {
        call: "liar",
        caller: "s1",
        bid: { count: 4, face: 5 },
        bidder: "s0",
        count: 6,
        right: true,
        losers: ["s1"],
      },
    });
    const model = readoutFor({ state, seatId: "s0", turnLeft: null });
    expect(model.figure).toBe("6");
    expect(model.label).toContain("fives");
    expect(model.tone).toBe("good");
    expect(model.note).toContain("Bram");
  });

  it("says who won once the game is over", () => {
    const state = view([seat()], { phase: "over", winnerIds: ["s0"], toAct: null });
    expect(readoutFor({ state, seatId: "s0", turnLeft: null }).figure).toContain("Ada");
  });

  it("draws the clock it was given", () => {
    const model = readoutFor({ state: view([seat()], { turnMs: 30_000 }), seatId: "s0", turnLeft: 15 });
    const { container } = render(<Readout model={model} />);
    expect(container.querySelector<HTMLElement>(".ld__clock")?.style.transform).toContain("scaleX(0.5)");
  });
});
