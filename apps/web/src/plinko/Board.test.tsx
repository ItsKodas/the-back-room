// @vitest-environment jsdom
import { MULTS, multText } from "@backroom/game-plinko";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type Ball, Board } from "./Board.js";

afterEach(cleanup);

/**
 * Bucket labels are the viewer's own risk (design spec, "The shared board"):
 * a High player landing in the same bucket as a Low one is paid something
 * else, and the board has to say so under whichever risk *this* seat picked.
 */
describe("bucket labels", () => {
  it("read the multiplier for the viewer's own risk, and follow it when it changes", () => {
    const balls = { current: new Map<string, Ball>() };
    const { rerender } = render(<Board risk="low" balls={balls} onLand={() => {}} />);
    for (const mult of MULTS.low) {
      expect(screen.getAllByText(multText(mult)).length).toBeGreaterThan(0);
    }

    rerender(<Board risk="high" balls={balls} onLand={() => {}} />);
    for (const mult of MULTS.high) {
      expect(screen.getAllByText(multText(mult)).length).toBeGreaterThan(0);
    }
  });
});
