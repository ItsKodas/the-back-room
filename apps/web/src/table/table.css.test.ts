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
  return found === undefined ? "" : readFileSync(found, "utf8");
}

/*
 * Comments stripped: a comment above a rule would otherwise read as part of its
 * selector, and a comment naming a property would read as a declaration.
 */
const css = sheet("src/table/table.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule for exactly this selector, at any depth. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`^\\s*${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
}

/** The body of the first block opened by this at-rule prelude, braces balanced. */
function block(prelude: string): string {
  const start = css.indexOf(`${prelude} {`);
  if (start === -1) {
    return "";
  }
  let depth = 0;
  for (let at = css.indexOf("{", start); at < css.length; at += 1) {
    if (css[at] === "{") {
      depth += 1;
    } else if (css[at] === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(css.indexOf("{", start) + 1, at);
      }
    }
  }
  return "";
}

describe("a table on one screen", () => {
  /*
   * The page is the window, not at least the window: a table that grew to its
   * content would scroll its controls off a phone.
   */
  it("makes the shell exactly the window, with only the page's row flexing", () => {
    const shell = rule(".shell:has(> .play--fit)");
    expect(shell).toContain("height: 100dvh");
    expect(shell).toContain("grid-template-rows: auto minmax(0, 1fr)");
  });

  it("lets the page shrink to its row rather than push past it", () => {
    const page = rule(".play--fit");
    expect(page).toContain("display: flex");
    expect(page).toContain("flex-direction: column");
    expect(page).toContain("min-height: 0");
  });

  it("is the container the talk drawer asks about, at any table", () => {
    expect(rule(".play--fit")).toMatch(/container: fit \/ inline-size/);
    expect(css).toContain("@container fit (min-width: 760px)");
    expect(css).not.toContain("@container gt");
  });
});

describe("scrolling boxes at a table", () => {
  /*
   * Chrome lets scrollbar-width and scrollbar-color win over ::-webkit-scrollbar
   * and draws its system bar, arrows and all. The standard properties may only
   * appear where the drawn bar is not understood.
   */
  it("keeps the standard scrollbar properties to browsers without the drawn bar", () => {
    const guarded = block("@supports not selector(::-webkit-scrollbar)");
    expect(guarded).toContain("scrollbar-width: thin");
    expect(css.replace(guarded, "")).not.toMatch(/scrollbar-(width|color):/);
  });
});

describe("motion at a table", () => {
  it("switches off every animation it runs", () => {
    const reduced = block("@media (prefers-reduced-motion: reduce)");
    const outside = css.replace(reduced, "");
    const animated = [...outside.matchAll(/([^{}]+)\{[^{}]*\banimation(?:-name)?:/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0 && !selector.startsWith("@") && !/^(from|to|\d+%)$/.test(selector));
    expect(animated.length).toBeGreaterThan(0);
    // Exact selectors turned off, not a substring match .talk would let .talk__scrim satisfy alone.
    const offSwitches = [...reduced.matchAll(/([^{}]+)\{/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0);
    for (const selector of animated) {
      expect(offSwitches, `${selector} has no off switch`).toContain(selector);
    }
  });
});
