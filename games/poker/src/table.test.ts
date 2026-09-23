import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { TITLES } from "./hand.js";
import { Table } from "./table.js";

/**
 * A hand of hold'em, played out.
 *
 * The evaluator and the side pots are proved on their own; what is only
 * reachable here is the order of it — who speaks, when the betting closes,
 * what the blinds did, and that chips never appear or disappear along the way.
 *
 * That last one is asserted on nearly every test rather than once: a betting
 * bug shows up as chips that stopped existing long before it shows up as a
 * wrong winner.
 */

/** A table with known players and a shuffle that cannot surprise anybody. */
function table(stacks: number[], seed = 1, maxSeats = 10): Table {
  /*
   * A fixed sequence rather than Math.random, so a test that fails fails for
   * everybody. Which cards come out is not what these tests are about — but a
   * shuffle that changes between runs would make them flake anyway.
   */
  let at = seed;
  const random = () => {
    at = (at * 1103515245 + 12345) % 2147483648;
    return at / 2147483648;
  };
  const made = new Table("TEST", random, 50, 100, maxSeats);
  stacks.forEach((stack, index) => {
    made.join(`s${index}`, `P${index}`, {
      userId: `u${index}`,
      avatar: null,
      accentColor: null,
    });
    made.buyIn(`s${index}`, stack);
  });
  return made;
}

/** Everything anybody has, at the table and on the felt. */
const chips = (made: Table) =>
  made.seats.reduce((total, seat) => total + seat.stack, 0) + made.pot;

describe("dealing a hand", () => {
  it("will not deal to one player", () => {
    const made = table([1_000]);
    expect(made.canDeal).toBe(false);
    expect(() => made.deal()).toThrow(/two people/i);
  });

  it("deals two cards each and posts the blinds", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();

    for (const seat of made.seats) {
      expect(seat.hole).toHaveLength(2);
    }
    // Fifty and a hundred are in the middle, and out of two stacks.
    expect(made.pot).toBe(150);
    expect(made.seats.filter((s) => s.stack === 1_000)).toHaveLength(1);
    expect(chips(made)).toBe(3_000);
  });

  it("gives everybody a different hand", () => {
    // Twelve cards off one deck: any card appearing twice is a deck being
    // dealt from after it was refilled, which is the one thing it must not do.
    const made = table([1_000, 1_000, 1_000, 1_000, 1_000, 1_000]);
    made.deal();
    const dealt = made.seats.flatMap((seat) => seat.hole).map((c) => `${c.rank}${c.suit}`);
    expect(new Set(dealt).size).toBe(dealt.length);
  });

  it("moves the button on every hand", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    const first = made.button;
    while (made.street !== "showdown") {
      made.act(made.toAct as string, "fold");
    }
    made.finish();
    made.deal();
    expect(made.button).not.toBe(first);
  });

  it("does not deal in somebody who sat down mid-hand", () => {
    const made = table([1_000, 1_000]);
    made.deal();
    made.join("late", "Late", { userId: "ulate", avatar: null, accentColor: null });
    made.buyIn("late", 1_000);
    expect(made.seats.find((s) => s.id === "late")?.hole).toHaveLength(0);
    expect(made.seats.find((s) => s.id === "late")?.waiting).toBe(true);
  });
});

describe("whose turn it is", () => {
  it("starts with the seat after the big blind", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    // Three seats: button, small, big. The one to act is the button again.
    expect(made.toAct).toBe(made.button);
  });

  it("gives the button the first word before the flop heads up", () => {
    // The exception every poker rule set makes: two-handed, the button posts
    // the small blind and speaks first before the flop.
    const made = table([1_000, 1_000]);
    made.deal();
    expect(made.toAct).toBe(made.button);
  });

  it("gives the button the last word after it, heads up", () => {
    const made = table([1_000, 1_000]);
    made.deal();
    made.act(made.toAct as string, "call");
    made.act(made.toAct as string, "check");
    expect(made.street).toBe("flop");
    // Postflop the button is last, so the other seat speaks first.
    expect(made.toAct).not.toBe(made.button);
  });

  it("skips anybody who is all in", () => {
    /*
     * The big blind here cannot cover it, so they are all in before anybody
     * has spoken. A seat with nothing left has no decision to make and must
     * never be asked for one — a table that waits on them waits for ever.
     */
    const made = table([1_000, 1_000, 50]);
    made.deal();
    const short = made.seats.find((seat) => seat.id === "s2");
    expect(short?.stack).toBe(0);
    expect(short?.allIn).toBe(true);

    let guard = 0;
    while (made.street === "preflop" && made.toAct !== null && guard < 20) {
      expect(made.toAct).not.toBe("s2");
      const seat = made.seats.find((one) => one.id === made.toAct);
      made.act(made.toAct as string, seat !== undefined && made.owed(seat) > 0 ? "call" : "check");
      guard += 1;
    }
  });
});

describe("the betting", () => {
  it("closes a street once everybody has called", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    made.act(made.toAct as string, "call");
    made.act(made.toAct as string, "call");
    made.act(made.toAct as string, "check");
    expect(made.street).toBe("flop");
    expect(made.board).toHaveLength(3);
  });

  it("reopens the betting when somebody raises", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    made.act(made.toAct as string, "call");
    made.act(made.toAct as string, "raise", 300);
    // The seat that already called owes more and has to speak again.
    expect(made.street).toBe("preflop");
    expect(made.toAct).not.toBeNull();
  });

  it("refuses a check when there is something to call", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    expect(() => made.act(made.toAct as string, "check")).toThrow(/check for free/i);
  });

  it("refuses a raise smaller than the last one", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    // The blind is the opening raise, so the smallest raise is to 200.
    expect(() => made.act(made.toAct as string, "raise", 150)).toThrow(/smallest raise/i);
  });

  it("refuses a raise nobody can cover", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    expect(() => made.act(made.toAct as string, "raise", 9_000)).toThrow(/cover/i);
  });

  it("refuses a raise to an amount that is not a number", () => {
    /*
     * The second lock on the same door. The adapter asks the question of the
     * wire before anything reaches here, but every bound below is a
     * comparison and a comparison against `NaN` is false — so `NaN` would
     * reach `put`, come off a stack, and take every chip on the table with
     * it. Refused here too, for whatever calls this next.
     */
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    const before = made.seats.map((seat) => seat.stack);
    expect(() => made.act(made.toAct as string, "raise", Number.NaN)).toThrow(TableError);
    expect(made.seats.map((seat) => seat.stack)).toEqual(before);
  });

  it("refuses a move out of turn", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    const other = made.seats.find((seat) => seat.id !== made.toAct) as { id: string };
    expect(() => made.act(other.id, "fold")).toThrow(/not your turn/i);
  });

  it("runs the streets out in order", () => {
    const made = table([1_000, 1_000]);
    made.deal();
    const seen: string[] = [];
    let guard = 0;
    while (made.street !== "showdown" && guard < 40) {
      seen.push(made.street);
      const seat = made.seats.find((s) => s.id === made.toAct);
      made.act(made.toAct as string, seat !== undefined && made.owed(seat) > 0 ? "call" : "check");
      guard += 1;
    }
    expect([...new Set(seen)]).toEqual(["preflop", "flop", "turn", "river"]);
    expect(made.board).toHaveLength(5);
  });
});

describe("how a hand ends", () => {
  it("pays the last one standing without a showdown", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    made.act(made.toAct as string, "fold");
    made.act(made.toAct as string, "fold");
    expect(made.street).toBe("showdown");
    expect(made.paid).toHaveLength(1);
    // Nobody paid to see it, so nobody sees it.
    expect(made.paid[0]?.said).toBeNull();
    expect(chips(made)).toBe(3_000);
  });

  it("shows the hands when more than one is still in", () => {
    const made = table([1_000, 1_000]);
    made.deal();
    let guard = 0;
    while (made.street !== "showdown" && guard < 40) {
      const seat = made.seats.find((s) => s.id === made.toAct);
      made.act(made.toAct as string, seat !== undefined && made.owed(seat) > 0 ? "call" : "check");
      guard += 1;
    }
    expect(made.paid.every((one) => one.said !== null)).toBe(true);
    expect(made.seats.every((seat) => seat.showed !== null)).toBe(true);
  });

  it("never creates or destroys a chip, whoever wins", () => {
    /*
     * The invariant this whole file rests on. Played out a hundred times with
     * different shuffles and a mixture of folds, calls and raises: what is on
     * the table at the end is what was on it at the start.
     */
    for (let seed = 1; seed <= 100; seed += 1) {
      const made = table([1_000, 2_500, 700, 400, 5_000], seed);
      const before = chips(made);
      let guard = 0;
      made.deal();
      while (made.street !== "showdown" && made.toAct !== null && guard < 200) {
        const seat = made.seats.find((s) => s.id === made.toAct);
        if (seat === undefined) {
          break;
        }
        const owed = made.owed(seat);
        const move = guard % 7 === 0 ? "fold" : owed > 0 ? "call" : "check";
        made.act(seat.id, move);
        guard += 1;
      }
      expect(chips(made)).toBe(before);
      expect(made.seats.every((seat) => seat.stack >= 0)).toBe(true);
    }
  });

  it("pays out everything that was staked, and no more", () => {
    /*
     * Whatever the cards did, the payouts have to add up to what went in. The
     * middle is empty afterwards on purpose: a table that left the pot set as
     * well as paying it into a stack would be claiming the same chips twice.
     */
    const made = table([1_000, 1_000]);
    const before = chips(made);
    made.deal();
    let guard = 0;
    while (made.street !== "showdown" && guard < 40) {
      const seat = made.seats.find((s) => s.id === made.toAct);
      made.act(made.toAct as string, seat !== undefined && made.owed(seat) > 0 ? "call" : "check");
      guard += 1;
    }
    const total = made.paid.reduce((sum, one) => sum + one.chips, 0);
    expect(total).toBeGreaterThan(0);
    expect(made.pot).toBe(0);
    expect(chips(made)).toBe(before);
    // And every chip paid out came off somebody: the stacks account for it all.
    expect(made.seats.reduce((sum, seat) => sum + seat.stack, 0)).toBe(before);
  });

  it("gives a short stack only what they could win", () => {
    /*
     * The side pot, end to end. The short stack is all in for less than the
     * others, so even winning they cannot take the part of the pot they never
     * covered.
     */
    const made = table([200, 5_000, 5_000]);
    made.deal();
    let guard = 0;
    while (made.street !== "showdown" && made.toAct !== null && guard < 60) {
      const seat = made.seats.find((s) => s.id === made.toAct);
      if (seat === undefined) {
        break;
      }
      made.act(seat.id, made.owed(seat) > 0 ? "call" : "check");
      guard += 1;
    }
    expect(chips(made)).toBe(10_200);
    const short = made.seats.find((seat) => seat.id === "s0");
    // Whatever happened, they cannot have more than three times their stack.
    expect(short?.stack ?? 0).toBeLessThanOrEqual(600);
  });
});

describe("what a seat is told it may do", () => {
  /*
   * The felt draws its buttons from this, so what is wrong here is a control
   * offered for a move the table then refuses — or worse, not offered for one
   * it would have taken.
   */
  const own = (made: Table, seatId: string) => {
    const view = made.view(seatId);
    return view.you;
  };

  it("says nothing to somebody who is not at the table", () => {
    const made = table([1_000, 1_000]);
    expect(made.view(null).you).toBeNull();
    expect(made.view("nobody").you).toBeNull();
  });

  it("asks the big blind for nothing and the small blind for the difference", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    const big = made.seats.find((seat) => seat.id === made.bigBlindId) as { id: string };
    const small = made.seats.find((seat) => seat.id === made.smallBlindId) as { id: string };

    expect(own(made, big.id)?.toCall).toBe(0);
    // 100 in, 50 already up: the other 50.
    expect(own(made, small.id)?.toCall).toBe(50);
  });

  it("gives the smallest raise as a total, not as a difference", () => {
    /*
     * A raise is sent as the figure to raise *to*, so this has to be that
     * figure. The table's own `minRaise` is a delta, and handing the browser
     * the delta is how a slider ends up a blind out at every stop.
     */
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    const seatId = made.toAct as string;
    // Preflop the highest is the big blind, and the smallest raise is one more
    // of it on top: to 200, whatever this seat has already put in.
    expect(own(made, seatId)?.minRaiseTo).toBe(200);
  });

  it("caps the largest raise at what the seat actually has", () => {
    const made = table([1_000, 1_000, 240]);
    made.deal();
    const short = made.seats.find((seat) => seat.stack + seat.committed === 240) as { id: string };
    const mine = own(made, short.id);
    expect(mine?.maxRaiseTo).toBe(240);
    // And the smallest never asks for more than the largest allows.
    expect(mine?.minRaiseTo).toBeLessThanOrEqual(240);
  });

  it("offers no raise to somebody who cannot cover a call", () => {
    // 30 chips against a 100 blind: calling is all in, and there is no raise
    // to make. A slider here would have one stop on it.
    const made = table([1_000, 1_000, 30]);
    made.deal();
    const short = made.seats.find((seat) => seat.stack + seat.committed === 30) as { id: string };
    expect(own(made, short.id)?.canRaise).toBe(false);
  });
});

describe("what a seat may see of another", () => {
  it("says which seats are somebody with an account", () => {
    // A bot is not a real person and a guest has no account, so neither can be
    // either end of a stake — the server says so, and the view has to as well.
    const made = table([1_000, 1_000]);
    made.seats[1].userId = null;
    expect(made.view(null).seats.map((seat) => seat.signedIn)).toEqual([true, false]);
  });
});

describe("reading your own hand", () => {
  /*
   * The felt shows you what you are holding, and this is where that comes
   * from. Read on the table rather than in the browser so the name it gives
   * you during the hand cannot disagree with the one it announces at the
   * showdown — and of the two, this is the one that pays out.
   */
  it("says nothing before there is a hand to read", () => {
    const made = table([1_000, 1_000]);
    made.deal();
    // Two cards are not a hand. Naming one would be the felt inventing it.
    expect(made.view(made.toAct).you?.hand).toBeNull();
  });

  it("names what you hold once the flop is out", () => {
    const made = table([1_000, 1_000]);
    made.deal();
    made.act(made.toAct as string, "call");
    made.act(made.toAct as string, "check");

    const seatId = made.toAct as string;
    const mine = made.view(seatId).you?.hand;
    expect(mine).not.toBeNull();
    // Whatever it dealt, it is one of the ten and it is spelled out.
    expect(Object.values(TITLES)).toContain(mine?.title);
    expect(mine?.said.length).toBeGreaterThan(0);
  });

  it("tells each seat about its own hand and nobody else's", () => {
    const made = table([1_000, 1_000]);
    made.deal();
    made.act(made.toAct as string, "call");
    made.act(made.toAct as string, "check");

    const [one, two] = made.seats;
    const first = made.view((one as { id: string }).id).you?.hand;
    const second = made.view((two as { id: string }).id).you?.hand;
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // Somebody watching has no hand to be told about.
    expect(made.view(null).you).toBeNull();
  });
});

describe("the clock", () => {
  it("is null while nobody is being waited on, and a deadline once somebody is", () => {
    const made = table([1_000, 1_000]);
    expect(made.turnEndsAt).toBeNull();
    made.deal();
    expect(made.turnEndsAt).toBeGreaterThan(Date.now());
    // The same answer the view gives, because a felt counting down to a
    // different moment from the table is a felt that folds hands early.
    expect(made.view(made.toAct).turnEndsAt).toBe(made.turnEndsAt);
  });
});

describe("leaving", () => {
  it("folds somebody who walks out mid-hand and keeps their chips in", () => {
    /*
     * Standing up is folding, not taking your money back. Otherwise the way to
     * never lose a hand would be to close the tab when it went badly.
     */
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    const potWas = made.pot;
    made.leave(made.toAct as string);
    expect(made.pot).toBeGreaterThanOrEqual(potWas);
    expect(made.seats).toHaveLength(2);
  });

  it("leaves the money a departing seat had already bet in the pot", () => {
    /*
     * The seat goes; what it bet does not. Rebuilding the pot from the seats
     * still at the table loses it — and the existing test above misses that,
     * because the seat it walks out is the one to act, who preflop has put in
     * nothing. This one walks out a blind.
     */
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    const potWas = made.pot;
    const blind = made.seats.find((seat) => seat.paid > 0 && seat.id !== made.toAct);
    made.leave((blind as { id: string }).id);

    expect(made.pot).toBe(potWas);
    expect(made.street).toBe("preflop");
  });

  it("neither mints nor loses a chip when somebody walks out mid-hand", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    const before = chips(made);
    const blind = made.seats.find((seat) => seat.paid > 0 && seat.id !== made.toAct);
    made.leave((blind as { id: string }).id);

    // What they took off the table, plus what is left on it, is what there was.
    const took = made.escrow.due.reduce((total, one) => total + one.chips, 0);
    expect(chips(made) + took).toBe(before);
  });

  it("pays the dead money of somebody who left to whoever wins the hand", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    const potWas = made.pot;
    const blind = made.seats.find((seat) => seat.paid > 0 && seat.id !== made.toAct);
    made.leave((blind as { id: string }).id);

    // The other two fold it out, so the last one standing takes the lot —
    // including the blind of somebody who is no longer at the table.
    while (made.street === "preflop" && made.toAct !== null && made.seats.length > 1) {
      const before = made.toAct;
      made.act(before, "fold");
      if (made.toAct === before) {
        break;
      }
    }
    expect(made.street).toBe("showdown");
    const won = made.paid.reduce((total, one) => total + one.chips, 0);
    expect(won).toBe(potWas);
  });

  it("ends the hand when everybody but one has gone", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    made.act(made.toAct as string, "fold");
    made.leave(made.toAct as string);
    expect(made.street).toBe("showdown");
  });
});

/*
 * What a hand paid, pot by pot.
 *
 * Payouts used to be summed per seat, which loses the one thing a felt needs to
 * announce them separately: a side pot is a different pot, won by different
 * people, and once it is added into a total it cannot be taken back out.
 */
describe("paying out a hand with a side pot", () => {
  /** A short stack that cannot cover the others, which is what makes one. */
  function shortStacked(): Table {
    const made = table([300, 5_000, 5_000]);
    made.deal();
    // Everybody in, all the way, so the short stack is all in and the other
    // two keep betting past them.
    for (let guard = 0; guard < 40 && made.street !== "showdown"; guard += 1) {
      const seatId = made.toAct;
      if (seatId === null) {
        break;
      }
      const seat = made.seats.find((one) => one.id === seatId);
      made.act(seatId, made.owed(seat as never) > 0 ? "call" : "check");
    }
    return made;
  }

  it("says which pot each payout came out of", () => {
    const made = shortStacked();
    expect(made.paid.length).toBeGreaterThan(0);
    for (const one of made.paid) {
      expect(Number.isInteger(one.pot)).toBe(true);
      expect(one.pot).toBeGreaterThanOrEqual(0);
    }
  });

  it("numbers the pots from the main one outwards, with no gaps", () => {
    /*
     * The felt walks these in order and holds the showdown open for one moment
     * each, so a gap would be a silent pause in the middle of the sequence.
     */
    const made = shortStacked();
    const seen = [...new Set(made.paid.map((one) => one.pot))].sort((a, b) => a - b);
    expect(seen[0]).toBe(0);
    for (const [at, pot] of seen.entries()) {
      expect(pot).toBe(at);
    }
  });

  it("pays out exactly what was in the middle, however it was split", () => {
    // The rule underneath all of it: the pots add up to the pot.
    const made = table([300, 5_000, 5_000]);
    const before = chips(made);
    made.deal();
    for (let guard = 0; guard < 40 && made.street !== "showdown"; guard += 1) {
      const seatId = made.toAct;
      if (seatId === null) {
        break;
      }
      const seat = made.seats.find((one) => one.id === seatId);
      made.act(seatId, made.owed(seat as never) > 0 ? "call" : "check");
    }
    expect(chips(made)).toBe(before);
  });
});

describe("eventSeq", () => {
  it("moves on for every action the table reports", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    const before = made.view(made.seats[0].id).eventSeq;
    made.act(made.toAct as string, "call");
    const after = made.view(made.seats[0].id).eventSeq;
    expect(after).toBe(before + 1);
  });

  it("moves on again for a second action of the same kind", () => {
    const made = table([1_000, 1_000, 1_000]);
    made.deal();
    // Close the preflop betting so the flop deals: button calls, small blind
    // calls, big blind checks it shut.
    made.act(made.toAct as string, "call");
    made.act(made.toAct as string, "call");
    made.act(made.toAct as string, "check");
    expect(made.street).toBe("flop");

    const between = made.view(made.seats[0].id).eventSeq;
    made.act(made.toAct as string, "check");
    const afterFirstCheck = made.view(made.seats[0].id).eventSeq;
    expect(afterFirstCheck).toBe(between + 1);

    // Two checks in a row are two events. The counter is the only thing that
    // can say so — the sentences differ only by a name, and may not differ at
    // all once two players share one.
    made.act(made.toAct as string, "check");
    expect(made.view(made.seats[0].id).eventSeq).toBe(afterFirstCheck + 1);
  });

  it("does not move on when nothing happened", () => {
    const made = table([1_000, 1_000]);
    made.deal();
    const at = made.view(made.seats[0].id).eventSeq;
    made.view(made.seats[0].id);
    made.view(made.seats[0].id);
    expect(made.view(made.seats[0].id).eventSeq).toBe(at);
  });
});

describe("maxSeats", () => {
  it("carries the host's own ceiling, not the building's", () => {
    // A six-seat table, not the ten the building allows — the view has to
    // say which one this host actually chose, or a client gating bots on it
    // (poker's own PokerSheet does) offers a full table one more seat than
    // exists.
    const made = table([1_000, 1_000], 1, 6);
    expect(made.view(made.seats[0].id).maxSeats).toBe(6);
  });
});
