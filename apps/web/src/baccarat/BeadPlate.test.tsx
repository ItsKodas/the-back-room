// @vitest-environment jsdom
import type { Outcome } from "@backroom/game-baccarat";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BeadPlate } from "./BeadPlate.js";

afterEach(cleanup);

/**
 * The bead plate is honest decoration — see BeadPlate.tsx — but decoration
 * still has to be correct: every result drawn once, the three outcomes told
 * apart, and the thing legible to somebody who cannot see the colours at all.
 */
describe("the bead plate", () => {
  it("draws a mark for every result, newest last", () => {
    const outcomes: Outcome[] = ["player", "banker", "player", "tie"];
    const { container } = render(<BeadPlate outcomes={outcomes} />);
    const marks = container.querySelectorAll(".bc__bead");
    expect(marks).toHaveLength(4);
    const latest = marks[marks.length - 1] as HTMLElement;
    expect(latest.classList.contains("bc__bead--latest")).toBe(true);
    expect(latest.classList.contains("bc__bead--tie")).toBe(true);
  });

  it("colours the three outcomes apart", () => {
    const { container } = render(<BeadPlate outcomes={["player", "banker", "tie"]} />);
    const player = container.querySelector(".bc__bead--player");
    const banker = container.querySelector(".bc__bead--banker");
    const tie = container.querySelector(".bc__bead--tie");
    expect(player).not.toBeNull();
    expect(banker).not.toBeNull();
    expect(tie).not.toBeNull();
    // Three genuinely distinct classes, not one mark styled three ways.
    expect(player?.className).not.toBe(banker?.className);
    expect(banker?.className).not.toBe(tie?.className);
    expect(player?.className).not.toBe(tie?.className);
  });

  it("says what it is to somebody who cannot see it", () => {
    // Each mark carries its outcome as text for a screen reader; a grid of
    // coloured dots is not a board to somebody reading it aloud.
    const { container } = render(<BeadPlate outcomes={["player", "banker", "tie"]} />);
    expect(container.querySelector('[aria-label="Player"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Banker"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Tie"]')).not.toBeNull();
  });

  it("fills six rows before starting a new column", () => {
    // The seventh result belongs to a new column rather than a seventh row —
    // that ordering is the entire reason this is columns of cells rather than
    // one flat strip.
    const outcomes: Outcome[] = Array.from({ length: 7 }, (_, i) =>
      i === 6 ? "tie" : "player",
    ) as Outcome[];
    const { container } = render(<BeadPlate outcomes={outcomes} />);
    const columns = container.querySelectorAll(".bc__bead-col");
    expect(columns).toHaveLength(2);
    expect(columns[0]?.querySelectorAll(".bc__bead")).toHaveLength(6);
    expect(columns[1]?.querySelectorAll(".bc__bead")).toHaveLength(1);
  });
});
