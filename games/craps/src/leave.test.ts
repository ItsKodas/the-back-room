import type { GameDeps } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { crapsAdapter } from "./adapter.js";

/**
 * Standing up from a craps table, which is where chips used to vanish.
 *
 * A chip goes into the bank the moment it lands, so a seat that left with
 * chips on the cloth had them filtered off and the bank simply kept them — for
 * a roll the player never saw. The server calls `removeSeat` and then
 * broadcasts, and a broadcast is what asks `payOut`, so that is the order here.
 *
 * Craps adds the thing the wheel has no version of: a hand outlives a roll. A
 * seat can stand up with a point already on and its bets still riding, and
 * both halves of that have to be right — the contract stays down because it is
 * a contract, and the account behind the empty seat is still remembered when
 * the dice finally decide it.
 */

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

/** Both fours, so a come-out sets the eight and the eight then makes it. */
const EIGHT = () => 3;

describe("leaving a craps table", () => {
  it("hands back chips placed in a window that never rolled", async () => {
    const { held, deps } = accounts({ u1: 1_000 });
    const { bank, read } = bankOf(100_000);
    const game = crapsAdapter({ bank, pick: EIGHT });
    const table = game.create("LEAVE");
    table.join("s1", "Ada", who("u1"));

    await game.act(table, "s1", { type: "place", spotId: "pass", chips: 300 }, deps);
    table.removeSeat("s1");
    await game.payOut?.(table, deps);

    expect(held["u1"]).toBe(1_000);
    expect(read()).toBe(100_000);
    expect(table.placed).toEqual([]);
  });

  it("still pays a bet that was already riding when they stood up", async () => {
    // Boxcars, and the field pays four to one on it.
    const { held, deps } = accounts({ u1: 1_000 });
    const { bank, read } = bankOf(100_000);
    const game = crapsAdapter({ bank, pick: () => 5 });
    const table = game.create("LEAVE");
    table.join("s1", "Ada", who("u1"));
    table.join("s2", "Bo", who("u2"));

    await game.act(table, "s1", { type: "place", spotId: "field", chips: 300 }, deps);
    table.seal();
    table.removeSeat("s1");
    await game.payOut?.(table, deps);
    table.land();
    await game.settle(table, deps);

    expect(held["u1"]).toBe(1_900);
    expect(read()).toBe(99_100);
  });

  it("lets chips ride rather than hand back one another seat's bet leans on", async () => {
    /*
     * The bank's own thirteen and a half thousand covers snake eyes at four
     * fifty on its own. The yo then leans on it: with both down, the yo
     * winning costs the bank everything it has and not a chip more. Handing
     * the snake eyes back would leave the yo needing four hundred and fifty
     * the bank has not got — so it stays on the cloth, rolls, and is paid to
     * its owner if it comes in.
     */
    const { held, deps } = accounts({ u1: 1_000, u2: 1_000 });
    const { bank, read } = bankOf(13_500);
    let at = 0;
    // Five and six, which is the yo.
    const game = crapsAdapter({ bank, pick: () => (at++ % 2 === 0 ? 4 : 5) });
    const table = game.create("LEAVE");
    table.join("s1", "Ada", who("u1"));
    table.join("s2", "Bo", who("u2"));

    await game.act(table, "s1", { type: "place", spotId: "two", chips: 450 }, deps);
    await game.act(table, "s2", { type: "place", spotId: "eleven", chips: 930 }, deps);
    table.removeSeat("s1");
    await game.payOut?.(table, deps);

    expect(held["u1"]).toBe(550);
    expect(table.onSpot("s1", "two")).toBe(450);

    table.seal();
    await game.payOut?.(table, deps);
    table.land();
    await game.settle(table, deps);

    expect(held["u2"]).toBe(14_950);
    expect(read()).toBe(0);
    expect((held["u1"] ?? 0) + (held["u2"] ?? 0) + read()).toBe(15_500);
  });

  it("still pays a seat that stood up with chips riding on a point", async () => {
    /*
     * A craps hand outlives a roll. Roulette prunes the account behind an
     * empty seat when the cloth is swept; doing that here would forget
     * somebody halfway through their own point and quietly keep their win.
     */
    const { held, deps } = accounts({ u1: 1_000, u2: 1_000 });
    const { bank, read } = bankOf(100_000);
    const game = crapsAdapter({ bank, pick: EIGHT });
    const table = game.create("LEAVE");
    table.join("s1", "Ada", who("u1"));
    table.join("s2", "Bo", who("u2"));

    await game.act(table, "s1", { type: "place", spotId: "pass", chips: 300 }, deps);
    table.seal();
    await game.payOut?.(table, deps);
    table.land();
    await game.settle(table, deps);
    expect(table.point).toBe(8);

    // Ada stands up while the roll that set the point is still on screen, so
    // there is no window open for her chips to have come off in.
    table.removeSeat("s1");
    table.beginBetting();
    expect(table.accountOf("s1")).toBe("u1");
    expect(table.onSpot("s1", "pass")).toBe(300);

    table.seal();
    await game.payOut?.(table, deps);
    table.land();
    await game.settle(table, deps);

    expect(held["u1"]).toBe(1_300);
    expect(read()).toBe(99_700);
  });

  it("keeps a contract down when its owner stands up, and hands back the rest", async () => {
    /*
     * Leaving is not a second door onto a take-back the table refuses. The
     * pass line with the point on is a contract — that is the trade for the
     * price — and a seat that could lift it off by standing up would be able
     * to get its stake back every time the point came up unkind. The six is
     * not a contract, so that one comes home.
     */
    const { held, deps } = accounts({ u1: 1_000, u2: 1_000 });
    const { bank, read } = bankOf(100_000);
    const game = crapsAdapter({ bank, pick: EIGHT });
    const table = game.create("LEAVE");
    table.join("s1", "Ada", who("u1"));
    table.join("s2", "Bo", who("u2"));

    await game.act(table, "s1", { type: "place", spotId: "pass", chips: 300 }, deps);
    table.seal();
    await game.payOut?.(table, deps);
    table.land();
    await game.settle(table, deps);
    table.beginBetting();
    expect(table.point).toBe(8);

    await game.act(table, "s1", { type: "place", spotId: "place:6", chips: 300 }, deps);
    table.removeSeat("s1");
    await game.payOut?.(table, deps);

    expect(table.onSpot("s1", "pass")).toBe(300);
    expect(table.onSpot("s1", "place:6")).toBe(0);
    expect(held["u1"]).toBe(700);

    table.seal();
    await game.payOut?.(table, deps);
    table.land();
    await game.settle(table, deps);

    // The eight is made, and the contract she could not take down is paid.
    expect(held["u1"]).toBe(1_300);
    expect(read()).toBe(99_700);
  });
});
