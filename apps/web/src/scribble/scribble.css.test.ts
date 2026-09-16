import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { offendingDeclarations } from "../style/narrow.js";

const read = (...paths: string[]) => readFileSync(paths.find((path) => existsSync(path)) as string, "utf8");
const css = read(resolve(process.cwd(), "apps/web/src/scribble/scribble.css"), resolve(process.cwd(), "src/scribble/scribble.css"));
const page = read(resolve(process.cwd(), "apps/web/src/scribble/Scribble.tsx"), resolve(process.cwd(), "src/scribble/Scribble.tsx"));

/** The selectors of every rule that starts one of this room's animations. */
function animated(): string[] {
  const out: string[] = [];
  for (const rule of css.split("}")) {
    const at = rule.indexOf("{");
    if (at === -1 || !rule.slice(at).includes("animation: sc-")) {
      continue;
    }
    out.push(rule.slice(0, at).replace(/\/\*[\s\S]*?\*\//g, "").trim().replace(/\s+/g, " "));
  }
  return out;
}

const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

describe("the scribble room's stylesheet", () => {
  it("is actually loaded by the page", () => {
    expect(page).toContain('import "./scribble.css";');
    expect(page).toContain('import "@backroom/game-scribble/theme.css";');
  });

  it("finds its animations at all, so the off-switch test cannot pass by finding none", () => {
    expect(animated().length).toBeGreaterThanOrEqual(5);
  });

  it("silences every one of them with a selector that can win", () => {
    for (const selector of animated()) {
      expect(reduced, `${selector} has no off switch`).toContain(selector);
    }
  });

  it("stops a finger drawing from scrolling the page, only while drawing", () => {
    expect(css).toMatch(/\.sc-napkin--live \.sc-napkin__canvas\s*\{[^}]*touch-action:\s*none/);
  });

  it("declares nothing wider than a phone outside a min-width media query", () => {
    expect(offendingDeclarations(css)).toEqual([]);
  });
});
