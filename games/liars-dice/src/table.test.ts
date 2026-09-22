import { describe, expect, it } from "vitest";
import type { Face } from "./bid.js";
import { Table } from "./table.js";

const fives = () => 5 as Face;

const table = (seats = 3, options: { forFun?: boolean } = {}) => {
  const one = new Table("ABCDE", 10, { ante: 500, dice: 2, roll: fives });
  one.forFun = options.forFun ?? false;
  for (let at = 0; at < seats; at += 1) {
    one.join(
      `s${at}`,
      `Player ${at}`,
      one.forFun ? null : { userId: `s${at}`, avatar: null, accentColor: null },
    );
  }
  return one;
};

/** Deals a game the way the adapter does: ask, drain, begin. */
const deal = (one: Table, players: string[]) => {
  one.begin(players);
  return one;
};

describe("a table", () => {
  it("starts waiting, with nobody dealt", () => {
    const one = table();
    expect(one.view(null).phase).toBe("waiting");
    expect(one.view(null).pot).toBe(0);
    expect(one.view(null).bid).toBe(null);
  });

  it("says it is waiting for players below two", () => {
    const one = table(1);
    expect(one.view(null).waitingFor).toBe("players");
  });

  it("refuses a bot at a table playing for chips", () => {
    const one = table();
    expect(() => one.addBot("bot", "Robot", "normal")).toThrow("for fun");
  });

  it("seats a bot at a for-fun table, ready to go", () => {
    const one = table(1, { forFun: true });
    one.addBot("bot", "Robot", "normal");
    expect(one.view(null).seats.find((seat) => seat.id === "bot")?.ready).toBe(true);
  });

  it("refuses a seat with nobody behind it at a table playing for chips", () => {
    const one = new Table("ABCDE", 10, { ante: 500, dice: 2, roll: fives });
    expect(() => one.join("s0", "Player 0", null)).toThrow("sign in");
  });

  it("seats anybody at all at a for-fun table", () => {
    const one = new Table("ABCDE", 10, { ante: 500, dice: 2, roll: fives });
    one.forFun = true;
    expect(() => one.join("s0", "Player 0", null)).not.toThrow();
  });
});

describe("your own dice and nobody else's", () => {
  it("shows you your faces and everybody else a face-down die each", () => {
    const one = deal(table(), ["s0", "s1", "s2"]);
    const mine = one.view("s0");
    expect(mine.you?.hand).toEqual([5, 5]);
    const theirs = mine.seats.find((seat) => seat.id === "s1");
    expect(theirs?.hand).toEqual([null, null]);
    expect(theirs?.dice).toBe(2);
  });

  it("shows a watcher nothing at all", () => {
    const one = deal(table(), ["s0", "s1", "s2"]);
    const watching = one.view(null);
    expect(watching.you).toBe(null);
    for (const seat of watching.seats) {
      expect(seat.hand).toEqual([null, null]);
    }
  });

  it("turns every hand up for everybody at a reveal", () => {
    const one = deal(table(), ["s0", "s1", "s2"]);
    const game = one.game;
    if (game === null) {
      throw new Error("no game");
    }
    game.raise("s0", { count: 4, face: 5 });
    game.call("s1", "liar");
    const watching = one.view(null);
    for (const seat of watching.seats) {
      expect(seat.hand).toEqual([5, 5]);
    }
  });
});

describe("what the felt says", () => {
  it("carries the bid, who said it and who is to act", () => {
    const one = deal(table(), ["s0", "s1", "s2"]);
    one.game?.raise("s0", { count: 3, face: 5 });
    const view = one.view("s1");
    expect(view.bid).toEqual({ count: 3, face: 5 });
    expect(view.bidder).toBe("s0");
    expect(view.toAct).toBe("s1");
    expect(view.total).toBe(6);
    expect(view.pot).toBe(1_500);
  });

  it("counts an event even when the words repeat", () => {
    const one = table();
    one.say("Nothing happened.");
    const first = one.view(null).eventSeq;
    one.say("Nothing happened.");
    expect(one.view(null).eventSeq).toBeGreaterThan(first);
  });
});

describe("standing up", () => {
  it("holds a seat that is in the game until the felt clears", () => {
    const one = deal(table(), ["s0", "s1", "s2"]);
    one.removeSeat("s0");
    expect(one.seats.some((seat) => seat.id === "s0")).toBe(true);
    one.finish();
    expect(one.seats.some((seat) => seat.id === "s0")).toBe(false);
  });

  it("drops a seat that is only waiting for the next game at once", () => {
    const one = deal(table(), ["s0", "s1"]);
    one.join("late", "Latecomer", { userId: "late", avatar: null, accentColor: null });
    one.removeSeat("late");
    expect(one.seats.some((seat) => seat.id === "late")).toBe(false);
  });
});

describe("readiness", () => {
  it("stands a ready down when its player drops, so they are not anted", () => {
    const one = table();
    one.setReady("s0", true, 1_000);
    one.setReady("s1", true, 1_000);
    one.disconnect("s0");
    expect(one.view(null).readyCount).toBe(1);
  });

  it("refuses a ready press while a game is running", () => {
    const one = deal(table(), ["s0", "s1", "s2"]);
    expect(() => one.setReady("s0", true, 1_000)).toThrow("once this game is over");
  });
});
