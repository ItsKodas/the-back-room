import { describe, expect, it } from "vitest";
import type { Outcome } from "./coins.js";
import { HEADS_TO_WIN, readSchool } from "./school.js";

const run = (...throws: Outcome[]) => readSchool(throws);

describe("coming in", () => {
  it("wants three heads", () => {
    expect(HEADS_TO_WIN).toBe(3);
    expect(run("heads", "heads")).toBeNull();
    expect(run("heads", "heads", "heads")).toBe("spinner");
  });

  it("ends the spinner's run on a tails, however far in", () => {
    expect(run("tails")).toBe("ring");
    expect(run("heads", "heads", "tails")).toBe("ring");
  });

  it("does not count odds towards the three", () => {
    /*
     * The rule a school actually plays and the one easiest to get wrong. Odds
     * is not a throw that happened as far as the count is concerned.
     */
    expect(run("heads", "odds", "heads", "odds", "heads")).toBe("spinner");
  });

  it("odds a spinner out on five in a row", () => {
    expect(run("odds", "odds", "odds", "odds", "odds")).toBe("oddedOut");
  });

  it("counts odds consecutively, so a head resets the run", () => {
    /*
     * The difference from the casino school, where the round is over before a
     * head can reset anything. Four odds, a head, four odds is a spinner still
     * standing — and a version that counted them in total would have thrown
     * them out.
     */
    expect(run("odds", "odds", "odds", "odds", "heads", "odds", "odds", "odds", "odds")).toBeNull();
  });

  it("has decided nothing before anything has been thrown", () => {
    expect(run()).toBeNull();
  });
});
