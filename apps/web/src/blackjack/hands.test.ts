import { describe, expect, it } from "vitest";
import { card, hand, seat, settledHand, theirTurn, view, yourTurn } from "./fixtures.js";
import type { SeatView } from "./hands.js";
import {
  availableTo,
  chipRefusal,
  clockText,
  doubleOffer,
  handTag,
  nextSeatId,
  paidOut,
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

describe("a chip that cannot be added", () => {
  it("says last call first, then the limit, then the balance", () => {
    expect(chipRefusal(100, 0, 10_000, 12_400, true)).toBe("Last call: chips can only come off now");
    expect(chipRefusal(1_000, 9_500, 10_000, 12_400, false)).toBe("1,000 more is past the 10,000 limit");
    expect(chipRefusal(500, 0, 10_000, 300, false)).toBe("You do not have 500 more to bet");
    expect(chipRefusal(500, 9_500, 10_000, 12_400, false)).toBeNull();
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
});
