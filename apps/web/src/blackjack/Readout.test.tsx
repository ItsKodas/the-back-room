// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { hand, seat, settledHand, splitTurn, theirTurn, view, yourTurn } from "./fixtures.js";
import type { ReadoutInput } from "./Readout.js";
import { Readout, readoutFor } from "./Readout.js";

const input = (over: Partial<ReadoutInput>): ReadoutInput => ({
  state: view(),
  seatId: "a",
  mine: 0,
  chips: 12_400,
  move: null,
  left: null,
  turnLeft: null,
  ...over,
});

describe("the readout while betting", () => {
  it("makes your stake the figure, in gold, with the balance and the table's limits beside it", () => {
    const model = readoutFor(input({ mine: 500, left: 14 }));
    expect(model.label).toBe("Your stake");
    expect(model.figure).toBe("500");
    expect(model.tone).toBe("chips");
    expect(model.stats).toEqual([
      { term: "Balance", value: "12,400", chips: true },
      { term: "Table", value: "100–10,000", chips: false },
      { term: "Cards out", value: "0:14", chips: false },
    ]);
    expect(model.clock?.chips).toBe(true);
    expect(model.clock?.part).toBeCloseTo(0.467, 3);
  });

  it("says last call when it comes", () => {
    const model = readoutFor(input({ mine: 500, left: 3 }));
    expect(model.stats.at(-1)).toEqual({ term: "Last call", value: "0:03", chips: false });
  });

  it("totals what is on the felt for a watcher, with the table's limits beside it", () => {
    const state = view({ seats: [seat("a", "Ada", { bet: 300 }), seat("b", "Bo", { bet: 200 })] });
    const model = readoutFor(input({ state, seatId: null, left: 14 }));
    expect(model.label).toBe("On the felt");
    expect(model.figure).toBe("500");
    expect(model.tone).toBe("chips");
    expect(model.stats).toEqual([
      { term: "Table", value: "100–10,000", chips: false },
      { term: "Cards out", value: "0:14", chips: false },
    ]);
  });

  it("shows the purse at a for-fun table", () => {
    const state = view({ forFun: true, seats: [seat("a", "Ada", { purse: 4_500 }), seat("b", "Bo")] });
    expect(readoutFor(input({ state })).stats[0]).toEqual({ term: "Purse", value: "4,500", chips: true });
  });
});

describe("the readout while a hand is played", () => {
  it("makes your total the figure on your turn, with what is on it and what the dealer shows", () => {
    const model = readoutFor(input({ state: yourTurn(), turnLeft: 12 }));
    expect(model.label).toBe("Your hand");
    expect(model.figure).toBe("16");
    expect(model.tone).toBe("plain");
    expect(model.note).toBeNull();
    expect(model.stats).toEqual([
      { term: "On it", value: "500", chips: true },
      { term: "Dealer shows", value: "10", chips: false },
      { term: "You have", value: "0:12", chips: false },
    ]);
    expect(model.clock).toEqual({ part: 0.6, chips: false });
  });

  it("says soft, and says a card is coming while one is", () => {
    const soft = yourTurn({ hands: [hand({ bet: 500, total: 17, soft: true })] });
    expect(readoutFor(input({ state: soft })).note).toBe("soft");
    expect(readoutFor(input({ state: yourTurn(), move: "hit" })).note).toBe("a card is coming");
  });

  it("follows the hand being played after a split, and that hand's stake", () => {
    const model = readoutFor(input({ state: splitTurn() }));
    expect(model.label).toBe("Hand 2 of 2");
    expect(model.figure).toBe("20");
    expect(model.stats[0]).toEqual({ term: "On this hand", value: "500", chips: true });
  });

  it("follows somebody else's hand on their turn, under their name", () => {
    const model = readoutFor(input({ state: theirTurn(), turnLeft: 9 }));
    expect(model.label).toBe("Bo's hand");
    expect(model.figure).toBe("14");
    expect(model.stats).toEqual([
      { term: "On it", value: "1,000", chips: true },
      { term: "Dealer shows", value: "10", chips: false },
      { term: "Bo has", value: "0:09", chips: false },
    ]);
  });
});

describe("the readout once the hand is over", () => {
  it("gives the net in the good colour, and what came back in gold", () => {
    const model = readoutFor(input({ state: settledHand(), left: 5 }));
    expect(model.label).toBe("This hand");
    expect(model.figure).toBe("+750");
    expect(model.tone).toBe("good");
    expect(model.note).toBe("3 to 2");
    expect(model.stats).toEqual([
      { term: "Back", value: "1,250", chips: true },
      { term: "Dealer", value: "19", chips: false },
      { term: "Next hand", value: "0:05", chips: false },
    ]);
  });

  it("gives a loss in the bad colour", () => {
    const model = readoutFor(input({ state: settledHand(), seatId: "b" }));
    expect(model.figure).toBe("−1,000");
    expect(model.tone).toBe("bad");
  });

  it("calls a stake that came back a push, and a hand sat out what it was", () => {
    const push = view({
      phase: "settled",
      seats: [seat("a", "Ada", { bet: 500, hands: [hand({ bet: 500, outcome: "push", returned: 500, done: true })] })],
    });
    expect(readoutFor(input({ state: push }))).toMatchObject({ figure: "Push", tone: "plain" });
    const out = view({ phase: "settled", seats: [seat("a", "Ada")] });
    expect(readoutFor(input({ state: out }))).toMatchObject({ figure: "Sat out", tone: "plain" });
  });

  it("shows the dealer's total to a watcher, with no stake to speak of", () => {
    const model = readoutFor(input({ state: settledHand(), seatId: null, left: 5 }));
    expect(model.label).toBe("Dealer has");
    expect(model.figure).toBe("19");
    expect(model.tone).toBe("plain");
    expect(model.stats).toEqual([{ term: "Next hand", value: "0:05", chips: false }]);
  });
});

describe("the readout on screen", () => {
  it("lights only a chips figure gold, and drains its clock along the top", () => {
    const { container } = render(<Readout model={readoutFor(input({ mine: 500, left: 14 }))} />);
    expect(container.querySelector(".bj__figure--chips")?.textContent).toBe("500");
    expect(container.querySelectorAll(".bj__gold")).toHaveLength(1);
    const clock = container.querySelector(".bj__clock");
    expect(clock?.classList.contains("bj__clock--chips")).toBe(true);
    expect(clock?.getAttribute("style")).toContain("--t: 47%");
  });

  it("colours nothing on a total", () => {
    const { container } = render(<Readout model={readoutFor(input({ state: yourTurn(), turnLeft: 12 }))} />);
    expect(container.querySelector(".bj__figure--plain")?.textContent).toBe("16");
    expect(container.querySelector(".bj__clock--chips")).toBeNull();
  });
});
