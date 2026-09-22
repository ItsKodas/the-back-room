import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { seatAt } from "./Felt.js";

describe("where a seat sits", () => {
  it("says which seat it is and how many there are, and nothing about angles", () => {
    // The arrangement is the stylesheet's decision, so React must not fix it here.
    expect(seatAt(3, 10)).toEqual({ "--seat": "3", "--of": "10", "--out": "1" });
  });

  it("marks every other seat as the one pushed further out", () => {
    /*
     * Nine plates wide enough to hold a name need about 594px of arc and a
     * phone's ring gives about 505px, so on one radius they cannot all fit —
     * which is why they were 48px and showing two letters of a name. Pushing
     * alternate seats out gives neighbours a different radius, so they may
     * overlap in angle without overlapping on screen. Which tier a seat is on
     * is a fact about its index, so React says it; how far out is the
     * stylesheet's, like every other distance here.
     */
    expect([0, 1, 2, 3].map((seat) => seatAt(seat, 10)["--out"])).toEqual(["0", "1", "0", "1"]);
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
const phoneTable = block(css, "@container fit (max-width: 560px)");
const phoneSeat = block(css, "@container pk (max-width: 560px)");

const ACROSS = pct(phoneTable, "--across");
const DOWN = pct(phoneTable, "--down");
const SEAT_W = Number(phoneSeat.match(/\.pk__seat\s*\{[^}]*width:\s*(\d+)px/)?.[1]);
const STAGGER = Number(phoneSeat.match(/--stagger:\s*([\d.]+)/)?.[1]);
const FROM = Number(phoneSeat.match(/--from:\s*(\d+)deg/)?.[1]);
const SPAN = Number(phoneSeat.match(/--span:\s*(\d+)deg/)?.[1]);

/*
 * How tall an opponent's plate is, measured on a live ten-handed table: its
 * name-and-stack block and, mid-hand, a wager line. Not the mark or the
 * bubble — both are `position: absolute` and contribute nothing to the box
 * the browser lays out. Taking this from `/style`'s mockup instead of a
 * dealt table is how this test once passed while the real felt overlapped.
 */
const SEAT_H = 38;

const OF = 10;
/* The real table box at 375×560, measured, and the band it keeps for your hand. */
const TABLE_W = 351;
const TABLE_H = 319;
const UNDER = 84;
/* A plate may sit on the rail — that is what a rail is for — but never off
   the phone, and `.pk__table` is inset this far inside the page's 375. */
const OFF_TABLE = 12;

/** Exactly what the stylesheet computes, resolution rules and all. */
function seatBox(seat: number) {
  const angle = ((FROM + ((seat - 0.5) / (OF - 1)) * SPAN) * Math.PI) / 180;
  // Every other seat is pushed out; `--out` is `seat % 2`, from `seatAt`.
  const reach = 1 + (seat % 2) * (STAGGER - 1);
  // Percentages resolve against the table box; the ring's centre is lifted
  // by half the band kept underneath it.
  const cx = TABLE_W / 2 + Math.cos(angle) * ACROSS * TABLE_W * reach;
  const cy = (TABLE_H - UNDER) / 2 + Math.sin(angle) * DOWN * TABLE_H * reach;
  return { left: cx - SEAT_W / 2, right: cx + SEAT_W / 2, top: cy - SEAT_H / 2, bottom: cy + SEAT_H / 2 };
}

function overlaps(a: ReturnType<typeof seatBox>, b: ReturnType<typeof seatBox>): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe("the staggered ring fits nine readable plates", () => {
  // Seat zero is you, and you are not on the ring at this width at all.
  const opponents = Array.from({ length: OF - 1 }, (_, index) => seatBox(index + 1));

  it("uses plates wide enough to hold a name", () => {
    // 48px is the width at which a name became two letters and an ellipsis.
    expect(SEAT_W).toBeGreaterThanOrEqual(60);
  });

  it("keeps every opponent's plate clear of its neighbours'", () => {
    for (let i = 0; i < opponents.length; i += 1) {
      for (let j = i + 1; j < opponents.length; j += 1) {
        expect(overlaps(opponents[i], opponents[j]), `seat ${i + 1} vs seat ${j + 1}`).toBe(false);
      }
    }
  });

  it("keeps every opponent's plate on the phone", () => {
    for (let index = 0; index < opponents.length; index += 1) {
      const box = opponents[index];
      expect(box.left, `seat ${index + 1} left`).toBeGreaterThanOrEqual(-OFF_TABLE);
      expect(box.right, `seat ${index + 1} right`).toBeLessThanOrEqual(TABLE_W + OFF_TABLE);
      expect(box.top, `seat ${index + 1} top`).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the ring out of the band your own hand has", () => {
    // The whole point of lifting the ring: the strip under the cloth is yours.
    for (let index = 0; index < opponents.length; index += 1) {
      expect(opponents[index].bottom, `seat ${index + 1} bottom`).toBeLessThanOrEqual(TABLE_H - UNDER);
    }
  });
});
