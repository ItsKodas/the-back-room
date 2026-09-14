import { describe, expect, it } from "vitest";
import { decide, thinkingTime } from "./bot.js";

const at = (ceiling: number, skill: "easy" | "normal" | "hard", canPass = true) =>
  decide({ skill, ceiling, ante: 500, price: 50, canPass });

describe("when a bot spends its pass", () => {
  it("never spends it at the top of a duel, however good it is", () => {
    expect(at(1_000, "hard")).toBe("roll");
    expect(at(50, "hard")).toBe("roll");
  });

  it("spends it at the true break-even when it plays well", () => {
    // Ceiling eight is where passing turns +EV at a tenth of the ante. A hard
    // bot knows exactly that, which is the only thing that makes it hard.
    expect(at(9, "hard")).toBe("roll");
    expect(at(8, "hard")).toBe("pass");
  });

  it("waits longer than it should when it plays middling", () => {
    expect(at(8, "normal")).toBe("roll");
    expect(at(5, "normal")).toBe("pass");
  });

  it("never spends it at all when it plays badly", () => {
    // An easy bot simply rolls. It is not a bad decision-maker, it is a player
    // who has not noticed there is a decision — which is the more human of the
    // two ways to be bad at this.
    expect(at(2, "easy")).toBe("roll");
  });

  it("rolls when the pass is already gone", () => {
    expect(at(2, "hard", false)).toBe("roll");
  });
});

describe("how long a bot pretends to think", () => {
  it("takes a beat, and a shorter one the better it plays", () => {
    for (const skill of ["easy", "normal", "hard"] as const) {
      expect(thinkingTime(skill)).toBeGreaterThan(0);
      expect(thinkingTime(skill)).toBeLessThan(4_000);
    }
    expect(thinkingTime("hard")).toBeLessThan(thinkingTime("easy"));
  });
});
