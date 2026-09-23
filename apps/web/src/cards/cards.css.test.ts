import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Found from the working directory rather than import.meta.url, like the other
 * stylesheet suites, so it runs from the repository root or the web package.
 */
function sheet(path: string): string {
  const found = [resolve(process.cwd(), `apps/web/${path}`), resolve(process.cwd(), path)].find(
    (each) => existsSync(each),
  );
  return (found === undefined ? "" : readFileSync(found, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
}

const css = sheet("src/cards/cards.css");
const bj = sheet("src/blackjack/blackjack.css");
const poker = sheet("src/poker/poker.css");

describe("one deck in the building", () => {
  it("draws a card in the shared sheet", () => {
    expect(css).toContain(".card {");
    expect(css).toContain(".card--red");
    expect(css).toContain(".card__face");
    expect(css).toContain(".card--down");
    expect(css).toContain(".card__back");
  });

  it("owns the four ways a card can arrive", () => {
    for (const how of ["deal", "turn", "fold", "unfold"]) {
      expect(css, how).toContain(`.card--${how}`);
      expect(css, how).toContain(`@keyframes card-${how}`);
    }
  });

  /*
   * The one rule that makes the extraction worth doing: a game that shows a
   * card must not carry a second drawing of one. Two copies drift, and the
   * drift shows up as a card that is subtly the wrong shape in one room.
   */
  it("leaves no game drawing its own cards", () => {
    expect(bj).not.toContain(".bj-card");
    expect(poker).not.toContain(".bj-card");
  });

  // Every keyframe in the building has an off switch (CLAUDE.md).
  it("turns the card animations off when asked", () => {
    const off = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(off).toContain(".card--deal");
    expect(off).toContain("animation: none");
  });
});
