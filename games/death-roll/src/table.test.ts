import { TableError } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { Table } from "./table.js";

const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

/** A chips table with two people at it, ready to be dealt. */
const seated = () => {
  const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
  table.join("ada", "Ada", who("u1"));
  table.join("bob", "Bob", who("u2"));
  return table;
};

describe("a table waiting for an opponent", () => {
  it("is not ready with one player at it", () => {
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
    table.join("ada", "Ada", who("u1"));

    expect(table.ready).toBe(false);
    expect(table.phase).toBe("waiting");
    expect(table.duel).toBeNull();
  });

  it("says what it is waiting for", () => {
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
    table.join("ada", "Ada", who("u1"));

    expect(table.view("ada").waitingFor).toBe("opponent");
  });

  it("holds with the felt untouched — no pot, no ceiling coming down", () => {
    /*
     * The rule in CLAUDE.md in so many words: waiting never costs anybody a
     * stake, and a table that holds must hold with the felt untouched. There
     * is nothing on the felt to clear because nothing was ever put there.
     */
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
    table.join("ada", "Ada", who("u1"));
    const view = table.view("ada");

    expect(view.pot).toBe(0);
    expect(view.ceiling).toBe(1_000);
    expect(view.toRoll).toBeNull();
  });

  it("becomes ready when the second player sits down", () => {
    const table = seated();

    expect(table.ready).toBe(true);
    expect(table.view("ada").waitingFor).toBeNull();
  });

  it("refuses a third seat", () => {
    const table = seated();

    expect(() => table.join("cat", "Cat", who("u3"))).toThrow();
  });
});

describe("the queue that gets a duel started", () => {
  it("hands the pending pair over exactly once", () => {
    /*
     * The adapter drains this before its first await, which is what makes a
     * broadcast asking often into taking the antes exactly once rather than a
     * way to charge somebody twice.
     */
    const table = seated();

    table.askForDuel();

    expect(table.takePending()).toEqual(["ada", "bob"]);
    expect(table.takePending()).toBeNull();
  });

  it("is empty until somebody asks", () => {
    const table = seated();

    expect(table.takePending()).toBeNull();
  });
});

describe("a duel at the table", () => {
  it("starts with the pot already funded and the opening ceiling up", () => {
    const table = seated();

    table.begin("ada");

    expect(table.phase).toBe("dueling");
    expect(table.view("ada").pot).toBe(1_000);
    expect(table.view("ada").ceiling).toBe(1_000);
    expect(table.view("ada").toRoll).toBe("ada");
  });

  it("alternates who rolls first between duels", () => {
    // The roller is the underdog, so who goes first is worth something — tiny
    // at a thousand, a third of the ante at two. Alternating costs nothing and
    // means an evening is even however short the duels are.
    const table = seated();

    table.begin("ada");
    table.duel?.roll("ada", () => 1);
    table.finish();
    table.begin();

    expect(table.view("ada").toRoll).toBe("bob");

    table.duel?.roll("bob", () => 1);
    table.finish();
    table.begin();

    expect(table.view("ada").toRoll).toBe("ada");
  });

  it("alternates even when the player who rolled first wins", () => {
    /*
     * The case that separates real alternation from "the winner rolls first".
     * Ada opens, survives, and Bob rolls the 1 — so Ada won without ever being
     * handed the disadvantage back. Bob must open the next one.
     */
    const table = seated();

    table.begin("ada");
    table.duel?.roll("ada", () => 500);
    table.duel?.roll("bob", () => 1);
    table.finish();
    table.begin();

    expect(table.view("ada").toRoll).toBe("bob");
  });

  it("goes back to waiting when the duel is cleared away", () => {
    const table = seated();
    table.begin("ada");
    table.duel?.roll("ada", () => 1);

    expect(table.phase).toBe("over");

    table.finish();

    expect(table.phase).toBe("waiting");
    expect(table.view("ada").pot).toBe(0);
  });

  it("puts a clock on the turn and moves it with the turn", () => {
    vi.useFakeTimers();
    try {
      const table = seated();
      table.begin("ada");
      const first = table.turnEndsAt;
      expect(first).toBe(Date.now() + 30_000);

      vi.advanceTimersByTime(5_000);
      table.duel?.roll("ada", () => 500);
      table.touchClock();

      expect(table.turnEndsAt).toBe(Date.now() + 30_000);
      expect(table.turnEndsAt as number).toBeGreaterThan(first as number);
      expect(table.view("bob").toRoll).toBe("bob");
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes the clock away once the duel is over", () => {
    const table = seated();
    table.begin("ada");
    table.duel?.roll("ada", () => 1);
    table.touchClock();

    expect(table.turnEndsAt).toBeNull();
  });
});

describe("standing up", () => {
  it("keeps a seat the room reaps mid-duel until the felt clears", () => {
    /*
     * The room reaps a seat a minute and a half after its player drops,
     * whatever the table is doing, and an absent player burns a whole turn
     * clock every turn — so a duel outlives that grace as a matter of course.
     * Honouring it there and then would leave the pot with nobody to pay it
     * to, which is both antes gone at a table with no bank behind it.
     */
    const table = seated();
    table.begin("ada");

    table.removeSeat("bob");

    expect(table.seats.map((seat) => seat.id)).toEqual(["ada", "bob"]);
    table.duel?.roll("ada", () => 1);
    table.finish();
    expect(table.seats.map((seat) => seat.id)).toEqual(["ada"]);
  });

  it("keeps somebody who comes back before the duel ends", () => {
    // The reaping timer has already fired by the time a bad line gets its
    // socket back; being slow once should not stand you up at the end.
    const table = seated();
    table.begin("ada");
    table.disconnect("bob");
    table.removeSeat("bob");

    table.reconnect("bob");
    table.duel?.roll("ada", () => 1);
    table.finish();

    expect(table.seats.map((seat) => seat.id)).toEqual(["ada", "bob"]);
  });

  it("gives the seat up once the duel is cleared", () => {
    const table = seated();
    table.begin("ada");
    table.duel?.roll("ada", () => 1);
    table.finish();
    table.removeSeat("bob");

    expect(table.seats.map((seat) => seat.id)).toEqual(["ada"]);
    expect(table.ready).toBe(false);
  });
});

describe("who may sit down", () => {
  it("refuses a bot at a table playing for chips", () => {
    // The line the whole economy rests on: a bot at a chips table is a button
    // somebody holds down. Refused by the table, not hidden by the client.
    const table = seated();

    expect(() => table.addBot("bot:1", "Bot", "normal")).toThrow(TableError);
    expect(table.seats).toHaveLength(2);
  });

  it("seats one at a table playing for nothing", () => {
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
    table.forFun = true;
    table.join("ada", "Ada", null);

    const bot = table.addBot("bot:1", "Bot", "normal");

    expect(bot.isBot).toBe(true);
    expect(bot.waiting).toBe(false);
    expect(table.ready).toBe(true);
  });
});

describe("a table playing for nothing", () => {
  it("hands each seat a purse and takes it back when the table closes", () => {
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
    table.forFun = true;
    table.join("ada", "Ada", null);

    expect(table.purseFor("ada")).toBe(10_000);
    expect(table.view("ada").you?.purse).toBe(10_000);
  });

  it("lets a guest with no account sit down", () => {
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
    table.forFun = true;

    expect(() => table.join("ada", "Ada", null)).not.toThrow();
  });

  it("insists on knowing who you are at a table playing for chips", () => {
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });

    expect(() => table.join("ada", "Ada", null)).toThrow();
  });

  it("shows no purse at a table playing for chips", () => {
    const table = seated();

    expect(table.view("ada").you?.purse).toBeNull();
  });
});

describe("when an ante can't be covered", () => {
  it("reports a short ante once, not on every retry", () => {
    const table = seated();

    expect(table.noteShort("bob")).toBe(true);
    expect(table.noteShort("bob")).toBe(false);
    expect(table.view("ada").waitingFor).toBe("funds");
    expect(table.noteShort(null)).toBe(true);
    expect(table.view("ada").waitingFor).toBeNull();
  });
});

describe("what the felt is told", () => {
  it("shows both seats to everybody and the pass only to its owner's seat", () => {
    const table = seated();
    table.begin("ada");
    table.duel?.pass("ada");
    const view = table.view("bob");

    expect(view.seats).toHaveLength(2);
    expect(view.seats.find((seat) => seat.id === "ada")?.passed).toBe(true);
    expect(view.seats.find((seat) => seat.id === "bob")?.passed).toBe(false);
  });

  it("tells a watcher everything and gives them no seat of their own", () => {
    const table = seated();
    table.begin("ada");

    expect(table.view(null).you).toBeNull();
    expect(table.view(null).ceiling).toBe(1_000);
  });

  it("carries the price of a pass so the felt never has to work it out", () => {
    const table = seated();

    expect(table.view("ada").passPrice).toBe(50);
    expect(table.view("ada").ante).toBe(500);
  });
});
