import { readFileSync } from "node:fs";
import { COMING } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { SCRIBBLE } from "./listing.js";

const theme = readFileSync(new URL("./theme.css", import.meta.url), "utf8");

describe("how Scribble lists itself", () => {
  it("is a party game for three to ten", () => {
    expect(SCRIBBLE).toMatchObject({ id: "scribble", shape: "party", minSeats: 3, maxSeats: 10 });
  });

  it("paints its link card in the colours its room is painted in", () => {
    // The card is drawn on the server, where there is no stylesheet to read.
    expect(theme).toContain(`--gr-color-night: ${SCRIBBLE.theme.wall};`);
    expect(theme).toContain(`--sc-napkin: ${SCRIBBLE.theme.felt};`);
    expect(theme).toContain(`--gr-color-neon: ${SCRIBBLE.theme.accent};`);
    expect(theme).toContain(`--gr-color-neon-hi: ${SCRIBBLE.theme.accentHi};`);
  });

  it("is listed once, by its own package, rather than as coming", () => {
    expect(COMING.some((game) => game.id === "scribble")).toBe(false);
  });
});
