import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The one-screen rules, read off the files. There is no cascade in a test
 * runner to ask, and these are questions about what is written.
 *
 * Class names here are `.pk-page` / `.pk-in` / `.pk-board` / `.pk-sign` rather
 * than the bare `.pk` and `.pk__foo` the design doc sketches: Poker already
 * owns `.pk` and `.pk__wholine` etc. (apps/web/src/poker/poker.css), and this
 * app bundles every table's CSS into one sheet, so a second `.pk` rule would
 * not stay on this page — it would land on Poker's felt too. H2 in the table
 * requirements is this exact mistake, already made twice with `.lobby`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "plinko.css"), "utf8");
const page = readFileSync(join(here, "Plinko.tsx"), "utf8");

describe("the Plinko page's stylesheet", () => {
  it("is actually loaded", () => {
    // An orphan sheet is silently dead; this repo has had several.
    expect(page).toContain('import "./plinko.css"');
    expect(page).toContain('import "../table/table.css"');
  });

  it("is a fit page, so the shell is the window (L1)", () => {
    expect(page).toContain("play--fit");
  });

  it("lets only the board flex (L2)", () => {
    expect(css).toMatch(/\.pk-in\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto/);
  });

  it("sizes the board from both of its dimensions (L3)", () => {
    expect(css).toMatch(/\.pk-board\s*\{[^}]*container:\s*pk-board \/ size/);
  });

  it("goes to two columns on the table's width, not the window's (L5)", () => {
    expect(css).toContain("@container pk-page (min-width: 760px)");
  });

  it("has an off switch for its motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("does not reuse Poker's bare .pk or .pk__ classes", () => {
    expect(css).not.toMatch(/(^|[^-\w])\.pk\s*\{/);
    expect(css).not.toMatch(/\.pk__/);
  });
});
