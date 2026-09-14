import type { GameDeps } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { rouletteAdapter } from "./adapter.js";

/**
 * Standing up from a wheel, which is how chips used to vanish.
 *
 * A chip goes into the bank the moment it lands, so a seat that left with
 * chips on the cloth had them filtered off and the bank simply kept them — for
 * a spin the player never saw. The server calls `removeSeat` and then
 * broadcasts, and a broadcast is what asks `payOut`, so that is the order here.
 */

const RED = "even:1-3-5-7-9-12-14-16-18-19-21-23-25-27-30-32-34-36";
const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

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

describe("leaving a wheel", () => {
  it("hands back chips placed in a window that never spun", async () => {
    const { held, deps } = accounts({ u1: 1_000 });
    const { bank, read } = bankOf(100_000);
    const game = rouletteAdapter({ bank, pick: () => 1 });
    const table = game.create("LEAVE");
    table.join("s1", "Ada", who("u1"));

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    table.removeSeat("s1");
    await game.payOut?.(table, deps);

    expect(held["u1"]).toBe(1_000);
    expect(read()).toBe(100_000);
    expect(table.placed).toEqual([]);
  });

  it("still pays a bet that was already riding when they stood up", async () => {
    // 32 is red, so 200 on red comes back as 400.
    const { held, deps } = accounts({ u1: 1_000 });
    const { bank, read } = bankOf(100_000);
    const game = rouletteAdapter({ bank, pick: () => 1 });
    const table = game.create("LEAVE");
    table.join("s1", "Ada", who("u1"));
    table.join("s2", "Bo", who("u2"));

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    table.closeBetting();
    table.removeSeat("s1");
    await game.payOut?.(table, deps);
    table.land();
    await game.settle(table, deps);

    expect(held["u1"]).toBe(1_200);
    expect(read()).toBe(99_800);
  });

  it("lets chips ride rather than hand back one another seat's bet leans on", async () => {
    /*
     * The bank's own hundred covers red alone. Black's two hundred then leans
     * on red: with both down, black winning costs the bank only its hundred.
     * Handing red back would leave black needing two hundred the bank has not
     * got — so red stays on the cloth, spins, and is paid to its owner.
     */
    const BLACK = "even:2-4-6-8-10-11-13-15-17-20-22-24-26-28-29-31-33-35";
    const { held, deps } = accounts({ u1: 1_000, u2: 1_000 });
    const { bank, read } = bankOf(100);
    const game = rouletteAdapter({ bank, pick: () => 1 });
    const table = game.create("LEAVE");
    table.join("s1", "Ada", who("u1"));
    table.join("s2", "Bo", who("u2"));

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 100 }, deps);
    await game.act(table, "s2", { type: "place", spotId: BLACK, chips: 200 }, deps);
    table.removeSeat("s1");
    await game.payOut?.(table, deps);

    expect(held["u1"]).toBe(900);
    table.closeBetting();
    table.land();
    await game.settle(table, deps);

    // Red won: its owner is paid, and nothing left the building.
    expect(held["u1"]).toBe(1_100);
    expect((held["u1"] ?? 0) + (held["u2"] ?? 0) + read()).toBe(2_100);
  });
});
