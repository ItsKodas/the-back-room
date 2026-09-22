import { describe, expect, it } from "vitest";
import { card, hand, seat, settledHand, theirTurn, view, yourTurn } from "./fixtures.js";
import type { SeatView } from "./hands.js";
import {
  availableTo,
  betRefusal,
  clockText,
  doubleOffer,
  handTag,
  nextSeatId,
  paidOut,
  reachOf,
  readBet,
  seatTag,
  splitOffer,
} from "./hands.js";

describe("reading a hand", () => {
  it("adds up what a seat got back across every hand", () => {
    expect(paidOut(seat("a", "Ada", { hands: [hand({ returned: 1_000 }), hand({ returned: 500 })] }))).toBe(1_500);
  });

  it("reads a clock the way a table does", () => {
    expect(clockText(14)).toBe("0:14");
    expect(clockText(65)).toBe("1:05");
  });
});

describe("what a player can still put down", () => {
  it("is the purse at a for-fun table, less a stake shown ahead of the table", () => {
    const table = view({ forFun: true });
    const ada = seat("a", "Ada", { purse: 4_500, bet: 500 });
    expect(availableTo(table, ada, null, 500)).toBe(4_500);
    expect(availableTo(table, ada, null, 1_500)).toBe(3_500);
  });

  it("is the account's balance at a table for chips, and unknown for a guest", () => {
    const ada = seat("a", "Ada");
    expect(availableTo(view(), ada, 12_400, 0)).toBe(12_400);
    expect(availableTo(view(), ada, null, 0)).toBeNull();
  });
});

describe("doubling and splitting", () => {
  const two = hand({ bet: 500, cards: [card("9"), card("7")], total: 16 });

  it("offers a double on two cards, at the hand's stake", () => {
    expect(doubleOffer(two, 12_400)).toEqual({ ok: true, cost: 500 });
  });

  it("says why a double is out", () => {
    expect(doubleOffer(hand({ bet: 500, cards: [card("9"), card("2"), card("5")] }), 12_400)).toEqual({
      ok: false,
      reason: "3 cards",
    });
    expect(doubleOffer(two, 400)).toEqual({ ok: false, reason: "not enough" });
  });

  it("counts a king and a queen as a pair, as the table does", () => {
    const court = hand({ bet: 500, cards: [card("K"), card("Q", "hearts")], total: 20 });
    expect(splitOffer(seat("a", "Ada", { hands: [court] }), court, null)).toEqual({ ok: true, cost: 500 });
  });

  it("says why a split is out", () => {
    expect(splitOffer(seat("a", "Ada", { hands: [two] }), two, 12_400)).toEqual({ ok: false, reason: "no pair" });
    const eights = hand({ bet: 500, cards: [card("8"), card("8", "hearts")], fromSplit: true });
    expect(splitOffer(seat("a", "Ada", { hands: [eights, hand()] }), eights, 12_400)).toEqual({
      ok: false,
      reason: "once a seat",
    });
  });
});

describe("a stake that cannot be set", () => {
  it("says last call first, then the floor, then the bank, then the balance", () => {
    expect(betRefusal(5_000, 1_000, 100, 50_000, 12_400, true)).toBe("Last call: 5,000 cannot go on now");
    expect(betRefusal(50, 0, 100, 50_000, 12_400, false)).toBe("Bets start at 100");
    expect(betRefusal(5_000, 0, 100, 1_000, 12_400, false)).toBe("5,000 is past what the bank covers (1,000)");
    expect(betRefusal(5_000, 0, 100, 50_000, 300, false)).toBe("You do not have 5,000 to bet");
    expect(betRefusal(5_000, 0, 100, 50_000, 12_400, false)).toBeNull();
  });

  it("lets a stake come off at last call, which is the one thing it is for", () => {
    expect(betRefusal(500, 1_000, 100, 50_000, 12_400, true)).toBeNull();
  });
});

describe("what a stake can be set to", () => {
  it("counts what is already on the felt as still the player's own", () => {
    const table = view({ seats: [seat("a", "Ada", { bet: 1_000 }), seat("b", "Bo")] });
    expect(reachOf(table, table.seats[0] as SeatView, 12_400)).toBe(13_400);
  });

  it("is the purse at a for-fun table, where there is no account to ask", () => {
    const table = view({ forFun: true, seats: [seat("a", "Ada", { bet: 500, purse: 4_500 }), seat("b", "Bo")] });
    expect(reachOf(table, table.seats[0] as SeatView, null)).toBe(5_000);
  });

  it("is unknown for a guest, who has no balance to go on", () => {
    const table = view();
    expect(reachOf(table, table.seats[0] as SeatView, null)).toBeNull();
  });
});

describe("a figure typed into the box", () => {
  it("takes commas the way a felt writes them, and nothing else", () => {
    expect(readBet("3,200")).toBe(3_200);
    expect(readBet("")).toBeNull();
    expect(readBet("  ")).toBeNull();
  });
});

describe("what a seat says about itself", () => {
  it("while betting", () => {
    const table = view({ seats: [seat("a", "Ada", { ready: true }), seat("b", "Bo", { bet: 250 }), seat("c", "Cy")] });
    expect(table.seats.map((one) => seatTag(table, one))).toEqual([
      { text: "Ready", tone: "live" },
      { text: "Not ready", tone: "quiet" },
      { text: "Yet to bet", tone: "quiet" },
    ]);
  });

  it("sitting out, waiting for the next hand, or gone", () => {
    const base = yourTurn();
    const table = {
      ...base,
      seats: [
        ...base.seats,
        seat("c", "Cy", { waiting: true }),
        seat("d", "Dee", { connected: false, bet: 100 }),
        seat("e", "Eli"),
      ],
    };
    expect(table.seats.slice(2).map((one) => seatTag(table, one)?.text)).toEqual(["Next hand", "Dropped", "Sat out"]);
  });

  it("while a hand is played: nothing on the seat acting, and what the others did", () => {
    const table = theirTurn();
    expect(table.seats.map((one) => seatTag(table, one))).toEqual([{ text: "Stood", tone: "quiet" }, null]);
  });

  it("names the seat the turn goes to next", () => {
    const table = view({
      status: "playing",
      phase: "playing",
      turnSeatId: "a",
      seats: [
        seat("a", "Ada", { bet: 500, hands: [hand({ bet: 500, cards: [card("9"), card("7")], total: 16 })] }),
        seat("b", "Bo", { bet: 250, hands: [hand({ bet: 250, cards: [card("5"), card("6")], total: 11 })] }),
      ],
    });
    expect(nextSeatId(table)).toBe("b");
    expect(seatTag(table, table.seats[1] as SeatView)).toEqual({ text: "Next", tone: "quiet" });
  });

  it("once it is over, in gold only for a payout", () => {
    const table = settledHand();
    expect(table.seats.map((one) => seatTag(table, one))).toEqual([
      { text: "Paid 750", tone: "chips" },
      { text: "Bust", tone: "bad" },
    ]);
    expect(handTag(hand({ bet: 500, done: true, outcome: "won", returned: 1_000 }))).toEqual({
      text: "Won 500",
      tone: "good",
    });
  });

  it("says push and lost, the two commonest outcomes at the table", () => {
    expect(handTag(hand({ bet: 500, done: true, outcome: "push", returned: 500 }))).toEqual({
      text: "Push",
      tone: "quiet",
    });
    expect(handTag(hand({ bet: 500, done: true, outcome: "lost", returned: 0 }))).toEqual({
      text: "Lost",
      tone: "bad",
    });
  });

  it("says Blackjack for a natural reached before the hand around it has settled", () => {
    // outcome stays null mid-round; only isNatural says this hand is a blackjack.
    const natural = hand({ bet: 500, done: true, outcome: null, cards: [card("A"), card("K")], total: 21 });
    expect(handTag(natural)).toEqual({ text: "Blackjack", tone: "quiet" });
  });
});
