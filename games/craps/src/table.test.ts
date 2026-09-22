import { describe, expect, it } from "vitest";
import { HORN_STEP, MIN_CHIP } from "./bank.js";
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

  it("shows the dice once they are thrown, not before", () => {
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

  it("never offers the roll to a watcher when nobody holds the dice", () => {
    // shooterId and forSeatId are both null before anybody has sat down, and
    // null === null is not "yes, this is your turn."
    const table = tableWith([[3, 3]]);
    expect(table.view(null).canRoll).toBe(false);
  });
});

describe("the escrow does not empty on a roll it did not decide", () => {
  it("still holds a bet that survived a roll, so a later take-back can release it", () => {
    // Roulette clears its whole escrow every spin because its cloth is swept
    // every spin — the two always hold the same chips. This cloth is not
    // swept, so a blanket clear here would leave chips on the felt with
    // nothing behind them in the escrow to release when they come off it.
    const table = tableWith([[3, 3]]); // six on the come-out: sets the point, and the place bet sleeps through it
    // A chips table, not a for-fun one — the escrow only holds real stakes.
    table.forFun = false;
    const seat = table.join("s1", "Ada", { userId: "u1", avatar: null, accentColor: null });
    table.place(seat.id, "place:5", MIN_CHIP * 5);

    play(table);
    // Still on the felt...
    expect(table.placed).toContainEqual({
      seatId: seat.id,
      spotId: "place:5",
      chips: MIN_CHIP * 5,
      off: false,
    });
    // ...and the escrow still knows it, because it was never handed anywhere.
    expect(table.escrow.heldBy("u1")).toBe(MIN_CHIP * 5);

    table.beginBetting();
    const off = table.take(seat.id, "place:5", MIN_CHIP * 5);
    expect(table.escrow.release("u1", off)).toBe(MIN_CHIP * 5);
  });
});

describe("accounts outlive the point when chips still ride", () => {
  it("keeps the account behind a seat whose come bet outlives the point", () => {
    // A travelled come bet, a place bet or a hardway can all survive the
    // point being made — the felt still owes whoever put them there.
    const table = tableWith([
      [3, 3], // six: point set
      [2, 3], // five: the come bet's own come-out — travels to five
      [4, 2], // six: point made, hand ends — but the come bet is still live
    ]);
    const seat = table.join("s1", "Ada", { userId: "u1", avatar: null, accentColor: null });
    table.place(seat.id, "pass", MIN_CHIP);
    play(table);
    table.beginBetting();

    table.place(seat.id, "come", MIN_CHIP);
    play(table);
    table.beginBetting();

    table.removeSeat(seat.id);
    play(table);
    table.beginBetting();

    expect(table.point).toBeNull();
    expect(table.placed.some((one) => one.spotId === "come:5")).toBe(true);
    expect(table.accountOf(seat.id)).toBe("u1");
  });
});

describe("the dice with three or more seats", () => {
  it("passes to the seat that was next, not back to the front", () => {
    // With findIndex alone, removing the shooter makes the *first* remaining
    // seat the shooter — right only when there happen to be two seats.
    const table = tableWith([[3, 3]]);
    table.join("s1", "Ada", null);
    const two = table.join("s2", "Bea", null);
    const three = table.join("s3", "Cleo", null);
    table.shooterId = two.id;
    table.removeSeat(two.id);
    expect(table.shooterId).toBe(three.id);
  });
});

describe("release is a one-way door", () => {
  it("refuses a second release, so the dice cannot be re-thrown over a published result", () => {
    const table = tableWith([
      [3, 3],
      [4, 2],
    ]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "pass", MIN_CHIP);
    table.seal();
    const first = table.release(Number.MAX_SAFE_INTEGER);
    expect(() => table.release(Number.MAX_SAFE_INTEGER)).toThrow();
    expect(table.dice).toEqual(first);
  });
});

describe("odds caps quote a chip somebody can actually place", () => {
  it("rounds a dark-side cap down to a whole chip", () => {
    // maxOdds(6, 30, true) is 216, which nothing on this tray can place.
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "dontpass", MIN_CHIP);
    play(table);
    table.beginBetting();
    expect(() => table.check(seat.id, "odds:dontpass", MIN_CHIP * 8)).toThrow(
      /most you may put behind that is 210/,
    );
    expect(() => table.check(seat.id, "odds:dontpass", 210)).not.toThrow();
  });
});

describe("undo and clear skip contracts", () => {
  it("leaves a contract on the cloth when the rest is cleared", () => {
    // Otherwise a player clears their way out of a bet the point has been set on.
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "pass", MIN_CHIP);
    table.place(seat.id, "place:5", MIN_CHIP * 5);
    play(table);
    table.beginBetting();
    table.clear(seat.id);
    expect(table.placed.map((one) => one.spotId)).toEqual(["pass"]);
  });

  it("skips the pass line for undo once it is a contract", () => {
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "pass", MIN_CHIP);
    play(table);
    table.beginBetting();
    // The pass line is the only chip down, and it is a contract now.
    table.undo(seat.id);
    expect(table.placed).toContainEqual({
      seatId: seat.id,
      spotId: "pass",
      chips: MIN_CHIP,
      off: false,
    });
  });
});

describe("offByBank", () => {
  it("names only what the bank turned off", () => {
    // The felt uses offByBank to explain a refusal. Listing a bet its owner
    // put to sleep would tell somebody the bank is broke when they switched
    // it off themselves.
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "place:5", MIN_CHIP * 5); // asleep on the come-out — not the bank's doing
    table.place(seat.id, "horn", HORN_STEP); // awake regardless, and too rich for this bank
    table.seal();
    table.release(0);
    expect(table.offByBank).toEqual(["horn"]);
  });
});

describe("sleeps before the bank is asked", () => {
  it("puts the sleeping bets to bed before the bank is asked", () => {
    /*
     * Order, not outcome. `working` never turns a bet back on, so a bet its
     * owner slept through the come-out has to already be marked off when it
     * gets there — and `owed` must not count it, or the bank is asked to cover
     * a bet that cannot be asked for anything and turns off something else to
     * pay for it.
     *
     * A bottomless bank cannot show this: `working` never fires and the two
     * orders agree. The bank here is tight enough that it has to choose — and
     * OFF_ORDER puts a prop ahead of a place bet, so if the place bet's own
     * sleep flag had not already been applied, `working` would reach for the
     * horn first, find that alone enough, and leave the place bet marked on.
     * offByBank cannot see that failure — it only lists what got turned off,
     * and this bug's symptom is a bet that wrongly stayed on — so the
     * assertion that matters is on the place bet itself.
     */
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "place:5", MIN_CHIP * 5); // asleep on the come-out
    table.place(seat.id, "horn", HORN_STEP); // awake, and alone too rich for this bank
    table.seal();
    table.release(0);

    const place = table.placed.find((one) => one.spotId === "place:5");
    const horn = table.placed.find((one) => one.spotId === "horn");
    // The bank did have to decide something...
    expect(table.offByBank.length).toBeGreaterThan(0);
    // ...and it was the horn, never the place bet — which stays asleep either way.
    expect(horn?.off).toBe(true);
    expect(place?.off).toBe(true);
  });
});

describe("shoot", () => {
  it("refuses anyone but the shooter, whatever the clock says", () => {
    const table = tableWith([[3, 3]]);
    const one = table.join("s1", "Ada", null);
    const two = table.join("s2", "Bea", null);
    table.place(one.id, "pass", MIN_CHIP);
    expect(() => table.shoot(two.id)).toThrow(/not your dice/i);
  });

  it("refuses to seal before the window has had its share of time", () => {
    // Otherwise the shooter bets and seals in the same tick, every round, and
    // nobody else at the table ever gets to put a chip down — the mirror image
    // of the idle shooter the auto-seal solves.
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "pass", MIN_CHIP);
    expect(() => table.shoot(seat.id)).toThrow(/everybody/i);
  });

  it("lets the shooter seal once the window has had its share of time", () => {
    const table = tableWith([[3, 3]]);
    const seat = table.join("s1", "Ada", null);
    table.place(seat.id, "pass", MIN_CHIP);
    table.deadline = Date.now() - 1;
    table.shoot(seat.id);
    expect(table.phase).toBe("sealed");
  });
});
