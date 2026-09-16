import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Class names in game.css are global, and the file carries more than one page.
 *
 * Read from source: jsdom does no layout, so a later rule quietly taking over
 * an earlier page's grid is invisible to every render test.
 */
const css = readFileSync(fileURLToPath(new URL("./game.css", import.meta.url)), "utf8");
const room = readFileSync(fileURLToPath(new URL("../room/Room.tsx", import.meta.url)), "utf8");

describe("a game's lobby", () => {
  it("is laid out by one top-level rule, not overridden by another page's", () => {
    expect(css.match(/(?:^|\n)\.lobby\s*\{/g) ?? []).toHaveLength(1);
  });

  it("is not the class the home page lays its rails out with", () => {
    expect(room).not.toMatch(/className="lobby"/);
  });
});
