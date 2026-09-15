import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { offendingDeclarations } from "../style/narrow.js";

/*
 * What a component test cannot see: that the sheet is loaded at all, that its
 * motion has an off switch that actually wins, and that nothing in it takes a
 * phone sideways.
 */

const find = (...candidates: string[]) =>
  readFileSync(candidates.find((path) => existsSync(path)) as string, "utf8");

const css = find(
  resolve(process.cwd(), "apps/web/src/fittings/fittings.css"),
  resolve(process.cwd(), "src/fittings/fittings.css"),
);
const main = find(resolve(process.cwd(), "apps/web/src/main.tsx"), resolve(process.cwd(), "src/main.tsx"));

const REDUCED = "@media (prefers-reduced-motion: reduce)";

/** Selectors of every rule, outside the off switch, that sets motion going. */
function moving(): string[] {
  const before = css.slice(0, css.indexOf(REDUCED));
  const out: string[] = [];
  for (const rule of before.split("}")) {
    const at = rule.indexOf("{");
    if (at === -1) {
      continue;
    }
    const body = rule.slice(at);
    if (/(^|[\s;{])(animation|transition)(-[a-z]+)?\s*:(?!\s*none)/.test(body)) {
      const selector = rule
        .slice(0, at)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim()
        .replace(/\s+/g, " ");
      if (!selector.startsWith("@") && !/^(from|to|\d+%)/.test(selector)) {
        out.push(selector);
      }
    }
  }
  return out;
}

describe("the fittings' stylesheet", () => {
  it("is actually loaded, after game.css so it wins ties", () => {
    expect(main).toContain("./fittings/fittings.css");
    expect(main.indexOf("./fittings/fittings.css")).toBeGreaterThan(main.indexOf("./game/game.css"));
  });

  it("finds its motion at all, so the off-switch test cannot pass by finding none", () => {
    expect(moving().length).toBeGreaterThanOrEqual(8);
  });

  it("silences every moving rule with the same selector, so the off switch wins", () => {
    expect(css).toContain(REDUCED);
    const off = css.slice(css.indexOf(REDUCED));
    for (const selector of moving()) {
      for (const part of selector.split(",").map((s) => s.trim())) {
        expect(off, `${part} has no off switch`).toContain(part);
      }
    }
  });

  it("declares no width or min-width past 375px outside a min-width media query", () => {
    expect(offendingDeclarations(css)).toEqual([]);
  });

  it("holds a busy slab down on weight, not on which rule comes last", () => {
    // Three simple selectors against :disabled's two. A tie settled by source
    // order is how a theme in this repo once shipped the wrong colour.
    expect(css).toContain(".slab.is-busy:disabled {");
    expect(css).toContain(".slab:disabled {");
  });

  it("lets a link wear a slab or a key without an underline", () => {
    for (const block of [".slab {", ".key {"]) {
      const body = css.slice(css.indexOf(block), css.indexOf("}", css.indexOf(block)));
      expect(body).toMatch(/text-decoration:\s*none/);
      expect(body).toMatch(/display:\s*inline-flex/);
    }
  });

  it("never declares .field, which a run of existing page forms already own", () => {
    // Loading after game.css means a bare .field here would win the tie and
    // silently strip every page's own cap and margins on its wrapper.
    expect(css).not.toMatch(/(^|[},\s])\.field(?![\w-])[^{]*\{/m);
  });

  it("keeps the slab's lit screen inside its rounded corners", () => {
    /*
     * The glass over the screen followed the slab's corners and the screen
     * under it did not. Clipping by overflow alone leaks at a curve on a
     * button that moves, so a white pixel of screen showed at each corner.
     */
    for (const block of [".slab::before {", ".slab::after {"]) {
      const body = css.slice(css.indexOf(block), css.indexOf("}", css.indexOf(block)));
      expect(body, `${block} does not follow the corners`).toMatch(/border-radius:\s*inherit/);
    }
  });

  it("keeps the table-code field at 16px, so iOS Safari does not zoom in on focus", () => {
    const body = css.slice(css.indexOf(".lcd__input {"), css.indexOf("}", css.indexOf(".lcd__input {")));
    expect(body).toMatch(/font-size:\s*16px/);
  });
});
