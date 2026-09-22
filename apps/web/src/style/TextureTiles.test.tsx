// @vitest-environment jsdom
import { glass, plaster } from "@backroom/ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TextureTiles } from "./TextureTiles.js";

/**
 * Where the tiles' surfaces are put, which is a question about cost.
 *
 * A surface is a gradient over a percent-encoded SVG or two, and the CSSOM
 * resolves and re-serialises every gradient written into `background-image`.
 * That resolution is superlinear in the length of the value: in jsdom the six
 * surfaces on this page cost between 300ms and 1.8s between them — the greater
 * part of what rendering the whole gallery took, and enough that whichever
 * test rendered it first went over vitest's per-test timeout about one run in
 * three. A custom property is stored as written, and costs a tenth of a
 * millisecond.
 *
 * So what is asserted is that nothing reaches that setter, rather than how long
 * the render took. A timing threshold here would sit close enough to the cold
 * cost of the first render in a process to be a flake of its own, and a flake
 * is the thing this is fixing.
 */
describe("TextureTiles", () => {
  it("hands each surface to the stylesheet whole, rather than through the CSSOM", () => {
    render(<TextureTiles />);
    // Byte for byte what the surface function returned. Going back through
    // `background-image` would show up here as normalised colour: the resolver
    // rewrites every `#rrggbb` as `rgb(r, g, b)` on the way in.
    expect(screen.getByTestId("texture-glass").style.getPropertyValue("--tile-surface")).toBe(
      glass({ seed: 1 }),
    );
    expect(screen.getByTestId("texture-plaster").style.getPropertyValue("--tile-surface")).toBe(
      plaster({ seed: 1 }),
    );
  });

  it("leaves the property whose setter does the resolving alone", () => {
    render(<TextureTiles />);
    for (const id of ["plaster", "plaster-alt", "felt", "glass", "card", "vignette"]) {
      expect(screen.getByTestId(`texture-${id}`).style.backgroundImage).toBe("");
    }
  });
});
