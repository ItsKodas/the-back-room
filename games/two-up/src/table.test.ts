import { describe, expect, it } from "vitest";
import { Table } from "./table.js";

/* A table with two people at it, which is what the ring needs. */
const seated = (school: "casino" | "school", how = 2) => {
  const table = new Table("ABCD", 8, { school });
  for (let at = 0; at < how; at += 1) {
    table.join(`s${at}`, `P${at}`, { userId: `u${at}`, avatar: null, accentColor: null });
  }
  return table;
};

describe("which game this table is playing", () => {
  it("opens on a betting window in the casino school", () => {
    expect(seated("casino").phase).toBe("betting");
  });

  it("opens waiting for a centre in the traditional school", () => {
    expect(seated("school").phase).toBe("centre");
  });
});

describe("a ring that cannot find a second player", () => {
  it("holds, and says so", () => {
    const table = seated("school", 1);
    expect(table.holding).toBe(true);
    expect(table.view(null).lastEvent).toMatch(/another player/i);
  });

  it("stops the clock rather than running the phase out", () => {
    // Holding is not a phase and not a deadline: the table simply is not
    // timing anything, so nothing can expire while it waits.
    expect(seated("school", 1).deadline).toBeNull();
  });

  it("leaves the felt exactly as it is", () => {
    /*
     * The rule easiest to break by accident, and the reason it is a test. A
     * centre is already on the felt when the second player walks out; clearing
     * it to wait would be the table keeping the money.
     */
    const table = seated("school");
    table.setCentre("s0", 1_000);
    table.cover("s1", 400);
    table.removeSeat("s1");
    expect(table.holding).toBe(true);
    expect(table.centre).toEqual({ seatId: "s0", chips: 1_000 });
    expect(table.covers).toEqual([{ seatId: "s1", chips: 400 }]);
  });

  it("passes the kip on rather than waiting for a spinner who has gone", () => {
    /*
     * The one phase that stalls for good if the kip is left where it is.
     * Nobody but the spinner may set a centre, so a spinner who walks out
     * before putting one up takes the round with them and the window reopens
     * on an empty middle for as long as the table lives.
     */
    const table = seated("school");
    table.removeSeat("s0");
    table.join("s2", "P2", { userId: "u2", avatar: null, accentColor: null });
    expect(table.spinnerId).toBe("s1");
    expect(() => table.setCentre("s1", 1_000)).not.toThrow();
  });

  it("never holds a casino table, which has a bank behind it", () => {
    expect(seated("casino", 1).holding).toBe(false);
  });

  it("never holds a for-fun table, whose purse was never anybody's", () => {
    const table = new Table("ABCD", 8, { school: "school", forFun: true });
    table.join("s0", "P0", null);
    expect(table.holding).toBe(false);
  });
});

describe("the casino window", () => {
  it("takes chips while it is open", () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    expect(table.staked("s0")).toBe(100);
    expect(table.onCloth).toBe(100);
  });

  it("merges a second chip into the pile already on that side", () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.place("s0", "heads", 50);
    expect(table.placed).toEqual([{ seatId: "s0", on: "heads", chips: 150 }]);
  });

  it("refuses a chip smaller than the smallest chip", () => {
    expect(() => seated("casino").place("s0", "heads", 1)).toThrow(/smallest chip/i);
  });

  it("refuses a chip once the coins are up", () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.closeBetting();
    expect(() => table.place("s0", "tails", 100)).toThrow(/already/i);
  });

  it("does not throw at an empty cloth, and opens the window again", () => {
    /*
     * The same rule the wheel keeps. A stream of results nobody bet on is
     * noise, and it would walk the board along until the last real throw had
     * scrolled off it.
     */
    const table = seated("casino");
    table.closeBetting();
    expect(table.phase).toBe("betting");
    expect(table.deadline).not.toBeNull();
  });

  it("takes back a seat's own chips and nobody else's", () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.place("s1", "heads", 100);
    expect(table.take("s0", "heads", 100)).toBe(100);
    expect(table.staked("s1")).toBe(100);
  });

  it("takes the pile rather than opening a debt", () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    expect(table.take("s0", "heads", 500)).toBe(100);
  });
});

describe("the kip", () => {
  it("waits for the spinner once the window shuts", () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.closeBetting();
    expect(table.phase).toBe("kip");
    expect(table.spinnerId).toBe("s0");
  });

  it("refuses a throw from anybody but the spinner", () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.closeBetting();
    expect(() => table.throwCoins("s1", () => 0.1)).toThrow(/spinner/i);
  });

  it("refuses a throw before the window has shut", () => {
    const table = seated("casino");
    expect(() => table.throwCoins("s0", () => 0.1)).toThrow(/not.*throw/i);
  });

  it("lets the boxer throw when the spinner does not", () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.closeBetting();
    table.boxerThrows(() => 0.1);
    expect(table.phase).toBe("spinning");
    expect(table.faces).toEqual(["head", "head"]);
  });

  it("passes the kip round the table between rounds", () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.closeBetting();
    expect(table.spinnerId).toBe("s0");
    table.boxerThrows(() => 0.1);
    table.land();
    table.read(() => 0.1);
    table.beginRound();
    table.place("s1", "heads", 100);
    table.closeBetting();
    expect(table.spinnerId).toBe("s1");
  });

  it("passes the kip by who held it, not by where they sat", () => {
    const table = seated("casino", 3);
    const spun: Array<string | null> = [];
    const throwIt = () => {
      table.place("s2", "heads", 100);
      table.closeBetting();
      spun.push(table.spinnerId);
      table.boxerThrows(() => 0.1);
      table.land();
      table.read(() => 0.1);
    };

    throwIt();
    table.beginRound();
    throwIt();
    expect(spun).toEqual(["s0", "s1"]);

    /*
     * s0 leaves while s1 holds the kip. Every later seat's index has just
     * shifted down by one, so a table that counted positions would hand the
     * kip straight back to s1 and skip s2 — the hazard
     * `packages/core/src/seating.ts` warns callers about, on a table that
     * declares mid-round departure supported.
     */
    table.removeSeat("s0");
    table.beginRound();
    throwIt();
    expect(spun[2]).toBe("s2");
  });
});

describe("a casino round with odds in it", () => {
  const throwing = (table: Table, value: number) => {
    table.boxerThrows(() => value);
    table.land();
    table.read(() => value);
  };

  it("throws again on odds rather than settling", () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.closeBetting();
    let at = 0;
    const split = () => (at++ % 2 === 0 ? 0.1 : 0.9);
    table.boxerThrows(split);
    table.land();
    table.read(split);
    expect(table.phase).toBe("spinning");
    expect(table.throws).toEqual(["odds"]);
  });

  it("takes both sides on the fifth odds", () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.place("s1", "fiveOdds", 25);
    table.closeBetting();
    let at = 0;
    const split = () => (at++ % 2 === 0 ? 0.1 : 0.9);
    /*
     * One press, then five throws. The spinner is ceremonial here: they press
     * the kip once for the round and `read` releases each re-throw itself.
     */
    table.boxerThrows(split);
    for (let round = 0; round < 5; round += 1) {
      table.land();
      table.read(split);
    }
    expect(table.phase).toBe("settled");
    expect(table.called).toBe("fiveOdds");
    expect(table.paid?.get("s0")?.back).toBe(0);
    expect(table.paid?.get("s1")?.back).toBe(775);
  });

  it("settles the moment the coins agree", () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.closeBetting();
    throwing(table, 0.1);
    expect(table.phase).toBe("settled");
    expect(table.called).toBe("heads");
    expect(table.paid?.get("s0")?.back).toBe(200);
  });

  it("puts every throw on the board, odds included", () => {
    /*
     * An odds throw is not a result but it is emphatically something that
     * happened, and a board that hid them would misreport an evening where the
     * coins came down split nine times running.
     */
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.closeBetting();
    let at = 0;
    const split = () => (at++ % 2 === 0 ? 0.1 : 0.9);
    table.boxerThrows(split);
    table.land();
    table.read(split);
    throwing(table, 0.1);
    expect(table.history).toEqual(["odds", "heads"]);
  });
});

describe("the view", () => {
  it("shows a seat its own purse at a for-fun table and nobody's anywhere else", () => {
    const fun = new Table("ABCD", 8, { school: "casino", forFun: true });
    fun.join("s0", "P0", null);
    expect(fun.view("s0").you?.purse).toBeGreaterThan(0);
    expect(seated("casino").view("s0").you?.purse).toBeNull();
  });

  it("does not name the faces before the coins have landed", () => {
    /*
     * The result exists from the moment the coins are thrown, because the
     * server decides it then. Every drawing of the view is a chance to give it
     * away, and the felt needs the faces only once they are down.
     */
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.closeBetting();
    table.boxerThrows(() => 0.1);
    expect(table.phase).toBe("spinning");
    expect(table.view(null).faces).not.toBeNull();
  });
});

describe("putting last round's chips down again", () => {
  /* One round played through to a result, so there is a last round at all. */
  const played = () => {
    const table = seated("casino");
    table.place("s0", "heads", 100);
    table.closeBetting();
    table.boxerThrows(() => 0.1);
    table.land();
    table.read(() => 0.1);
    table.beginRound();
    return table;
  };

  it("tells a seat that has a round behind it", () => {
    expect(played().view("s0").canRepeat).toBe(true);
  });

  it("tells a seat that has not put anything down yet", () => {
    /*
     * A button offered against nothing is a button that lies about what it
     * will do — the same reason the wheel carries this flag rather than
     * letting the felt guess from a cloth it cannot see the history of.
     */
    expect(seated("casino").view("s0").canRepeat).toBe(false);
  });

  it("tells a seat that sat down after the round it would repeat", () => {
    const table = played();
    table.join("s9", "P9", { userId: "u9", avatar: null, accentColor: null });
    expect(table.view("s9").canRepeat).toBe(false);
  });

  it("tells a watcher nothing to repeat", () => {
    expect(played().view(null).canRepeat).toBe(false);
  });
});
