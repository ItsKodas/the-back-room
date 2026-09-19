import { describe, expect, it } from "vitest";
import { double, fit, halve, nudge } from "./stake.js";

describe("the stake keys", () => {
  it("step in tens, then fifties, then five hundreds", () => {
    expect(nudge(10, 1)).toBe(20);
    expect(nudge(90, 1)).toBe(100);
    expect(nudge(100, 1)).toBe(150);
    expect(nudge(1_000, 1)).toBe(1_500);
    expect(nudge(100, -1)).toBe(90);
    expect(nudge(150, -1)).toBe(100);
    expect(nudge(1_000, -1)).toBe(950);
  });

  it("snap a stake that is between steps onto the next one", () => {
    expect(nudge(120, 1)).toBe(150);
    expect(nudge(120, -1)).toBe(100);
  });

  it("never go below ten", () => {
    expect(nudge(10, -1)).toBe(10);
    expect(halve(10)).toBe(10);
    expect(halve(30)).toBe(10);
  });

  it("halve and double in tens", () => {
    expect(halve(250)).toBe(120);
    expect(double(250)).toBe(500);
  });

  it("fit a stake inside what the bank and the balance allow", () => {
    expect(fit(500, 290)).toBe(290);
    expect(fit(500, 295)).toBe(290);
    expect(fit(50, 290)).toBe(50);
    expect(fit(50, 0)).toBe(10);
  });
});
