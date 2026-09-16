import { describe, expect, it } from "vitest";
import { nextRadioIndex } from "./radioNav.js";

describe("nextRadioIndex", () => {
  it("steps forward and wraps past the last option", () => {
    expect(nextRadioIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextRadioIndex("ArrowDown", 2, 3)).toBe(0);
  });

  it("steps backward and wraps past the first option", () => {
    expect(nextRadioIndex("ArrowLeft", 1, 3)).toBe(0);
    expect(nextRadioIndex("ArrowUp", 0, 3)).toBe(2);
  });

  it("jumps to the ends on Home and End", () => {
    expect(nextRadioIndex("Home", 2, 5)).toBe(0);
    expect(nextRadioIndex("End", 2, 5)).toBe(4);
  });

  it("starts from the first option when nothing is focused yet, and the last one on a backward step", () => {
    expect(nextRadioIndex("ArrowRight", -1, 4)).toBe(0);
    expect(nextRadioIndex("ArrowLeft", -1, 4)).toBe(3);
  });

  it("ignores every other key", () => {
    expect(nextRadioIndex("Tab", 0, 3)).toBeNull();
    expect(nextRadioIndex(" ", 0, 3)).toBeNull();
  });

  it("has nowhere to go in an empty group", () => {
    expect(nextRadioIndex("ArrowRight", -1, 0)).toBeNull();
  });
});
