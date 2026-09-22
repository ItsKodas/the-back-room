import { describe, expect, it } from "vitest";
import { seatAt } from "./Felt.js";

describe("where a seat sits", () => {
  it("says which seat it is and how many there are, and nothing about angles", () => {
    // The arrangement is the stylesheet's decision, so React must not fix it here.
    expect(seatAt(3, 10)).toEqual({ "--seat": "3", "--of": "10" });
  });
});
