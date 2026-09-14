import type { GameDeps } from "@backroom/core";
import { TableError } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { rouletteAdapter } from "./adapter.js";
import type { Table } from "./table.js";

const RED = "even:1-3-5-7-9-12-14-16-18-19-21-23-25-27-30-32-34-36";
const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

/** An account that always has chips, and a note of everything asked of it. */
const spy = () => {
  const took = vi.fn(async () => true);
  const gave = vi.fn(async () => {});
  const deps = {
    take: took,
    give: gave,
    record: vi.fn(async () => {}),
    finished: vi.fn(async () => {}),
  } as unknown as GameDeps;
  return { deps, took, gave };
};

/** A bank holding whatever a test says, remembering what went in and out. */
const purse = (start: number) => {
  let held = start;
  return {
    bank: {
      holds: async () => held,
      add: async (amount: number) => {
        held += amount;
      },
      take: async (amount: number) => {
        if (amount > held) {
          return false;
        }
        held -= amount;
        return true;
      },
    },
    held: () => held,
  };
};

describe("a roulette table's money", () => {
  it("takes a chip off the account and puts it in the bank", async () => {
    const { bank, held } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps, took } = spy();

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);

    expect(took).toHaveBeenCalledWith("u1", 200);
    expect(held()).toBe(1_000_200);
    expect(table.onSpot("s1", RED)).toBe(200);
  });

  it("never touches an account at a table playing for nothing", async () => {
    /*
     * The rule this test exists for is in CLAUDE.md in so many words: play
     * money never touches an account. It is also the mistake that has actually
     * happened in this repo — a verification run opened a chips table by
     * accident and spent somebody's real balance — so the assertion is not
     * that the right amount moved but that nothing was asked of the account
     * at all.
     */
    const game = rouletteAdapter({ pick: () => 0 });
    const table = game.create("ABCDE", { forFun: true }) as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps, took, gave } = spy();

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    table.closeBetting();
    table.land();
    await game.settle(table, deps);

    expect(took).not.toHaveBeenCalled();
    expect(gave).not.toHaveBeenCalled();
  });

  it("spends the table's purse instead, and pays back into it", async () => {
    const game = rouletteAdapter({ pick: () => 1 });
    const table = game.create("ABCDE", { forFun: true }) as Table;
    table.join("s1", "Ada", null);
    const { deps } = spy();
    const before = table.purseFor("s1");

    // 32 is red, so this comes back doubled.
    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    expect(table.purseFor("s1")).toBe(before - 200);
    table.closeBetting();
    table.land();
    await game.settle(table, deps);
    expect(table.purseFor("s1")).toBe(before + 200);
  });

  it("lets a guest play for nothing and refuses them chips", async () => {
    const forFun = rouletteAdapter({ pick: () => 0 });
    const free = forFun.create("ABCDE", { forFun: true }) as Table;
    expect(() => free.join("s1", "Ada", null)).not.toThrow();

    const chips = rouletteAdapter({ pick: () => 0, bank: purse(1_000_000).bank });
    const paid = chips.create("FGHIJ") as Table;
    expect(() => paid.join("s1", "Ada", null)).toThrow(TableError);
  });

  it("refuses a chip the bank could not pay out on", async () => {
    // 3,500 covers exactly 100 straight up. 101 it cannot.
    const { bank } = purse(3_500);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps } = spy();

    await expect(
      game.act(table, "s1", { type: "place", spotId: "straight:17", chips: 101 }, deps),
    ).rejects.toThrow(TableError);
    await expect(
      game.act(table, "s1", { type: "place", spotId: "straight:17", chips: 100 }, deps),
    ).resolves.toBeUndefined();
  });

  it("counts everybody's chips against the bank, not just yours", async () => {
    /*
     * The whole reason this game works the cloth out rather than capping each
     * seat. One wheel settles both of these, so the second player's chip has
     * to be measured against what the first already put down — a per-seat cap
     * would wave it through and leave the bank short.
     */
    const { bank } = purse(3_500);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    table.join("s2", "Bram", who("u2"));
    const { deps } = spy();

    await game.act(table, "s1", { type: "place", spotId: "straight:17", chips: 100 }, deps);
    await expect(
      game.act(table, "s2", { type: "place", spotId: "straight:17", chips: 25 }, deps),
    ).rejects.toThrow(TableError);
  });

  it("leaves nothing on the cloth when the chips cannot be paid for", async () => {
    const { bank } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const deps = {
      take: vi.fn(async () => false),
      give: vi.fn(async () => {}),
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    await expect(
      game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps),
    ).rejects.toThrow(TableError);
    expect(table.placed).toHaveLength(0);
  });

  it("gives a chip back out of the bank when it is taken off the cloth", async () => {
    // Or a player could fill the bank by placing and unplacing all evening.
    const { bank, held } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps, gave } = spy();

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    await game.act(table, "s1", { type: "clear" }, deps);

    expect(held()).toBe(1_000_000);
    expect(gave).toHaveBeenCalledWith("u1", 200);
  });

  it("gives a chip back out of the bank when it is taken off one spot", async () => {
    /*
     * The same movement as a win, and it has to be: chips go into the bank as
     * they land, so a right-click that took a chip off the cloth without
     * taking it out of the bank would let a player fatten the bank all evening
     * and then bet against a cap their own unplaced chips had inflated.
     */
    const { bank, held } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps, gave } = spy();

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    await game.act(table, "s1", { type: "take", spotId: RED, chips: 50 }, deps);

    expect(held()).toBe(1_000_150);
    expect(gave).toHaveBeenCalledWith("u1", 50);
    expect(table.onSpot("s1", RED)).toBe(150);
  });

  it("pays nothing back for a spot the seat has no chips on", async () => {
    const { bank, held } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps, gave } = spy();

    await game.act(table, "s1", { type: "take", spotId: RED, chips: 500 }, deps);

    expect(held()).toBe(1_000_000);
    expect(gave).not.toHaveBeenCalled();
  });

  it("pays a winner out of the bank once the ball lands", async () => {
    const { bank, held } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 1 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps, gave } = spy();

    await game.act(table, "s1", { type: "place", spotId: "straight:32", chips: 100 }, deps);
    table.closeBetting();
    table.land();
    await game.settle(table, deps);

    expect(gave).toHaveBeenCalledWith("u1", 3_600);
    expect(held()).toBe(1_000_100 - 3_600);
    expect(game.winners?.(table)).toEqual(["s1"]);
  });

  it("keeps a losing spin's chips in the bank", async () => {
    const { bank, held } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps, gave } = spy();

    await game.act(table, "s1", { type: "place", spotId: "straight:32", chips: 100 }, deps);
    table.closeBetting();
    table.land();
    await game.settle(table, deps);

    expect(gave).not.toHaveBeenCalled();
    expect(held()).toBe(1_000_100);
    expect(game.winners?.(table)).toEqual([]);
  });

  it("stakes what was on the felt, and records nothing at a for-fun table", async () => {
    const { bank } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps } = spy();

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    await game.act(table, "s1", { type: "place", spotId: RED, chips: 100 }, deps);
    table.closeBetting();
    table.land();
    await game.settle(table, deps);

    expect(deps.record).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        shared: expect.objectContaining({ chipsStaked: 300, rounds: 1 }),
      }),
    );

    // The same felt, at a table playing for nothing: no account, no record.
    const friendly = rouletteAdapter({ pick: () => 0 });
    const friendlyTable = friendly.create("FGHIJ", { forFun: true }) as Table;
    friendlyTable.join("s1", "Ada", who("u1"));
    const watching = spy();

    await friendly.act(friendlyTable, "s1", { type: "place", spotId: RED, chips: 200 }, watching.deps);
    friendlyTable.closeBetting();
    friendlyTable.land();
    await friendly.settle(friendlyTable, watching.deps);

    expect(watching.deps.record).not.toHaveBeenCalled();
  });

  it("makes a bot pay for the chip it puts down at a for-fun table", () => {
    /*
     * A bot plays through the table directly, not through `act`, so nothing
     * about `act` paying for a chip reaches it. Without its own stake the chip
     * lands paid for by nobody, and settlement then pays the bot out of the
     * table's bank as though it had put the chip in.
     */
    const game = rouletteAdapter({ pick: () => 0 });
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
    const game = rouletteAdapter({ pick: () => 0 });
    const table = game.create("ABCDE", { forFun: true }) as Table;
    const seat = table.join("b1", "Bot", null);
    seat.isBot = true;
    seat.skill = "normal";
    table.beginBetting();

    const move = game.botMove?.(table) ?? null;
    expect(move).not.toBeNull();
    const purseBefore = table.purseFor("b1");
    const bankBefore = table.funBank;
    /*
     * It thought right through last call. Not `closeBetting`: an empty cloth
     * does not close, it just gives the window another round.
     */
    table.deadline = Date.now();
    move?.play();

    expect(table.staked("b1")).toBe(0);
    expect(table.purseFor("b1")).toBe(purseBefore);
    expect(table.funBank).toBe(bankBefore);
  });

  it("waits on its own clock, one phase at a time", () => {
    const game = rouletteAdapter({ pick: () => 1, window: 1_000 });
    const table = game.create("ABCDE", { forFun: true }) as Table;
    table.join("s1", "Ada", null);
    table.place("s1", RED, 50);

    expect(game.pause?.(table)?.key).toBe("betting");
    game.pause?.(table)?.run();
    expect(game.pause?.(table)?.key).toBe("spinning");
    game.pause?.(table)?.run();
    expect(game.pause?.(table)?.key).toBe("settled");
    game.pause?.(table)?.run();
    expect(game.pause?.(table)?.key).toBe("betting");
  });
});

/*
 * Every roulette table in the building is paid from one bank, and each of them
 * used to measure its cap against that bank minus only its own cloth. So a
 * second table read the first table's chips as bank — chips the first table's
 * winners were already owed — and promised them again. Whichever table settled
 * second found the bank empty, and its winner was simply not paid.
 */
describe("a bank more than one table is paid from", () => {
  const BLACK = "even:2-4-6-8-10-11-13-15-17-20-22-24-26-28-29-31-33-35";
  // Where the ball goes, by position on the wheel: 32 is red and 15 is black.
  const landsRed = () => 1;
  const landsBlack = () => 2;

  it("does not let one table promise chips another table's cloth is owed", async () => {
    const { bank, held } = purse(1_000);
    const first = rouletteAdapter({ bank, pick: landsRed });
    const second = rouletteAdapter({ bank, pick: landsBlack });
    const a = first.create("AAAAA") as Table;
    const b = second.create("BBBBB") as Table;
    a.join("s1", "Ada", who("u1"));
    a.join("s2", "Bram", who("u2"));
    b.join("s1", "Cleo", who("u3"));
    const { deps, gave } = spy();

    // A matched pair: it asks nothing of the bank, and puts 2,000 into it.
    await first.act(a, "s1", { type: "place", spotId: RED, chips: 1_000 }, deps);
    await first.act(a, "s2", { type: "place", spotId: BLACK, chips: 1_000 }, deps);
    // Refusing this is the fix. Taking it and then short-paying is the bug.
    await second.act(b, "s1", { type: "place", spotId: BLACK, chips: 3_000 }, deps).catch((error) => {
      expect(error).toBeInstanceOf(TableError);
    });

    b.closeBetting();
    b.land();
    await second.settle(b, deps);
    a.closeBetting();
    a.land();
    await first.settle(a, deps);

    expect(gave).toHaveBeenCalledWith("u1", 2_000);
    expect(held()).toBeGreaterThanOrEqual(0);
  });

  it.each([
    { type: "take", spotId: RED, chips: 1_000 },
    { type: "undo" },
    { type: "clear" },
  ])("will not hand a chip back ($type) when the rest of the cloth would go unpaid", async (move) => {
    /*
     * A chip coming off the cloth comes out of the bank, and the bets it leaves
     * behind do not get any cheaper for it. Red went down first against the
     * bank; black was then allowed to lean on red. Take red back and black is
     * owed 4,000 out of a bank of 3,000.
     */
    const { bank } = purse(1_000);
    const game = rouletteAdapter({ bank, pick: landsBlack });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    table.join("s2", "Bram", who("u2"));
    const { deps, gave } = spy();

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 1_000 }, deps);
    await game.act(table, "s2", { type: "place", spotId: BLACK, chips: 2_000 }, deps);
    await game.act(table, "s1", move, deps).catch((error) => {
      expect(error).toBeInstanceOf(TableError);
    });

    table.closeBetting();
    table.land();
    await game.settle(table, deps);

    expect(gave).toHaveBeenCalledWith("u2", 4_000);
  });

  it("says so when the bank will not pay a winner", async () => {
    /*
     * Unreachable from inside this building now, which is exactly when a
     * refusal has to be loud: a bank drained from somewhere nothing here
     * accounts for — another process, a hand on the database — must leave
     * something in the log rather than a winner quietly unpaid.
     */
    const complain = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { bank, held } = purse(1_000_000);
      const game = rouletteAdapter({ bank, pick: landsRed });
      const table = game.create("ABCDE") as Table;
      table.join("s1", "Ada", who("u1"));
      const { deps, gave } = spy();

      await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
      await bank.take(held());
      table.closeBetting();
      table.land();
      await game.settle(table, deps);

      expect(gave).not.toHaveBeenCalled();
      expect(complain).toHaveBeenCalled();
    } finally {
      complain.mockRestore();
    }
  });
});

function wallet(start: Record<string, number>) {
  const held = { ...start };
  const deps = {
    take: async (userId: string, amount: number) => {
      if ((held[userId] ?? 0) < amount) return false;
      held[userId] = (held[userId] ?? 0) - amount;
      return true;
    },
    give: async (userId: string, amount: number) => {
      held[userId] = (held[userId] ?? 0) + amount;
    },
    record: async () => {},
    finished: async () => {},
  } as GameDeps;
  return { held, deps };
}

describe("a roulette table called off", () => {
  it("hands every chip on the cloth back out of the bank", async () => {
    const { bank, held: inBank } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { held, deps } = wallet({ u1: 1_000 });

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    expect(table.escrow.total).toBe(200);

    await game.void?.(table, deps);
    expect(held["u1"]).toBe(1_000);
    expect(inBank()).toBe(1_000_000);
  });

  it("keeps the escrow and the cloth in step as chips go on and come off", async () => {
    const { bank } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps } = wallet({ u1: 5_000 });
    const onCloth = () => table.placed.reduce((total, one) => total + one.chips, 0);

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    await game.act(table, "s1", { type: "place", spotId: RED, chips: 100 }, deps);
    expect(table.escrow.total).toBe(onCloth());
    await game.act(table, "s1", { type: "undo" }, deps);
    expect(table.escrow.total).toBe(onCloth());
    await game.act(table, "s1", { type: "clear" }, deps);
    expect(table.escrow.total).toBe(0);
  });

  it("returns chips to somebody who leaves while bets are open", async () => {
    const { bank, held: inBank } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { held, deps } = wallet({ u1: 1_000 });
    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);

    table.removeSeat("s1");
    await game.payOut?.(table, deps);

    expect(held["u1"]).toBe(1_000);
    expect(inBank()).toBe(1_000_000);
  });

  it("still pays somebody who left after the ball was in", async () => {
    const { bank } = purse(1_000_000);
    // Position 1 on the wheel is 32, which is red.
    const game = rouletteAdapter({ bank, pick: () => 1 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { held, deps } = wallet({ u1: 1_000 });
    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    table.closeBetting();
    table.removeSeat("s1");
    table.land();

    await game.settle(table, deps);

    expect(held["u1"]).toBe(1_200);
  });

  it("gives back a chip the table refused after it was paid for", async () => {
    const { bank, held: inBank } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { held, deps } = wallet({ u1: 1_000 });
    // The window shuts while the account is being charged.
    const shutting = {
      ...deps,
      take: async (userId: string, amount: number) => {
        const ok = await deps.take(userId, amount);
        table.closeBetting();
        return ok;
      },
    } as GameDeps;
    table.join("s2", "Bo", who("u2"));
    // Somebody else's chip, so the cloth is not empty and the window really shuts.
    await game.act(table, "s2", { type: "place", spotId: RED, chips: 25 }, wallet({ u2: 100 }).deps);

    await expect(
      game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, shutting),
    ).rejects.toThrow();

    expect(held["u1"]).toBe(1_000);
    expect(inBank()).toBe(1_000_025);
  });

  it("stops holding the bank's chips for a table that has been called off", async () => {
    const { bank } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const closed = game.create("ABCDE") as Table;
    closed.join("s1", "Ada", who("u1"));
    const other = game.create("FGHIJ") as Table;
    const { deps } = wallet({ u1: 1_000 });
    await game.act(closed, "s1", { type: "place", spotId: RED, chips: 200 }, deps);

    await game.void?.(closed, deps);

    const { ledgerOf } = await import("@backroom/core");
    expect(ledgerOf(bank).owedElsewhere(other)).toBe(0);
  });
});
