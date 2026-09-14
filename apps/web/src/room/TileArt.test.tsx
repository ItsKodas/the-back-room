// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { POCKETS, WHEEL, colourOf } from "@backroom/game-roulette";
import { FACES } from "@backroom/game-slots";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReelsArt, TileArt, WheelArt } from "./TileArt.js";

describe("the furniture in a tile's corner", () => {
  it("gives the slot machine as many reels as the machine has", () => {
    // Five, because the machine has five. It drew three for a long time, which
    // is a card advertising a different game.
    const { container } = render(<TileArt game="slots" />);
    expect(container.querySelectorAll(".art__piece")).toHaveLength(5);
  });

  it("shows faces that are actually on the strip", () => {
    /*
     * It drew chips and bells long after both had been taken off the reels,
     * and nothing noticed: the art was its own copy of the faces, kept in step
     * by somebody remembering to. It borrows the machine's drawings now, and
     * this is what stops it drifting again — FACES is the strip itself.
     */
    const { container } = render(<TileArt game="slots" />);
    const drawn = [...container.querySelectorAll("[data-face]")].map((face) =>
      face.getAttribute("data-face"),
    );
    expect(drawn.length).toBeGreaterThan(0);
    for (const face of drawn) {
      expect(FACES).toContain(face);
    }
  });

  it("shows more than one face, so the card is not a jackpot", () => {
    // Five identical strips would roll into a row of the same thing, which is
    // a win on a card advertising a machine nobody has played.
    const { container } = render(<TileArt game="slots" />);
    const drawn = new Set(
      [...container.querySelectorAll("[data-face]")].map((face) => face.getAttribute("data-face")),
    );
    expect(drawn.size).toBeGreaterThan(2);
  });

  it("never puts a transform attribute on a piece the stylesheet moves", () => {
    /*
     * A CSS transform *replaces* an element's transform attribute rather than
     * composing with it. The cabinet rolls .art__piece with a CSS transform,
     * so a piece that also carried its own placement there lost it the moment
     * the stylesheet loaded — all three reels stacked at x=0, outside their
     * clip windows, and the machine rendered as three empty slots.
     *
     * It fails silently and only in the browser, which is why it is pinned
     * here: placement goes on a wrapper, and the moved group carries none.
     */
    const { container } = render(<ReelsArt />);
    const pieces = container.querySelectorAll(".art__piece");
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      expect(piece.getAttribute("transform")).toBeNull();
    }
  });

  it("still places each reel across the drawing", () => {
    // The placement has to live somewhere — on the wrapper, not the piece.
    const { container } = render(<ReelsArt />);
    const placed = [...container.querySelectorAll("g[transform^='translate']")];
    expect(placed.length).toBeGreaterThanOrEqual(3);
  });
});

/*
 * The stylesheet that moves all of this, read once for every suite below.
 *
 * Found from the working directory rather than from import.meta.url: this file
 * runs under jsdom, where that is an http URL and not a path at all. Two
 * candidates because the suite can be run from the repository root or from the
 * web package.
 */
const css = readFileSync(
  [
    resolve(process.cwd(), "apps/web/src/game/game.css"),
    resolve(process.cwd(), "src/game/game.css"),
  ].find((path) => existsSync(path)) as string,
  "utf8",
);

/**
 * The stylesheet with every @media block taken out of it.
 *
 * Because a selector inside the reduced-motion block is the *absence* of a
 * motion: searching the whole file for one finds the rule that switches it off
 * and calls that a rule that moves it. Checked without this, removing a reel's
 * roll outright still passed.
 */
const always = (() => {
  let out = "";
  let at = 0;
  while (at < css.length) {
    const start = css.indexOf("@media", at);
    if (start === -1) {
      out += css.slice(at);
      break;
    }
    out += css.slice(at, start);
    let depth = 0;
    let cursor = css.indexOf("{", start);
    for (; cursor < css.length; cursor += 1) {
      if (css[cursor] === "{") {
        depth += 1;
      } else if (css[cursor] === "}") {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
    }
    at = cursor + 1;
  }
  return out;
})();

/**
 * One @keyframes block, cut from its opening brace to the brace that closes it.
 *
 * Counted rather than searched for, because both of the obvious searches are
 * wrong here and both fail quietly. `to` is a substring of `rotor`, so a block
 * ended at the word in its own header and the only angle left to check was the
 * zero it starts from — the turn itself went unread for as long as the test
 * had been passing. And a brace followed by a bare newline is not how this
 * file ends a line on a checkout with CRLF endings: the search came back -1,
 * `slice` read that as one from the end, and the block became the whole rest
 * of the stylesheet, failing on a rotate() belonging to the turn ring eight
 * hundred lines below.
 */
const keyframes = (name: string, sheet: string = css): string => {
  const at = sheet.indexOf(`@keyframes ${name}`);
  if (at === -1) {
    return "";
  }
  let depth = 0;
  for (let cursor = sheet.indexOf("{", at); cursor < sheet.length; cursor += 1) {
    if (sheet[cursor] === "{") {
      depth += 1;
    } else if (sheet[cursor] === "}") {
      depth -= 1;
      if (depth === 0) {
        return sheet.slice(at, cursor + 1);
      }
    }
  }
  return "";
};

/*
 * The drawing and the stylesheet that moves it.
 *
 * These are two files that have to agree on a number, and nothing made them.
 * The art grew from three reels to five and the roll rules stayed at three, so
 * the last two sat perfectly still while the rest rolled — a machine with a
 * broken half. Nothing threw and nothing failed; there was simply no rule to
 * match them, which is the quietest way for a stylesheet to be wrong.
 */
describe("the reels the stylesheet knows how to roll", () => {
  it("has a rule for every reel the machine draws", () => {
    const { container } = render(<TileArt game="slots" />);
    const reels = container.querySelectorAll(".art__piece").length;
    expect(reels).toBeGreaterThan(0);
    for (let reel = 1; reel <= reels; reel += 1) {
      expect(always).toContain(`.cabinet:hover .art__piece--${reel}`);
    }
  });

  it("strips the media blocks it means to strip", () => {
    // The helper above is doing real work, so it gets its own check: a bug in
    // it would make the test above pass for the wrong reason, silently.
    expect(always).not.toContain("prefers-reduced-motion");
    expect(always).toContain(".cabinet:hover .art__piece--1");
  });

  it("turns every one of them off when motion is not wanted", () => {
    const { container } = render(<TileArt game="slots" />);
    const reels = container.querySelectorAll(".art__piece").length;
    /*
     * Every reduced-motion block, not the first — this stylesheet has several,
     * and the cabinet's is a long way down. Taking the first found a block
     * about the navbar and said the reels were unstilled when they were fine.
     */
    const stilled = css.split("@media (prefers-reduced-motion: reduce)").slice(1);
    for (let reel = 1; reel <= reels; reel += 1) {
      const selector = `.cabinet:hover .art__piece--${reel}`;
      expect(stilled.some((block) => block.includes(selector))).toBe(true);
    }
  });
});


/*
 * The wheel in roulette's corner.
 *
 * It had no drawing of its own for a while and fell through to the stack of
 * chips every game without one gets — which is not wrong, exactly, but it is
 * the one game in the building whose whole shape is an object, and a tile that
 * does not show it is a tile advertising nothing in particular.
 */
describe("the wheel in the corner", () => {
  it("gives roulette a wheel rather than the stack of chips", () => {
    const { container } = render(<TileArt game="roulette" />);
    expect(container.querySelector(".art__wheel")).not.toBeNull();
  });

  it("still hands a game with nothing of its own the chips", () => {
    // The fallback is what makes the check above mean something: it has to be
    // roulette that got a wheel, not everybody.
    const { container } = render(<TileArt game="tips" />);
    expect(container.querySelector(".art__wheel")).toBeNull();
    expect(container.querySelectorAll(".art__piece").length).toBeGreaterThan(0);
  });

  it("cuts as many pockets as the wheel has", () => {
    const { container } = render(<WheelArt />);
    expect(container.querySelectorAll(".art__pocket")).toHaveLength(POCKETS);
  });

  it("lays them out in the rim's order, not in counting order", () => {
    /*
     * The whole of this drawing is a band of alternating colour, and counting
     * order is the way to draw one that stops alternating half way round. It
     * borrows the rules' own rim rather than keeping a copy, and this is what
     * pins that: WHEEL is the wheel.
     */
    const { container } = render(<WheelArt />);
    const drawn = [...container.querySelectorAll("[data-pocket]")].map((one) =>
      Number(one.getAttribute("data-pocket")),
    );
    expect(drawn).toEqual([...WHEEL]);
  });

  it("paints every pocket the colour that pocket is", () => {
    const { container } = render(<WheelArt />);
    for (const one of container.querySelectorAll("[data-pocket]")) {
      const n = Number(one.getAttribute("data-pocket"));
      expect(one.getAttribute("class")).toContain(`art__pocket--${colourOf(n) ?? "zero"}`);
    }
  });

  it("never puts the slide and the spin on one element", () => {
    /*
     * A CSS transform replaces an element's transform rather than composing
     * with it, so a group asked to slide and to turn would only ever do the
     * last one declared — silently, and only in a browser. The rotor and the
     * ball's arm have to be inside the group that slides, not be it.
     */
    const { container } = render(<WheelArt />);
    const slides = container.querySelector(".art__wheel") as Element;
    for (const selector of [".art__wheel-rim", ".art__ball-arm"]) {
      const turns = container.querySelector(selector) as Element;
      expect(turns).not.toBeNull();
      expect(turns).not.toBe(slides);
      expect(slides.contains(turns)).toBe(true);
    }
  });
});

/*
 * The wheel and the stylesheet that moves it.
 *
 * Same trap as the reels: two files that have to agree on a class name, and
 * nothing but somebody remembering makes them. A renamed group here is a wheel
 * that sits perfectly still in the corner and throws nothing.
 */
describe("the wheel the stylesheet knows how to spin", () => {
  it("slides the wheel across and turns the rotor and the ball", () => {
    const { container } = render(<WheelArt />);
    for (const part of ["art__wheel", "art__wheel-rim", "art__ball-arm", "art__ball"]) {
      expect(container.querySelector(`.${part}`)).not.toBeNull();
      expect(always).toContain(`.tile:hover .${part}`);
    }
  });

  it("turns whole numbers of turns, so nothing snaps back on the way out", () => {
    /*
     * The animation is dropped the instant the pointer leaves. A rotor that
     * had settled at some angle of its own would jump back to where it started
     * at that moment, which is worse to watch than the spin was to have.
     */
    for (const name of ["tile-rotor", "tile-ball-round"]) {
      const block = keyframes(name);
      expect(block).not.toBe("");
      const turns = [...block.matchAll(/rotate\((-?\d+)deg\)/g)].map(([, degrees]) =>
        Number(degrees),
      );
      // Both ends of it, not one. A block cut short still has its from in it,
      // and a from is a zero, and a zero passes this without meaning anything.
      expect(turns.length).toBeGreaterThan(1);
      for (const turn of turns) {
        expect(Math.abs(turn) % 360).toBe(0);
      }
    }
  });

  it("cuts a keyframes block at its own closing brace, on any checkout", () => {
    /*
     * The helper above is doing real work, so it gets its own check, the way
     * the media-block one does. It replaced two searches that were both wrong
     * and both quiet about it.
     *
     * `to` is inside `rotor`: the rotor's block used to end at the word in its
     * own header, leaving one angle to check and that angle a zero, so the
     * turn this suite exists to pin went unread. And the end of a line is not
     * `}\n` on a checkout with CRLF endings, where the search came back -1, a
     * slice took that as one from the end, and the block ran on to the foot of
     * the stylesheet — failing on the turn ring's own rotate(-90deg), which is
     * not part of any wheel.
     */
    for (const sheet of [css, css.replace(/\n/g, "\r\n")]) {
      const rotor = keyframes("tile-rotor", sheet);
      expect(rotor).toContain("1080deg");
      expect(rotor.endsWith("}")).toBe(true);
      expect(rotor).not.toContain("turn-ring");
      expect(rotor).not.toContain("@keyframes tile-ball-round");
    }
  });

  it("puts the ball back where it started when it lands", () => {
    // The fall's last frame and the ball's resting depth are the same number,
    // or the ball jumps out of its pocket as the animation is taken away.
    const rest = /\.art__ball \{[^}]*transform: translateY\((-?[\d.]+)px\)/.exec(css);
    const fall = keyframes("tile-ball-fall");
    const landed = /100% \{\s*transform: translateY\((-?[\d.]+)px\)/.exec(fall);
    expect(rest).not.toBeNull();
    expect(landed).not.toBeNull();
    expect(Number((landed as RegExpExecArray)[1])).toBe(Number((rest as RegExpExecArray)[1]));
  });

  it("stills every part of it when motion is not wanted", () => {
    const stilled = css.split("@media (prefers-reduced-motion: reduce)").slice(1);
    for (const part of ["art__wheel", "art__wheel-rim", "art__ball-arm", "art__ball"]) {
      expect(stilled.some((block) => block.includes(`.tile:hover .${part}`))).toBe(true);
    }
  });
});
