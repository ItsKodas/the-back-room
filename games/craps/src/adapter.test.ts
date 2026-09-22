import type { GameDeps } from "@backroom/core";
import { ledgerOf, TableError } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { crapsAdapter } from "./adapter.js";
import { MIN_CHIP } from "./bank.js";
import type { Table } from "./table.js";

const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

/** An account that always has chips, and a note of everything asked of it. */
const spy = () => {
  const took = vi.fn(async () => true);
  const gave = vi.fn(async () => {});
  const kept = vi.fn(async () => {});
  const deps = {
    take: took,
    give: gave,
    record: kept,
    finished: vi.fn(async () => {}),
  } as unknown as GameDeps;
  return { deps, took, gave, kept };
};

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

/**
 * A bank that stops on its next read or payout until a test lets it go.
 *
 * What a store on the other side of a network does anyway: the table carries
 * on with its own clock while the answer is on its way, and these tests are
 * about what it gets up to in the meantime.
 */
function gated(start: number) {
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
    bank: {
      holds: async () => {
        await pause("holds");
        return inner.holds();
      },
      add: inner.add,
      take: async (amount: number) => {
        await pause("take");
        return inner.take(amount);
      },
    },
    read: () => inner.held,
    stallNext(on: "holds" | "take") {
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

/** Everything queued behind whatever is holding the bank's queue, and then some. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the only number a browser gets to choose is the one it staked", () => {
  it("ignores a chip count that is not a number", async () => {
    /*
     * The socket envelope validates the action's `type` and passes every other
     * field through exactly as it arrived, so this adapter is where a number
     * from a browser stops being whatever the browser said it was. `place` was
     * already saved by the table's own integer test; `take` was not.
     * `Math.min(pile.chips, NaN)` is `NaN` and `off === 0` does not catch it,
     * so one message turned the pile, the cloth, the bank and the balance all
     * into NaN — and a NaN reaches the store.
     */
    const bank = bankOf(1_000_000);
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const balances = { u1: 10_000 };
    const d = deps(balances);
    await adapter.act(table, seat.id, { type: "place", spotId: "field", chips: 300 }, d);

    for (const chips of ["x", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
      await adapter.act(table, seat.id, { type: "take", spotId: "field", chips }, d);
    }

    expect(table.onSpot(seat.id, "field")).toBe(300);
    expect(bank.held).toBe(1_000_300);
    expect(balances["u1"]).toBe(9_700);
  });

  it("refuses a bet whose stake is not a number", async () => {
    const bank = bankOf(1_000_000);
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const balances = { u1: 10_000 };
    const d = deps(balances);

    await expect(
      adapter.act(table, seat.id, { type: "place", spotId: "field", chips: "300" }, d),
    ).rejects.toThrow(TableError);

    expect(table.placed).toEqual([]);
    expect(bank.held).toBe(1_000_000);
    expect(balances["u1"]).toBe(10_000);
  });
});

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

describe("play money, and the line it never crosses", () => {
  it("never touches an account at a table playing for nothing", async () => {
    /*
     * The rule this test exists for is in CLAUDE.md in so many words: play
     * money never touches an account. It is also the mistake that has actually
     * happened in this repo — a verification run opened a chips table by
     * accident and spent somebody's real balance — so the assertion is not
     * that the right amount moved but that nothing was asked of the account
     * at all.
     */
    const game = crapsAdapter({ pick: () => 5 });
    const table = game.create("ABCDE", { forFun: true }) as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps: d, took, gave, kept } = spy();

    await game.act(table, "s1", { type: "place", spotId: "field", chips: 300 }, d);
    await throwOnce(game, table, d);

    expect(took).not.toHaveBeenCalled();
    expect(gave).not.toHaveBeenCalled();
    // Nor is a win at a for-fun table a win anybody's profile should claim.
    expect(kept).not.toHaveBeenCalled();
  });

  it("spends the table's purse instead, and pays back into it", async () => {
    // Boxcars, and the field pays four to one on it.
    const game = crapsAdapter({ pick: () => 5 });
    const table = game.create("ABCDE", { forFun: true }) as Table;
    table.join("s1", "Ada", null);
    const { deps: d } = spy();
    const before = table.purseFor("s1");
    const bankBefore = table.funBank;

    await game.act(table, "s1", { type: "place", spotId: "field", chips: 300 }, d);
    expect(table.purseFor("s1")).toBe(before - 300);
    expect(table.funBank).toBe(bankBefore + 300);

    await throwOnce(game, table, d);

    expect(table.purseFor("s1")).toBe(before + 900);
    expect(table.funBank).toBe(bankBefore - 900);
  });

  it("lets a guest play for nothing and refuses them chips", () => {
    const forFun = crapsAdapter({});
    const free = forFun.create("ABCDE", { forFun: true }) as Table;
    expect(() => free.join("s1", "Ada", null)).not.toThrow();

    const chips = crapsAdapter({ bank: bankOf(1_000_000) });
    const paid = chips.create("FGHIJ") as Table;
    expect(() => paid.join("s1", "Ada", null)).toThrow(TableError);
  });

  it("makes a bot pay for the chip it puts down", () => {
    /*
     * A bot plays through the table directly, not through `act`, so nothing
     * about `act` paying for a chip reaches it. Without its own stake the chip
     * lands paid for by nobody, and settlement then pays the bot out of the
     * table's bank as though it had put the chip in.
     */
    const game = crapsAdapter({});
    const table = game.create("ABCDE", { forFun: true }) as Table;
    const seat = table.join("b1", "Bot", null);
    seat.isBot = true;
    seat.skill = "normal";
    // A seat that sits down mid-window waits for the next one.
    table.beginBetting();

    const move = game.botMove?.(table) ?? null;
    expect(move).not.toBeNull();
    const purseBefore = table.purseFor("b1");
    const bankBefore = table.funBank;
    move?.play();

    const chips = table.staked("b1");
    expect(chips).toBeGreaterThan(0);
    expect(purseBefore - table.purseFor("b1")).toBe(chips);
    expect(table.funBank - bankBefore).toBe(chips);
  });

  it("gives a bot its chip back when the table refuses it", () => {
    const game = crapsAdapter({});
    const table = game.create("ABCDE", { forFun: true }) as Table;
    const seat = table.join("b1", "Bot", null);
    seat.isBot = true;
    seat.skill = "normal";
    table.beginBetting();

    const move = game.botMove?.(table) ?? null;
    expect(move).not.toBeNull();
    const purseBefore = table.purseFor("b1");
    const bankBefore = table.funBank;
    // It thought right through last call.
    table.deadline = Date.now();
    move?.play();

    expect(table.staked("b1")).toBe(0);
    expect(table.purseFor("b1")).toBe(purseBefore);
    expect(table.funBank).toBe(bankBefore);
  });
});

describe("a bank more than one table is paid from", () => {
  it("does not let one table promise chips another table's cloth is still carrying", async () => {
    /*
     * The wheel owes nothing once it has paid. This table has just been paid
     * and is still carrying a six thousand place six into the next roll, and
     * the bank is holding the chips that bet will be paid out of. A second
     * table reading that as nothing would promise them again, and whichever
     * settled second would find the bank empty.
     */
    const bank = bankOf(1_000);
    const first = crapsAdapter({ bank, pick: () => 3 });
    const second = crapsAdapter({ bank, pick: () => 3 });
    const a = first.create("AAAAA") as Table;
    const b = second.create("BBBBB") as Table;
    a.join("s1", "Ada", who("u1"));
    b.join("s1", "Cleo", who("u3"));
    const { deps: d } = spy();

    await first.act(a, "s1", { type: "place", spotId: "place:6", chips: 6_000 }, d);
    a.seal();
    await first.payOut?.(a, d);
    a.land();
    await first.settle(a, d);

    // Before the next window opens, which is when the cloth speaks for itself.
    await expect(
      second.act(b, "s1", { type: "place", spotId: "two", chips: MIN_CHIP }, d),
    ).rejects.toThrow(TableError);
    expect(b.placed).toEqual([]);
  });

  it("holds the bank still between reading it and the dice deciding", async () => {
    /*
     * The whole reason the release joins the bank's own queue. With the store
     * taking its time over the figure the off rule is about to be decided
     * against, nothing else paid from that bank may move a chip in the
     * meantime — so the second table's stake waits, rather than landing in a
     * bank the first table has already read.
     */
    const { bank, stallNext } = gated(1_000_000);
    const first = crapsAdapter({ bank, pick: () => 3 });
    const second = crapsAdapter({ bank, pick: () => 3 });
    const a = first.create("AAAAA") as Table;
    const b = second.create("BBBBB") as Table;
    a.join("s1", "Ada", who("u1"));
    b.join("s1", "Cleo", who("u3"));
    const { deps: d, took } = spy();

    await first.act(a, "s1", { type: "place", spotId: "pass", chips: 300 }, d);
    took.mockClear();
    a.seal();

    const { reached, open } = stallNext("holds");
    const releasing = first.payOut?.(a, d);
    await reached;
    const placing = second.act(b, "s1", { type: "place", spotId: "pass", chips: 300 }, d);
    await settled();
    expect(took).not.toHaveBeenCalled();

    open();
    await releasing;
    await placing;
    expect(took).toHaveBeenCalledWith("u3", 300);
  });

  it("counts everybody's chips against the bank, not just yours", async () => {
    /*
     * One pair of dice settles both of these, so the second player's chip has
     * to be measured against what the first already put down. A per-seat cap
     * would wave it through and leave the bank short.
     */
    const bank = bankOf(900);
    const game = crapsAdapter({ bank });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    table.join("s2", "Bram", who("u2"));
    const { deps: d } = spy();

    await game.act(table, "s1", { type: "place", spotId: "two", chips: MIN_CHIP }, d);
    await expect(
      game.act(table, "s2", { type: "place", spotId: "two", chips: MIN_CHIP }, d),
    ).rejects.toThrow(TableError);
  });

  it("says so when the bank will not pay a winner", async () => {
    /*
     * Unreachable from inside this building now, which is exactly when a
     * refusal has to be loud: a bank drained from somewhere nothing here
     * accounts for — another process, a hand on the database — must leave
     * something in the log rather than a winner quietly unpaid.
     *
     * Emptied after the dice have gone, because emptying it before would only
     * turn the field off, which is the table working exactly as designed.
     */
    const complain = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const bank = bankOf(1_000_000);
      const game = crapsAdapter({ bank, pick: () => 5 });
      const table = game.create("ABCDE") as Table;
      table.join("s1", "Ada", who("u1"));
      const { deps: d, gave } = spy();

      await game.act(table, "s1", { type: "place", spotId: "field", chips: 300 }, d);
      table.seal();
      await game.payOut?.(table, d);
      bank.drain(bank.held);
      table.land();
      await game.settle(table, d);

      expect(gave).not.toHaveBeenCalled();
      expect(complain).toHaveBeenCalled();
    } finally {
      complain.mockRestore();
    }
  });
});

describe("chips that never reached the cloth, and chips that have left it", () => {
  it("leaves nothing on the cloth when the chips cannot be paid for", async () => {
    const bank = bankOf(1_000_000);
    const game = crapsAdapter({ bank });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const d = {
      take: vi.fn(async () => false),
      give: vi.fn(async () => {}),
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    await expect(
      game.act(table, "s1", { type: "place", spotId: "field", chips: 300 }, d),
    ).rejects.toThrow(TableError);
    expect(table.placed).toHaveLength(0);
    expect(bank.held).toBe(1_000_000);
  });

  it("keeps the escrow and the cloth in step as chips go on and come off", async () => {
    const bank = bankOf(1_000_000);
    const game = crapsAdapter({ bank });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const d = deps({ u1: 5_000 });
    const onCloth = () => table.placed.reduce((total, one) => total + one.chips, 0);

    await game.act(table, "s1", { type: "place", spotId: "field", chips: 300 }, d);
    await game.act(table, "s1", { type: "place", spotId: "place:6", chips: 300 }, d);
    expect(table.escrow.total).toBe(onCloth());
    await game.act(table, "s1", { type: "undo" }, d);
    expect(table.escrow.total).toBe(onCloth());
    await game.act(table, "s1", { type: "clear" }, d);
    expect(table.escrow.total).toBe(0);
    expect(onCloth()).toBe(0);
  });

  it("pays nothing back for a spot the seat has no chips on", async () => {
    const bank = bankOf(1_000_000);
    const game = crapsAdapter({ bank });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps: d, gave } = spy();

    await game.act(table, "s1", { type: "take", spotId: "field", chips: 500 }, d);

    expect(bank.held).toBe(1_000_000);
    expect(gave).not.toHaveBeenCalled();
  });

  it("stops holding the bank's chips for a table that has been called off", async () => {
    const bank = bankOf(1_000_000);
    const game = crapsAdapter({ bank });
    const closed = game.create("ABCDE") as Table;
    closed.join("s1", "Ada", who("u1"));
    const other = game.create("FGHIJ") as Table;
    const d = deps({ u1: 1_000 });
    await game.act(closed, "s1", { type: "place", spotId: "field", chips: 300 }, d);

    await game.void(closed, d);

    expect(ledgerOf(bank).owedElsewhere(other)).toBe(0);
  });

  it("keeps a called-off table's refunds in the book until they have left the bank", async () => {
    /*
     * The void closes the escrow at once, but the chips only leave the bank on
     * its turn in the queue. Reading the table as owing nothing in between
     * would let another table promise chips that are about to be paid out.
     */
    const { bank, stallNext } = gated(1_000_000);
    const game = crapsAdapter({ bank });
    const closing = game.create("ABCDE") as Table;
    const other = game.create("FGHIJ") as Table;
    closing.join("s1", "Ada", who("u1"));
    const d = deps({ u1: 1_000 });
    await game.act(closing, "s1", { type: "place", spotId: "field", chips: 300 }, d);

    const { reached, open } = stallNext("take");
    const voiding = game.void(closing, d);
    await reached;
    expect(ledgerOf(bank).owedElsewhere(other)).toBeGreaterThanOrEqual(300);

    open();
    await voiding;
    expect(ledgerOf(bank).owedElsewhere(other)).toBe(0);
  });

  it("pays somebody who left even when the cloth is swept while settling waits", async () => {
    const { bank, stallNext } = gated(1_000_000);
    const game = crapsAdapter({ bank, pick: () => 5 });
    const table = game.create("ABCDE") as Table;
    table.join("s2", "Bram", who("u2"));
    table.join("s1", "Ada", who("u1"));
    const balances = { u1: 1_000, u2: 1_000 };
    const d = deps(balances);
    // Bram's chip goes down first, so his payout is the one the store is slow on.
    await game.act(table, "s2", { type: "place", spotId: "field", chips: 300 }, d);
    await game.act(table, "s1", { type: "place", spotId: "field", chips: 300 }, d);
    table.seal();
    await game.payOut?.(table, d);
    table.removeSeat("s1");
    table.land();

    const { reached, open } = stallNext("take");
    const settling = game.settle(table, d);
    await reached;
    // The table opens its next window on its own clock, and forgets her.
    table.beginBetting();
    expect(table.accountOf("s1")).toBeNull();
    open();
    await settling;

    expect(balances["u1"]).toBe(1_900);
    expect(balances["u2"]).toBe(1_900);
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
    /*
     * A deadline left over from the window, so the answer has to come from the
     * phase. `seal` nulls it, and a test that leant on that would pass whether
     * or not the phase is looked at at all.
     */
    table.deadline = Date.now() + 10_000;
    expect(adapter.pause?.(table)).toBeNull();
    table.phase = "releasing";
    expect(adapter.pause?.(table)).toBeNull();

    table.phase = "sealed";
    table.deadline = null;
    await adapter.payOut?.(table, d);
    expect(adapter.pause?.(table)?.key).toBe("rolling");
    table.land();
    expect(adapter.pause?.(table)?.key).toBe("settling");
    expect(adapter.isSettled(table)).toBe(true);
    adapter.pause?.(table)?.run();
    expect(adapter.pause?.(table)?.key).toBe("betting");
  });

  it("reads the bank on the broadcast that lets the dice go, not the one after", async () => {
    // The felt greys spots out against this, and the frame the dice go on is
    // the frame it changes most.
    const bank = bankOf(1_000_000);
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const d = deps({ u1: 10_000 });
    await adapter.act(table, seat.id, { type: "place", spotId: "pass", chips: 300 }, d);
    table.seal();

    expect(await adapter.payOut?.(table, d)).toBe(true);

    expect(table.housed).toBe(1_000_300);
  });
});

describe("the guards nothing reaches on a good day", () => {
  it("hands the seal back when the bank will not answer", async () => {
    /*
     * The latch that makes `payOut` exactly-once is a phase the table cannot
     * leave on its own. A release that threw with the latch still held would
     * be a table that never deals again, so a failure puts the seal back for
     * the next broadcast to try.
     */
    const inner = bankOf(1_000_000);
    let down = false;
    const bank = {
      holds: async () => {
        if (down) {
          down = false;
          throw new Error("the store is down");
        }
        return inner.holds();
      },
      add: inner.add,
      take: inner.take,
    };
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const d = deps({ u1: 10_000 });
    await adapter.act(table, seat.id, { type: "place", spotId: "pass", chips: 300 }, d);
    table.seal();
    down = true;

    await expect(adapter.payOut?.(table, d)).rejects.toThrow(/store is down/);
    expect(table.phase).toBe("sealed");

    expect(await adapter.payOut?.(table, d)).toBe(true);
    expect(table.phase).toBe("rolling");
  });

  it("leaves a leaver's chips where they are once the dice are out", async () => {
    /*
     * Not reachable from the table's own transitions today — `seal` clears the
     * list of who has stood up — which is exactly why the guard is here and
     * why this reaches for the state directly. Without it the sweep is
     * `table.clear`, which refuses any phase but betting, and the refusal
     * would come out of `payOut` rather than out of anybody's press.
     */
    const bank = bankOf(1_000_000);
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    table.join("s1", "Ada", who("u1"));
    const balances = { u1: 10_000 };
    const d = deps(balances);
    await adapter.act(table, "s1", { type: "place", spotId: "pass", chips: 300 }, d);
    table.removeSeat("s1");
    expect(table.leaving.has("s1")).toBe(true);
    table.phase = "rolling";

    await expect(adapter.payOut?.(table, d)).resolves.not.toThrow();

    expect(table.onSpot("s1", "pass")).toBe(300);
    expect(balances["u1"]).toBe(9_700);
  });

  it("will not call a seat's numbers on once the window has shut", async () => {
    /*
     * No money moves wrongly without this — the bank's cover is worked out
     * again at the release whatever anybody says — but a seat that could turn
     * its numbers on after the seal would be choosing whether to be in the
     * roll with the window shut on everybody else.
     */
    const bank = bankOf(1_000_000);
    const adapter = crapsAdapter({ bank });
    const table = adapter.create("AAAAA") as Table;
    const seat = table.join("s1", "Ada", who("u1"));
    const d = deps({ u1: 10_000 });
    await adapter.act(table, seat.id, { type: "place", spotId: "place:6", chips: 600 }, d);
    table.seal();

    await expect(
      adapter.act(table, seat.id, { type: "working", on: true }, d),
    ).rejects.toThrow(/dice are already out/i);
    expect(table.worksFor(seat.id)).toBe(false);
  });
});
