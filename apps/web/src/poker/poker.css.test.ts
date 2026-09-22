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

/** The body of the first block opened by this at-rule prelude, braces balanced. */
function block(text: string, prelude: string): string {
  const start = text.indexOf(`${prelude} {`);
  if (start === -1) {
    return "";
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
    const seat = ruleIn(css, ".pk__seat");
    expect(seat).toMatch(/--angle:\s*calc\(90deg \+ \(var\(--seat\) \/ var\(--of\)\) \* 360deg\)/);
    expect(seat).toMatch(/cos\(var\(--angle\)\)/);
    expect(seat).toMatch(/sin\(var\(--angle\)\)/);
  });

  it("opens the ring into a horseshoe on a phone", () => {
    const phone = block(css, "@container pk (max-width: 560px)");
    expect(phone).toMatch(/150deg \+ \(\(var\(--seat\) - 0\.5\) \/ \(var\(--of\) - 1\)\) \* 240deg/);
    // Your own seat is pinned to the bottom rather than spread with the rest.
    expect(phone).toMatch(/\.pk__seat--you\s*\{[^}]*--angle:\s*90deg/);
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
