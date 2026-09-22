// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouletteMockup } from "./RouletteMockup.js";

afterEach(cleanup);

/*
 * `Cloth` decides its own orientation from a `ResizeObserver` on its own box.
 * jsdom has none, so without this stub every cloth in these tests renders at
 * its default (landscape) regardless of what `portrait` is asked to do —
 * which would make the regression this file exists to catch invisible: a
 * `portrait={false}` and a `portrait={undefined}` look identical unless
 * `narrow` can actually become true.
 */
function stubNarrowResizeObserver() {
  class NarrowResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      this.callback(
        [{ contentRect: { width: 300 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", NarrowResizeObserver);
}

describe("RouletteMockup", () => {
  it("defaults the cloth orientation to Auto, not Laid out", () => {
    render(<RouletteMockup />);
    const seg = screen.getByRole("group", { name: "Cloth" });
    const options = within(seg)
      .getAllByRole("button")
      .map((b) => ({ text: b.textContent, pressed: b.getAttribute("aria-pressed") }));
    expect(options).toEqual([
      { text: "Auto", pressed: "true" },
      { text: "Laid out", pressed: "false" },
      { text: "On its side", pressed: "false" },
    ]);
  });

  it("lets the cloth turn itself sideways on a narrow box when Auto is picked", () => {
    stubNarrowResizeObserver();
    render(<RouletteMockup />);
    // Auto is the default: an explicit `portrait={false}` here would defeat
    // the cloth's own narrow detection and keep it landscape regardless.
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    expect(cloth.className).toContain("rl__cloth--portrait");
  });
});
