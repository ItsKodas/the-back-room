import { describe, expect, it, vi } from "vitest";
import { FUN_PURSE } from "./bank.js";
import { Table } from "./table.js";

const sit = (table: Table, id: string, userId: string | null = `user:${id}`) =>
  table.join(id, id, userId === null ? null : { userId, avatar: null, accentColor: null });

/**
 * A table dealt for chips, with a seat already at it.
 *
 * The window is a full minute rather than the brief's shorter figure: a
 * shorter window gives `lastCallMs` too little margin against the time an
 * actual test run takes between construction and its first `place`, which
 * makes "No more bets." a flake rather than a bug. Last call's own arithmetic
 * is covered by a test that drives it directly instead of racing the clock.
 */
function chipsTable() {
  const table = new Table("AAAAA", 8, { random: () => 0.5, window: 60_000 });
  const seat = sit(table, "a");
  return { table, seat };
}

describe("taking a seat", () => {
  it("opens with the window running", () => {
    const { table } = chipsTable();
    expect(table.phase).toBe("betting");
    expect(table.deadline).not.toBeNull();
  });

  it("holds last call to a third of a short window", () => {
    // Five seconds flat would invert on any window shorter than itself: the
    // table would open already in last call and refuse every bet.
    const table = new Table("AAAAA", 8, { window: 3_000 });
    expect(table.lastCallMs).toBe(1_000);
  });
});

describe("chips on the cloth", () => {
  it("takes a chip and remembers whose it is", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    expect(table.staked("a")).toBe(100);
    expect(table.onSpot("a", "player")).toBe(100);
  });

  it("merges a second chip into the same pile", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    table.place("a", "player", 25);
    expect(table.onSpot("a", "player")).toBe(125);
    expect(table.placed).toHaveLength(1);
  });

  it("refuses a bet the table does not take", () => {
    const { table } = chipsTable();
    expect(() => table.place("a", "dragon", 100)).toThrow(/no such bet/i);
  });

  it("refuses anything under the smallest chip", () => {
    const { table } = chipsTable();
    expect(() => table.place("a", "player", 5)).toThrow(/smallest chip/i);
    expect(() => table.place("a", "player", 100.5)).toThrow(/smallest chip/i);
  });

  it("refuses somebody who is not at the table", () => {
    const { table } = chipsTable();
    expect(() => table.place("nobody", "player", 100)).toThrow(/not at this table/i);
  });

  it("takes a chip back off, per seat and not per spot", () => {
    const { table } = chipsTable();
    sit(table, "b");
    table.place("a", "player", 100);
    table.place("b", "player", 500);
    // Both back the player every coup; taking "the chips on player" would let
    // either of them pocket the other's.
    expect(table.take("a", "player", 100)).toBe(100);
    expect(table.onSpot("b", "player")).toBe(500);
  });

  it("takes the pile rather than opening a debt", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    expect(table.take("a", "player", 5_000)).toBe(100);
  });

  it("undoes the last chip down, and clears them all", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    table.place("a", "tie", 25);
    table.undo("a");
    expect(table.staked("a")).toBe(100);
    table.clear("a");
    expect(table.staked("a")).toBe(0);
  });

  it("stops taking chips once the coup is being dealt", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    table.closeBetting();
    expect(() => table.place("a", "player", 100)).toThrow(/already being dealt/i);
    expect(() => table.take("a", "player", 100)).toThrow(/already being dealt/i);
  });
});

describe("the phases", () => {
  it("does not deal an empty cloth, and leaves the felt alone", () => {
    /*
     * A stream of results nobody bet on is noise, and clearing the felt to
     * wait would be the table keeping the money.
     *
     * The clock is faked and moved on purpose: two Date.now() calls a
     * microsecond apart routinely land in the same millisecond, which made
     * "the window reopened" fail on real time nearly every run rather than
     * one run in twenty. Driving the phase explicitly is the same fix the
     * amendment above already applies to last call — a real clock is not
     * something a test should be racing.
     */
    vi.useFakeTimers();
    try {
      const { table } = chipsTable();
      const before = table.deadline;
      vi.advanceTimersByTime(10);
      table.closeBetting();
      expect(table.phase).toBe("betting");
      expect(table.coup).toBeNull();
      expect(table.deadline).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deals once there are chips down", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    table.closeBetting();
    expect(table.phase).toBe("dealing");
    expect(table.coup).not.toBeNull();
    expect(table.coup?.player.length).toBeGreaterThanOrEqual(2);
  });

  it("times the dealing phase from the coup itself", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    table.closeBetting();
    const view = table.view("a");
    expect(view.dealMs).toBeGreaterThan(0);
    // The deadline is the end of the reveal, which is what a client subtracts
    // the schedule's total from to find where in the deal it is.
    expect(view.deadline).toBeGreaterThan(Date.now());
  });

  it("settles the cloth when the coup lands", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    table.closeBetting();
    table.land();
    expect(table.phase).toBe("settled");
    expect(table.paid).not.toBeNull();
    expect(table.history).toHaveLength(1);
  });

  it("sweeps the cloth and opens a fresh window", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    table.closeBetting();
    table.land();
    table.beginBetting();
    expect(table.phase).toBe("betting");
    expect(table.placed).toHaveLength(0);
    expect(table.coup).toBeNull();
    expect(table.paid).toBeNull();
  });

  it("remembers the last round so it can be put down again", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    table.closeBetting();
    table.land();
    table.beginBetting();
    expect(table.lastRound("a")).toEqual([{ seatId: "a", spotId: "player", chips: 100 }]);
    expect(table.view("a").canRepeat).toBe(true);
  });
});

describe("the boards", () => {
  it("keeps only seats that finished ahead on the winners board", () => {
    const table = new Table("AAAAA", 8, { random: () => 0.5, window: 60_000 });
    sit(table, "a");
    sit(table, "b");
    // Matched money: whichever side comes in, one of them is up and the other
    // is not, and a push puts neither on the board.
    table.place("a", "player", 100);
    table.place("b", "banker", 100);
    table.closeBetting();
    table.land();
    for (const win of table.winners) {
      expect(win.up).toBeGreaterThan(0);
    }
  });

  it("keeps the name with the win, so a seat that leaves still won", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    table.closeBetting();
    table.land();
    table.removeSeat("a");
    for (const win of table.winners) {
      expect(win.name).toBe("a");
    }
  });
});

describe("standing up", () => {
  it("leaves the chips on the cloth for the adapter to settle", () => {
    /*
     * Filtering them off here would be the table keeping them: every chip went
     * into the bank as it landed, so a seat that left mid-window would lose its
     * whole stake for a coup it never saw.
     */
    const { table } = chipsTable();
    table.place("a", "player", 100);
    table.removeSeat("a");
    expect(table.placed).toHaveLength(1);
    expect(table.leaving.has("a")).toBe(true);
  });

  it("lets whatever is still down ride once the window has shut", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    table.closeBetting();
    table.removeSeat("a");
    expect(table.leaving.size).toBe(0);
  });

  it("still knows whose account the chips came from", () => {
    const { table } = chipsTable();
    table.place("a", "player", 100);
    table.removeSeat("a");
    expect(table.accountOf("a")).toBe("user:a");
  });
});

describe("play money", () => {
  it("gives a for-fun seat a purse and no account", () => {
    const table = new Table("AAAAA", 8, { random: () => 0.5 });
    table.forFun = true;
    table.join("a", "a", null);
    expect(table.purseFor("a")).toBe(FUN_PURSE);
    expect(table.view("a").you?.purse).toBe(FUN_PURSE);
  });

  it("tells a chips table it has no purse to show", () => {
    const { table } = chipsTable();
    expect(table.view("a").you?.purse).toBeNull();
  });
});

describe("bots", () => {
  it("deals a bot in at a table playing for nothing", () => {
    const table = new Table("AAAAA", 8);
    table.forFun = true;
    const bot = table.addBot("bot:1", "Dealer's mate", "normal");
    expect(bot.isBot).toBe(true);
    expect(table.purseFor(bot.id)).toBe(FUN_PURSE);
  });

  it("refuses one at a table playing for chips", () => {
    /*
     * Chips are only ever won from real people. A bot has no account to charge
     * and none to pay, so a coup won against one for chips is chips out of
     * thin air.
     */
    const table = new Table("AAAAA", 8);
    expect(() => table.addBot("bot:1", "Dealer's mate", "normal")).toThrow(/for fun/i);
  });
});
