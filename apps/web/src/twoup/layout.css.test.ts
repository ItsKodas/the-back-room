import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The felt at 375px, read off the file.
 *
 * There is no cascade in a test runner to ask, and these are questions about
 * what is written. They are worth writing down because every one of them was
 * a measurement first: the rail was 246px tall on an 812px screen — thirty
 * per cent of it, before anything was drawn on the felt above — and the three
 * sides needed 312px of a 307px felt, so five odds wrapped onto its own row
 * and read as the main event.
 *
 * What each rule is *for* is the part a stylesheet cannot say, so the things
 * that must not come back are stated here rather than left to whoever next
 * finds a wrap tidier than a grid.
 */
const find = (name: string) =>
  readFileSync(
    [
      resolve(process.cwd(), `apps/web/src/twoup/${name}`),
      resolve(process.cwd(), `src/twoup/${name}`),
    ].find((path) => existsSync(path)) as string,
    "utf8",
  );

const css = find("twoup.css");
const page = find("TwoUp.tsx");
const rail = find("Rail.tsx");

/** One rule's body, by the exact selector that opens it. */
function body(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("the two-up stylesheet", () => {
  it("is actually loaded", () => {
    // An orphan sheet is silently dead; this repo has had several.
    expect(page).toContain('import "./twoup.css"');
  });
});

describe("the sides", () => {
  it("are a grid, so they cannot wrap into a shape nobody chose", () => {
    const spots = body(".tu__spots");
    expect(spots).toContain("display: grid");
    expect(spots).toContain("grid-template-columns: 1fr 1fr");
    expect(spots).not.toContain("flex-wrap");
  });

  it("give the long shot the full width rather than a third column", () => {
    expect(css).toMatch(/\.tu__spot--fiveOdds,\s*\n\s*\.tu__spot--wide \{\s*\n\s*grid-column: 1 \/ -1;/);
  });

  it("are big enough to hit without looking", () => {
    // The presses that cost money. 52px was what three-across left room for.
    expect(body(".tu__spot")).toContain("min-height: 72px");
  });

  it("treat a long press as a gesture rather than as text", () => {
    /*
     * Holding a side takes a chip back off it. Without these three a held
     * thumb selects the word "Heads" and iOS offers to look it up, either of
     * which happens instead of the chip coming off.
     */
    const spot = body(".tu__spot");
    expect(spot).toContain("touch-action: manipulation");
    expect(spot).toContain("user-select: none");
    expect(spot).toContain("-webkit-touch-callout: none");
  });
});

describe("the rail", () => {
  it("stays where a thumb is, rather than where the page ends", () => {
    expect(body(".tu__rail")).toContain("position: sticky");
  });

  it("is its own container, so its rows ask its width and not the window's", () => {
    // The rail sits outside `.tu` — see the note over `Felt`'s fragment — so
    // the table's own container cannot answer for it.
    expect(body(".tu__rail")).toContain("container: tu-rail / inline-size");
    expect(css).toContain("@container tu-rail (min-width: 420px)");
  });

  it("keeps the seven chips on one row at any width", () => {
    // Wrapping them four over three costs another 52px of a screen that has
    // none spare, which is the whole reason the row is a grid.
    const tray = body(".tu__tray");
    expect(tray).toContain("grid-template-columns: repeat(7, minmax(0, 1fr))");
    expect(tray).not.toContain("flex-wrap");
  });

  it("keeps the three acts on one row", () => {
    // Two of them wrapped onto two rows at 375px, for 112px of rail.
    expect(body(".tu__acts")).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
  });

  it("holds every key at thumb height even where it is narrower than that", () => {
    for (const selector of [".tu__chip", ".tu__own-key", ".tu__hold", ".tu__act"]) {
      expect(body(selector), selector).toContain("min-height: 44px");
    }
  });

  it("does not draw the box for a figure of your own until it is asked for", () => {
    // The one thing on the rail that is not always on screen, and the key
    // that opens it carries the figure so nothing is lost by shutting it.
    expect(rail).toContain("{typing ? (");
    expect(rail).toContain('aria-expanded={typing}');
  });
});
