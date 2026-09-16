import type { Mark, StrokeMark } from "@backroom/game-scribble";
import { SIZES } from "@backroom/game-scribble";
import { describe, expect, it } from "vitest";
import { INK_RGB, Raster, segmentSteps } from "./raster.js";

const at = (raster: Raster, x: number, y: number) => {
  const index = (y * raster.width + x) * 4;
  return [raster.pixels[index], raster.pixels[index + 1], raster.pixels[index + 2]];
};
const rgb = (ink: keyof typeof INK_RGB) => [...INK_RGB[ink]];

const line = (id: string, pts: number[], ink: StrokeMark["ink"] = "red", size = 1): StrokeMark => ({
  kind: "stroke",
  id,
  by: "s0",
  ink,
  size,
  pts,
});

const box = (id: string): StrokeMark => line(id, [300, 300, 400, 300, 400, 400, 300, 400, 300, 300], "black");

/*
 * Deep equality on a 3 MB typed array is seconds of chai walking every byte,
 * which is fast enough alone but tips over vitest's default timeout the
 * moment the rest of the suite is contending for CPU — and a flake is a bug
 * here, not something to wait out. Comparing by hand asserts the same fact
 * in milliseconds.
 */
const firstDifference = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  if (a.length !== b.length) {
    return Math.min(a.length, b.length);
  }
  for (let at = 0; at < a.length; at += 1) {
    if (a[at] !== b[at]) {
      return at;
    }
  }
  return -1;
};

describe("segmentSteps", () => {
  it("counts steps from an exact segment length, not an engine's hypot approximation", () => {
    // Math.hypot(35, 120) is 125.00000000000001 on V8 (ECMA-262 leaves it
    // implementation-approximated), one step short of 125 exact and enough to
    // stamp a different disc on another engine. sqrt(35² + 120²) is exact.
    expect(segmentSteps(0, 0, 35, 120, 2)).toBe(125);
  });

  it("floors the step divisor at the new Hairline radius exactly as it already did at the old smallest one", () => {
    // `Math.max(1, radius / 2)` is the guard: radius 2's own divisor is
    // already floored to 1 (2/2 = 1), and radius 1's divisor floors to the
    // same 1 (1/2 = 0.5, floored up) — so adding a radius smaller than any
    // existing size does not stamp a denser run of discs than the smallest
    // size already did. Asserted directly rather than assumed, per the brief.
    expect(segmentSteps(0, 0, 200, 0, 1)).toBe(segmentSteps(0, 0, 200, 0, 2));
  });
});

describe("the napkin's rasteriser", () => {
  it("starts as paper", () => {
    const raster = new Raster();
    expect(at(raster, 0, 0)).toEqual(rgb("paper"));
    expect(at(raster, 999, 749)).toEqual(rgb("paper"));
  });

  it("draws a line along its points, in its ink, and nowhere far from it", () => {
    const raster = new Raster();
    expect(raster.update([line("k1", [100, 100, 200, 100])])).toBe(true);
    expect(at(raster, 150, 100)).toEqual(rgb("red"));
    expect(at(raster, 150, 120)).toEqual(rgb("paper"));
  });

  it("fills an enclosed shape and nothing outside it", () => {
    const raster = new Raster();
    raster.update([box("k1"), { kind: "fill", id: "f1", by: "s0", ink: "blue", x: 350, y: 350 }]);
    expect(at(raster, 350, 350)).toEqual(rgb("blue"));
    expect(at(raster, 250, 250)).toEqual(rgb("paper"));
    expect(at(raster, 300, 350)).toEqual(rgb("black"));
  });

  it("leaves the picture alone when a fill lands on its own colour", () => {
    const raster = new Raster();
    raster.update([{ kind: "fill", id: "f1", by: "s0", ink: "paper", x: 1, y: 1 }]);
    expect(at(raster, 500, 500)).toEqual(rgb("paper"));
  });

  it("fills from the grid's far edge without reading past it", () => {
    const raster = new Raster();
    raster.update([{ kind: "fill", id: "f1", by: "s0", ink: "green", x: 1000, y: 750 }]);
    expect(at(raster, 0, 0)).toEqual(rgb("green"));
  });

  it("draws the same pixels whether a line arrives whole or a batch at a time", () => {
    const whole = new Raster();
    whole.update([line("k1", [10, 10, 60, 40, 120, 90, 200, 90])]);

    const batched = new Raster();
    batched.update([line("k1", [10, 10, 60, 40])]);
    expect(batched.update([line("k1", [10, 10, 60, 40])])).toBe(false);
    batched.update([line("k1", [10, 10, 60, 40, 120, 90, 200, 90])]);

    expect(firstDifference(batched.pixels, whole.pixels)).toBe(-1);
  });

  it("redraws in order when a line behind a fill grows, rather than painting over the fill", () => {
    const marks = (pts: number[]): Mark[] => [box("k1"), { kind: "fill", id: "f1", by: "s0", ink: "blue", x: 350, y: 350 }, line("k2", pts, "yellow")];
    const grown: Mark[] = [line("k0", [320, 320, 380, 380], "black"), ...marks([0, 0])];

    const fresh = new Raster();
    fresh.update(grown);

    const stepped = new Raster();
    stepped.update([line("k0", [320, 320], "black"), ...marks([0, 0])]);
    stepped.update(grown);

    expect(firstDifference(stepped.pixels, fresh.pixels)).toBe(-1);
  });

  it("redraws from paper when an earlier stroke grows behind a later one, rather than painting over it", () => {
    // A grows past where B already lies; a fresh raster given the grown marks
    // draws A whole before B, so B wins the crossing. Growing A in place and
    // only appending its new segment paints that segment last instead,
    // handing the crossing to A — two drawers would see different pictures.
    const a = (pts: number[]) => line("a", pts, "red");
    const b = line("b", [150, 50, 150, 150], "blue");

    const stepped = new Raster();
    stepped.update([a([50, 100, 90, 100]), b]);
    stepped.update([a([50, 100, 90, 100, 200, 100]), b]);

    const fresh = new Raster();
    fresh.update([a([50, 100, 90, 100, 200, 100]), b]);

    expect(firstDifference(stepped.pixels, fresh.pixels)).toBe(-1);
  });

  it("starts again from paper when a mark is undone", () => {
    const raster = new Raster();
    raster.update([line("k1", [100, 100, 200, 100])]);
    raster.update([]);
    expect(at(raster, 150, 100)).toEqual(rgb("paper"));
  });

  it("stamps every size's disc exactly as the naive per-cell rule would, inside the grid and clipped at its edge", () => {
    // Guards the row-span optimisation: whatever shortcut `stamp` takes for
    // speed, the set of pixels it paints has to be the one `dx*dx + dy*dy <=
    // radius*radius`, tested cell by cell, would paint — mid-grid, where
    // nothing clips, and at the far corner, where the disc runs off the edge.
    for (let sizeIndex = 0; sizeIndex < SIZES.length; sizeIndex += 1) {
      const radius = (SIZES[sizeIndex] as number) / 2;
      const reach = Math.ceil(radius);
      const limit = radius * radius;
      for (const [cx, cy] of [
        [500, 400],
        [0, 0],
        [999, 749],
      ] as const) {
        const raster = new Raster();
        raster.update([line(`s${sizeIndex}-${cx}-${cy}`, [cx, cy], "black", sizeIndex)]);
        for (let dy = -reach; dy <= reach; dy += 1) {
          const y = cy + dy;
          if (y < 0 || y >= raster.height) {
            continue;
          }
          for (let dx = -reach; dx <= reach; dx += 1) {
            const x = cx + dx;
            if (x < 0 || x >= raster.width) {
              continue;
            }
            const expected = dx * dx + dy * dy <= limit ? rgb("black") : rgb("paper");
            expect(at(raster, x, y)).toEqual(expected);
          }
        }
      }
    }
  });

  it("keeps track of a stroke with no points yet, rather than leaving a hole", () => {
    // A stroke can exist with an empty `pts` array before its first point
    // lands. Skipping the record along with the (correctly) skipped draw
    // leaves `this.drawn` sparse at that index, and the next update's id
    // check reads off the hole.
    const raster = new Raster();
    const marks = [line("empty", []), line("k1", [100, 100, 200, 100])];
    raster.update(marks);
    expect(raster.update(marks)).toBe(false);
  });
});
