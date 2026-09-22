import type { GameDeps } from "@backroom/core";
import { TableError } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { twoUpAdapter } from "./adapter.js";
import { needed } from "./bank.js";
import { toBets } from "./bets.js";
import type { Table } from "./table.js";

/**
 * A bot at a for-fun table, through the door the server uses.
 *
 * `Table.addBot` refuses anywhere but a for-fun table, so this only works on
 * one — which is the point of going through it rather than dressing a joined
 * seat up as a bot.
 */
const sitBot = (table: Table, id: string, skill: "easy" | "normal" | "hard" = "normal") =>
  table.addBot(id, id, skill);

/** A store that remembers balances, so a test can assert on real movement. */
function purse(start: Record<string, number>) {
  const held = { ...start };
  const deps: GameDeps = {
    take: async (userId, amount) => {
      if ((held[userId] ?? 0) < amount) return false;
      held[userId] = (held[userId] ?? 0) - amount;
      return true;
    },
    give: async (userId, amount) => {
      held[userId] = (held[userId] ?? 0) + amount;
    },
    record: async () => {},
    finished: async () => {},
  };
  return { held, deps };
}

function bankOf(start: number) {
  let held = start;
  return {
    bank: {
      holds: async () => held,
      add: async (amount: number) => {
        held += amount;
      },
      take: async (amount: number) => {
        if (held < amount) return false;
        held -= amount;
        return true;
      },
    },
    read: () => held,
  };
}

const sit = (table: Table, id: string, userId: string) =>
  table.join(id, id, { userId, avatar: null, accentColor: null });

describe("a chip going down at a casino table", () => {
  it("leaves the account and enters the bank before anything is decided", async () => {
    const { held, deps } = purse({ u0: 1_000 });
    const { bank, read } = bankOf(100_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    expect(held["u0"]).toBe(900);
    expect(read()).toBe(100_100);
  });

  it("refuses a chip the bank could not cover", async () => {
    const { deps } = purse({ u0: 1_000_000 });
    const { bank } = bankOf(0);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    await expect(
      adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps),
    ).rejects.toThrow(/bank/i);
  });

  it("takes a matched chip a bank could not have covered on its own", async () => {
    /*
     * Two coins land one way or the other, so equal money on each side pays
     * one and keeps the other — between them they need no bank at all.
     *
     * The bank holds exactly a hundred, which covers the first chip and
     * nothing more. The second hundred goes down against the first rather than
     * against the bank, and once both are on the cloth the table is asking the
     * bank for nothing.
     *
     * It is a hundred and not nought because the FIRST chip has no matching
     * money behind it yet, and a chip nothing covers is a chip the bank has to
     * cover. An earlier version of this test seeded nought and expected both
     * to land, which the arithmetic in bank.ts correctly refuses.
     */
    const { deps } = purse({ u0: 1_000, u1: 1_000 });
    const { bank, read } = bankOf(100);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    await adapter.act(table, "s0", { type: "place", on: "tails", chips: 100 }, deps);
    await adapter.act(table, "s1", { type: "place", on: "heads", chips: 100 }, deps);
    expect(table.onCloth).toBe(200);
    /* Matched, so the cloth asks nothing of the bank. */
    expect(needed(toBets(table.placed))).toBe(0);
    /* And every chip staked is in the bank, which is where a payout comes from. */
    expect(read()).toBe(300);
  });

  it("pays a seat that stood up before the coins were read", async () => {
    /*
     * The chips do not leave with the player. A ring has no bank to absorb an
     * unpaid win, so a departed seat that is owed something and not paid is
     * chips destroyed — the mirror image of minting them, and the one thing
     * this school's arithmetic exists to rule out.
     *
     * Three at the table so removing one still leaves a ring; the spinner
     * throws tails, so the two coverers are the ones owed.
     */
    const { held, deps } = purse({ u0: 5_000, u1: 5_000, u2: 5_000 });
    const total = () => (held["u0"] ?? 0) + (held["u1"] ?? 0) + (held["u2"] ?? 0);
    const before = total();
    const adapter = twoUpAdapter({});
    const table = adapter.create("RING", { ruleset: "school" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    sit(table, "s2", "u2");
    const spinner = table.spinnerId ?? "s0";
    await adapter.act(table, spinner, { type: "centre", chips: 1_000 }, deps);
    const ring = table.seats.filter((one) => one.id !== spinner).map((one) => one.id);
    await adapter.act(table, ring[0] as string, { type: "cover", chips: 600 }, deps);
    await adapter.act(table, ring[1] as string, { type: "cover", chips: 400 }, deps);

    table.removeSeat(ring[0] as string);

    table.closeCovering();
    table.throwCoins(spinner, () => 0.9);
    table.land();
    table.read(() => 0.9);
    expect(table.decided).toBe("ring");
    await adapter.settle(table, deps);

    expect(total()).toBe(before);
  });

  it("gives a chip back out of the bank when it is taken off the cloth", async () => {
    /*
     * The same movement as a win, and it has to be: a player who could place
     * and unplace all evening against a bank that only ever took would be
     * filling it for nothing.
     */
    const { held, deps } = purse({ u0: 1_000 });
    const { bank, read } = bankOf(100_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    await adapter.act(table, "s0", { type: "clear" }, deps);
    expect(held["u0"]).toBe(1_000);
    expect(read()).toBe(100_000);
  });
});

describe("settling a casino round", () => {
  it("pays the winner out of the bank and never more than it holds", async () => {
    const { held, deps } = purse({ u0: 1_000 });
    const { bank, read } = bankOf(100_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    table.closeBetting();
    table.boxerThrows(() => 0.1);
    table.land();
    table.read(() => 0.1);
    expect(adapter.isSettled(table)).toBe(true);
    await adapter.settle(table, deps);
    expect(held["u0"]).toBe(1_100);
    expect(read()).toBe(99_900);
  });

  it("puts the round and its stake on the player's record", async () => {
    const { deps } = purse({ u0: 1_000 });
    const recorded: Array<{ userId: string; shared: Record<string, number> | undefined }> = [];
    deps.record = async (userId, bump) => {
      recorded.push({ userId, shared: bump.shared });
    };
    const { bank } = bankOf(100_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    table.closeBetting();
    table.boxerThrows(() => 0.1);
    table.land();
    table.read(() => 0.1);
    await adapter.settle(table, deps);

    expect(recorded).toEqual([
      {
        userId: "u0",
        shared: expect.objectContaining({ rounds: 1, roundsWon: 1, chipsStaked: 100 }),
      },
    ]);
  });
});

/*
 * Every casino school in the building is paid from one bank, and each used to
 * measure its cap against that bank minus only its own cloth — so a second
 * table read the first table's chips as bank and promised them again, and
 * whichever settled second found the bank empty and did not pay its winner.
 */
describe("a bank more than one casino table is paid from", () => {
  const heads = () => 0.1;
  const tails = () => 0.9;

  /** Shuts the window and throws until the round is called. */
  const playOut = (table: Table, coins: () => number) => {
    table.closeBetting();
    if (table.phase !== "kip") {
      return;
    }
    table.boxerThrows(coins);
    table.land();
    table.read(coins);
  };

  it("does not let one table promise chips another table's cloth is owed", async () => {
    const { held, deps } = purse({ u0: 1_000, u1: 1_000, u2: 3_000 });
    const { bank, read } = bankOf(1_000);
    const adapter = twoUpAdapter({ bank });
    const a = adapter.create("AAAA", { ruleset: "casino" });
    const b = adapter.create("BBBB", { ruleset: "casino" });
    sit(a, "s0", "u0");
    sit(a, "s1", "u1");
    sit(b, "s0", "u2");

    // Matched, so it asks nothing of the bank and puts 2,000 into it.
    await adapter.act(a, "s0", { type: "place", on: "heads", chips: 1_000 }, deps);
    await adapter.act(a, "s1", { type: "place", on: "tails", chips: 1_000 }, deps);
    await adapter.act(b, "s0", { type: "place", on: "tails", chips: 3_000 }, deps).catch((error) => {
      expect(error).toBeInstanceOf(TableError);
    });

    playOut(b, tails);
    await adapter.settle(b, deps);
    playOut(a, heads);
    expect(a.called).toBe("heads");
    await adapter.settle(a, deps);

    expect(held["u0"]).toBe(2_000);
    expect(read()).toBeGreaterThanOrEqual(0);
  });

  it.each([
    { type: "take", on: "heads", chips: 100 },
    { type: "undo" },
    { type: "clear" },
  ])("will not hand a chip back ($type) when the rest of the cloth would go unpaid", async (move) => {
    /*
     * Heads went down against the bank; tails was then allowed to lean on
     * heads. Take heads back and tails is owed 400 out of a bank of 300.
     */
    const { held, deps } = purse({ u0: 1_000, u1: 1_000 });
    const { bank } = bankOf(100);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");

    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    await adapter.act(table, "s1", { type: "place", on: "tails", chips: 200 }, deps);
    await adapter.act(table, "s0", move, deps).catch((error) => {
      expect(error).toBeInstanceOf(TableError);
    });

    playOut(table, tails);
    expect(table.called).toBe("tails");
    await adapter.settle(table, deps);

    expect(held["u1"]).toBe(1_200);
  });

  it("says so when the bank will not pay a winner", async () => {
    const complain = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { held, deps } = purse({ u0: 1_000 });
      const { bank, read } = bankOf(100_000);
      const adapter = twoUpAdapter({ bank });
      const table = adapter.create("ABCD", { ruleset: "casino" });
      sit(table, "s0", "u0");

      await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
      // Drained from somewhere nothing in this building accounts for.
      await bank.take(read());
      playOut(table, heads);
      await adapter.settle(table, deps);

      expect(held["u0"]).toBe(900);
      expect(complain).toHaveBeenCalled();
    } finally {
      complain.mockRestore();
    }
  });
});

describe("a traditional ring", () => {
  it("moves chips between the people at the table and touches no bank", async () => {
    const { held, deps } = purse({ u0: 5_000, u1: 5_000 });
    const { bank, read } = bankOf(100_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "school" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    await adapter.act(table, "s0", { type: "centre", chips: 1_000 }, deps);
    await adapter.act(table, "s1", { type: "cover", chips: 1_000 }, deps);
    expect(held["u0"]).toBe(4_000);
    expect(held["u1"]).toBe(4_000);
    expect(read()).toBe(100_000);

    table.closeCovering();
    for (let at = 0; at < 3; at += 1) {
      table.throwCoins("s0", () => 0.1);
      table.land();
      table.read(() => 0.1);
    }
    expect(table.decided).toBe("spinner");
    await adapter.settle(table, deps);
    expect(held["u0"]).toBe(6_000);
    expect(held["u1"]).toBe(4_000);
    expect(read()).toBe(100_000);
  });

  it("pays out exactly what was staked, whoever wins", async () => {
    const { held, deps } = purse({ u0: 5_000, u1: 5_000 });
    const adapter = twoUpAdapter({});
    const table = adapter.create("ABCD", { ruleset: "school" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    await adapter.act(table, "s0", { type: "centre", chips: 1_000 }, deps);
    await adapter.act(table, "s1", { type: "cover", chips: 1_000 }, deps);
    table.closeCovering();
    table.throwCoins("s0", () => 0.9);
    table.land();
    table.read(() => 0.9);
    expect(table.decided).toBe("ring");
    await adapter.settle(table, deps);
    expect(held["u0"] + held["u1"]).toBe(10_000);
    expect(held["u1"]).toBe(6_000);
  });

  it("puts a round on both records, the loser's included", async () => {
    /*
     * A ring pays only its winners, and a record written only where chips were
     * paid would give every ring a winner and no loser — a W–L that climbs on
     * one side forever. Both seats played the round and both staked into it.
     */
    const { deps } = purse({ u0: 5_000, u1: 5_000 });
    const recorded = new Map<string, Record<string, number> | undefined>();
    deps.record = async (userId, bump) => {
      recorded.set(userId, bump.shared);
    };
    const adapter = twoUpAdapter({});
    const table = adapter.create("ABCD", { ruleset: "school" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    await adapter.act(table, "s0", { type: "centre", chips: 1_000 }, deps);
    await adapter.act(table, "s1", { type: "cover", chips: 1_000 }, deps);
    table.closeCovering();
    table.throwCoins("s0", () => 0.9);
    table.land();
    table.read(() => 0.9);
    expect(table.decided).toBe("ring");
    await adapter.settle(table, deps);

    expect(recorded.get("u0")).toEqual(
      expect.objectContaining({ rounds: 1, roundsWon: 0, chipsStaked: 1_000 }),
    );
    expect(recorded.get("u1")).toEqual(
      expect.objectContaining({ rounds: 1, roundsWon: 1, chipsStaked: 1_000 }),
    );
  });
});

describe("who may sit at a table playing for chips", () => {
  it("refuses a bot in either school", () => {
    const adapter = twoUpAdapter({});
    for (const ruleset of ["casino", "school"] as const) {
      const table = adapter.create("ABCD", { ruleset });
      expect(table.forFun).toBe(false);
      // Bots are seated by the server only where forFun is true; the listing
      // and the table agree that a chips table has none.
      expect(adapter.botMove?.(table) ?? null).toBeNull();
    }
  });
});

describe("a bot's own chip at a for-fun table", () => {
  it("pays for the chip it puts down", () => {
    const adapter = twoUpAdapter({});
    const table = adapter.create("ABCD", { ruleset: "casino", forFun: true });
    const seat = sitBot(table, "bot0");
    // A fresh seat is `waiting: true`; beginRound deals it into the round.
    table.beginRound();

    const move = adapter.botMove?.(table) ?? null;
    expect(move).not.toBeNull();

    const purseBefore = table.purseFor(seat.id);
    const bankBefore = table.funBank;
    move?.play();

    const chips = table.staked(seat.id);
    expect(chips).toBeGreaterThan(0);
    expect(purseBefore - table.purseFor(seat.id)).toBe(chips);
    expect(table.funBank - bankBefore).toBe(chips);
  });
});

describe("a bot's moves in a for-fun ring", () => {
  it("is never offered a cover it cannot make", () => {
    /*
     * One bot only, and it is the spinner. A second, non-spinner bot would
     * also be a legal candidate to cover, and picking it up first (an
     * accident of seat order) would hide the bug rather than exercise it —
     * the spinner covering its own centre is the one move that must never be
     * offered, whatever else is at the table.
     */
    const adapter = twoUpAdapter({});
    const table = adapter.create("RING", { ruleset: "school", forFun: true });
    sitBot(table, "bot0");
    table.beginRound();

    const spinnerId = table.spinnerId;
    expect(spinnerId).not.toBeNull();
    if (spinnerId === null) {
      return;
    }
    table.setCentre(spinnerId, 500);
    expect(table.phase).toBe("covering");

    for (let at = 0; at < 20; at += 1) {
      const move = adapter.botMove?.(table) ?? null;
      if (move === null) {
        continue;
      }
      expect(move.seatId).not.toBe(spinnerId);
      move.play();
    }
    expect(table.covers.some((one) => one.seatId === spinnerId)).toBe(false);
  });
});

describe("what the host chose", () => {
  it("takes the school off the ruleset and defaults to casino", () => {
    const adapter = twoUpAdapter({});
    expect(adapter.create("A", { ruleset: "school" }).school).toBe("school");
    expect(adapter.create("B", {}).school).toBe("casino");
    expect(adapter.create("C", { ruleset: "nonsense" }).school).toBe("casino");
  });
});

describe("what a client is refused", () => {
  /*
   * The whole point of the security property: `boxerThrows`, `land` and
   * `read` are the table's own clock, deliberately left open to whoever
   * drives it, because "the boxer is the table itself". `act` is the only
   * door a client has, and it must not be a way to reach any of them.
   */
  it("refuses an action type this table has never heard of", async () => {
    const { deps } = purse({ u0: 1_000 });
    const adapter = twoUpAdapter({});
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    await expect(
      adapter.act(table, "s0", { type: "boxerThrows" }, deps),
    ).rejects.toThrow(/not a move/i);
    await expect(adapter.act(table, "s0", { type: "land" }, deps)).rejects.toThrow(/not a move/i);
    await expect(adapter.act(table, "s0", { type: "read" }, deps)).rejects.toThrow(/not a move/i);
  });

  it("refuses a throw from a seat that is not holding the kip", async () => {
    const { deps } = purse({ u0: 1_000, u1: 1_000 });
    const adapter = twoUpAdapter({});
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    table.closeBetting();
    // s0 holds the kip once the window shuts; s1 pressing it is refused by the
    // table itself, reached through the same `throw` action a spinner uses.
    await expect(adapter.act(table, "s1", { type: "throw" }, deps)).rejects.toThrow(TableError);
    await adapter.act(table, "s0", { type: "throw" }, deps);
    expect(table.phase).toBe("spinning");
  });
});

describe("a two-up table called off", () => {
  it("hands a casino chip back out of the bank", async () => {
    const { held, deps } = purse({ u0: 1_000 });
    const { bank, read } = bankOf(100_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);

    await adapter.void?.(table, deps);

    expect(held["u0"]).toBe(1_000);
    expect(read()).toBe(100_000);
  });

  it("returns a casino chip to somebody who leaves while bets are open", async () => {
    const { held, deps } = purse({ u0: 1_000 });
    const { bank, read } = bankOf(100_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);

    table.removeSeat("s0");
    await adapter.payOut?.(table, deps);

    expect(held["u0"]).toBe(1_000);
    expect(read()).toBe(100_000);
  });

  it("still pays a casino chip whose seat left once the window had shut", async () => {
    const { held, deps } = purse({ u0: 1_000 });
    const { bank } = bankOf(100_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    table.closeBetting();
    table.removeSeat("s0");
    table.boxerThrows(() => 0.1);
    table.land();
    table.read(() => 0.1);

    await adapter.settle(table, deps);

    expect(held["u0"]).toBe(1_100);
  });

  it("keeps the escrow and the cloth in step as chips go on and come off", async () => {
    const { bank } = bankOf(1_000_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    const { deps } = purse({ u0: 5_000 });

    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 200 }, deps);
    await adapter.act(table, "s0", { type: "place", on: "tails", chips: 100 }, deps);
    expect(table.escrow.total).toBe(table.onCloth);
    await adapter.act(table, "s0", { type: "take", on: "heads", chips: 50 }, deps);
    expect(table.escrow.total).toBe(table.onCloth);
    await adapter.act(table, "s0", { type: "undo" }, deps);
    expect(table.escrow.total).toBe(table.onCloth);
    await adapter.act(table, "s0", { type: "clear" }, deps);
    expect(table.escrow.total).toBe(0);
  });

  it("gives back a chip the table refused after it was paid for", async () => {
    const { bank, read } = bankOf(1_000_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    const { held, deps } = purse({ u0: 1_000 });
    // The window shuts while the account is being charged.
    const shutting: GameDeps = {
      ...deps,
      take: async (userId, amount) => {
        const ok = await deps.take(userId, amount);
        table.closeBetting();
        return ok;
      },
    };
    sit(table, "s1", "u1");
    // Somebody else's chip, so the cloth is not empty and the window really shuts.
    await adapter.act(table, "s1", { type: "place", on: "heads", chips: 25 }, purse({ u1: 100 }).deps);

    await expect(
      adapter.act(table, "s0", { type: "place", on: "heads", chips: 200 }, shutting),
    ).rejects.toThrow();

    expect(held["u0"]).toBe(1_000);
    expect(read()).toBe(1_000_025);
    expect(table.escrow.total).toBe(25);
  });

  it("stops holding the bank's chips for a table that has been called off", async () => {
    const { bank } = bankOf(1_000_000);
    const adapter = twoUpAdapter({ bank });
    const closed = adapter.create("ABCD", { ruleset: "casino" });
    sit(closed, "s0", "u0");
    const other = adapter.create("EFGH", { ruleset: "casino" });
    const { deps } = purse({ u0: 1_000 });
    await adapter.act(closed, "s0", { type: "place", on: "heads", chips: 200 }, deps);

    await adapter.void?.(closed, deps);

    const { ledgerOf } = await import("@backroom/core");
    expect(ledgerOf(bank).owedElsewhere(other)).toBe(0);
  });

  it("hands back a ring's centre and covers before the coins decide", async () => {
    const { held, deps } = purse({ u0: 1_000, u1: 1_000 });
    const adapter = twoUpAdapter();
    const table = adapter.create("ABCD", { ruleset: "school" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    table.beginRound();
    const spinner = table.spinnerId as string;
    const other = spinner === "s0" ? "s1" : "s0";
    await adapter.act(table, spinner, { type: "centre", chips: 200 }, deps);
    await adapter.act(table, other, { type: "cover", chips: 150 }, deps);
    expect(table.escrow.total).toBe(350);

    await adapter.void?.(table, deps);

    expect(held).toEqual({ u0: 1_000, u1: 1_000 });
  });

  it("does not hold a cover the table refused", async () => {
    const { deps } = purse({ u0: 1_000, u1: 1_000 });
    const adapter = twoUpAdapter();
    const table = adapter.create("ABCD", { ruleset: "school" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    table.beginRound();
    const spinner = table.spinnerId as string;
    await adapter.act(table, spinner, { type: "centre", chips: 200 }, deps);
    await expect(adapter.act(table, spinner, { type: "cover", chips: 100 }, deps)).rejects.toThrow();
    expect(table.escrow.total).toBe(200);
  });

  it("has nothing to hand back once a ring's coins have decided it", async () => {
    const { held, deps } = purse({ u0: 5_000, u1: 5_000 });
    const adapter = twoUpAdapter();
    const table = adapter.create("ABCD", { ruleset: "school" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    await adapter.act(table, "s0", { type: "centre", chips: 1_000 }, deps);
    await adapter.act(table, "s1", { type: "cover", chips: 1_000 }, deps);
    table.closeCovering();
    table.throwCoins("s0", () => 0.9);
    table.land();
    table.read(() => 0.9);
    expect(table.escrow.total).toBe(0);
    await adapter.settle(table, deps);

    expect(await adapter.void?.(table, deps)).toEqual([]);
    expect(held["u0"] + held["u1"]).toBe(10_000);
  });
});

/** A gate a test opens by hand, and a signal for when something reached it. */
function gate() {
  let open = () => {};
  let reached = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return { open, reached, opened, arrived };
}

describe("a two-up table's chips while the economy is being awaited", () => {
  it("lets a leaver's chip ride when another bet leans on it for cover", async () => {
    /*
     * Heads went down against a bank of 100; tails was then allowed to lean on
     * heads. Refunding heads to a seat that stood up would leave tails owed 400
     * out of a bank of 300 — the same take-back `giveBack` refuses.
     */
    const { held, deps } = purse({ u0: 1_000, u1: 1_000 });
    const { bank, read } = bankOf(100);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    await adapter.act(table, "s1", { type: "place", on: "tails", chips: 200 }, deps);

    table.removeSeat("s0");
    await adapter.payOut?.(table, deps);

    expect(table.staked("s0")).toBe(100);
    expect(held["u0"]).toBe(900);
    expect(read()).toBe(400);

    table.closeBetting();
    table.boxerThrows(() => 0.9);
    table.land();
    table.read(() => 0.9);
    expect(table.called).toBe("tails");
    await adapter.settle(table, deps);
    expect(held["u1"]).toBe(1_200);
  });

  it("pays a departed winner even when the next round opens mid-payment", async () => {
    const { held, deps } = purse({ u0: 1_000, u1: 1_000 });
    const { bank: inner } = bankOf(100_000);
    const first = gate();
    let taken = 0;
    const bank = {
      ...inner,
      take: async (amount: number) => {
        taken += 1;
        if (taken === 1) {
          first.reached();
          await first.opened;
        }
        return inner.take(amount);
      },
    };
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s1", "u1");
    sit(table, "s0", "u0");
    await adapter.act(table, "s1", { type: "place", on: "heads", chips: 100 }, deps);
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    table.closeBetting();
    table.removeSeat("s0");
    table.boxerThrows(() => 0.1);
    table.land();
    table.read(() => 0.1);

    const settling = adapter.settle(table, deps);
    await first.arrived;
    table.beginRound();
    first.open();
    await settling;

    expect(held["u1"]).toBe(1_100);
    expect(held["u0"]).toBe(1_100);
  });

  it("pays a ring's departed winner even when the next round opens mid-payment", async () => {
    const { held, deps: plain } = purse({ u0: 5_000, u1: 5_000, u2: 5_000 });
    const first = gate();
    let given = 0;
    const deps: GameDeps = {
      ...plain,
      give: async (userId, amount) => {
        given += 1;
        if (given === 1) {
          first.reached();
          await first.opened;
        }
        await plain.give(userId, amount);
      },
    };
    const adapter = twoUpAdapter({});
    const table = adapter.create("RING", { ruleset: "school" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    sit(table, "s2", "u2");
    await adapter.act(table, "s0", { type: "centre", chips: 1_000 }, deps);
    await adapter.act(table, "s1", { type: "cover", chips: 600 }, deps);
    await adapter.act(table, "s2", { type: "cover", chips: 400 }, deps);
    table.removeSeat("s2");
    table.closeCovering();
    table.throwCoins("s0", () => 0.9);
    table.land();
    table.read(() => 0.9);
    expect(table.decided).toBe("ring");

    const settling = adapter.settle(table, deps);
    await first.arrived;
    table.beginRound();
    first.open();
    await settling;

    expect((held["u0"] ?? 0) + (held["u1"] ?? 0) + (held["u2"] ?? 0)).toBe(15_000);
    expect(held["u2"]).toBe(5_400);
  });

  it("hands back only what the escrow still held when a void lands inside a take-back", async () => {
    const { held, deps } = purse({ u0: 1_000 });
    const { bank: inner, read } = bankOf(100_000);
    let reading: ReturnType<typeof gate> | null = null;
    const bank = {
      ...inner,
      holds: async () => {
        if (reading !== null) {
          reading.reached();
          await reading.opened;
        }
        return inner.holds();
      },
    };
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);

    const hold = gate();
    reading = hold;
    const clearing = adapter.act(table, "s0", { type: "clear" }, deps);
    await hold.arrived;
    const voiding = adapter.void?.(table, deps);
    reading = null;
    hold.open();
    await Promise.all([clearing, voiding]);

    expect(held["u0"]).toBe(1_000);
    expect(read()).toBe(100_000);
  });
});

describe("a two-up casino table's claim on the bank while it is being wound up", () => {
  it("keeps a called-off table's stakes owed until its refunds have left the bank", async () => {
    const { deps } = purse({ u0: 1_000 });
    const { bank: inner } = bankOf(1_000_000);
    let paying: ReturnType<typeof gate> | null = null;
    const bank = {
      ...inner,
      take: async (amount: number) => {
        if (paying !== null) {
          paying.reached();
          await paying.opened;
        }
        return inner.take(amount);
      },
    };
    const adapter = twoUpAdapter({ bank });
    const a = adapter.create("AAAA", { ruleset: "casino" });
    const b = adapter.create("BBBB", { ruleset: "casino" });
    sit(a, "s0", "u0");
    await adapter.act(a, "s0", { type: "place", on: "heads", chips: 200 }, deps);

    const { ledgerOf } = await import("@backroom/core");
    const hold = gate();
    paying = hold;
    const voiding = adapter.void?.(a, deps);
    await hold.arrived;
    expect(ledgerOf(bank).owedElsewhere(b)).toBeGreaterThanOrEqual(200);

    paying = null;
    hold.open();
    await voiding;
    expect(ledgerOf(bank).owedElsewhere(b)).toBe(0);
  });

  it("asks again about a leaver's chips once the bet leaning on them has gone", async () => {
    /*
     * Heads covers tails against a bank of 100, so heads leaving is refused.
     * Tails then leaves too, and with nobody left to spin the table, heads
     * must still be asked about again rather than stranded on the cloth.
     */
    const { held, deps } = purse({ u0: 1_000, u1: 1_000 });
    const { bank, read } = bankOf(100);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    await adapter.act(table, "s1", { type: "place", on: "tails", chips: 200 }, deps);

    table.removeSeat("s0");
    await adapter.payOut?.(table, deps);
    expect(held["u0"]).toBe(900);

    table.removeSeat("s1");
    await adapter.payOut?.(table, deps);

    expect(held).toEqual({ u0: 1_000, u1: 1_000 });
    expect(read()).toBe(100);
    expect(table.onCloth).toBe(0);
    expect(table.escrow.total).toBe(0);
  });
});
