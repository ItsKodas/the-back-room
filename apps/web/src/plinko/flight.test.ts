import { ROWS, pathOf } from "@backroom/game-plinko";
import { describe, expect, it } from "vitest";
import { CHUTE_MS, type Flight, HOP_MS, SETTLE_MS, LIFT_MS, landsAt, touches, where } from "./flight.js";
import { BUCKET_Y, CHUTE_Y, bucketX, restY } from "./geometry.js";

/*
 * A ball, on a clock rather than by eye.
 *
 * On a machine talking to itself the answer lands inside a frame, so a board
 * that invented a direction would look perfect locally. These run the
 * timeline at any latency we like.
 */
const T0 = 1_000;
const unanswered: Flight = { droppedAt: T0, path: null, answeredAt: null, refusedAt: null };
const answer = (draw: number, at: number): Flight => ({ ...unanswered, path: pathOf(draw), answeredAt: at });

describe("a ball with no answer yet", () => {
  it("never goes past the top peg, however long it waits", () => {
    for (let now = T0; now <= T0 + 10_000; now += 16) {
      const at = where(unanswered, now);
      expect(at.y, `at ${now - T0}ms`).toBeLessThanOrEqual(restY(0) + 1e-9);
      expect(["chute", "waiting"]).toContain(at.phase);
      expect(Math.abs(at.x)).toBeLessThan(0.1);
    }
  });

  it("reaches the top peg on its own, because every path starts there", () => {
    expect(where(unanswered, T0 + CHUTE_MS).y).toBeCloseTo(restY(0));
    expect(where(unanswered, T0).y).toBeCloseTo(CHUTE_Y);
  });
});

describe("a ball with its answer", () => {
  it("holds on the peg until the answer, then falls", () => {
    const slow = answer(4095, T0 + 2_000);
    expect(where(slow, T0 + 1_999).phase).toBe("waiting");
    expect(where(slow, T0 + 2_001).phase).toBe("falling");
  });

  it("finishes the drop to the peg first, however fast the answer", () => {
    const fast = answer(4095, T0 + 40);
    expect(where(fast, T0 + 200).phase).toBe("chute");
    expect(where(fast, T0 + CHUTE_MS + 1).phase).toBe("falling");
  });

  it("lands in its bucket and then goes", () => {
    const f = answer(0b111000000000, T0 + 100);
    const end = landsAt(f) as number;
    const at = where(f, end);
    expect(at).toMatchObject({ x: bucketX(3), y: BUCKET_Y, phase: "landed" });
    expect(where(f, end + SETTLE_MS).phase).toBe("gone");
  });

  it("is one motion: no jump anywhere between the chute and the bucket", () => {
    for (const draw of [0, 4095, 1365, 2730]) {
      const f = answer(draw, T0 + 700);
      let last = where(f, T0);
      for (let now = T0 + 1; now <= (landsAt(f) as number); now += 1) {
        const at = where(f, now);
        const step = Math.hypot(at.x - last.x, at.y - last.y);
        expect(step, `${draw} at ${now - T0}ms`).toBeLessThan(0.08);
        last = at;
      }
    }
  });

  it("touches each row's peg once, in order, and then the bucket", () => {
    const f = answer(2730, T0 + 300);
    const rows: number[] = [];
    for (let now = T0; now <= (landsAt(f) as number) + 16; now += 16) {
      rows.push(...touches(f, now - 16, now));
    }
    expect(rows).toEqual(Array.from({ length: ROWS + 1 }, (_, row) => row));
  });
});

describe("a ball the table turned down", () => {
  it("goes back up the chute and away", () => {
    const f: Flight = { ...unanswered, refusedAt: T0 + 600 };
    expect(where(f, T0 + 600).y).toBeCloseTo(restY(0));
    expect(where(f, T0 + 600 + LIFT_MS / 2).phase).toBe("lifting");
    expect(where(f, T0 + 600 + LIFT_MS).phase).toBe("gone");
  });

  it("does not touch a peg it never reached", () => {
    const f: Flight = { ...unanswered, refusedAt: T0 + 100 };
    expect(touches(f, T0, T0 + 1_000)).toEqual([]);
  });
});

describe("with motion reduced", () => {
  it("does not fall: it is in its bucket the moment the answer is in", () => {
    const f: Flight = { ...answer(0, T0 + 300), still: true };
    expect(where(f, T0 + 10).phase).toBe("waiting");
    expect(where(f, T0 + 300)).toMatchObject({ phase: "landed", x: bucketX(0) });
    expect(touches(f, T0, T0 + 400)).toEqual([ROWS]);
  });
});

it("hops at a pace a person can follow", () => {
  expect(HOP_MS).toBeGreaterThanOrEqual(90);
});
