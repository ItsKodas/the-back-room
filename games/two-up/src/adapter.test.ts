import type { GameDeps } from "@backroom/core";
import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { twoUpAdapter } from "./adapter.js";
import { needed } from "./bank.js";
import { toBets } from "./bets.js";
import type { Table } from "./table.js";

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
