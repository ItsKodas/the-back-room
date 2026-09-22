import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Found from the working directory rather than import.meta.url, like the other
 * stylesheet suites, so it runs from the repository root or the web package.
 */
function sheet(path: string): string {
  const found = [resolve(process.cwd(), `apps/web/${path}`), resolve(process.cwd(), path)].find((each) =>
    existsSync(each),
  );
  // Comments stripped: a comment above a rule would read as part of its selector.
  return (found === undefined ? "" : readFileSync(found, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The declarations of the first rule for exactly this selector, at any depth. */
function ruleIn(text: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`^\\s*${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
}

/**
 * The body of a block opened by this at-rule prelude, braces balanced.
 *
 * `nth` because one prelude can open more than one block, and this sheet
 * deliberately has two `@container fit (max-width: 560px)` — one for the
 * felt's radii, one for the controls folding up. Defaults to the first.
 */
function block(text: string, prelude: string, nth = 0): string {
  let start = -1;
  let from = 0;
  for (let seen = 0; seen <= nth; seen += 1) {
    start = text.indexOf(`${prelude} {`, from);
    if (start === -1) {
      return "";
    }
    from = start + prelude.length;
  }
  let depth = 0;
  for (let at = text.indexOf("{", start); at < text.length; at += 1) {
    if (text[at] === "{") {
      depth += 1;
    } else if (text[at] === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(text.indexOf("{", start) + 1, at);
      }
    }
  }
  return "";
}

const css = sheet("src/poker/poker.css");
// Named explicitly now (the seat ring is `pk`'s own business, not `fit`'s) —
// see "the three arrangements" below for why the two container queries key
// off different containers.
const narrow = block(css, "@container pk (max-width: 560px)");

describe("one screen", () => {
  it("has exactly one flexing row", () => {
    // The felt gives, everything else takes its own height (L2).
    const grid = ruleIn(css, ".pk");
    const rows = grid.match(/grid-template-rows:\s*([^;]*);/)?.[1] ?? "";
    expect(rows).toMatch(/minmax\(0, 1fr\)/);
    // Scoped to the rows declaration alone: the column below is legitimately
    // `minmax(0, 1fr)` too, for a different reason (L6, not L2).
    expect(rows.match(/minmax\(0, 1fr\)/g)).toHaveLength(1);
  });

  /*
   * A bare `1fr` column keeps its automatic min-content minimum, so a child
   * that cannot shrink to fit — anything dropped into `.pk__below` later,
   * say — would widen the column and take the page sideways with it (L6).
   * `.pk__rank` already uses this exact idiom for the same hazard.
   */
  it("cannot be pushed wider than the window by its one column", () => {
    const grid = ruleIn(css, ".pk");
    expect(grid).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it("does not guess the height of what is not the felt", () => {
    // `--spare: calc(100dvh - 470px)` was that guess, and it was wrong twice.
    expect(css).not.toMatch(/--spare/);
  });

  it("makes the felt a size container so pieces can measure both axes", () => {
    expect(ruleIn(css, ".pk__table")).toMatch(/container:\s*pk\s*\/\s*size/);
  });

  it("sizes the cards against the felt's height as well as its width", () => {
    expect(ruleIn(css, ".pk__cards .bj-card")).toMatch(/min\([^)]*cqi[^)]*cqh[^)]*\)/);
  });

  /*
   * `.pk__table` is a grid item stretched to fill "felt" on both axes, so a
   * stated ratio on top of that would have nothing left to resolve — an
   * aspect-ratio here would be silently ignored rather than doing anything, an
   * easy thing to leave behind by accident once the felt stopped needing one.
   */
  it("does not restate an aspect-ratio on the felt for a stretched grid item to ignore", () => {
    expect(narrow).not.toMatch(/aspect-ratio/);
  });
});

describe("size variables inherit rather than being redeclared (L4)", () => {
  /*
   * Every custom property `.pk__table` declares is read out of the sheet
   * itself rather than hand-listed here, so a sixth one (a later task adding
   * a seventh size variable, say) is covered automatically instead of
   * silently passing an out-of-date guard. `--face`, `--seat-text`, `--pile`,
   * `--bet-chip` and `--pot-chip` are today's five.
   */
  const felt = ruleIn(css, ".pk__table");
  const sizeVars = [...new Set([...felt.matchAll(/(--[a-z-]+)\s*:/g)].map(([, name]) => name))];

  // A canary: if the container ever declared none, every case below would
  // vacuously pass and the guard would be watching nothing.
  it("finds at least the felt's five known size variables", () => {
    expect(sizeVars.length).toBeGreaterThanOrEqual(5);
  });

  /*
   * A piece that declares one of these again on itself would beat the
   * container's value with a fixed one — this is how every Greed die was
   * once a fixed 56px whatever the felt had. Deduplicated by selector before
   * comparing: `.pk__table` responsively overriding its own `--across` etc.
   * inside `@container (max-width: 560px)` is the same selector declaring it
   * twice, not a second piece — the hazard is a *different* selector.
   */
  it.each(sizeVars)("declares %s on .pk__table only", (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const boundary = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])\\s*:`);
    const declaring = [
      ...new Set(
        [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
          .filter(([, , body = ""]) => boundary.test(body))
          .map(([, selectors = ""]) => selectors.trim()),
      ),
    ];
    expect(declaring).toEqual([".pk__table"]);
  });
});

describe("the three arrangements", () => {
  it("places a seat from its index, in CSS", () => {
    /*
     * The formula is declared once, shared by `.pk__seat` and the three other
     * things a `--seat`/`--of` pair is handed (the stake, and the two chip
     * animations) — fix for review finding 5, which found it hand-copied into
     * four separate rules with nothing keeping them in agreement.
     */
    // The arc is variables now, so a container query can open the ring
    // rather than only move it; the desk's own arc is the full circle.
    expect(css).toMatch(
      /--angle:\s*calc\(var\(--from\) \+ \(var\(--seat\) \/ var\(--of\)\) \* var\(--span\)\)/,
    );
    expect(css).toMatch(/--from:\s*90deg/);
    expect(css).toMatch(/--span:\s*360deg/);
    const seat = ruleIn(css, ".pk__seat");
    expect(seat).toMatch(/cos\(var\(--angle\)\)/);
    expect(seat).toMatch(/sin\(var\(--angle\)\)/);
  });

  it("opens the ring into a horseshoe on a phone", () => {
    const phone = block(css, "@container pk (max-width: 560px)");
    expect(phone).toMatch(/--angle:\s*calc\(var\(--from\) \+ \(\(var\(--seat\) - 0\.5\) \/ \(var\(--of\) - 1\)\) \* var\(--span\)\)/);
    // Two rings, because one cannot hold nine plates wide enough to name.
    expect(phone).toMatch(/--stagger:\s*1\.1/);
    // Your own seat is pinned to the bottom rather than spread with the rest.
    /*
     * You are not on the ring at this width at all — the band under the
     * cloth is yours, which is what lets your cards be worth reading.
     */
    expect(phone).toMatch(/\.pk__seat--you\s*\{[^}]*bottom:\s*0/);
    expect(phone).toMatch(/\.pk__seat--you\s*\{[^}]*transform:\s*none/);
  });

  it("keeps everybody's cards, face and stake on a phone", () => {
    // They were deleted to buy room the felt did not have. It has it now.
    const phone = block(css, "@container pk (max-width: 560px)");
    expect(phone).not.toMatch(/\.pk__seat \.pk__cards\s*\{[^}]*display:\s*none/);
    expect(phone).not.toMatch(/\.pk__face\s*\{[^}]*display:\s*none/);
  });

  it("gives the felt a side column only once it can pay for one", () => {
    /*
     * Asked of the page's container, not the felt's. A container query can only
     * style what is inside the container it asks, and `.pk` is the felt's
     * ancestor — keyed on `pk` this rule would simply never apply.
     */
    expect(block(css, "@container fit (min-width: 1200px)")).toMatch(/grid-template-areas/);
  });
});

describe("the sizing controls, on a phone", () => {
  /*
   * The whole reason the felt fits on your turn. Stacked, the betting
   * controls took 323px of a 560px window and the felt — the only flexing
   * row — collapsed to 70px under them, which is where ten seats began
   * landing on each other. These two rules are what keep them shut.
   */
  it("hides the sizing block until it is asked for", () => {
    const phone = block(css, "@container fit (max-width: 560px)", 1);
    expect(phone).toMatch(/\.pk__amount\[data-open="false"\]\s*\{[^}]*display:\s*none/);
  });

  it("draws the key that opens it on a phone and nowhere else", () => {
    // Hidden by default, shown only inside the phone's own block.
    expect(ruleIn(css, ".pk__sizer")).toMatch(/display:\s*none/);
    expect(block(css, "@container fit (max-width: 560px)", 1)).toMatch(
      /\.pk__sizer\s*\{[^}]*display:\s*inline-flex/,
    );
  });
});
