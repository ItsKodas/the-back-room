import { describe, expect, it } from "vitest";
import { act, decide } from "./bot.js";
import { CardMaker } from "./cards.js";
import { Game, UnoError } from "./engine.js";
import { card, num, seeded, stage } from "./fixtures.js";
import type { Rules } from "./rules.js";
import { officialRules, RULES } from "./rules.js";

const game = (players = 3, rules: Partial<Rules> = {}, seed = 1) => {
  const g = new Game({
    players: Array.from({ length: players }, (_, i) => `P${i}`),
    rules: { ...officialRules(), ...rules },
    rng: seeded(seed),
    dealer: players - 1,
  });
  g.startRound();
  return g;
};

describe("the deck", () => {
  it("is the standard 108, every id different", () => {
    const deck = new CardMaker().deck();
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((one) => one.id)).size).toBe(108);
    expect(deck.filter((one) => one.type === "wild4")).toHaveLength(4);
    expect(deck.filter((one) => one.type === "number" && one.value === 0)).toHaveLength(4);
  });

  it("counts its ids per game, so one table's deal says nothing about another's", () => {
    const a = new CardMaker().deck();
    const b = new CardMaker().deck();
    expect(a.map((one) => one.id)).toEqual(b.map((one) => one.id));
  });
});

describe("a deal", () => {
  it("gives everybody the starting hand and never opens on a Draw Four", () => {
    for (let seed = 1; seed < 60; seed += 1) {
      const g = game(4, {}, seed);
      for (const player of g.players) {
        // A Draw Two flipped first hands the first player two more.
        expect([7, 9]).toContain(player.hand.length);
      }
      expect(g.top()?.type).not.toBe("wild4");
      expect(g.totalCards).toBe(108);
    }
  });

  it("deals the host's hand size", () => {
    const g = game(3, { handSize: 4 });
    expect(g.players.filter((one) => one.hand.length === 4).length).toBeGreaterThanOrEqual(2);
  });
});

describe("a turn", () => {
  it("takes a card that matches by colour or by symbol, and refuses one that does not", () => {
    const g = game(3);
    const red7 = num("red", 7);
    const blue7 = num("blue", 7);
    const green2 = num("green", 2);
    stage(g, { hands: [[red7, blue7, green2], [num("red", 1)], [num("red", 2)]], top: num("red", 3) });
    expect(() => g.playCard(0, green2.id)).toThrow(UnoError);
    g.playCard(0, red7.id);
    expect(g.current).toBe(1);
    // Now a seven on a seven, by symbol, from somebody else.
    stage(g, { hands: [[red7], [blue7, num("green", 4)], [num("red", 2)]], top: num("red", 7), current: 1 });
    g.playCard(1, blue7.id);
    expect(g.currentColor).toBe("blue");
  });

  it("refuses a card out of turn when jump-in is off", () => {
    const g = game(3);
    const red3 = num("red", 3);
    stage(g, { hands: [[num("blue", 1)], [red3, num("blue", 9)], [num("red", 2)]], top: num("red", 3) });
    expect(() => g.playCard(1, red3.id)).toThrow("jump in");
  });

  it("lets an identical card jump in when the house rule is on, and play carries on from there", () => {
    const g = game(3, { jumpIn: true });
    const red3 = num("red", 3);
    stage(g, { hands: [[num("blue", 1), num("blue", 2)], [red3, num("blue", 9)], [num("red", 2), num("red", 4)]], top: num("red", 3) });
    g.playCard(1, red3.id);
    expect(g.top()?.id).toBe(red3.id);
    expect(g.current).toBe(2);
  });

  it("makes Reverse a Skip with two at the table", () => {
    const g = game(2);
    const rev = card("red", "reverse");
    stage(g, { hands: [[rev, num("red", 1)], [num("blue", 1)]], top: num("red", 3) });
    g.playCard(0, rev.id);
    expect(g.current).toBe(0);
  });

  it("only lets the drawn card be played after a draw", () => {
    const g = game(2);
    const keep = num("red", 5);
    stage(g, { hands: [[keep, num("blue", 1)], [num("blue", 2)]], top: num("red", 3) });
    g.drawPile.push(num("red", 9));
    g.drawCard(0);
    expect(g.phase).toBe("postDraw");
    expect(() => g.playCard(0, keep.id)).toThrow(UnoError);
    g.pass(0);
    expect(g.current).toBe(1);
  });
});

describe("Wild Draw Four", () => {
  const setup = (holdsColour: boolean) => {
    const g = game(3);
    const wd4 = card("wild", "wild4");
    const hand = holdsColour ? [wd4, num("red", 1), num("blue", 2)] : [wd4, num("blue", 1), num("blue", 2)];
    stage(g, { hands: [hand, [num("green", 1)], [num("green", 2)]], top: num("red", 3) });
    g.playCard(0, wd4.id, { color: "blue" });
    return g;
  };

  it("waits for the next player to challenge or take it", () => {
    const g = setup(false);
    expect(g.phase).toBe("challenge");
    expect(g.current).toBe(1);
  });

  it("costs a bluffer four when they are caught", () => {
    const g = setup(true);
    const before = g.players[0]?.hand.length ?? 0;
    g.respondChallenge(1, true);
    expect(g.players[0]?.hand.length).toBe(before + 4);
    expect(g.players[1]?.hand.length).toBe(1);
  });

  it("costs the challenger six when it was played honestly", () => {
    const g = setup(false);
    g.respondChallenge(1, true);
    expect(g.players[1]?.hand.length).toBe(7);
    expect(g.current).toBe(2);
  });

  it("cannot be bluffed at all under the enforced rule", () => {
    const g = game(3, { wd4Rule: "strict" });
    const wd4 = card("wild", "wild4");
    stage(g, { hands: [[wd4, num("red", 1)], [num("green", 1)], [num("green", 2)]], top: num("red", 3) });
    expect(() => g.playCard(0, wd4.id, { color: "blue" })).toThrow(UnoError);
  });
});

describe("UNO", () => {
  it("can be caught when it is not called, and costs the penalty", () => {
    const g = game(3);
    const last = num("red", 1);
    stage(g, { hands: [[last, num("red", 2)], [num("green", 1)], [num("green", 2)]], top: num("red", 3) });
    g.playCard(0, last.id);
    expect(g.unoVulnerable).toBe(0);
    g.callUno(2, 0);
    expect(g.players[0]?.hand.length).toBe(3);
  });

  it("cannot be caught once called with the card", () => {
    const g = game(3);
    const last = num("red", 1);
    stage(g, { hands: [[last, num("red", 2)], [num("green", 1)], [num("green", 2)]], top: num("red", 3) });
    g.playCard(0, last.id, { declareUno: true });
    expect(g.unoVulnerable).toBe(null);
    expect(() => g.callUno(2, 0)).toThrow(UnoError);
  });

  it("closes the window once the next player acts", () => {
    const g = game(3);
    const last = num("red", 1);
    stage(g, { hands: [[last, num("red", 2)], [num("red", 5), num("red", 6)], [num("green", 2)]], top: num("red", 3) });
    g.playCard(0, last.id);
    g.drawCard(1);
    expect(() => g.callUno(2, 0)).toThrow(UnoError);
  });
});

describe("stacking", () => {
  it("passes a Draw Two on with a Draw Four when mixed", () => {
    const g = game(3, { stacking: "mixed", wd4Rule: "free" });
    const d2 = card("red", "draw2");
    const wd4 = card("wild", "wild4");
    stage(g, { hands: [[d2, num("red", 1)], [wd4, num("red", 2)], [num("green", 2)]], top: num("red", 3) });
    g.playCard(0, d2.id);
    expect(g.pendingDraw).toBe(2);
    g.playCard(1, wd4.id, { color: "green" });
    // Player 2 holds nothing to stack with, so takes the lot at once.
    expect(g.players[2]?.hand.length).toBe(7);
    expect(g.pendingDraw).toBe(0);
  });
});

describe("a round's end", () => {
  it("scores the cards left in everybody else's hands to the winner", () => {
    const g = game(3);
    const last = num("red", 1);
    stage(g, {
      hands: [[last], [num("green", 9), card("wild", "wild")], [card("blue", "skip")]],
      top: num("red", 3),
    });
    g.players[0].unoDeclared = true;
    g.playCard(0, last.id);
    expect(g.lastRound?.gained).toEqual([9 + 50 + 20, 0, 0]);
    expect(g.phase).toBe("roundOver");
  });

  it("ends the game on a single round when the host asks for one", () => {
    const g = game(2, { gameMode: "single" });
    const last = num("red", 1);
    stage(g, { hands: [[last], [num("green", 9)]], top: num("red", 3) });
    g.playCard(0, last.id);
    expect(g.over).toBe(true);
    expect(g.champion).toBe(0);
  });
});

/**
 * Every rule switched on and off at random, a few hundred games of bots.
 *
 * The tabletop shipped a page that did this in a browser. What it checked is
 * what is checked here: no card is ever lost or made except by a rule that
 * makes one, and no game ever gets stuck with nobody able to move.
 */
describe("hundreds of games under random rules", () => {
  it("never loses a card and never gets stuck", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 250; seed += 1) {
      const rng = seeded(seed);
      const rules: Record<string, unknown> = {};
      for (const rule of RULES) {
        if (rule.type === "bool") rules[rule.id] = rng() < 0.5;
        if (rule.type === "select") rules[rule.id] = rule.options[Math.floor(rng() * rule.options.length)]?.value;
      }
      rules["gameMode"] = "single";
      const players = 2 + Math.floor(rng() * 9);
      const g = new Game({ players: Array.from({ length: players }, (_, i) => `B${i}`), rules, rng });
      g.startRound();
      const total = () => g.totalCards - g.createdCards;
      const start = total();
      let steps = 0;
      while (!g.over && steps < 5_000) {
        steps += 1;
        if (g.turnTimeLimit !== null && rng() < 0.1) {
          g.timeout(g.current);
        } else {
          const choice = decide(g, g.current, (["easy", "normal", "hard"] as const)[steps % 3] ?? "normal", rng);
          if (choice === null) {
            failures.push(`seed ${seed}: nobody can move in ${g.phase}`);
            break;
          }
          act(g, g.current, choice);
        }
        if (g.unoVulnerable !== null && rng() < 0.3) {
          const caller = (g.unoVulnerable + 1) % players;
          g.callUno(caller, g.unoVulnerable);
        }
        if (total() !== start) {
          failures.push(`seed ${seed}: ${start} cards became ${total()} after step ${steps}`);
          break;
        }
      }
      if (!g.over) {
        failures.push(`seed ${seed}: still going after ${steps} steps`);
      }
    }
    expect(failures).toEqual([]);
  });
});
