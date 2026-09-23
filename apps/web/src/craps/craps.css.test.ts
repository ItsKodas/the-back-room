import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every keyframe in this room has an off switch, and the off switch wins.
 *
 * Modelled on `twoup/motion.css.test.ts` for the same reason that one reads
 * the rule off the stylesheet rather than listing it here: a media query
 * adds no specificity, so a reduced-motion rule written against a shorter
 * selector than the one it means to silence loses the cascade silently. This
 * checks the selector that starts each animation, not the keyframe's own
 * name — this sheet turns an animation off with `animation: none` on the
 * selector that started it, same as `cr-lit` and `cr-off-in` already do, and
 * neither of those repeats its keyframe's name inside the media query.
 *
 * File location modelled on `plinko/plinko.css.test.ts` instead — this sheet
 * lives beside its test the same way that one does — and now that `Craps.tsx`
 * exists, so is that file's "is actually loaded" check. It was left out while
 * this sheet was still an orphan nothing imported; CLAUDE.md's housekeeping
 * rule asks for exactly it, and a stylesheet nothing loads is one whose every
 * rule is silently dead.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "craps.css"), "utf8");
const page = readFileSync(join(here, "Craps.tsx"), "utf8");

/** The selectors of every rule that starts one of this room's animations. */
function animated(): string[] {
  const out: string[] = [];
  // Comments stripped first: a rule preceded by one otherwise carries its
  // whole doc comment into the "selector" this pulls out, and a heading like
  // "What the dice just made." was never going to appear in the media query.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}");
  for (const rule of rules) {
    const at = rule.indexOf("{");
    if (at === -1 || !rule.slice(at).includes("animation: cr-")) {
      continue;
    }
    out.push(rule.slice(0, at).trim().replace(/\s+/g, " "));
  }
  return out;
}

const reducedAt = css.indexOf("@media (prefers-reduced-motion: reduce)");
const reduced = css.slice(reducedAt);

describe("the cloth's stylesheet", () => {
  it("is actually loaded", () => {
    // An orphan sheet is silently dead; this repo has had several. `Craps.tsx`
    // is the only page that imports it, and the theme it is painted from
    // travels with it — a felt drawn in the building's blue is this same
    // mistake one file along.
    expect(page).toContain('import "./craps.css"');
    expect(page).toContain('import "@backroom/game-craps/theme.css"');
  });

  it("has a reduced-motion block at all", () => {
    expect(reducedAt).toBeGreaterThan(-1);
  });

  it("finds the animations at all, so this test cannot pass by finding none", () => {
    expect(animated().length).toBeGreaterThan(0);
  });

  it("silences every one of them with a selector that can win", () => {
    for (const selector of animated()) {
      expect(reduced).toContain(selector);
    }
  });
});
