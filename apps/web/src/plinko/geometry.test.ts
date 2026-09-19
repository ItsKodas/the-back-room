import { ROWS, pathOf } from "@backroom/game-plinko";
import { describe, expect, it } from "vitest";
import { xOnRow } from "./flight.js";
import { VIEW, bucketX, pegXs } from "./geometry.js";

describe("the board's shape", () => {
  it("puts a peg under the ball on every row of every path", () => {
    // A ball drawn between pegs is a board that does not add up.
    for (const draw of [0, 1, 2048, 1365, 2730, 4095]) {
      const path = pathOf(draw);
      for (let row = 0; row < ROWS; row += 1) {
        expect(pegXs(row), `${draw} row ${row}`).toContain(xOnRow(path, row));
      }
    }
  });

  it("drops every ball into the middle of its own bucket", () => {
    const path = pathOf(4095);
    expect(xOnRow(path, ROWS)).toBe(bucketX(12));
    expect(bucketX(0)).toBe(-6);
  });

  it("fits the widest row inside the view", () => {
    const widest = pegXs(ROWS - 1);
    expect(Math.min(...widest)).toBeGreaterThan(VIEW.x);
    expect(Math.max(...widest)).toBeLessThan(VIEW.x + VIEW.w);
  });
});
