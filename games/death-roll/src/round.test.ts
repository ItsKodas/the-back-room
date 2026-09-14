import { describe, expect, it } from "vitest";
import { TableError } from "@backroom/core";
import { Round } from "./round.js";

/** A roller that hands back a fixed run of numbers, in order. */
const rolls = (...results: number[]) => {
  let at = 0;
  return () => results[at++] as number;
};

const three = () => new Round(["ada", "bob", "cat"], "ada", 38, 50);

describe("passing", () => {
  it("hands the roll to the next seat at the same ceiling", () => {
    const round = three();

    const passed = round.pass("ada");

    expect(passed).toEqual({ seatId: "ada", paid: 50, to: "bob" });
    expect(round.toRoll).toBe("bob");
    expect(round.ceiling).toBe(38);
    expect(round.passedTo).toBe("bob");
  });

  it("cannot be handed on by the seat it landed on", () => {
    // The rule that keeps the pass worth anything: a returnable pass is always
    // returned, so nobody who had worked it out would ever pass first.
    const round = three();
    round.pass("ada");

    expect(() => round.pass("bob")).toThrow(TableError);
    expect(() => round.checkPass("bob")).toThrow(/passed to you/);
  });

  it("stops binding once the seat it landed on has rolled", () => {
    const round = three();
    round.pass("ada");
    round.roll("bob", rolls(20));

    expect(round.passedTo).toBeNull();
    expect(() => round.checkPass("cat")).not.toThrow();
  });

  it("is spent once a round, so it comes back to be rolled", () => {
    const round = three();
    round.pass("ada");
    round.roll("bob", rolls(20));
    round.pass("cat");

    expect(round.toRoll).toBe("ada");
    expect(() => round.pass("ada")).toThrow(TableError);
  });

  it("checks without spending anything", () => {
    const round = three();

    expect(round.checkPass("ada")).toBe(50);
    expect(round.holdsPass("ada")).toBe(true);
  });

  it("reports who still holds one, by position", () => {
    const round = three();
    round.pass("ada");
    round.roll("bob", rolls(20));
    round.pass("cat");

    expect(round.holders()).toBe(0b010);
  });
});

describe("rolling", () => {
  it("makes the result the new ceiling and moves the turn on", () => {
    const round = three();

    round.roll("ada", rolls(12));

    expect(round.ceiling).toBe(12);
    expect(round.toRoll).toBe("bob");
    expect(round.history).toEqual([{ seatId: "ada", from: 38, result: 12 }]);
  });

  it("ends the round on a 1, names who went out, and leaves the ceiling", () => {
    const round = three();

    round.roll("ada", rolls(1));

    expect(round.over).toBe(true);
    expect(round.outId).toBe("ada");
    expect(round.ceiling).toBe(38);
    expect(() => round.roll("bob", rolls(5))).toThrow(TableError);
  });

  it("refuses a roll out of turn, from a stranger, or one the ceiling cannot produce", () => {
    const round = three();

    expect(() => round.roll("bob", rolls(5))).toThrow(TableError);
    expect(() => round.roll("zed", rolls(5))).toThrow(TableError);
    expect(() => round.roll("ada", rolls(39))).toThrow(TableError);
    expect(() => round.roll("ada", rolls(0))).toThrow(TableError);
  });
});

describe("setting a round up", () => {
  it("needs two different players and a ceiling above one", () => {
    expect(() => new Round(["ada"], "ada", 100, 10)).toThrow(TableError);
    expect(() => new Round(["ada", "ada"], "ada", 100, 10)).toThrow(TableError);
    expect(() => new Round(["ada", "bob"], "ada", 1, 10)).toThrow(TableError);
  });

  it("opens with the first seat if the opener named is not in it", () => {
    expect(new Round(["ada", "bob"], "zed", 100, 10).toRoll).toBe("ada");
  });
});
