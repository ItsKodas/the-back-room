import { describe, expect, it } from "vitest";
import { TableError } from "@backroom/core";
import { Game } from "./game.js";

const rolls = (...results: number[]) => {
  let at = 0;
  return () => results[at++] as number;
};

const shape = { ante: 500, opening: 1_000, passPrice: 50, resetCeiling: 100 };

describe("a game of three", () => {
  it("opens at the table's ceiling, with every ante in the pot", () => {
    const game = new Game(["ada", "bob", "cat"], "bob", shape);

    expect(game.round.ceiling).toBe(1_000);
    expect(game.round.toRoll).toBe("bob");
    expect(game.pot).toBe(1_500);
    expect(game.rounds).toBe(2);
  });

  it("puts out whoever rolls a 1, and waits between rounds", () => {
    const game = new Game(["ada", "bob", "cat"], "cat", shape);

    game.roll("cat", rolls(1));

    expect(game.out).toEqual(["cat"]);
    expect(game.betweenRounds).toBe(true);
    expect(game.over).toBe(false);
  });

  it("starts the next round at 100 with fresh passes, opened after whoever went out", () => {
    const game = new Game(["ada", "bob", "cat"], "bob", shape);
    game.pass("bob");
    game.roll("cat", rolls(1));

    game.nextRound();

    expect(game.roundNumber).toBe(2);
    expect(game.round.ceiling).toBe(100);
    expect(game.round.order).toEqual(["ada", "bob"]);
    expect(game.round.toRoll).toBe("ada");
    expect(game.round.holdsPass("bob")).toBe(true);
  });

  it("gives the pot to the last one standing, passes from every round included", () => {
    const game = new Game(["ada", "bob", "cat"], "bob", shape);
    game.pass("bob");
    game.roll("cat", rolls(1));
    game.nextRound();
    game.pass("ada");
    game.roll("bob", rolls(1));

    expect(game.over).toBe(true);
    expect(game.winnerId).toBe("ada");
    expect(game.pot).toBe(1_600);
    expect(game.netFor("ada")).toBe(1_050);
    expect(game.netFor("bob")).toBe(-550);
    expect(game.netFor("cat")).toBe(-500);
  });

  it("comes to nothing overall, however the passes fell", () => {
    const game = new Game(["ada", "bob", "cat"], "bob", shape);
    game.pass("bob");
    game.roll("cat", rolls(1));
    game.nextRound();
    game.pass("ada");
    game.roll("bob", rolls(1));

    const total = ["ada", "bob", "cat"].reduce((sum, id) => sum + game.netFor(id), 0);
    expect(total).toBe(0);
  });

  it("counts passes and rounds survived for the history", () => {
    const game = new Game(["ada", "bob", "cat"], "bob", shape);
    game.pass("bob");
    game.roll("cat", rolls(1));
    game.nextRound();
    game.pass("ada");
    game.roll("bob", rolls(1));

    expect(game.passesBy("ada")).toBe(1);
    expect(game.passesBy("cat")).toBe(0);
    expect(game.survivedBy("cat")).toBe(0);
    expect(game.survivedBy("bob")).toBe(1);
    expect(game.survivedBy("ada")).toBe(2);
  });

  it("is worth nothing to anybody until it is over, or to a seat never dealt in", () => {
    const game = new Game(["ada", "bob", "cat"], "bob", shape);

    expect(game.netFor("ada")).toBe(0);
    expect(game.netFor("zed")).toBe(0);
  });
});

describe("who opens the next round", () => {
  it("wraps round the table past the last seat", () => {
    const game = new Game(["a", "b", "c", "d"], "a", { ...shape, opening: 100 });
    game.roll("a", rolls(50));
    game.roll("b", rolls(40));
    game.roll("c", rolls(30));
    game.roll("d", rolls(1));

    game.nextRound();

    expect(game.round.toRoll).toBe("a");
  });

  it("skips seats already out", () => {
    const game = new Game(["a", "b", "c", "d"], "a", { ...shape, opening: 100 });
    game.roll("a", rolls(50));
    game.roll("b", rolls(40));
    game.roll("c", rolls(30));
    game.roll("d", rolls(1));
    game.nextRound();
    game.roll("a", rolls(1));

    game.nextRound();

    expect(game.round.toRoll).toBe("b");
  });
});

describe("the edges", () => {
  it("plays a game of two as exactly one round", () => {
    const game = new Game(["ada", "bob"], "ada", shape);

    game.roll("ada", rolls(1));

    expect(game.over).toBe(true);
    expect(game.betweenRounds).toBe(false);
    expect(game.winnerId).toBe("bob");
  });

  it("refuses a next round when there is none to start", () => {
    const game = new Game(["ada", "bob", "cat"], "ada", shape);

    expect(() => game.nextRound()).toThrow(TableError);
  });

  it("needs two different players", () => {
    expect(() => new Game(["ada"], "ada", shape)).toThrow(TableError);
    expect(() => new Game(["ada", "ada"], "ada", shape)).toThrow(TableError);
  });
});
