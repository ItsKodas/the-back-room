import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every keyframe in this room has an off switch, and the off switch wins.
 *
 * A media query adds no specificity, so a reduced-motion rule written against
 * a shorter selector than the rule it means to silence loses the cascade and
 * changes nothing. That is not a thing anybody notices: the page still looks
 * like it respects the setting, because one of the three animations happened
 * to tie on specificity and win on source order.
 *
 * Read out of the stylesheet rather than listed here, so a fourth animation
 * fails this until it is switched off too.
 */
const css = readFileSync(
  [
    resolve(process.cwd(), "apps/web/src/twoup/twoup.css"),
    resolve(process.cwd(), "src/twoup/twoup.css"),
  ].find((path) => existsSync(path)) as string,
  "utf8",
);

/** The selectors of every rule that starts one of this room's animations. */
function animated(): string[] {
  const out: string[] = [];
  const rules = css.split("}");
  for (const rule of rules) {
    const at = rule.indexOf("{");
    if (at === -1 || !rule.slice(at).includes("animation: tu-")) {
      continue;
    }
    out.push(rule.slice(0, at).trim().replace(/\s+/g, " "));
  }
  return out;
}

const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

describe("the off switch", () => {
  it("finds the animations at all, so this test cannot pass by finding none", () => {
    expect(animated().length).toBeGreaterThanOrEqual(3);
  });

  it("silences every one of them with a selector that can win", () => {
    for (const selector of animated()) {
      expect(reduced).toContain(selector);
    }
  });
});
