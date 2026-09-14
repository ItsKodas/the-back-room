import type { GameDeps } from "@backroom/core";
import { TableError } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { twoUpAdapter } from "./adapter.js";
import { needed } from "./bank.js";
import { toBets } from "./bets.js";
import type { Table } from "./table.js";

/**
 * A bot at a for-fun table.
 *
 * `Table` has no `addBot`; a bot is a seat like any other with `isBot` and
 * `skill` set on it. A fresh seat is `waiting: true` here whatever the table's
 * history — `Table.status` never reports "lobby" — so `beginRound()` is what
 * deals it in, exactly as the brief's note says.
 */
const sitBot = (table: Table, id: string, skill: "easy" | "normal" | "hard" = "normal") => {
  const seat = table.join(id, id, null);
  seat.isBot = true;
  seat.skill = skill;
  return seat;
};

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

/*
 * Every casino school in the building is paid from one bank, and each used to
 * measure its cap against that bank minus only its own cloth — so a second
 * table read the first table's chips as bank and promised them again, and
 * whichever settled second found the bank empty and did not pay its winner.
 */
describe("a bank more than one casino table is paid from", () => {
  const heads = () => 0.1;
  const tails = () => 0.9;

  /** Shuts the window and throws until the round is called. */
  const playOut = (table: Table, coins: () => number) => {
    table.closeBetting();
    if (table.phase !== "kip") {
      return;
    }
    table.boxerThrows(coins);
    table.land();
    table.read(coins);
  };

  it("does not let one table promise chips another table's cloth is owed", async () => {
    const { held, deps } = purse({ u0: 1_000, u1: 1_000, u2: 3_000 });
    const { bank, read } = bankOf(1_000);
    const adapter = twoUpAdapter({ bank });
    const a = adapter.create("AAAA", { ruleset: "casino" });
    const b = adapter.create("BBBB", { ruleset: "casino" });
    sit(a, "s0", "u0");
    sit(a, "s1", "u1");
    sit(b, "s0", "u2");

    // Matched, so it asks nothing of the bank and puts 2,000 into it.
    await adapter.act(a, "s0", { type: "place", on: "heads", chips: 1_000 }, deps);
    await adapter.act(a, "s1", { type: "place", on: "tails", chips: 1_000 }, deps);
    await adapter.act(b, "s0", { type: "place", on: "tails", chips: 3_000 }, deps).catch((error) => {
      expect(error).toBeInstanceOf(TableError);
    });

    playOut(b, tails);
    await adapter.settle(b, deps);
    playOut(a, heads);
    expect(a.called).toBe("heads");
    await adapter.settle(a, deps);

    expect(held["u0"]).toBe(2_000);
    expect(read()).toBeGreaterThanOrEqual(0);
  });

  it.each([
    { type: "take", on: "heads", chips: 100 },
    { type: "undo" },
    { type: "clear" },
  ])("will not hand a chip back ($type) when the rest of the cloth would go unpaid", async (move) => {
    /*
     * Heads went down against the bank; tails was then allowed to lean on
     * heads. Take heads back and tails is owed 400 out of a bank of 300.
     */
    const { held, deps } = purse({ u0: 1_000, u1: 1_000 });
    const { bank } = bankOf(100);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");

    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
    await adapter.act(table, "s1", { type: "place", on: "tails", chips: 200 }, deps);
    await adapter.act(table, "s0", move, deps).catch((error) => {
      expect(error).toBeInstanceOf(TableError);
    });

    playOut(table, tails);
    expect(table.called).toBe("tails");
    await adapter.settle(table, deps);

    expect(held["u1"]).toBe(1_200);
  });

  it("says so when the bank will not pay a winner", async () => {
    const complain = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { held, deps } = purse({ u0: 1_000 });
      const { bank, read } = bankOf(100_000);
      const adapter = twoUpAdapter({ bank });
      const table = adapter.create("ABCD", { ruleset: "casino" });
      sit(table, "s0", "u0");

      await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);
      // Drained from somewhere nothing in this building accounts for.
      await bank.take(read());
      playOut(table, heads);
      await adapter.settle(table, deps);

      expect(held["u0"]).toBe(900);
      expect(complain).toHaveBeenCalled();
    } finally {
      complain.mockRestore();
    }
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

describe("a bot's own chip at a for-fun table", () => {
  it("pays for the chip it puts down", () => {
    const adapter = twoUpAdapter({});
    const table = adapter.create("ABCD", { ruleset: "casino", forFun: true });
    const seat = sitBot(table, "bot0");
    // A fresh seat is `waiting: true`; beginRound deals it into the round.
    table.beginRound();

    const move = adapter.botMove?.(table) ?? null;
    expect(move).not.toBeNull();

    const purseBefore = table.purseFor(seat.id);
    const bankBefore = table.funBank;
    move?.play();

    const chips = table.staked(seat.id);
    expect(chips).toBeGreaterThan(0);
    expect(purseBefore - table.purseFor(seat.id)).toBe(chips);
    expect(table.funBank - bankBefore).toBe(chips);
  });
});

describe("a bot's moves in a for-fun ring", () => {
  it("is never offered a cover it cannot make", () => {
    /*
     * One bot only, and it is the spinner. A second, non-spinner bot would
     * also be a legal candidate to cover, and picking it up first (an
     * accident of seat order) would hide the bug rather than exercise it —
     * the spinner covering its own centre is the one move that must never be
     * offered, whatever else is at the table.
     */
    const adapter = twoUpAdapter({});
    const table = adapter.create("RING", { ruleset: "school", forFun: true });
    sitBot(table, "bot0");
    table.beginRound();

    const spinnerId = table.spinnerId;
    expect(spinnerId).not.toBeNull();
    if (spinnerId === null) {
      return;
    }
    table.setCentre(spinnerId, 500);
    expect(table.phase).toBe("covering");

    for (let at = 0; at < 20; at += 1) {
      const move = adapter.botMove?.(table) ?? null;
      if (move === null) {
        continue;
      }
      expect(move.seatId).not.toBe(spinnerId);
      move.play();
    }
    expect(table.covers.some((one) => one.seatId === spinnerId)).toBe(false);
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
