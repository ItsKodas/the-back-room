import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { tableFor } from "./fixtures.js";

describe("waiting for enough people", () => {
  it("does not start counting down until there are three", () => {
    const { table, clock } = tableFor({}, 2);
    expect(table.phase).toBe("waiting");
    expect(table.deadline).toBeNull();
    table.join("s2", "P2", null);
    expect(table.deadline).toBe(clock.now() + 15_000);
  });

  it("stops the countdown if somebody leaves and it is no longer enough", () => {
    const { table } = tableFor();
    table.removeSeat("s2");
    expect(table.deadline).toBeNull();
  });

  it("deals nothing if asked before there are enough", () => {
    const { table } = tableFor({}, 2);
    table.deal();
    expect(table.phase).toBe("waiting");
  });

  it("needs two a team for teams", () => {
    const { table } = tableFor({ mode: "teams", teams: 3 }, 5);
    expect(table.minimum).toBe(6);
    expect(table.deadline).toBeNull();
  });
});

describe("a turn", () => {
  it("deals the first seat three words to pick from", () => {
    const { table, clock } = tableFor();
    table.deal();
    expect(table.phase).toBe("picking");
    expect(table.turn).toEqual({ drawers: ["s0"], picker: "s0", team: null });
    expect(table.choices).toEqual(["lighthouse", "accordion", "sandcastle"]);
    expect(table.deadline).toBe(clock.now() + 15_000);
  });

  it("lets only the picker pick", () => {
    const { table } = tableFor();
    table.deal();
    expect(() => table.pick("s1", 0)).toThrow(TableError);
    table.pick("s0", 1);
    expect(table.phase).toBe("drawing");
    expect(table.word).toBe("accordion");
  });

  it("picks for a picker who lets the clock run out", () => {
    const { table } = tableFor();
    table.deal();
    table.autoPick();
    expect(table.phase).toBe("drawing");
    expect(table.choices).toEqual([]);
    expect(["lighthouse", "accordion", "sandcastle"]).toContain(table.word);
  });

  it("opens hint letters on the clock", () => {
    const { table, clock } = tableFor({ hints: "few", drawSeconds: 80 });
    table.deal();
    table.pick("s0", 0);
    expect(table.nextHintAt()).toBe(clock.now() + 40_000);
    clock.advance(40_000);
    table.advanceDrawing();
    expect(table.hintsShown).toBe(1);
    expect(table.nextHintAt()).toBe((table.startedAt as number) + 64_000);
  });

  it("ends the drawing when the clock runs out", () => {
    const { table, clock } = tableFor({ drawSeconds: 60 });
    table.deal();
    table.pick("s0", 0);
    clock.advance(60_000);
    table.advanceDrawing();
    expect(table.phase).toBe("reveal");
    expect(table.reveal).toMatchObject({ word: "lighthouse", abandoned: false });
  });

  it("goes straight to the reveal, scoring nobody, when the only drawer leaves", () => {
    const { table } = tableFor({}, 4);
    table.deal();
    table.pick("s0", 0);
    table.guessed.set("s1", 200);
    table.removeSeat("s0");
    expect(table.phase).toBe("reveal");
    expect(table.reveal?.abandoned).toBe(true);
    expect(table.players.get("s1")?.score).toBe(0);
  });

  it("skips a turn whose drawer left while picking", () => {
    const { table } = tableFor({}, 4);
    table.deal();
    table.removeSeat("s0");
    expect(table.phase).toBe("picking");
    expect(table.turn?.drawers).toEqual(["s1"]);
  });
});

describe("a game", () => {
  it("gives every seat a turn each round, and ends after the last round", () => {
    const { table } = tableFor({ rounds: 2 });
    table.deal();
    const drew: string[] = [];
    while (table.phase !== "over") {
      drew.push(...(table.turn?.drawers ?? []));
      table.autoPick();
      table.deadline = table.now();
      table.advanceDrawing();
      table.endReveal();
    }
    expect(drew).toEqual(["s0", "s1", "s2", "s0", "s1", "s2"]);
    expect(table.round).toBe(2);
  });

  it("finishes the turn, then goes back to waiting when too few are left", () => {
    const { table } = tableFor({}, 3);
    table.deal();
    table.pick("s0", 0);
    table.removeSeat("s2");
    expect(table.phase).toBe("drawing");
    table.deadline = table.now();
    table.advanceDrawing();
    table.endReveal();
    expect(table.phase).toBe("waiting");
    expect(table.lastEvent).toMatch(/waiting for more/i);
  });

  it("goes back to waiting after the result, keeping teams and forgetting who left", () => {
    const { table } = tableFor({ mode: "teams", teams: 2, rounds: 2 }, 4);
    table.pickTeam("s0", 1);
    table.deal();
    table.removeSeat("s3");
    table.backToWaiting();
    expect(table.phase).toBe("waiting");
    expect(table.players.has("s3")).toBe(false);
    expect(table.players.get("s0")?.team).toBe(1);
  });
});

describe("teams", () => {
  it("closes a team that would be more than one bigger than another", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 4);
    table.pickTeam("s0", 0);
    expect(() => table.pickTeam("s1", 0)).toThrow("Blue is full for now.");
    table.pickTeam("s1", 1);
    table.pickTeam("s2", 0);
  });

  it("only picks teams between games", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 4);
    table.deal();
    expect(() => table.pickTeam("s0", 1)).toThrow(TableError);
  });

  it("puts anyone who has not picked on the smallest team when it deals", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 4);
    table.pickTeam("s2", 0);
    table.deal();
    expect(table.teams).toEqual([["s2", "s1"], ["s0", "s3"]]);
  });

  it("deals a pair from the first team, the first-listed picking", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 4);
    table.deal();
    expect(table.turn).toEqual({ drawers: ["s0", "s2"], picker: "s0", team: 0 });
  });

  it("lets the partner carry on alone when one drawer leaves", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 5);
    table.deal();
    table.pick("s0", 0);
    table.removeSeat("s0");
    expect(table.phase).toBe("drawing");
    // Nobody picked, so dealing alternated: Blue is s0, s2, s4 and draws first as s0 + s2.
    expect(table.turn?.drawers).toEqual(["s2"]);
  });

  it("puts somebody who joins mid-game on the smallest team", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 5);
    table.deal();
    table.join("s5", "P5", null);
    expect(table.players.get("s5")?.team).toBe(1);
  });

  it("names the winning team's players as the winners", () => {
    const { table } = tableFor({ mode: "teams", teams: 2, rounds: 2 }, 4);
    table.deal();
    table.teamScores = [0, 0];
    while (table.phase !== "over") {
      table.autoPick();
      if (table.turn?.team === 1) {
        table.guessed.set(table.teams[0]?.[0] as string, 100);
      }
      table.deadline = table.now();
      table.advanceDrawing();
      table.endReveal();
    }
    expect(new Set(table.winners)).toEqual(new Set(table.teams[1]));
  });
});
