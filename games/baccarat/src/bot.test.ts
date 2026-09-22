import { describe, expect, it } from "vitest";
import { botBet, thinkingTime } from "./bot.js";

/** A counter that cycles, so a bot's choices can be pinned down. */
function sequence(values: readonly number[]): () => number {
  let at = 0;
  return () => values[at++ % values.length] as number;
}

describe("what a bot bets", () => {
  it("puts a chip on one of the three spots", () => {
    const bet = botBet("normal", 0, 25_000, sequence([0.1, 0.5]));
    expect(bet).not.toBeNull();
    expect(["player", "banker", "tie"]).toContain(bet?.spotId);
  });

  it("stops once it has had its go this window", () => {
    // A bot that put its whole evening down at once would bury the cloth
    // before anybody else had looked at it.
    expect(botBet("easy", 1, 25_000)).toBeNull();
    expect(botBet("normal", 2, 25_000)).toBeNull();
    expect(botBet("hard", 3, 25_000)).toBeNull();
  });

  it("never bets more than its purse holds", () => {
    for (let purse = 0; purse <= 200; purse += 5) {
      const bet = botBet("hard", 0, purse, sequence([0.9, 0.9, 0.9]));
      if (bet !== null) {
        expect(bet.chips, `${purse}`).toBeLessThanOrEqual(purse);
      }
    }
  });

  it("bets nothing at all on an empty purse", () => {
    expect(botBet("normal", 0, 0)).toBeNull();
    expect(botBet("normal", 0, 10)).toBeNull();
  });

  it("mostly leaves the tie alone", () => {
    /*
     * The tie is a fourteen per cent bet and a bot that lived on it would look
     * like a machine losing on purpose. It plays it occasionally, the way
     * somebody at a table does.
     */
    let ties = 0;
    for (let at = 0; at < 300; at += 1) {
      const bet = botBet("normal", 0, 25_000, sequence([at / 300, 0.5]));
      if (bet?.spotId === "tie") {
        ties += 1;
      }
    }
    expect(ties).toBeGreaterThan(0);
    expect(ties).toBeLessThan(120);
  });
});

describe("how long a bot thinks", () => {
  it("takes a beat, and never longer than a short window", () => {
    expect(thinkingTime(() => 0)).toBeGreaterThanOrEqual(700);
    expect(thinkingTime(() => 0.999)).toBeLessThan(2_600);
  });
});
