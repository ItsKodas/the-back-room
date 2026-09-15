import { describe, expect, it } from "vitest";
import { hintMs, hintsDue, mask, planHints } from "./hints.js";

describe("planning hints", () => {
  it("gives none when hints are off", () => {
    expect(planHints("lighthouse", "none", () => 0)).toEqual([]);
  });

  it("gives a quarter of the letters, spread across half to four-fifths of the clock", () => {
    const hints = planHints("lighthouse", "few", () => 0);
    expect(hints.map((hint) => hint.at)).toEqual([0.5, 0.8]);
  });

  it("gives half the letters when generous, from three-tenths to 85%", () => {
    const hints = planHints("lighthouse", "generous", () => 0);
    expect(hints).toHaveLength(5);
    expect(hints[0]?.at).toBe(0.3);
    expect(hints[4]?.at).toBe(0.85);
  });

  it("counts letters only, never spaces, and never picks the same letter twice", () => {
    const hints = planHints("fish and chips", "generous", () => 0.5);
    expect(hints).toHaveLength(6);
    expect(new Set(hints.map((hint) => hint.index)).size).toBe(6);
    for (const hint of hints) {
      expect("fish and chips"[hint.index]).not.toBe(" ");
    }
  });

  it("chooses the same letters from the same random source, so a reconnect sees the same ones", () => {
    let a = 0;
    let b = 0;
    // biome-ignore lint/suspicious/noAssignInExpressions: the accumulator is the fake random source's whole state
    const one = () => ((a += 0.37) % 1);
    // biome-ignore lint/suspicious/noAssignInExpressions: the accumulator is the fake random source's whole state
    const two = () => ((b += 0.37) % 1);
    expect(planHints("sandcastle", "generous", one)).toEqual(planHints("sandcastle", "generous", two));
  });
});

describe("when a hint is due", () => {
  it("is a whole number of milliseconds, so a timer and a check agree exactly", () => {
    const hint = { at: 0.65, index: 0 };
    expect(Number.isInteger(hintMs(hint, 80_000))).toBe(true);
    expect(hintsDue([hint], hintMs(hint, 80_000), 80_000)).toBe(1);
    expect(hintsDue([hint], hintMs(hint, 80_000) - 1, 80_000)).toBe(0);
  });
});

describe("masking", () => {
  it("hides letters, shows spaces and punctuation, and opens revealed letters", () => {
    const hints = [{ at: 0.5, index: 1 }, { at: 0.8, index: 5 }];
    expect(mask("Kev's van", hints, 0)).toEqual([null, null, null, "'", null, " ", null, null, null]);
    expect(mask("Kev's van", hints, 2)).toEqual([null, "e", null, "'", null, " ", null, null, null]);
    expect(mask("lighthouse", [{ at: 0.5, index: 5 }], 1)[5]).toBe("h");
  });
});
