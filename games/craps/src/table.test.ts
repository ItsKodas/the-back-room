import { describe, expect, it } from "vitest";
import { MIN_CHIP } from "./bank.js";
import type { Roll } from "./dice.js";
import { Table, WINDOWS } from "./table.js";

/** A table whose dice do whatever the test says next. */
function tableWith(faces: number[][], seats = 4) {
  let at = 0;
  const table = new Table("AAAAA", seats, {
    pick: () => {
      const next = faces[Math.floor(at / 2)]?.[at % 2] ?? 1;
      at += 1;
      return next - 1;
    },
    window: WINDOWS[0],
  });
  table.forFun = true;
  return table;
}

/** Seal, release with a bottomless bank, and land. Returns what the dice did. */
function play(table: Table): void {
  table.seal();
  table.release(Number.MAX_SAFE_INTEGER);
  table.land();
}

describe("sitting down", () => {
  it("hands the dice to the first person to sit", () => {
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    expect(table.shooterId).toBe(seat.id);
  });

  it("passes the dice along when the shooter stands up", () => {
    const table = tableWith([[3, 3]]);
    const one = table.join("s1", "Ada", null);
    const two = table.join("s2", "Bea", null);
    expect(table.shooterId).toBe(one.id);
    table.removeSeat(one.id);
    expect(table.shooterId).toBe(two.id);
  });
});

describe("the hand", () => {
  it("sets a point and keeps it until it is made", () => {
    const table = tableWith([
      [3, 3], // six: the point
      [2, 3], // five: nothing
      [4, 2], // six: made
    ]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "pass", MIN_CHIP);

    play(table);
    expect(table.point).toBe(6);
    table.beginBetting();

    play(table);
    expect(table.point).toBe(6);
    table.beginBetting();

    play(table);
    expect(table.point).toBeNull();
    expect(table.history.at(-1)?.what).toBe("made");
  });

  it("passes the dice on a seven-out and not on a point made", () => {
    // Making your point is why you keep the dice. Sevening out is why you
    // stop — and a table that passed them on a winner would be a table
    // nobody wants to shoot at.
    const table = tableWith([
      [3, 3], // six: point
      [3, 3], // six: made — the dice stay
      [3, 3], // six: point again
      [3, 4], // seven out — the dice go
    ]);
    const one = table.join("s1", "Ada", null);
    const two = table.join("s2", "Bea", null);
    table.place(one.id, "pass", MIN_CHIP);

    play(table);
    table.beginBetting();
    play(table);
    expect(table.shooterId).toBe(one.id);
    table.beginBetting();
    table.place(one.id, "pass", MIN_CHIP);
    play(table);
    table.beginBetting();
    play(table);
    expect(table.shooterId).toBe(two.id);
  });
});

describe("the cloth is not swept", () => {
  it("leaves a place bet standing across rolls", () => {
    const table = tableWith([
      [3, 3], // six: point set, and the place bet was asleep for it
      [2, 3], // five: pays the place five, which stays
    ]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "pass", MIN_CHIP);
    table.place(seat.id, "place:5", MIN_CHIP * 5);

    play(table);
    table.beginBetting();
    expect(table.placed.map((one) => one.spotId).sort()).toEqual(["pass", "place:5"]);

    play(table);
    expect(table.paid?.get(seat.id)?.back).toBe(MIN_CHIP * 7);
    table.beginBetting();
    // Still down, and its flag cleared ready to be asked again.
    expect(table.placed).toContainEqual({
      seatId: seat.id,
      spotId: "place:5",
      chips: MIN_CHIP * 5,
      off: false,
    });
  });

  it("sleeps the numbers through a come-out unless the seat works them", () => {
    const table = tableWith([[3, 4]]); // seven on the come-out
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "place:5", MIN_CHIP * 5);
    play(table);
    // A seven takes every place bet on the cloth — but not a sleeping one.
    expect(table.placed).toHaveLength(1);

    table.beginBetting();
    table.setWorking(seat.id, true);
    const awake = tableWith([[3, 4]]);
    awake.join("s1", "Ada", null);
    awake.setWorking("s1", true);
    awake.place("s1", "place:5", MIN_CHIP * 5);
    play(awake);
    expect(awake.placed).toHaveLength(0);
  });
});

describe("the window", () => {
  it("holds with the felt untouched when there is nothing to roll for", () => {
    // Clearing the cloth to wait would be the table keeping the money, and a
    // stream of results nobody bet on would walk the board along.
    const table = tableWith([[3, 3]]);
    table.join("s1", "Ada", null);
    table.seal();
    expect(table.phase).toBe("betting");
    expect(table.deadline).toBeGreaterThan(Date.now());
  });

  it("rolls anyway once a point is on, whatever is on the cloth", () => {
    // The hand has to finish. A point with an empty cloth is still a point.
    const table = tableWith([[3, 3], [3, 4]]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "pass", MIN_CHIP);
    play(table);
    table.beginBetting();
    table.clear(seat.id);
    // Nothing left down but the pass line, which is a contract and stays.
    table.seal();
    expect(table.phase).toBe("sealed");
  });

  it("never opens already in last call, however short the window", () => {
    // Five seconds as a flat figure inverted on a fifteen-second window and
    // refused every bet for the whole of it. A ceiling, not a constant.
    const table = new Table("AAAAA", 4, { window: 6_000 });
    expect(table.lastCallMs).toBe(2_000);
    expect(table.lastCall).toBe(false);
  });
});

describe("contracts", () => {
  it("refuses to take the pass line down once the point is on", () => {
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "pass", MIN_CHIP);
    play(table);
    table.beginBetting();
    expect(() => table.take(seat.id, "pass", MIN_CHIP)).toThrow(/stays/i);
  });

  it("lets the dark side come down, because leaving it up is always better", () => {
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "dontpass", MIN_CHIP);
    play(table);
    table.beginBetting();
    expect(table.take(seat.id, "dontpass", MIN_CHIP)).toBe(MIN_CHIP);
  });
});

describe("what the table will take", () => {
  it("refuses a spot the table puts chips on rather than a player", () => {
    const table = tableWith([[3, 3]]);
    table.join("s1", "Ada", null);
    expect(() => table.check("s1", "come:6", MIN_CHIP)).toThrow(/no such bet/i);
  });

  it("refuses the line box once the point is on, and the come box before it", () => {
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    expect(() => table.check(seat.id, "come", MIN_CHIP)).toThrow(/wait for the point/i);
    table.place(seat.id, "pass", MIN_CHIP);
    play(table);
    table.beginBetting();
    expect(() => table.check(seat.id, "pass", MIN_CHIP)).toThrow(/point is on/i);
    expect(() => table.check(seat.id, "come", MIN_CHIP)).not.toThrow();
  });

  it("refuses a horn that cannot be split four ways", () => {
    const table = tableWith([[3, 3]]);
    table.join("s1", "Ada", null);
    expect(() => table.check("s1", "horn", MIN_CHIP)).toThrow(/multiples of 60/);
    expect(() => table.check("s1", "horn", MIN_CHIP * 2)).not.toThrow();
  });

  it("refuses odds with nothing behind them, and more than the line allows", () => {
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    expect(() => table.check(seat.id, "odds:pass", MIN_CHIP)).toThrow(/nothing to back/i);
    table.place(seat.id, "pass", MIN_CHIP);
    play(table);
    table.beginBetting();
    // Point is six, so five times the line and not a chip more.
    expect(() => table.check(seat.id, "odds:pass", MIN_CHIP * 5)).not.toThrow();
    expect(() => table.check(seat.id, "odds:pass", MIN_CHIP * 6)).toThrow(/most you may/i);
  });
});

describe("the view", () => {
  it("says whose dice they are and whether they may be thrown", () => {
    const table = tableWith([[3, 3]]);
    const one = table.join("s1", "Ada", null);
    table.join("s2", "Bea", null);
    table.place(one.id, "pass", MIN_CHIP);
    expect(table.view(one.id).canRoll).toBe(true);
    expect(table.view("s2").canRoll).toBe(false);
  });

  it("keeps the dice to itself until they have landed", () => {
    // The felt is handed the faces during the throw so the dice can settle on
    // them — but the result is the server's fact and the phase is what tells
    // the felt when it may be read.
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "pass", MIN_CHIP);
    expect(table.view(seat.id).dice).toBeNull();
    table.seal();
    table.release(Number.MAX_SAFE_INTEGER);
    expect(table.view(seat.id).phase).toBe("rolling");
    expect(table.view(seat.id).dice).toEqual([3, 3] as Roll);
  });
});
