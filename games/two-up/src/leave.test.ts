import type { GameDeps } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { twoUpAdapter } from "./adapter.js";
import type { Table } from "./table.js";

/**
 * Standing up from a two-up table before the round is played.
 *
 * A casino chip is in the bank the moment it lands, so a seat that left with
 * chips on the cloth had them filtered off and the bank kept them. A ring
 * holds its centre while anybody is left to hold it for — and when the last
 * of them went, the table closed with the centre still on it.
 */

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

const sit = (table: Table, id: string, userId: string) =>
  table.join(id, id, { userId, avatar: null, accentColor: null });

describe("leaving a casino school", () => {
  it("hands back chips placed in a window that never threw", async () => {
    const { held, deps } = accounts({ u0: 1_000 });
    const { bank, read } = bankOf(100_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("LEAVE", { ruleset: "casino" });
    sit(table, "s0", "u0");

    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    table.removeSeat("s0");
    await adapter.payOut?.(table, deps);

    expect(held["u0"]).toBe(1_000);
    expect(read()).toBe(100_000);
    expect(table.placed).toEqual([]);
  });

  it("still pays a bet that was already in the air when they stood up", async () => {
    const { held, deps } = accounts({ u0: 1_000 });
    const { bank, read } = bankOf(100_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("LEAVE", { ruleset: "casino" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");

    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    table.closeBetting();
    table.removeSeat("s0");
    await adapter.payOut?.(table, deps);
    table.boxerThrows(() => 0.1);
    table.land();
    table.read(() => 0.1);
    await adapter.settle(table, deps);

    expect(held["u0"]).toBe(1_100);
    expect(read()).toBe(99_900);
  });
});

describe("leaving a ring", () => {
  it("hands back the centre and the covers when the last player goes", async () => {
    const { held, deps } = accounts({ u0: 5_000, u1: 5_000 });
    const adapter = twoUpAdapter({});
    const table = adapter.create("RING", { ruleset: "school" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    const spinner = table.spinnerId ?? "s0";
    const other = spinner === "s0" ? "s1" : "s0";

    await adapter.act(table, spinner, { type: "centre", chips: 1_000 }, deps);
    await adapter.act(table, other, { type: "cover", chips: 600 }, deps);

    table.removeSeat(other);
    await adapter.payOut?.(table, deps);
    // One left is a ring waiting for company, felt untouched.
    expect(table.centre).not.toBeNull();

    table.removeSeat(spinner);
    await adapter.payOut?.(table, deps);

    expect(held["u0"]).toBe(5_000);
    expect(held["u1"]).toBe(5_000);
    expect(table.centre).toBeNull();
    expect(table.covers).toEqual([]);
  });
});
