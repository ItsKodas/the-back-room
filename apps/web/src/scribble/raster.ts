import type { Ink, Mark, StrokeMark } from "@backroom/game-scribble";
import { GRID_HEIGHT, GRID_WIDTH, SIZES } from "@backroom/game-scribble";

/* The same napkin as --sc-napkin, as numbers a pixel buffer can hold. */
const PAPER = [242, 239, 233] as const;

/*
 * The four paper bytes as one 32-bit word, in whatever byte order this
 * platform's `Uint32Array` actually uses — built from the bytes themselves
 * rather than shifted by hand, so a wipe is correct on a big-endian host too.
 */
const PAPER_WORD = new Uint32Array(new Uint8ClampedArray([PAPER[0], PAPER[1], PAPER[2], 255]).buffer)[0] as number;

/*
 * A disc's row half-widths, keyed by radius: for each `dy` from `-reach` to
 * `reach`, the largest `dx` with `dx² + dy² <= radius²` — the same boundary
 * `stamp` used to test cell by cell, computed once per radius (there are
 * only a handful, one per `SIZES` entry) rather than for every centre a
 * stroke passes.
 */
const DISC_SPANS = new Map<number, readonly number[]>();

function discSpan(radius: number): readonly number[] {
  let span = DISC_SPANS.get(radius);
  if (span === undefined) {
    const reach = Math.ceil(radius);
    const limit = radius * radius;
    const half: number[] = [];
    for (let dy = -reach; dy <= reach; dy += 1) {
      half.push(Math.floor(Math.sqrt(Math.max(0, limit - dy * dy))));
    }
    span = half;
    DISC_SPANS.set(radius, span);
  }
  return span;
}

export const INK_RGB: Record<Ink, readonly [number, number, number]> = {
  black: [31, 28, 34],
  red: [217, 65, 59],
  orange: [239, 125, 45],
  yellow: [241, 194, 50],
  green: [47, 157, 89],
  blue: [46, 111, 212],
  purple: [123, 75, 200],
  brown: [122, 79, 46],
  white: [255, 255, 255],
  paper: PAPER,
};

interface Drawn {
  id: string;
  kind: Mark["kind"];
  /** Coordinates drawn so far for a stroke; 1 for a fill. */
  length: number;
}

const lengthOf = (mark: Mark) => (mark.kind === "stroke" ? mark.pts.length : 1);

/*
 * `Math.hypot` is only implementation-approximated by ECMA-262: V8 returns
 * 125.00000000000001 for (35, 120), one `Math.ceil` short of 125 exact on
 * another engine, which stamps a differently-sized run of discs — the same
 * failure Amendment 7 exists to rule out, just moved from canvas AA into an
 * intrinsic. `Math.sqrt` of a sum of integer squares has no such freedom.
 */
export function segmentSteps(x0: number, y0: number, x1: number, y1: number, radius: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / Math.max(1, radius / 2)));
}

/**
 * The picture as pixels, drawn by arithmetic every device does identically.
 *
 * A canvas antialiases a line the way its browser likes, so a fill bounded by
 * canvas lines floods different pixels in Safari than in Chrome, and two people
 * drawing together end up looking at different pictures. Lines here are discs
 * stamped along each segment with no blending, and a fill floods exact colour
 * matches — the same integers in, the same pixels out, everywhere.
 */
export class Raster {
  readonly width = GRID_WIDTH;
  readonly height = GRID_HEIGHT;
  readonly pixels = new Uint8ClampedArray(GRID_WIDTH * GRID_HEIGHT * 4);
  /** The same bytes as `pixels`, four at a time, so a wipe is one word-fill rather than 750,000 byte-writes. */
  private readonly words = new Uint32Array(this.pixels.buffer);
  private drawn: Drawn[] = [];

  constructor() {
    this.wipe();
  }

  update(marks: readonly Mark[]): boolean {
    const grows = this.onlyGrows(marks);
    if (!grows) {
      this.wipe();
      this.drawn = [];
    }
    let changed = !grows;
    marks.forEach((mark, index) => {
      const from = this.drawn[index]?.length ?? 0;
      const length = lengthOf(mark);
      // Recorded even when there is nothing new to draw (an empty stroke
      // included), so a later mark's index is never a hole `onlyGrows` reads
      // `.id` off of.
      this.drawn[index] = { id: mark.id, kind: mark.kind, length };
      if (from === length) {
        return;
      }
      if (mark.kind === "stroke") {
        this.strokeFrom(mark, from);
      } else {
        this.flood(mark.x, mark.y, INK_RGB[mark.ink]);
      }
      changed = true;
    });
    return changed;
  }

  /*
   * Whether `marks` is what is already drawn plus more on the end: the same
   * marks in the same order, and only the last already-drawn one may have
   * grown. Ink already drawn *under* it is settled — a mark earlier in the
   * stack growing has to be redrawn under everything after it, which only a
   * wipe and a redraw from paper does; painting just its new stretch would
   * paint it on top of whatever was drawn after it instead.
   */
  private onlyGrows(marks: readonly Mark[]): boolean {
    if (marks.length < this.drawn.length) {
      return false;
    }
    const lastDrawn = this.drawn.length - 1;
    for (let index = 0; index < this.drawn.length; index += 1) {
      const drawn = this.drawn[index] as Drawn;
      const mark = marks[index] as Mark;
      const length = lengthOf(mark);
      if (mark.id !== drawn.id || mark.kind !== drawn.kind) {
        return false;
      }
      if (index === lastDrawn ? length < drawn.length : length !== drawn.length) {
        return false;
      }
    }
    return true;
  }

  private wipe(): void {
    this.words.fill(PAPER_WORD);
  }

  private strokeFrom(mark: StrokeMark, from: number): void {
    const radius = (SIZES[mark.size] ?? SIZES[1]) / 2;
    const colour = INK_RGB[mark.ink];
    const pts = mark.pts;
    if (from === 0) {
      this.stamp(pts[0] as number, pts[1] as number, radius, colour);
    }
    for (let at = Math.max(2, from); at < pts.length; at += 2) {
      this.segment(pts[at - 2] as number, pts[at - 1] as number, pts[at] as number, pts[at + 1] as number, radius, colour);
    }
  }

  private segment(x0: number, y0: number, x1: number, y1: number, radius: number, colour: readonly number[]): void {
    const steps = segmentSteps(x0, y0, x1, y1, radius);
    for (let step = 1; step <= steps; step += 1) {
      this.stamp(
        Math.round(x0 + ((x1 - x0) * step) / steps),
        Math.round(y0 + ((y1 - y0) * step) / steps),
        radius,
        colour,
      );
    }
  }

  private stamp(cx: number, cy: number, radius: number, colour: readonly number[]): void {
    const span = discSpan(radius);
    const reach = Math.ceil(radius);
    for (let i = 0; i < span.length; i += 1) {
      const y = cy + (i - reach);
      if (y < 0 || y >= this.height) {
        continue;
      }
      const half = span[i] as number;
      const left = Math.max(0, cx - half);
      const right = Math.min(this.width - 1, cx + half);
      const rowStart = y * this.width;
      for (let x = left; x <= right; x += 1) {
        this.paint((rowStart + x) * 4, colour);
      }
    }
  }

  private paint(index: number, colour: readonly number[]): void {
    this.pixels[index] = colour[0] as number;
    this.pixels[index + 1] = colour[1] as number;
    this.pixels[index + 2] = colour[2] as number;
    this.pixels[index + 3] = 255;
  }

  /** A scanline flood over exact colour matches. */
  private flood(x: number, y: number, colour: readonly number[]): void {
    const pixels = this.pixels;
    const index = (px: number, py: number) => (py * this.width + px) * 4;
    const startX = Math.min(this.width - 1, x);
    const startY = Math.min(this.height - 1, y);
    const start = index(startX, startY);
    const target = [pixels[start], pixels[start + 1], pixels[start + 2]];
    if (target[0] === colour[0] && target[1] === colour[1] && target[2] === colour[2]) {
      return;
    }
    const same = (at: number) =>
      pixels[at] === target[0] && pixels[at + 1] === target[1] && pixels[at + 2] === target[2];
    const stack: number[] = [startX, startY];
    while (stack.length > 0) {
      const row = stack.pop() as number;
      let column = stack.pop() as number;
      if (!same(index(column, row))) {
        continue;
      }
      while (column > 0 && same(index(column - 1, row))) {
        column -= 1;
      }
      let above = false;
      let below = false;
      for (; column < this.width && same(index(column, row)); column += 1) {
        this.paint(index(column, row), colour);
        if (row > 0) {
          const open = same(index(column, row - 1));
          if (open && !above) {
            stack.push(column, row - 1);
          }
          above = open;
        }
        if (row < this.height - 1) {
          const open = same(index(column, row + 1));
          if (open && !below) {
            stack.push(column, row + 1);
          }
          below = open;
        }
      }
    }
  }
}
