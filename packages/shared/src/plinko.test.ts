import { describe, expect, it } from "vitest";
import { PLINKO_RISKS } from "./protocol.js";
import { plinkoDropSchema } from "./schemas.js";

describe("a Plinko drop on the wire", () => {
  it("names three risks", () => {
    expect(PLINKO_RISKS).toEqual(["low", "medium", "high"]);
  });

  it("takes a stake in tens at a known risk", () => {
    expect(plinkoDropSchema.safeParse({ stake: 10, risk: "low" }).success).toBe(true);
    expect(plinkoDropSchema.safeParse({ stake: 250, risk: "high", forFun: true }).success).toBe(true);
  });

  it("refuses a stake that is not a whole number of tens", () => {
    // Every multiplier is in tenths, so a stake in tens is what keeps every
    // payout a whole number of chips without rounding anybody down.
    for (const stake of [0, 5, 15, 9.5, -10]) {
      expect(plinkoDropSchema.safeParse({ stake, risk: "low" }).success, String(stake)).toBe(false);
    }
  });

  it("refuses a risk it does not know", () => {
    expect(plinkoDropSchema.safeParse({ stake: 10, risk: "extreme" }).success).toBe(false);
  });
});
