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
 * way `poker.css.test.ts` does, so this cannot silently drift from what is
 * actually shipped. The one number that cannot be read out of the sheet —
 * how tall a real opponent seat's box gets once its mark and its spoken
 * bubble (both `position: absolute`, so no CSS custom property carries their
 * reach) are counted — is measured instead: 68px, at a live 331×376 felt (a
 * 375×560 phone, the narrowest and shortest size this is checked at, as
 * rendered by the `/style` gallery's own copy of this markup) with a mark
 * badge and a spoken bubble on the same seat at once. `poker.css`'s own
 * comment above `@container fit (max-width: 560px)` has the full derivation.
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
// Measured, not guessed — see this file's own top comment.
const SEAT_H = 68;

const OF = 10;
// The same felt this was measured against: `/style`'s mockup at 375×560.
const TABLE_W = 331;
const TABLE_H = 376;

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
     * The table, not the green cloth inside it: a card corner is allowed to
     * land on the timber (the oval's own cards do, at a tight radius) — it
     * is leaving the table altogether that this guards against. A margin
     * rather than a hard 0: nine boxes with a mark and a bubble apiece only
     * clear each other (the test above) by asking a little more of the felt
     * than a table this size, at this radius, has going spare at its very
     * top — the worst seat's mark pokes `MARGIN`px past the table's own
     * edge, well inside the rail's own width (the felt's own 3.4% top inset
     * is ~13px at this felt's height), never off it. Set to the exact worst
     * case measured rather than a round number, so tightening the margin
     * later is a choice rather than an accident.
     */
    const MARGIN = 8;
    for (let index = 0; index < opponents.length; index += 1) {
      const box = opponents[index];
      expect(box.left, `seat ${index + 1} left`).toBeGreaterThanOrEqual(-MARGIN);
      expect(box.top, `seat ${index + 1} top`).toBeGreaterThanOrEqual(-MARGIN);
      expect(box.right, `seat ${index + 1} right`).toBeLessThanOrEqual(TABLE_W + MARGIN);
      expect(box.bottom, `seat ${index + 1} bottom`).toBeLessThanOrEqual(TABLE_H + MARGIN);
    }
  });
});
