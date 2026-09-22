import type { GameDeps } from "@backroom/core";
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
    record: vi.fn(async () => undefined),
    finished: vi.fn(async () => undefined),
  } satisfies GameDeps;
  return { balances, deps };
};

const fives = () => 5 as Face;

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
  });

  it("refunds and does not deal somebody who left while the antes were taken", async () => {
    const table = seated(adapter, ["a", "b", "c"]);
    for (const one of ["a", "b", "c"]) {
      bank.balances.set(one, 1_000);
    }
    allReady(table, ["a", "b", "c"]);
    // c goes while the second ante is in flight.
    bank.deps.take.mockImplementation(async (userId: string, amount: number) => {
      if (userId === "b") {
        table.disconnect("c");
      }
      bank.balances.set(userId, (bank.balances.get(userId) ?? 0) - amount);
      return true;
    });

    await deal(adapter, table, bank.deps);

    expect(table.game?.players).toEqual(["a", "b"]);
    expect(bank.balances.get("c")).toBe(1_000);
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
    await adapter.act(table, first, { type: "bid", count: 4, face: 5 }, bank.deps);
    const second = table.game?.round.toAct as string;

    await adapter.act(table, second, { type: "liar" }, bank.deps);

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

    expect(bank.balances.get(winner)).toBe(1_500);
    expect(bank.balances.get(loser)).toBe(500);
    expect(bank.deps.record).toHaveBeenCalledTimes(2);
    expect(bank.deps.finished).toHaveBeenCalledTimes(1);
    expect(adapter.winners?.(table)).toEqual([winner]);
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
