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
      expect.objectContaining({ shared: expect.objectContaining({ chipsStaked: 300 }) }),
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
