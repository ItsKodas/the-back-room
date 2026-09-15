import { describe, expect, it } from "vitest";
import { Taunts } from "./taunts.js";
import type { Taunt } from "./taunts.js";

let counter = 0;

function taunt(over: Partial<Taunt> = {}): Taunt {
  counter += 1;
  return {
    id: `t${counter}`,
    emoteId: "emote-1",
    chips: 100,
    fromSeatId: "seat-a",
    fromUserId: "user-a",
    fromName: "Alice",
    atSeatId: "seat-b",
    atUserId: "user-b",
    atName: "Bob",
    at: 1_700_000_000_000,
    ...over,
  };
}

describe("Taunts", () => {
  it("holds nothing at a table nobody has taunted at", () => {
    const taunts = new Taunts();
    expect(taunts.at("ABCDE")).toEqual([]);
    expect(taunts.held("ABCDE", "seat-b")).toBe(0);
  });

  it("stacks what has been thrown at one seat", () => {
    const taunts = new Taunts();
    taunts.add("ABCDE", taunt({ chips: 100 }));
    taunts.add("ABCDE", taunt({ chips: 250 }));
    expect(taunts.held("ABCDE", "seat-b")).toBe(350);
  });

  it("keeps one seat's pool apart from another's", () => {
    const taunts = new Taunts();
    taunts.add("ABCDE", taunt({ atSeatId: "seat-b", chips: 100 }));
    taunts.add("ABCDE", taunt({ atSeatId: "seat-c", atUserId: "user-c", chips: 40 }));
    expect(taunts.held("ABCDE", "seat-b")).toBe(100);
    expect(taunts.held("ABCDE", "seat-c")).toBe(40);
  });

  it("keeps one table's pool apart from another's", () => {
    const taunts = new Taunts();
    taunts.add("ABCDE", taunt({ chips: 100 }));
    taunts.add("VWXYZ", taunt({ chips: 700 }));
    expect(taunts.held("ABCDE", "seat-b")).toBe(100);
    expect(taunts.held("VWXYZ", "seat-b")).toBe(700);
  });

  describe("resolving", () => {
    it("pays the whole pool to a target who won", () => {
      const taunts = new Taunts();
      taunts.add("ABCDE", taunt({ chips: 100 }));
      taunts.add("ABCDE", taunt({ chips: 250 }));

      const { paid, burned } = taunts.resolve("ABCDE", ["seat-b"]);

      expect(burned).toEqual([]);
      expect(paid).toHaveLength(1);
      expect(paid[0]?.userId).toBe("user-b");
      expect(paid[0]?.chips).toBe(350);
    });

    /* The point of the whole mechanism: it goes back at whoever sent it. */
    it("hands back every taunt collected on, for replaying at its sender", () => {
      const taunts = new Taunts();
      taunts.add("ABCDE", taunt({ fromSeatId: "seat-a", emoteId: "rude" }));
      taunts.add("ABCDE", taunt({ fromSeatId: "seat-c", fromUserId: "user-c", emoteId: "ruder" }));

      const { paid } = taunts.resolve("ABCDE", ["seat-b"]);

      expect(paid[0]?.revenge.map((one) => [one.fromSeatId, one.emoteId])).toEqual([
        ["seat-a", "rude"],
        ["seat-c", "ruder"],
      ]);
    });

    it("burns a pool whose target did not win", () => {
      const taunts = new Taunts();
      taunts.add("ABCDE", taunt({ chips: 100 }));

      const { paid, burned } = taunts.resolve("ABCDE", ["seat-a"]);

      expect(paid).toEqual([]);
      expect(burned).toHaveLength(1);
      expect(burned[0]?.chips).toBe(100);
    });

    it("burns everything when nobody won at all", () => {
      const taunts = new Taunts();
      taunts.add("ABCDE", taunt({ chips: 100 }));
      taunts.add("ABCDE", taunt({ atSeatId: "seat-c", atUserId: "user-c", chips: 60 }));

      const { paid, burned } = taunts.resolve("ABCDE", []);

      expect(paid).toEqual([]);
      expect(burned).toHaveLength(2);
    });

    it("pays the winners and burns the rest in one settlement", () => {
      const taunts = new Taunts();
      taunts.add("ABCDE", taunt({ atSeatId: "seat-b", atUserId: "user-b", chips: 100 }));
      taunts.add("ABCDE", taunt({ atSeatId: "seat-c", atUserId: "user-c", chips: 60 }));

      const { paid, burned } = taunts.resolve("ABCDE", ["seat-b"]);

      expect(paid.map((one) => [one.userId, one.chips])).toEqual([["user-b", 100]]);
      expect(burned.map((one) => one.chips)).toEqual([60]);
    });

    it("pays several winners separately rather than pooling them together", () => {
      const taunts = new Taunts();
      taunts.add("ABCDE", taunt({ atSeatId: "seat-b", atUserId: "user-b", chips: 100 }));
      taunts.add("ABCDE", taunt({ atSeatId: "seat-c", atUserId: "user-c", chips: 60 }));

      const { paid } = taunts.resolve("ABCDE", ["seat-b", "seat-c"]);

      expect(paid.map((one) => [one.userId, one.chips]).sort()).toEqual([
        ["user-b", 100],
        ["user-c", 60],
      ]);
    });

    /*
     * A taunt is staked on one result. Paying it twice would be the building
     * minting chips out of a hand that already ended, which is the one thing
     * it must not do — so the pool is emptied by resolving it.
     */
    it("clears the pool, so a second settlement pays nothing", () => {
      const taunts = new Taunts();
      taunts.add("ABCDE", taunt({ chips: 100 }));

      expect(taunts.resolve("ABCDE", ["seat-b"]).paid).toHaveLength(1);
      expect(taunts.resolve("ABCDE", ["seat-b"])).toEqual({ paid: [], burned: [] });
      expect(taunts.held("ABCDE", "seat-b")).toBe(0);
    });

    it("resolves an untouched table to nothing", () => {
      const taunts = new Taunts();
      expect(taunts.resolve("ABCDE", ["seat-b"])).toEqual({ paid: [], burned: [] });
    });

    it("leaves other tables alone when one settles", () => {
      const taunts = new Taunts();
      taunts.add("ABCDE", taunt({ chips: 100 }));
      taunts.add("VWXYZ", taunt({ chips: 700 }));

      taunts.resolve("ABCDE", ["seat-b"]);

      expect(taunts.held("VWXYZ", "seat-b")).toBe(700);
    });

    /*
     * The arithmetic the whole design rests on: a pool is a sum of deposits,
     * so what comes out of it can never exceed what went in. Nothing here can
     * mint.
     */
    it("never pays out more than was staked", () => {
      const taunts = new Taunts();
      const stakes = [100, 250, 5, 9999];
      for (const chips of stakes) {
        taunts.add("ABCDE", taunt({ chips }));
      }

      const { paid, burned } = taunts.resolve("ABCDE", ["seat-b"]);
      const out = paid.reduce((total, one) => total + one.chips, 0);
      const gone = burned.reduce((total, one) => total + one.chips, 0);

      expect(out + gone).toBe(stakes.reduce((total, chips) => total + chips, 0));
    });
  });

  describe("a table called off before anybody won", () => {
    it("hands every taunt back and empties the pool", () => {
      const taunts = new Taunts();
      const one = { id: "t1", emoteId: "e", chips: 40, fromSeatId: "a", fromUserId: "u1", fromName: "Ada", atSeatId: "b", atUserId: "u2", atName: "Bo", at: 0 };
      const two = { ...one, id: "t2", chips: 60 };
      taunts.add("ROOM1", one);
      taunts.add("ROOM1", two);
      expect(taunts.refund("ROOM1")).toEqual([one, two]);
      expect(taunts.at("ROOM1")).toEqual([]);
      expect(taunts.refund("ROOM1")).toEqual([]);
    });
  });
});
