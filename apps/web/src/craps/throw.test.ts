import type { Roll } from "@backroom/game-craps";
import { describe, expect, it } from "vitest";
import { path } from "./throw.js";

const dice: Roll = [3, 5];

describe("a throw", () => {
  it("ends on the face the server actually rolled", () => {
    // The whole bargain. A throw that lands on anything else is a lie the
    // felt told while it was waiting.
    expect(path(dice, 0, 2_400).at(-1)?.face).toBe(3);
    expect(path(dice, 1, 2_400).at(-1)?.face).toBe(5);
  });

  it("shows no face at all while the dice are still turning", () => {
    // A readable face mid-flight is the answer, early.
    const flight = path(dice, 0, 2_400);
    expect(flight[0]?.face).toBeNull();
    expect(flight.slice(0, flight.length - 3).every((one) => one.face === null)).toBe(true);
  });

  it("comes from the shooter's rail and finishes on the felt", () => {
    const flight = path(dice, 0, 2_400);
    expect(flight[0]?.x).toBeLessThan(flight.at(-1)?.x as number);
    expect(flight.at(-1)?.at).toBe(2_400);
  });

  it("strikes the back wall and comes off it", () => {
    // A die that drifted to a stop would read as a die being placed. It has
    // to hit something and lose energy against it.
    const flight = path(dice, 0, 2_400);
    const furthest = Math.max(...flight.map((one) => one.x));
    expect(flight.at(-1)?.x).toBeLessThan(furthest);
  });

  it("settles rather than bouncing twice", () => {
    // Nothing bounces twice, nothing loops. The last stretch is monotone.
    const tail = path(dice, 0, 2_400).slice(-4);
    const turns = tail.map((one) => one.turn);
    expect(turns).toEqual([...turns].sort((a, b) => a - b));
  });

  it("throws the two dice differently", () => {
    /*
     * Two dice on identical arcs read as one object. They are thrown together
     * and they do not travel together.
     *
     * Compared on the flight alone, because the faces differ on the last two
     * samples whatever the arcs do — a whole-flight comparison can never fail,
     * which is what this test used to be.
     */
    const arc = (which: 0 | 1) => path(dice, which, 2_400).map(({ x, y, turn }) => ({ x, y, turn }));
    expect(arc(0)).not.toEqual(arc(1));

    // And on a double, where even the faces are the same.
    const pair: Roll = [4, 4];
    const both = (which: 0 | 1) => path(pair, which, 2_400);
    expect(both(0)).not.toEqual(both(1));
  });

  it("is the same throw every time it is asked for the same roll", () => {
    // Pure, so a re-render mid-flight does not restart the dice somewhere
    // else. Two animations fighting over one element is the bug.
    expect(path(dice, 0, 2_400)).toEqual(path(dice, 0, 2_400));
  });
});
