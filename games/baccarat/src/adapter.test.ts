import type { GameDeps } from "@backroom/core";
import { ledgerOf } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { baccaratAdapter, type Bank } from "./adapter.js";
import { headroom, owed } from "./bank.js";
import { toBets } from "./bets.js";
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

/**
 * The same bank, made to stop on its next read or payout until a test lets go.
 *
 * What a store on the other side of a network does anyway: the table carries
 * on with its own clock while the answer is on its way, and the one stage of
 * `owing` with no other way to observe it is the stage that only exists in
 * that gap. Roulette's `gated` fixture, which the same argument produced.
 */
function gatedBank(start: number): Bank & {
  held: number;
  stallNext: (on: "holds" | "take") => { reached: Promise<void>; open: () => void };
} {
  const inner = bankOf(start);
  let stall: { on: "holds" | "take"; hit: () => void; open: Promise<void> } | null = null;
  const pause = async (on: "holds" | "take") => {
    if (stall?.on !== on) {
      return;
    }
    const stopped = stall;
    stall = null;
    stopped.hit();
    await stopped.open;
  };
  return {
    get held() {
      return inner.held;
    },
    holds: async () => {
      await pause("holds");
      return inner.holds();
    },
    add: inner.add,
    take: async (amount: number) => {
      await pause("take");
      return inner.take(amount);
    },
    stallNext(on) {
      let hit = () => {};
      let open = () => {};
      const reached = new Promise<void>((resolve) => {
        hit = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      stall = { on, hit, open: gate };
      return { reached, open };
    },
  };
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
    /*
     * The tie pays nine for one, so a chip on it is the table promising eight
     * times that chip out of its own pocket. What makes that safe is arithmetic
     * rather than luck: the cap comes from the worst outcome this cloth can
     * produce, so the bank covers the tie whether or not the tie is what comes
     * out of the shoe.
     *
     * This coup is a banker natural, so the tie in fact loses and the bank
     * keeps the stake. The figure it *would* have owed is asserted anyway,
     * before a card is dealt — an assertion that only watched the money move
     * would pass just as happily against a table that paid nobody at all.
     */
    const bank = bankOf(50_000);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("AAAAA");
    seat(table, "a", "u1");
    const { deps, balances } = depsOf({ u1: 1_000_000 });

    // Fifty thousand behind a lone tie buys six and a quarter, and not a chip more.
    expect(headroom(50_000, [], "tie")).toBe(6_250);
    await expect(
      adapter.act(table, "a", { type: "place", spotId: "tie", chips: 6_251 }, deps),
    ).rejects.toThrow(/bank/i);

    await adapter.act(table, "a", { type: "place", spotId: "tie", chips: 5_000 }, deps);
    // In the bank before the shoe is touched, and the worst it could be asked
    // for is already covered by what the bank is holding.
    expect(bank.held).toBe(55_000);
    expect(owed(toBets(table.placed))).toBe(45_000);
    expect(owed(toBets(table.placed))).toBeLessThanOrEqual(bank.held);

    table.closeBetting();
    table.land();
    await adapter.settle(table, deps);

    expect(table.coup?.outcome).toBe("banker");
    expect(bank.held).toBe(55_000);
    expect(balances["u1"]).toBe(995_000);
  });
});

/*
 * Every baccarat table in the building is paid from one bank. A table that
 * measured its cap against that bank minus only its own cloth would read every
 * other table's chips as headroom — chips those tables' winners are already
 * owed — and promise them a second time. Whichever table settled last would
 * find the bank empty and its winner simply not paid.
 */
describe("a bank more than one table is paid from", () => {
  it("does not let one table promise chips another table's cloth is owed", async () => {
    const bank = bankOf(1_000);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const a = adapter.create("AAAAA");
    const b = adapter.create("BBBBB");
    seat(a, "s1", "u1");
    seat(a, "s2", "u2");
    seat(b, "s1", "u3");
    const { deps, balances } = depsOf({ u1: 1_000, u2: 1_000, u3: 3_000 });

    // A matched pair on the first table: the two sides cannot both come in, so
    // it asks almost nothing of the bank and puts two thousand into it.
    await adapter.act(a, "s1", { type: "place", spotId: "player", chips: 1_000 }, deps);
    await adapter.act(a, "s2", { type: "place", spotId: "banker", chips: 1_000 }, deps);
    expect(bank.held).toBe(3_000);

    /*
     * Which the second table must not spend. A bank of three thousand covers
     * this chip comfortably on its own — what it cannot cover is this chip and
     * the two thousand the first table's cloth is already owed. Refusing it is
     * the fix; taking it and short-paying somebody an hour later is the bug.
     */
    await expect(
      adapter.act(b, "s1", { type: "place", spotId: "banker", chips: 2_000 }, deps),
    ).rejects.toThrow(/bank/i);

    /*
     * And still refused once the first table's coup has landed and not yet
     * been paid. What it owes is a decided figure by then rather than a worst
     * case, and it is no less owed for that.
     */
    a.closeBetting();
    a.land();
    await expect(
      adapter.act(b, "s1", { type: "place", spotId: "banker", chips: 2_000 }, deps),
    ).rejects.toThrow(/bank/i);

    // Paid, and only now are those chips the second table's to promise.
    await adapter.settle(a, deps);
    expect(bank.held).toBe(1_050);
    await adapter.act(b, "s1", { type: "place", spotId: "banker", chips: 1_000 }, deps);
    b.closeBetting();
    b.land();
    await adapter.settle(b, deps);

    // Both winners paid in full, and not a chip in the building unaccounted for.
    expect(balances["u2"]).toBe(1_950);
    expect(balances["u3"]).toBe(3_950);
    expect(bank.held).toBe(100);
    expect((balances["u1"] ?? 0) + 1_950 + 3_950 + bank.held).toBe(6_000);
  });

  it("stops holding the bank's chips for a table that has been called off", async () => {
    /*
     * A called-off table's cloth still has chips on it — they have just been
     * handed back, and nothing clears the objects — so a promise read off that
     * cloth would reserve the bank's chips forever, for a table nobody will
     * ever sit at again.
     *
     * Asserted as what the other table is actually offered rather than only as
     * a figure in the book, because that is the thing anybody would notice: the
     * chip refused below is the same chip, on the same bank, before and after.
     */
    const bank = bankOf(1_000);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const closed = adapter.create("AAAAA");
    const other = adapter.create("BBBBB");
    seat(closed, "s1", "u1");
    seat(other, "s1", "u2");
    const { deps, balances } = depsOf({ u1: 1_000, u2: 1_000 });

    await adapter.act(closed, "s1", { type: "place", spotId: "player", chips: 500 }, deps);
    expect(ledgerOf(bank).owedElsewhere(other)).toBe(1_000);
    await expect(
      adapter.act(other, "s1", { type: "place", spotId: "player", chips: 600 }, deps),
    ).rejects.toThrow(/bank/i);

    await adapter.void(closed, deps);

    expect(ledgerOf(bank).owedElsewhere(other)).toBe(0);
    await adapter.act(other, "s1", { type: "place", spotId: "player", chips: 600 }, deps);
    expect(other.staked("s1")).toBe(600);
    // The called-off table's chips went home rather than into the other table's cap.
    expect(balances["u1"]).toBe(1_000);
    expect(balances["u2"]).toBe(400);
    expect(bank.held).toBe(1_600);
  });

  /*
   * The fourth and last thing a table can owe: a coup that has been decided,
   * handed to `settle`, and is still waiting its turn in the bank's queue.
   *
   * The other three are read off the table itself — the cloth's worst case
   * while bets are open, the coup's decided figure once it lands, and a
   * called-off table's unpaid refunds. This one cannot be, because the table
   * does not wait for its own payout: it sweeps the cloth on its own clock,
   * and a swept cloth says nothing about what the last coup is still owed. So
   * it is tracked apart, and if it were not, the gap between the sweep and the
   * store answering is a window in which a second table reads the winner's
   * chips as headroom and promises them again.
   */
  it("keeps a settled coup's payout in the book until it has left the bank", async () => {
    const bank = gatedBank(100_000);
    const adapter = baccaratAdapter({ bank, random: () => 0.5 });
    const table = adapter.create("AAAAA");
    const other = adapter.create("BBBBB");
    seat(table, "a", "u1");
    const { deps, balances } = depsOf({ u1: 1_000 });

    await adapter.act(table, "a", { type: "place", spotId: "banker", chips: 500 }, deps);
    table.closeBetting();
    table.land();
    // Banker came in, so five hundred is owed a thousand back less the five
    // per cent the house charges on it: 1,000 - ceil(500/20) = 975.
    expect(table.coup?.outcome).toBe("banker");

    const { reached, open } = bank.stallNext("take");
    const settling = adapter.settle(table, deps);
    await reached;
    // The table's own clock comes round while the store is still answering.
    table.beginBetting();

    expect(ledgerOf(bank).owedElsewhere(other)).toBe(975);

    open();
    await settling;

    expect(ledgerOf(bank).owedElsewhere(other)).toBe(0);
    expect(balances["u1"]).toBe(1_475);
    expect(bank.held).toBe(99_525);
  });

  it("says so when the bank will not pay a winner", async () => {
    /*
     * Unreachable from inside this building, which is exactly when a refusal
     * has to be loud: a bank drained from somewhere nothing here accounts for —
     * another process, a hand on the database — must leave something in the log
     * rather than a winner quietly unpaid and a bank quietly going negative.
     */
    const complain = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const bank = bankOf(100_000);
      const adapter = baccaratAdapter({ bank, random: () => 0.5 });
      const table = adapter.create("AAAAA");
      seat(table, "a", "u1");
      const { deps, balances, given } = depsOf({ u1: 2_000 });

      await adapter.act(table, "a", { type: "place", spotId: "banker", chips: 500 }, deps);
      await bank.take(bank.held);

      table.closeBetting();
      table.land();
      await adapter.settle(table, deps);

      // Banker came in, so there was a winner and nine hundred and seventy-five
      // owed to them. Nothing moved, and the log says which table and how much.
      expect(table.coup?.outcome).toBe("banker");
      expect(complain).toHaveBeenCalledWith(expect.stringContaining("AAAAA"));
      expect(given).toEqual([]);
      expect(balances["u1"]).toBe(1_500);
      expect(bank.held).toBe(0);
    } finally {
      complain.mockRestore();
    }
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
