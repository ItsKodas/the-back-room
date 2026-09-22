import type { GameDeps } from "@backroom/core";
import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { pokerAdapter } from "./adapter.js";
import type { Table } from "./table.js";

const identity = (userId: string) => ({ userId, avatar: null, accentColor: null });

function wallet(start: Record<string, number>) {
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

/** Two players bought in at a chips table, a hand dealt and some chips in the middle. */
async function midHand() {
  const adapter = pokerAdapter();
  const table = adapter.create("CHP01", { buyIn: 2_000 }) as Table;
  table.join("a", "Ada", identity("u1"));
  table.join("b", "Bram", identity("u2"));
  const { held, deps } = wallet({ u1: 10_000, u2: 10_000 });
  await adapter.act(table, "a", { type: "buyIn" }, deps);
  await adapter.act(table, "b", { type: "buyIn" }, deps);
  table.deal();
  return { adapter, table, held, deps };
}

/**
 * Three players bought in at a chips table, a hand dealt and some chips in
 * the middle.
 *
 * Seated three deep rather than heads up so a leaver's fold does not itself
 * end the hand — heads up, folding hands the pot to the other player and
 * there is nothing left mid-hand for a void to be tested against.
 */
async function midHandThree() {
  const adapter = pokerAdapter();
  const table = adapter.create("CHP01", { buyIn: 2_000 }) as Table;
  table.join("a", "Ada", identity("u1"));
  table.join("b", "Bram", identity("u2"));
  table.join("c", "Cato", identity("u3"));
  const { held, deps } = wallet({ u1: 10_000, u2: 10_000, u3: 10_000 });
  await adapter.act(table, "a", { type: "buyIn" }, deps);
  await adapter.act(table, "b", { type: "buyIn" }, deps);
  await adapter.act(table, "c", { type: "buyIn" }, deps);
  table.deal();
  return { adapter, table, held, deps };
}

/** Every chip an account could claim: stacks in front of seats plus the pot, ghosts included. */
const onTable = (table: Table) =>
  table.seats.reduce((total, seat) => total + seat.stack, 0) + table.pot;

describe("what a client is refused", () => {
  it("refuses a raise to a number that is not one", async () => {
    /*
     * The socket envelope validates the action's `type` and nothing else, so
     * `amount` arrives as whatever the client sent and `Number("x")` is
     * `NaN`. Every bound `raise` checks is a comparison, and a comparison
     * against `NaN` is false — so it walked past "more than a call", past
     * "you cannot cover that" and past the minimum, and `put` subtracted it
     * from the stack. Every chip on the table stopped being a number.
     */
    const { adapter, table, deps } = await midHand();
    const seatId = table.toAct as string;
    const before = onTable(table);

    await expect(
      adapter.act(table, seatId, { type: "raise", amount: "x" }, deps),
    ).rejects.toThrow(TableError);

    expect(onTable(table)).toBe(before);
    expect(table.seats.every((seat) => Number.isInteger(seat.stack))).toBe(true);
  });
});

describe("a poker table called off mid-hand", () => {
  it("hands every account back its stack and what it had bet", async () => {
    const { adapter, table, held, deps } = await midHand();
    expect(table.pot).toBeGreaterThan(0);
    expect(table.escrow.total).toBe(onTable(table));

    await adapter.void?.(table, deps);

    expect(held).toEqual({ u1: 10_000, u2: 10_000 });
  });

  it("gives a leaver their stack now and their bet back if the hand is called off", async () => {
    const { adapter, table, held, deps } = await midHandThree();
    const bet = table.seats.find((seat) => seat.id === "a")?.paid ?? 0;
    table.leave("a");
    await adapter.payOut?.(table, deps);
    expect(held["u1"]).toBe(10_000 - bet);

    await adapter.void?.(table, deps);
    expect(held).toEqual({ u1: 10_000, u2: 10_000, u3: 10_000 });
  });

  it("keeps the claim equal to the chips on the table across a finished hand", async () => {
    const { adapter, table, deps } = await midHand();
    for (let guard = 0; guard < 50 && table.street !== "showdown"; guard += 1) {
      const toAct = table.toAct;
      if (toAct === null) break;
      const seat = table.seats.find((one) => one.id === toAct);
      table.act(toAct, table.owed(seat as never) > 0 ? "call" : "check");
    }
    expect(table.street).toBe("showdown");
    expect(table.escrow.total).toBe(onTable(table));
    await adapter.void?.(table, deps);
  });

  it("gives back a buy-in whose seat went while the chips were being taken", async () => {
    const adapter = pokerAdapter();
    const table = adapter.create("CHP01", { buyIn: 2_000 }) as Table;
    table.join("a", "Ada", identity("u1"));
    table.join("b", "Bram", identity("u2"));
    const { held, deps } = wallet({ u1: 10_000, u2: 10_000 });
    const leaving: GameDeps = {
      ...deps,
      take: async (userId, amount) => {
        const ok = await deps.take(userId, amount);
        table.leave("a");
        return ok;
      },
    };

    await expect(adapter.act(table, "a", { type: "buyIn" }, leaving)).rejects.toThrow();
    expect(held["u1"]).toBe(10_000);
  });
});
