import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { Duel } from "./duel.js";

/** A duel between Ada and Bob, Ada to roll, at a five hundred chip table. */
const duel = (opening = 1_000) => new Duel("ada", "bob", "ada", opening, 500, 50);

/** A roller that hands back a fixed run of numbers, in order. */
const rolls = (...results: number[]) => {
  let at = 0;
  return () => results[at++] as number;
};

describe("rolling", () => {
  it("makes the result the new ceiling and moves the turn", () => {
    const game = duel();

    const rolled = game.roll("ada", rolls(743));

    expect(rolled).toEqual({ seatId: "ada", from: 1_000, result: 743 });
    expect(game.ceiling).toBe(743);
    expect(game.toRoll).toBe("bob");
    expect(game.over).toBe(false);
  });

  it("ends the duel on a one, and the roller is the one who lost", () => {
    const game = duel(4);

    game.roll("ada", rolls(1));

    expect(game.over).toBe(true);
    expect(game.loserId).toBe("ada");
    expect(game.winnerId).toBe("bob");
  });

  it("leaves the ceiling where it was when the duel ends", () => {
    // The felt shows the number that was being rolled against beside the 1
    // that ended it, so the last ceiling has to survive the losing roll.
    const game = duel(9);

    game.roll("ada", rolls(1));

    expect(game.ceiling).toBe(9);
    expect(game.lastRoll).toEqual({ seatId: "ada", from: 9, result: 1 });
  });

  it("refuses a roll from the seat whose turn it is not", () => {
    const game = duel();

    expect(() => game.roll("bob", rolls(500))).toThrow(TableError);
  });

  it("refuses a roll from a seat that is not in the duel", () => {
    const game = duel();

    expect(() => game.roll("cat", rolls(500))).toThrow(TableError);
  });

  it("refuses a draw the ceiling cannot produce", () => {
    /*
     * The roller is injected, so this is the one place a bad one could put a
     * duel into a state its own rules forbid — a ceiling that went up, or a
     * zero that can never end the game. Cheaper to refuse than to debug.
     */
    const game = duel(10);

    expect(() => game.roll("ada", rolls(11))).toThrow(TableError);
    expect(() => game.roll("ada", rolls(0))).toThrow(TableError);
  });

  it("keeps every roll, in order, for the felt to show", () => {
    const game = duel(1_000);

    game.roll("ada", rolls(743));
    game.roll("bob", rolls(112));

    expect(game.history).toEqual([
      { seatId: "ada", from: 1_000, result: 743 },
      { seatId: "bob", from: 743, result: 112 },
    ]);
  });

  it("never leaves a ceiling of one for the next player to roll against", () => {
    /*
     * The property the whole game leans on: a 1 ends the duel rather than
     * becoming the ceiling, so nobody is ever handed a roll they are certain
     * to lose. Played out in full rather than reasoned about.
     */
    let seed = 12_345;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let round = 0; round < 200; round++) {
      const game = duel(1_000);
      while (!game.over) {
        expect(game.ceiling).toBeGreaterThanOrEqual(2);
        game.roll(game.toRoll, (ceiling) => Math.floor(random() * ceiling) + 1);
      }
      expect(game.loserId).not.toBeNull();
    }
  });
});

describe("passing", () => {
  it("leaves the ceiling alone and hands the roll back", () => {
    const game = duel(38);

    const passed = game.pass("ada");

    expect(passed).toEqual({ seatId: "ada", paid: 50 });
    expect(game.ceiling).toBe(38);
    expect(game.toRoll).toBe("bob");
  });

  it("puts the price into the pot", () => {
    const game = duel(38);

    expect(game.pot).toBe(1_000);
    game.pass("ada");
    expect(game.pot).toBe(1_050);
  });

  it("is spent once and refused after", () => {
    const game = duel(38);

    game.pass("ada");
    game.roll("bob", rolls(20));

    expect(game.hasPassed("ada")).toBe(true);
    expect(() => game.pass("ada")).toThrow(TableError);
  });

  it("lets the other player pass it straight back, and then no more", () => {
    /*
     * The cap that makes the game terminate. Two passes is the most a duel can
     * ever hold, so after both are gone somebody must roll — which is the
     * whole argument that a duel ends at all.
     */
    const game = duel(38);

    game.pass("ada");
    game.pass("bob");

    expect(game.pot).toBe(1_100);
    expect(game.toRoll).toBe("ada");
    expect(() => game.pass("ada")).toThrow(TableError);
    expect(() => game.pass("bob")).toThrow(TableError);
  });

  it("refuses a pass from the seat whose turn it is not", () => {
    const game = duel();

    expect(() => game.pass("bob")).toThrow(TableError);
  });

  it("checks without spending", () => {
    // The adapter has to ask before it takes the chips, so that a player who
    // cannot afford the price is refused without their pass being burnt.
    const game = duel(38);

    expect(game.checkPass("ada")).toBe(50);
    expect(game.hasPassed("ada")).toBe(false);
  });
});

describe("what the duel is worth to each of them", () => {
  it("pays the winner the ante when nobody passed", () => {
    const game = duel(4);

    game.roll("ada", rolls(1));

    expect(game.netFor("bob")).toBe(500);
    expect(game.netFor("ada")).toBe(-500);
  });

  it("charges the loser for their own pass and pays it to the winner", () => {
    const game = duel(4);

    game.pass("ada");
    game.roll("bob", rolls(3));
    game.roll("ada", rolls(1));

    expect(game.netFor("ada")).toBe(-550);
    expect(game.netFor("bob")).toBe(550);
  });

  it("gives a winner their own pass back for nothing", () => {
    /*
     * The property that makes passing a bet rather than a fee: it comes back
     * inside the pot, so a pass you bought and then won with cost you nothing.
     */
    const game = duel(4);

    game.pass("ada");
    game.roll("bob", rolls(1));

    expect(game.netFor("ada")).toBe(500);
    expect(game.netFor("bob")).toBe(-500);
    expect(game.pot).toBe(1_050);
  });

  it("always sums to zero, however the passes fell", () => {
    const game = duel(4);

    game.pass("ada");
    game.pass("bob");
    game.roll("ada", rolls(1));

    expect(game.netFor("ada") + game.netFor("bob")).toBe(0);
    expect(game.netFor("bob")).toBe(550);
  });

  it("is worth nothing to anybody until it is over", () => {
    const game = duel();

    expect(game.netFor("ada")).toBe(0);
    expect(game.netFor("bob")).toBe(0);
  });
});
