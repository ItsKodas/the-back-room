import { describe, expect, it } from "vitest";
import { botBet, thinkingTime } from "./bot.js";

describe("a bot at a for-fun ring", () => {
  it("puts something down when it has chips and nothing yet", () => {
    const bet = botBet("normal", 0, 5_000);
    expect(bet).not.toBeNull();
    expect(bet?.chips).toBeGreaterThanOrEqual(25);
    expect(bet?.chips).toBeLessThanOrEqual(5_000);
  });

  it("stops rather than burying the cloth", () => {
    // A bot that put its whole evening down at once would bury the felt before
    // anybody else had looked at it.
    expect(botBet("normal", 3, 5_000)).toBeNull();
  });

  it("puts nothing down it cannot pay for", () => {
    expect(botBet("normal", 0, 0)).toBeNull();
    expect(botBet("normal", 0, 10)).toBeNull();
  });

  it("takes a moment to think, but not a long one", () => {
    for (let at = 0; at < 200; at += 1) {
      const ms = thinkingTime();
      expect(ms).toBeGreaterThanOrEqual(400);
      expect(ms).toBeLessThanOrEqual(2_600);
    }
  });
});
