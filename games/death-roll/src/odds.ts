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
