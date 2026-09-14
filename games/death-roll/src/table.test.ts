import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { Table } from "./table.js";

const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

/** A chips table with these people sat at it. */
const seated = (...names: string[]) => {
  const table = new Table("ABCDE", 6, { opening: 1_000, ante: 500, countdownMs: 20_000 });
  for (const name of names) {
    table.join(name, name, who(`u-${name}`));
  }
  return table;
};

const readyAll = (table: Table, now = 0) => {
  for (const seat of table.seats) {
    table.setReady(seat.id, true, now);
  }
};

describe("a table waiting for players", () => {
  it("says it needs players until two are sat down", () => {
    const table = seated("ada");
    expect(table.view("ada").waitingFor).toBe("players");

    table.join("bob", "bob", who("u-bob"));

    expect(table.view("ada").waitingFor).toBeNull();
  });

  it("takes no stake for being ready", () => {
    // Waiting never costs anybody a stake: ready moves nothing.
    const table = seated("ada", "bob");
    readyAll(table);

    expect(table.game).toBeNull();
    expect(table.view(null).pot).toBe(0);
    expect(table.view(null).readyCount).toBe(2);
  });
});

describe("dealing", () => {
  it("asks for everybody at once when everybody is ready", () => {
    const table = seated("ada", "bob", "cat");
    readyAll(table);

    table.askForGame(0);

    expect(table.takePending()).toEqual(["ada", "bob", "cat"]);
    expect(table.draining).toBe(true);
    expect(table.takePending()).toBeNull();
  });

  it("waits out the countdown when somebody is not ready, then asks for the ready ones", () => {
    const table = seated("ada", "bob", "cat");
    table.setReady("ada", true, 0);
    table.setReady("bob", true, 1_000);

    table.askForGame(20_999);
    expect(table.pending).toBe(false);

    table.askForGame(21_000);
    expect(table.takePending()).toEqual(["ada", "bob"]);
  });

  it("deals the players given, with the clock armed and ready stood down", () => {
    const table = seated("ada", "bob", "cat");
    readyAll(table);

    table.begin(["ada", "bob", "cat"]);

    expect(table.phase).toBe("playing");
    expect(table.view(null).pot).toBe(1_500);
    expect(table.view(null).rounds).toBe(2);
    expect(table.turnEndsAt).not.toBeNull();
    expect(table.view(null).readyCount).toBe(0);
  });

  it("moves the first roll on to the next player dealt in, game after game", () => {
    const table = seated("ada", "bob", "cat");
    table.begin(["ada", "bob", "cat"]);
    expect(table.view(null).toRoll).toBe("ada");
    table.game?.roll("ada", () => 1);
    table.game?.nextRound();
    table.game?.roll(table.game.round.toRoll, () => 1);
    table.finish();

    table.begin(["ada", "bob", "cat"]);

    expect(table.view(null).toRoll).toBe("bob");
  });
});

describe("during a game", () => {
  it("seats a latecomer for the next game and refuses their ready until then", () => {
    const table = seated("ada", "bob");
    table.begin(["ada", "bob"]);

    const late = table.join("cat", "cat", who("u-cat"));

    expect(late.waiting).toBe(true);
    expect(() => table.setReady("cat", true, 0)).toThrow(TableError);
  });

  it("holds the seat of a player in the game until the felt clears", () => {
    const table = seated("ada", "bob");
    table.begin(["ada", "bob"]);

    table.removeSeat("bob");
    expect(table.seats.map((seat) => seat.id)).toContain("bob");

    table.game?.roll("ada", () => 1);
    table.finish();
    expect(table.seats.map((seat) => seat.id)).not.toContain("bob");
  });

  it("lets a player waiting for the next game leave at once", () => {
    const table = seated("ada", "bob");
    table.begin(["ada", "bob"]);
    table.join("cat", "cat", who("u-cat"));

    table.removeSeat("cat");

    expect(table.seats.map((seat) => seat.id)).not.toContain("cat");
  });

  it("shows who is out, who has passed, and who is still in", () => {
    const table = seated("ada", "bob", "cat");
    table.begin(["ada", "bob", "cat"]);
    table.game?.pass("ada");
    table.game?.roll("bob", () => 1);

    const view = table.view("ada");

    expect(view.lastOut).toBe("bob");
    expect(view.seats.find((seat) => seat.id === "bob")?.out).toBe(true);
    expect(view.seats.find((seat) => seat.id === "ada")?.passed).toBe(true);
    expect(view.order).toEqual(["ada", "bob", "cat"]);
    expect(view.alive).toEqual(["ada", "bob", "cat"]);

    table.nextRound();

    expect(table.view("ada").alive).toEqual(["ada", "cat"]);
    expect(table.view("ada").ceiling).toBe(100);
    expect(table.view("ada").round).toBe(2);
  });
});

describe("after a game", () => {
  it("stands everybody's ready down and lets the latecomer in", () => {
    const table = seated("ada", "bob");
    readyAll(table);
    table.begin(["ada", "bob"]);
    table.join("cat", "cat", who("u-cat"));
    table.game?.roll("ada", () => 1);

    table.finish();

    expect(table.phase).toBe("waiting");
    expect(table.view(null).readyCount).toBe(0);
    expect(table.seats.every((seat) => !seat.waiting)).toBe(true);
  });
});

describe("a deal that falls short", () => {
  it("sits out whoever could not pay, and stands their ready down", () => {
    const table = seated("ada", "bob", "cat");
    readyAll(table);

    table.noteShorts(["cat"]);

    expect(table.view(null).seats.find((seat) => seat.id === "cat")?.short).toBe(true);
    expect(table.readiness.isReady("cat")).toBe(false);
    expect(table.lastEvent).toMatch(/could not cover/);
  });

  it("stands everybody down when the deal fails, and does not retry by itself", () => {
    const table = seated("ada", "bob");
    readyAll(table);

    table.failDeal("No deal.");

    expect(table.view(null).readyCount).toBe(0);
    table.askForGame(99_999);
    expect(table.pending).toBe(false);
  });
});

describe("bots", () => {
  it("refuses one at a table playing for chips", () => {
    const table = seated("ada");
    expect(() => table.addBot("bot:1", "Bot", "normal")).toThrow(TableError);
  });

  it("seats one ready at a table playing for nothing, and readies it again after a game", () => {
    const table = new Table("ABCDE", 6, { opening: 1_000, ante: 500 });
    table.forFun = true;
    table.join("ada", "Ada", null);

    table.addBot("bot:1", "Bot", "normal");
    expect(table.readiness.isReady("bot:1")).toBe(true);

    table.begin(["ada", "bot:1"]);
    table.game?.roll("ada", () => 1);
    table.finish();

    expect(table.readiness.isReady("bot:1")).toBe(true);
    expect(table.readiness.isReady("ada")).toBe(false);
  });
});
