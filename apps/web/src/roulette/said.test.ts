import { describe, expect, it } from "vitest";
import { said } from "./said.js";

const base = {
  reach: { most: 10_000, purse: 50_000, bank: 2_000_000 },
  chip: 100,
  typed: null,
  holding: false,
  refused: null,
  betting: true,
};

describe("what the felt says under the keys", () => {
  it("says nothing when there is nothing to say", () => {
    expect(said(base)).toBe("");
  });

  it("says an empty bank before anybody presses anything", () => {
    const out = said({ ...base, reach: { most: 0, purse: 50_000, bank: 0 } });
    expect(out).toBe("The bank is empty — nothing to play for yet.");
  });

  it("an empty bank wins over a refusal, because it is the reason for it", () => {
    const out = said({
      ...base,
      reach: { most: 0, purse: 50_000, bank: 0 },
      refused: "The bank cannot cover a bet there yet.",
    });
    expect(out).toBe("The bank is empty — nothing to play for yet.");
  });

  it("passes the table's own refusal through", () => {
    const out = said({ ...base, refused: "The bank covers 400 on that at the moment." });
    expect(out).toBe("The bank covers 400 on that at the moment.");
  });

  it("says a typed figure is under the smallest chip", () => {
    expect(said({ ...base, typed: 10 })).toBe("Chips here start at 25.");
  });

  it("says a typed figure is over what the bank covers", () => {
    const out = said({ ...base, typed: 20_000 });
    expect(out).toBe("The bank covers 10,000 on the best spot at the moment.");
  });

  it("says a typed figure is over the purse", () => {
    const out = said({ ...base, reach: { most: 10_000, purse: 500, bank: 2_000_000 }, typed: 900 });
    expect(out).toBe("That is more than your 500.");
  });

  it("says nothing about a typed figure already held", () => {
    expect(said({ ...base, typed: 20_000, holding: true })).toBe("");
  });

  it("says nothing at all once the wheel is turning", () => {
    expect(said({ ...base, betting: false, typed: 10 })).toBe("");
  });
});
