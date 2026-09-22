import { describe, expect, it } from "vitest";
import type { Rank } from "./cards.js";
import { coupFrom } from "./coup.js";
import { HOLD, schedule, TURN_BANKER, TURN_PLAYER } from "./schedule.js";

const shoe = (...ranks: Rank[]) => ranks.map((rank) => ({ rank, suit: "spades" as const }));

/** Player 4+5 = 9. A natural, so neither side draws. */
const NATURAL = coupFrom(shoe("4", "3", "5", "2"));
/** Player 2+3 = 5 draws a 6; banker 2+2 = 4 against a 6 draws. Both third cards. */
const BOTH = coupFrom(shoe("2", "2", "3", "2", "6", "5"));
/** Player 2+4 = 6 stands; banker 2+3 = 5 draws. Banker's third only. */
const BANKER_ONLY = coupFrom(shoe("2", "2", "4", "3", "9"));
/** Player 2+3 = 5 draws a 5; banker 3+4 = 7 stands. The player's third only. */
const PLAYER_ONLY = coupFrom(shoe("2", "3", "3", "4", "5"));

describe("the reveal schedule", () => {
  it("has one entry per card actually dealt", () => {
    expect(schedule(NATURAL).cards).toHaveLength(4);
    expect(schedule(BOTH).cards).toHaveLength(6);
    expect(schedule(BANKER_ONLY).cards).toHaveLength(5);
    expect(schedule(PLAYER_ONLY).cards).toHaveLength(5);
  });

  it("deals the opening four alternately, player first", () => {
    const opening = schedule(BOTH).cards.slice(0, 4);
    expect(opening.map((one) => one.side)).toEqual(["player", "banker", "player", "banker"]);
    expect(opening.map((one) => one.index)).toEqual([0, 0, 1, 1]);
  });

  it("staggers the opening four and turns each pair together", () => {
    const opening = schedule(NATURAL).cards;
    expect(opening.map((one) => one.outAt)).toEqual([0, 320, 640, 960]);
    // A pair turns as a pair: both the player's cards at once, then both the
    // banker's. Turning them one at a time reads as four separate answers.
    expect(opening.filter((one) => one.side === "player").map((one) => one.turnAt)).toEqual([
      TURN_PLAYER,
      TURN_PLAYER,
    ]);
    expect(opening.filter((one) => one.side === "banker").map((one) => one.turnAt)).toEqual([
      TURN_BANKER,
      TURN_BANKER,
    ]);
  });

  it("never turns a card before it has been dealt", () => {
    for (const coup of [NATURAL, BOTH, BANKER_ONLY, PLAYER_ONLY]) {
      for (const one of schedule(coup).cards) {
        expect(one.turnAt).toBeGreaterThan(one.outAt);
      }
    }
  });

  it("deals every card in order", () => {
    for (const coup of [NATURAL, BOTH, BANKER_ONLY, PLAYER_ONLY]) {
      const out = schedule(coup).cards.map((one) => one.outAt);
      expect([...out].sort((a, b) => a - b), JSON.stringify(out)).toEqual(out);
    }
  });

  it("holds after the last card and then is over", () => {
    for (const coup of [NATURAL, BOTH, BANKER_ONLY, PLAYER_ONLY]) {
      const made = schedule(coup);
      const last = Math.max(...made.cards.map((one) => one.turnAt));
      expect(made.total).toBe(last + HOLD);
    }
  });

  /*
   * A natural is over quickly and a full tableau takes its time. A fixed phase
   * length would pad the first, which is a table waiting for nothing while
   * everybody looks at a finished coup.
   */
  it("finishes a natural sooner than a full tableau", () => {
    expect(schedule(NATURAL).total).toBeLessThan(schedule(BOTH).total);
    expect(schedule(BANKER_ONLY).total).toBeLessThan(schedule(BOTH).total);
  });

  it("brings the banker's third card forward when the player stood", () => {
    const alone = schedule(BANKER_ONLY).cards.at(-1);
    const after = schedule(BOTH).cards.at(-1);
    expect(alone?.side).toBe("banker");
    expect(after?.side).toBe("banker");
    expect(alone?.outAt).toBeLessThan(after?.outAt as number);
  });

  /*
   * The shape where the player's third card is the last thing dealt. Its turn
   * is what the hold runs from, which is the one case where the banker's pair
   * is not the last thing to move before the coup settles.
   */
  it("holds from the player's third when the banker stands", () => {
    const made = schedule(PLAYER_ONLY);
    const third = made.cards.at(-1);
    expect(third?.side).toBe("player");
    expect(third?.index).toBe(2);
    expect(made.total).toBe(third?.turnAt as number + HOLD);
    expect(made.total).toBeLessThan(schedule(BOTH).total);
  });
});
