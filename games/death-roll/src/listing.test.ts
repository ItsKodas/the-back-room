import { describe, expect, it } from "vitest";
import { anteFor, CEILINGS, DEATH_ROLL, openingFor, passPrice, STAKES } from "./listing.js";

describe("what a host may choose", () => {
  it("snaps a stake to the nearest level rather than taking it at its word", () => {
    // What a table costs decides how much of somebody's balance is at risk at
    // a table they sat down at, so it is never a number a client invents.
    expect(anteFor(400)).toBe(500);
    expect(anteFor(120)).toBe(100);
    expect(anteFor(9_999_999)).toBe(5_000);
    expect(anteFor(-1)).toBe(100);
  });

  it("falls back to the default for anything that is not a number", () => {
    expect(anteFor(undefined)).toBe(500);
    expect(anteFor("500")).toBe(500);
    expect(anteFor(Number.NaN)).toBe(500);
  });

  it("snaps an opening ceiling the same way", () => {
    expect(openingFor(900)).toBe(1_000);
    expect(openingFor(50)).toBe(100);
    expect(openingFor(undefined)).toBe(1_000);
  });

  it("prices a pass at a tenth of the ante, in whole chips at every level", () => {
    // Every level divides by ten, so a pass price is never a fraction of a
    // chip and never has to be rounded away from the price it advertises.
    for (const stake of STAKES) {
      expect(passPrice(stake) * 10).toBe(stake);
    }
    expect(passPrice(500)).toBe(50);
  });

  it("never prices a pass at nothing", () => {
    expect(passPrice(0)).toBe(1);
  });
});

describe("how the room lists it", () => {
  it("is open, and a duel", () => {
    expect(DEATH_ROLL.open).toBe(true);
    expect(DEATH_ROLL.minSeats).toBe(2);
    expect(DEATH_ROLL.maxSeats).toBe(2);
  });

  it("keeps the colours the sign was painted in", () => {
    // The link cards are drawn on the server where there is no stylesheet to
    // read, so these have to agree with theme.css. Changing one changes both.
    expect(DEATH_ROLL.theme).toEqual({
      wall: "#16141c",
      felt: "#241f33",
      accent: "#6b4bd6",
      accentHi: "#b39cff",
    });
  });

  it("offers a ceiling a duel can actually come down from", () => {
    for (const ceiling of CEILINGS) {
      expect(ceiling).toBeGreaterThan(1);
    }
  });
});
