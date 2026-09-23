import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import type { Card, Rank } from "./cards.js";
import { Table } from "./table.js";

/**
 * A table dealing a known sequence.
 *
 * The shoe takes its randomness from outside, so a shuffle can be replaced by
 * an arrangement — which is the only way to assert what a hand pays.
 */
function stacked(...ranks: Rank[]): Table {
  const table = new Table("TEST1");
  const cards: Card[] = ranks.map((rank) => ({ rank, suit: "spades" }));
  // The shoe draws off the end, so the order is reversed going in.
  const stack = [...cards].reverse();
  // Anything past the arrangement is a two, which never surprises anyone.
  Object.defineProperty(table, "shoe", {
    value: {
      refresh() {},
      draw: () => stack.pop() ?? ({ rank: "2", suit: "hearts" } as Card),
    },
  });
  return table;
}

/**
 * One player, and somebody else at the table who never bets.
 *
 * A table playing for chips will not deal to one person — chips are only won
 * from real people — so a test about one hand still needs a second seat. The
 * companion stakes nothing, so they are never dealt in and every arranged shoe
 * still reaches the hand it was arranged for.
 */
function seatOne(table: Table) {
  table.join("a", "Ada", { userId: "u1", avatar: null, accentColor: null });
  table.join("z", "Bo", { userId: "u-company", avatar: null, accentColor: null });
}

function seatTwo(table: Table) {
  table.join("a", "Ada", { userId: "u1", avatar: null, accentColor: null });
  table.join("b", "Bo", { userId: "u2", avatar: null, accentColor: null });
}

describe("taking a stake", () => {
  it("refuses a guest, because there is no friendly blackjack", () => {
    const table = new Table("TEST1");
    expect(() => table.join("a", "Ada")).toThrow(/sign in/i);
  });

  it("keeps a bet above the smallest chip on the felt", () => {
    const table = new Table("TEST1");
    seatOne(table);
    expect(() => table.bet("a", 50)).toThrow(TableError);
    table.bet("a", 500);
    expect(table.seats[0]?.hands[0]?.bet).toBe(500);
  });

  it("lets a stake be taken back off the felt before the deal", () => {
    const table = new Table("TEST1");
    seatOne(table);
    table.bet("a", 500);
    table.bet("a", 0);
    expect(table.seats[0]?.hands[0]?.bet).toBe(0);
    // And so there is nothing left to deal to.
    expect(() => table.deal()).toThrow(/nobody has bet/i);
  });

  it("will not deal with nothing on the table", () => {
    const table = new Table("TEST1");
    seatOne(table);
    expect(() => table.deal()).toThrow(/nobody has bet/i);
  });

  it("deals itself once the betting window closes", () => {
    /*
     * Nobody's call any more. The table runs on a clock, so closing the window
     * is what deals — and who, if anybody, may hurry that along is a house
     * rule that belongs with the adapter rather than here.
     */
    // Arranged rather than shuffled: a natural ends the hand where it stands,
    // so a live shoe would have this asserting "playing" against a table that
    // had correctly gone straight to settled about one run in twenty.
    const table = stacked("5", "6", "7", "8");
    seatTwo(table);
    table.bet("a", 500);

    table.closeBetting();

    expect(table.phase).toBe("playing");
    expect(table.deadline).toBeNull();
  });

  it("opens the felt again when nobody staked anything", () => {
    const table = new Table("TEST1");
    seatTwo(table);
    const first = table.deadline ?? 0;

    table.closeBetting();

    /*
     * Still betting, with the window open again: an empty round is not a hand.
     * Not asserted by the deadline having changed — both windows can open
     * inside the same millisecond, and a test that fails on a fast machine is
     * a test about the clock rather than about the table.
     */
    expect(table.phase).toBe("betting");
    expect(table.deadline).not.toBeNull();
    expect(table.deadline ?? 0).toBeGreaterThanOrEqual(first);
    expect(table.lastEvent).toMatch(/place your bets/i);
    // And nothing was dealt to nobody.
    expect(table.dealer).toHaveLength(0);
  });
});

describe("how long the felt stays open", () => {
  it("takes one of the windows on offer", () => {
    const table = new Table("TEST1");

    table.setWindow(15_000);

    expect(table.bettingMs).toBe(15_000);
    expect(table.view().bettingMs).toBe(15_000);
  });

  it("refuses a window nobody offered", () => {
    // Two seconds is a table nobody can bet at; ten minutes is not a table.
    const table = new Table("TEST1");

    expect(() => table.setWindow(2000)).toThrow(TableError);
    expect(() => table.setWindow(600_000)).toThrow(/not one of the windows/i);
    expect(table.bettingMs).toBe(30_000);
  });

  it("leaves the window that is already running alone", () => {
    /*
     * The deal is scheduled against the clock people are watching. Moving that
     * deadline out from under them either deals a hand somebody had not
     * finished betting on, or waits on a moment that has already gone.
     */
    const table = new Table("TEST1");
    seatTwo(table);
    const running = table.deadline;

    table.setWindow(60_000);

    expect(table.deadline).toBe(running);
  });

  it("opens the next window at the new length", () => {
    const table = stacked("5", "6", "7", "8");
    seatTwo(table);
    table.setWindow(15_000);

    const before = Date.now();
    table.beginBetting();

    expect(table.deadline ?? 0).toBeGreaterThanOrEqual(before + 15_000);
    expect(table.deadline ?? 0).toBeLessThan(before + 20_000);
  });
});

describe("chips are only won from real people", () => {
  it("will not seat a bot at a table playing for chips", () => {
    /*
     * A bot has no account to charge and none to pay, so a hand won against
     * one at a table paying real chips is chips out of thin air. Greed refuses
     * the same thing once there is a buy-in on its table.
     */
    const table = new Table("TEST1");

    expect(() => table.addBot("bot", "Cassie", "normal")).toThrow(TableError);
    expect(() => table.addBot("bot", "Cassie", "normal")).toThrow(/playing for fun/i);
    expect(table.seats).toHaveLength(0);
  });

  it("seats a bot happily at a table playing for nothing", () => {
    // The whole reason bots exist: a for-fun table worth sitting at alone.
    const table = new Table("FUN01", Math.random, true);

    expect(table.addBot("bot", "Cassie", "normal").isBot).toBe(true);
  });

  it("will not deal for chips to one person, however much they bet", () => {
    const table = new Table("TEST1");
    table.join("a", "Ada", { userId: "u1", avatar: null, accentColor: null });
    table.bet("a", 500);

    expect(table.canDeal).toBe(false);
    expect(() => table.deal()).toThrow(/somebody to play it with/i);
  });

  it("holds the window open rather than pocketing what is on the felt", () => {
    /*
     * The stake was taken from an account when it was placed. Clearing the
     * felt to wait would be the table keeping it, so the window simply opens
     * again with everything where it was.
     */
    const table = new Table("TEST1");
    table.join("a", "Ada", { userId: "u1", avatar: null, accentColor: null });
    table.bet("a", 500);

    table.closeBetting();

    expect(table.phase).toBe("betting");
    expect(table.seats[0]?.hands[0]?.bet).toBe(500);
    expect(table.lastEvent).toMatch(/waiting for another player/i);
    expect(table.view().waitingForPlayers).toBe(true);
  });

  it("deals the moment somebody else sits down", () => {
    const table = stacked("5", "6", "7", "8");
    table.join("a", "Ada", { userId: "u1", avatar: null, accentColor: null });
    table.bet("a", 500);
    table.closeBetting();
    expect(table.phase).toBe("betting");

    table.join("b", "Bo", { userId: "u2", avatar: null, accentColor: null });
    table.closeBetting();

    expect(table.phase).toBe("playing");
    // And the stake that waited through it is the stake in the hand.
    expect(table.seats[0]?.hands[0]?.bet).toBe(500);
  });

  it("never makes a for-fun table wait for company", () => {
    // There is nothing to win at one, which is the entire point of it.
    const table = new Table("FUN01", Math.random, true);
    table.join("a", "Ada");

    expect(table.canDeal).toBe(true);
    expect(table.view().waitingForPlayers).toBe(false);
  });
});

describe("last call", () => {
  /** A table with the deal a moment away, rather than half a minute. */
  function closing(): Table {
    const table = new Table("TEST1");
    seatTwo(table);
    table.bet("a", 500);
    // Inside the last five seconds, without a test waiting twenty-five of them.
    table.deadline = Date.now() + 2000;
    return table;
  }

  it("stops taking chips in the last seconds before the deal", () => {
    const table = closing();

    expect(() => table.bet("a", 1000)).toThrow(TableError);
    expect(() => table.bet("a", 1000)).toThrow(/last call/i);
    // And the felt is where it was: a refused bet is not a bet.
    expect(table.seats[0]?.hands[0]?.bet).toBe(500);
  });

  it("lets you take your chips back right up to the deal", () => {
    const table = closing();

    table.bet("a", 0);

    expect(table.seats[0]?.hands[0]?.bet).toBe(0);
    expect(table.lastEvent).toMatch(/took their chips back/i);
  });

  it("lets you leave less on the felt, which is the same direction", () => {
    const table = closing();

    table.bet("a", 200);

    expect(table.seats[0]?.hands[0]?.bet).toBe(200);
  });

  it("has not gone out while the window is still open", () => {
    const table = new Table("TEST1");
    seatTwo(table);

    expect(table.lastCall).toBe(false);
    table.bet("a", 1000);
    expect(table.seats[0]?.hands[0]?.bet).toBe(1000);
  });

  it("is not a thing between hands, when there is nothing to add to", () => {
    const table = stacked("5", "6", "7", "8");
    seatTwo(table);
    table.bet("a", 500);
    table.closeBetting();

    // Playing, with no deadline at all: last call is a fact about the window.
    expect(table.lastCall).toBe(false);
  });
});

describe("the dealer's hole card", () => {
  it("is not in the view while the hand is being played", () => {
    // Ada 10, dealer 9, Ada 7, dealer K — so the dealer's second card is a king.
    const table = stacked("10", "9", "7", "K");
    seatOne(table);
    table.bet("a", 500);
    table.deal();

    const view = table.view("a");
    /*
     * Absent rather than flagged. A card that reaches the browser has been
     * dealt to everybody whatever the markup says, so the check is that it is
     * not in the payload at all.
     */
    expect(view.dealer.cards).toHaveLength(1);
    expect(view.dealer.cards[0]?.rank).toBe("9");
    expect(view.dealer.hidden).toBe(true);
    expect(JSON.stringify(view)).not.toContain('"K"');
  });

  it("is face up once the dealer has played", () => {
    const table = stacked("10", "9", "7", "K");
    seatOne(table);
    table.bet("a", 500);
    table.deal();
    table.stand("a");

    const view = table.view("a");
    expect(view.dealer.hidden).toBe(false);
    expect(view.dealer.cards.length).toBeGreaterThanOrEqual(2);
    expect(view.dealer.total).toBe(19);
  });
});

describe("playing a hand", () => {
  it("gives each player their turn in order", () => {
    const table = stacked("5", "6", "9", "7", "K", "8");
    seatTwo(table);
    table.bet("a", 500);
    table.bet("b", 500);
    table.deal();

    expect(table.currentSeat()?.id).toBe("a");
    expect(() => table.hit("b")).toThrow(/not your turn/i);
    table.stand("a");
    expect(table.currentSeat()?.id).toBe("b");
  });

  it("ends a turn the moment a hand busts", () => {
    // Ada 10, dealer 6, Ada 9, dealer 5, then a king for Ada.
    const table = stacked("10", "6", "9", "5", "K");
    seatOne(table);
    table.bet("a", 500);
    table.deal();

    table.hit("a");
    expect(table.seats[0]?.hands[0]?.outcome).toBe("bust");
    expect(table.phase).toBe("settled");
  });

  it("does not deal the dealer cards it does not need", () => {
    /*
     * Everyone bust, so there is nothing to beat. The house keeps the stakes
     * whatever it would have drawn, and drawing anyway only invites an
     * argument about what came out of the shoe.
     */
    const table = stacked("10", "6", "9", "5", "K");
    seatOne(table);
    table.bet("a", 500);
    table.deal();
    table.hit("a");

    expect(table.dealer).toHaveLength(2);
    expect(table.seats[0]?.hands[0]?.returned).toBe(0);
  });

  it("doubles for exactly one card, and only at the start", () => {
    const table = stacked("5", "6", "6", "5", "9");
    seatOne(table);
    table.bet("a", 500);
    table.deal();

    const extra = table.double("a");
    expect(extra).toBe(500);
    expect(table.seats[0]?.hands[0]?.bet).toBe(1000);
    expect(table.seats[0]?.hands[0]?.cards).toHaveLength(3);
    expect(table.seats[0]?.hands[0]?.done).toBe(true);
  });

  it("refuses a double once a card has been taken", () => {
    const table = stacked("5", "6", "6", "5", "2", "9");
    seatOne(table);
    table.bet("a", 500);
    table.deal();
    table.hit("a");
    expect(() => table.double("a")).toThrow(/first two cards/i);
  });
});

describe("what a hand pays", () => {
  /** Plays one hand out and reports what came back. */
  function payout(ranks: Rank[], play: (table: Table) => void = (t) => t.stand("a")) {
    const table = stacked(...ranks);
    seatOne(table);
    table.bet("a", 1000);
    table.deal();
    if (table.phase === "playing") {
      play(table);
    }
    // The one hand this seat is playing. Splitting is covered on its own.
    const hand = table.seats[0]?.hands[0];
    return { outcome: hand?.outcome, returned: hand?.returned, bet: hand?.bet };
  }

  it("pays a blackjack three to two, with the stake back", () => {
    // Ada A, dealer 9, Ada K, dealer 7 — Ada has twenty-one on two cards.
    expect(payout(["A", "9", "K", "7"])).toEqual({
      outcome: "blackjack",
      returned: 2500,
      bet: 1000,
    });
  });

  it("pays a plain win evens", () => {
    // Ada 10, dealer 9, Ada 9 (19), dealer 7 (16), dealer draws a 2 to 18.
    expect(payout(["10", "9", "9", "7", "2"])).toEqual({
      outcome: "won",
      returned: 2000,
      bet: 1000,
    });
  });

  it("returns the stake on a push", () => {
    // Both on nineteen.
    expect(payout(["10", "9", "9", "K"])).toEqual({ outcome: "push", returned: 1000, bet: 1000 });
  });

  it("keeps the stake when the dealer is closer", () => {
    // Ada 18, dealer 20.
    expect(payout(["10", "K", "8", "K"])).toEqual({ outcome: "lost", returned: 0, bet: 1000 });
  });

  it("pays everyone standing when the dealer busts", () => {
    // Ada 15 and stands; dealer 6 + 6 = 12, draws a king to 22.
    expect(payout(["10", "6", "5", "6", "K"])).toEqual({
      outcome: "won",
      returned: 2000,
      bet: 1000,
    });
  });

  it("ties two blackjacks rather than paying either", () => {
    // Ada A K, dealer A K.
    expect(payout(["A", "A", "K", "K"])).toEqual({
      outcome: "push",
      returned: 1000,
      bet: 1000,
    });
  });

  it("beats a plain twenty-one with a blackjack, and says which is which", () => {
    // Ada 7 7 7 the long way; dealer A K on two.
    const table = stacked("7", "A", "7", "K", "7");
    seatOne(table);
    table.bet("a", 1000);
    table.deal();
    table.hit("a");
    expect(table.seats[0]?.hands[0]?.outcome).toBe("lost");
  });

  it("pays double what was doubled", () => {
    // Ada 5 6, doubles into a 9 for twenty; dealer 6 5 draws to nineteen.
    const table = stacked("5", "6", "6", "5", "9", "8");
    seatOne(table);
    table.bet("a", 1000);
    table.deal();
    table.double("a");
    expect(table.seats[0]?.hands[0]?.bet).toBe(2000);
    expect(table.seats[0]?.hands[0]?.outcome).toBe("won");
    expect(table.seats[0]?.hands[0]?.returned).toBe(4000);
  });
});

describe("the next round", () => {
  it("clears the table and keeps everybody at it", () => {
    const table = stacked("10", "9", "9", "K");
    seatTwo(table);
    table.bet("a", 500);
    table.deal();
    table.stand("a");
    expect(table.phase).toBe("settled");

    table.beginBetting();

    expect(table.phase).toBe("betting");
    expect(table.seats).toHaveLength(2);
    expect(
      table.seats.every(
        (seat) => seat.hands.length === 1 && seat.hands[0]?.bet === 0 && seat.hands[0]?.cards.length === 0,
      ),
    ).toBe(true);
    expect(table.dealer).toHaveLength(0);
  });

  it("deals in whoever arrived while the last hand was running", () => {
    const table = stacked("10", "9", "9", "K");
    seatOne(table);
    table.bet("a", 500);
    table.deal();

    const late = table.join("c", "Cy", { userId: "u3", avatar: null, accentColor: null });
    expect(late.waiting).toBe(true);
    // Refused because a hand is running, which is the only way to be waiting.
    expect(() => table.bet("c", 500)).toThrow(/already been dealt/i);

    table.stand("a");
    table.beginBetting();
    expect(table.seats.every((seat) => !seat.waiting)).toBe(true);
    table.bet("c", 500);
    // Found by who they are rather than where they sit: a seat's position is
    // not a fact this test is about.
    expect(table.seats.find((seat) => seat.id === "c")?.hands[0]?.bet).toBe(500);
  });
});

/*
 * Saying you have finished betting.
 *
 * The window is a clock everybody waits out, and most of the time everybody
 * decided long before it ran down. What matters is the cases where the table
 * must *not* deal early: one keen player must not cut short everybody else,
 * and a chair nobody is sitting in must not hold the table up for ever.
 */
describe("being ready", () => {
  const seated = (names: string[]) => {
    const table = new Table("READY", () => 0.5, false, 6);
    for (const name of names) {
      table.join(name, name, { userId: `u-${name}`, avatar: null, accentColor: null });
    }
    return table;
  };

  it("does not deal while somebody has not said so", () => {
    const table = seated(["a", "b"]);
    table.bet("a", 100);
    table.bet("b", 100);
    table.setReady("a", true);
    expect(table.everyoneReady).toBe(false);
    expect(table.phase).toBe("betting");
  });

  it("is ready once everybody has said so", () => {
    const table = seated(["a", "b"]);
    table.bet("a", 100);
    table.bet("b", 100);
    table.setReady("a", true);
    table.setReady("b", true);
    expect(table.everyoneReady).toBe(true);
  });

  it("will not deal a hand nobody is in", () => {
    // Everybody ready with nothing on the felt is everybody sitting out, which
    // is not a hand — it is an empty table agreeing to look at each other.
    const table = seated(["a", "b"]);
    table.setReady("a", true);
    table.setReady("b", true);
    expect(table.everyoneReady).toBe(false);
  });

  it("lets somebody sit a hand out without holding the table up", () => {
    // A seat with nothing on the felt can still be ready. That is how you skip
    // a hand rather than making everybody else wait out the clock for you.
    const table = seated(["a", "b"]);
    table.bet("a", 100);
    table.setReady("a", true);
    table.setReady("b", true);
    expect(table.everyoneReady).toBe(true);
  });

  it("does not wait for a chair nobody is sitting in", () => {
    /*
     * Somebody who has dropped out will never click anything. A table that
     * waited for them would never deal again, which is a worse outcome than
     * dealing without them.
     */
    const table = seated(["a", "b", "c"]);
    table.bet("a", 100);
    table.bet("b", 100);
    table.setReady("a", true);
    table.setReady("b", true);
    table.disconnect("c");
    expect(table.everyoneReady).toBe(true);
  });

  it("does not wait for a bot to press anything", () => {
    /*
     * A bot has no opinion about when to deal and will never click. A table
     * that waited on one would never leave the betting window at all, which
     * is the whole of what this button exists to avoid.
     */
    const table = new Table("READY", () => 0.5, true, 6);
    table.join("a", "a", { userId: "u-a", avatar: null, accentColor: null });
    table.addBot("bot1", "Bot", "normal");
    table.bet("a", 100);
    table.setReady("a", true);
    expect(table.seats.some((seat) => seat.isBot)).toBe(true);
    expect(table.everyoneReady).toBe(true);
  });

  it("forgets it when the bet changes", () => {
    // Changing your mind about the bet is changing your mind about being ready.
    const table = seated(["a", "b"]);
    table.bet("a", 100);
    table.bet("b", 100);
    table.setReady("a", true);
    table.setReady("b", true);
    table.bet("b", 500);
    expect(table.everyoneReady).toBe(false);
  });

  it("can be taken back", () => {
    const table = seated(["a", "b"]);
    table.bet("a", 100);
    table.bet("b", 100);
    table.setReady("a", true);
    table.setReady("b", true);
    table.setReady("a", false);
    expect(table.everyoneReady).toBe(false);
  });

  it("does not carry into the next hand", () => {
    // A new window is a new decision. Carrying it over would deal the second
    // hand the instant the first one settled, before anybody had bet.
    const table = seated(["a", "b"]);
    table.bet("a", 100);
    table.bet("b", 100);
    table.setReady("a", true);
    table.setReady("b", true);
    table.deal();
    table.beginBetting();
    expect(table.seats.every((seat) => seat.ready === false)).toBe(true);
    expect(table.everyoneReady).toBe(false);
  });

  it("is not something to say once the cards are out", () => {
    const table = seated(["a", "b"]);
    table.bet("a", 100);
    table.bet("b", 100);
    table.deal();
    expect(() => table.setReady("a", true)).toThrow(/nothing to be ready for/i);
  });

  it("will not deal to one player at a chips table", () => {
    // The house rule outranks the button: ready or not, a chips table needs
    // somebody to play it with.
    const table = seated(["a"]);
    table.bet("a", 100);
    table.setReady("a", true);
    expect(table.everyoneReady).toBe(false);
  });
});

describe("what the table says", () => {
  /*
   * The browser keeps the log from the latest line alone, and it can only tell
   * a second "Ada is ready" from the same broadcast arriving twice if something
   * moves between them.
   */
  it("counts the same words said twice running as two things said", () => {
    const table = new Table("TEST1");
    seatTwo(table);
    table.setReady("a", true);
    expect(table.view().eventSeq).toBe(3);
    table.setReady("a", true);
    expect(table.view().lastEvent).toBe("Ada is ready");
    expect(table.view().eventSeq).toBe(4);
  });

  it("does not move for a look at the table that says nothing new", () => {
    const table = new Table("TEST1");
    seatTwo(table);
    expect(table.view().eventSeq).toBe(2);
    table.view();
    expect(table.view().eventSeq).toBe(2);
  });
});


describe("what the felt may bet", () => {
  it("takes a stake past the old flat ceiling", () => {
    /*
     * The table used to hold a limit of its own at ten thousand, which sat on
     * top of the bank's and hid it: a felt with a hundred thousand behind it
     * still said ten. What the bank can cover is a question for the store, so
     * the only place that can ask it is the adapter — and a second ceiling
     * here could only ever be lower than the real one.
     */
    const table = new Table("TEST1");
    seatOne(table);
    table.bet("a", 50_000);
    expect(table.seats[0]?.hands[0]?.bet).toBe(50_000);
  });

  it("offers as much of the bank as one seat's worst hand could take", () => {
    const table = new Table("TEST1");
    seatOne(table);
    table.bankHolds = 200_000;
    // Four to one on today's rules: split, both doubled, both won.
    expect(table.view("a").maxBet).toBe(50_000);
  });

  it("takes what the other seats could win off what is left for this one", () => {
    const table = new Table("TEST1");
    seatTwo(table);
    table.bet("b", 4_000);
    // What the store holds once Bo's stake has gone into it.
    table.bankHolds = 44_000;
    /*
     * Bo's four thousand is in the bank and is exactly the money Bo may have
     * to be paid out of, so it buys Ada nothing: sixteen thousand of headroom
     * is spoken for, and a quarter of the rest is hers.
     */
    expect(table.view("a").maxBet).toBe(6_000);
  });

  it("offers nothing at all when the bank is empty", () => {
    const table = new Table("TEST1");
    seatOne(table);
    expect(table.view("a").maxBet).toBe(0);
  });

  it("offers the purse at a for-fun table, which is all there is to lose", () => {
    const table = new Table("TEST1", Math.random, true);
    table.join("a", "Ada", { userId: "u1", avatar: null, accentColor: null });
    expect(table.view("a").maxBet).toBe(5_000);
  });

  it("counts a for-fun stake already down as still the player's own", () => {
    const table = new Table("TEST1", Math.random, true);
    table.join("a", "Ada", { userId: "u1", avatar: null, accentColor: null });
    table.bet("a", 2_000);
    // Changing a bet is not spending twice, so the whole purse is still on offer.
    expect(table.view("a").maxBet).toBe(5_000);
  });
});
