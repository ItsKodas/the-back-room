# Death Roll at Six Seats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the two-seat death roll duel into a table of two to six: rounds of elimination, a ready button with a countdown behind it, a pass that cannot be handed back, and a felt laid out as a rail on desktop and a grid on a phone.

**Architecture:** The pure pieces are built first, each beside the old code without touching it: a round solver in `odds.ts`, then `round.ts`, `game.ts`, `ready.ts`, and the bot's new `choose`. Task 6 is the one swap. It rewrites `table.ts` and `adapter.ts` onto those pieces, deletes the duel and the old helpers, and makes the smallest change to the page that keeps it working. Tasks 7 and 8 then build the real felt.

**Tech Stack:** TypeScript (bundler resolution, `.js` import specifiers), vitest, React 18, socket.io, biome.

**Spec:** `docs/superpowers/specs/2026-09-14-death-roll-six-seats-design.md` — read it before Task 1. The earlier design, `docs/superpowers/specs/2026-09-10-death-roll-design.md`, explains anything this one amends.

**Where the code in this plan comes from.** Every module and test in Tasks 1 to 5 was run before the plan was written: 43 vitest tests plus a full equilibrium check across every state at every table size. That code is reproduced here exactly as it ran. Transcribe it; do not improve it.

## Global Constraints

- Imports use `.js` specifiers even for `.ts` files, e.g. `import { Round } from "./round.js"`.
- `npm test`, `npm run typecheck` and `npm run lint` must all be clean before any commit. Lint reports **no warnings**; one pre-existing `biome migrate` info line is expected.
- **Known red test, not yours:** `apps/web/src/room/TileArt.test.tsx > turns whole numbers of turns` may fail with `expected 90 to be +0`. It is being fixed on another branch. It may be the only failure; anything else is yours.
- Two server socket tests have flaked intermittently: `apps/server/src/server.test.ts > bots > do not freeze the table when they farkle` and `apps/server/src/transfers.test.ts`. If either fails, note it in your report. Do not silently re-run.
- Run `npx biome format --write <paths you touched>`. It is a no-op here, because `biome.json` sets `formatter.enabled: false`, but CLAUDE.md asks for it. Never run `biome check --write` across the repo.
- Comments say why, not what. Match the surrounding files: full sentences explaining the decision.
- Every test is watched failing before its implementation is written.
- **The server is the only authority.** The client may show a rule, but it must never be the thing enforcing one.
- **Randomness a player observes comes from `randomInt`** (`node:crypto`), injected. The one exception is a bot's mixed pass choice, since bots only sit at for-fun tables.
- **Check a stylesheet is imported before adding to it.**
- Exact values, from the spec:
  - Seats 2–6, default 6.
  - `COUNTDOWN_MS = 20_000`, `ROUND_MS = 3_000`, `RESET_CEILING = 100`.
  - `TURN_MS = 30_000` and `RESULT_MS = 5_000`, unchanged.
  - Pass price a tenth of the ante (`PASS_DIVISOR = 10`), unchanged.
  - Blurb: `Halve the number or pay. Roll a one and you're out.`
  - The rail is used when the felt is at least 640px wide, the grid below that.
  - Solver: exact up to `EXACT_CEILING = 32`.
  - The one mixed state: three players, ceiling 3, all holding a pass, passing 59.2% of the time.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `games/death-roll/src/odds.ts` | The round solver (`solveRound`, `roundFor`, `passMargin`) and the duel's closed form (`edge`, `lossOdds`) | 1, trimmed in 6 |
| `games/death-roll/src/round.ts` | One round: turn order, ceiling, passes spent this round, `passedTo` | 2 |
| `games/death-roll/src/game.ts` | One game: who is out, the pot, the rounds, the nets | 3 |
| `games/death-roll/src/ready.ts` | Who is ready, and the countdown rules | 4 |
| `games/death-roll/src/bot.ts` | `choose`, the solver-driven bot; `decide` goes in 6 | 5, 6 |
| `games/death-roll/src/table.ts` | Seating, readiness, the game in progress, the view | 6 |
| `games/death-roll/src/adapter.ts` | Antes over any number of seats, actions, pauses, settling | 6 |
| `games/death-roll/src/listing.ts` | 2–6 seats, new constants, blurb | 6 |
| `games/death-roll/src/duel.ts` | Deleted | 6 |
| `apps/server/src/deathroll.socket.test.ts` | A three-player game over sockets | 6 |
| `apps/web/src/deathroll/*` | Minimal adaptation in 6; the rail, the grid and the ready screen in 7; the ready press in 8 | 6–8 |
| `CLAUDE.md` | One sentence on ready buttons | 6 |

---

### Task 1: The round solver

The duel's closed form answered "what is a pass worth" for two players who never hand one back. At up to six players, with the no-pass-back rule, the answer depends on who else holds a pass and where they sit, so the round has to be solved. This task replaces `odds.ts` with that solver. It keeps the duel's closed form as the check on it, and keeps the three old helpers alive until Task 6 deletes them.

**Files:**
- Replace: `games/death-roll/src/odds.ts`
- Replace: `games/death-roll/src/odds.test.ts`
- Modify: `games/death-roll/src/index.ts` (the `./odds.js` export line)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `EXACT_CEILING = 32`
  - `edge(ceiling)` and `lossOdds(ceiling)` — unchanged
  - `passMargin(players, ante, price): number`
  - `interface RoundSolution { players; risk(ceiling, toAct, holders, passedTo): readonly number[]; passChance(ceiling, toAct, holders, passedTo): number }`
  - `interface SolveOptions { margin?; passBack? }`
  - `solveRound(players, options?): RoundSolution`
  - `roundFor(players, margin): RoundSolution` — memoised
  - Positions are indices into a round's turn order; `holders` is a bitmask over positions.
  - Kept until Task 6: `passGain`, `passCost`, `worthPassing`.

- [ ] **Step 1: Replace the test file**

Replace all of `games/death-roll/src/odds.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run games/death-roll/src/odds.test.ts`
Expected: FAIL — `solveRound`, `passMargin` and `EXACT_CEILING` are not exported from `./odds.js`.

- [ ] **Step 3: Replace the implementation**

Replace all of `games/death-roll/src/odds.ts` with:

```ts
/**
 * What a round of death roll is worth to each player in it.
 *
 * Rewritten when the table grew past two seats, because the old answer was a
 * formula for a duel and the new question is a game: with more than two
 * players, and a pass that cannot be handed back, what a pass is worth depends
 * on who else still holds one and where in the turn order they sit. So this
 * solves the round rather than evaluating a closed form.
 *
 * A round is played until one player rolls a 1. Each player acts to keep
 * themselves in it: they pass when doing so lowers their own chance of going
 * out by more than the pass costs them, measured against what surviving is
 * worth. Everything here is positions and bitmasks — nothing knows a seat, a
 * name or a chip.
 */

/**
 * The highest ceiling solved over every pass state.
 *
 * Above it nobody passes, so a round is roll-only and each set of pass-holders
 * is one linear recursion. That is only true because nobody at any table size
 * ever passes above ceiling 8 at either price the game uses — which
 * odds.test.ts pins, so this cap cannot quietly become wrong.
 */
export const EXACT_CEILING = 32;

/**
 * How much worse off than even the player about to roll is, in a duel nobody
 * can pass in. A fiftieth at ceiling seven, a millionth at a thousand.
 */
export function edge(ceiling: number): number {
  if (ceiling <= 1) {
    return 0.5;
  }
  return 1 / (ceiling * (ceiling + 1));
}

/**
 * The chance that whoever rolls next in a two-player round with no passes
 * left is the one who rolls the 1.
 *
 * Kept after the solver replaced it, because it is exact: it is what the
 * solver's no-pass duel must reproduce, and so it is the check on the solver.
 */
export function lossOdds(ceiling: number): number {
  return 0.5 + edge(ceiling);
}

/**
 * The drop in their own chance of going out a player needs before a pass is
 * worth its price.
 *
 * Surviving a round with `players` in it is worth about the pot shared among
 * the `players - 1` survivors, and the pot is `players` antes. A pass costing
 * `price` therefore has to buy at least `price * (players - 1) / (ante *
 * players)` of survival: five points in a duel at a tenth of the ante, 8.3 at
 * six.
 */
export function passMargin(players: number, ante: number, price: number): number {
  return (price * (players - 1)) / (ante * players);
}

export interface RoundSolution {
  readonly players: number;
  /**
   * The chance each position goes out this round, from this state, if everybody
   * plays well from here. Indexed by position in turn order; sums to one.
   *
   * @param toAct Position of the player whose turn it is.
   * @param holders Bitmask of positions still holding a pass this round.
   * @param passedTo Whether the roll in hand reached the player to act by a pass.
   */
  risk(ceiling: number, toAct: number, holders: number, passedTo: boolean): readonly number[];
  /**
   * How likely the player to act is to spend their pass rather than roll, if
   * they play well. Exactly zero or one in every state but those with no stable
   * choice — see {@link solveRound} — where it is the chance that leaves the
   * other players nothing better to do.
   */
  passChance(ceiling: number, toAct: number, holders: number, passedTo: boolean): number;
}

export interface SolveOptions {
  /** See {@link passMargin}. Zero solves a round where passes are free. */
  margin?: number;
  /**
   * Allow a roll that was passed to you to be passed on. Only ever true in a
   * test: it is the rule this game forbids, and solving it is how the test
   * shows why — with pass-backs allowed, nobody ever passes first.
   */
  passBack?: boolean;
}

function popcount(bits: number): number {
  let count = 0;
  for (let rest = bits; rest !== 0; rest >>= 1) {
    count += rest & 1;
  }
  return count;
}

/**
 * Solves one round for a table of `players`.
 *
 * Each block of states — one ceiling, one set of pass-holders — is solved in
 * up to three steps, stopping at the first that works:
 *
 * 1. **Best responses, repeated until nothing moves.** Almost every block
 *    settles this way, and a block that settles is a true equilibrium: every
 *    choice in it is the better one at the values it produced.
 * 2. **Every combination of choices, tried in turn.** A block can fail to
 *    settle only because the choices chase each other round the table. Some of
 *    those blocks still have a stable combination the chase never lands on, and
 *    trying them all finds it; fewest passes wins when there are several.
 * 3. **The symmetric mixed choice.** With an odd number of players a block can
 *    have no stable combination at all — A should pass if B rolls, B if C
 *    rolls, C if A rolls — the way rock-paper-scissors has none. When that
 *    block is every player holding a pass, every position is alike, and there
 *    is exactly one chance of passing that leaves nobody better off doing
 *    anything else. At the price the game uses this happens once: three players,
 *    ceiling 3, all three still holding.
 *
 * A block that fits none of those throws rather than guessing, and odds.test.ts
 * proves no such block exists for any table size at either bot's price.
 */
export function solveRound(players: number, options: SolveOptions = {}): RoundSolution {
  if (!Number.isInteger(players) || players < 2 || players > 6) {
    throw new RangeError(`a round has 2 to 6 players, not ${players}`);
  }
  const k = players;
  const margin = options.margin ?? passMargin(k, 10, 1);
  const passBack = options.passBack ?? false;
  const masks = 1 << k;
  const full = masks - 1;
  const cap = EXACT_CEILING;

  /* value vectors: [passedTo][ceiling][toAct][holders][position] */
  const exact = new Float64Array(2 * (cap + 1) * k * masks * k);
  const at = (locked: number, n: number, t: number, m: number) =>
    (((locked * (cap + 1) + n) * k + t) * masks + m) * k;
  /* pass chances: [passedTo][ceiling][toAct][holders] */
  const chance = new Float64Array(2 * (cap + 1) * k * masks);
  const chanceAt = (locked: number, n: number, t: number, m: number) =>
    ((locked * (cap + 1) + n) * k + t) * masks + m;
  /* running sum over ceilings 2..n-1 of the not-passed-to vectors: [toAct][holders][position] */
  const below = new Float64Array(k * masks * k);
  const belowAt = (t: number, m: number) => (t * masks + m) * k;

  const roll = new Float64Array(k);
  const mayPass = (locked: number, t: number, m: number) =>
    (locked === 0 || passBack) && (m & (1 << t)) !== 0;
  /* A pass hands the roll on at the same ceiling, one fewer holder, and locked. */
  const landingAt = (n: number, t: number, m: number) => at(1, n, (t + 1) % k, m ^ (1 << t));
  const rollInto = (n: number, t: number, m: number) => {
    const next = (t + 1) % k;
    const sum = belowAt(next, m);
    const same = at(0, n, next, m);
    for (let i = 0; i < k; i += 1) {
      roll[i] = ((i === t ? 1 : 0) + below[sum + i] + exact[same + i]) / n;
    }
  };
  /* How much better passing is than rolling for the player to act, at the block's current values. */
  const gain = (n: number, t: number, m: number) => {
    rollInto(n, t, m);
    return roll[t] - margin - exact[landingAt(n, t, m) + t];
  };

  /** Fills a block's values for fixed pass chances, indexed `locked * k + t`. */
  const evaluate = (n: number, m: number, chances: Float64Array) => {
    for (let locked = 0; locked < 2; locked += 1) {
      for (let t = 0; t < k; t += 1) {
        exact.fill(1 / k, at(locked, n, t, m), at(locked, n, t, m) + k);
      }
    }
    for (let sweep = 0; sweep < 400; sweep += 1) {
      let moved = 0;
      for (let locked = 1; locked >= 0; locked -= 1) {
        for (let t = 0; t < k; t += 1) {
          rollInto(n, t, m);
          const c = mayPass(locked, t, m) ? chances[locked * k + t] : 0;
          const home = at(locked, n, t, m);
          const land = landingAt(n, t, m);
          for (let i = 0; i < k; i += 1) {
            const value = c > 0 ? c * exact[land + i] + (1 - c) * roll[i] : roll[i];
            moved = Math.max(moved, Math.abs(exact[home + i] - value));
            exact[home + i] = value;
          }
        }
      }
      if (moved < 1e-15) {
        return;
      }
    }
  };

  const order = [...Array(masks).keys()].sort((a, b) => popcount(a) - popcount(b));

  for (let n = 2; n <= cap; n += 1) {
    for (const m of order) {
      /* Step 1: best responses until nothing moves. */
      for (let locked = 0; locked < 2; locked += 1) {
        for (let t = 0; t < k; t += 1) {
          exact.fill(1 / k, at(locked, n, t, m), at(locked, n, t, m) + k);
        }
      }
      let settled = false;
      for (let sweep = 0; sweep < 200 && !settled; sweep += 1) {
        let moved = 0;
        for (let locked = 1; locked >= 0; locked -= 1) {
          for (let t = 0; t < k; t += 1) {
            rollInto(n, t, m);
            const home = at(locked, n, t, m);
            const land = landingAt(n, t, m);
            const passes = mayPass(locked, t, m) && exact[land + t] < roll[t] - margin - 1e-12;
            for (let i = 0; i < k; i += 1) {
              const value = passes ? exact[land + i] : roll[i];
              moved = Math.max(moved, Math.abs(exact[home + i] - value));
              exact[home + i] = value;
            }
            chance[chanceAt(locked, n, t, m)] = passes ? 1 : 0;
          }
        }
        settled = moved < 1e-15;
      }

      if (!settled) {
        const slots: number[] = [];
        for (let locked = 0; locked < 2; locked += 1) {
          for (let t = 0; t < k; t += 1) {
            if (mayPass(locked, t, m)) {
              slots.push(locked * k + t);
            }
          }
        }
        const chances = new Float64Array(2 * k);
        const profiles = [...Array(1 << slots.length).keys()].sort(
          (a, b) => popcount(a) - popcount(b) || a - b,
        );

        /* Step 2: every combination, fewest passes first. */
        let found = false;
        for (const profile of profiles) {
          chances.fill(0);
          slots.forEach((slot, j) => {
            chances[slot] = (profile >> j) & 1;
          });
          evaluate(n, m, chances);
          const stable = slots.every(
            (slot, j) => ((profile >> j) & 1) === (gain(n, slot % k, m) > 1e-12 ? 1 : 0),
          );
          if (stable) {
            found = true;
            break;
          }
        }

        if (!found && !passBack && m === full) {
          /* Step 3: the one chance of passing that leaves nobody better off. */
          const gainAt = (q: number) => {
            chances.fill(0);
            for (let t = 0; t < k; t += 1) {
              chances[t] = q;
            }
            evaluate(n, m, chances);
            return gain(n, 0, m);
          };
          if (gainAt(0) > 0 && gainAt(1) < 0) {
            let low = 0;
            let high = 1;
            for (let step = 0; step < 60; step += 1) {
              const mid = (low + high) / 2;
              if (gainAt(mid) > 0) {
                low = mid;
              } else {
                high = mid;
              }
            }
            gainAt((low + high) / 2);
            found = true;
          }
        }

        if (!found) {
          throw new Error(
            `death roll: no stable choice at ${k} players, ceiling ${n}, holders ${m.toString(2)}`,
          );
        }
        for (let locked = 0; locked < 2; locked += 1) {
          for (let t = 0; t < k; t += 1) {
            chance[chanceAt(locked, n, t, m)] = mayPass(locked, t, m) ? chances[locked * k + t] : 0;
          }
        }
      }
    }
    for (let t = 0; t < k; t += 1) {
      for (let m = 0; m < masks; m += 1) {
        const home = at(0, n, t, m);
        const sum = belowAt(t, m);
        for (let i = 0; i < k; i += 1) {
          below[sum + i] += exact[home + i];
        }
      }
    }
  }

  /*
   * Above the exact cap: one roll-only recursion per set of holders, run as
   * far as the highest ceiling anybody has asked about and kept. A ceiling
   * only ever comes down within a round, so the first question for a set of
   * holders is almost always the largest one it will be asked.
   */
  const high = new Map<number, { top: number; values: Float64Array; running: Float64Array }>();
  const extend = (m: number, to: number) => {
    let entry = high.get(m);
    if (entry === undefined) {
      const running = new Float64Array(k * k);
      for (let t = 0; t < k; t += 1) {
        running.set(below.subarray(belowAt(t, m), belowAt(t, m) + k), t * k);
      }
      entry = { top: cap, values: new Float64Array(0), running };
      high.set(m, entry);
    }
    if (to <= entry.top) {
      return entry;
    }
    const values = new Float64Array((to - cap) * k * k);
    values.set(entry.values);
    const running = entry.running;
    const vector = new Float64Array(k * k);
    for (let n = entry.top + 1; n <= to; n += 1) {
      vector.fill(1 / k);
      for (let sweep = 0; sweep < 100; sweep += 1) {
        let moved = 0;
        for (let t = 0; t < k; t += 1) {
          const next = (t + 1) % k;
          for (let i = 0; i < k; i += 1) {
            const value = ((i === t ? 1 : 0) + running[next * k + i] + vector[next * k + i]) / n;
            moved = Math.max(moved, Math.abs(vector[t * k + i] - value));
            vector[t * k + i] = value;
          }
        }
        if (moved < 1e-15) {
          break;
        }
      }
      values.set(vector, (n - cap - 1) * k * k);
      for (let j = 0; j < k * k; j += 1) {
        running[j] += vector[j];
      }
    }
    entry.values = values;
    entry.top = to;
    return entry;
  };

  const check = (ceiling: number, toAct: number, holders: number) => {
    if (!Number.isInteger(ceiling) || ceiling < 1) {
      throw new RangeError(`not a ceiling: ${ceiling}`);
    }
    if (!Number.isInteger(toAct) || toAct < 0 || toAct >= k) {
      throw new RangeError(`not a position at ${k} players: ${toAct}`);
    }
    if (!Number.isInteger(holders) || holders < 0 || holders >= masks) {
      throw new RangeError(`not a set of holders at ${k} players: ${holders}`);
    }
  };

  return {
    players: k,
    risk(ceiling, toAct, holders, passedTo) {
      check(ceiling, toAct, holders);
      if (ceiling === 1) {
        return Array.from({ length: k }, (_, i) => (i === toAct ? 1 : 0));
      }
      if (ceiling <= cap) {
        const home = at(passedTo ? 1 : 0, ceiling, toAct, holders);
        return Array.from(exact.subarray(home, home + k));
      }
      const entry = extend(holders, ceiling);
      const start = (ceiling - cap - 1) * k * k + toAct * k;
      return Array.from(entry.values.subarray(start, start + k));
    },
    passChance(ceiling, toAct, holders, passedTo) {
      check(ceiling, toAct, holders);
      if (ceiling <= 1 || ceiling > cap) {
        return 0;
      }
      if (!mayPass(passedTo ? 1 : 0, toAct, holders)) {
        return 0;
      }
      return chance[chanceAt(passedTo ? 1 : 0, ceiling, toAct, holders)];
    },
  };
}

const solved = new Map<string, RoundSolution>();

/**
 * The solved round for a table, built once and kept.
 *
 * Solving six players takes a few milliseconds and the answer never changes for
 * a given size and margin, so the felt and the bot share one per size rather
 * than solving again on every state.
 */
export function roundFor(players: number, margin: number): RoundSolution {
  const key = `${players}:${margin}`;
  let solution = solved.get(key);
  if (solution === undefined) {
    solution = solveRound(players, { margin });
    solved.set(key, solution);
  }
  return solution;
}

/*
 * The duel's old one-shot pass arithmetic, kept only until Task 6.
 *
 * `bot.ts`'s `decide` still reads `worthPassing`, and the old adapter still
 * calls `decide`, so removing these now would break the build between tasks.
 * They are wrong in the way the six-seat spec explains — they ignore a pass
 * being handed straight back — and Task 6 deletes all three with their tests.
 */

/** What handing the roll back was once reckoned worth, in chips. Deleted in Task 6. */
export function passGain(ceiling: number, ante: number): number {
  return 4 * ante * edge(ceiling);
}

/** The price weighted by the chance of paying it. Deleted in Task 6. */
export function passCost(ceiling: number, price: number): number {
  return price * (1 - lossOdds(ceiling));
}

/** The old myopic pass test. Deleted in Task 6. */
export function worthPassing(ceiling: number, ante: number, price: number): boolean {
  return passGain(ceiling, ante) > passCost(ceiling, price);
}
```

- [ ] **Step 4: Export it from the package**

In `games/death-roll/src/index.ts`, replace the line

```ts
export { edge, lossOdds, passCost, passGain, worthPassing } from "./odds.js";
```

with

```ts
export type { RoundSolution, SolveOptions } from "./odds.js";
export {
  EXACT_CEILING,
  edge,
  lossOdds,
  passCost,
  passGain,
  passMargin,
  roundFor,
  solveRound,
  worthPassing,
} from "./odds.js";
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run games/death-roll/src/odds.test.ts`
Expected: PASS, 12 tests, in about a second.

Then run `npx vitest run games/death-roll`. The rest of the package must still pass: `bot.ts` still reads `worthPassing`, which is why it stays.

- [ ] **Step 6: Typecheck, lint, format**

```bash
npx biome format --write games/death-roll/src/odds.ts games/death-roll/src/odds.test.ts games/death-roll/src/index.ts
npm run typecheck
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add games/death-roll/src/odds.ts games/death-roll/src/odds.test.ts games/death-roll/src/index.ts
git commit -m "feat(death-roll): solve the round rather than evaluate the duel

At up to six players, with a pass that cannot be handed back, what a pass
is worth depends on who else holds one and where they sit, so the round
is solved as a game. Every choice the solver records is checked from
outside, at every state and table size, to be the better move at its own
values.

One state has no fixed right answer: three players at ceiling 3, all
holding a pass, where each should pass if the next rolls and roll if the
next passes, the way rock-paper-scissors has none. There the solver plays
the one chance of passing, 59.2%, that leaves nobody better off. Every
other state has a fixed best choice, and nobody passes above ceiling 8.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: A round

The duel's rules, generalised: turn order is a list rather than two ids, and a pass records who it landed on so that seat has to roll it. This is a new file beside `duel.ts`, which Task 6 deletes. Nothing imports it yet.

**Files:**
- Create: `games/death-roll/src/round.ts`
- Test: `games/death-roll/src/round.test.ts`

**Interfaces:**
- Consumes: `TableError` from `@backroom/core`.
- Produces:
  - `interface Rolled { seatId; from; result }`
  - `interface Passed { seatId; paid; to }`
  - `class Round`:
    - `constructor(order, opener, start, passPrice)`
    - fields: `order`, `start`, `passPrice`, `ceiling`, `toRoll`, `passedTo`, `outId`, `lastRoll`, `lastPass`, `history`
    - `over`, `position(seatId)`, `next(seatId)`, `holdsPass(seatId)`, `holders(): number`
    - `checkPass(seatId): number`, `pass(seatId): Passed`, `roll(seatId, draw): Rolled`

- [ ] **Step 1: Write the failing test**

Create `games/death-roll/src/round.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TableError } from "@backroom/core";
import { Round } from "./round.js";

/** A roller that hands back a fixed run of numbers, in order. */
const rolls = (...results: number[]) => {
  let at = 0;
  return () => results[at++] as number;
};

const three = () => new Round(["ada", "bob", "cat"], "ada", 38, 50);

describe("passing", () => {
  it("hands the roll to the next seat at the same ceiling", () => {
    const round = three();

    const passed = round.pass("ada");

    expect(passed).toEqual({ seatId: "ada", paid: 50, to: "bob" });
    expect(round.toRoll).toBe("bob");
    expect(round.ceiling).toBe(38);
    expect(round.passedTo).toBe("bob");
  });

  it("cannot be handed on by the seat it landed on", () => {
    // The rule that keeps the pass worth anything: a returnable pass is always
    // returned, so nobody who had worked it out would ever pass first.
    const round = three();
    round.pass("ada");

    expect(() => round.pass("bob")).toThrow(TableError);
    expect(() => round.checkPass("bob")).toThrow(/passed to you/);
  });

  it("stops binding once the seat it landed on has rolled", () => {
    const round = three();
    round.pass("ada");
    round.roll("bob", rolls(20));

    expect(round.passedTo).toBeNull();
    expect(() => round.checkPass("cat")).not.toThrow();
  });

  it("is spent once a round, so it comes back to be rolled", () => {
    const round = three();
    round.pass("ada");
    round.roll("bob", rolls(20));
    round.pass("cat");

    expect(round.toRoll).toBe("ada");
    expect(() => round.pass("ada")).toThrow(TableError);
  });

  it("checks without spending anything", () => {
    const round = three();

    expect(round.checkPass("ada")).toBe(50);
    expect(round.holdsPass("ada")).toBe(true);
  });

  it("reports who still holds one, by position", () => {
    const round = three();
    round.pass("ada");
    round.roll("bob", rolls(20));
    round.pass("cat");

    expect(round.holders()).toBe(0b010);
  });
});

describe("rolling", () => {
  it("makes the result the new ceiling and moves the turn on", () => {
    const round = three();

    round.roll("ada", rolls(12));

    expect(round.ceiling).toBe(12);
    expect(round.toRoll).toBe("bob");
    expect(round.history).toEqual([{ seatId: "ada", from: 38, result: 12 }]);
  });

  it("ends the round on a 1, names who went out, and leaves the ceiling", () => {
    const round = three();

    round.roll("ada", rolls(1));

    expect(round.over).toBe(true);
    expect(round.outId).toBe("ada");
    expect(round.ceiling).toBe(38);
    expect(() => round.roll("bob", rolls(5))).toThrow(TableError);
  });

  it("refuses a roll out of turn, from a stranger, or one the ceiling cannot produce", () => {
    const round = three();

    expect(() => round.roll("bob", rolls(5))).toThrow(TableError);
    expect(() => round.roll("zed", rolls(5))).toThrow(TableError);
    expect(() => round.roll("ada", rolls(39))).toThrow(TableError);
    expect(() => round.roll("ada", rolls(0))).toThrow(TableError);
  });
});

describe("setting a round up", () => {
  it("needs two different players and a ceiling above one", () => {
    expect(() => new Round(["ada"], "ada", 100, 10)).toThrow(TableError);
    expect(() => new Round(["ada", "ada"], "ada", 100, 10)).toThrow(TableError);
    expect(() => new Round(["ada", "bob"], "ada", 1, 10)).toThrow(TableError);
  });

  it("opens with the first seat if the opener named is not in it", () => {
    expect(new Round(["ada", "bob"], "zed", 100, 10).toRoll).toBe("ada");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run games/death-roll/src/round.test.ts`
Expected: FAIL — cannot resolve `./round.js`.

- [ ] **Step 3: Write the implementation**

Create `games/death-roll/src/round.ts`:

```ts
import { TableError } from "@backroom/core";

/**
 * One round, as rules over numbers.
 *
 * A round is the duel death roll always was, played among however many are
 * still in: turns go round in seat order, each roll sets the next ceiling, and
 * the first 1 ends it. What a round knows is its turn order, the ceiling, whose
 * turn it is, which passes have been spent, and whether the roll in hand
 * arrived by a pass. It knows nothing about chips — the game counts those — and
 * nothing about seats beyond their ids.
 */

/** A roll that happened: what it was rolled against, and what came up. */
export interface Rolled {
  seatId: string;
  /** The ceiling at the moment of rolling, which the felt shows beside it. */
  from: number;
  result: number;
}

/** A pass that happened: who made it, what it cost, and who it landed on. */
export interface Passed {
  seatId: string;
  paid: number;
  to: string;
}

export class Round {
  /** Everybody in this round, in the order the roll travels. */
  readonly order: readonly string[];
  /** The ceiling this round began at. */
  readonly start: number;
  readonly passPrice: number;
  ceiling: number;
  toRoll: string;
  /**
   * The seat the roll in hand was passed to, while it is still in their hand.
   * That seat has to roll it: a pass cannot be handed on.
   */
  passedTo: string | null = null;
  /** Who rolled the 1, once somebody has. */
  outId: string | null = null;
  lastRoll: Rolled | null = null;
  lastPass: Passed | null = null;
  readonly history: Rolled[] = [];

  /** Who has spent their pass this round. A fresh round starts with none spent. */
  private readonly spent = new Set<string>();

  constructor(order: readonly string[], opener: string, start: number, passPrice: number) {
    if (order.length < 2 || new Set(order).size !== order.length) {
      throw new TableError("A round needs at least two different players.");
    }
    if (!Number.isInteger(start) || start < 2) {
      throw new TableError("A round has to start above one.");
    }
    this.order = [...order];
    this.start = start;
    this.passPrice = passPrice;
    this.ceiling = start;
    this.toRoll = order.includes(opener) ? opener : (order[0] as string);
  }

  get over(): boolean {
    return this.outId !== null;
  }

  /** Where a seat sits in the turn order, or -1 if it is not in this round. */
  position(seatId: string): number {
    return this.order.indexOf(seatId);
  }

  /** Who the roll goes to after this seat. */
  next(seatId: string): string {
    return this.order[(this.position(seatId) + 1) % this.order.length] as string;
  }

  holdsPass(seatId: string): boolean {
    return this.order.includes(seatId) && !this.spent.has(seatId);
  }

  /** Who still holds a pass, as a bitmask over positions — the solver's language. */
  holders(): number {
    let bits = 0;
    this.order.forEach((seatId, at) => {
      if (!this.spent.has(seatId)) {
        bits |= 1 << at;
      }
    });
    return bits;
  }

  /**
   * Whether this seat may pass, and what it would cost.
   *
   * Asked before the chips are taken and answered without spending anything,
   * so that a player who cannot afford the price is refused with their pass
   * still in hand.
   */
  checkPass(seatId: string): number {
    this.checkTurn(seatId);
    if (this.passedTo === seatId) {
      /*
       * The rule that keeps the pass worth anything. A pass that could be handed
       * straight back always would be, by a player it helps exactly as much as
       * it helped the passer — so nobody who had worked that out would ever pass
       * first, and the pass would be a button only a beginner presses.
       */
      throw new TableError("That roll was passed to you, so you have to roll it.");
    }
    if (this.spent.has(seatId)) {
      throw new TableError("You have already used your pass this round.");
    }
    return this.passPrice;
  }

  pass(seatId: string): Passed {
    const paid = this.checkPass(seatId);
    this.spent.add(seatId);
    const to = this.next(seatId);
    this.toRoll = to;
    this.passedTo = to;
    const passed: Passed = { seatId, paid, to };
    this.lastPass = passed;
    /*
     * Cleared so the felt has one thing to show rather than two. A pass is a
     * different event from a roll and they never both describe the moment the
     * table is in.
     */
    this.lastRoll = null;
    return passed;
  }

  /**
   * @param draw Where the number comes from. Injected rather than taken from
   * `Math.random` because this game hands the player its whole result every
   * turn, which is exactly the run of observations that predicts the next one.
   */
  roll(seatId: string, draw: (ceiling: number) => number): Rolled {
    this.checkTurn(seatId);
    const from = this.ceiling;
    const result = draw(from);
    /*
     * Checked rather than trusted. The roller is injected, so a bad one is the
     * only way a round could reach a state its own rules forbid — a ceiling
     * that went up, or a zero that never ends it.
     */
    if (!Number.isInteger(result) || result < 1 || result > from) {
      throw new TableError("That roll is not possible.");
    }
    const rolled: Rolled = { seatId, from, result };
    this.lastRoll = rolled;
    this.lastPass = null;
    this.passedTo = null;
    this.history.push(rolled);
    if (result === 1) {
      /*
       * The ceiling is left where it was rather than set to 1. A round ends on
       * the 1 rather than continuing at it, and the felt wants the number that
       * was being rolled against shown beside the one that ended it.
       */
      this.outId = seatId;
      return rolled;
    }
    this.ceiling = result;
    this.toRoll = this.next(seatId);
    return rolled;
  }

  private checkTurn(seatId: string): void {
    if (!this.order.includes(seatId)) {
      throw new TableError("You are not in this round.");
    }
    if (this.over) {
      throw new TableError("That round is over.");
    }
    if (seatId !== this.toRoll) {
      throw new TableError("It is not your turn.");
    }
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run games/death-roll/src/round.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
npx biome format --write games/death-roll/src/round.ts games/death-roll/src/round.test.ts
npm run typecheck
npm run lint
git add games/death-roll/src/round.ts games/death-roll/src/round.test.ts
git commit -m "feat(death-roll): a round among however many are still in

The duel's rules with a turn order in place of two ids, and one rule
added: a roll passed to you must be rolled. A pass that could be handed
straight back always would be, so nobody who had worked it out would
ever pass first.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: A game

Rounds until one player is left. This is where the money is counted, and only counted: the pot, what each seat spent passing, and the nets. Nothing here moves a chip.

**Files:**
- Create: `games/death-roll/src/game.ts`
- Test: `games/death-roll/src/game.test.ts`

**Interfaces:**
- Consumes: `Round`, `Rolled` and `Passed` (Task 2); `TableError`.
- Produces:
  - `class Game`:
    - `constructor(players, opener, { ante, opening, passPrice, resetCeiling })`
    - fields: `players`, `ante`, `opening`, `passPrice`, `resetCeiling`, `opener`, `round`, `roundNumber`, `out`
    - getters: `rounds`, `alive`, `winnerId`, `over`, `betweenRounds`, `pot`
    - `spentBy(seatId)`, `passesBy(seatId)`, `survivedBy(seatId)`
    - `pass(seatId): Passed`, `roll(seatId, draw): Rolled`, `nextRound()`, `netFor(seatId)`

- [ ] **Step 1: Write the failing test**

Create `games/death-roll/src/game.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TableError } from "@backroom/core";
import { Game } from "./game.js";

const rolls = (...results: number[]) => {
  let at = 0;
  return () => results[at++] as number;
};

const shape = { ante: 500, opening: 1_000, passPrice: 50, resetCeiling: 100 };

describe("a game of three", () => {
  it("opens at the table's ceiling, with every ante in the pot", () => {
    const game = new Game(["ada", "bob", "cat"], "bob", shape);

    expect(game.round.ceiling).toBe(1_000);
    expect(game.round.toRoll).toBe("bob");
    expect(game.pot).toBe(1_500);
    expect(game.rounds).toBe(2);
  });

  it("puts out whoever rolls a 1, and waits between rounds", () => {
    const game = new Game(["ada", "bob", "cat"], "cat", shape);

    game.roll("cat", rolls(1));

    expect(game.out).toEqual(["cat"]);
    expect(game.betweenRounds).toBe(true);
    expect(game.over).toBe(false);
  });

  it("starts the next round at 100 with fresh passes, opened after whoever went out", () => {
    const game = new Game(["ada", "bob", "cat"], "bob", shape);
    game.pass("bob");
    game.roll("cat", rolls(1));

    game.nextRound();

    expect(game.roundNumber).toBe(2);
    expect(game.round.ceiling).toBe(100);
    expect(game.round.order).toEqual(["ada", "bob"]);
    expect(game.round.toRoll).toBe("ada");
    expect(game.round.holdsPass("bob")).toBe(true);
  });

  it("gives the pot to the last one standing, passes from every round included", () => {
    const game = new Game(["ada", "bob", "cat"], "bob", shape);
    game.pass("bob");
    game.roll("cat", rolls(1));
    game.nextRound();
    game.pass("ada");
    game.roll("bob", rolls(1));

    expect(game.over).toBe(true);
    expect(game.winnerId).toBe("ada");
    expect(game.pot).toBe(1_600);
    expect(game.netFor("ada")).toBe(1_050);
    expect(game.netFor("bob")).toBe(-550);
    expect(game.netFor("cat")).toBe(-500);
  });

  it("comes to nothing overall, however the passes fell", () => {
    const game = new Game(["ada", "bob", "cat"], "bob", shape);
    game.pass("bob");
    game.roll("cat", rolls(1));
    game.nextRound();
    game.pass("ada");
    game.roll("bob", rolls(1));

    const total = ["ada", "bob", "cat"].reduce((sum, id) => sum + game.netFor(id), 0);
    expect(total).toBe(0);
  });

  it("counts passes and rounds survived for the history", () => {
    const game = new Game(["ada", "bob", "cat"], "bob", shape);
    game.pass("bob");
    game.roll("cat", rolls(1));
    game.nextRound();
    game.pass("ada");
    game.roll("bob", rolls(1));

    expect(game.passesBy("ada")).toBe(1);
    expect(game.passesBy("cat")).toBe(0);
    expect(game.survivedBy("cat")).toBe(0);
    expect(game.survivedBy("bob")).toBe(1);
    expect(game.survivedBy("ada")).toBe(2);
  });

  it("is worth nothing to anybody until it is over, or to a seat never dealt in", () => {
    const game = new Game(["ada", "bob", "cat"], "bob", shape);

    expect(game.netFor("ada")).toBe(0);
    expect(game.netFor("zed")).toBe(0);
  });
});

describe("who opens the next round", () => {
  it("wraps round the table past the last seat", () => {
    const game = new Game(["a", "b", "c", "d"], "a", { ...shape, opening: 100 });
    game.roll("a", rolls(50));
    game.roll("b", rolls(40));
    game.roll("c", rolls(30));
    game.roll("d", rolls(1));

    game.nextRound();

    expect(game.round.toRoll).toBe("a");
  });

  it("skips seats already out", () => {
    const game = new Game(["a", "b", "c", "d"], "a", { ...shape, opening: 100 });
    game.roll("a", rolls(50));
    game.roll("b", rolls(40));
    game.roll("c", rolls(30));
    game.roll("d", rolls(1));
    game.nextRound();
    game.roll("a", rolls(1));

    game.nextRound();

    expect(game.round.toRoll).toBe("b");
  });
});

describe("the edges", () => {
  it("plays a game of two as exactly one round", () => {
    const game = new Game(["ada", "bob"], "ada", shape);

    game.roll("ada", rolls(1));

    expect(game.over).toBe(true);
    expect(game.betweenRounds).toBe(false);
    expect(game.winnerId).toBe("bob");
  });

  it("refuses a next round when there is none to start", () => {
    const game = new Game(["ada", "bob", "cat"], "ada", shape);

    expect(() => game.nextRound()).toThrow(TableError);
  });

  it("needs two different players", () => {
    expect(() => new Game(["ada"], "ada", shape)).toThrow(TableError);
    expect(() => new Game(["ada", "ada"], "ada", shape)).toThrow(TableError);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run games/death-roll/src/game.test.ts`
Expected: FAIL — cannot resolve `./game.js`.

- [ ] **Step 3: Write the implementation**

Create `games/death-roll/src/game.ts`:

```ts
import { TableError } from "@backroom/core";
import type { Passed, Rolled } from "./round.js";
import { Round } from "./round.js";

/**
 * One game of death roll: rounds until one player is left.
 *
 * Everybody dealt in antes once. Each round is a {@link Round} among whoever is
 * still in; rolling a 1 puts you out, and the next round starts at the reset
 * ceiling with fresh passes, opened by the next player still in after whoever
 * just went out. The last player standing takes the pot — every ante, and every
 * pass paid in any round.
 *
 * This is where the money is counted, and only counted. Nothing here moves a
 * chip: the adapter takes them and hands them over, and asks this what the
 * game came to.
 */
export class Game {
  /** Everybody dealt in, in seat order — which is also turn order. */
  readonly players: readonly string[];
  readonly ante: number;
  readonly opening: number;
  readonly passPrice: number;
  readonly resetCeiling: number;
  /** Who opened the first round. */
  readonly opener: string;
  round: Round;
  roundNumber = 1;
  /** Everybody who has gone out, in the order they went. */
  readonly out: string[] = [];

  private readonly spent = new Map<string, number>();
  private readonly passes = new Map<string, number>();

  constructor(
    players: readonly string[],
    opener: string,
    options: { ante: number; opening: number; passPrice: number; resetCeiling: number },
  ) {
    if (players.length < 2 || new Set(players).size !== players.length) {
      throw new TableError("A game needs at least two different players.");
    }
    this.players = [...players];
    this.ante = options.ante;
    this.opening = options.opening;
    this.passPrice = options.passPrice;
    this.resetCeiling = options.resetCeiling;
    this.opener = players.includes(opener) ? opener : (players[0] as string);
    this.round = new Round(this.players, this.opener, this.opening, this.passPrice);
  }

  /** How many rounds a game of this many players lasts: one fewer than there are players. */
  get rounds(): number {
    return this.players.length - 1;
  }

  /** Everybody still in, in seat order. */
  get alive(): readonly string[] {
    return this.players.filter((seatId) => !this.out.includes(seatId));
  }

  get winnerId(): string | null {
    const left = this.alive;
    return left.length === 1 ? (left[0] as string) : null;
  }

  get over(): boolean {
    return this.winnerId !== null;
  }

  /** A round has ended on a 1 and the next one has not begun. */
  get betweenRounds(): boolean {
    return this.round.over && !this.over;
  }

  /** Every ante, and every pass paid in any round. */
  get pot(): number {
    let pot = this.ante * this.players.length;
    for (const paid of this.spent.values()) {
      pot += paid;
    }
    return pot;
  }

  /** What this seat has put in beyond its ante, across every round. */
  spentBy(seatId: string): number {
    return this.spent.get(seatId) ?? 0;
  }

  /** How many passes this seat made, across every round. */
  passesBy(seatId: string): number {
    return this.passes.get(seatId) ?? 0;
  }

  /** How many rounds this seat got through: the winner got through all of them. */
  survivedBy(seatId: string): number {
    if (seatId === this.winnerId) {
      return this.rounds;
    }
    const at = this.out.indexOf(seatId);
    return at === -1 ? 0 : at;
  }

  /**
   * A pass, counted against the seat that made it.
   *
   * Called only once the chips for it are in. The round refuses a pass it will
   * not allow, before anything is counted, so a refused pass costs nothing.
   */
  pass(seatId: string): Passed {
    const passed = this.round.pass(seatId);
    this.spent.set(seatId, this.spentBy(seatId) + passed.paid);
    this.passes.set(seatId, this.passesBy(seatId) + 1);
    return passed;
  }

  roll(seatId: string, draw: (ceiling: number) => number): Rolled {
    const rolled = this.round.roll(seatId, draw);
    if (rolled.result === 1) {
      this.out.push(seatId);
    }
    return rolled;
  }

  /**
   * Starts the next round among whoever is still in.
   *
   * At the reset ceiling rather than the table's opening one, which is what
   * keeps a full table near thirty rolls rather than forty; with fresh passes,
   * so the last two play a real duel; and opened by the next player still in
   * after whoever just went out.
   */
  nextRound(): void {
    if (!this.betweenRounds) {
      throw new TableError("There is no round to start.");
    }
    const gone = this.round.outId as string;
    const from = this.players.indexOf(gone);
    let opener = this.alive[0] as string;
    for (let step = 1; step <= this.players.length; step += 1) {
      const seatId = this.players[(from + step) % this.players.length] as string;
      if (!this.out.includes(seatId)) {
        opener = seatId;
        break;
      }
    }
    this.round = new Round(this.alive, opener, this.resetCeiling, this.passPrice);
    this.roundNumber += 1;
  }

  /**
   * What the game came to, for one seat.
   *
   * The winner takes the pot back, less what they put into it; everybody else
   * is down their ante and every pass they paid. So the nets sum to zero, and a
   * pass the winner made cost them nothing. Zero for anyone until it is over,
   * and zero for a seat that was never dealt in.
   */
  netFor(seatId: string): number {
    if (!this.over || !this.players.includes(seatId)) {
      return 0;
    }
    const staked = this.ante + this.spentBy(seatId);
    return seatId === this.winnerId ? this.pot - staked : -staked;
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run games/death-roll/src/game.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
npx biome format --write games/death-roll/src/game.ts games/death-roll/src/game.test.ts
npm run typecheck
npm run lint
git add games/death-roll/src/game.ts games/death-roll/src/game.test.ts
git commit -m "feat(death-roll): rounds until one is left, and what that comes to

A 1 puts you out; the next round starts at 100 with fresh passes, opened
by the next player still in; the last one standing takes every ante and
every pass. The nets are the pot less each seat's own stake for the
winner and minus it for everybody else, so they always sum to zero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Who is ready

The ready button's rules as pure bookkeeping, with the clock passed in:

- everybody ready deals at once;
- two or more ready starts a countdown, which is never restarted and is abandoned below two;
- when the countdown ends, whoever is ready is dealt.

**Files:**
- Create: `games/death-roll/src/ready.ts`
- Test: `games/death-roll/src/ready.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class Readiness`:
    - `constructor(countdownMs)`
    - `countdownEndsAt: number | null`
    - `isReady(seatId)`, `count(seated)`
    - `set(seatId, ready, seated, now)`, `drop(seatId, seated, now)`, `sync(seated, now)`
    - `dealable(seated, now): string[] | null`
    - `clear()`

- [ ] **Step 1: Write the failing test**

Create `games/death-roll/src/ready.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Readiness } from "./ready.js";

const four = ["ada", "bob", "cat", "dan"];

describe("getting a table dealt", () => {
  it("does nothing with one player ready", () => {
    const readiness = new Readiness(20_000);

    readiness.set("ada", true, four, 0);

    expect(readiness.countdownEndsAt).toBeNull();
    expect(readiness.dealable(four, 0)).toBeNull();
  });

  it("starts a countdown once two are ready, and deals the ready ones when it ends", () => {
    const readiness = new Readiness(20_000);
    readiness.set("ada", true, four, 0);

    readiness.set("bob", true, four, 1_000);

    expect(readiness.countdownEndsAt).toBe(21_000);
    expect(readiness.dealable(four, 20_999)).toBeNull();
    expect(readiness.dealable(four, 21_000)).toEqual(["ada", "bob"]);
  });

  it("deals at once when everybody is ready, however much countdown is left", () => {
    const readiness = new Readiness(20_000);
    for (const seat of four) {
      readiness.set(seat, true, four, 0);
    }

    expect(readiness.dealable(four, 0)).toEqual(four);
  });
});

describe("keeping the countdown honest", () => {
  it("is not restarted by more players getting ready", () => {
    const readiness = new Readiness(20_000);
    readiness.set("ada", true, four, 0);
    readiness.set("bob", true, four, 1_000);

    readiness.set("cat", true, four, 5_000);

    expect(readiness.countdownEndsAt).toBe(21_000);
  });

  it("is not restarted by somebody sitting down", () => {
    // Otherwise sitting down and standing up again would hold a table off for ever.
    const readiness = new Readiness(20_000);
    readiness.set("ada", true, four, 0);
    readiness.set("bob", true, four, 1_000);

    readiness.sync([...four, "eve"], 6_000);

    expect(readiness.countdownEndsAt).toBe(21_000);
  });

  it("is abandoned when fewer than two are ready", () => {
    const readiness = new Readiness(20_000);
    readiness.set("ada", true, four, 0);
    readiness.set("bob", true, four, 0);

    readiness.set("bob", false, four, 100);

    expect(readiness.countdownEndsAt).toBeNull();
    expect(readiness.dealable(four, 99_999)).toBeNull();
  });

  it("deals at once when the one player holding out stands up", () => {
    const three = ["ada", "bob", "cat"];
    const readiness = new Readiness(20_000);
    readiness.set("ada", true, three, 0);
    readiness.set("bob", true, three, 0);

    readiness.drop("cat", ["ada", "bob"], 300);

    expect(readiness.dealable(["ada", "bob"], 300)).toEqual(["ada", "bob"]);
  });

  it("clears everybody, and the countdown, when a game ends or a deal fails", () => {
    const readiness = new Readiness(20_000);
    readiness.set("ada", true, four, 0);
    readiness.set("bob", true, four, 0);

    readiness.clear();

    expect(readiness.count(four)).toBe(0);
    expect(readiness.countdownEndsAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run games/death-roll/src/ready.test.ts`
Expected: FAIL — cannot resolve `./ready.js`.

- [ ] **Step 3: Write the implementation**

Create `games/death-roll/src/ready.ts`:

```ts
/**
 * Who at a table is in for the next game, and when it gets dealt.
 *
 * A table deals when the people at it say they are in: everybody ready deals
 * at once; two or more ready starts a countdown, and when it ends whoever is
 * ready is dealt. The countdown is what keeps a ready button honest — without
 * it, one player who never presses it holds everybody else's evening shut.
 *
 * Pure bookkeeping over seat ids and a clock that is passed in, so the rules
 * can be tested without a table or a timer.
 */
export class Readiness {
  /** When the countdown deals, or null when none is running. */
  countdownEndsAt: number | null = null;

  private readonly ready = new Set<string>();
  private readonly countdownMs: number;

  constructor(countdownMs: number) {
    this.countdownMs = countdownMs;
  }

  isReady(seatId: string): boolean {
    return this.ready.has(seatId);
  }

  /** How many of these seats are ready. */
  count(seated: readonly string[]): number {
    return seated.filter((seatId) => this.ready.has(seatId)).length;
  }

  set(seatId: string, ready: boolean, seated: readonly string[], now: number): void {
    if (ready) {
      this.ready.add(seatId);
    } else {
      this.ready.delete(seatId);
    }
    this.sync(seated, now);
  }

  /** Somebody stood up. */
  drop(seatId: string, seated: readonly string[], now: number): void {
    this.ready.delete(seatId);
    this.sync(seated, now);
  }

  /**
   * Starts or abandons the countdown to match who is ready.
   *
   * Never restarts one already running: if sitting down pushed the deal back,
   * sitting down and standing up again would be a way to keep a table from ever
   * dealing. And abandons it the moment fewer than two are ready, since there
   * would be nobody to deal.
   */
  sync(seated: readonly string[], now: number): void {
    const ready = this.count(seated);
    if (ready < 2) {
      this.countdownEndsAt = null;
      return;
    }
    if (ready === seated.length) {
      return;
    }
    if (this.countdownEndsAt === null) {
      this.countdownEndsAt = now + this.countdownMs;
    }
  }

  /**
   * The seats to deal now, or null if the table should not deal yet.
   *
   * Everybody ready deals at once, however much countdown is left; otherwise
   * the ready ones are dealt once the countdown has run out.
   */
  dealable(seated: readonly string[], now: number): string[] | null {
    const ready = seated.filter((seatId) => this.ready.has(seatId));
    if (ready.length < 2) {
      return null;
    }
    if (ready.length === seated.length) {
      return ready;
    }
    if (this.countdownEndsAt !== null && now >= this.countdownEndsAt) {
      return ready;
    }
    return null;
  }

  /** Everybody back to not ready: a game has ended, or a deal fell through. */
  clear(): void {
    this.ready.clear();
    this.countdownEndsAt = null;
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run games/death-roll/src/ready.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
npx biome format --write games/death-roll/src/ready.ts games/death-roll/src/ready.test.ts
npm run typecheck
npm run lint
git add games/death-roll/src/ready.ts games/death-roll/src/ready.test.ts
git commit -m "feat(death-roll): who is in for the next game, and when it is dealt

Everybody ready deals at once; two ready starts a twenty-second countdown
that deals whoever is ready when it ends. The countdown is never restarted
by somebody sitting down and is abandoned below two, so neither one idle
player nor a player sitting down and standing up can hold a table shut.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: A bot that reads the solver

The bot's one decision is still when to spend its pass. The honest answer now comes from the solver, so it changes with who else holds a pass and where they sit. Skill is how wary a bot is of the price. This task adds `choose` beside the old `decide`, which the old adapter still calls; Task 6 deletes `decide`.

**Files:**
- Modify: `games/death-roll/src/bot.ts` (add to the end)
- Modify: `games/death-roll/src/bot.test.ts` (add to the end)

**Interfaces:**
- Consumes: `roundFor` and `passMargin` (Task 1).
- Produces:
  - `WARINESS = { normal: 2.5, hard: 1 }`
  - `choose({ skill, players, ceiling, toAct, holders, passedTo, margin, canAfford, random? }): Choice`
  - `players` is how many are still in the round, and `toAct` is the bot's position among them.

- [ ] **Step 1: Write the failing test**

In `games/death-roll/src/bot.test.ts`, change the import from `./bot.js` to also import `choose`, and add:

```ts
import { passMargin } from "./odds.js";
```

Then add to the end of the file:

```ts
describe("which bot passes, and when", () => {
  const everyone = (players: number) => (1 << players) - 1;
  const at = (
    skill: "easy" | "normal" | "hard",
    players: number,
    ceiling: number,
    over: Partial<{ passedTo: boolean; canAfford: boolean; random: () => number }> = {},
  ) =>
    choose({
      skill,
      players,
      ceiling,
      toAct: 0,
      holders: everyone(players),
      passedTo: false,
      margin: passMargin(players, 10, 1),
      canAfford: true,
      ...over,
    });

  it("never passes when it plays easy", () => {
    // Not a bad decision so much as a player who has not noticed there is one.
    expect(at("easy", 2, 2)).toBe("roll");
  });

  it("plays the solver's move when it plays hard", () => {
    expect(at("hard", 2, 3)).toBe("pass");
    expect(at("hard", 2, 4)).toBe("roll");
    expect(at("hard", 6, 8)).toBe("pass");
    expect(at("hard", 6, 9)).toBe("roll");
  });

  it("waits longer than it should when it plays normal", () => {
    expect(at("normal", 6, 5)).toBe("roll");
    expect(at("normal", 6, 4)).toBe("pass");
  });

  it("never tries to pass a roll that was passed to it", () => {
    expect(at("hard", 2, 2, { passedTo: true })).toBe("roll");
  });

  it("rolls when it cannot afford the pass", () => {
    expect(at("hard", 2, 2, { canAfford: false })).toBe("roll");
  });

  it("mixes in the one state with no fixed answer", () => {
    // Three players, ceiling 3, all holding: good play passes 59.2% of the time.
    expect(at("hard", 3, 3, { random: () => 0 })).toBe("pass");
    expect(at("hard", 3, 3, { random: () => 0.99 })).toBe("roll");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run games/death-roll/src/bot.test.ts`
Expected: FAIL — `choose` is not exported from `./bot.js`.

- [ ] **Step 3: Write the implementation**

In `games/death-roll/src/bot.ts`, add `roundFor` to the import from `./odds.js`, so it reads:

```ts
import { roundFor, worthPassing } from "./odds.js";
```

Then add to the end of the file:

```ts
/**
 * How wary each skill is of spending a pass, as a multiple of the real price.
 *
 * A hard bot values surviving a round at exactly what it is worth, so it plays
 * the solver's move. A normal one values it at less, which raises the bar a
 * pass has to clear: it waits longer than it should, the way a player who has
 * worked out that passing is for the endgame without working out where the
 * endgame starts. An easy bot never passes at all.
 */
export const WARINESS = { normal: 2.5, hard: 1 } as const;

/**
 * What a bot does on its turn.
 *
 * @param players How many are still in this round.
 * @param toAct The bot's position in the round's turn order.
 * @param holders Who still holds a pass this round, by position.
 * @param passedTo Whether the roll reached the bot by a pass — which means it
 * must roll.
 * @param margin The real price of a pass as survival, from `passMargin`.
 * @param random Only consulted in a state with no fixed right answer, where
 * good play is to pass some of the time. Math.random is fine there: bots only
 * ever sit at tables playing for nothing.
 */
export function choose(options: {
  skill: BotSkill;
  players: number;
  ceiling: number;
  toAct: number;
  holders: number;
  passedTo: boolean;
  margin: number;
  canAfford: boolean;
  random?: () => number;
}): Choice {
  const { skill, players, ceiling, toAct, holders, passedTo, margin, canAfford } = options;
  if (skill === "easy" || !canAfford) {
    return "roll";
  }
  const chance = roundFor(players, margin * WARINESS[skill]).passChance(
    ceiling,
    toAct,
    holders,
    passedTo,
  );
  if (chance <= 0) {
    return "roll";
  }
  if (chance >= 1) {
    return "pass";
  }
  return (options.random ?? Math.random)() < chance ? "pass" : "roll";
}
```

- [ ] **Step 4: Export it, run it, watch it pass**

In `games/death-roll/src/index.ts`, change the bot export line to:

```ts
export { choose, decide, thinkingTime, WARINESS } from "./bot.js";
```

Run: `npx vitest run games/death-roll/src/bot.test.ts`
Expected: PASS. The new cases join the existing ones, which still test `decide`.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
npx biome format --write games/death-roll/src/bot.ts games/death-roll/src/bot.test.ts games/death-roll/src/index.ts
npm run typecheck
npm run lint
git add games/death-roll/src/bot.ts games/death-roll/src/bot.test.ts games/death-roll/src/index.ts
git commit -m "feat(death-roll): a bot that reads the solved round

A hard bot plays the solver's move, including the one state where good
play mixes; a normal one values surviving at less than it is worth and so
waits longer to pass; an easy one never passes. None of them tries to pass
a roll passed to it. The old decide stays until the adapter stops calling
it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The swap

This is the one task that changes behaviour. `table.ts` and `adapter.ts` are rewritten onto the pieces from Tasks 1–5, the duel and the old helpers are deleted, and the page gets the smallest change that keeps it compiling and playable: a ready button and the new phase name. The real felt is Task 7.

It is large because the view contract changes, and the engine, the server test and the page all read it. Splitting it would leave the build red between tasks. **The money lives in `adapter.ts`, and review attention belongs there.** The table and adapter code below was run against the real `@backroom/core` before this plan was written: 15 table tests and 18 adapter tests. The socket test and the page changes were not pre-run: red-green them as written.

**Files:**
- Replace: `games/death-roll/src/listing.ts`, `table.ts`, `table.test.ts`, `adapter.ts`, `adapter.test.ts`, `index.ts`
- Delete: `games/death-roll/src/duel.ts`, `games/death-roll/src/duel.test.ts`
- Modify: `games/death-roll/src/odds.ts` (delete the legacy block), `bot.ts` and `bot.test.ts` (delete `decide`), `listing.test.ts`
- Modify: `apps/server/src/deathroll.socket.test.ts`
- Modify: `apps/web/src/deathroll/DeathRoll.tsx`, `DeathRoll.test.tsx`, `useIntent.test.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `solveRound`/`roundFor`/`passMargin` (1), `Round` (2), `Game` (3), `Readiness` (4), `choose` (5).
- Produces:
  - `Table`: `game`, `readiness`, `draining`, `pending`, `setReady(seatId, ready, now)`, `askForGame(now)`, `takePending()`, `noteShorts(ids)`, `failDeal(reason)`, `begin(players)`, `nextRound()`, `finish()`, `touchClock()`, `purseFor`, `movePurse`, `topUp`, `view(forSeatId)`, and the `PlayTable` surface.
  - `Phase = "waiting" | "playing" | "over"`.
  - `SeatView` gains `ready`, `inGame`, `out`, `short`.
  - `TableView` gains `passedTo`, `order`, `alive`, `round`, `rounds`, `lastOut`, `countdownEndsAt` and `readyCount`, and `waitingFor` becomes `"players" | null`. It loses `loserId` and `shortId`.
  - Actions: `{ type: "ready", ready: boolean }`, `{ type: "roll" }`, `{ type: "pass" }`.
  - `deathRollAdapter({ roll?, turnMs?, resultMs?, roundMs?, countdownMs? })`.
  - Pause keys: `result`, `round`, `deal`, `countdown`.

- [ ] **Step 1: Replace the engine's tests**

Replace all of `games/death-roll/src/table.test.ts` with:

```ts
import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { Table } from "./table.js";

const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

/** A chips table with these people sat at it. */
const seated = (...names: string[]) => {
  const table = new Table("ABCDE", 6, { opening: 1_000, ante: 500, countdownMs: 20_000 });
  for (const name of names) {
    table.join(name, name, who(`u-${name}`));
  }
  return table;
};

const readyAll = (table: Table, now = 0) => {
  for (const seat of table.seats) {
    table.setReady(seat.id, true, now);
  }
};

describe("a table waiting for players", () => {
  it("says it needs players until two are sat down", () => {
    const table = seated("ada");
    expect(table.view("ada").waitingFor).toBe("players");

    table.join("bob", "bob", who("u-bob"));

    expect(table.view("ada").waitingFor).toBeNull();
  });

  it("takes no stake for being ready", () => {
    // Waiting never costs anybody a stake: ready moves nothing.
    const table = seated("ada", "bob");
    readyAll(table);

    expect(table.game).toBeNull();
    expect(table.view(null).pot).toBe(0);
    expect(table.view(null).readyCount).toBe(2);
  });
});

describe("dealing", () => {
  it("asks for everybody at once when everybody is ready", () => {
    const table = seated("ada", "bob", "cat");
    readyAll(table);

    table.askForGame(0);

    expect(table.takePending()).toEqual(["ada", "bob", "cat"]);
    expect(table.draining).toBe(true);
    expect(table.takePending()).toBeNull();
  });

  it("waits out the countdown when somebody is not ready, then asks for the ready ones", () => {
    const table = seated("ada", "bob", "cat");
    table.setReady("ada", true, 0);
    table.setReady("bob", true, 1_000);

    table.askForGame(20_999);
    expect(table.pending).toBe(false);

    table.askForGame(21_000);
    expect(table.takePending()).toEqual(["ada", "bob"]);
  });

  it("deals the players given, with the clock armed and ready stood down", () => {
    const table = seated("ada", "bob", "cat");
    readyAll(table);

    table.begin(["ada", "bob", "cat"]);

    expect(table.phase).toBe("playing");
    expect(table.view(null).pot).toBe(1_500);
    expect(table.view(null).rounds).toBe(2);
    expect(table.turnEndsAt).not.toBeNull();
    expect(table.view(null).readyCount).toBe(0);
  });

  it("moves the first roll on to the next player dealt in, game after game", () => {
    const table = seated("ada", "bob", "cat");
    table.begin(["ada", "bob", "cat"]);
    expect(table.view(null).toRoll).toBe("ada");
    table.game?.roll("ada", () => 1);
    table.game?.nextRound();
    table.game?.roll(table.game.round.toRoll, () => 1);
    table.finish();

    table.begin(["ada", "bob", "cat"]);

    expect(table.view(null).toRoll).toBe("bob");
  });
});

describe("during a game", () => {
  it("seats a latecomer for the next game and refuses their ready until then", () => {
    const table = seated("ada", "bob");
    table.begin(["ada", "bob"]);

    const late = table.join("cat", "cat", who("u-cat"));

    expect(late.waiting).toBe(true);
    expect(() => table.setReady("cat", true, 0)).toThrow(TableError);
  });

  it("holds the seat of a player in the game until the felt clears", () => {
    const table = seated("ada", "bob");
    table.begin(["ada", "bob"]);

    table.removeSeat("bob");
    expect(table.seats.map((seat) => seat.id)).toContain("bob");

    table.game?.roll("ada", () => 1);
    table.finish();
    expect(table.seats.map((seat) => seat.id)).not.toContain("bob");
  });

  it("lets a player waiting for the next game leave at once", () => {
    const table = seated("ada", "bob");
    table.begin(["ada", "bob"]);
    table.join("cat", "cat", who("u-cat"));

    table.removeSeat("cat");

    expect(table.seats.map((seat) => seat.id)).not.toContain("cat");
  });

  it("shows who is out, who has passed, and who is still in", () => {
    const table = seated("ada", "bob", "cat");
    table.begin(["ada", "bob", "cat"]);
    table.game?.pass("ada");
    table.game?.roll("bob", () => 1);

    const view = table.view("ada");

    expect(view.lastOut).toBe("bob");
    expect(view.seats.find((seat) => seat.id === "bob")?.out).toBe(true);
    expect(view.seats.find((seat) => seat.id === "ada")?.passed).toBe(true);
    expect(view.order).toEqual(["ada", "bob", "cat"]);
    expect(view.alive).toEqual(["ada", "bob", "cat"]);

    table.nextRound();

    expect(table.view("ada").alive).toEqual(["ada", "cat"]);
    expect(table.view("ada").ceiling).toBe(100);
    expect(table.view("ada").round).toBe(2);
  });
});

describe("after a game", () => {
  it("stands everybody's ready down and lets the latecomer in", () => {
    const table = seated("ada", "bob");
    readyAll(table);
    table.begin(["ada", "bob"]);
    table.join("cat", "cat", who("u-cat"));
    table.game?.roll("ada", () => 1);

    table.finish();

    expect(table.phase).toBe("waiting");
    expect(table.view(null).readyCount).toBe(0);
    expect(table.seats.every((seat) => !seat.waiting)).toBe(true);
  });
});

describe("a deal that falls short", () => {
  it("sits out whoever could not pay, and stands their ready down", () => {
    const table = seated("ada", "bob", "cat");
    readyAll(table);

    table.noteShorts(["cat"]);

    expect(table.view(null).seats.find((seat) => seat.id === "cat")?.short).toBe(true);
    expect(table.readiness.isReady("cat")).toBe(false);
    expect(table.lastEvent).toMatch(/could not cover/);
  });

  it("stands everybody down when the deal fails, and does not retry by itself", () => {
    const table = seated("ada", "bob");
    readyAll(table);

    table.failDeal("No deal.");

    expect(table.view(null).readyCount).toBe(0);
    table.askForGame(99_999);
    expect(table.pending).toBe(false);
  });
});

describe("bots", () => {
  it("refuses one at a table playing for chips", () => {
    const table = seated("ada");
    expect(() => table.addBot("bot:1", "Bot", "normal")).toThrow(TableError);
  });

  it("seats one ready at a table playing for nothing, and readies it again after a game", () => {
    const table = new Table("ABCDE", 6, { opening: 1_000, ante: 500 });
    table.forFun = true;
    table.join("ada", "Ada", null);

    table.addBot("bot:1", "Bot", "normal");
    expect(table.readiness.isReady("bot:1")).toBe(true);

    table.begin(["ada", "bot:1"]);
    table.game?.roll("ada", () => 1);
    table.finish();

    expect(table.readiness.isReady("bot:1")).toBe(true);
    expect(table.readiness.isReady("ada")).toBe(false);
  });
});
```

Replace all of `games/death-roll/src/adapter.test.ts` with:

```ts
import type { GameDeps } from "@backroom/core";
import { TableError } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { deathRollAdapter } from "./adapter.js";
import type { Table } from "./table.js";

const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

/** An account that always pays, noting everything asked of it. */
const spy = (take: (userId: string, amount: number) => Promise<boolean> = async () => true) => {
  const took = vi.fn(take);
  const gave = vi.fn(async (_userId: string, _amount: number) => {});
  const finished = vi.fn(async (_record: unknown) => {});
  const deps = {
    take: took,
    give: gave,
    record: vi.fn(async () => {}),
    finished,
  } as unknown as GameDeps;
  return { deps, took, gave, finished };
};

const sum = (calls: unknown[][]) => calls.reduce((total, call) => total + (call[1] as number), 0);

type Adapter = ReturnType<typeof deathRollAdapter>;

/** A chips table with these players sat at it, everybody ready. */
const seated = (game: Adapter, ...names: string[]) => {
  const table = game.create("ABCDE", { buyIn: 500, ceiling: 1_000, maxSeats: 6 }) as Table;
  for (const name of names) {
    table.join(name, name, who(`u-${name}`));
  }
  for (const name of names) {
    table.setReady(name, true, 0);
  }
  return table;
};

/** Deals the way the room does: the table asks, payOut answers. */
const deal = async (game: Adapter, table: Table, deps: GameDeps) => {
  table.askForGame(Date.now());
  return await game.payOut?.(table, deps);
};

describe("dealing a game", () => {
  it("takes an ante from everybody ready and deals them all", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps, took } = spy();

    expect(await deal(game, table, deps)).toBe(true);

    expect(took).toHaveBeenCalledTimes(3);
    expect(table.game?.players).toEqual(["ada", "bob", "cat"]);
    expect(table.view(null).pot).toBe(1_500);
  });

  it("sits out a player who cannot cover the ante, and deals the rest", async () => {
    // A short player no longer holds a table of people who can pay.
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps } = spy(async (userId) => userId !== "u-cat");

    await deal(game, table, deps);

    expect(table.game?.players).toEqual(["ada", "bob"]);
    expect(table.view(null).seats.find((seat) => seat.id === "cat")?.short).toBe(true);
    expect(table.view(null).pot).toBe(1_000);
  });

  it("hands every ante back and deals nobody when fewer than two can pay", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps, took, gave } = spy(async (userId) => userId === "u-ada");

    expect(await deal(game, table, deps)).toBe(true);

    expect(table.game).toBeNull();
    expect(sum(gave.mock.calls)).toBe(sum(took.mock.calls.filter((call) => call[0] === "u-ada")));
    expect(table.view(null).readyCount).toBe(0);
  });

  it("hands back everything taken when the store fails partway through", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps, gave } = spy(async (userId) => {
      if (userId === "u-cat") {
        throw new Error("store down");
      }
      return true;
    });

    await expect(deal(game, table, deps)).rejects.toThrow("store down");

    expect(table.game).toBeNull();
    expect(gave).toHaveBeenCalledWith("u-ada", 500);
    expect(gave).toHaveBeenCalledWith("u-bob", 500);
    expect(table.draining).toBe(false);
  });

  it("refunds a player who stood up while the antes were being taken, and deals without them", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps, gave } = spy(async (userId) => {
      if (userId === "u-cat") {
        table.removeSeat("ada");
      }
      return true;
    });

    await deal(game, table, deps);

    expect(gave).toHaveBeenCalledWith("u-ada", 500);
    expect(table.game?.players).toEqual(["bob", "cat"]);
  });

  it("does nothing, and says so, when no game was asked for", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");
    const { deps } = spy();

    expect(await game.payOut?.(table, deps)).toBe(false);
  });

  it("offers no second deal while the antes are still being taken", async () => {
    // Four antes off accounts for a pot of two, otherwise.
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");
    let during: unknown = "unset";
    const { deps } = spy(async () => {
      during = game.pause?.(table) ?? null;
      return true;
    });

    await deal(game, table, deps);

    expect(during).toBeNull();
  });
});

describe("passing", () => {
  it("takes the price and adds it to the pot", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");
    const { deps, took } = spy();
    await deal(game, table, deps);
    took.mockClear();

    await game.act(table, "ada", { type: "pass" }, deps);

    expect(took).toHaveBeenCalledWith("u-ada", 50);
    expect(table.view(null).pot).toBe(1_050);
  });

  it("refuses a roll that was passed to you", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps } = spy();
    await deal(game, table, deps);
    await game.act(table, "ada", { type: "pass" }, deps);

    await expect(game.act(table, "bob", { type: "pass" }, deps)).rejects.toThrow(TableError);
  });

  it("refuses a pass the player cannot pay for, with the pass still in hand", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");
    const { deps } = spy();
    await deal(game, table, deps);
    const broke = spy(async () => false);

    await expect(game.act(table, "ada", { type: "pass" }, broke.deps)).rejects.toThrow(TableError);

    expect(table.game?.round.holdsPass("ada")).toBe(true);
    expect(table.view(null).pot).toBe(1_000);
  });

  it("hands the price back if the table moved while it was being taken", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");
    const { deps } = spy();
    await deal(game, table, deps);
    const moving = spy(async () => {
      game.timeout?.(table, "ada");
      return true;
    });

    await expect(game.act(table, "ada", { type: "pass" }, moving.deps)).rejects.toThrow(TableError);

    expect(moving.gave).toHaveBeenCalledWith("u-ada", 50);
    expect(table.view(null).pot).toBe(1_000);
  });
});

describe("settling", () => {
  it("pays the last one standing the whole pot, passes from every round included", async () => {
    const draws = [1, 1];
    const game = deathRollAdapter({ roll: () => draws.shift() as number });
    const table = seated(game, "ada", "bob", "cat");
    const { deps, took, gave, finished } = spy();
    await deal(game, table, deps);

    await game.act(table, "ada", { type: "pass" }, deps);
    await game.act(table, "bob", { type: "roll" }, deps);
    table.nextRound();
    await game.act(table, table.game?.round.toRoll as string, { type: "roll" }, deps);

    expect(game.isSettled(table)).toBe(true);
    await game.settle(table, deps);

    expect(sum(gave.mock.calls)).toBe(sum(took.mock.calls));
    expect(sum(gave.mock.calls)).toBe(1_550);
    const record = finished.mock.calls[0]?.[0] as { players: { net: number }[] };
    expect(record.players.reduce((total, one) => total + one.net, 0)).toBe(0);
  });

  it("never touches an account at a table playing for nothing, over a whole game", async () => {
    const draws = [1, 1];
    const game = deathRollAdapter({ roll: () => draws.shift() as number });
    const table = game.create("ABCDE", { forFun: true, buyIn: 500, maxSeats: 6 }) as Table;
    for (const name of ["ada", "bob", "cat"]) {
      table.join(name, name, null);
      table.setReady(name, true, 0);
    }
    const { deps, took, gave, finished } = spy();

    await deal(game, table, deps);
    await game.act(table, "ada", { type: "roll" }, deps);
    table.nextRound();
    await game.act(table, table.game?.round.toRoll as string, { type: "roll" }, deps);
    await game.settle(table, deps);

    expect(took).not.toHaveBeenCalled();
    expect(gave).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
    const purses = ["ada", "bob", "cat"].map((name) => table.purseFor(name));
    expect(purses.reduce((a, b) => a + b, 0)).toBe(30_000);
  });
});

describe("the clock", () => {
  it("rolls for a player whose time ran out, even one who could have passed", async () => {
    const game = deathRollAdapter({ roll: () => 400 });
    const table = seated(game, "ada", "bob");
    const { deps } = spy();
    await deal(game, table, deps);

    game.timeout?.(table, "ada");

    expect(table.view(null).ceiling).toBe(400);
    expect(table.game?.round.holdsPass("ada")).toBe(true);
  });

  it("deals at once when everybody is ready", () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");

    expect(game.pause?.(table)).toMatchObject({ key: "deal", ms: 0 });
  });

  it("keeps the countdown's key even after it has run out, so the room still runs it", () => {
    /*
     * The room only runs a pause if the table is still waiting on the same key
     * when the timer fires. A countdown that became "deal" at that instant
     * would never be run, and the table would sit there with people ready.
     */
    vi.useFakeTimers();
    try {
      const game = deathRollAdapter({ roll: () => 500, countdownMs: 20_000 });
      const table = game.create("ABCDE", { buyIn: 500, maxSeats: 6 }) as Table;
      for (const name of ["ada", "bob", "cat"]) {
        table.join(name, name, who(`u-${name}`));
      }
      table.setReady("ada", true, Date.now());
      table.setReady("bob", true, Date.now());

      const armed = game.pause?.(table);
      expect(armed?.key).toBe("countdown");

      vi.advanceTimersByTime(armed?.ms ?? 0);
      const firing = game.pause?.(table);
      expect(firing?.key).toBe("countdown");

      firing?.run();
      expect(table.takePending()).toEqual(["ada", "bob"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows who went out before starting the next round, and leaves a finished game up", async () => {
    const draws = [1, 1];
    const game = deathRollAdapter({ roll: () => draws.shift() as number });
    const table = seated(game, "ada", "bob", "cat");
    const { deps } = spy();
    await deal(game, table, deps);

    await game.act(table, "ada", { type: "roll" }, deps);
    const between = game.pause?.(table);
    expect(between?.key).toBe("round");
    between?.run();

    await game.act(table, table.game?.round.toRoll as string, { type: "roll" }, deps);
    expect(game.pause?.(table)?.key).toBe("result");
  });
});

describe("moves", () => {
  it("takes a ready press between games, and refuses a roll when there is none", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = game.create("ABCDE", { buyIn: 500 }) as Table;
    table.join("ada", "ada", who("u-ada"));
    const { deps } = spy();

    await game.act(table, "ada", { type: "ready", ready: true }, deps);

    expect(table.readiness.isReady("ada")).toBe(true);
    await expect(game.act(table, "ada", { type: "roll" }, deps)).rejects.toThrow(TableError);
  });
});
```

In `games/death-roll/src/listing.test.ts`, the test `"is open, and a duel"` asserts `maxSeats` is 2. Change it to:

```ts
  it("is open, and seats two to six", () => {
    expect(DEATH_ROLL.open).toBe(true);
    expect(DEATH_ROLL.minSeats).toBe(2);
    expect(DEATH_ROLL.maxSeats).toBe(6);
    expect(DEATH_ROLL.blurb).toBe("Halve the number or pay. Roll a one and you're out.");
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run games/death-roll/src/table.test.ts games/death-roll/src/adapter.test.ts games/death-roll/src/listing.test.ts`
Expected: FAIL. `setReady`, `askForGame` and `begin(players)` do not exist, `maxSeats` is 2, and the adapter still deals duels.

- [ ] **Step 3: Replace the listing, the table and the adapter**

Replace all of `games/death-roll/src/listing.ts` with:

```ts
import type { GameListing } from "@backroom/core";

/** How Death Roll lists itself in the room. */
export const DEATH_ROLL: GameListing = {
  id: "death-roll",
  name: "Death Rolling",
  blurb: "Halve the number or pay. Roll a one and you're out.",
  shape: "table",
  /*
   * Two to six. Two is the duel death roll always was, and it is still the
   * last round of every bigger game; six is what a phone's seat grid holds
   * without scrolling. Never one: a chips game does not run for one player,
   * and this one has no bank to play against.
   */
  minSeats: 2,
  maxSeats: 6,
  mark: { text: "DEATH ROLL", accentAt: 0 },
  /*
   * The same values theme.css sets, repeated because the link cards are drawn
   * on the server where there is no stylesheet to read. They have to agree.
   */
  theme: { wall: "#16141c", felt: "#241f33", accent: "#6b4bd6", accentHi: "#b39cff" },
  open: true,
};

/**
 * What a game may be played for.
 *
 * A list rather than a range, for the reason poker's is: a room where every
 * table is a different odd size is a room nobody can read at a glance. Every
 * level divides by ten, which is what keeps a pass price a whole number of
 * chips at all of them.
 */
export const STAKES = [100, 500, 1_000, 5_000] as const;

/** What a game costs unless the host says otherwise. */
export const ANTE = 500;

/**
 * Where a game's first round starts.
 *
 * A thousand is the number everybody who has played this before expects, and
 * the other two are an evening's difference either side of it.
 */
export const CEILINGS = [100, 1_000, 10_000] as const;

/** The opening ceiling unless the host says otherwise. */
export const OPENING = 1_000;

/**
 * Where every round after the first starts, whatever the table opened at.
 *
 * What keeps a full table near thirty rolls rather than forty: a round from a
 * thousand averages eight and a half rolls, and one from a hundred six.
 */
export const RESET_CEILING = 100;

/**
 * What a pass costs, as a fraction of the ante.
 *
 * A tenth. With a pass that cannot be handed back, that puts the first pass at
 * ceiling 3 in a duel and 8 at six players, and nobody ever passes above 8 —
 * see odds.ts, which solves it.
 */
export const PASS_DIVISOR = 10;

/** Play money handed to a seat at a for-fun table, which dies with the table. */
export const FUN_PURSE = 10_000;

/** How long somebody has to act before the table rolls for them. */
export const TURN_MS = 30_000;

/** How long a finished game stays up to be read. */
export const RESULT_MS = 5_000;

/** How long the felt shows who just went out before the next round starts. */
export const ROUND_MS = 3_000;

/**
 * How long a table waits, once two are ready, for the rest to say they are in.
 *
 * The thing that stops a ready button being a way to hold a table shut: when
 * it runs out, whoever is ready is dealt, and whoever is not sits that game
 * out.
 */
export const COUNTDOWN_MS = 20_000;

/** What a pass costs at this stake. Never nothing, whatever the arithmetic. */
export function passPrice(ante: number): number {
  return Math.max(1, Math.round(ante / PASS_DIVISOR));
}

/**
 * The nearest level to a number, or the default for anything unusable.
 *
 * A number exactly between two levels goes to the lower one: the comparison is
 * strict and the lists are ascending, so the first level at the winning
 * distance is the one that keeps it. Deliberate — a host who asks for
 * something between two stakes is put on the cheaper of them rather than
 * charged up to the dearer, and it is the same answer every time.
 */
function snap(asked: unknown, levels: readonly number[], fallback: number): number {
  const want = typeof asked === "number" && Number.isFinite(asked) ? asked : fallback;
  let best = levels[0] as number;
  for (const level of levels) {
    if (Math.abs(level - want) < Math.abs(best - want)) {
      best = level;
    }
  }
  return best;
}

/**
 * The stake a table actually plays for.
 *
 * Snapped here rather than trusted from the payload, the way poker snaps its
 * buy-in: this is the number that decides how much of somebody's balance is at
 * risk at a table they sat down at, and a client that could name its own would
 * be setting the stakes for other people.
 */
export function anteFor(asked: unknown): number {
  return snap(asked, STAKES, ANTE);
}

/** Where the table's first rounds start, snapped for the same reason. */
export function openingFor(asked: unknown): number {
  return snap(asked, CEILINGS, OPENING);
}
```

Replace all of `games/death-roll/src/table.ts` with:

```ts
import type { BotSkill, PlayTable, Seat, SeatIdentity, TableStatus } from "@backroom/core";
import { Seating, TableError } from "@backroom/core";
import { Game } from "./game.js";
import { COUNTDOWN_MS, FUN_PURSE, passPrice, RESET_CEILING, TURN_MS } from "./listing.js";
import { Readiness } from "./ready.js";
import type { Passed, Rolled } from "./round.js";

/**
 * A death roll table.
 *
 * Two to six seats, a ready button, and one game at a time. What makes it
 * unlike every other table in the building is still that its state change is
 * the money: a game cannot start until the antes are in, and nothing starts one
 * but the table's own clock — so the table asks for a game and the adapter
 * answers, on the next broadcast, once it has taken them.
 */

export type Phase = "waiting" | "playing" | "over";

export interface SeatView {
  id: string;
  name: string;
  connected: boolean;
  /** Sat down while a game was running, and waiting for the next one. */
  waiting: boolean;
  isBot: boolean;
  avatar: string | null;
  accentColor: number | null;
  /** In for the next game. Only meaningful between games. */
  ready: boolean;
  /** Dealt into the game on the felt. */
  inGame: boolean;
  /** Gone out of the game on the felt. */
  out: boolean;
  /** Has spent their pass in the round on the felt. */
  passed: boolean;
  /** Could not cover the ante at the last deal, and sat the game out. */
  short: boolean;
  /** Play money left, at a for-fun table. Null anywhere else. */
  purse: number | null;
}

export interface TableView {
  code: string;
  phase: Phase;
  seats: readonly SeatView[];
  watching: number;
  forFun: boolean;
  maxSeats: number;
  ante: number;
  opening: number;
  passPrice: number;
  /** The number being rolled against; the opening figure between games. */
  ceiling: number;
  pot: number;
  toRoll: string | null;
  turnEndsAt: number | null;
  /** The seat a roll was passed to, while it is still theirs to roll. */
  passedTo: string | null;
  /** Everybody dealt into this game in turn order; between games, everybody seated. */
  order: readonly string[];
  /** Everybody still in, in the round on the felt's turn order. Empty between games. */
  alive: readonly string[];
  /** Which round this is, from one. Zero between games. */
  round: number;
  /** How many rounds this game lasts. Zero between games. */
  rounds: number;
  lastRoll: Rolled | null;
  lastPass: Passed | null;
  /** Every roll of the round on the felt, oldest first. */
  history: readonly Rolled[];
  /** Who went out at the end of the round on the felt, while that is still up. */
  lastOut: string | null;
  winnerIds: readonly string[];
  /** When the countdown deals, between games, if one is running. */
  countdownEndsAt: number | null;
  /** How many seated players are ready, between games. */
  readyCount: number;
  /** Why the table cannot deal at all: fewer than two people sitting at it. */
  waitingFor: "players" | null;
  lastEvent: string | null;
  /** This seat, or null for somebody only watching. */
  you: SeatView | null;
}

export class Table implements PlayTable {
  readonly code: string;
  readonly opening: number;
  readonly ante: number;
  readonly passPrice: number;
  readonly readiness: Readiness;

  forFun = false;
  lastEvent: string | null = null;
  game: Game | null = null;
  turnEndsAt: number | null = null;
  /**
   * Whether somebody is taking the antes right now.
   *
   * Draining the queue stops one request being answered twice, but for the
   * whole of the taking — real writes to a real store — the table looks idle,
   * and a deal armed in that window would take a second set of antes. This is
   * how the table says the work has been handed over but is not finished.
   */
  draining = false;

  private readonly seating: Seating;
  private readonly turnMs: number;
  private readonly purses = new Map<string, number>();
  private readonly shorts = new Set<string>();
  /** Players in the game who asked to go while it was running, dropped when it clears. */
  private readonly leaving = new Set<string>();
  /** Seats the table wants dealt, waiting on somebody to take their antes. */
  private wanted: string[] | null = null;
  /** Who opened the last game's first round, so the next game's opener moves on. */
  private lastOpener: string | null = null;

  constructor(
    code: string,
    maxSeats: number,
    options: { opening: number; ante: number; turnMs?: number; countdownMs?: number },
  ) {
    this.code = code;
    this.seating = new Seating(maxSeats);
    this.opening = options.opening;
    this.ante = options.ante;
    this.passPrice = passPrice(options.ante);
    this.turnMs = options.turnMs ?? TURN_MS;
    this.readiness = new Readiness(options.countdownMs ?? COUNTDOWN_MS);
  }

  // ------------------------------------------------------------- the room

  get seats(): readonly Seat[] {
    return this.seating.seats;
  }
  get hostId(): string | null {
    return this.seating.hostId;
  }
  get isEmpty(): boolean {
    return this.seating.isEmpty;
  }
  get maxSeats(): number {
    return this.seating.limit;
  }
  get watching(): number {
    return this.seating.watching;
  }
  get status(): TableStatus {
    return this.isEmpty ? "over" : "playing";
  }

  /**
   * Standing up mid-game cannot be honoured there and then, for a player in it.
   *
   * Their ante is in the pot and the game has to play out and settle before
   * anybody can be paid — and a winner whose seat had gone would be a pot paid
   * to nobody. So the seat is held, their turns roll on the clock, and it goes
   * when the felt clears.
   */
  readonly leavesMidHand = false;

  private seatIds(): string[] {
    return this.seats.map((seat) => seat.id);
  }

  /**
   * A seat at the table.
   *
   * A chips table insists on knowing who you are; a for-fun one does not. And
   * somebody who sits down while a game is running waits for the next one:
   * dealing them into a game already under way would be dealing them a stake in
   * rounds they never played.
   */
  join(id: string, name: string, identity: SeatIdentity | null): Seat {
    const seat = this.seating.join(id, name, this.status, identity, !this.forFun);
    seat.waiting = this.game !== null;
    this.readiness.sync(this.seatIds(), Date.now());
    return seat;
  }

  /**
   * Sits a bot down.
   *
   * Only at a table playing for nothing: a bot has no account to take chips
   * from or pay them to, so a game won against one at a chips table would be
   * chips out of thin air. And always ready — nobody is going to press the
   * button for it.
   */
  addBot(id: string, name: string, skill: BotSkill): Seat {
    if (!this.forFun) {
      throw new TableError("Bots only sit at tables playing for fun.");
    }
    const seat = this.seating.addBot(id, name, skill);
    seat.waiting = this.game !== null;
    this.readiness.set(id, true, this.seatIds(), Date.now());
    return seat;
  }

  /**
   * Standing somebody up, or promising to.
   *
   * The room reaps a seat once its player has been gone a minute and a half,
   * whatever the table is doing. A player in the game on the felt is held until
   * it clears, for the reason `leavesMidHand` gives. Anybody else — a player
   * waiting for the next game — has nothing on the felt and goes at once.
   */
  removeSeat(seatId: string): void {
    if (this.game !== null && this.game.players.includes(seatId)) {
      this.leaving.add(seatId);
      return;
    }
    this.drop(seatId);
  }

  private drop(seatId: string): void {
    this.leaving.delete(seatId);
    this.seating.remove(seatId);
    this.purses.delete(seatId);
    this.shorts.delete(seatId);
    this.readiness.drop(seatId, this.seatIds(), Date.now());
  }

  disconnect(seatId: string): void {
    this.seating.disconnect(seatId);
  }

  reconnect(seatId: string): Seat {
    // Coming back cancels a held removal: a player on a bad line should not be
    // stood up at the end of a game they are still playing.
    this.leaving.delete(seatId);
    return this.seating.reconnect(seatId);
  }

  watch(socketId: string): void {
    this.seating.watch(socketId);
  }

  unwatch(socketId: string): void {
    this.seating.unwatch(socketId);
  }

  // ------------------------------------------------------------- the game

  get phase(): Phase {
    if (this.game === null) {
      return "waiting";
    }
    return this.game.over ? "over" : "playing";
  }

  /**
   * A player saying they are in for the next game, or no longer.
   *
   * Only between games. Pressing it moves no chips: antes go on at the deal and
   * at no other moment, so a table waiting with people ready is still a table
   * holding nobody's stake.
   */
  setReady(seatId: string, ready: boolean, now: number): void {
    const seat = this.seating.find(seatId);
    if (seat === undefined) {
      throw new TableError("You are not at this table.");
    }
    if (this.game !== null) {
      throw new TableError("You can get ready once this game is over.");
    }
    if (seat.isBot) {
      return;
    }
    this.readiness.set(seatId, ready, this.seatIds(), now);
  }

  get pending(): boolean {
    return this.wanted !== null;
  }

  /**
   * Asks for a game, without starting one.
   *
   * Taking an ante is asynchronous and this is called from a timer, which is
   * not — so the table records who it wants dealt and the adapter takes their
   * antes on the next broadcast.
   */
  askForGame(now: number): void {
    if (this.wanted !== null || this.draining || this.game !== null) {
      return;
    }
    const ready = this.readiness.dealable(this.seatIds(), now);
    if (ready !== null) {
      this.wanted = ready;
    }
  }

  /** Takes the request off the queue, before the adapter's first await. */
  takePending(): string[] | null {
    const wanted = this.wanted;
    this.wanted = null;
    if (wanted !== null) {
      this.draining = true;
    }
    return wanted;
  }

  /**
   * Notes who could not cover the ante, and stands their ready down.
   *
   * They sit this game out, and they are the only ones who do: a player who
   * cannot pay no longer stops a table full of people who can.
   */
  noteShorts(seatIds: readonly string[]): void {
    this.shorts.clear();
    for (const seatId of seatIds) {
      this.shorts.add(seatId);
      this.readiness.set(seatId, false, this.seatIds(), Date.now());
    }
    if (seatIds.length > 0) {
      const names = seatIds.map((seatId) => this.seating.find(seatId)?.name ?? "Somebody");
      this.lastEvent = `${names.join(", ")} could not cover the ante.`;
    }
  }

  /**
   * A deal that fell through: everybody's ready is stood down and the felt says
   * why.
   *
   * The table does not try again on its own. There is nothing to spin: the next
   * attempt happens when people press ready again.
   */
  failDeal(reason: string): void {
    this.readiness.clear();
    this.readyBots();
    this.lastEvent = reason;
  }

  private readyBots(): void {
    const seated = this.seatIds();
    for (const seat of this.seats) {
      if (seat.isBot) {
        this.readiness.set(seat.id, true, seated, Date.now());
      }
    }
  }

  /**
   * Deals a game, with every ante already in.
   *
   * @param players The seats the antes actually came off, in seat order. Passed
   * in rather than worked out here, because whoever took the antes has already
   * answered "who is in this game" and the money rests on that one answer.
   */
  begin(players: readonly string[]): void {
    if (this.game !== null) {
      throw new TableError("A game is already running.");
    }
    if (players.length < 2) {
      throw new TableError("A game needs two people.");
    }
    this.game = new Game(players, this.nextOpener(players), {
      ante: this.ante,
      opening: this.opening,
      passPrice: this.passPrice,
      resetCeiling: RESET_CEILING,
    });
    this.lastOpener = this.game.opener;
    this.readiness.clear();
    this.touchClock();
  }

  /**
   * Who opens the first round: the next player dealt in after whoever opened
   * the last game.
   *
   * The player to act is the underdog, so who opens is worth something, and
   * moving it round the table is the only version of that which is even over an
   * evening.
   */
  private nextOpener(players: readonly string[]): string {
    const seated = this.seatIds();
    const from = this.lastOpener === null ? -1 : seated.indexOf(this.lastOpener);
    if (from !== -1) {
      for (let step = 1; step <= seated.length; step += 1) {
        const seatId = seated[(from + step) % seated.length] as string;
        if (players.includes(seatId)) {
          return seatId;
        }
      }
    }
    return players[0] as string;
  }

  /** Starts the next round, once the felt has shown who went out. */
  nextRound(): void {
    if (this.game === null || !this.game.betweenRounds) {
      return;
    }
    this.game.nextRound();
    this.lastEvent = null;
    this.touchClock();
  }

  /** Clears the felt and puts the table back to waiting for the next game. */
  finish(): void {
    if (this.game === null) {
      return;
    }
    this.game = null;
    this.turnEndsAt = null;
    this.lastEvent = null;
    this.shorts.clear();
    for (const seat of this.seats) {
      seat.waiting = false;
    }
    this.readiness.clear();
    this.readyBots();
    /*
     * Anybody who asked to go during the game, last: the room settles a game
     * the moment it ends and only clears it some seconds later, so by here the
     * pot has been paid to a seat that was still there to be paid.
     */
    for (const seatId of [...this.leaving]) {
      this.drop(seatId);
    }
  }

  /** Puts the clock on whoever is to act, or takes it away. */
  touchClock(): void {
    const game = this.game;
    this.turnEndsAt =
      game === null || game.over || game.round.over ? null : Date.now() + this.turnMs;
  }

  // ------------------------------------------------------------ play money

  /**
   * This seat's play money. Only meaningful at a for-fun table; everywhere else
   * a seat's limit is their account, which this class has no business seeing.
   */
  purseFor(seatId: string): number {
    if (!this.forFun) {
      return Number.MAX_SAFE_INTEGER;
    }
    const purse = this.purses.get(seatId);
    if (purse === undefined) {
      this.purses.set(seatId, FUN_PURSE);
      return FUN_PURSE;
    }
    return purse;
  }

  /** Moves play money. Positive puts chips back, negative takes them. */
  movePurse(seatId: string, by: number): void {
    this.purses.set(seatId, this.purseFor(seatId) + by);
  }

  /** Fills a play purse that cannot cover the next ante. Returns whether it had to. */
  topUp(seatId: string): boolean {
    if (!this.forFun || this.purseFor(seatId) >= this.ante) {
      return false;
    }
    this.purses.set(seatId, FUN_PURSE);
    return true;
  }

  // ----------------------------------------------------------- the picture

  private seatView(seat: Seat): SeatView {
    const game = this.game;
    const round = game?.round ?? null;
    return {
      id: seat.id,
      name: seat.name,
      connected: seat.connected,
      waiting: seat.waiting,
      isBot: seat.isBot,
      avatar: seat.avatar,
      accentColor: seat.accentColor,
      ready: this.readiness.isReady(seat.id),
      inGame: game?.players.includes(seat.id) ?? false,
      out: game?.out.includes(seat.id) ?? false,
      passed: round !== null && round.order.includes(seat.id) && !round.holdsPass(seat.id),
      short: this.shorts.has(seat.id),
      purse: this.forFun ? this.purseFor(seat.id) : null,
    };
  }

  view(forSeatId: string | null): TableView {
    const seats = this.seats.map((seat) => this.seatView(seat));
    const game = this.game;
    const round = game?.round ?? null;
    const seated = this.seatIds();
    const winner = game?.winnerId ?? null;
    return {
      code: this.code,
      phase: this.phase,
      seats,
      watching: this.watching,
      forFun: this.forFun,
      maxSeats: this.maxSeats,
      ante: this.ante,
      opening: this.opening,
      passPrice: this.passPrice,
      ceiling: round?.ceiling ?? this.opening,
      pot: game?.pot ?? 0,
      toRoll: round !== null && !round.over ? round.toRoll : null,
      turnEndsAt: this.turnEndsAt,
      passedTo: round?.passedTo ?? null,
      order: game?.players ?? seated,
      alive: round?.order ?? [],
      round: game?.roundNumber ?? 0,
      rounds: game?.rounds ?? 0,
      lastRoll: round?.lastRoll ?? null,
      lastPass: round?.lastPass ?? null,
      history: round?.history ?? [],
      lastOut: round?.outId ?? null,
      winnerIds: winner === null ? [] : [winner],
      countdownEndsAt: game === null ? this.readiness.countdownEndsAt : null,
      readyCount: game === null ? this.readiness.count(seated) : 0,
      waitingFor: game === null && seated.length < 2 ? "players" : null,
      lastEvent: this.lastEvent,
      you: seats.find((seat) => seat.id === forSeatId) ?? null,
    };
  }
}
```

Replace all of `games/death-roll/src/adapter.ts` with:

```ts
import type { BotMove, GameAdapter, GameDeps, Seat } from "@backroom/core";
import { seatLimit, TableError } from "@backroom/core";
import { choose, thinkingTime } from "./bot.js";
import { anteFor, DEATH_ROLL, openingFor, RESULT_MS, ROUND_MS, TURN_MS } from "./listing.js";
import { passMargin } from "./odds.js";
import { Table } from "./table.js";

/**
 * What the room does with a death roll table.
 *
 * The money needs no bank to be honest: every chip in the pot came off one of
 * the players in the game, and one of them takes it. The timing is the awkward
 * part. A game cannot start until the antes are in, and nothing starts one but
 * the table's own clock; `pause` is synchronous and cannot take an ante, so the
 * table asks for a game and `payOut` — asynchronous, run on every broadcast —
 * takes the antes, deals, and asks the room to send the state again.
 */
export function deathRollAdapter(
  options: {
    /**
     * Where the number comes from. Injected so tests can roll to order; in the
     * server it is `randomInt`, because this game hands the player its whole
     * result every turn — exactly the run of observations that predicts the
     * next one from Math.random.
     */
    roll?: (ceiling: number) => number;
    turnMs?: number;
    resultMs?: number;
    roundMs?: number;
    countdownMs?: number;
  } = {},
): GameAdapter<Table> {
  const roll = options.roll ?? ((ceiling: number) => Math.floor(Math.random() * ceiling) + 1);
  const turnMs = options.turnMs ?? TURN_MS;
  const resultMs = options.resultMs ?? RESULT_MS;
  const roundMs = options.roundMs ?? ROUND_MS;

  /**
   * Chips off a player, wherever this table's chips live: a for-fun table's
   * purse, or a real account. Keeping the two apart is the point — a branch that
   * got it wrong would quietly spend real balances at a table playing for fun.
   */
  const take = async (
    table: Table,
    seat: Pick<Seat, "id" | "userId">,
    chips: number,
    deps: GameDeps,
  ): Promise<boolean> => {
    if (table.forFun) {
      if (table.purseFor(seat.id) < chips) {
        return false;
      }
      table.movePurse(seat.id, -chips);
      return true;
    }
    if (seat.userId === null) {
      throw new TableError("Sign in to play for chips.");
    }
    return await deps.take(seat.userId, chips);
  };

  /** Chips back to a player, from the same two worlds. */
  const give = async (
    table: Table,
    seat: Pick<Seat, "id" | "userId">,
    chips: number,
    deps: GameDeps,
  ): Promise<void> => {
    if (chips <= 0) {
      return;
    }
    if (table.forFun) {
      table.movePurse(seat.id, chips);
      return;
    }
    if (seat.userId !== null) {
      await deps.give(seat.userId, chips);
    }
  };

  /**
   * Every ante back, trying them all even if one fails.
   *
   * One refund failing is no reason to keep the rest of these people's stakes,
   * so each is attempted and the first failure is only raised once all of them
   * have been.
   */
  const refundAll = async (table: Table, seats: readonly Seat[], deps: GameDeps) => {
    let failure: unknown = null;
    for (const seat of seats) {
      try {
        await give(table, seat, table.ante, deps);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== null) {
      throw failure;
    }
  };

  /**
   * The antes in, and a game dealt to whoever paid.
   *
   * Each ready player antes in seat order. A refusal sits that player out and
   * nobody else; a store that throws deals nobody and hands back everything
   * taken; a player who stood up while the antes were being taken gets theirs
   * back and is not dealt. Fewer than two funded deals nobody.
   */
  const antesIn = async (
    table: Table,
    wanted: readonly string[],
    deps: GameDeps,
  ): Promise<boolean> => {
    const funded: Seat[] = [];
    const short: string[] = [];
    for (const seatId of wanted) {
      const seat = table.seats.find((one) => one.id === seatId);
      if (seat === undefined) {
        continue;
      }
      table.topUp(seat.id);
      let paid = false;
      try {
        paid = await take(table, seat, table.ante, deps);
      } catch (error) {
        /*
         * Noted before the refunds rather than after: a refund that throws
         * takes the rest of this with it, and the felt should still say why
         * the table stopped.
         */
        table.failDeal("The table could not take the antes, so nobody was dealt.");
        await refundAll(table, funded, deps);
        throw error;
      }
      if (paid) {
        funded.push(seat);
      } else {
        short.push(seat.id);
      }
    }

    /*
     * Only now is it safe to ask who is still here. A seat that is not in a game
     * is dropped the moment its player leaves, which is the state for every
     * await above — so a player can go between antes, and dealing them in would
     * put a ghost in the turn order whose win nobody could be paid.
     */
    const here = funded.filter((seat) => table.seats.some((one) => one.id === seat.id));
    const gone = funded.filter((seat) => !here.includes(seat));
    if (gone.length > 0) {
      try {
        await refundAll(table, gone, deps);
      } catch (error) {
        table.failDeal("The table could not take the antes, so nobody was dealt.");
        await refundAll(table, here, deps);
        throw error;
      }
    }

    table.noteShorts(short);
    if (here.length < 2) {
      table.failDeal(
        short.length > 0
          ? "Not enough players could cover the ante, so nobody was dealt."
          : "Not enough players are left to deal.",
      );
      await refundAll(table, here, deps);
      return true;
    }
    table.begin(here.map((seat) => seat.id));
    return true;
  };

  return {
    listing: DEATH_ROLL,

    create(code, made) {
      const table = new Table(code, seatLimit(made?.["maxSeats"], DEATH_ROLL.maxSeats), {
        opening: openingFor(made?.["ceiling"]),
        ante: anteFor(made?.["buyIn"]),
        turnMs,
        ...(options.countdownMs === undefined ? {} : { countdownMs: options.countdownMs }),
      });
      // Fixed when the table is opened: a table anybody may sit at and one that
      // spends real chips are not the same game with a different label.
      table.forFun = made?.["forFun"] === true;
      return table;
    },

    async act(table, seatId, action, deps) {
      const move = action as { type?: string; ready?: unknown };
      const seat = table.seats.find((one) => one.id === seatId);
      if (seat === undefined) {
        throw new TableError("You are not at this table.");
      }
      if (move.type === "ready") {
        table.setReady(seatId, move.ready === true, Date.now());
        return;
      }
      const game = table.game;
      if (game === null || game.over || game.round.over) {
        throw new TableError("There is no roll to make right now.");
      }

      switch (move.type) {
        case "roll": {
          game.roll(seatId, roll);
          table.touchClock();
          return;
        }
        case "pass": {
          /*
           * Asked, paid, then spent: a player who cannot afford it is refused
           * with their pass still in hand. And handed straight back if the table
           * moved while the chips were in flight — the clock may have rolled for
           * this seat — since a pass paid for that never reached the pot is
           * chips gone from a game with no bank to lose them from.
           */
          const price = game.round.checkPass(seatId);
          if (!(await take(table, seat, price, deps))) {
            throw new TableError(
              table.forFun ? "That is more than your purse." : "You cannot cover a pass.",
            );
          }
          try {
            game.pass(seatId);
          } catch (error) {
            await give(table, seat, price, deps);
            throw error;
          }
          table.touchClock();
          return;
        }
        default:
          throw new TableError("That is not a move at this table.");
      }
    },

    /**
     * The antes, and the one thing that starts a game here.
     *
     * Drained before the first await, which is what makes running on every
     * broadcast exactly-once. Returns true when it changed the table, so the
     * room sends the state again; false when there was nothing to do.
     */
    async payOut(table, deps) {
      const wanted = table.takePending();
      if (wanted === null) {
        return false;
      }
      try {
        return await antesIn(table, wanted, deps);
      } finally {
        table.draining = false;
      }
    },

    isSettled(table) {
      return table.phase === "over";
    },

    /**
     * Pays the pot to the last one standing: every ante and every pass, out of
     * chips already in it. Seats in the game are held until the felt clears, so
     * the winner is always there to be paid; if one somehow is not, nothing is
     * recorded as though it were.
     */
    async settle(table, deps) {
      const game = table.game;
      if (game === null || !game.over) {
        return;
      }
      const winnerId = game.winnerId as string;
      const winner = table.seats.find((one) => one.id === winnerId);
      if (winner === undefined) {
        throw new Error(`death roll: ${table.code} won by a seat that is gone; pot unpaid`);
      }
      await give(table, winner, game.pot, deps);

      // Play money is paid but never recorded: a for-fun win is nobody's to claim.
      if (table.forFun) {
        return;
      }

      for (const seatId of game.players) {
        const seat = table.seats.find((one) => one.id === seatId);
        if (seat === undefined || seat.userId === null) {
          continue;
        }
        const net = game.netFor(seatId);
        await deps.record(seat.userId, {
          shared: {
            games: 1,
            wins: net > 0 ? 1 : 0,
            chipsWon: net,
            chipsStaked: game.ante + game.spentBy(seatId),
          },
          game: DEATH_ROLL.id,
          // `duels` kept as the key so nobody's history resets; it counts games.
          add: { duels: 1, passes: game.passesBy(seatId) },
          max: { pot: game.pot },
        });
      }

      await deps.finished({
        code: table.code,
        rulesetName: `${table.opening}`,
        buyIn: table.ante,
        pot: game.pot,
        players: game.players.map((seatId) => {
          const seat = table.seats.find((one) => one.id === seatId);
          return {
            userId: seat?.userId ?? null,
            name: seat?.name ?? "Somebody",
            score: game.survivedBy(seatId),
            isBot: seat?.isBot ?? false,
            net: game.netFor(seatId),
          };
        }),
        winnerIds: [winnerId],
        endedAt: Date.now(),
      });
    },

    winners(table) {
      const winner = table.game?.winnerId ?? null;
      return winner === null ? [] : [winner];
    },

    clock(table) {
      const game = table.game;
      const endsAt = table.turnEndsAt;
      if (game === null || game.over || game.round.over || endsAt === null) {
        return null;
      }
      return { seatId: game.round.toRoll, endsAt };
    },

    /**
     * Rolls for somebody whose time ran out — even a roll they could have
     * passed. The clock never spends somebody's pass for them, and never
     * forfeits: a bad connection must not cost a stake.
     */
    timeout(table, seatId) {
      const game = table.game;
      if (game === null || game.over || game.round.over || game.round.toRoll !== seatId) {
        return;
      }
      game.roll(seatId, roll);
      table.touchClock();
    },

    /** A bot's turn, or nothing. Bots only sit at tables playing for fun. */
    botMove(table): BotMove | null {
      const game = table.game;
      if (game === null || game.over || game.round.over) {
        return null;
      }
      const round = game.round;
      const seat = table.seats.find((one) => one.id === round.toRoll);
      if (seat === undefined || !seat.isBot) {
        return null;
      }
      const skill = seat.skill ?? "normal";
      const choice = choose({
        skill,
        players: round.order.length,
        ceiling: round.ceiling,
        toAct: round.position(seat.id),
        holders: round.holders(),
        passedTo: round.passedTo === seat.id,
        margin: passMargin(round.order.length, table.ante, table.passPrice),
        canAfford: table.purseFor(seat.id) >= table.passPrice,
      });
      return {
        seatId: seat.id,
        delayMs: thinkingTime(skill),
        play() {
          // Checked again on the way in: the clock may have rolled for this seat
          // while the bot was thinking, or the round may be over.
          if (table.game !== game || game.round !== round || round.over || round.toRoll !== seat.id) {
            return;
          }
          if (choice === "pass") {
            game.pass(seat.id);
            table.movePurse(seat.id, -table.passPrice);
          } else {
            game.roll(seat.id, roll);
          }
          table.touchClock();
        },
      };
    },

    /**
     * The table's own clock.
     *
     * A finished game is left up to be read, then cleared. A round that just
     * ended shows who went out, then the next one starts. Between games:
     * everybody ready deals at once, and a running countdown deals when it ends.
     *
     * The countdown keeps its own key even once it has run out. The room only
     * runs a pause if the table is still waiting on the same thing when the
     * timer fires — so a countdown that turned into "deal" at that moment would
     * never be run, and the table would sit there with people ready.
     */
    pause(table) {
      if (table.phase === "over") {
        return { key: "result", ms: resultMs, run: () => table.finish() };
      }
      const game = table.game;
      if (game !== null) {
        return game.betweenRounds
          ? { key: "round", ms: roundMs, run: () => table.nextRound() }
          : null;
      }
      if (table.pending || table.draining) {
        return null;
      }
      const seated = table.seats.map((seat) => seat.id);
      const now = Date.now();
      if (seated.length >= 2 && table.readiness.count(seated) === seated.length) {
        return { key: "deal", ms: 0, run: () => table.askForGame(Date.now()) };
      }
      const endsAt = table.readiness.countdownEndsAt;
      if (endsAt !== null) {
        return {
          key: "countdown",
          ms: Math.max(0, endsAt - now),
          run: () => table.askForGame(Date.now()),
        };
      }
      return null;
    },
  };
}
```

- [ ] **Step 4: Delete the duel and the old helpers**

```bash
git rm games/death-roll/src/duel.ts games/death-roll/src/duel.test.ts
```

In `games/death-roll/src/odds.ts`, delete everything from the comment beginning `The duel's old one-shot pass arithmetic, kept only until Task 6` to the end of the file: `passGain`, `passCost` and `worthPassing`.

In `games/death-roll/src/bot.ts`:
- delete `NERVE` and `decide`, with their doc comments;
- change the import to `import { roundFor } from "./odds.js";`;
- rewrite the file's top doc comment, which describes the duel's bot, to describe a bot at a table of two to six that reads the solved round.

In `games/death-roll/src/bot.test.ts`, delete every `describe` block that calls `decide`. Keep the `thinkingTime` tests and the `choose` tests, and remove `decide` from the import.

- [ ] **Step 5: Replace the package's exports**

Replace all of `games/death-roll/src/index.ts` with:

```ts
/**
 * Death rolling: two to six people, and a number that only goes down.
 *
 * The whole game in one package — the solved round, a round, a game, who is
 * ready, the table and its bot. It borrows seating and the shape of a table
 * from @backroom/core and brings everything that makes it this game.
 */
export type { RoundSolution, SolveOptions } from "./odds.js";
export { EXACT_CEILING, edge, lossOdds, passMargin, roundFor, solveRound } from "./odds.js";
export type { Passed, Rolled } from "./round.js";
export { Round } from "./round.js";
export { Game } from "./game.js";
export { Readiness } from "./ready.js";
export type { Phase, SeatView, TableView } from "./table.js";
export { Table } from "./table.js";
export type { Choice } from "./bot.js";
export { choose, thinkingTime, WARINESS } from "./bot.js";
export {
  ANTE,
  CEILINGS,
  COUNTDOWN_MS,
  DEATH_ROLL,
  FUN_PURSE,
  OPENING,
  PASS_DIVISOR,
  RESET_CEILING,
  RESULT_MS,
  ROUND_MS,
  STAKES,
  TURN_MS,
  anteFor,
  openingFor,
  passPrice,
} from "./listing.js";
export { deathRollAdapter } from "./adapter.js";
```

- [ ] **Step 6: Run the package and watch it pass**

Run: `npx vitest run games/death-roll`
Expected: PASS.

- [ ] **Step 7: A three-player game over sockets — failing first**

In `apps/server/src/deathroll.socket.test.ts`:
- remove the `DEAL_MS` import;
- keep `startRoom`, `client`, `stateWhere`, `open_` and `join` as they are;
- add this helper beside them:

```ts
/** Says this seat is in for the next game. */
function ready(socket: Client): Promise<void> {
  return new Promise((resolve) =>
    socket.emit("game:action", { type: "ready", ready: true }, () => resolve()),
  );
}
```

Replace the first two `it` blocks, but not the bot one, with:

```ts
  it("deals three players once they are all ready, and pays the last one standing", async () => {
    // A roller that always returns 1, so every roll puts somebody out.
    const { store, port, ids } = await startRoom(["Ada", "Bo", "Cy"], { roll: () => 1 });
    const accounts = new Map<string, string>();

    const host = await client(port);
    const ack = await open_(host, "Ada", { buyIn: 500, ceiling: 1_000 });
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const bo = await client(port);
    const cy = await client(port);
    await join(bo, "Bo", ack.code);
    await join(cy, "Cy", ack.code);
    accounts.set(host.id as string, ids[0] as string);
    accounts.set(bo.id as string, ids[1] as string);
    accounts.set(cy.id as string, ids[2] as string);
    const sockets = new Map([
      [host.id as string, host],
      [bo.id as string, bo],
      [cy.id as string, cy],
    ]);

    await Promise.all([ready(host), ready(bo), ready(cy)]);

    // Antes go on at the deal and not before.
    const playing = await stateWhere(host, (view) => view.phase === "playing");
    expect(playing.pot).toBe(1_500);
    for (const account of accounts.values()) {
      expect((await store.get(account))?.chips).toBe(STARTING_CHIPS - 500);
    }

    const first = playing.toRoll as string;
    await new Promise<void>((resolve) =>
      sockets.get(first)?.emit("game:action", { type: "roll" }, () => resolve()),
    );

    // The felt shows who went out, then the next round starts at 100.
    const second = await stateWhere(host, (view) => view.round === 2 && view.toRoll !== null, 8_000);
    expect(second.ceiling).toBe(100);
    const next = second.toRoll as string;
    await new Promise<void>((resolve) =>
      sockets.get(next)?.emit("game:action", { type: "roll" }, () => resolve()),
    );

    const over = await stateWhere(host, (view) => view.phase === "over", 8_000);
    const winner = over.winnerIds[0] as string;
    expect([first, next]).not.toContain(winner);

    for (const [seatId, account] of accounts) {
      const expected = seatId === winner ? STARTING_CHIPS + 1_000 : STARTING_CHIPS - 500;
      await expect.poll(async () => (await store.get(account))?.chips).toBe(expected);
    }
  }, 20_000);

  it("takes nothing from anybody while nobody is ready", async () => {
    const { store, port, ids } = await startRoom(["Ada", "Bo"]);
    const host = await client(port);
    const ack = await open_(host, "Ada", { buyIn: 500 });
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const bo = await client(port);
    await join(bo, "Bo", ack.code);
    await stateWhere(host, (view) => view.seats.length === 2);

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect((await store.get(ids[0] as string))?.chips).toBe(STARTING_CHIPS);
    expect((await store.get(ids[1] as string))?.chips).toBe(STARTING_CHIPS);
    expect(host.latest?.phase).toBe("waiting");
    expect(host.latest?.pot).toBe(0);
  });
```

Run: `npx vitest run apps/server/src/deathroll.socket.test.ts`
Expected: PASS once Steps 3–5 are in. If it fails, the failure message lists every phase the socket saw — read that before changing anything. The server needs no change: actions reach `adapter.act` through the envelope it already has.

- [ ] **Step 8: The smallest change that keeps the page playable**

`apps/web/src/deathroll/DeathRoll.tsx` reads fields the view no longer has. Make only these changes; the real felt is Task 7.

1. Every `state.phase === "dueling"` becomes `state.phase === "playing"`. That is the Navbar `confirm`, `myTurn`, the odds line and the pot line.
2. The odds line uses the duel's formula, which is only right for two players with nobody holding a pass. Until Task 7 replaces it, show it only in that case:

```tsx
        {state.phase === "playing" &&
        state.alive.length === 2 &&
        state.seats.every((seat) => !seat.inGame || seat.passed) ? (
```

   Keep the existing `<p className="dr__odds">` body.
3. `Seats` pads to two with empty slots. Pad to `state.maxSeats` instead:

```tsx
  while (slots.length < state.maxSeats) {
```

4. Replace `Standing`'s `waiting` branch, which reads the removed `waitingFor === "funds"` and `shortId`, with:

```tsx
  if (state.phase === "waiting") {
    return (
      <p className="dr__standing" role="status">
        {state.waitingFor === "players"
          ? "Waiting for players."
          : `${state.readyCount} of ${state.seats.length} ready.`}
      </p>
    );
  }
```

5. Replace `Standing`'s `over` branch, which reads the removed `loserId`, with:

```tsx
  if (state.phase === "over") {
    const winner = state.winnerIds.length === 0 ? null : nameOf(state, state.winnerIds[0] as string);
    return (
      <p className="dr__standing" role="status">
        {winner === null ? "" : `${winner} takes the pot.`}
      </p>
    );
  }
```

6. Add a ready control, shown between games to a seated player. Put it directly after `</div>` closing `dr__stage`:

```tsx
      {state.phase === "waiting" && mine !== null ? (
        <div className="dr__controls">
          <button
            type="button"
            className="btn dr__roll"
            disabled={table.busy}
            onClick={() => table.act({ type: "ready", ready: !mine.ready })}
          >
            {mine.ready ? "Not ready" : "I'm ready"}
          </button>
        </div>
      ) : null}
```

In `apps/web/src/deathroll/DeathRoll.test.tsx` and `apps/web/src/deathroll/useIntent.test.ts`, the view fixtures build the old shape. In each fixture:
- replace `phase: "dueling"` with `phase: "playing"`;
- delete `loserId` and `shortId`;
- add these fields:

```ts
  passedTo: null,
  order: ["ada", "bob"],
  alive: ["ada", "bob"],
  round: 1,
  rounds: 1,
  lastOut: null,
  countdownEndsAt: null,
  readyCount: 0,
```

Use the seat ids the fixture already uses. Change `waitingFor: "opponent"` to `waitingFor: "players"`. Seat fixtures gain `ready: false, inGame: true, out: false, short: false`.

Update the copy expectations: "waiting for an opponent" becomes "Waiting for players.", and an over-state test expects "takes the pot."

Run: `npx vitest run apps/web/src/deathroll`
Expected: PASS.

- [ ] **Step 9: Say it in the house rules**

In `CLAUDE.md`, under `### A table that deals itself`, the paragraph currently reads *"Games run on their own clock. Nobody presses start, a round comes round, and players sit down and leave whenever they like."*. Add this sentence directly after *"players sit down and leave whenever they like."*:

```
A table may ask whoever is sitting down whether they are in, so long as its
own clock deals anyway once enough of them are — a ready button that one idle
player can hold shut is a table that has stopped dealing itself.
```

- [ ] **Step 10: The whole suite, typecheck, lint**

```bash
npx biome format --write games/death-roll/src apps/server/src/deathroll.socket.test.ts apps/web/src/deathroll CLAUDE.md
npm test
npm run typecheck
npm run lint
```

`npm test` may fail only on the known TileArt test. `grep -rn "dueling\|shortId\|loserId\|DEAL_MS\|SHORT_RETRY_MS\|worthPassing\|decide(" games apps --include=*.ts --include=*.tsx` must print nothing.

- [ ] **Step 11: Commit**

```bash
git add -A games/death-roll apps/server/src/deathroll.socket.test.ts apps/web/src/deathroll CLAUDE.md
git commit -m "feat(death-roll): two to six at a table, dealt when they say they are in

The table and adapter move onto the solved round, the round, the game and
readiness. A game is rounds of elimination; the pot is every ante and every
pass and goes to the last one standing. Antes are taken at the deal from
whoever is ready: a player who cannot pay sits that game out rather than
stopping it, a store failure hands everything back, and a failed deal
never retries by itself.

The countdown keeps its own pause key even after it runs out. The room
only runs a pause still waiting on the same thing when its timer fires,
so a countdown that became a deal at that moment would never deal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The felt — rail, grid, and the ready screen

The layout picked in brainstorming, built on the Task 6 view:

- **Desktop: a rail of seats** down the left, in turn order, with the number centred in the rest of the felt.
- **Phone: a two-column grid** of seats above the number, with the controls along the bottom.
- **Either way, the felt fills the height** below the header instead of stacking against the top.

Two pure helpers carry the logic, so it can be tested without rendering: the solver's odds readout, and the sentence that spells out the move.

**Files:**
- Create: `apps/web/src/deathroll/lines.ts`
- Test: `apps/web/src/deathroll/lines.test.ts`
- Modify: `apps/web/src/deathroll/DeathRoll.tsx` and `DeathRoll.test.tsx`
- Modify: `apps/web/src/deathroll/deathroll.css` — confirm `DeathRoll.tsx` imports it before adding a rule

**Interfaces:**
- Consumes: `TableView` and `SeatView` (Task 6); `roundFor` and `passMargin` (Task 1).
- Produces:
  - `goesOut(state: TableView): number | null` — the chance the player to roll goes out this round
  - `moveLine(state: TableView, seatId: string | null): string | null` — the move in words

**Before writing anything:** invoke the `frontend-design` skill, and read `apps/web/src/deathroll/DeathRoll.tsx` in full. The layout reference is `docs/superpowers/specs/2026-09-14-death-roll-six-seats-design.md`, section *The felt*.

- [ ] **Step 1: Write the failing helper tests**

Create `apps/web/src/deathroll/lines.test.ts`:

```ts
import { lossOdds } from "@backroom/game-death-roll";
import type { SeatView, TableView } from "@backroom/game-death-roll";
import { describe, expect, it } from "vitest";
import { goesOut, moveLine } from "./lines.js";

const seat = (id: string, over: Partial<SeatView> = {}): SeatView => ({
  id,
  name: id[0]?.toUpperCase() + id.slice(1),
  connected: true,
  waiting: false,
  isBot: false,
  avatar: null,
  accentColor: null,
  ready: false,
  inGame: true,
  out: false,
  passed: false,
  short: false,
  purse: null,
  ...over,
});

const playing = (over: Partial<TableView> = {}): TableView => ({
  code: "ABCDE",
  phase: "playing",
  seats: [seat("ada"), seat("bob"), seat("cat")],
  watching: 0,
  forFun: false,
  maxSeats: 6,
  ante: 500,
  opening: 1_000,
  passPrice: 50,
  ceiling: 12,
  pot: 1_500,
  toRoll: "ada",
  turnEndsAt: null,
  passedTo: null,
  order: ["ada", "bob", "cat"],
  alive: ["ada", "bob", "cat"],
  round: 1,
  rounds: 2,
  lastRoll: null,
  lastPass: null,
  history: [],
  lastOut: null,
  winnerIds: [],
  countdownEndsAt: null,
  readyCount: 0,
  waitingFor: null,
  lastEvent: null,
  you: null,
  ...over,
});

describe("the odds under the number", () => {
  it("is the duel's closed form when two are left and nobody holds a pass", () => {
    const state = playing({
      seats: [seat("ada", { passed: true }), seat("bob", { passed: true })],
      alive: ["ada", "bob"],
      order: ["ada", "bob"],
      ceiling: 40,
    });

    expect(goesOut(state)).toBeCloseTo(lossOdds(40), 12);
  });

  it("is nothing between games or between rounds", () => {
    expect(goesOut(playing({ phase: "waiting", toRoll: null }))).toBeNull();
    expect(goesOut(playing({ toRoll: null }))).toBeNull();
  });

  it("is a real chance of going out at a table of three", () => {
    const chance = goesOut(playing()) as number;

    expect(chance).toBeGreaterThan(0);
    expect(chance).toBeLessThan(1);
  });
});

describe("the move, in words", () => {
  it("offers you the pass, naming who it would land on", () => {
    expect(moveLine(playing(), "ada")).toBe("Your roll — roll it, or pass it to Bob");
  });

  it("tells you that you must roll a roll passed to you", () => {
    const state = playing({
      toRoll: "bob",
      passedTo: "bob",
      lastPass: { seatId: "ada", paid: 50, to: "bob" },
    });

    expect(moveLine(state, "bob")).toBe("Your roll — Ada passed it to you, so you must roll");
    expect(moveLine(state, "cat")).toBe("Bob's roll — Ada passed it to them, so they must roll");
  });

  it("does not offer a pass you have already spent", () => {
    const state = playing({ seats: [seat("ada", { passed: true }), seat("bob"), seat("cat")] });

    expect(moveLine(state, "ada")).toBe("Your roll");
  });

  it("names whoever is to roll for everybody else", () => {
    expect(moveLine(playing(), "bob")).toBe("Ada to roll");
  });

  it("says nothing when nobody is to roll", () => {
    expect(moveLine(playing({ toRoll: null }), "ada")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/web/src/deathroll/lines.test.ts`
Expected: FAIL — cannot resolve `./lines.js`.

- [ ] **Step 3: Write the helpers**

Create `apps/web/src/deathroll/lines.ts`:

```ts
import type { TableView } from "@backroom/game-death-roll";
import { passMargin, roundFor } from "@backroom/game-death-roll";

/**
 * What the felt says about a round, worked out rather than drawn.
 *
 * Kept apart from the component so the words and the odds can be tested
 * without rendering anything — and because both are displays of rules the
 * table enforces, never the thing enforcing them.
 */

const nameOf = (state: TableView, seatId: string) =>
  state.seats.find((seat) => seat.id === seatId)?.name ?? "Somebody";

/**
 * The chance the player to roll goes out this round, if everybody plays well.
 *
 * Read from the same solved round the bot plays, so the number on the felt is
 * the number the game is actually played to. Null when nobody is to roll.
 */
export function goesOut(state: TableView): number | null {
  if (state.phase !== "playing" || state.toRoll === null) {
    return null;
  }
  const at = state.alive.indexOf(state.toRoll);
  if (at === -1 || state.alive.length < 2) {
    return null;
  }
  let holders = 0;
  state.alive.forEach((seatId, position) => {
    const seat = state.seats.find((one) => one.id === seatId);
    if (seat !== undefined && !seat.passed) {
      holders |= 1 << position;
    }
  });
  const players = state.alive.length;
  const round = roundFor(players, passMargin(players, state.ante, state.passPrice));
  return round.risk(state.ceiling, at, holders, state.passedTo === state.toRoll)[at] ?? null;
}

/**
 * The move, spelled out.
 *
 * With a pass that cannot be handed back, where a pass lands is the thing a
 * player has to read, so the line names it; and a roll that arrived by a pass
 * says so, since that is why the pass button is not there.
 */
export function moveLine(state: TableView, seatId: string | null): string | null {
  const toRoll = state.toRoll;
  if (toRoll === null) {
    return null;
  }
  const mine = toRoll === seatId;
  const forced = state.passedTo === toRoll && state.lastPass !== null;
  if (forced) {
    const passer = nameOf(state, (state.lastPass as { seatId: string }).seatId);
    return mine
      ? `Your roll — ${passer} passed it to you, so you must roll`
      : `${nameOf(state, toRoll)}'s roll — ${passer} passed it to them, so they must roll`;
  }
  if (!mine) {
    return `${nameOf(state, toRoll)} to roll`;
  }
  const holds = state.seats.find((seat) => seat.id === toRoll)?.passed === false;
  const at = state.alive.indexOf(toRoll);
  const next = state.alive[(at + 1) % state.alive.length];
  return holds && next !== undefined
    ? `Your roll — roll it, or pass it to ${nameOf(state, next)}`
    : "Your roll";
}
```

- [ ] **Step 4: Run the helper tests and watch them pass**

Run: `npx vitest run apps/web/src/deathroll/lines.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing felt tests**

Add to `apps/web/src/deathroll/DeathRoll.test.tsx`, using that file's own `view()` and `seat()` fixtures and render helpers:

- **The seat list is in turn order and marks each seat's state.** Render a playing view in which one seat is out, one has passed, and one is to roll. Assert each seat's name is present and the out seat carries a visible "out" marker.
- **Pass is absent on a roll passed to you.** Render `toRoll: you`, `passedTo: you`, `lastPass` from another seat. Assert there is no Pass button and the text "so you must roll" is on screen.
- **The readout comes from the solver.** Render a playing view and assert the text "goes out this round" with a percentage to one decimal place.
- **The ready screen.** Render `phase: "waiting"` with `countdownEndsAt` set, `readyCount: 2`, four seats, and `maxSeats: 6`. Assert:
  - the countdown reads "Dealing in" and names "2 of 4 ready";
  - an "I'm ready" button is present;
  - two open seats are drawn.
- **Between rounds.** Render `toRoll: null`, `lastOut` set and `round: 2`. Assert "{name} is out".
- **Hosting offers seats.** Render the lobby, `Sit`. Assert a seat picker offering 2, 4 and 6 is present, and that opening a table sends `maxSeats`.

These are assertions to write against the file's existing harness, not placeholders. Every one must end up as executing code.

Run: `npx vitest run apps/web/src/deathroll/DeathRoll.test.tsx`
Expected: FAIL on each new case.

- [ ] **Step 6: Build the felt**

In `DeathRoll.tsx`:

- **Seats** render `state.order` (turn order), each seat showing:
  - avatar and name, with "(you)" for this seat;
  - "bot" for a bot;
  - "ready" or "not ready" between games;
  - "pass" if it still holds one in the round, "passed" if it has spent it;
  - "out", struck through and faded;
  - "your roll", or "must roll" when `passedTo` is that seat;
  - "short of the ante" when `short`;
  - play money at a for-fun table.

  Between games, pad to `state.maxSeats` with dashed "Open seat" slots.
- **The stage:**
  - `Falling` in the middle, showing the ceiling, or the opening ceiling dimmed between games;
  - under it, `moveLine(state, seatId)`;
  - then `goesOut(state)`, as "You go out this round: X%" or "{Name} goes out this round: X%", to one decimal place;
  - then `Pot {pot} · round {round} of {rounds}`.
- **Between games:** "Waiting for players." when `waitingFor === "players"`. Otherwise, while `countdownEndsAt` is set, "Dealing in {N}s — {readyCount} of {seats.length} ready" (use the existing `apps/web/src/game/useCountdown.ts` for the ticking seconds). Otherwise "{readyCount} of {seats.length} ready".
- **Between rounds** (`phase === "playing"` and `toRoll === null`, `lastOut` set): "{Name} is out", with one short motion on that seat.
- **Controls**, in one place for every phase:
  - Roll, and Pass naming the price, on your turn;
  - Pass absent when `passedTo === seatId` or `you.passed`;
  - "I'm ready" or "Not ready" between games, in the same slot Roll uses during play.
- **Bots** ("Deal somebody in") only between games, at a for-fun table with a free seat.
- **Hosting:** in `Sit`, add `<SeatCount value={seats} onChange={setSeats} ceiling={DEATH_ROLL.maxSeats} />` (from `../table/SeatCount.js`, default 6), and send `maxSeats: seats` in `table.create`. The house picker offers 2, 4 and 6 at a ceiling of 6. That is deliberate: it is the room's own control.

In `deathroll.css`:

- **The squish fix:** `.dr` fills the height below the header — `min-height: calc(100dvh - <header height>)` using the header's own variable if one exists, else a `clamp` — as a grid whose stage row takes the free space, with the stage centred in it and a real gap between the header and the seats.
- **The rail:** `@container (min-width: 640px)` lays the felt out as two columns, the seat rail about 160–200px and the stage filling the rest, with the controls under the number in that column.
- **Below 640px:** seats in a two-column grid above the number; controls `position: sticky; bottom: 0` within thumb reach, at least 44px tall.
- **Seat states:**
  - out: faded and struck through;
  - to roll: lit border;
  - must roll: the accent;
  - open seat: dashed.
- **Nothing scrolls sideways.** The roll history keeps its own `overflow-x: auto`.
- **One short motion** for a seat going out. Add its class to the existing `@media (prefers-reduced-motion: reduce)` block.

- [ ] **Step 7: Run it and watch it pass**

Run: `npx vitest run apps/web/src/deathroll`
Expected: PASS.

- [ ] **Step 8: Typecheck, lint, format, commit**

```bash
npx biome format --write apps/web/src/deathroll
npm run typecheck
npm run lint
git add apps/web/src/deathroll
git commit -m "feat(web): a rail of seats on a desk, a grid on a phone, and a felt that fills the room

The felt takes the height below the header with the number centred in it,
rather than stacking against the top with the seats flush under the
header. Seats run in turn order, because with a pass that cannot be handed
back where a pass lands is the thing to read, and the line under the
number names it. The odds come from the same solved round the bot plays.

Between games the felt is the ready screen: seats ready or not, open
seats dashed, the countdown, and the ready button where Roll sits during
play.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: A ready press that lands at once, checked on a real screen

A ready press is the player's own choice, so it can show at once. It is replaced by the table's word when that arrives, and given up if refused or never answered — the same bargain the roll and the pass already keep. This task also proves the whole felt in a browser, at a desk and at 375px.

**Files:**
- Modify: `apps/web/src/deathroll/useIntent.ts`, `useIntent.test.ts`
- Modify: `apps/web/src/deathroll/DeathRoll.tsx` (use the intent for the ready button)

**Interfaces:**
- Consumes: the Task 6 view (`you.ready`, `phase`) and Task 7's ready button.
- Produces: `Intent` gains `readying: boolean | null` (the ready state shown ahead of the table) and `ready(next: boolean): void`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/deathroll/useIntent.test.ts`, using its existing view fixture set to `phase: "waiting"` with `you` a seat whose `ready` is false:

```ts
describe("pressing ready", () => {
  it("shows ready on the press, before the table has answered", () => {
    const act = vi.fn();
    const { result } = renderHook(() => useIntent(waiting(), "ada", act, null));

    act_(() => result.current.ready(true));

    expect(result.current.readying).toBe(true);
    expect(act).toHaveBeenCalledWith({ type: "ready", ready: true });
  });

  it("gives way to the table once it agrees", () => {
    const act = vi.fn();
    const { result, rerender } = renderHook(
      ({ state }: { state: TableView }) => useIntent(state, "ada", act, null),
      { initialProps: { state: waiting() } },
    );
    act_(() => result.current.ready(true));

    rerender({ state: waiting({ you: { ...waiting().you!, ready: true } }) });

    expect(result.current.readying).toBeNull();
  });

  it("is given up the moment the table refuses it", () => {
    const act = vi.fn();
    const { result, rerender } = renderHook(
      ({ error }: { error: string | null }) => useIntent(waiting(), "ada", act, error),
      { initialProps: { error: null as string | null } },
    );
    act_(() => result.current.ready(true));

    rerender({ error: "You can get ready once this game is over." });

    expect(result.current.readying).toBeNull();
  });

  it("is given up if no answer ever comes", () => {
    vi.useFakeTimers();
    try {
      const act = vi.fn();
      const { result } = renderHook(() => useIntent(waiting(), "ada", act, null));
      act_(() => result.current.ready(true));

      act_(() => {
        vi.advanceTimersByTime(PATIENCE_MS + 1);
      });

      expect(result.current.readying).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

Name the fixture helper `waiting(overrides)`, beside the file's existing playing fixture. `act_` is `@testing-library/react`'s `act`: follow whatever the file already calls it. **Hold the reply in every test.** A reply that resolves at once proves nothing about a bad connection.

Run: `npx vitest run apps/web/src/deathroll/useIntent.test.ts`
Expected: FAIL — `ready` and `readying` do not exist.

- [ ] **Step 2: Extend the intent**

In `useIntent.ts`:
- add `{ kind: "ready"; ready: boolean }` to `Sent`;
- `ready(next)` sends `{ type: "ready", ready: next }` through the existing `send`, so it gets the same `PATIENCE_MS` wind-down;
- the answered-check effect clears a `ready` intent when `state.you?.ready === sent.ready`;
- the existing `error` effect already clears any intent;
- return `readying: sent?.kind === "ready" ? sent.ready : null`.

Extend the file's top doc comment by one sentence: ready is a choice the player has already made, so it may show on the press.

In `DeathRoll.tsx`, the ready button shows `intent.readying ?? you.ready` and calls `intent.ready(!(intent.readying ?? you.ready))`.

Run: `npx vitest run apps/web/src/deathroll`
Expected: PASS.

- [ ] **Step 3: See it on a real screen**

Start the dev server through the Browser pane (`preview_start` — never Bash), and open a **for-fun** table. Never open a chips table while checking: a previous run spent a real balance that way.

1. Seat two bots, so there are three players. Press ready. The table deals at once, since bots are always ready.
2. Play to the end. Check:
   - rounds reset to 100;
   - the "is out" beat appears between rounds;
   - Pass disappears on a roll passed to you;
   - the line under the number names where a pass lands;
   - the odds read "goes out this round".
3. At desktop width: the rail is down the left, the number is centred in the felt, the controls sit under the number, and the seats are not flush against the header.
4. `resize_window` to 375 wide: the two-column seat grid sits above the number, the controls are at the bottom within thumb reach, and nothing scrolls sideways. Check `document.scrollingElement.scrollWidth <= innerWidth`.
5. Emulate `prefers-reduced-motion: reduce` and play a round. The felt still says everything.
6. Take a screenshot of a round in play at desktop width and at 375, and one of the ready screen at 375.

If the Browser pane is unavailable, say so plainly in your report rather than claiming this was checked.

- [ ] **Step 4: The whole suite, typecheck, lint, format, commit**

```bash
npx biome format --write apps/web/src/deathroll
npm test
npm run typecheck
npm run lint
git add apps/web/src/deathroll
git commit -m "feat(web): a ready press lands before the table answers

Ready is a choice the player has already made, so it shows on the press
and gives way to the table's word — or is given up if refused or never
answered, the same bargain the roll and the pass keep. Tested by holding
the reply, and the whole felt checked on a real screen at a desk and at
375px.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Each section of the spec maps to a task:

| Spec section | Task |
|---|---|
| *The game*: rounds, reset to 100, opener rules, last one standing | 3 (`Game`), 6 (opener rotation between games) |
| *The pass*: one per round, no pass-backs | 2 (`Round`) |
| The pass-back finding | 1 (test) |
| The thresholds, the mixed state, nobody above 8 | 1 (tests) |
| *Dealing*: ready, countdown, never restarted, abandoned below two | 4 (`Readiness`) |
| Ready moves no chips, bots always ready, latecomers wait | 6 (`Table`) |
| *Where the chips are*: antes at the deal, short sit-outs, a store throw, a leave mid-deal, no retry | 6 (`adapter.ts`, tests) |
| Nets zero-sum, stats keys kept | 3, 6 |
| *The turn clock*: rolls rather than passes, round pause, result pause | 6 |
| *The odds readout* | 7 (`goesOut`) |
| *The bot* | 5 |
| *The felt*: rail, grid, squish fix, status lines, ready screen, motion | 7 |
| A ready press that shows at once | 8 |
| *The protocol*: view fields, actions, listing | 6 |
| CLAUDE.md amendment | 6 |
| *Testing*: server socket game | 6 |
| *Testing*: web | 7, 8 |

**One deliberate difference from the spec's wording.** The spec says the seat picker offers "2 to 6". The house `SeatCount` component offers 2, 4 and 6 at a ceiling of 6, and Task 7 reuses it rather than building a second picker. `seatLimit` still accepts any count from 2 to 6 on the wire.

**Pre-verified.** All of Tasks 1–5, and the `table.ts`, `adapter.ts` and `listing.ts` code in Task 6, ran green before this plan was written: 50 + 15 + 18 tests. The socket test and page changes in Task 6, the felt in Task 7 and all of Task 8 were not. Task 7’s `lines.ts` helpers were (8 tests). They carry their own red-green steps.

**Type consistency.**
- `Passed` carries `to` everywhere it is used (Tasks 2, 6, 7).
- `phase` is `"waiting" | "playing" | "over"` in Tasks 6–8.
- `passChance`, not `shouldPass`, in Tasks 1, 5 and 6.
- `askForGame(now)` and `setReady(seatId, ready, now)` take an explicit clock everywhere.
- Pause keys `result`, `round`, `deal` and `countdown` are named identically in the adapter and its tests.
- `alive` is the round's turn order; `order` is everyone dealt in, or everyone seated between games. Tasks 6 and 7 read them that way.
