import { describe, expect, it } from "vitest";
import type { Face } from "./bid.js";
import { Round } from "./round.js";

const hands = (entries: Record<string, Face[]>) =>
  new Map<string, readonly Face[]>(Object.entries(entries));

const round = () =>
  new Round(["a", "b", "c"], hands({ a: [5, 5, 2], b: [1, 6, 6], c: [3, 4, 5] }));

describe("a round", () => {
  it("opens on the first in the order with nothing said", () => {
    const one = round();
    expect(one.toAct).toBe("a");
    expect(one.bid).toBe(null);
    expect(one.over).toBe(false);
    expect(one.total).toBe(9);
  });

  it("passes the turn on a raise", () => {
    const one = round();
    one.raise("a", { count: 3, face: 5 });
    expect(one.bid).toEqual({ count: 3, face: 5 });
    expect(one.bidder).toBe("a");
    expect(one.toAct).toBe("b");
  });

  it("comes back round to the first player", () => {
    const one = round();
    one.raise("a", { count: 1, face: 2 });
    one.raise("b", { count: 2, face: 2 });
    one.raise("c", { count: 3, face: 2 });
    expect(one.toAct).toBe("a");
  });

  it("refuses somebody else's turn", () => {
    const one = round();
    expect(() => one.raise("b", { count: 3, face: 5 })).toThrow("It is not your turn.");
  });

  it("refuses a bid that is not higher", () => {
    const one = round();
    one.raise("a", { count: 3, face: 5 });
    expect(() => one.raise("b", { count: 3, face: 4 })).toThrow("higher than the bid");
  });

  it("refuses more dice than are on the table", () => {
    const one = round();
    expect(() => one.raise("a", { count: 10, face: 5 })).toThrow("only nine dice");
  });

  it("refuses a face that is not a face", () => {
    const one = round();
    expect(() => one.raise("a", { count: 2, face: 9 as Face })).toThrow("not a face");
  });

  it("refuses a call before anything has been said", () => {
    const one = round();
    expect(() => one.call("a", "liar")).toThrow("nothing to call");
  });
});

describe("calling liar", () => {
  it("costs the challenger a die when the bid was good", () => {
    // Fives plus the wild one: four on the table. Three fives was true.
    const one = round();
    one.raise("a", { count: 3, face: 5 });
    const out = one.call("b", "liar");
    expect(out.count).toBe(4);
    expect(out.right).toBe(true);
    expect(out.losers).toEqual(["b"]);
  });

  it("costs the bidder a die when it was not", () => {
    const one = round();
    one.raise("a", { count: 5, face: 5 });
    const out = one.call("b", "liar");
    expect(out.count).toBe(4);
    expect(out.right).toBe(false);
    expect(out.losers).toEqual(["a"]);
  });

  it("counts a bid met exactly as good", () => {
    const one = round();
    one.raise("a", { count: 4, face: 5 });
    expect(one.call("b", "liar").right).toBe(true);
  });

  it("turns every hand face up", () => {
    const one = round();
    one.raise("a", { count: 4, face: 5 });
    const out = one.call("b", "liar");
    expect(out.hands).toEqual([
      { seatId: "a", dice: [5, 5, 2] },
      { seatId: "b", dice: [1, 6, 6] },
      { seatId: "c", dice: [3, 4, 5] },
    ]);
  });

  it("ends the round", () => {
    const one = round();
    one.raise("a", { count: 4, face: 5 });
    one.call("b", "liar");
    expect(one.over).toBe(true);
    expect(() => one.raise("c", { count: 5, face: 5 })).toThrow("This round is over.");
    expect(() => one.call("c", "liar")).toThrow("This round is over.");
  });
});

describe("calling exact", () => {
  it("costs everybody else a die when it is right", () => {
    const one = round();
    one.raise("a", { count: 4, face: 5 });
    const out = one.call("b", "exact");
    expect(out.right).toBe(true);
    expect(out.losers).toEqual(["a", "c"]);
  });

  it("costs only the caller when it is wrong", () => {
    const one = round();
    one.raise("a", { count: 3, face: 5 });
    const out = one.call("b", "exact");
    expect(out.right).toBe(false);
    expect(out.losers).toEqual(["b"]);
  });

  it("is wrong when the bid falls short of the count", () => {
    const one = round();
    one.raise("a", { count: 2, face: 5 });
    expect(one.call("b", "exact").right).toBe(false);
  });

  it("is wrong when the bid overshoots the count", () => {
    // Four fives on the table (see the fixture above); bidding five asks for
    // one more than is there, which a `<=` comparison would wave through.
    const one = round();
    one.raise("a", { count: 5, face: 5 });
    const out = one.call("b", "exact");
    expect(out.right).toBe(false);
    expect(out.losers).toEqual(["b"]);
  });
});

describe("where a seat sits", () => {
  it("is its place in the turn order", () => {
    const one = round();
    expect(one.position("a")).toBe(0);
    expect(one.position("c")).toBe(2);
    expect(one.position("nobody")).toBe(-1);
  });

  it("hands out a hand, or nothing for somebody not in it", () => {
    const one = round();
    expect(one.handFor("a")).toEqual([5, 5, 2]);
    expect(one.handFor("nobody")).toBe(null);
  });
});
