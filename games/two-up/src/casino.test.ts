import { describe, expect, it } from "vitest";
import type { Outcome } from "./coins.js";
import { readCasino } from "./casino.js";

const run = (...throws: Outcome[]) => readCasino(throws);

describe("what a casino round has decided", () => {
  it("has decided nothing before a coin has been thrown", () => {
    expect(run()).toBeNull();
  });

  it("is over the moment the coins agree", () => {
    expect(run("heads")).toBe("heads");
    expect(run("tails")).toBe("tails");
  });

  it("keeps throwing through odds", () => {
    expect(run("odds")).toBeNull();
    expect(run("odds", "odds", "odds", "odds")).toBeNull();
  });

  it("takes both sides on the fifth odds", () => {
    expect(run("odds", "odds", "odds", "odds", "odds")).toBe("fiveOdds");
  });

  it("stops at the first agreement however late it comes", () => {
    expect(run("odds", "odds", "odds", "odds", "tails")).toBe("tails");
  });

  it("ignores anything thrown after the round was decided", () => {
    /*
     * Defensive rather than expected. A caller that keeps throwing at a
     * finished round has a bug, and the answer it gets should be the one the
     * table already paid on rather than a second, different one.
     */
    expect(run("heads", "tails")).toBe("heads");
  });
});
