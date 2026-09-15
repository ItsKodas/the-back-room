import type { Mark, StrokeMark } from "@backroom/game-scribble";
import { describe, expect, it } from "vitest";
import { INK_RGB, Raster } from "./raster.js";

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

    expect(batched.pixels).toEqual(whole.pixels);
  });

  it("redraws in order when a line behind a fill grows, rather than painting over the fill", () => {
    const marks = (pts: number[]): Mark[] => [box("k1"), { kind: "fill", id: "f1", by: "s0", ink: "blue", x: 350, y: 350 }, line("k2", pts, "yellow")];
    const grown: Mark[] = [line("k0", [320, 320, 380, 380], "black"), ...marks([0, 0])];

    const fresh = new Raster();
    fresh.update(grown);

    const stepped = new Raster();
    stepped.update([line("k0", [320, 320], "black"), ...marks([0, 0])]);
    stepped.update(grown);

    expect(stepped.pixels).toEqual(fresh.pixels);
  });

  it("starts again from paper when a mark is undone", () => {
    const raster = new Raster();
    raster.update([line("k1", [100, 100, 200, 100])]);
    raster.update([]);
    expect(at(raster, 150, 100)).toEqual(rgb("paper"));
  });
});
