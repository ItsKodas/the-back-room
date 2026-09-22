import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * How big the felt actually comes out, at the screens people have.
 *
 * Everything on this table — the cards, the names, the chips — is measured in
 * `cqw`, hundredths of the felt's own width. So the felt's width is not one
 * layout number among many: it is the scale of the entire drawing, and a felt
 * that comes out half the size of the room it is in is a table nobody can read
 * the cards on.
 *
 * The bug this exists for: the cap was written as a height budget alone, so on
 * a 1080p window the felt came out 768px wide inside 1556px of page — the
 * screen had the width and the table would not take it, because it was holding
 * 16:10 whatever that cost. It looked right on a 1440p monitor, where the
 * height budget is generous enough that 16:10 fills the page anyway, which is
 * exactly why it survived.
 *
 * Read out of the stylesheet and worked through rather than restated here.
 * A copy of the numbers would agree with itself forever; this fails when the
 * rules change.
 */

const css = readFileSync(
  [
    resolve(process.cwd(), "apps/web/src/poker/poker.css"),
    resolve(process.cwd(), "src/poker/poker.css"),
  ].find((path) => existsSync(path)) as string,
  "utf8",
);

/**
 * The value of one declaration, wherever in the sheet it is written.
 *
 * A selector appears more than once — the base rule, then again inside the
 * query that caps it — so every block of that name is looked through and the
 * one that sets the property wins. Crude on purpose: for these two properties
 * there is exactly one such block.
 */
function declared(selector: string, property: string): string {
  let at = css.indexOf(`${selector} {`);
  if (at === -1) {
    throw new Error(`no rule for ${selector}`);
  }
  while (at !== -1) {
    const body = css.slice(at, css.indexOf("}", at));
    const found = body.match(new RegExp(`\\n\\s*${property}:\\s*([^;]+);`));
    if (found) {
      return found[1].replace(/\s+/g, " ").trim();
    }
    at = css.indexOf(`${selector} {`, at + 1);
  }
  throw new Error(`${selector} declares no ${property}`);
}

/**
 * A CSS length worked out in pixels, for a window of a given height.
 *
 * Only the grammar these rules use: `max()`, `min()`, `calc()`, `var()`, the
 * four operators, `px`, `dvh` and bare numbers. Anything else is a mistake in
 * the test rather than something to guess at, so it throws.
 */
function pixels(expression: string, dvh: number, vars: Record<string, string>): number {
  let at = 0;
  const text = expression;

  const skip = () => {
    while (at < text.length && text[at] === " ") {
      at += 1;
    }
  };

  const primary = (): number => {
    skip();
    if (text.startsWith("var(", at)) {
      at += 4;
      const close = text.indexOf(")", at);
      const name = text.slice(at, close).trim();
      at = close + 1;
      if (!(name in vars)) {
        throw new Error(`no value for ${name}`);
      }
      return pixels(vars[name], dvh, vars);
    }
    for (const fn of ["max", "min", "calc"]) {
      if (text.startsWith(`${fn}(`, at)) {
        at += fn.length + 1;
        const args: number[] = [];
        for (;;) {
          args.push(sum());
          skip();
          if (text[at] === ",") {
            at += 1;
            continue;
          }
          break;
        }
        if (text[at] !== ")") {
          throw new Error(`unclosed ${fn}( in ${text}`);
        }
        at += 1;
        return fn === "max" ? Math.max(...args) : fn === "min" ? Math.min(...args) : args[0];
      }
    }
    if (text[at] === "(") {
      at += 1;
      const inner = sum();
      at += 1;
      return inner;
    }
    const number = text.slice(at).match(/^-?[\d.]+(px|dvh|vh|%)?/);
    if (!number) {
      throw new Error(`cannot read a length at "${text.slice(at)}"`);
    }
    at += number[0].length;
    const size = Number.parseFloat(number[0]);
    if (number[1] === "dvh" || number[1] === "vh") {
      return (size / 100) * dvh;
    }
    if (number[1] === "%") {
      throw new Error("percentages are not something this test can resolve");
    }
    return size;
  };

  const product = (): number => {
    let value = primary();
    for (;;) {
      skip();
      if (text[at] === "*") {
        at += 1;
        value *= primary();
      } else if (text[at] === "/") {
        at += 1;
        value /= primary();
      } else {
        return value;
      }
    }
  };

  const sum = (): number => {
    let value = product();
    for (;;) {
      skip();
      if (text[at] === "+" && text[at + 1] === " ") {
        at += 1;
        value += product();
      } else if (text[at] === "-" && text[at + 1] === " ") {
        at += 1;
        value -= product();
      } else {
        return value;
      }
    }
  };

  const result = sum();
  skip();
  if (at !== text.length) {
    throw new Error(`left over after "${text.slice(0, at)}": "${text.slice(at)}"`);
  }
  return result;
}

/** The custom properties the felt's cap is written in terms of. */
const vars: Record<string, string> = Object.fromEntries(
  [...css.matchAll(/\n\s*(--[a-z-]+):\s*([^;]+);/g)]
    .map(([, name, value]) => [name, value.replace(/\s+/g, " ").trim()])
    .filter(([, value]) => !value.includes("cqw")),
);

/**
 * The page's own width, which is what the felt is offered.
 *
 * The room is 1600px wide for poker and only poker, less the page's side
 * padding — 22px a side, which is `--gr-space-5`.
 */
function offered(vw: number): number {
  return Math.min(vw, 1600) - 44;
}

/**
 * The felt, as the browser would lay it out.
 *
 * Width is what the page offers, capped. Height comes from the width and the
 * felt's aspect, capped in turn — and a `max-height` on a box whose width is
 * already settled takes height away without taking width, which is the whole
 * of how a table flattens instead of shrinking.
 */
function felt(vw: number, vh: number): { width: number; height: number } {
  const width = Math.min(offered(vw), pixels(declared(".pk", "max-width"), vh, vars));
  const tall = width / (16 / 10);
  let height = tall;
  try {
    height = Math.min(tall, pixels(declared(".pk__table", "max-height"), vh, vars));
  } catch {
    // No cap on the height: the felt only ever holds its aspect.
  }
  return { width, height };
}

/*
 * A window's inside height, not its monitor's. A maximised browser keeps
 * something like 130px for its own chrome, so a 1080p screen is a 950px page —
 * which is the number the felt is actually laid out against.
 */
const SCREENS = [
  { name: "1080p", vw: 1920, vh: 950 },
  { name: "1440p", vw: 2560, vh: 1310 },
  { name: "a laptop", vw: 1600, vh: 770 },
];

describe("the felt", () => {
  it("fills a 1080p window rather than sitting in the middle of it", () => {
    const { width, height } = felt(1920, 950);
    /*
     * 768 before this was fixed, inside 1556px of page — a table drawn at half
     * the size of the screen it was on. It cannot reach the whole 1556 without
     * becoming a corridor, so what it does reach is the flattest a table is
     * allowed to be, which at this height is 960.
     */
    expect({ width: Math.round(width), height: Math.round(height) }).toEqual({
      width: 960,
      height: 480,
    });
  });

  it("gives up its shape before it gives up its size", () => {
    /*
     * The rule, said once: the only reason the felt is ever narrower than the
     * page is that it has run out of shape to give — it is already as flat as
     * a table is allowed to get. Narrower than the page while still holding a
     * comfortable 16:10 means the screen had room the table refused to take.
     */
    const held = SCREENS.filter(({ vw, vh }) => felt(vw, vh).width < offered(vw) - 1).map(
      ({ name, vw, vh }) => {
        const { width, height } = felt(vw, vh);
        return { screen: name, flatEnough: width / height > 1.9 };
      },
    );
    expect(held).toEqual(held.map(({ screen }) => ({ screen, flatEnough: true })));
  });

  it("is never flatter than a table", () => {
    for (const { name, vw, vh } of SCREENS) {
      const { width, height } = felt(vw, vh);
      const aspect = width / height;
      expect({ screen: name, tooFlat: aspect > 2.05, tooTall: aspect < 1.59 }).toEqual({
        screen: name,
        tooFlat: false,
        tooTall: false,
      });
    }
  });
});

/*
 * Ten seats round the oval, clearing each other.
 *
 * The bug this exists for: the ring's vertical radius is `--down` per cent of
 * the *table's height*, and the table's height is capped by `max-height:
 * max(290px, 100dvh - 470px)` — a number that comes from the window's height
 * alone. A seat's own height comes from `cqw`, the container's *width*. So the
 * two are not tied to each other at all, and on a short wide window the ring
 * flattens while the seats keep growing. Every one of the 42 states measured
 * (three window sizes x three seat shapes x seven felt widths) had opponents
 * overlapping, including the quietest one there is: cards, a name, a stack and
 * a dealer button, with nobody having spoken.
 *
 * It was read as a bug about the spoken bubble, because the four pairs that
 * catch the eye (1-2, 3-4, 6-7, 8-9) only touch once a bubble adds its reach.
 * The two that bind (2-3 and 7-8, stacked down each side) need nothing added
 * at all, which is why a check that removed the bubbles said the felt was fine.
 *
 * Pure arithmetic, not a DOM: the radius, the seat's width and the card's own
 * `clamp()` are read back out of `poker.css` rather than copied, so reverting
 * any of them fails here. The one thing that cannot be read out of a sheet is
 * how tall a line of a name and a line of a stack actually come out, so that
 * is measured, at the three felt widths the screens below produce — see
 * `oval.measured` for what was measured and how.
 */

/** The seats' own angle, from `.pk__seat`: `90deg + (seat / of) * 360deg`. */
function ovalAngle(seat: number, of: number): number {
  return ((90 + (seat / of) * 360) * Math.PI) / 180;
}

/**
 * Measured in a live browser on `/style` (PokerMockup, ten seats), with a mark
 * on every opponent and a spoken bubble and a showdown caption on top of it.
 *
 * `text` is the name-and-stack block, which is the whole of a seat once the
 * opponents' face-down cards are not drawn. `mark` is how far the dealer badge
 * reaches above the seat's own top — the bubble and the caption sit over the
 * seat rather than above it, so neither adds to this.
 *
 * Keyed by felt width rather than fitted to a curve: the screens below produce
 * exactly these three widths, so there is nothing to interpolate and a fit
 * would only be a second thing to get wrong.
 */
const measured: Record<number, { text: number; mark: number }> = {
  600: { text: 32.2, mark: 12.4 },
  960: { text: 47.1, mark: 9.6 },
  1556: { text: 70.8, mark: 13.1 },
};

/** A `clamp(a, b, c)` resolved for a felt of this width, `cqw` included. */
function clampFor(expression: string, width: number): number {
  const parts = expression.match(/clamp\(\s*([\d.]+)px,\s*([\d.]+)cqw,\s*([\d.]+)px\s*\)/);
  if (parts === null) {
    throw new Error(`not a clamp this test can read: ${expression}`);
  }
  const [, low, coefficient, high] = parts;
  return Math.min(
    Math.max(Number(low), (Number(coefficient) / 100) * width),
    Number(high),
  );
}

/**
 * The union of a seat's box with its mark, as the felt would lay it out.
 *
 * `extra` is height this one seat has that the others do not — the cards the
 * acting seat and the winner keep. It grows the seat both ways rather than
 * downward, because a seat is `translate(-50%, -50%)` onto its point on the
 * ring: the ring holds the seat's middle, so anything added to it is shared
 * between the seat above and the seat below.
 */
function ovalSeatBox(
  seat: number,
  of: number,
  table: { width: number; height: number },
  extra = 0,
) {
  const across = Number(declared(".pk__table", "--across").replace("%", "")) / 100;
  const down = Number(declared(".pk__table", "--down").replace("%", "")) / 100;
  const seatWidth = Number(declared(".pk__seat", "width").replace("px", ""));
  const gap = Number(declared(".pk__seat", "gap").replace("px", ""));
  const here = measured[Math.round(table.width)];
  if (here === undefined) {
    throw new Error(`nothing measured at a ${table.width}px felt`);
  }

  /*
   * Two face-down rectangles an opponent cannot read, at the size that costs
   * the ring the room it needs. Counted only while the sheet still draws them:
   * the fix is that it does not, and putting them back has to fail here.
   */
  const opponentCardsDrawn = !/\.pk__seat:not\(\.pk__seat--you\) \.pk__cards \{[^}]*display:\s*none/.test(css);
  const cards = opponentCardsDrawn
    ? clampFor(declared(".pk__cards .bj-card", "width"), table.width) * (7 / 5) + gap
    : 0;

  const height = here.text + cards + extra + here.mark;
  const angle = ovalAngle(seat, of);
  const x = table.width / 2 + Math.cos(angle) * across * table.width;
  const y = table.height / 2 + Math.sin(angle) * down * table.height;
  return {
    left: x - seatWidth / 2,
    right: x + seatWidth / 2,
    // The mark reaches up; the seat is centred on the ring without it.
    top: y - (height - here.mark) / 2 - here.mark,
    bottom: y + (height - here.mark) / 2,
  };
}

type Box = ReturnType<typeof ovalSeatBox>;

function collide(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe("ten seats round the oval", () => {
  const OF = 10;

  for (const { name, vw, vh } of SCREENS) {
    const table = felt(vw, vh);
    // Seat zero is you, at the bottom, and is the one seat drawn large on purpose.
    const opponents = Array.from({ length: OF - 1 }, (_, index) =>
      ovalSeatBox(index + 1, OF, table),
    );

    it(`keeps every opponent clear of its neighbours on ${name}`, () => {
      const touching: string[] = [];
      for (let a = 0; a < opponents.length; a += 1) {
        for (let b = a + 1; b < opponents.length; b += 1) {
          if (collide(opponents[a], opponents[b])) {
            touching.push(`${a + 1}-${b + 1}`);
          }
        }
      }
      expect({ screen: name, touching }).toEqual({ screen: name, touching: [] });
    });

    it(`keeps every opponent on the table on ${name}`, () => {
      /*
       * The timber, not the cloth: a corner landing on the rail is a card on
       * the edge of a table, which is where cards go. Leaving the table
       * altogether is what this catches. The margin is the rail's own width at
       * its thinnest — `.pk__felt`'s 2.6% side inset.
       */
      const margin = 0.026 * table.width;
      const off = opponents
        .map((box, index) => ({ seat: index + 1, box }))
        .filter(
          ({ box }) =>
            box.left < -margin ||
            box.top < -margin ||
            box.right > table.width + margin ||
            box.bottom > table.height + margin,
        )
        .map(({ seat }) => seat);
      expect({ screen: name, off }).toEqual({ screen: name, off: [] });
    });
  }
});

/*
 * And no opponent gets them back.
 *
 * The obvious exception — the acting seat and the winner keeping their cards,
 * which the phone layout has — is the one thing that undoes all of the above,
 * and it does it quietly: a seat with cards is the old tall seat in a ring
 * sized for the new short one. A single such seat fits at 1080p; two of them
 * side by side, which is what a split pot between neighbours makes, do not.
 *
 * Written as a rule about the sheet rather than about geometry because there
 * is no geometry left to check once nothing is tall — and because the way
 * this came back the first time was a rule that looked right and lost on
 * specificity, which a box model would never have noticed.
 */
describe("the cards no opponent draws on the oval", () => {
  // The sheet's own prose names these selectors while explaining them.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("hides them for every opponent", () => {
    expect(
      rules.includes(".pk__seat:not(.pk__seat--you) .pk__cards"),
      "nothing hides the opponents' cards any more",
    ).toBe(true);
  });

  it("puts none of them back at a weight that could win", () => {
    /*
     * Anything showing `.pk__cards` again has to be lighter than the rule
     * above, or it takes a seat's height back. The phone's own
     * `.pk__seat--acting .pk__cards` is two classes and so loses, which is
     * what settles that layout too; three would beat it and must not appear.
     */
    for (const state of ["--acting", "--won"]) {
      // Doubled, because a template literal eats a single backslash before the
      // regex ever sees it — and `\.` collapsed to `.` matches any character.
      const found = rules.match(new RegExp(`\\.pk__seat${state}[^,{\\n]*\\.pk__cards`, "g")) ?? [];
      const weights = found.map((each) => (each.match(/\.[a-z-]+/g) ?? []).length);
      expect({ state, tooHeavy: weights.filter((each) => each >= 3) }).toEqual({
        state,
        tooHeavy: [],
      });
    }
  });
});
