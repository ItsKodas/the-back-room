import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Where the room's own light is painted.
 *
 * Read from source: the failure is a phone repainting the whole window on
 * every scroll, which nothing in jsdom can see.
 */
const css = readFileSync(fileURLToPath(new URL("./global.css", import.meta.url)), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

describe("the room's background", () => {
  it("is not a fixed background on the page, which a phone repaints on every scroll", () => {
    expect(css).not.toMatch(/background-attachment:\s*fixed/);
  });

  it("is painted on the fixed layer already behind everything, so it still does not move", () => {
    const haze = rule(".haze");
    expect(haze).toContain("var(--gr-color-felt)");
    expect(haze).toContain("var(--gr-color-smoke-lit)");
    expect(haze).toContain("var(--gr-color-night)");
  });

  it("leaves the page itself the room's plain dark, for the moment before anything draws", () => {
    expect(rule("body")).toMatch(/background:\s*var\(--gr-color-night\);/);
  });
});
