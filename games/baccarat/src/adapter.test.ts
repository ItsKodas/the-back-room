import type { GameDeps } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { baccaratAdapter, type Bank } from "./adapter.js";
import type { Table } from "./table.js";

/** A bank that holds a figure, like the store's but in memory. */
function bankOf(start: number): Bank & { held: number } {
  const bank = {
    held: start,
    holds: async () => bank.held,
    add: async (amount: number) => {
      bank.held += amount;
    },
    take: async (amount: number) => {
      if (amount > bank.held) {
        return false;
      }
      bank.held -= amount;
      return true;
    },
  };
  return bank;
}

/** Accounts, and a record of what was asked of them. */
function depsOf(balances: Record<string, number>) {
  const given: Array<{ userId: string; amount: number }> = [];
  const deps: GameDeps = {
    take: async (userId, amount) => {
      if ((balances[userId] ?? 0) < amount) {
        return false;
      }
      balances[userId] = (balances[userId] ?? 0) - amount;
      return true;
    },
    give: async (userId, amount) => {
      balances[userId] = (balances[userId] ?? 0) + amount;
      given.push({ userId, amount });
    },
    record: vi.fn(async () => {}),
    finished: vi.fn(async () => {}),
  };
  return { deps, balances, given };
}

const seat = (table: Table, id: string, userId: string) =>
  table.join(id, id, { userId, avatar: null, accentColor: null });

describe("a chip going down", () => {
  it("leaves the account and enters the bank before anything is decided", async () => {
    const bank = bankOf(100_000);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("AAAAA");
    seat(table, "a", "u1");
    const { deps, balances } = depsOf({ u1: 1_000 });

    await adapter.act(table, "a", { type: "place", spotId: "player", chips: 100 }, deps);

    expect(balances["u1"]).toBe(900);
    expect(bank.held).toBe(100_100);
    expect(table.staked("a")).toBe(100);
  });

  it("refuses a chip the bank cannot cover, and takes nothing", async () => {
    const bank = bankOf(0);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("AAAAA");
    seat(table, "a", "u1");
    const { deps, balances } = depsOf({ u1: 1_000 });

    await expect(
      adapter.act(table, "a", { type: "place", spotId: "tie", chips: 100 }, deps),
    ).rejects.toThrow(/bank/i);
    expect(balances["u1"]).toBe(1_000);
    expect(table.staked("a")).toBe(0);
  });

  it("refuses somebody who has not got the chips", async () => {
    const bank = bankOf(100_000);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("AAAAA");
    seat(table, "a", "u1");
    const { deps } = depsOf({ u1: 50 });

    await expect(
      adapter.act(table, "a", { type: "place", spotId: "player", chips: 100 }, deps),
    ).rejects.toThrow(/do not have the chips/i);
  });

  it("refuses a guest at a table playing for chips", () => {
    const adapter = baccaratAdapter({ bank: bankOf(100_000), random: () => 0.5 });
    const table = adapter.create("AAAAA");
    // Seating refuses outright; the adapter's own "Sign in" guard is the
    // second lock on the same door and is not reachable through a real seat.
    expect(() => table.join("a", "a", null)).toThrow(/sign in/i);
  });

  it("lets matched money on out of a bank that could not cover either side alone", async () => {
    /*
     * The bank covers Player's five hundred and not a chip more. Banker can
     * then go down for twice that, because the two sides cannot both come in:
     * between them they need almost no bank at all.
     */
    const bank = bankOf(500);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("AAAAA");
    seat(table, "a", "u1");
    seat(table, "b", "u2");
    const { deps } = depsOf({ u1: 1_000, u2: 2_000 });

    await adapter.act(table, "a", { type: "place", spotId: "player", chips: 500 }, deps);
    await adapter.act(table, "b", { type: "place", spotId: "banker", chips: 1_000 }, deps);
    expect(table.staked("b")).toBe(1_000);
  });

  it("would not have covered that chip without the money on the other side", async () => {
    // The control for the test above: same bank, same chip, no matched money.
    const bank = bankOf(500);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("AAAAA");
    seat(table, "b", "u2");
    const { deps } = depsOf({ u2: 2_000 });

    await expect(
      adapter.act(table, "b", { type: "place", spotId: "banker", chips: 1_000 }, deps),
    ).rejects.toThrow(/bank/i);
  });
});

describe("taking a chip back", () => {
  it("pays it out of the bank, the way a win is paid", async () => {
    // Otherwise a player could fill the bank by placing and unplacing all evening.
    const bank = bankOf(100_000);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("AAAAA");
    seat(table, "a", "u1");
    const { deps, balances } = depsOf({ u1: 1_000 });

    await adapter.act(table, "a", { type: "place", spotId: "player", chips: 100 }, deps);
    await adapter.act(table, "a", { type: "take", spotId: "player", chips: 100 }, deps);

    expect(balances["u1"]).toBe(1_000);
    expect(bank.held).toBe(100_000);
  });

  it("refuses a chip that is covering another bet", async () => {
    /*
     * Player went down against the bank's own five hundred; Banker was then
     * allowed to lean on Player for twice that, because the two sides cannot
     * both come in. Taking Player back leaves Banker owed more than the bank
     * holds — the floor is five hundred, and the shortfall goes from minus
     * fifty to plus four hundred and fifty — so the chip stays.
     */
    const bank = bankOf(500);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("AAAAA");
    seat(table, "a", "u1");
    seat(table, "b", "u2");
    const { deps } = depsOf({ u1: 1_000, u2: 2_000 });

    await adapter.act(table, "a", { type: "place", spotId: "player", chips: 500 }, deps);
    await adapter.act(table, "b", { type: "place", spotId: "banker", chips: 1_000 }, deps);
    await expect(
      adapter.act(table, "a", { type: "take", spotId: "player", chips: 500 }, deps),
    ).rejects.toThrow(/covering another bet/i);
  });
});

describe("settling a coup", () => {
  it("pays the winners out of the bank and records the round", async () => {
    const bank = bankOf(100_000);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("AAAAA");
    seat(table, "a", "u1");
    const { deps, balances } = depsOf({ u1: 1_000 });

    await adapter.act(table, "a", { type: "place", spotId: "player", chips: 100 }, deps);
    table.closeBetting();
    table.land();
    expect(adapter.isSettled(table)).toBe(true);
    await adapter.settle(table, deps);

    const outcome = table.coup?.outcome;
    if (outcome === "player") {
      expect(balances["u1"]).toBe(1_100);
    } else if (outcome === "tie") {
      expect(balances["u1"]).toBe(1_000);
    } else {
      expect(balances["u1"]).toBe(900);
    }
    expect(deps.record).toHaveBeenCalled();
  });

  it("never pays out more than the bank was holding", async () => {
    const bank = bankOf(50_000);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("AAAAA");
    seat(table, "a", "u1");
    const { deps } = depsOf({ u1: 1_000_000 });

    await adapter.act(table, "a", { type: "place", spotId: "tie", chips: 5_000 }, deps);
    table.closeBetting();
    table.land();
    await adapter.settle(table, deps);
    expect(bank.held).toBeGreaterThanOrEqual(0);
  });
});

describe("calling the table off", () => {
  it("hands every chip back through the bank", async () => {
    const bank = bankOf(100_000);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("AAAAA");
    seat(table, "a", "u1");
    const { deps, balances } = depsOf({ u1: 1_000 });

    await adapter.act(table, "a", { type: "place", spotId: "player", chips: 100 }, deps);
    const refunded = await adapter.void(table, deps);

    expect(refunded).toEqual([{ userId: "u1", chips: 100 }]);
    expect(balances["u1"]).toBe(1_000);
    expect(bank.held).toBe(100_000);
  });
});
