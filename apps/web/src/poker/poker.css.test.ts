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
const narrow = block(css, "@container (max-width: 560px)");

describe("one screen", () => {
  it("has exactly one flexing row", () => {
    // The felt gives, everything else takes its own height (L2).
    const grid = ruleIn(css, ".pk");
    expect(grid).toMatch(/grid-template-rows:[^;]*minmax\(0, 1fr\)/);
    expect(grid.match(/minmax\(0, 1fr\)/g)).toHaveLength(1);
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
   * `--face` and `--seat-text` are set once, on `.pk__table`, so a short felt
   * can shrink them along with everything else. A piece that declares either
   * again on itself would beat the container's value with a fixed one — this
   * is how every Greed die was once a fixed 56px whatever the felt had.
   */
  it("declares --face and --seat-text on .pk__table only", () => {
    for (const name of ["--face", "--seat-text"]) {
      const declaring = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, , body = ""]) => body.includes(`${name}:`))
        .map(([, selectors = ""]) => selectors.trim());
      expect(declaring).toEqual([".pk__table"]);
    }
  });
});
