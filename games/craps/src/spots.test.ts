import { describe, expect, it } from "vitest";
import { POINTS, SPOTS, spotAt, oddsFor } from "./spots.js";

const all = () => [...SPOTS.values()];

describe("the cloth", () => {
  it("names every spot once, and only by its id", () => {
    for (const [id, spot] of SPOTS) expect(spot.id).toBe(id);
    expect(new Set(all().map((one) => one.label)).size).toBe(all().length);
  });

  it("knows nothing that is not a spot", () => {
    // The whole safety property: a client says "place craps:hard8" and a
    // message naming a bet nobody can make looks nothing up and buys nothing.
    expect(spotAt("hard:8")).not.toBeNull();
    expect(spotAt("hard:7")).toBeNull();
    expect(spotAt("")).toBeNull();
    expect(spotAt("__proto__")).toBeNull();
  });

  it("has the six points and no others", () => {
    expect([...POINTS]).toEqual([4, 5, 6, 8, 9, 10]);
    expect(POINTS).not.toContain(7);
  });

  it("carries a travelled spot for every number a come bet can reach", () => {
    for (const point of POINTS) {
      expect(spotAt(`come:${point}`)?.derived).toBe(true);
      expect(spotAt(`dontcome:${point}`)?.derived).toBe(true);
    }
  });

  it("carries odds behind every line bet that can have a number", () => {
    expect(oddsFor("pass")).toBe("odds:pass");
    expect(oddsFor("dontpass")).toBe("odds:dontpass");
    expect(oddsFor("come:6")).toBe("odds:come:6");
    expect(oddsFor("dontcome:10")).toBe("odds:dontcome:10");
    // The come box itself has no number yet, so there is nothing to back.
    expect(oddsFor("come")).toBeNull();
    expect(oddsFor("place:6")).toBeNull();
    for (const id of ["odds:pass", "odds:dontpass", ...POINTS.flatMap((p) => [`odds:come:${p}`, `odds:dontcome:${p}`])]) {
      expect(spotAt(id)?.kind).toBe("odds");
    }
  });

  it("marks the dark side, because it wins where the light side loses", () => {
    for (const id of ["dontpass", "dontcome", "odds:dontpass"]) {
      expect(spotAt(id)?.dark).toBe(true);
    }
    for (const id of ["pass", "come", "place:6", "field", "any7"]) {
      expect(spotAt(id)?.dark).toBe(false);
    }
  });

  it("lets a player press only the spots that are theirs to press", () => {
    // Derived spots are where the table puts chips, never where a player does.
    const pressable = all().filter((one) => !one.derived);
    for (const one of pressable) expect(one.id.startsWith("come:")).toBe(false);
    expect(all().filter((one) => one.derived)).toHaveLength(12);
  });
});
