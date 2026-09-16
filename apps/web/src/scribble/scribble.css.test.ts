import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { offendingDeclarations } from "../style/narrow.js";
import { INK_RGB } from "./raster.js";

const read = (...paths: string[]) => readFileSync(paths.find((path) => existsSync(path)) as string, "utf8");
const css = read(resolve(process.cwd(), "apps/web/src/scribble/scribble.css"), resolve(process.cwd(), "src/scribble/scribble.css"));
const page = read(resolve(process.cwd(), "apps/web/src/scribble/Scribble.tsx"), resolve(process.cwd(), "src/scribble/Scribble.tsx"));

/** #rrggbb, lower case, the way this sheet writes every ink swatch. */
const hex = ([r, g, b]: readonly [number, number, number]) =>
  `#${[r, g, b].map((one) => one.toString(16).padStart(2, "0")).join("")}`;

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

  it("opens a team's well by a selector that actually matches the well the pill tapped", () => {
    // The three classes have to sit on one element — `.sc-teams.is-open
    // .sc-teams__wells` (what shipped first) puts is-open on the row around
    // the wells instead, which `Teams.tsx` never sets, so that selector
    // matched nothing and no well ever opened on a phone.
    expect(css).toMatch(/\.sc-teams__wells\s+\.well\.sc-team\.is-open\s*\{/);
  });

  it("lights fill and eraser when pressed, the only tray controls with no other lit state in the building", () => {
    expect(css).toMatch(/\.sc-tray \.key\[aria-pressed="true"\]\s*\{[^}]*border-color:/);
  });

  it("marks the team pill you tapped open, without fighting the drawing pill's own box-shadow", () => {
    expect(css).toMatch(/\.sc-pill\[aria-expanded="true"\]\s*\{[^}]*outline:/);
  });

  it("swatches the tray in the exact colours a stroke actually lands in", () => {
    // A pretty dot that lies about the ink it draws with is worse than none:
    // nothing but this test ties raster.ts's colours to the ones painted here.
    for (const [ink, rgb] of Object.entries(INK_RGB)) {
      if (ink === "paper") {
        continue;
      }
      expect(css, `${ink}`).toMatch(new RegExp(`\\.sc-ink--${ink} span \\{ background: ${hex(rgb)};`));
    }
  });

  it("lets the napkin bind on whichever axis the viewport runs out of first", () => {
    expect(css).toMatch(/\.sc-napkin\s*\{[^}]*aspect-ratio:\s*4 \/ 3;[^}]*\}/);
    // There's more than one `.sc-napkin { … }` block (the unconditional one,
    // and the desktop-only one that adds the height-derived cap) — found by
    // which one actually carries max-height, not by position in the file.
    const napkinBlocks = [...css.matchAll(/\.sc-napkin\s*\{([^}]*)\}/g)].map((match) => match[1] ?? "");
    const sized = napkinBlocks.find((block) => block.includes("max-height"));
    expect(sized, "no .sc-napkin rule sets max-height at all").toBeDefined();
    expect(sized).toMatch(/max-height:\s*calc\(100svh - \d+px\)/);
    // The half that actually stops the grid column overflowing — without it,
    // `width: 100%` on the napkin would still fill the column regardless of
    // how short the height-derived cap above it is. Read from `.sc`'s own
    // custom property (checked next) rather than a second, hand-written calc.
    expect(sized).toMatch(/max-width:\s*var\(--sc-napkin-w\)/);
  });

  it("sizes the napkin's width once and has the grid column read the same value, so the gutters either side of it can never drift", () => {
    // Both a fixed-width grid track (so a wide window's slack goes to the
    // side columns rather than the middle one) and the napkin's own
    // max-width have to agree on this number exactly, or one side of the
    // napkin ends up with more empty gutter than the other — and nothing
    // would fail, since each alone is a perfectly valid width.
    const scBlocks = [...css.matchAll(/\.sc\s*\{([^}]*)\}/g)].map((match) => match[1] ?? "");
    const withVar = scBlocks.find((block) => block.includes("--sc-napkin-w"));
    expect(withVar, "no .sc rule defines --sc-napkin-w").toBeDefined();
    expect(withVar).toMatch(/--sc-napkin-w:\s*min\(100%, calc\(\(100svh - \d+px\) \* 4 \/ 3\)\)/);
    // The 100% here is what stops an explicit grid track — unlike the
    // napkin's own width: 100%, which self-limits regardless — from asking
    // for more than the row has and overflowing the page sideways.
    expect(withVar).toMatch(
      /grid-template-columns:\s*minmax\(220px, 1fr\) minmax\(0, var\(--sc-napkin-w\)\) minmax\(280px, 1fr\)/,
    );
  });

  it("caps how far a growing side column stretches its own panel, so a roster or a guess box never reads as a mostly-empty pane", () => {
    // The grid track itself keeps growing (that's the chosen behaviour —
    // covered above); this is what stops the *panel* rendered inside it, so
    // an ultrawide desk gets a sidebar rather than a name on the left edge
    // and a score a third of the screen away from it.
    expect(css).toMatch(/\.sc-teams,\s*\.sc-guesses\s*\{[^}]*max-width:\s*360px;/);
  });

  it("burns the fuse across the whole turn in one linear pass, with nothing left to fight it for width", () => {
    // The old `transition: width 250ms linear` eased between the once-a-
    // second steps `--left` takes — a shorter jump dressed up, not a burn.
    // A transition and this keyframe animating the same property at once is
    // the bug the brief warned about, so the transition has to be gone.
    expect(css).toMatch(
      /\.sc-strip::after\s*\{[^}]*animation:\s*sc-fuse var\(--fuse-ms, 0ms\) linear forwards;[^}]*\}/,
    );
    const after = [...css.matchAll(/\.sc-strip::after\s*\{([^}]*)\}/g)][0]?.[1] ?? "";
    expect(after).not.toMatch(/transition:/);
    const keyframe = [...css.matchAll(/@keyframes sc-fuse\s*\{([\s\S]*?)\n\}/g)][0]?.[1] ?? "";
    expect(keyframe).toMatch(/from\s*\{\s*width:\s*var\(--fuse-from, 0%\);/);
    expect(keyframe).toMatch(/to\s*\{\s*width:\s*0%;/);
  });

  it("widens the room's own page rather than the six games that share .play", () => {
    // `.play--scribble` alone ties `.play` on specificity — a coin flip on
    // stylesheet order that this room lost the first time. It has to be
    // chained to `.play` to win outright.
    expect(css).toMatch(/\.play\.play--scribble\s*\{[^}]*max-width:\s*none;/);
  });
});
