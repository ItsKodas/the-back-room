import type { FinishedGame, GameDeps, StatBumpLike } from "@backroom/core";
import { TableError } from "@backroom/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { liarsDiceAdapter } from "./adapter.js";
import type { Face } from "./bid.js";
import type { Table } from "./table.js";

type Adapter = ReturnType<typeof liarsDiceAdapter>;

/** A store that behaves, and remembers what it was asked. */
const store = () => {
  const balances = new Map<string, number>();
  const deps = {
    take: vi.fn(async (userId: string, amount: number) => {
      const had = balances.get(userId) ?? 0;
      if (had < amount) {
        return false;
      }
      balances.set(userId, had - amount);
      return true;
    }),
    give: vi.fn(async (userId: string, amount: number) => {
      balances.set(userId, (balances.get(userId) ?? 0) + amount);
    }),
    // Typed rather than bare, so the payloads below are checked as well as counted.
    record: vi.fn(async (_userId: string, _bump: StatBumpLike) => undefined),
    finished: vi.fn(async (_record: FinishedGame) => undefined),
  } satisfies GameDeps;
  return { balances, deps };
};

const fives = () => 5 as Face;

/** Every chip named across a mock's calls. What went out, or what came back. */
const sum = (calls: readonly (readonly [string, number])[]) =>
  calls.reduce((total, call) => total + call[1], 0);

/** What went back to one account across a mock's calls. */
const backTo = (calls: readonly (readonly [string, number])[], userId: string) =>
  sum(calls.filter((call) => call[0] === userId));

/**
 * A table with these players sat at it, ready to be dealt.
 *
 * No `dice` option on purpose: the table snaps whatever it is handed to a level
 * the game actually offers, so asking for one die would silently get three and
 * every count in a test below would be wrong about the felt it is reading.
 */
const seated = (adapter: Adapter, names: readonly string[], options: { forFun?: boolean } = {}) => {
  const table = adapter.create("ABCDE", {
    buyIn: 500,
    dice: 3,
    forFun: options.forFun ?? false,
    maxSeats: 10,
  }) as Table;
  for (const name of names) {
    table.join(
      name,
      name,
      options.forFun === true ? null : { userId: name, avatar: null, accentColor: null },
    );
  }
  return table;
};

const allReady = (table: Table, names: readonly string[]) => {
  for (const name of names) {
    table.setReady(name, true, Date.now());
  }
};

/** Deals the way the room does: the table asks, payOut answers. */
const deal = async (adapter: Adapter, table: Table, deps: GameDeps) => {
  table.askForGame(Date.now());
  return await adapter.payOut?.(table, deps);
};

/**
 * Plays a two-handed game out to a winner, through the adapter.
 *
 * Whoever opens bids one two at a table of nothing but fives, which is always a
 * lie, and loses the die for it — and the player who lost the die opens the next
 * round, so the same one pays for it until they have nothing left. Two-handed
 * only: at three the caller is not simply "the other one".
 */
const playOut = async (adapter: Adapter, table: Table, deps: GameDeps) => {
  while (table.game !== null && !table.game.over) {
    const bidder = table.game.round.toAct;
    const caller = table.game.round.order.find((one) => one !== bidder) as string;
    await adapter.act(table, bidder, { type: "bid", count: 1, face: 2 }, deps);
    await adapter.act(table, caller, { type: "liar" }, deps);
    table.nextRound();
  }
};

describe("the antes", () => {
  let bank: ReturnType<typeof store>;
  let adapter: Adapter;

  beforeEach(() => {
    bank = store();
    adapter = liarsDiceAdapter({ roll: fives });
  });

  it("deals nobody until the antes are in, and then deals everybody who paid", async () => {
    const table = seated(adapter, ["a", "b"]);
    bank.balances.set("a", 1_000);
    bank.balances.set("b", 1_000);
    allReady(table, ["a", "b"]);
    table.askForGame(Date.now());
    expect(table.game).toBe(null);

    const moved = await adapter.payOut?.(table, bank.deps);
    expect(moved).toBe(true);
    expect(table.game?.players).toEqual(["a", "b"]);
    expect(bank.balances.get("a")).toBe(500);
    expect(table.view(null).pot).toBe(1_000);
    // A table that never stopped draining would never deal itself again.
    expect(table.draining).toBe(false);
  });

  it("sits out only the player who cannot cover it", async () => {
    const table = seated(adapter, ["a", "b", "c"]);
    bank.balances.set("a", 1_000);
    bank.balances.set("b", 1_000);
    bank.balances.set("c", 100);
    allReady(table, ["a", "b", "c"]);

    await deal(adapter, table, bank.deps);

    expect(table.game?.players).toEqual(["a", "b"]);
    expect(table.view(null).seats.find((seat) => seat.id === "c")?.short).toBe(true);
    expect(bank.balances.get("c")).toBe(100);
  });

  it("hands every ante back and deals nobody when fewer than two can pay", async () => {
    /*
     * The one funded player's ante has already left their account by the time
     * the table knows there is nobody to play against, so the only honest end
     * to this is handing it back. A table that dealt anyway would be a game of
     * one, and a table that simply stopped would have kept the money.
     */
    const table = seated(adapter, ["a", "b", "c"]);
    bank.balances.set("a", 1_000);
    bank.balances.set("b", 100);
    bank.balances.set("c", 100);
    allReady(table, ["a", "b", "c"]);

    expect(await deal(adapter, table, bank.deps)).toBe(true);

    expect(table.game).toBe(null);
    expect(backTo(bank.deps.give.mock.calls, "a")).toBe(500);
    expect(bank.balances.get("a")).toBe(1_000);
    expect(bank.balances.get("b")).toBe(100);
    expect(bank.balances.get("c")).toBe(100);
    expect(table.view(null).readyCount).toBe(0);
    expect(table.view(null).lastEvent).toBe(
      "Not enough players could cover the ante, so nobody was dealt.",
    );
  });

  it("deals nobody and hands everything back when the store throws", async () => {
    const table = seated(adapter, ["a", "b"]);
    bank.balances.set("a", 1_000);
    bank.deps.take
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => {
        throw new Error("the store is down");
      });
    allReady(table, ["a", "b"]);

    await deal(adapter, table, bank.deps);

    expect(table.game).toBe(null);
    expect(bank.deps.give).toHaveBeenCalledWith("a", 500);
    expect(table.view(null).lastEvent).toContain("nobody was dealt");
    expect(table.view(null).readyCount).toBe(0);
    // A deal that fell through still has to let go of the table.
    expect(table.draining).toBe(false);
  });

  it("does not charge or deal somebody who dropped before their own ante", async () => {
    const table = seated(adapter, ["a", "b", "c"]);
    for (const one of ["a", "b", "c"]) {
      bank.balances.set(one, 1_000);
    }
    allReady(table, ["a", "b", "c"]);
    // c goes while the second ante is in flight, so c's own ante is never
    // reached: this is the first pass's skip, not the re-check below it.
    bank.deps.take.mockImplementation(async (userId: string, amount: number) => {
      if (userId === "b") {
        table.disconnect("c");
      }
      bank.balances.set(userId, (bank.balances.get(userId) ?? 0) - amount);
      return true;
    });

    await deal(adapter, table, bank.deps);

    expect(table.game?.players).toEqual(["a", "b"]);
    expect(bank.deps.take).toHaveBeenCalledTimes(2);
    expect(bank.balances.get("c")).toBe(1_000);
    // Never charged is not the same as could not pay, and a felt that said so
    // would be accusing somebody who was only on a bad line.
    expect(table.view(null).seats.find((seat) => seat.id === "c")?.short).toBe(false);
  });

  it("refunds and does not deal a funded player who drops while a later ante is taken", async () => {
    const table = seated(adapter, ["a", "b", "c"]);
    for (const one of ["a", "b", "c"]) {
      bank.balances.set(one, 1_000);
    }
    allReady(table, ["a", "b", "c"]);
    /*
     * a has already paid by the time they go, so the first pass's skip cannot
     * catch them — only the re-check under the antes can hand that ante back.
     * Leave at this table only disconnects, so a's seat is still sitting there
     * looking dealable while a is not.
     */
    bank.deps.take.mockImplementation(async (userId: string, amount: number) => {
      if (userId === "c") {
        table.disconnect("a");
      }
      bank.balances.set(userId, (bank.balances.get(userId) ?? 0) - amount);
      return true;
    });

    await deal(adapter, table, bank.deps);

    expect(table.game?.players).toEqual(["b", "c"]);
    expect(bank.deps.give).toHaveBeenCalledWith("a", 500);
    expect(bank.balances.get("a")).toBe(1_000);
    expect(table.view(null).pot).toBe(1_000);
    expect(sum(bank.deps.take.mock.calls)).toBe(
      sum(bank.deps.give.mock.calls) + table.view(null).pot,
    );
  });

  it("refunds somebody who goes while another's refund is in flight, and deals no ghost", async () => {
    /*
     * The window the re-check loop closes, and the reason it is a loop rather
     * than a pass: a refund is itself an await, so who is left can change again
     * while one is running. d's ante drops a; handing a's ante back drops b,
     * right in the middle of paying it.
     *
     * A single pass would refund a, then deal b — a seat in the turn order
     * whose player has gone, and a pot nobody could be paid if it won.
     */
    const table = seated(adapter, ["a", "b", "c", "d"]);
    for (const one of ["a", "b", "c", "d"]) {
      bank.balances.set(one, 1_000);
    }
    allReady(table, ["a", "b", "c", "d"]);
    bank.deps.take.mockImplementation(async (userId: string, amount: number) => {
      if (userId === "d") {
        table.disconnect("a");
      }
      bank.balances.set(userId, (bank.balances.get(userId) ?? 0) - amount);
      return true;
    });
    bank.deps.give.mockImplementation(async (userId: string, amount: number) => {
      if (userId === "a") {
        table.disconnect("b");
      }
      bank.balances.set(userId, (bank.balances.get(userId) ?? 0) + amount);
    });

    await deal(adapter, table, bank.deps);

    expect(table.game?.players).toEqual(["c", "d"]);
    expect(backTo(bank.deps.give.mock.calls, "a")).toBe(500);
    expect(backTo(bank.deps.give.mock.calls, "b")).toBe(500);
    expect(bank.balances.get("a")).toBe(1_000);
    expect(bank.balances.get("b")).toBe(1_000);
    // Nothing was created and nothing was kept: what is left off the accounts
    // is exactly what is on the felt.
    expect(sum(bank.deps.take.mock.calls)).toBe(
      sum(bank.deps.give.mock.calls) + table.view(null).pot,
    );
  });

  it("deals nobody at a table called off while an ante was in flight", async () => {
    const table = seated(adapter, ["a", "b"]);
    bank.balances.set("a", 1_000);
    bank.balances.set("b", 1_000);
    allReady(table, ["a", "b"]);
    bank.deps.take.mockImplementationOnce(async (userId: string, amount: number) => {
      bank.balances.set(userId, (bank.balances.get(userId) ?? 0) - amount);
      await adapter.void(table, bank.deps);
      return true;
    });

    await deal(adapter, table, bank.deps);

    expect(table.game).toBe(null);
    expect(bank.balances.get("a")).toBe(1_000);
  });

  it("deals nobody when it is called off while a leaver's ante is going back", async () => {
    /*
     * Every ante is in and held; a dropped during c's take, and the void lands
     * while a's is being handed back. b and c are still two, but their antes
     * have already gone back with the void — a game dealt now would be a pot
     * with nothing in it, and the winner would be paid out of thin air.
     *
     * A different route to a called-off table than the `hold` refusal above:
     * that one lands while a take is in flight, this one while a *refund* is.
     */
    const table = seated(adapter, ["a", "b", "c"]);
    for (const one of ["a", "b", "c"]) {
      bank.balances.set(one, 1_000);
    }
    allReady(table, ["a", "b", "c"]);
    let voiding: Promise<unknown> = Promise.resolve();
    bank.deps.take.mockImplementation(async (userId: string, amount: number) => {
      if (userId === "c") {
        table.disconnect("a");
      }
      bank.balances.set(userId, (bank.balances.get(userId) ?? 0) - amount);
      return true;
    });
    bank.deps.give.mockImplementation(async (userId: string, amount: number) => {
      bank.balances.set(userId, (bank.balances.get(userId) ?? 0) + amount);
      if (userId === "a") {
        voiding = adapter.void(table, bank.deps);
      }
    });

    await deal(adapter, table, bank.deps);
    await voiding;

    expect(table.game).toBe(null);
    for (const one of ["a", "b", "c"]) {
      expect(bank.balances.get(one)).toBe(1_000);
    }
  });

  it("takes no second set of antes while the first deal is still draining", async () => {
    /*
     * What makes running on every broadcast exactly-once: the queue is emptied
     * before the first await, so a payOut arriving while antes are in flight
     * finds nothing to do. Without that, four antes off two accounts for a pot
     * of two.
     */
    const table = seated(adapter, ["a", "b"]);
    for (const one of ["a", "b"]) {
      bank.balances.set(one, 1_000);
    }
    allReady(table, ["a", "b"]);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    bank.deps.take.mockImplementation(async (userId: string, amount: number) => {
      await gate;
      bank.balances.set(userId, (bank.balances.get(userId) ?? 0) - amount);
      return true;
    });

    table.askForGame(Date.now());
    expect(table.pending).toBe(true);
    const first = adapter.payOut?.(table, bank.deps);

    // Deliberately not awaited: the queue has to be empty and the table has to
    // be flagged as draining already, before anything can have yielded.
    expect(table.pending).toBe(false);
    expect(table.draining).toBe(true);
    expect(await adapter.payOut?.(table, bank.deps)).toBe(false);

    release();
    await first;

    expect(bank.deps.take).toHaveBeenCalledTimes(2);
    expect(table.game?.players).toEqual(["a", "b"]);
    expect(bank.balances.get("a")).toBe(500);
    expect(table.draining).toBe(false);
  });

  it("offers no second deal while the antes are still being taken", async () => {
    // A table that looked idle mid-deal would arm another one, and the pause
    // the room runs is what would arm it.
    const table = seated(adapter, ["a", "b"]);
    for (const one of ["a", "b"]) {
      bank.balances.set(one, 1_000);
    }
    allReady(table, ["a", "b"]);
    let during: unknown = "never ran";
    bank.deps.take.mockImplementation(async (userId: string, amount: number) => {
      during = adapter.pause?.(table) ?? null;
      bank.balances.set(userId, (bank.balances.get(userId) ?? 0) - amount);
      return true;
    });

    await deal(adapter, table, bank.deps);

    expect(during).toBeNull();
  });

  it("does nothing at all when no deal was asked for", async () => {
    const table = seated(adapter, ["a", "b"]);
    expect(await adapter.payOut?.(table, bank.deps)).toBe(false);
  });
});

describe("the moves", () => {
  let bank: ReturnType<typeof store>;
  let adapter: Adapter;

  beforeEach(() => {
    bank = store();
    adapter = liarsDiceAdapter({ roll: fives });
  });

  const dealt = () => {
    const table = seated(adapter, ["a", "b"]);
    table.begin(["a", "b"]);
    return table;
  };

  it("takes a bid and passes the turn", async () => {
    const table = dealt();
    const first = table.game?.round.toAct as string;

    await adapter.act(table, first, { type: "bid", count: 3, face: 5 }, bank.deps);

    expect(table.view(null).bid).toEqual({ count: 3, face: 5 });
    expect(table.view(null).toAct).not.toBe(first);
    // Nothing is staked during a game, so a bid is not a purchase.
    expect(bank.deps.take).not.toHaveBeenCalled();
    expect(bank.deps.give).not.toHaveBeenCalled();
  });

  it("refuses a bid from the wrong seat", async () => {
    const table = dealt();
    const notTheirs = table.game?.round.order[1] as string;
    await expect(
      Promise.resolve(adapter.act(table, notTheirs, { type: "bid", count: 3, face: 5 }, bank.deps)),
    ).rejects.toThrow(TableError);
  });

  it("refuses a face that is not a face", async () => {
    const table = dealt();
    await expect(
      Promise.resolve(
        adapter.act(
          table,
          table.game?.round.toAct as string,
          { type: "bid", count: 1, face: 9 },
          bank.deps,
        ),
      ),
    ).rejects.toThrow(TableError);
  });

  it("refuses a count that is not a number", async () => {
    const table = dealt();
    await expect(
      Promise.resolve(
        adapter.act(
          table,
          table.game?.round.toAct as string,
          { type: "bid", count: "three", face: 5 },
          bank.deps,
        ),
      ),
    ).rejects.toThrow("whole number");
  });

  it("refuses a move nobody at this table can make", async () => {
    const table = dealt();
    await expect(
      Promise.resolve(
        adapter.act(table, table.game?.round.toAct as string, { type: "fold" }, bank.deps),
      ),
    ).rejects.toThrow("not a move at this table");
  });

  it("refuses somebody who is not at this table at all", async () => {
    const table = dealt();
    await expect(
      Promise.resolve(adapter.act(table, "nobody", { type: "liar" }, bank.deps)),
    ).rejects.toThrow("not at this table");
  });

  it("resolves a liar call and says so", async () => {
    const table = dealt();
    const first = table.game?.round.toAct as string;
    const opened = table.view(null).eventSeq;
    await adapter.act(table, first, { type: "bid", count: 4, face: 5 }, bank.deps);
    const second = table.game?.round.toAct as string;

    /*
     * Counted, not just said. `eventSeq` is the only thing in the view that
     * moves with every action the table reports, so it is the only way the
     * activity log can tell the same sentence twice running apart from one
     * broadcast sent twice — a sentence set on `lastEvent` directly is a
     * sentence the log will swallow.
     */
    expect(table.view(null).eventSeq).toBe(opened + 1);

    await adapter.act(table, second, { type: "liar" }, bank.deps);

    expect(table.view(null).eventSeq).toBe(opened + 2);
    expect(table.view(null).resolution?.call).toBe("liar");
    expect(table.view(null).lastEvent).toContain("liar");
    // Six fives on the table against a bid of four: the bid was good, so the
    // player who called it pays.
    expect(table.view(null).resolution?.losers).toEqual([second]);
  });

  it("takes a ready between games without a game running", async () => {
    const table = seated(adapter, ["a", "b"]);
    await adapter.act(table, "a", { type: "ready", ready: true }, bank.deps);
    expect(table.view(null).readyCount).toBe(1);
  });
});

describe("the clock", () => {
  let bank: ReturnType<typeof store>;
  let adapter: Adapter;

  beforeEach(() => {
    bank = store();
    adapter = liarsDiceAdapter({ roll: fives });
  });

  it("puts the clock on whoever is to act", () => {
    const table = seated(adapter, ["a", "b"]);
    table.begin(["a", "b"]);
    expect(adapter.clock?.(table)).toEqual({
      seatId: table.game?.round.toAct,
      endsAt: table.turnEndsAt,
    });
  });

  it("bids the lowest legal raise rather than calling", () => {
    const table = seated(adapter, ["a", "b"]);
    table.begin(["a", "b"]);
    const whose = table.game?.round.toAct as string;

    adapter.timeout?.(table, whose);

    expect(table.view(null).bid).toEqual({ count: 1, face: 2 });
    expect(table.view(null).resolution).toBe(null);
    expect(table.view(null).lastEvent).toContain("The clock");
  });

  it("calls liar only when no raise is left", () => {
    const table = seated(adapter, ["a", "b"]);
    table.begin(["a", "b"]);
    const first = table.game?.round.toAct as string;
    // Six dice on the table, every one of them claimed as a one: nothing beats it.
    table.game?.raise(first, { count: 6, face: 1 });
    const second = table.game?.round.toAct as string;

    adapter.timeout?.(table, second);

    expect(table.view(null).resolution?.call).toBe("liar");
    expect(table.view(null).lastEvent).toContain("The clock called liar");
  });

  it("does nothing for a seat whose turn it is not", () => {
    const table = seated(adapter, ["a", "b"]);
    table.begin(["a", "b"]);
    const notTheirs = table.game?.round.order[1] as string;

    adapter.timeout?.(table, notTheirs);

    expect(table.view(null).bid).toBe(null);
  });

  it("never costs anybody chips", async () => {
    const table = seated(adapter, ["a", "b"]);
    bank.balances.set("a", 1_000);
    bank.balances.set("b", 1_000);
    allReady(table, ["a", "b"]);
    await deal(adapter, table, bank.deps);

    adapter.timeout?.(table, table.game?.round.toAct as string);

    expect(bank.balances.get("a")).toBe(500);
    expect(bank.balances.get("b")).toBe(500);
  });
});

describe("paying out", () => {
  it("pays the pot to the last one holding dice and records the game", async () => {
    const bank = store();
    const adapter = liarsDiceAdapter({ roll: fives });
    const table = seated(adapter, ["a", "b"]);
    for (const one of ["a", "b"]) {
      bank.balances.set(one, 1_000);
    }
    allReady(table, ["a", "b"]);
    await deal(adapter, table, bank.deps);

    await playOut(adapter, table, bank.deps);
    const winner = table.game?.winnerId as string;
    const loser = ["a", "b"].find((one) => one !== winner) as string;

    expect(adapter.isSettled(table)).toBe(true);
    await adapter.settle(table, bank.deps);

    expect(winner).toBe("b");
    expect(loser).toBe("a");
    expect(bank.balances.get(winner)).toBe(1_500);
    expect(bank.balances.get(loser)).toBe(500);
    expect(adapter.winners?.(table)).toEqual([winner]);

    // The one assertion in this file that would catch chips being created:
    // everything paid out came off an account first.
    expect(sum(bank.deps.give.mock.calls)).toBe(sum(bank.deps.take.mock.calls));
    expect(sum(bank.deps.give.mock.calls)).toBe(1_000);

    /*
     * The whole payload, not just the call count. `add` and `max` are
     * Record<string, number>, so a typo'd stat key is a silent loss of
     * somebody's history that typecheck cannot see: three rounds, a bid from
     * the opener and a call from the other every time. `a` opens and loses
     * every one of them, so the third round is the one that takes a's last
     * die — a did not survive that one, only the two before it, while b's
     * dice were never touched and b finished all three.
     */
    expect(bank.deps.record.mock.calls).toEqual([
      [
        "a",
        {
          shared: { rounds: 1, roundsWon: 0, chipsWon: -500, chipsStaked: 500 },
          game: "liars-dice",
          add: { games: 1, bids: 3, calls: 0, exacts: 0, exactsHit: 0 },
          max: { pot: 1_000, rounds: 2 },
        },
      ],
      [
        "b",
        {
          shared: { rounds: 1, roundsWon: 1, chipsWon: 500, chipsStaked: 500 },
          game: "liars-dice",
          add: { games: 1, bids: 0, calls: 3, exacts: 0, exactsHit: 0 },
          max: { pot: 1_000, rounds: 3 },
        },
      ],
    ]);

    expect(bank.deps.finished).toHaveBeenCalledTimes(1);
    const history = bank.deps.finished.mock.calls[0]?.[0] as FinishedGame;
    expect(history).toMatchObject({
      code: "ABCDE",
      rulesetName: "3 dice",
      buyIn: 500,
      pot: 1_000,
      winnerIds: ["b"],
    });
    // A game nobody paid into and nobody took out of: the nets have to cancel.
    expect(history.players.reduce((total, one) => total + one.net, 0)).toBe(0);
    expect(history.players).toEqual([
      { userId: "a", name: "a", score: 2, isBot: false, net: -500 },
      { userId: "b", name: "b", score: 3, isBot: false, net: 500 },
    ]);
  });

  it("records no game and no stats as though the pot were paid, when paying the winner fails", async () => {
    const bank = store();
    const adapter = liarsDiceAdapter({ roll: fives });
    const table = seated(adapter, ["a", "b"]);
    for (const one of ["a", "b"]) {
      bank.balances.set(one, 1_000);
    }
    allReady(table, ["a", "b"]);
    await deal(adapter, table, bank.deps);
    await playOut(adapter, table, bank.deps);
    bank.deps.give.mockImplementation(async () => {
      throw new Error("the store is down");
    });
    expect(adapter.isSettled(table)).toBe(true);

    await expect(adapter.settle(table, bank.deps)).rejects.toThrow("the store is down");

    expect(bank.deps.record).not.toHaveBeenCalled();
    expect(bank.deps.finished).not.toHaveBeenCalled();
  });

  it("refuses to settle a game won by a seat that is not there", async () => {
    /*
     * The backstop under `begin`'s one promise: whoever took the antes has
     * already answered who is in this game, and nothing downstream re-checks
     * it. Handed an id that is not sitting at the table, the pot cannot be paid
     * — and the one thing that must not happen then is a history saying it was.
     */
    const bank = store();
    const adapter = liarsDiceAdapter({ roll: fives });
    const table = seated(adapter, ["a", "b"]);
    table.begin(["a", "ghost"]);
    while (table.game !== null && !table.game.over) {
      const bidder = table.game.round.toAct;
      const caller = table.game.round.order.find((one) => one !== bidder) as string;
      table.game.raise(bidder, { count: 1, face: 2 });
      table.game.call(caller, "liar");
      table.nextRound();
    }
    expect(table.game?.winnerId).toBe("ghost");

    await expect(adapter.settle(table, bank.deps)).rejects.toThrow("pot unpaid");

    expect(bank.deps.give).not.toHaveBeenCalled();
    expect(bank.deps.record).not.toHaveBeenCalled();
    expect(bank.deps.finished).not.toHaveBeenCalled();
  });

  it("pays nothing twice when a void arrives after the pot is settled", async () => {
    const bank = store();
    const adapter = liarsDiceAdapter({ roll: fives });
    const table = seated(adapter, ["a", "b"]);
    for (const one of ["a", "b"]) {
      bank.balances.set(one, 1_000);
    }
    allReady(table, ["a", "b"]);
    await deal(adapter, table, bank.deps);
    await playOut(adapter, table, bank.deps);
    await adapter.settle(table, bank.deps);

    expect(await adapter.void(table, bank.deps)).toEqual([]);
    const winner = table.game?.winnerId as string;
    expect(bank.balances.get(winner)).toBe(1_500);
  });

  it("records nothing at a for-fun table", async () => {
    const bank = store();
    const adapter = liarsDiceAdapter({ roll: fives });
    const table = seated(adapter, ["a", "b"], { forFun: true });
    table.begin(["a", "b"]);

    await playOut(adapter, table, bank.deps);
    await adapter.settle(table, bank.deps);

    expect(table.game?.over).toBe(true);
    // Paid, but into the table's own purse and into nobody's history.
    expect(table.purseFor(table.game?.winnerId as string)).toBe(11_000);
    expect(bank.deps.give).not.toHaveBeenCalled();
    expect(bank.deps.record).not.toHaveBeenCalled();
    expect(bank.deps.finished).not.toHaveBeenCalled();
  });
});

describe("calling the table off", () => {
  it("hands every ante back to whoever paid it", async () => {
    const bank = store();
    const adapter = liarsDiceAdapter({ roll: fives });
    const table = seated(adapter, ["a", "b"]);
    for (const one of ["a", "b"]) {
      bank.balances.set(one, 1_000);
    }
    allReady(table, ["a", "b"]);
    await deal(adapter, table, bank.deps);

    const owed = await adapter.void(table, bank.deps);

    expect(owed).toEqual([
      { userId: "a", chips: 500 },
      { userId: "b", chips: 500 },
    ]);
    expect(bank.balances.get("a")).toBe(1_000);
    expect(bank.balances.get("b")).toBe(1_000);
  });
});

describe("bots", () => {
  it("plays only at a for-fun table, and makes a legal move", () => {
    const adapter = liarsDiceAdapter({ roll: fives });
    const table = seated(adapter, ["a"], { forFun: true });
    table.addBot("bot", "Robot", "normal");
    table.begin(["a", "bot"]);
    // Get the turn onto the bot whichever way the opener fell.
    if (table.game?.round.toAct !== "bot") {
      table.game?.raise(table.game.round.toAct, { count: 1, face: 2 });
    }
    const move = adapter.botMove?.(table);
    expect(move?.seatId).toBe("bot");
    move?.play();
    const view = table.view(null);
    expect(view.bid !== null || view.resolution !== null).toBe(true);
  });

  it("is not offered a turn at a table playing for chips, because none can sit", () => {
    const adapter = liarsDiceAdapter({ roll: fives });
    const table = seated(adapter, ["a", "b"]);
    table.begin(["a", "b"]);
    expect(adapter.botMove?.(table)).toBe(null);
    expect(() => table.addBot("bot", "Robot", "normal")).toThrow("for fun");
  });
});

describe("the table's own clock", () => {
  const clocked = () => liarsDiceAdapter({ roll: fives, revealMs: 1_234, resultMs: 4_321 });

  it("waits on a reveal, then deals the next round", () => {
    const adapter = clocked();
    const table = seated(adapter, ["a", "b", "c"]);
    table.begin(["a", "b", "c"]);
    const first = table.game?.round.toAct as string;
    const second = table.game?.round.order[1] as string;
    // Nine dice, all of them fives, so a bid of six fives is good.
    table.game?.raise(first, { count: 6, face: 5 });
    table.game?.call(second, "liar");

    const pause = adapter.pause?.(table);

    expect(pause?.key).toBe("round");
    expect(pause?.ms).toBe(1_234);
    pause?.run();
    expect(table.view(null).round).toBe(2);
  });

  it("waits on a result, then clears the felt", async () => {
    const bank = store();
    const adapter = clocked();
    const table = seated(adapter, ["a", "b"]);
    table.begin(["a", "b"]);
    await playOut(adapter, table, bank.deps);

    const pause = adapter.pause?.(table);

    expect(pause?.key).toBe("result");
    expect(pause?.ms).toBe(4_321);
    pause?.run();
    expect(table.view(null).phase).toBe("waiting");
  });

  it("deals at once when everybody is ready", () => {
    const adapter = clocked();
    const table = seated(adapter, ["a", "b"]);
    allReady(table, ["a", "b"]);

    const pause = adapter.pause?.(table);

    expect(pause?.key).toBe("deal");
    expect(pause?.ms).toBe(0);
    pause?.run();
    expect(table.pending).toBe(true);
  });

  it("waits on a countdown while somebody is not ready", () => {
    const adapter = liarsDiceAdapter({ roll: fives, countdownMs: 5_000 });
    const table = seated(adapter, ["a", "b", "c"]);
    allReady(table, ["a", "b"]);

    const pause = adapter.pause?.(table);

    expect(pause?.key).toBe("countdown");
    expect(pause?.ms).toBeGreaterThan(0);
    expect(pause?.ms).toBeLessThanOrEqual(5_000);
  });

  it("wants nothing while the antes are being taken", () => {
    const adapter = clocked();
    const table = seated(adapter, ["a", "b"]);
    allReady(table, ["a", "b"]);
    table.askForGame(Date.now());
    expect(adapter.pause?.(table)).toBe(null);
  });
});
