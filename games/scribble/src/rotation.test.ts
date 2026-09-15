import { describe, expect, it } from "vitest";
import { mayJoin, smallestTeam, soloTurn, teamTurn } from "./rotation.js";

describe("a solo turn", () => {
  it("is one person drawing and picking", () => {
    expect(soloTurn("s1")).toEqual({ drawers: ["s1"], picker: "s1", team: null });
  });
});

describe("a team's turns", () => {
  it("walks pairs round a team of three, so everyone draws twice in three turns", () => {
    const team = ["a", "b", "c"];
    expect([0, 1, 2].map((k) => teamTurn(team, k, 0).drawers)).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ]);
  });

  it("gives every member the pick equally, without any separate alternation", () => {
    const team = ["a", "b", "c", "d"];
    const pickers = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => teamTurn(team, k, 1).picker);
    for (const member of team) {
      expect(pickers.filter((one) => one === member)).toHaveLength(2);
    }
  });

  it("is always both of a team of two, swapping the pick", () => {
    expect(teamTurn(["a", "b"], 0, 2)).toEqual({ drawers: ["a", "b"], picker: "a", team: 2 });
    expect(teamTurn(["a", "b"], 1, 2)).toEqual({ drawers: ["b", "a"], picker: "b", team: 2 });
  });

  it("lets a team of one draw alone", () => {
    expect(teamTurn(["a"], 5, 3)).toEqual({ drawers: ["a"], picker: "a", team: 3 });
  });
});

describe("balancing teams", () => {
  it("sends a newcomer to the smallest team, the earliest on a tie", () => {
    expect(smallestTeam([2, 1, 1, 3])).toBe(1);
  });

  it("closes a team that would become more than one bigger than another", () => {
    expect(mayJoin([1, 0], 0)).toBe(false);
    expect(mayJoin([1, 0], 1)).toBe(true);
    expect(mayJoin([0, 0, 0], 2)).toBe(true);
    expect(mayJoin([3, 3, 2, 2], 0)).toBe(false);
    expect(mayJoin([3, 3, 2, 2], 3)).toBe(true);
  });
});
