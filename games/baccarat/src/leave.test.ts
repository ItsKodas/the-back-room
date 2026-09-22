import type { GameDeps } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { baccaratAdapter, type Bank } from "./adapter.js";

/**
 * Standing up from a baccarat table, which is how chips would otherwise vanish.
 *
 * A chip goes into the bank the moment it lands, so a seat that left with chips
 * on the cloth would have them filtered off and the bank would simply keep them
 * — for a coup the player never saw. The server calls `removeSeat` and then
 * broadcasts, and a broadcast is what asks `payOut`, so that is the order here.
 */

const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

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
    record: async () => {},
    finished: async () => {},
  };
  return { deps, balances, given };
}

describe("leaving a baccarat table", () => {
  it("hands back chips placed in a window that never dealt", async () => {
    const bank = bankOf(100_000);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("LEAVE");
    table.join("a", "Ada", who("u1"));
    const { deps, balances } = depsOf({ u1: 1_000 });

    await adapter.act(table, "a", { type: "place", spotId: "player", chips: 500 }, deps);
    table.removeSeat("a");
    await adapter.payOut?.(table, deps);

    expect(balances["u1"]).toBe(1_000);
    expect(bank.held).toBe(100_000);
    expect(table.placed).toEqual([]);
    expect(table.leaving.size).toBe(0);
  });

  it("keeps a leaver's chips down while another bet is leaning on them", async () => {
    /*
     * The bank's own five hundred covers Player alone. Banker's thousand then
     * leans on it: with both down, Banker coming in costs the bank less than
     * its own holding, because Player's money is there to pay with. Handing
     * Player back would leave Banker owed more than the bank holds — so it
     * stays, and comes off the moment Banker does.
     */
    const bank = bankOf(500);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("LEAVE");
    table.join("a", "Ada", who("u1"));
    table.join("b", "Bo", who("u2"));
    const { deps, balances } = depsOf({ u1: 1_000, u2: 2_000 });

    await adapter.act(table, "a", { type: "place", spotId: "player", chips: 500 }, deps);
    await adapter.act(table, "b", { type: "place", spotId: "banker", chips: 1_000 }, deps);

    table.removeSeat("a");
    await adapter.payOut?.(table, deps);

    // Refused, and still on the list rather than quietly dropped.
    expect(balances["u1"]).toBe(500);
    expect(table.leaving.has("a")).toBe(true);
    expect(table.placed).toHaveLength(2);

    // Banker comes off, and with it the reason Player had to stay.
    await adapter.act(table, "b", { type: "take", spotId: "banker", chips: 1_000 }, deps);
    await adapter.payOut?.(table, deps);

    expect(balances["u1"]).toBe(1_000);
    expect(balances["u2"]).toBe(2_000);
    expect(table.leaving.size).toBe(0);
    expect(table.placed).toEqual([]);
    expect(bank.held).toBe(500);
  });

  it("still pays a bet that was already riding when they stood up", async () => {
    /*
     * Chips on both sides, so whatever the shoe says there is something to pay
     * — which is what makes this a test of who gets paid rather than of what
     * the coup happened to be.
     */
    const bank = bankOf(100_000);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("LEAVE");
    table.join("a", "Ada", who("u1"));
    const { deps, balances, given } = depsOf({ u1: 2_000 });

    await adapter.act(table, "a", { type: "place", spotId: "player", chips: 500 }, deps);
    await adapter.act(table, "a", { type: "place", spotId: "banker", chips: 500 }, deps);
    table.closeBetting();
    // Once the window has shut, whatever is down rides.
    table.removeSeat("a");
    await adapter.payOut?.(table, deps);
    table.land();
    await adapter.settle(table, deps);

    const back = table.paid?.get("a")?.back ?? 0;
    expect(back).toBeGreaterThan(0);
    expect(balances["u1"]).toBe(1_000 + back);
    expect(given).toContainEqual({ userId: "u1", amount: back });
    // Nothing left the building: the bank is up by exactly what it kept.
    expect(bank.held + (balances["u1"] ?? 0)).toBe(102_000);
  });
});
