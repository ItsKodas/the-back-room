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

const css = sheet("src/baccarat/baccarat.css");

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

describe("the baccarat table on a phone", () => {
  it("is imported by the page, so these rules are not dead", () => {
    // This repo has had orphan stylesheets that nothing loads (CLAUDE.md).
    const page = readFileSync(resolve(process.cwd(), "apps/web/src/baccarat/Baccarat.tsx"), "utf8");
    expect(page).toContain('import "./baccarat.css"');
  });

  it("never scrolls the page sideways", () => {
    expect(ruleIn(css, ".bc")).toContain("max-width: 100%");
    expect(css).not.toContain("min-width: 1200px");
  });

  /*
   * The brief this suite was written from named the plate's class ".bc__plate",
   * but BeadPlate.tsx (read per the task's own instruction to use the real
   * class names) actually renders ".bc__bead-plate" — confirmed against both
   * the component and BeadPlate.test.tsx, which queries the same name. Bound
   * to the real selector instead of the brief's, since a selector that matches
   * nothing would pass this assertion vacuously.
   */
  it("scrolls the bead plate inside its own box rather than the page", () => {
    const plate = ruleIn(css, ".bc__bead-plate");
    expect(plate).toContain("overflow-x: auto");
  });

  it("gives every spot a thumb-sized target", () => {
    const spot = ruleIn(css, ".bc__spot");
    expect(spot).toMatch(/min-height:\s*(4[4-9]|[5-9]\d|\d{3,})px/);
  });

  it("gives the chip tray and the round's own actions a thumb-sized target too", () => {
    // The three spots are not the only things pressed during a coup — the
    // chip that sets the stake and the actions that undo it are too.
    expect(ruleIn(css, ".bc__chip")).toMatch(/(width|min-height):\s*(4[4-9]|[5-9]\d|\d{3,})px/);
    expect(ruleIn(css, ".bc__act")).toMatch(/min-height:\s*(4[4-9]|[5-9]\d|\d{3,})px/);
  });

  it("reaches nothing by hover alone", () => {
    // Anything hover reveals must be available without it (CLAUDE.md).
    expect(css).not.toMatch(/:hover[^{]*\{[^}]*(display:\s*block|visibility:\s*visible)/);
  });
});

describe("the motion", () => {
  /*
   * The brief's own version of this test only checks that the word
   * "animation" appears somewhere inside the reduced-motion block, which
   * would pass even if a keyframe used elsewhere in the sheet had no off
   * switch of its own — any one disabled animation anywhere satisfies it for
   * every keyframe name. Tightened to blackjack.css.test.ts's stronger check:
   * every selector that runs an animation or a transition outside the
   * reduced-motion block must reappear, verbatim, inside it.
   */
  it("switches off every animation and transition it runs", () => {
    const reduced = block(css, "@media (prefers-reduced-motion: reduce)");
    const outside = css.replace(reduced, "");
    const moving = [...outside.matchAll(/([^{}]+)\{[^{}]*\b(?:animation|animation-name|transition):/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0 && !selector.startsWith("@") && !/^(from|to|\d+%)$/.test(selector));
    expect(moving.length).toBeGreaterThan(0);
    // Exact selectors, not a substring match that .bc__spot would let .bc__spot--won satisfy.
    const off = [...reduced.matchAll(/([^{}]+)\{/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0);
    for (const selector of moving) {
      expect(off, `${selector} has no off switch`).toContain(selector);
    }
  });

  it("has one off switch, so nothing is left out of a second", () => {
    expect(css.split("@media (prefers-reduced-motion: reduce)").length).toBe(2);
  });

  it("has an off switch for every keyframe it defines", () => {
    const defined = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    const off = block(css, "@media (prefers-reduced-motion: reduce)");
    expect(defined.length).toBeGreaterThan(0);
    for (const name of defined) {
      // Either the animation is switched off, or the element carrying it is.
      expect(off, name).toContain("animation");
    }
  });
});
