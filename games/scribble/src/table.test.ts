import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { tableFor } from "./fixtures.js";
import { drawerPoints } from "./scoring.js";

describe("waiting for enough people", () => {
  it("does not start counting down until there are three", () => {
    const { table, clock } = tableFor({}, 2);
    expect(table.phase).toBe("waiting");
    expect(table.deadline).toBeNull();
    table.join("s2", "P2", null);
    expect(table.deadline).toBe(clock.now() + 30_000);
  });

  /*
   * The rule the whole ready system hangs off: it may hurry a deal along and
   * it may never hold one up. A table that one idle player could keep shut is
   * a table that has stopped dealing itself.
   */
  it("deals when the clock runs out however many are ready", () => {
    const { table, clock } = tableFor();
    table.setReady("s0", true);
    clock.advance(30_000);
    table.deal();
    expect(table.phase).toBe("picking");
  });

  it("deals at once when everybody seated is ready", () => {
    const { table, clock } = tableFor();
    expect(table.deadline).toBe(clock.now() + 30_000);
    table.setReady("s0", true);
    table.setReady("s1", true);
    expect(table.deadline).toBe(clock.now() + 30_000);
    table.setReady("s2", true);
    expect(table.deadline).toBe(clock.now());
  });

  it("puts the wait back when somebody who was ready changes their mind", () => {
    const { table, clock } = tableFor();
    for (const id of ["s0", "s1", "s2"]) {
      table.setReady(id, true);
    }
    expect(table.deadline).toBe(clock.now());
    table.setReady("s1", false);
    expect(table.deadline).toBe(clock.now() + 30_000);
  });

  it("counts readiness against who is still here, so a leaver cannot hold it open", () => {
    const { table, clock } = tableFor({}, 4);
    table.setReady("s0", true);
    table.setReady("s1", true);
    table.setReady("s2", true);
    expect(table.deadline).toBe(clock.now() + 30_000);
    table.removeSeat("s3");
    expect(table.deadline).toBe(clock.now());
  });

  it("shows who is ready, and forgets it once the game is under way", () => {
    const { table } = tableFor();
    table.setReady("s0", true);
    expect(table.view("s0").you?.ready).toBe(true);
    expect(table.view("s0").readyCount).toBe(1);
    table.deal();
    expect(table.view("s0").you?.ready).toBe(false);
    expect(table.view("s0").readyCount).toBe(0);
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
    // The pick clock, not the wait for people: dealing has already happened.
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

  /*
   * A leaver keeps their score on purpose — the board still shows what they
   * did. But the winners list is what the server hands the taunt pool, and a
   * pool resolved against somebody who walked out pays chips on a result
   * nobody at the table won.
   */
  it("does not crown somebody who left before the end", () => {
    const { table } = tableFor({ rounds: 1 }, 4);
    table.deal();
    const leader = table.players.get("s0");
    if (leader !== undefined) {
      leader.score = 500;
    }
    table.removeSeat("s0");
    while (table.phase !== "over") {
      table.autoPick();
      table.deadline = table.now();
      table.advanceDrawing();
      table.endReveal();
    }
    expect(table.winners).not.toContain("s0");
    expect(table.winners.length).toBeGreaterThan(0);
  });
});

describe("team balance across games", () => {
  it("rebalances a team left too big after someone quits in the lobby", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 5);
    table.pickTeam("s0", 0);
    table.pickTeam("s1", 1);
    table.pickTeam("s2", 0);
    table.pickTeam("s3", 1);
    table.pickTeam("s4", 0);
    expect(table.teams).toEqual([
      ["s0", "s2", "s4"],
      ["s1", "s3"],
    ]);
    // While waiting, a leave goes through the players.delete path, not mid-game bookkeeping.
    table.removeSeat("s3");
    expect(table.teams).toEqual([["s0", "s2", "s4"], ["s1"]]);
    table.deal();
    expect(table.teams.map((members) => members.length)).toEqual([2, 2]);
    expect(table.teams[1]).toContain("s4");
    expect(table.players.get("s4")?.team).toBe(1);
  });

  it("brings an emptied team back up to at least two, every team within one of another", () => {
    const { table } = tableFor({ mode: "teams", teams: 3 }, 6);
    // Teams carried over from an earlier game, left lopsided (3, 3, 0) by departures.
    table.teams = [
      ["s0", "s1", "s2"],
      ["s3", "s4", "s5"],
      [],
    ];
    for (const id of ["s0", "s1", "s2"]) {
      const player = table.players.get(id);
      if (player !== undefined) {
        player.team = 0;
      }
    }
    for (const id of ["s3", "s4", "s5"]) {
      const player = table.players.get(id);
      if (player !== undefined) {
        player.team = 1;
      }
    }
    table.deal();
    const sizes = table.teams.map((members) => members.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.every((size) => size >= 2)).toBe(true);
  });
});

describe("mid-game joiners", () => {
  it("deals a mid-game joiner straight in, rather than leaving them waiting forever", () => {
    const { table } = tableFor({}, 3);
    table.deal();
    table.join("s3", "P3", null);
    expect(table.seats.find((seat) => seat.id === "s3")?.waiting).toBe(false);
  });
});

describe("scoring a turn", () => {
  it("pays each guesser what they were owed, and splits the drawer's share by who got it", () => {
    const { table } = tableFor({}, 4);
    table.deal();
    table.pick("s0", 0);
    table.guessed.set("s1", 100);
    table.deadline = table.now();
    table.advanceDrawing();
    expect(table.phase).toBe("reveal");
    const each = drawerPoints(1, 3); // s1 guessed; s2 and s3 were still eligible to.
    expect(table.reveal?.scored).toEqual(
      expect.arrayContaining([
        { seatId: "s1", points: 100, drew: false },
        { seatId: "s0", points: each, drew: true },
      ]),
    );
    expect(table.players.get("s1")?.score).toBe(100);
    expect(table.players.get("s0")?.score).toBe(each);
  });

  it("still pays and counts a guesser who left before the turn ended", () => {
    const { table } = tableFor({}, 4);
    table.deal();
    table.pick("s0", 0);
    table.guessed.set("s1", 100);
    table.removeSeat("s1");
    // s2 and s3 have still not guessed, so the turn does not end early.
    expect(table.phase).toBe("drawing");
    table.deadline = table.now();
    table.advanceDrawing();
    const each = drawerPoints(1, 3);
    expect(table.reveal?.scored).toEqual(
      expect.arrayContaining([
        { seatId: "s1", points: 100, drew: false },
        { seatId: "s0", points: each, drew: true },
      ]),
    );
  });

  it("keeps a scored player's points on their team's score after they leave", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 5);
    table.pickTeam("s0", 0);
    table.pickTeam("s1", 1);
    table.pickTeam("s2", 0);
    table.pickTeam("s3", 1);
    table.pickTeam("s4", 1);
    table.deal();
    expect(table.turn?.team).toBe(0);
    table.pick("s0", 0);
    table.guessed.set("s1", 100);
    table.deadline = table.now();
    table.advanceDrawing();
    expect(table.phase).toBe("reveal");
    const before = table.teamScores[1];
    table.removeSeat("s1");
    expect(table.teamScores[1]).toBe(before);
  });

  it("ends the drawing once the last player who has not guessed leaves", () => {
    const { table } = tableFor({}, 4);
    table.deal();
    table.pick("s0", 0);
    table.guessed.set("s1", 100);
    table.guessed.set("s2", 90);
    table.removeSeat("s3");
    expect(table.phase).toBe("reveal");
    expect(table.reveal?.abandoned).toBe(false);
  });
});
