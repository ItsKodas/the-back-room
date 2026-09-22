// @vitest-environment jsdom
import { color, SURFACES } from "@backroom/ui";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Gallery } from "./Gallery.js";

describe("Gallery", () => {
  it("names every palette entry", () => {
    render(<Gallery />);
    const palette = screen.getByRole("region", { name: /palette/i });
    for (const name of Object.keys(color)) {
      expect(within(palette).getByText(name)).toBeDefined();
    }
  });

  it("prints the hex value beside each swatch", () => {
    render(<Gallery />);
    const palette = screen.getByRole("region", { name: /palette/i });
    expect(within(palette).getByText(color.neon)).toBeDefined();
    expect(within(palette).getByText(color.chip)).toBeDefined();
  });

  it("shows a specimen for each of the three typefaces", () => {
    render(<Gallery />);
    const type = screen.getByRole("region", { name: /type/i });
    expect(within(type).getByText(/bevan/i)).toBeDefined();
    expect(within(type).getByText(/plex sans/i)).toBeDefined();
    expect(within(type).getByText(/plex mono/i)).toBeDefined();
  });

  it("renders a tile for every surface plus the vignette", () => {
    render(<Gallery />);
    const textures = screen.getByRole("region", { name: /texture/i });
    for (const name of [...SURFACES, "vignette"]) {
      // getAllByText, not getByText: plaster appears twice, once per seed.
      expect(within(textures).getAllByText(name).length).toBeGreaterThan(0);
    }
  });

  it("gives each texture tile a real surface", () => {
    render(<Gallery />);
    const tile = screen.getByTestId("texture-plaster");
    expect(tile.style.getPropertyValue("--tile-surface")).toContain("gradient(");
  });

  it("varies the seed across tiles of the same surface", () => {
    render(<Gallery />);
    const first = screen.getByTestId("texture-plaster").style.getPropertyValue("--tile-surface");
    const second = screen
      .getByTestId("texture-plaster-alt")
      .style.getPropertyValue("--tile-surface");
    expect(first).not.toBe(second);
  });

  it("shows every fitting by its class name, so a later pass has a reference to build from", () => {
    render(<Gallery />);
    const fittings = screen.getByRole("region", { name: /fittings/i });
    for (const name of [".slab", ".key", ".quiet", ".seg", ".lamps", ".plates", ".sort", ".input", ".lcd", ".housing", ".well", ".rows", ".readout", ".tag", ".notice"]) {
      expect(within(fittings).getByText(name)).toBeDefined();
    }
  });

  it("lets the fittings be seen in every room", () => {
    render(<Gallery />);
    const rooms = screen.getByRole("group", { name: "Room" });
    for (const room of ["Building", "Blackjack", "Greed", "Roulette", "Slots"]) {
      expect(within(rooms).getByRole("button", { name: room })).toBeDefined();
    }
  });
});
