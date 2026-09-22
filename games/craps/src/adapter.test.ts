import type { GameDeps } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { crapsAdapter } from "./adapter.js";
import { MIN_CHIP } from "./bank.js";
import type { Table } from "./table.js";

const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

/** A bank that starts with whatever the test says and refuses to overdraw. */
function bankOf(start: number) {
  let held = start;
  return {
    holds: async () => held,
    add: async (n: number) => {
      held += n;
    },
    take: async (n: number) => {
      if (n > held) return false;
      held -= n;
      return true;
    },
    /** Chips out from outside the book: another process, a hand on the database. */
    drain: (n: number) => {
      held -= n;
    },
    get held() {
      return held;
    },
  };
}

function deps(balances: Record<string, number>): GameDeps {
  return {
    take: async (userId: string, amount: number) => {
      if ((balances[userId] ?? 0) < amount) return false;
      balances[userId] = (balances[userId] ?? 0) - amount;
      return true;
    },
    give: async (userId: string, amount: number) => {
      balances[userId] = (balances[userId] ?? 0) + amount;
    },
    record: async () => {},
    finished: async () => {},
  };
}

/**
 * Dice a test can aim, in faces rather than in the indices `pick` deals in.
 *
 * `roll` asks for a face at a time, so a pair is two calls and aiming resets
 * the count — otherwise a test that re-aimed mid-pair would get one die from
 * each throw.
 */
function aimed(a: number, b: number) {
  let pair: readonly [number, number] = [a, b];
  let at = 0;
  return {
    pick: () => {
      const face = pair[at % 2] as number;
      at += 1;
      return face - 1;
    },
    aim: (x: number, y: number) => {
      pair = [x, y];
      at = 0;
    },
  };
}

/** One whole roll: the window shuts, the dice go, they land, the chips move. */
async function throwOnce(
  adapter: ReturnType<typeof crapsAdapter>,
  table: Table,
  d: GameDeps,
): Promise<void> {
  table.seal();
  await adapter.payOut?.(table, d);
  table.land();
  await adapter.settle(table, d);
  table.beginBetting();
}

describe("every stake is in the bank before the dice decide anything", () => {
  it("takes the chips off the account and puts them in the bank as they land", async () => {
    const bank = bankOf(1_000_000);
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const balances = { u1: 10_000 };
    await adapter.act(table, seat.id, { type: "place", spotId: "pass", chips: 300 }, deps(balances));
    expect(balances["u1"]).toBe(9_700);
    expect(bank.held).toBe(1_000_300);
  });

  it("puts the chips straight back when the cloth refuses them after the await", async () => {
    // Taking the chips is a round trip and the table does not stand still for
    // it: last call can arrive, the window can shut, the seat can go. The
    // chips are in the bank by then, so they come back out in full.
    const bank = bankOf(1_000_000);
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const balances = { u1: 10_000 };
    const d = deps(balances);
    // The table has to have something on it to seal, so give it one first.
    await adapter.act(table, seat.id, { type: "place", spotId: "pass", chips: 300 }, d);

    const slow: GameDeps = {
      ...d,
      take: async (userId: string, amount: number) => {
        const ok = await d.take(userId, amount);
        table.seal(); // the window shuts mid-await
        return ok;
      },
    };
    await expect(
      adapter.act(table, seat.id, { type: "place", spotId: "field", chips: 300 }, slow),
    ).rejects.toThrow();
    expect(balances["u1"]).toBe(9_700);
    expect(bank.held).toBe(1_000_300);
  });
});

describe("the off rule is decided inside the bank's queue", () => {
  it("reads the bank at the moment the dice go, not at the last broadcast", async () => {
    /*
     * A figure cached on the last broadcast is a guarantee made against a
     * number that may already be stale, and a stale guarantee is not one. So
     * the bank is emptied after the chip has been accepted and before the seal
     * — which is exactly the window a cached figure would sleep through.
     */
    const bank = bankOf(900);
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const d = deps({ u1: 1_000_000 });
    // Thirty to one on a chip of thirty is the whole of a nine hundred bank.
    await adapter.act(table, seat.id, { type: "place", spotId: "two", chips: MIN_CHIP }, d);
    bank.drain(900);

    table.seal();
    expect(await adapter.payOut?.(table, d)).toBe(true);
    expect(table.phase).toBe("rolling");
    expect(table.offByBank).toContain("two");
  });

  it("throws the dice once however many broadcasts ask", async () => {
    const bank = bankOf(1_000_000);
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const d = deps({ u1: 10_000 });
    await adapter.act(table, seat.id, { type: "place", spotId: "pass", chips: 300 }, d);
    table.seal();

    // Both in flight before either answers, which is the race the latch is for.
    const [first, second] = await Promise.all([
      adapter.payOut?.(table, d),
      adapter.payOut?.(table, d),
    ]);
    expect([first, second].filter((one) => one === true)).toHaveLength(1);
    expect(table.phase).toBe("rolling");
    expect(table.history).toEqual([]);
  });

  it("does not let the chips already on the cloth vouch for themselves", async () => {
    /*
     * Chips go into the bank as they land, and `working`, `owed` and
     * `headroom` all add them back themselves through `staked`. So the figure
     * handed to any of them is the bank *less* this cloth. Handed the stored
     * balance instead, the cloth is counted twice: the twelve is offered nine
     * hundred and sixty against a bank that can carry nine hundred and thirty,
     * the dice go anyway, and the winner is the one who finds out.
     */
    const bank = bankOf(27_000);
    const dice = aimed(6, 6);
    const adapter = crapsAdapter({ bank, pick: dice.pick });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const balances = { u1: 100_000 };
    const d = deps(balances);
    const refused = vi.spyOn(console, "error").mockImplementation(() => {});

    await adapter.act(table, seat.id, { type: "place", spotId: "two", chips: 900 }, d);
    await expect(
      adapter.act(table, seat.id, { type: "place", spotId: "twelve", chips: 960 }, d),
    ).rejects.toThrow(/930/);
    await adapter.act(table, seat.id, { type: "place", spotId: "twelve", chips: 930 }, d);

    await throwOnce(adapter, table, d);

    expect(refused).not.toHaveBeenCalled();
    expect(bank.held).toBe(0);
    expect(balances["u1"]).toBe(127_000);
    refused.mockRestore();
  });

  it("pays every winner it promised, whatever the dice did", async () => {
    // The property the whole package exists for, played out: a hundred rolls
    // against a real bank, and the bank never goes below nothing.
    const bank = bankOf(500_000);
    const adapter = crapsAdapter({ bank, pick: () => Math.floor(Math.random() * 6) });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const d = deps({ u1: 5_000_000 });
    const refused = vi.spyOn(console, "error").mockImplementation(() => {});
    const negative: number[] = [];
    for (let n = 0; n < 100; n += 1) {
      for (const spotId of ["place:6", "hard:8", "field", "two"]) {
        await adapter
          .act(table, seat.id, { type: "place", spotId, chips: MIN_CHIP * 10 }, d)
          .catch(() => {});
      }
      await throwOnce(adapter, table, d);
      if (bank.held < 0) negative.push(bank.held);
    }
    expect(negative).toEqual([]);
    // And never once had to log a refusal, which is what "impossible" means.
    expect(refused).not.toHaveBeenCalled();
    refused.mockRestore();
  });
});

describe("what a standing bet is allowed to do", () => {
  it("refuses to take down a bet the bank has already paid for", async () => {
    /*
     * The wheel's cover check with the thing only this cloth can do.
     *
     * A place bet is paid and stays down, so a bet's own stake can end up
     * being what paid for its win: a bank of a hundred and a six hundred on
     * the six pays seven hundred out of the seven hundred it is holding, and
     * six hundred of that was the player's own chip. The chip is still on the
     * felt and still theirs — but the bank has not got it any more, so taking
     * it down would be asking to be paid it a second time.
     */
    const bank = bankOf(100);
    const dice = aimed(4, 4);
    const adapter = crapsAdapter({ bank, pick: dice.pick });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const balances = { u1: 10_000 };
    const d = deps(balances);

    await adapter.act(table, seat.id, { type: "place", spotId: "place:6", chips: 600 }, d);
    // The come-out, which the six sleeps through: eight is the point.
    await throwOnce(adapter, table, d);
    expect(table.point).toBe(8);

    dice.aim(3, 3);
    await throwOnce(adapter, table, d);
    expect(balances["u1"]).toBe(10_100);
    expect(bank.held).toBe(0);
    expect(table.onSpot(seat.id, "place:6")).toBe(600);

    await expect(
      adapter.act(table, seat.id, { type: "take", spotId: "place:6", chips: 600 }, d),
    ).rejects.toThrow(/stay on the cloth/i);
    expect(table.onSpot(seat.id, "place:6")).toBe(600);
    expect(balances["u1"]).toBe(10_100);
    expect(bank.held).toBe(0);
  });

  it("skips a bet the come-out will not take and puts the rest down again", async () => {
    /*
     * "Same again" against a cloth whose spots are not all legal all the time.
     * A come bet in the box on the roll that sevens out is recorded as this
     * seat's last round, and the come-out in front of it will not take one —
     * so it is left out and the bets either side of it go down. Abandoning the
     * replay there would let one stale spot silently cancel the lot.
     */
    const bank = bankOf(1_000_000);
    const dice = aimed(4, 4);
    const adapter = crapsAdapter({ bank, pick: dice.pick });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const balances = { u1: 10_000 };
    const d = deps(balances);

    await adapter.act(table, seat.id, { type: "place", spotId: "pass", chips: 300 }, d);
    await throwOnce(adapter, table, d);
    expect(table.point).toBe(8);

    await adapter.act(table, seat.id, { type: "place", spotId: "come", chips: 300 }, d);
    await adapter.act(table, seat.id, { type: "place", spotId: "field", chips: 300 }, d);
    dice.aim(3, 4);
    await throwOnce(adapter, table, d);
    expect(table.point).toBeNull();

    await adapter.act(table, seat.id, { type: "repeat" }, d);
    expect(table.onSpot(seat.id, "come")).toBe(0);
    expect(table.onSpot(seat.id, "pass")).toBe(300);
    expect(table.onSpot(seat.id, "field")).toBe(300);
    expect(balances["u1"]).toBe(9_100);
  });

  it("turns a seat's numbers on for the come-out without moving a chip", async () => {
    const bank = bankOf(1_000_000);
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const balances = { u1: 10_000 };
    const d = deps(balances);
    await adapter.act(table, seat.id, { type: "place", spotId: "place:6", chips: 600 }, d);
    expect(table.worksFor(seat.id)).toBe(false);

    await adapter.act(table, seat.id, { type: "working", on: true }, d);

    expect(table.worksFor(seat.id)).toBe(true);
    // The chips were already down and already in the bank.
    expect(balances["u1"]).toBe(9_400);
    expect(bank.held).toBe(1_000_600);
  });
});

describe("what the table will not do", () => {
  it("refuses a bot at a table playing for chips", () => {
    const adapter = crapsAdapter({ bank: bankOf(1_000_000) });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    /*
     * The seating already refuses a bot here for want of an identity, so
     * getting one onto this cloth takes forcing it — which is the point. A
     * bot's chips are chips nobody won, and the refusal has to hold even when
     * something upstream has gone wrong.
     */
    seat.isBot = true;
    seat.waiting = false;
    expect(adapter.botMove?.(table)).toBeNull();
  });

  it("deals a bot in at a table playing for nothing", () => {
    const adapter = crapsAdapter({ bank: bankOf(1_000_000) });
    const table = adapter.create("AAAAA", { forFun: true }) as Table;
    const seat = table.join("s1", "Bot", null);
    seat.isBot = true;
    seat.waiting = false;
    expect(adapter.botMove?.(table)?.seatId).toBe("s1");
  });

  it("refuses to throw the dice for anybody but the shooter", async () => {
    vi.useFakeTimers();
    try {
      const adapter = crapsAdapter({ bank: bankOf(1_000_000) });
      const table = adapter.create("AAAAA") as Table;
      const one = table.join("s1", "Ada", who("u1"));
      const two = table.join("s2", "Bea", who("u2"));
      const d = deps({ u1: 10_000, u2: 10_000 });
      await adapter.act(table, one.id, { type: "place", spotId: "pass", chips: 300 }, d);
      // The dice are the shooter's, but the window is everybody's.
      vi.advanceTimersByTime(6_000);

      await expect(adapter.act(table, two.id, { type: "roll" }, d)).rejects.toThrow(/your dice/i);
      await adapter.act(table, one.id, { type: "roll" }, d);
      expect(table.phase).toBe("sealed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a move it has never heard of", async () => {
    const adapter = crapsAdapter({ bank: bankOf(1_000_000) });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const d = deps({ u1: 10_000 });
    await expect(adapter.act(table, seat.id, { type: "fiddle" }, d)).rejects.toThrow(/not a move/i);
  });
});

describe("calling the table off", () => {
  it("hands every chip still on the cloth back through the bank", async () => {
    const bank = bankOf(1_000_000);
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const balances = { u1: 10_000 };
    const d = deps(balances);
    await adapter.act(table, seat.id, { type: "place", spotId: "pass", chips: 300 }, d);
    await adapter.void(table, d);
    expect(balances["u1"]).toBe(10_000);
    expect(bank.held).toBe(1_000_000);
  });
});

describe("the table's own clock", () => {
  it("waits on the bank rather than on a clock once the window has shut", async () => {
    const bank = bankOf(1_000_000);
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const d = deps({ u1: 10_000 });
    await adapter.act(table, seat.id, { type: "place", spotId: "pass", chips: 300 }, d);

    expect(adapter.pause?.(table)?.key).toBe("betting");
    table.seal();
    expect(adapter.pause?.(table)).toBeNull();
    await adapter.payOut?.(table, d);
    expect(adapter.pause?.(table)?.key).toBe("rolling");
    table.land();
    expect(adapter.pause?.(table)?.key).toBe("settling");
    expect(adapter.isSettled(table)).toBe(true);
  });
});
