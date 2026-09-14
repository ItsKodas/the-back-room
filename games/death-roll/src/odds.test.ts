import { describe, expect, it } from "vitest";
import { EXACT_CEILING, lossOdds, passMargin, solveRound } from "./odds.js";

/** The price the game charges: a tenth of the ante, whatever the ante. */
const shipped = (players: number) => passMargin(players, 10, 1);
/** The normal bot values surviving at less than it is worth. */
const wary = (players: number) => shipped(players) * 2.5;

/** No passes at all: the chance each seat after the roller goes out, by brute force. */
function noPass(players: number, top: number): number[][] {
  const table: number[][] = [[], Array.from({ length: players }, (_, j) => (j === 0 ? 1 : 0))];
  const prefix = Array.from({ length: players }, () => 0);
  for (let n = 2; n <= top; n += 1) {
    let current = Array.from({ length: players }, () => 1 / players);
    for (let sweep = 0; sweep < 400; sweep += 1) {
      current = current.map((_, j) => {
        const before = (j - 1 + players) % players;
        return ((j === 0 ? 1 : 0) + (prefix[before] as number) + (current[before] as number)) / n;
      });
    }
    table[n] = current;
    for (let j = 0; j < players; j += 1) {
      prefix[j] = (prefix[j] as number) + (current[j] as number);
    }
  }
  return table;
}

describe("a round nobody can pass in", () => {
  it("matches the duel's closed form, below the exact cap and above it", () => {
    const duel = solveRound(2);
    for (let n = 2; n <= 400; n += 1) {
      expect(duel.risk(n, 0, 0, false)[0]).toBeCloseTo(lossOdds(n), 12);
    }
  });

  it("matches brute force at three to six players", () => {
    for (let players = 3; players <= 6; players += 1) {
      const round = solveRound(players);
      const truth = noPass(players, 120);
      for (let n = 2; n <= 120; n += 1) {
        const risk = round.risk(n, 0, 0, false);
        for (let j = 0; j < players; j += 1) {
          expect(risk[j], `${players} players, ceiling ${n}, seat ${j}`).toBeCloseTo(
            truth[n]?.[j] as number,
            10,
          );
        }
      }
    }
  });

  it("always puts exactly one player out", () => {
    for (let players = 2; players <= 6; players += 1) {
      const round = solveRound(players);
      for (const n of [2, 3, 8, EXACT_CEILING, EXACT_CEILING + 1, 1_000]) {
        for (let t = 0; t < players; t += 1) {
          for (const holders of [0, 1, (1 << players) - 1]) {
            for (const passedTo of [false, true]) {
              const sum = round.risk(n, t, holders, passedTo).reduce((a, b) => a + b, 0);
              expect(sum).toBeCloseTo(1, 9);
            }
          }
        }
      }
    }
  });
});

describe("the solver's choices", () => {
  /*
   * The whole claim, checked from outside: at the solver's own values, every
   * choice it records is the better one — or, where it mixes, leaves the player
   * with nothing to gain either way — and every value is what that choice
   * implies. Written against the public API alone, so it cannot share a bug
   * with the code it checks.
   */
  const verify = (players: number, margin: number) => {
    const round = solveRound(players, { margin });
    let violations = 0;
    for (let n = 2; n <= EXACT_CEILING; n += 1) {
      for (let t = 0; t < players; t += 1) {
        for (let holders = 0; holders < 1 << players; holders += 1) {
          for (const passedTo of [false, true]) {
            const next = (t + 1) % players;
            const roll = Array.from({ length: players }, (_, i) => (i === t ? 1 / n : 0));
            for (let r = 2; r <= n; r += 1) {
              const after = round.risk(r, next, holders, false);
              for (let i = 0; i < players; i += 1) {
                roll[i] = (roll[i] as number) + (after[i] as number) / n;
              }
            }
            const holds = (holders & (1 << t)) !== 0 && !passedTo;
            const chance = round.passChance(n, t, holders, passedTo);
            const landed = holds ? round.risk(n, next, holders ^ (1 << t), true) : null;
            const gap = landed ? (roll[t] as number) - margin - (landed[t] as number) : -1;
            if (!holds && chance !== 0) violations += 1;
            if (holds && chance === 1 && gap < -1e-9) violations += 1;
            if (holds && chance === 0 && gap > 1e-9) violations += 1;
            if (holds && chance > 0 && chance < 1 && Math.abs(gap) > 1e-9) violations += 1;
            const risk = round.risk(n, t, holders, passedTo);
            for (let i = 0; i < players; i += 1) {
              const implied = landed
                ? chance * (landed[i] as number) + (1 - chance) * (roll[i] as number)
                : (roll[i] as number);
              if (Math.abs((risk[i] as number) - implied) > 1e-9) violations += 1;
            }
          }
        }
      }
    }
    return violations;
  };

  it("are the better move in every state, at every table size, at the game's price", () => {
    for (let players = 2; players <= 6; players += 1) {
      expect(verify(players, shipped(players)), `${players} players`).toBe(0);
    }
  });

  it("are the better move at the normal bot's price too", () => {
    for (let players = 2; players <= 6; players += 1) {
      expect(verify(players, wary(players)), `${players} players`).toBe(0);
    }
  });
});

describe("when a pass is right", () => {
  const firstCertainPass = (players: number) => {
    const round = solveRound(players, { margin: shipped(players) });
    const everyone = (1 << players) - 1;
    let highest = 0;
    for (let n = 2; n <= EXACT_CEILING; n += 1) {
      if (round.passChance(n, 0, everyone, false) === 1) {
        highest = n;
      }
    }
    return highest;
  };

  it("is ceiling 3 in a duel, 6 at four players and 8 at six", () => {
    expect(firstCertainPass(2)).toBe(3);
    expect(firstCertainPass(4)).toBe(6);
    expect(firstCertainPass(6)).toBe(8);
  });

  it("is ceiling 2 at three players and 3 at five", () => {
    // Odd tables pass lower: turn order decides who a pass lands on.
    expect(firstCertainPass(3)).toBe(2);
    expect(firstCertainPass(5)).toBe(3);
  });

  it("is a coin weighted at 59.2% in the one state with no fixed answer", () => {
    // Three players, ceiling 3, all holding: rock-paper-scissors, so play mixes.
    const round = solveRound(3, { margin: shipped(3) });
    for (let t = 0; t < 3; t += 1) {
      expect(round.passChance(3, t, 0b111, false)).toBeCloseTo(0.592, 3);
    }
  });

  it("never comes above ceiling 8, in any state, at either price", () => {
    /*
     * What makes capping the exact solve at 32 safe: above the highest ceiling
     * anybody passes at, a round is roll-only, and the solver stops looking.
     */
    for (let players = 2; players <= 6; players += 1) {
      for (const margin of [shipped(players), wary(players)]) {
        const round = solveRound(players, { margin });
        for (let n = 9; n <= EXACT_CEILING; n += 1) {
          for (let t = 0; t < players; t += 1) {
            for (let holders = 0; holders < 1 << players; holders += 1) {
              expect(round.passChance(n, t, holders, false)).toBe(0);
            }
          }
        }
      }
    }
  });

  it("is never right first when a pass can be handed straight back", () => {
    /*
     * The finding behind the rule this game adds. Allow pass-backs, make passes
     * free, and with everybody holding one nobody should ever pass first: it
     * would only come straight back. Pinned so it cannot quietly be undone.
     */
    for (let players = 2; players <= 6; players += 1) {
      const round = solveRound(players, { margin: 0, passBack: true });
      const everyone = (1 << players) - 1;
      for (let n = 2; n <= EXACT_CEILING; n += 1) {
        expect(round.passChance(n, 0, everyone, false), `${players} players, ceiling ${n}`).toBe(0);
      }
    }
  });
});

describe("what the solver refuses", () => {
  it("refuses a table it was not built for", () => {
    expect(() => solveRound(1)).toThrow(RangeError);
    expect(() => solveRound(7)).toThrow(RangeError);
  });

  it("refuses a position or holder set that does not exist", () => {
    const round = solveRound(3);
    expect(() => round.risk(10, 3, 0, false)).toThrow(RangeError);
    expect(() => round.risk(10, 0, 8, false)).toThrow(RangeError);
    expect(() => round.passChance(0, 0, 0, false)).toThrow(RangeError);
  });
});
