import { describe, expect, it } from "vitest";
import { whyLine } from "./why.js";

/**
 * The line that explains why a key stopped working — including the moment it
 * matters most, which is the boundary itself: `+` and `2×` clamp to the cap
 * and the balance, so a stake only ever reaches them exactly, never past them.
 * A `>` check here never fires for a clamped stake, which is the bug this
 * file's `===` cases are watching for.
 */

function args(overrides: Partial<Parameters<typeof whyLine>[0]> = {}): Parameters<typeof whyLine>[0] {
  return {
    canPlay: true,
    cap: 1_000,
    balance: 1_000,
    stake: 100,
    risk: "medium",
    notice: null,
    ...overrides,
  };
}

describe("whyLine", () => {
  it("asks to sign in when nobody can play", () => {
    expect(whyLine(args({ canPlay: false }))).toBe("Sign in to play for chips, or play for fun.");
  });

  it("says the bank is empty when the cap is below the smallest stake", () => {
    expect(whyLine(args({ cap: 0 }))).toBe("The bank is empty. Nothing to play for yet.");
  });

  it("names the bank cap once the stake has gone past it", () => {
    expect(whyLine(args({ cap: 290, stake: 300, risk: "high" }))).toBe(
      "The bank covers 290 a ball on high right now.",
    );
  });

  it("names the bank cap at the boundary too, where + and 2x actually stop", () => {
    // The one case an old `stake > cap` check misses: a clamped stake sits
    // exactly on the cap and never crosses it.
    expect(whyLine(args({ cap: 290, stake: 290, risk: "high" }))).toBe(
      "The bank covers 290 a ball on high right now.",
    );
  });

  it("says everything is staked once the stake matches a balance under the cap", () => {
    expect(whyLine(args({ cap: 1_000, balance: 600, stake: 600 }))).toBe(
      "That is everything you have.",
    );
  });

  it("says more than you have if the stake somehow exceeds the balance", () => {
    expect(whyLine(args({ cap: 1_000, balance: 600, stake: 700 }))).toBe("That is more than you have.");
  });

  it("falls back to a refusal's own words below both limits", () => {
    expect(whyLine(args({ cap: 1_000, balance: 1_000, stake: 100, notice: "Too many balls in the air." }))).toBe(
      "Too many balls in the air.",
    );
  });

  it("says nothing below both limits with no notice standing", () => {
    expect(whyLine(args({ cap: 1_000, balance: 1_000, stake: 100, notice: null }))).toBeNull();
  });
});
