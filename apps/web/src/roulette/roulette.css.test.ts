import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The one-screen rules, read off the files. There is no cascade in a test
 * runner to ask, and these are questions about what is written rather than
 * about what any particular render came out as.
 */
const here = dirname(fileURLToPath(import.meta.url));
/* Comments stripped first: they are full of the words the rules below look
   for, and a paragraph explaining a keyframe would satisfy a test about it. */
const css = readFileSync(join(here, "roulette.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const page = readFileSync(join(here, "Roulette.tsx"), "utf8");

/** One rule's body, by its exact selector. */
const rule = (selector: string) =>
  new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m").exec(
    css,
  )?.[1] ?? "";

describe("the Roulette table's stylesheet", () => {
  it("is actually loaded — an orphan sheet is silently dead", () => {
    expect(page).toContain('import "./roulette.css"');
    // play--fit is table.css's, and a class whose rules nothing loads is a class
    // that does nothing at all.
    expect(page).toContain('import "../table/table.css"');
  });

  it("is a fit page, so the shell is the window (L1)", () => {
    expect(page).toContain("play--fit");
  });

  it("flexes exactly one row, and it is the stage (L2)", () => {
    const grid = rule(".rl__in");
    /*
     * The rows only. The same rule carries `grid-template-columns` with a
     * `minmax(0, 1fr)` of its own — the column the cloth and the keys live in
     * — so counting across the whole body finds two on a sheet that is right.
     */
    const rows = /grid-template-rows:([^;]*);/.exec(grid)?.[1] ?? "";
    expect(rows, "the table declares no rows").not.toBe("");
    expect(rows.match(/minmax\(0,\s*1fr\)/g) ?? []).toHaveLength(1);
    /* And it is the stage's row, under the line and the board of numbers —
       both of which are `auto` and as tall as their one line of type. */
    expect(grid.replace(/\s+/g, " ")).toContain('"standing wheel" "history history" "stage stage"');
  });

  it("keeps talk behind a key, and takes its inline rules with it (R16)", () => {
    /*
     * `play--fit` is worn by every table in the building and this app bundles
     * every sheet into one, so a rule written here against `.play--fit > .chat`
     * bounded the next table's chat to roulette's 48px log. The inline chat is
     * gone; the rules that fenced it in go with it.
     */
    expect(page).not.toContain("<Chat");
    expect(css).not.toContain(".play--fit > .chat");
  });

  it("gives a refusal the middle of the board at the table, and a strip on a page (N1, N5)", () => {
    /*
     * Both halves, because they are one decision. Mid-hand a strip above the
     * felt is a strip nobody reads, so a refusal takes the middle of the
     * board; on setup or a table that turned you away there is nothing to
     * cover and nothing on a clock, and it stays the strip it was (N5). A
     * table-shaped refusal everywhere would blur a page over itself.
     */
    expect(page).toContain("<Refusal");
    expect(page).toContain('className="play__error"');
  });

  it("keeps what it pays above everything the cloth stacks under it", () => {
    /*
     * `.rl__stage` is a size container and so a stacking context of its own,
     * but `.rl__cloth` inside it is `position: relative` with no z-index —
     * which leaves the chip piles, the aim marker and a reach button wearing
     * the keyboard's ring stacking against the stage itself rather than
     * against the cloth. The sheet shipped under all three, so a table with
     * chips on it showed them floating over its payout list.
     *
     * Asked as numbers rather than as one number written down, so the next
     * layer somebody adds to the cloth has to come in under the sheet or say
     * here why it does not.
     */
    const depth = (selector: string) =>
      Number(/z-index:\s*(-?\d+)/.exec(rule(selector))?.[1] ?? Number.NaN);

    const sheet = depth(".rl__pays");
    expect(sheet, "what it pays declares no z-index at all").not.toBeNaN();
    for (const selector of [".rl__pile", ".rl__aim", ".rl__reach button:focus-visible"]) {
      const layer = depth(selector);
      expect(layer, `${selector} declares no z-index at all`).not.toBeNaN();
      expect(sheet, `${selector} stacks over the payout sheet`).toBeGreaterThan(layer);
    }
  });

  it("draws the winners' board once, in the sheet or in the column (A3)", () => {
    /*
     * A phone reads the board in talk's activity tab and a desk reads it in
     * the side column, and the width that gives it to one has to be the width
     * that takes it from the other. Drawn twice it is two lists of the same
     * name for a screen reader to walk; drawn nowhere it is a table that
     * stopped saying who it has been paying.
     */
    const queries = [...css.matchAll(/@container rl \(min-width:\s*(\d+)px\)\s*\{/g)].map((match) => {
      let depth = 1;
      let at = (match.index ?? 0) + match[0].length;
      const from = at;
      while (at < css.length && depth > 0) {
        if (css[at] === "{") depth += 1;
        if (css[at] === "}") depth -= 1;
        at += 1;
      }
      return { width: Number(match[1]), body: css.slice(from, at - 1) };
    });

    const column = queries.find((one) => /\.rl__in \.rl__boards \{[^}]*display:\s*grid/.test(one.body));
    const sheet = queries.find((one) =>
      /\.talk__activity \.rl__winners \{[^}]*display:\s*none/.test(one.body),
    );
    expect(column?.width, "no width brings the board out into the column").toBeGreaterThan(0);
    expect(sheet?.width, "the sheet's copy of the board never leaves").toBe(column?.width);
  });

  it("sizes the stage from the space it has, not from the viewport (L3)", () => {
    expect(rule(".rl__stage")).toMatch(/container:\s*rl-stage\s*\/\s*size/);
    // The cloth's box is bounded by the stage's own height, which is what lets
    // a short phone shrink the cloth rather than push the keys off the screen.
    expect(rule(".rl__cloth-holds")).toContain("100cqh");
  });

  it("arranges the desk with a container query, not a media query (L5)", () => {
    expect(css).toContain("@container rl (min-width:");
    // The table is the container being asked about, and it is named, so a
    // container query inside the stage cannot answer for it by accident.
    expect(rule(".rl")).toMatch(/container:\s*rl\s*\/\s*inline-size/);
  });

  it("keeps the flexing to the page's own felt (H2)", () => {
    /*
     * The style gallery's section wears `gallery__section rl`, and this app
     * bundles every table's CSS into one sheet. `flex: 1` on a bare `.rl`
     * would restyle the mockup, which is how `.lobby` has bled twice already.
     */
    expect(rule(".rl")).not.toContain("flex:");
    expect(rule(".play--fit .rl")).toContain("flex: 1");
  });

  it("switches off every animation it runs (M1)", () => {
    /*
     * Exact selectors, not a substring match: `.rl__ball` appearing in the off
     * block would otherwise answer for `.rl__ball-arm` as well, and the two
     * carry different animations.
     */
    const offBlocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{/g)].map(
      (match) => {
        let depth = 1;
        let at = (match.index ?? 0) + match[0].length;
        const from = at;
        while (at < css.length && depth > 0) {
          if (css[at] === "{") depth += 1;
          if (css[at] === "}") depth -= 1;
          at += 1;
        }
        return css.slice(from, at - 1);
      },
    );
    expect(offBlocks.length, "nothing is turned off at all").toBeGreaterThan(0);

    const selectorsIn = (text: string, pattern: RegExp) =>
      [...text.matchAll(pattern)]
        .flatMap((match) => (match[1] ?? "").split(","))
        .map((selector) => selector.replace(/\s+/g, " ").trim())
        .filter(
          (selector) =>
            selector.length > 0 && !selector.startsWith("@") && !/^(from|to|[\d.]+%)$/.test(selector),
        );

    const off = offBlocks.flatMap((block) => selectorsIn(block, /([^{}]+)\{/g));
    const outside = offBlocks.reduce((rest, block) => rest.replace(block, ""), css);
    const animated = selectorsIn(outside, /([^{}]+)\{[^{}]*\banimation(?:-name)?:\s*(?!none)/g);

    expect(animated.length, "nothing is animated at all").toBeGreaterThan(0);
    for (const selector of animated) {
      expect(off, `${selector} has no off switch`).toContain(selector);
    }
  });
});
