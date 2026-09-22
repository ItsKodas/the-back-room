import { describe, expect, it } from "vitest";
import type { Face } from "./bid.js";
import { Game } from "./game.js";

/** A roll that hands out a fixed script, so a game can be played to order. */
const scripted = (script: Face[]) => {
  let at = 0;
  return () => {
    const face = script[at % script.length] as Face;
    at += 1;
    return face;
  };
};

/** Everybody holds the same face, so a count is easy to reason about. */
const allFives = () => scripted([5]);

const game = (players = ["a", "b"], dice = 2, roll = allFives()) =>
  new Game(players, players[0] as string, { ante: 500, dice, roll });

describe("a new game", () => {
  it("deals everybody their dice and opens on the opener", () => {
    const one = game(["a", "b", "c"], 3);
    expect(one.players).toEqual(["a", "b", "c"]);
    expect(one.diceFor("a")).toBe(3);
    expect(one.total).toBe(9);
    expect(one.round.toAct).toBe("a");
    expect(one.roundNumber).toBe(1);
    expect(one.over).toBe(false);
  });

  it("opens on whoever was named, not always the first seat", () => {
    const one = new Game(["a", "b", "c"], "b", { ante: 500, dice: 3, roll: allFives() });
    expect(one.round.toAct).toBe("b");
  });

  it("has a pot of one ante each", () => {
    expect(game(["a", "b", "c"], 3).pot).toBe(1_500);
  });

  it("gives everybody a real hand, hidden from nobody at this level", () => {
    const one = game(["a", "b"], 2);
    expect(one.round.handFor("a")).toEqual([5, 5]);
  });
});

describe("losing a die", () => {
  it("takes one off whoever the round says", () => {
    const one = game(["a", "b", "c"], 3);
    one.raise("a", { count: 9, face: 5 });
    // Nine fives with nine fives on the table is good, so the caller pays.
    one.call("b", "liar");
    expect(one.diceFor("b")).toBe(2);
    expect(one.diceFor("a")).toBe(3);
  });

  it("puts a player on nothing out of the game", () => {
    const one = game(["a", "b", "c"], 1);
    one.raise("a", { count: 3, face: 5 });
    one.call("b", "liar");
    expect(one.diceFor("b")).toBe(0);
    expect(one.out).toEqual(["b"]);
    expect(one.live).toEqual(["a", "c"]);
  });
});

describe("the round in between", () => {
  it("waits, then deals the next one to whoever is left", () => {
    const one = game(["a", "b", "c"], 1);
    one.raise("a", { count: 3, face: 5 });
    one.call("b", "liar");
    expect(one.betweenRounds).toBe(true);
    expect(one.over).toBe(false);
    one.nextRound();
    expect(one.roundNumber).toBe(2);
    expect(one.round.order).toEqual(["a", "c"]);
    expect(one.total).toBe(2);
    expect(one.betweenRounds).toBe(false);
  });

  it("gives the next round to whoever lost the die", () => {
    const one = game(["a", "b", "c"], 3);
    one.raise("a", { count: 9, face: 5 });
    one.call("b", "liar");
    one.nextRound();
    expect(one.round.toAct).toBe("b");
  });

  it("moves past somebody the die put out", () => {
    const one = game(["a", "b", "c"], 1);
    one.raise("a", { count: 3, face: 5 });
    // b is out, so the next live seat after b opens.
    one.call("b", "liar");
    one.nextRound();
    expect(one.round.toAct).toBe("c");
  });

  it("gives it to the caller when a correct exact cost everybody else one", () => {
    const one = game(["a", "b", "c"], 3);
    one.raise("a", { count: 9, face: 5 });
    one.call("b", "exact");
    expect(one.diceFor("a")).toBe(2);
    expect(one.diceFor("c")).toBe(2);
    expect(one.diceFor("b")).toBe(3);
    one.nextRound();
    expect(one.round.toAct).toBe("b");
  });

  it("gives it to the caller when a correct exact leaves exactly two players live", () => {
    // At two live players a correct exact has exactly one loser — the sole
    // non-caller — which is the same shape as a liar call's one loser. The
    // opener has to be told apart by what happened, not by counting losers.
    const one = game(["a", "b"], 2);
    one.raise("a", { count: 4, face: 5 });
    one.call("b", "exact");
    expect(one.diceFor("a")).toBe(1);
    expect(one.diceFor("b")).toBe(2);
    one.nextRound();
    expect(one.round.toAct).toBe("b");
  });

  it("refuses to deal a round while one is still running", () => {
    const one = game(["a", "b", "c"], 3);
    one.nextRound();
    expect(one.roundNumber).toBe(1);
  });
});

describe("the end", () => {
  it("is one player still holding dice", () => {
    const one = game(["a", "b"], 1);
    one.raise("a", { count: 2, face: 5 });
    one.call("b", "liar");
    expect(one.over).toBe(true);
    expect(one.winnerId).toBe("a");
    expect(one.betweenRounds).toBe(false);
  });

  it("never leaves nobody holding dice, however the call goes", () => {
    for (const call of ["liar", "exact"] as const) {
      const one = game(["a", "b", "c"], 1);
      one.raise("a", { count: 3, face: 5 });
      one.call("b", call);
      expect(one.live.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("pays the pot to the winner and the ante off everybody else", () => {
    const one = game(["a", "b"], 1);
    one.raise("a", { count: 2, face: 5 });
    one.call("b", "liar");
    expect(one.netFor("a")).toBe(500);
    expect(one.netFor("b")).toBe(-500);
  });
});

describe("what the record keeps", () => {
  it("counts rounds survived, bids, calls and exacts", () => {
    const one = game(["a", "b", "c"], 3);
    one.raise("a", { count: 4, face: 5 });
    one.raise("b", { count: 5, face: 5 });
    one.call("c", "exact");
    expect(one.bidsBy("a")).toBe(1);
    expect(one.bidsBy("b")).toBe(1);
    expect(one.callsBy("c")).toBe(1);
    expect(one.exactsBy("c")).toBe(1);
    // Nine fives on the table, so five was not exact.
    expect(one.hitsBy("c")).toBe(0);
    expect(one.survivedBy("a")).toBe(1);
  });

  it("keeps a board of what happened", () => {
    const one = game(["a", "b", "c"], 3);
    one.raise("a", { count: 4, face: 5 });
    one.call("b", "liar");
    expect(one.board).toEqual([
      {
        round: 1,
        bid: { count: 4, face: 5 },
        call: "liar",
        caller: "b",
        count: 9,
        right: true,
        losers: ["b"],
      },
    ]);
  });
});
