import type { GameDeps } from "@backroom/core";
import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { twoUpAdapter } from "./adapter.js";
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

  it("takes a matched chip against an empty bank", async () => {
    /*
     * The table working on its first night. Nothing in the bank, but a hundred
     * is already on tails, so a hundred on heads is riskless.
     */
    const { deps } = purse({ u0: 1_000, u1: 1_000 });
    const { bank } = bankOf(0);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    await adapter.act(table, "s0", { type: "place", on: "tails", chips: 100 }, deps);
    await adapter.act(table, "s1", { type: "place", on: "heads", chips: 100 }, deps);
    expect(table.onCloth).toBe(200);
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
