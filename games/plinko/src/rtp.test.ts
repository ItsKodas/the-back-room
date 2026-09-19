import { describe, expect, it } from "vitest";
import { RISKS } from "./risk.js";
import { RTP_DENOMINATOR, RTP_NUMERATOR, returnOf } from "./rtp.js";

describe("what the board gives back", () => {
  for (const risk of RISKS) {
    it(`${risk} returns exactly 39,730 in 40,960`, () => {
      // Asserted rather than trusted: retuning a multiplier without retuning
      // the rest has to fail here, and all three risks share one figure so no
      // risk is a worse bet than another by accident.
      expect(returnOf(risk)).toBe(RTP_NUMERATOR);
    });
  }

  it("keeps about three chips in a hundred", () => {
    expect(RTP_DENOMINATOR).toBe(40_960);
    expect(RTP_NUMERATOR / RTP_DENOMINATOR).toBeCloseTo(0.96997, 5);
  });
});
