// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Falling } from "./Falling.js";

describe("the number falling", () => {
  it("shows the number it settled on", () => {
    render(<Falling value={743} rolling={false} />);
    expect(screen.getByText("743")).toBeTruthy();
  });

  it("shows no number at all while it is still tumbling", () => {
    /*
     * The whole point. A tumbling number that showed a value would be the
     * client inventing a fact only the server knows — and worse, the player
     * would see it change, which reads as the table correcting itself.
     */
    const { container } = render(<Falling value={743} rolling={true} />);
    expect(container.textContent).not.toContain("743");
  });

  it("paints something for a sighted player while tumbling, not just silence", () => {
    /*
     * The bug this guards against: `{rolling ? null : value}` inside a bare
     * `<p>` animates an empty box. Blur, scale and opacity on nothing paint
     * nothing — a slow connection is then a blank gap held open only by
     * `min-height`, indistinguishable from a broken button. Something must
     * actually be on screen, and it must not be a screen-reader-only node:
     * a sighted player gets nothing from text that is clipped off the page.
     */
    const { container } = render(<Falling value={743} rolling={true} />);
    const glyph = container.querySelector(".dr__number-face");
    expect(glyph).not.toBeNull();
    expect(glyph?.textContent?.trim()).not.toBe("");
  });

  it("tells a screen reader something true while it tumbles, not silence", () => {
    // A word, not a guessed number — the live region must say something
    // while the die is still in the air rather than staying mute until it
    // has an answer to report.
    render(<Falling value={743} rolling={true} />);
    expect(screen.getByText("Rolling…")).toBeTruthy();
  });

  it("is one element across the change, not two", () => {
    // Two animations fighting over one element is the bug, not the effect. The
    // element that tumbles must be the element that settles, or the motion
    // does not continue across it.
    const { container, rerender } = render(<Falling value={1_000} rolling={true} />);
    const before = container.querySelector("[data-falling]");
    rerender(<Falling value={743} rolling={false} />);
    expect(container.querySelector("[data-falling]")).toBe(before);
  });

  it("says the number for anybody who cannot see it move", () => {
    // The page must say everything it needs to without the keyframes.
    render(<Falling value={743} rolling={false} />);
    expect(screen.getByText("743").getAttribute("aria-live")).toBeTruthy();
  });
});
