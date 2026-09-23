import type { GameDeps } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { baccaratAdapter, type Bank } from "./adapter.js";
import { FUN_PURSE } from "./bank.js";

/**
 * A table playing for nothing, and what it must never cost.
 *
 * Play money lives at the table and dies with it. The way to check a promise
 * like that is to make breaking it loud, so both the economy and the store's
 * bank are handed in as things that record every question asked of them.
 */

function forbidden() {
  const touched: string[] = [];
  const deps: GameDeps = {
    async take(userId, amount) {
      touched.push(`take ${userId} ${amount}`);
      return true;
    },
    async give(userId, amount) {
      touched.push(`give ${userId} ${amount}`);
    },
    async record(userId) {
      touched.push(`record ${userId}`);
    },
    async finished() {
      touched.push("finished");
    },
  };
  return { deps, touched };
}

function watchedBank(start: number): Bank & { held: number; touched: string[] } {
  const bank = {
    held: start,
    touched: [] as string[],
    holds: async () => {
      bank.touched.push("holds");
      return bank.held;
    },
    add: async (amount: number) => {
      bank.touched.push(`add ${amount}`);
      bank.held += amount;
    },
    take: async (amount: number) => {
      bank.touched.push(`take ${amount}`);
      if (amount > bank.held) {
        return false;
      }
      bank.held -= amount;
      return true;
    },
  };
  return bank;
}

const funTable = () => {
  const bank = watchedBank(100_000);
  const adapter = baccaratAdapter({ bank, random: () => 0.5 });
  return { bank, adapter, table: adapter.create("FUN01", { forFun: true }) };
};

describe("a table playing for nothing", () => {
  it("costs the economy nothing, from the first chip to the last payout", async () => {
    const { bank, adapter, table } = funTable();
    const book = forbidden();

    // A guest and a signed-in player at the same table: neither is charged.
    table.join("a", "Ada", null);
    table.join("b", "Bram", { userId: "u2", avatar: null, accentColor: null });

    await adapter.act(table, "a", { type: "place", spotId: "player", chips: 500 }, book.deps);
    await adapter.act(table, "b", { type: "place", spotId: "banker", chips: 500 }, book.deps);
    table.closeBetting();
    table.land();
    expect(adapter.isSettled(table)).toBe(true);
    await adapter.payOut?.(table, book.deps);
    await adapter.settle(table, book.deps);

    /*
     * Not "took nothing" — never asked. A coup that cost nobody anything is
     * also on nobody's record, which is why `record` is in this list too.
     */
    expect(book.touched).toEqual([]);
    // And the store's bank was never so much as read.
    expect(bank.touched).toEqual([]);
    expect(bank.held).toBe(100_000);
  });

  it("spends the table's purse for a signed-in player, not their balance", async () => {
    /*
     * The branch that matters most in this file. A signed-in player sitting at
     * a for-fun table must spend play money; getting this wrong quietly spends
     * a real balance, which is real chips really gone.
     */
    const { adapter, table } = funTable();
    const book = forbidden();
    table.join("b", "Bram", { userId: "u2", avatar: null, accentColor: null });

    await adapter.act(table, "b", { type: "place", spotId: "player", chips: 500 }, book.deps);

    expect(table.purseFor("b")).toBe(FUN_PURSE - 500);
    expect(book.touched).toEqual([]);

    // And back into the purse when they change their mind, not into an account.
    await adapter.act(table, "b", { type: "take", spotId: "player", chips: 500 }, book.deps);
    expect(table.purseFor("b")).toBe(FUN_PURSE);
    expect(book.touched).toEqual([]);
  });

  it("refuses a chip bigger than the purse, and takes nothing", async () => {
    const { adapter, table } = funTable();
    const book = forbidden();
    table.join("a", "Ada", null);

    await expect(
      adapter.act(table, "a", { type: "place", spotId: "player", chips: FUN_PURSE + 500 }, book.deps),
    ).rejects.toThrow(/purse/i);
    expect(table.purseFor("a")).toBe(FUN_PURSE);
    expect(table.staked("a")).toBe(0);
  });

  it("deals a bot in and lets it pay for its own chip", async () => {
    /*
     * A bot's chip is staked synchronously, because `play()` cannot await. What
     * this is really checking is that the chip on the cloth was paid for: a bot
     * placing without staking would be paid out of the table's bank at
     * settlement as though it had.
     */
    const { adapter, table } = funTable();
    const bot = table.addBot("bot:1", "Dealer's mate", "normal");

    const move = adapter.botMove?.(table) ?? null;
    expect(move).not.toBeNull();
    expect(move?.seatId).toBe(bot.id);
    const bankBefore = table.funBank;

    move?.play();

    const staked = table.staked(bot.id);
    expect(staked).toBeGreaterThan(0);
    expect(table.purseFor(bot.id)).toBe(FUN_PURSE - staked);
    expect(table.funBank).toBe(bankBefore + staked);
  });

  it("will not seat a bot at a table playing for chips", async () => {
    // Chips are only ever won from real people; a bot has no account either way.
    const adapter = baccaratAdapter({ bank: watchedBank(100_000), random: () => 0.5 });
    const table = adapter.create("REAL1");
    expect(() => table.addBot("bot:1", "Dealer's mate", "normal")).toThrow(/for fun/i);
    expect(adapter.botMove?.(table) ?? null).toBeNull();
  });
});
