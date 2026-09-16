import { describe, expect, it } from "vitest";
import { DEFAULT_PACKS, minimumPlayers, snapOptions } from "./options.js";

describe("the host's options", () => {
  it("fills anything left out with the defaults", () => {
    expect(snapOptions(undefined)).toEqual({
      mode: "solo",
      teams: 2,
      rounds: 3,
      drawMs: 80_000,
      hints: "few",
      packs: [...DEFAULT_PACKS],
      custom: [],
      skipped: 0,
      onlyCustom: false,
    });
  });

  it("takes real choices as given", () => {
    const snapped = snapOptions({ mode: "teams", teams: 4, rounds: 5, drawSeconds: 120, hints: "generous", packs: ["hard", "sport"] });
    expect(snapped).toMatchObject({ mode: "teams", teams: 4, rounds: 5, drawMs: 120_000, hints: "generous" });
    // In the order the setup screen lists them, whatever order they arrived in.
    expect(snapped.packs).toEqual(["sport", "hard"]);
  });

  it("refuses to invent choices a client made up", () => {
    const snapped = snapOptions({ mode: "chaos", teams: 9, rounds: 50, drawSeconds: 1, hints: "all", packs: ["nope"] });
    expect(snapped).toMatchObject({ mode: "solo", teams: 2, rounds: 3, drawMs: 80_000, hints: "few", packs: [...DEFAULT_PACKS] });
  });

  it("only plays custom words alone once there are ten good ones", () => {
    const nine = Array.from({ length: 9 }, (_, index) => `word${"abcdefghi"[index]}`).join(",");
    expect(snapOptions({ custom: nine, onlyCustom: true }).onlyCustom).toBe(false);
    expect(snapOptions({ custom: `${nine},wordj`, onlyCustom: true }).onlyCustom).toBe(true);
  });

  it("needs three for everyone for themselves, and two a team for teams", () => {
    expect(minimumPlayers({ mode: "solo", teams: 4 })).toBe(3);
    expect(minimumPlayers({ mode: "teams", teams: 3 })).toBe(6);
  });
});
