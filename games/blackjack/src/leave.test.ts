import type { GameDeps } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { blackjackAdapter } from "./adapter.js";

/**
 * Standing up from the felt before the cards come out.
 *
 * A stake leaves the account and enters the bank the moment it is placed, and
 * the betting window is the table's lobby — so a leave, or a refresh that
 * outlived the grace period, removed the seat there and then and the bank kept
 * a bet for a hand that was never dealt.
 */

const identity = (userId: string) => ({ userId, avatar: null, accentColor: null });

function accounts(start: Record<string, number>) {
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

describe("leaving a blackjack table while bets are open", () => {
  it("hands the stake back out of the bank", async () => {
    const { held, deps } = accounts({ u1: 10_000 });
    const { bank, read } = bankOf(100_000);
    const game = blackjackAdapter({ bank });
    const table = game.create("LEAVE");
    table.join("a", "Ada", identity("u1"));

    await game.act(table, "a", { type: "bet", amount: 1_000 }, deps);
    expect(held["u1"]).toBe(9_000);

    table.removeSeat("a");
    await game.payOut?.(table, deps);

    expect(held["u1"]).toBe(10_000);
    expect(read()).toBe(100_000);
  });

  it("hands it back at a table with no bank, too", async () => {
    const { held, deps } = accounts({ u1: 10_000 });
    const game = blackjackAdapter();
    const table = game.create("LEAVE");
    table.join("a", "Ada", identity("u1"));
    table.join("z", "Bo", identity("u2"));

    await game.act(table, "a", { type: "bet", amount: 1_000 }, deps);
    table.removeSeat("a");
    await game.payOut?.(table, deps);

    expect(held["u1"]).toBe(10_000);
  });

  it("pays it once, however many broadcasts ask", async () => {
    const { held, deps } = accounts({ u1: 10_000 });
    const { bank } = bankOf(100_000);
    const game = blackjackAdapter({ bank });
    const table = game.create("LEAVE");
    table.join("a", "Ada", identity("u1"));

    await game.act(table, "a", { type: "bet", amount: 1_000 }, deps);
    table.removeSeat("a");
    await Promise.all([game.payOut?.(table, deps), game.payOut?.(table, deps)]);

    expect(held["u1"]).toBe(10_000);
  });
});
