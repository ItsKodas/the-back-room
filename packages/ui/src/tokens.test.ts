import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { color, font } from "./tokens.js";

const cssPath = fileURLToPath(new URL("./tokens.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

/** Turn `neonHi` into `--gr-color-neon-hi`. */
function cssName(key: string): string {
  return `--gr-color-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

describe("color", () => {
  it("carries the approved palette entries", () => {
    expect(Object.keys(color).sort()).toEqual([
      "bad",
      "chip",
      "chipDim",
      "chipHi",
      "felt",
      "feltDeep",
      "feltLit",
      "good",
      "ink",
      "inkDim",
      "inkFaint",
      "inkLit",
      "neon",
      "neonCore",
      "neonDeep",
      "neonDim",
      "neonHi",
      "night",
      "shadow",
      "slate",
      "smoke",
      "smokeLit",
    ]);
  });

  it("uses the exact approved values", () => {
    expect(color.night).toBe("#0f141c");
    expect(color.neon).toBe("#2e7bff");
    expect(color.chip).toBe("#e0b048");
    expect(color.ink).toBe("#dfe7f2");
    expect(color.felt).toBe("#12241f");
  });

  it("is written in lowercase hex throughout", () => {
    for (const value of Object.values(color)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(color)).toBe(true);
  });
});

/**
 * Colour properties that name a role rather than hold a colour.
 *
 * They resolve to another token instead of to a hex, so they have no entry in
 * the palette and could not have one: the whole point of an alias is that a
 * room repainting what it points at moves the alias with it, which a copied
 * value would not do.
 */
const ALIASES = ["air", "air-hi"];

describe("tokens.css", () => {
  it("defines a custom property for every colour, with the same value", () => {
    for (const [key, value] of Object.entries(color)) {
      const property = cssName(key);
      const match = css.match(new RegExp(`${property}\\s*:\\s*([^;]+);`));
      expect(match, `${property} missing from tokens.css`).not.toBeNull();
      expect(match?.[1]?.trim()).toBe(value);
    }
  });

  it("defines no colour property that the token object does not know about", () => {
    const declared = [...css.matchAll(/--gr-color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    const known = Object.keys(color).map((key) =>
      key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
    );
    for (const name of declared) {
      if (ALIASES.includes(name ?? "")) {
        continue;
      }
      expect(known, `--gr-color-${name} has no entry in tokens.ts`).toContain(name);
    }
  });

  it("keeps every alias an alias, rather than a second copy of a colour", () => {
    /*
     * The one thing that makes an alias worth having. Written as a hex it
     * would be a duplicate, and a room that repainted the token it points at
     * would leave it behind — which is exactly how a green card room came to
     * be seen through blue air.
     */
    for (const alias of ALIASES) {
      // String.raw, because a template literal eats the backslash: \s
      // becomes a literal "s" and the pattern quietly stops meaning
      // whitespace while still matching by luck.
      const match = css.match(new RegExp(String.raw`--gr-color-${alias}\s*:\s*([^;]+);`));
      expect(match, `--gr-color-${alias} missing from tokens.css`).not.toBeNull();
      expect(match?.[1]?.trim(), `--gr-color-${alias} should point at a token`).toMatch(
        /^var\(--gr-[a-z0-9-]+\)$/,
      );
    }
  });

  it("declares the three typefaces", () => {
    expect(css).toContain("--gr-font-display");
    expect(css).toContain("--gr-font-ui");
    expect(css).toContain("--gr-font-data");
  });

  it("defines a custom property for every font, with the same value", () => {
    const fontProperties: Record<keyof typeof font, string> = {
      display: "--gr-font-display",
      ui: "--gr-font-ui",
      data: "--gr-font-data",
    };
    for (const [key, property] of Object.entries(fontProperties)) {
      const match = css.match(new RegExp(`${property}\\s*:\\s*([^;]+);`));
      expect(match, `${property} missing from tokens.css`).not.toBeNull();
      expect(match?.[1]?.trim()).toBe(font[key as keyof typeof font]);
    }
  });

  it("declares exactly the approved set of tokens", () => {
    // Matches a declaration ("--gr-foo: value;") but not a var(--gr-foo)
    // reference, because a reference is never followed directly by a colon.
    const declared = [...css.matchAll(/(--gr-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual(
      [
        "--gr-color-air",
        "--gr-color-air-hi",
        "--gr-color-bad",
        "--gr-color-chip",
        "--gr-color-chip-dim",
        "--gr-color-chip-hi",
        "--gr-color-felt",
        "--gr-color-felt-deep",
        "--gr-color-felt-lit",
        "--gr-color-good",
        "--gr-color-ink",
        "--gr-color-ink-dim",
        "--gr-color-ink-faint",
        "--gr-color-ink-lit",
        "--gr-color-neon",
        "--gr-color-neon-core",
        "--gr-color-neon-deep",
        "--gr-color-neon-dim",
        "--gr-color-neon-hi",
        "--gr-color-night",
        "--gr-color-shadow",
        "--gr-color-slate",
        "--gr-color-smoke",
        "--gr-color-smoke-lit",
        "--gr-font-data",
        "--gr-font-display",
        "--gr-font-sign",
        "--gr-font-ui",
        "--gr-text-xs",
        "--gr-text-sm",
        "--gr-text-base",
        "--gr-text-lg",
        "--gr-text-xl",
        "--gr-text-2xl",
        "--gr-text-3xl",
        "--gr-space-1",
        "--gr-space-2",
        "--gr-space-3",
        "--gr-space-4",
        "--gr-space-5",
        "--gr-space-6",
        "--gr-space-7",
        "--gr-space-8",
        "--gr-radius-sm",
        "--gr-radius-md",
        "--gr-radius-die",
        "--gr-edge-hair",
        "--gr-edge-soft",
        "--gr-edge-hard",
        "--gr-lift-low",
        "--gr-lift-high",
        "--gr-well",
        "--gr-radius-key",
        "--gr-radius-cab",
        "--gr-radius-pill",
        "--gr-press",
        "--gr-spring",
        "--gr-settle",
        "--gr-bezel",
        "--gr-lip",
        "--gr-sink",
        "--gr-glass",
        "--gr-scan",
      ].sort(),
    );
  });

  it("anchors the scale endpoints to the approved values", () => {
    expect(css).toMatch(/--gr-space-1:\s*4px;/);
    expect(css).toMatch(/--gr-space-8:\s*64px;/);
    expect(css).toMatch(/--gr-text-xs:\s*0\.74rem;/);
    expect(css).toMatch(/--gr-text-3xl:\s*2\.7rem;/);
  });
});

describe("font", () => {
  it("names the approved families with real fallbacks", () => {
    expect(font.display).toContain("Bevan");
    expect(font.display).toContain("serif");
    expect(font.ui).toContain("IBM Plex Sans");
    expect(font.data).toContain("IBM Plex Mono");
    expect(font.data).toContain("monospace");
  });
});

/** Every game's palette override, found rather than listed. */
function gameThemes(): Array<{ game: string; css: string }> {
  const games = fileURLToPath(new URL("../../../games", import.meta.url));
  const found: Array<{ game: string; css: string }> = [];
  for (const game of readdirSync(games)) {
    const theme = join(games, game, "src", "theme.css");
    try {
      found.push({ game, css: readFileSync(theme, "utf8") });
    } catch {
      // A game is allowed to want the building's colours exactly as they are.
    }
  }
  return found;
}

describe("references", () => {
  it("never mentions a token it does not declare", () => {
    /*
     * A var() pointing at a name that no longer exists does not fail loudly —
     * the declaration is simply dropped, and a border quietly becomes
     * currentColor. Renaming the palette left two of these behind, so it is
     * checked now rather than noticed later.
     */
    const declared = new Set([...css.matchAll(/(--gr-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const referenced = [...css.matchAll(/var\((--gr-[a-z0-9-]+)/g)].map((m) => m[1]);
    for (const name of referenced) {
      expect(declared, `tokens.css uses ${name} without declaring it`).toContain(name);
    }
  });

  it("lets a game repaint only tokens that exist", () => {
    /*
     * A game's theme is nothing but overrides, so a misspelt name here is the
     * quietest possible bug: the declaration is simply never read by anything,
     * the room keeps the building's colour, and there is no error anywhere.
     * The same failure the check above exists to catch, one file further out.
     */
    const declared = new Set([...css.matchAll(/(--gr-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const themes = gameThemes();
    // A game with no theme is fine; no themes at all means this stopped looking.
    expect(themes.length).toBeGreaterThan(0);

    for (const { game, css: theme } of themes) {
      const set = [...theme.matchAll(/(--gr-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
      expect(set.length, `${game} declares a theme with nothing in it`).toBeGreaterThan(0);
      for (const name of set) {
        expect(declared, `${game} sets ${name}, which is not a token`).toContain(name);
      }
    }
  });
});
