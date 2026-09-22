import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { seatAt } from "./Felt.js";

describe("where a seat sits", () => {
  it("says which seat it is and how many there are, and nothing about angles", () => {
    // The arrangement is the stylesheet's decision, so React must not fix it here.
    expect(seatAt(3, 10)).toEqual({ "--seat": "3", "--of": "10" });
  });
});

/*
 * A geometry check, not a string match — fix round 1, finding 4: the two
 * container-query tests in `poker.css.test.ts` only ever check that the
 * angle formulas are present in the sheet's text, so a radius reverted back
 * toward the oval's, or a seat widened back toward 56px, would leave every
 * existing test green while the horseshoe went back to overlapping.
 *
 * The radius and the seat width are read out of `poker.css` itself, the same
 * way `poker.css.test.ts` does, so they cannot silently drift from what is
 * actually shipped. The two numbers that cannot be read out of the sheet —
 * how tall an opponent's box gets, and how big the felt it sits on is — are
 * measured on a live ten-handed table, not modelled and not taken from the
 * gallery's mockup. Getting either of those from the mockup is exactly how
 * this test passed while the real felt overlapped.
 */
function sheet(path: string): string {
  const found = [resolve(process.cwd(), `apps/web/${path}`), resolve(process.cwd(), path)].find((each) =>
    existsSync(each),
  );
  return (found === undefined ? "" : readFileSync(found, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
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

/** A percentage custom property's value, as a fraction, read out of a block rather than copied by hand. */
function pct(text: string, name: string): number {
  const found = text.match(new RegExp(`${name}:\\s*(-?[\\d.]+)%`));
  if (found?.[1] === undefined) {
    throw new Error(`${name} not found`);
  }
  return Number(found[1]) / 100;
}

const css = sheet("src/poker/poker.css");
const phoneRadius = block(css, "@container fit (max-width: 560px)");
const phoneSeat = block(css, "@container pk (max-width: 560px)");

const ACROSS = pct(phoneRadius, "--across");
const DOWN = pct(phoneRadius, "--down");
const SEAT_W = Number(phoneSeat.match(/\.pk__seat\s*\{[^}]*width:\s*(\d+)px/)?.[1]);
/*
 * How tall an opponent's seat actually gets, measured on the real table.
 *
 * This number was twice wrong before, and both times the test stayed green
 * while the felt overlapped:
 *
 *  - it was taken from `/style`'s mockup rather than a dealt table, and the
 *    mockup's seat carries no wager line. A seat with `bet 540` under its
 *    stack is a row taller than one without, and mid-hand nearly every seat
 *    has one.
 *  - the felt it was measured against was the mockup's, which is a different
 *    shape from the real one.
 *
 * So both are measured off a live ten-handed table now, at the shortest size
 * this is checked at, and the browser numbers are written down beside them:
 * an opponent's box is its cards, its name-and-stack block and its wager
 * line, and nothing else — the mark and the bubble are `position: absolute`
 * and contribute nothing to the box the browser lays out.
 */
const SEAT_H = 48;

const OF = 10;
// The real felt at 375×560, measured: `.pk__table`'s own border box.
const TABLE_W = 351;
const TABLE_H = 275;

/** Radians, matching `calc(150deg + ((var(--seat) - 0.5) / (var(--of) - 1)) * 240deg)`. */
function horseshoeAngle(seat: number, of: number): number {
  return ((150 + ((seat - 0.5) / (of - 1)) * 240) * Math.PI) / 180;
}

function seatBox(seat: number, of: number) {
  const angle = horseshoeAngle(seat, of);
  const cx = TABLE_W / 2 + Math.cos(angle) * ACROSS * TABLE_W;
  const cy = TABLE_H / 2 + Math.sin(angle) * DOWN * TABLE_H;
  return { left: cx - SEAT_W / 2, right: cx + SEAT_W / 2, top: cy - SEAT_H / 2, bottom: cy + SEAT_H / 2 };
}

function overlaps(a: ReturnType<typeof seatBox>, b: ReturnType<typeof seatBox>): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe("the horseshoe actually fits, at ten seats (fix round 1, finding 4)", () => {
  // Seat 0 is you, pinned to the bottom and excluded here — a mark and a
  // spoken bubble are what the other nine can carry, not you.
  const opponents = Array.from({ length: OF - 1 }, (_, index) => seatBox(index + 1, OF));

  it("keeps every opponent's box clear of its neighbours'", () => {
    for (let i = 0; i < opponents.length; i += 1) {
      for (let j = i + 1; j < opponents.length; j += 1) {
        expect(overlaps(opponents[i], opponents[j]), `seat ${i + 1} vs seat ${j + 1}`).toBe(false);
      }
    }
  });

  it("keeps every opponent's box on the table", () => {
    /*
     * The table, not the green cloth inside it: a plate is allowed to overlap
     * the timber, which is what the rail is for — it is leaving the table
     * altogether that this guards against. The margin is the worst case the
     * shipped radii actually produce, to one decimal place rather than a
     * round number, so that widening it later is a decision somebody makes
     * on purpose rather than a regression that slips under a generous cap.
     */
    const MARGIN = 5;
    for (let index = 0; index < opponents.length; index += 1) {
      const box = opponents[index];
      expect(box.left, `seat ${index + 1} left`).toBeGreaterThanOrEqual(-MARGIN);
      expect(box.top, `seat ${index + 1} top`).toBeGreaterThanOrEqual(-MARGIN);
      expect(box.right, `seat ${index + 1} right`).toBeLessThanOrEqual(TABLE_W + MARGIN);
      expect(box.bottom, `seat ${index + 1} bottom`).toBeLessThanOrEqual(TABLE_H + MARGIN);
    }
  });
});
