import { describe, expect, it } from "vitest";
import { FLIGHT, SPIN, WOBBLE, easing, height, landings, rattle } from "./toss.js";

describe("the arc", () => {
  it("starts and ends on the felt", () => {
    expect(height(0)).toBeCloseTo(0, 6);
    expect(height(1)).toBeCloseTo(0, 6);
  });

  it("peaks in the middle", () => {
    expect(height(0.5)).toBeCloseTo(1, 6);
  });

  it("hangs at the top", () => {
    /*
     * The whole feeling of a toss. A coin spends far more of its flight near
     * the apex than near the felt, and an arc that did not would read as a
     * coin on a piece of elastic.
     */
    expect(height(0.35)).toBeGreaterThan(0.8);
    expect(height(0.65)).toBeGreaterThan(0.8);
    expect(height(0.1)).toBeLessThan(0.4);
  });

  it("is symmetrical, because gravity is", () => {
    for (const t of [0.1, 0.25, 0.4]) {
      expect(height(t)).toBeCloseTo(height(1 - t), 6);
    }
  });
});

describe("the profiles as CSS", () => {
  it("writes a linear() easing that starts at nought and ends at one", () => {
    for (const profile of [FLIGHT, SPIN, WOBBLE]) {
      const css = easing(profile);
      expect(css.startsWith("linear(0,")).toBe(true);
      expect(css.endsWith(", 1)")).toBe(true);
    }
  });

  it("never goes backwards", () => {
    /*
     * A linear() whose values are not monotonic is an animation that stutters
     * backwards, which no amount of looking at it will explain.
     */
    for (const profile of [FLIGHT, SPIN, WOBBLE]) {
      const values = easing(profile)
        .slice("linear(".length, -1)
        .split(",")
        .map((piece) => Number(piece.trim().split(" ")[0]));
      for (let at = 1; at < values.length; at += 1) {
        expect(values[at]).toBeGreaterThanOrEqual(values[at - 1] as number);
      }
    }
  });
});

describe("a coin does not slow down in the air", () => {
  it("keeps almost all its spin until it lands", () => {
    /*
     * The detail most coin animations get wrong. Nothing decelerates a
     * tumbling coin between the kip and the felt, so easing the rotation out
     * is what makes an animation of one look like a prop rather than a coin.
     */
    const css = easing(SPIN);
    const half = Number(
      css
        .slice("linear(".length, -1)
        .split(",")
        .map((piece) => piece.trim())
        .find((piece) => piece.endsWith("50%"))
        ?.split(" ")[0] ?? "0",
    );
    expect(half).toBeGreaterThan(0.45);
    expect(half).toBeLessThan(0.55);
  });
});

describe("two coins landing", () => {
  it("lands them apart, so it is two objects and not one", () => {
    const [first, second] = landings(0.06);
    expect(second - first).toBeCloseTo(0.06, 6);
    expect(first).toBeLessThan(1);
    /*
     * The second coin lands at exactly the end, not merely by the end. The
     * flight's length is what the table waits, so the last coin down has to be
     * the last thing that happens — and `<= 1` would pass just as happily on a
     * pair that both landed early and left the table listening to silence.
     */
    expect(second).toBeCloseTo(1, 6);
  });
});

describe("the rattle", () => {
  it("speeds up as it dies, the way a settling coin does", () => {
    /*
     * Counter-intuitive and the reason this is derived rather than tapped out
     * by hand: a disc coming to rest precesses faster and faster as it goes
     * flatter, which is the sound everybody recognises and nobody predicts.
     */
    const times = rattle();
    expect(times.length).toBeGreaterThan(8);
    const first = (times[1] as number) - (times[0] as number);
    const last = (times[times.length - 1] as number) - (times[times.length - 2] as number);
    expect(last).toBeLessThan(first / 2);
  });

  it("stays inside the wobble it belongs to", () => {
    for (const t of rattle()) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });
});
