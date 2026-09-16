// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { hand, pairTurn, seat, settledHand, view, yourTurn } from "./fixtures.js";
import { HowItPays, paysFor } from "./HowItPays.js";

describe("what the rules card lights", () => {
  it("lights Double on your turn when you can double, with its price", () => {
    expect(paysFor(yourTurn(), "a", 12_400)).toEqual({ lit: ["double"], double: 500, split: null });
  });

  it("lights Split as well on a pair", () => {
    expect(paysFor(pairTurn(), "a", 12_400)).toEqual({ lit: ["double", "split"], double: 500, split: 500 });
  });

  it("lights nothing on somebody else's turn", () => {
    expect(paysFor(yourTurn(), "b", 12_400).lit).toEqual([]);
  });

  it("lights what each of your hands was paid at, once it is over", () => {
    expect(paysFor(settledHand(), "a", 12_400).lit).toEqual(["blackjack"]);
    const split = view({
      phase: "settled",
      seats: [
        seat("a", "Ada", {
          bet: 1_000,
          hands: [
            hand({ bet: 500, outcome: "won", returned: 1_000, done: true }),
            hand({ bet: 500, outcome: "push", returned: 500, done: true }),
          ],
        }),
      ],
    });
    expect(paysFor(split, "a", 12_400).lit).toEqual(["win", "push"]);
  });
});

describe("the rules card", () => {
  it("lists how the table pays, lighting the rows that apply", () => {
    const { container } = render(<HowItPays pays={{ lit: ["double"], double: 500, split: null }} />);
    const rows = [...container.querySelectorAll(".bj__pay")];
    expect(rows.map((row) => row.querySelector("dt")?.textContent)).toEqual([
      "Blackjack pays",
      "A win pays",
      "A push returns",
      "Dealer stands on",
      "Double on your first two cards",
      "Split a pair, once",
    ]);
    expect(rows.map((row) => row.querySelector("dd")?.textContent)).toEqual([
      "3 to 2",
      "1 to 1",
      "the stake",
      "17",
      "+500",
      "—",
    ]);
    expect(container.querySelectorAll(".bj__pay--lit")).toHaveLength(1);
    expect(container.querySelector(".bj__pay--lit dt")?.textContent).toBe("Double on your first two cards");
  });
});
