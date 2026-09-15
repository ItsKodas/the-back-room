// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChipMark } from "./Chip.js";

describe("the chip mark", () => {
  it("takes its colour from whatever it sits in", () => {
    /*
     * Gold beside a balance and faint on a key nobody can press: one drawing,
     * with the figure beside it deciding. A mark that painted its own gold
     * would stay lit on a dead key and say that key was still money.
     */
    const { container } = render(<ChipMark />);
    const painted = [...container.querySelectorAll("[fill]")].map((node) => node.getAttribute("fill"));
    expect(painted).toContain("currentColor");
    expect(painted.some((fill) => fill?.includes("--gr-color-chip"))).toBe(false);
  });

  it("gives every mark on a page its own cut-outs", () => {
    // Two masks sharing an id would have the second mark cut by the first.
    const { container } = render(
      <>
        <ChipMark />
        <ChipMark />
      </>,
    );
    const ids = [...container.querySelectorAll("mask")].map((mask) => mask.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
