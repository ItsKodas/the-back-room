import { describe, expect, it } from "vitest";
import { createSchema } from "./schemas.js";

describe("opening a table", () => {
  it("accepts an opening ceiling", () => {
    const parsed = createSchema.safeParse({ name: "Ada", game: "death-roll", ceiling: 1_000 });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.ceiling).toBe(1_000);
  });

  /*
   * Bounded here and snapped by the game. This only stops a nonsense number
   * reaching that arithmetic at all.
   *
   * One bound to a test, because `expect` stops at the first one that fails:
   * asserting all three together means a regression in any but the earliest is
   * reported as the earliest, and a bound that quietly stopped being checked
   * would never show up at all.
   */
  it("refuses a ceiling under the smallest table's", () => {
    expect(createSchema.safeParse({ name: "Ada", ceiling: 0 }).success).toBe(false);
  });

  it("refuses a ceiling over the largest table's", () => {
    expect(createSchema.safeParse({ name: "Ada", ceiling: 10_000_000 }).success).toBe(false);
  });

  it("refuses a ceiling that is not a whole number", () => {
    expect(createSchema.safeParse({ name: "Ada", ceiling: 1.5 }).success).toBe(false);
  });

  it("is happy without one, because most tables have no ceiling", () => {
    expect(createSchema.safeParse({ name: "Ada" }).success).toBe(true);
  });
});
