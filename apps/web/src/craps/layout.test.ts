import { SPOTS, spotAt } from "@backroom/game-craps";
import { describe, expect, it } from "vitest";
import { type Box, boxFor, slot, TALL, WIDE } from "./layout.js";

const arrangements = [
  { name: "wide", cloth: WIDE },
  { name: "tall", cloth: TALL },
];

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe.each(arrangements)("the $name cloth", ({ cloth }) => {
  it("gives every bet a player can press a box of its own", () => {
    const pressable = [...SPOTS.values()].filter(
      (one) => !one.derived && one.kind !== "odds",
    );
    const drawn = new Set(cloth.boxes.map((one) => one.id));
    for (const one of pressable) expect(drawn, one.id).toContain(one.id);
    expect(cloth.boxes).toHaveLength(pressable.length);
  });

  it("never lets two boxes overlap", () => {
    // An overlap is a press that lands on whichever box happens to be drawn
    // last, which is a bet the player did not make.
    for (let a = 0; a < cloth.boxes.length; a += 1) {
      for (let b = a + 1; b < cloth.boxes.length; b += 1) {
        const one = cloth.boxes[a] as Box;
        const two = cloth.boxes[b] as Box;
        expect(overlap(one, two), `${one.id} over ${two.id}`).toBe(false);
      }
    }
  });

  it("keeps every box inside the grid", () => {
    for (const one of cloth.boxes) {
      expect(one.x).toBeGreaterThanOrEqual(0);
      expect(one.y).toBeGreaterThanOrEqual(0);
      expect(one.x + one.w).toBeLessThanOrEqual(cloth.cols);
      expect(one.y + one.h).toBeLessThanOrEqual(cloth.rows);
    }
  });
});

describe("the tall cloth is the one that has to survive a thumb", () => {
  it("gives every box at least forty-four pixels at 375 wide", () => {
    // The building's floor for anything you have to hit during a hand. The
    // grid is in units, so this is arithmetic rather than a screenshot.
    const gutters = 32;
    const unit = (375 - gutters) / TALL.cols;
    for (const one of TALL.boxes) {
      expect(one.w * unit, `${one.id} across`).toBeGreaterThanOrEqual(44);
      // Rows are squarer than columns; the cloth scales height to width.
      expect(one.h * unit, `${one.id} down`).toBeGreaterThanOrEqual(44);
    }
  });
});

describe("where a bet's chips are drawn", () => {
  it("sends every spot to a box that exists", () => {
    const drawn = new Set(WIDE.boxes.map((one) => one.id));
    for (const one of SPOTS.values()) {
      const box = boxFor(one.id);
      expect(box, one.id).not.toBeNull();
      expect(drawn, one.id).toContain(box as string);
    }
  });

  it("puts a travelled come bet in its number's box, where a real table puts it", () => {
    expect(boxFor("come:6")).toBe("place:6");
    expect(boxFor("dontcome:6")).toBe("place:6");
    expect(boxFor("odds:come:6")).toBe("place:6");
  });

  it("puts odds behind the bet they back", () => {
    expect(boxFor("odds:pass")).toBe("pass");
    expect(boxFor("odds:dontpass")).toBe("dontpass");
  });

  it("keeps the five stacks that can share a box apart", () => {
    // The six's box can hold a place bet, a come bet, a don't come bet and
    // odds on either. Five stacks in one box, and any two sharing a slot
    // would draw on top of each other.
    const sharing = ["place:6", "come:6", "dontcome:6", "odds:come:6", "odds:dontcome:6"];
    expect(new Set(sharing.map(slot)).size).toBe(sharing.length);
  });

  it("never sends a spot somewhere the game does not know about", () => {
    for (const one of SPOTS.values()) expect(spotAt(one.id)).not.toBeNull();
  });
});
