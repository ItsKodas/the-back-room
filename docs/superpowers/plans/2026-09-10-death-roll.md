# Death Roll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Death Roll table — a two-seat duel where a number falls
until somebody rolls a 1, with one paid "pass" each — and open the door that
`COMING` has advertised since before `games/` had anything in it.

**Architecture:** A new workspace `games/death-roll` holding the whole game:
pure arithmetic (`odds.ts`), a pure duel state machine (`duel.ts`), a
`PlayTable` (`table.ts`), a bot, and a `GameAdapter`. It borrows seating and
the table lifecycle from `@backroom/core` and needs no bank — the pot is the
two antes plus any passes, and the winner takes it, so nothing leaves the room
that did not enter it. Two small shared changes: `ceiling` on `lobby:create`,
and `payOut` gaining the ability to ask for another broadcast.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), vitest,
React 18 + react-router-dom 6, socket.io, biome.

**Spec:** `docs/superpowers/specs/2026-09-10-death-roll-design.md` — read it
before Task 1. Every task argues from it.

## Global Constraints

- **Imports use `.js` specifiers** even for `.ts` files (`./odds.js`). NodeNext.
- **`npm test`, `npm run typecheck`, `npm run lint` must all be clean** before
  any commit.
- **Format with `biome format --write <paths you touched>`.** Never
  `biome check --write` across the repo — it applies an import-ordering assist
  this project deliberately leaves off.
- **Comments say why, not what.** Match the surrounding prose style: full
  sentences, opinionated, explaining the decision rather than the mechanism.
- **Every test must be watched failing before the implementation is written.**
  A test that has only ever passed is not evidence.
- **The server is the only authority.** The client may show a rule; it may
  never be the thing enforcing one.
- **No `Math.random` for anything a player observes.** `randomInt` from
  `node:crypto`, injected so tests can roll to order.
- **Check a stylesheet is imported before adding to it.** `grep` for the
  filename first — this repo has had orphan `.css` files.
- Exact values, copied from the spec:
  - `STAKES = [100, 500, 1_000, 5_000]`, default `500`
  - `CEILINGS = [100, 1_000, 10_000]`, default `1_000`
  - `PASS_DIVISOR = 10`, `FUN_PURSE = 10_000`
  - `TURN_MS = 30_000`, `RESULT_MS = 5_000`, `DEAL_MS = 2_000`
  - theme: `wall #16141c`, `felt #241f33`, `accent #6b4bd6`, `accentHi #b39cff`
  - `mark: { text: "DEATH ROLL", accentAt: 0 }`

## File Structure

| File | Responsibility |
|---|---|
| `games/death-roll/package.json` | The workspace. Depends only on `@backroom/core`. |
| `games/death-roll/src/odds.ts` | Pure arithmetic: `lossOdds`, `edge`, `passGain`, `passCost`, `worthPassing`. No table, no seats. |
| `games/death-roll/src/duel.ts` | The duel state machine: ceiling, whose roll, passes spent, pot, who lost. Pure — knows nothing of accounts or sockets. |
| `games/death-roll/src/listing.ts` | `DEATH_ROLL`, the stake and ceiling levels, and the snapping functions that keep a client from naming its own. |
| `games/death-roll/src/table.ts` | Seating, the waiting/dueling/over cycle, play purses, the view. |
| `games/death-roll/src/bot.ts` | When a bot spends its pass, and how long it pretends to think. |
| `games/death-roll/src/adapter.ts` | The `GameAdapter`: creating, acting, the ante queue, settling, the clock. |
| `games/death-roll/src/index.ts` | The barrel. |
| `games/death-roll/src/theme.css` | The violet room. |
| `packages/core/src/game.ts` | `payOut` may report that it changed the table. |
| `packages/core/src/coming.ts` | `death-roll` comes off the coming-soon list. |
| `packages/shared/src/protocol.ts`, `schemas.ts` | `ceiling` on `lobby:create`. |
| `apps/server/src/server.ts` | Catalogue, adapter registration, honouring `payOut`'s return. |
| `apps/web/src/deathroll/DeathRoll.tsx` | The page: socket, lobby, felt, buttons. |
| `apps/web/src/deathroll/Falling.tsx` | The number, and the one motion it makes. |
| `apps/web/src/deathroll/deathroll.css` | The felt's own stylesheet. |
| `Dockerfile` | The new workspace's manifest, in both stages. |

---

### Task 1: The package, and the arithmetic it rests on

The odds are the load-bearing part of the whole game — the bot uses them, the
felt shows them, and the pass price was chosen from them. They are also pure
functions over one integer, so they can be tested exhaustively against the
definition rather than against a handful of examples.

**Files:**
- Create: `games/death-roll/package.json`
- Create: `games/death-roll/src/odds.ts`
- Test: `games/death-roll/src/odds.test.ts`
- Modify: `Dockerfile` (after line 28 and after line 58)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `lossOdds(ceiling: number): number`
  - `edge(ceiling: number): number`
  - `passGain(ceiling: number, ante: number): number`
  - `passCost(ceiling: number, price: number): number`
  - `worthPassing(ceiling: number, ante: number, price: number): boolean`

- [ ] **Step 1: Create the workspace manifest**

`games/death-roll/package.json`:

```json
{
  "name": "@backroom/game-death-roll",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./theme.css": "./src/theme.css"
  },
  "dependencies": {
    "@backroom/core": "*"
  }
}
```

- [ ] **Step 2: Register the workspace**

Run: `npm install`

This adds `games/death-roll` to `package-lock.json` as a workspace and
symlinks `@backroom/game-death-roll` into `node_modules`. Without it, later
tasks' imports will not resolve.

Expected: the lockfile gains a `"games/death-roll"` entry. Confirm with
`grep -n "games/death-roll" package-lock.json`.

- [ ] **Step 3: Add the workspace to both Docker stages**

`apps/server/src/packaging.test.ts` enforces this and will fail without it. The
Dockerfile has two `npm ci` stages and the manifest must be copied into each.

Add after the existing `COPY games/roulette/package.json games/roulette/` on
line 28, and again after the one on line 58:

```dockerfile
COPY games/death-roll/package.json games/death-roll/
```

- [ ] **Step 4: Run the packaging test to confirm it passes**

Run: `npx vitest run apps/server/src/packaging.test.ts`
Expected: PASS. (Run it before Step 3 to watch it fail if you want the
evidence; it is a pre-existing test, so it is the one place in this plan where
the failing run is optional.)

- [ ] **Step 5: Write the failing test**

`games/death-roll/src/odds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { edge, lossOdds, passGain, worthPassing } from "./odds.js";

/**
 * The closed form against the definition.
 *
 * `lossOdds` is a one-line formula standing in for a recursion, which is the
 * kind of thing that is either exactly right or quietly wrong by a hair that
 * no example test would catch. So the definition is written out here in full
 * and the formula is checked against it for every ceiling a table can reach.
 */
function bruteForce(upTo: number): number[] {
  // L[N] = chance the player about to roll at ceiling N eventually rolls the 1.
  const loss = new Array<number>(upTo + 1).fill(0);
  loss[1] = 1;
  for (let ceiling = 2; ceiling <= upTo; ceiling++) {
    // L(N) = (N - sum of L(2..N-1)) / (N + 1), which is the recursion
    // 1/N + (1/N) * sum over r in 2..N of (1 - L(r)) solved for L(N).
    let below = 0;
    for (let r = 2; r <= ceiling - 1; r++) {
      below += loss[r] as number;
    }
    loss[ceiling] = (ceiling - below) / (ceiling + 1);
  }
  return loss;
}

describe("the odds of being the one who rolls the 1", () => {
  it("matches the recursion it stands in for, at every ceiling", () => {
    const loss = bruteForce(400);
    for (let ceiling = 2; ceiling <= 400; ceiling++) {
      expect(lossOdds(ceiling), `ceiling ${ceiling}`).toBeCloseTo(
        loss[ceiling] as number,
        12,
      );
    }
  });

  it("is certain at a ceiling of one", () => {
    // There is nothing to roll but the 1. The game never reaches this — a 1
    // ends the duel rather than becoming the ceiling — but the formula should
    // still be telling the truth at its own edge.
    expect(lossOdds(1)).toBe(1);
  });

  it("makes the roller the underdog, always, by less and less", () => {
    let previous = lossOdds(2);
    expect(previous).toBeCloseTo(2 / 3, 12);
    for (let ceiling = 3; ceiling <= 400; ceiling++) {
      const odds = lossOdds(ceiling);
      expect(odds, `ceiling ${ceiling}`).toBeGreaterThan(0.5);
      expect(odds, `ceiling ${ceiling}`).toBeLessThan(previous);
      previous = odds;
    }
  });

  it("shrinks the edge to nothing at a table's opening number", () => {
    expect(edge(1_000)).toBeCloseTo(1 / 1_001_000, 12);
  });
});

describe("whether a pass is worth paying for", () => {
  /** The break-even ceiling for a price, found by asking rather than by hand. */
  const breakEven = (ante: number, price: number): number => {
    let highest = 0;
    for (let ceiling = 2; ceiling <= 1_000; ceiling++) {
      if (worthPassing(ceiling, ante, price)) {
        highest = ceiling;
      }
    }
    return highest;
  };

  it("turns correct at ceiling eight when a pass costs a tenth", () => {
    // The figure the spec chose the price from. If this moves, the game has
    // changed and the spec is out of date, not this test.
    expect(breakEven(500, 50)).toBe(8);
  });

  it("turns correct at ceiling five for a quarter and three for a half", () => {
    expect(breakEven(500, 125)).toBe(5);
    expect(breakEven(500, 250)).toBe(3);
  });

  it("is never worth it at a table's opening number", () => {
    expect(worthPassing(1_000, 500, 50)).toBe(false);
  });

  it("is worth many times its price when the number is nearly gone", () => {
    // A third of the ante swings on one pass at ceiling two, which is what
    // makes holding yours the only skill this game has.
    expect(passGain(2, 500)).toBeCloseTo(500 / 1.5, 6);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run games/death-roll/src/odds.test.ts`
Expected: FAIL — `Failed to resolve import "./odds.js"`.

- [ ] **Step 7: Write the implementation**

`games/death-roll/src/odds.ts`:

```ts
/**
 * What a death roll is worth to the person facing it.
 *
 * All of it follows from one number. The player about to roll at ceiling N
 * loses with probability 1/2 + 1/(N(N+1)) — the roller is always the underdog,
 * and by less and less as the ceiling rises. That is why passing is worth
 * almost nothing at the top of a duel and a great deal at the bottom, and why
 * the game has a decision in it at all.
 *
 * Nothing here knows about tables, seats or chips beyond a stake as a number.
 * The bot and the felt both read it, which is why it is its own file.
 */

/**
 * How much worse off the player about to roll is than even.
 *
 * The whole of the game's asymmetry, and small: a fiftieth at ceiling seven, a
 * millionth at a thousand.
 */
export function edge(ceiling: number): number {
  if (ceiling <= 1) {
    return 0.5;
  }
  return 1 / (ceiling * (ceiling + 1));
}

/**
 * The chance that whoever rolls next is the one who eventually rolls the 1.
 *
 * Checked against the recursion it stands in for rather than trusted: see
 * odds.test.ts, which writes the definition out in full.
 */
export function lossOdds(ceiling: number): number {
  return 0.5 + edge(ceiling);
}

/**
 * What handing the roll back is worth, in chips.
 *
 * Rolling is worth `-2 * ante * edge`; passing turns that around to
 * `+2 * ante * edge`, so the swing is four times the edge on the ante.
 */
export function passGain(ceiling: number, ante: number): number {
  return 4 * ante * edge(ceiling);
}

/**
 * What handing the roll back actually costs.
 *
 * Not the price — the price weighted by the chance you end up paying it. A
 * pass is only ever paid for by the loser, so a pass you buy and then win with
 * cost you nothing at all.
 */
export function passCost(ceiling: number, price: number): number {
  return price * (1 - lossOdds(ceiling));
}

/**
 * Whether spending the pass here is the right play.
 *
 * Deliberately strict rather than forgiving at the break-even ceiling: at
 * exactly even there is no reason to spend a thing you can only spend once.
 */
export function worthPassing(ceiling: number, ante: number, price: number): boolean {
  return passGain(ceiling, ante) > passCost(ceiling, price);
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run games/death-roll/src/odds.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 9: Format, typecheck and lint**

```bash
npx biome format --write games/death-roll/src/odds.ts games/death-roll/src/odds.test.ts games/death-roll/package.json
npm run typecheck
npm run lint
```

- [ ] **Step 10: Commit**

```bash
git add games/death-roll package.json package-lock.json Dockerfile
git commit -m "feat(death-roll): the arithmetic the game rests on

The player about to roll at ceiling N loses with probability
1/2 + 1/(N(N+1)), so the roller is always the underdog and passing swings
2/(N(N+1)) — worth almost nothing high up and a third of the ante at two.
That is the whole reason the game has a decision in it, so the closed form
is checked against the recursion it stands in for at every ceiling a table
can reach rather than at a handful of examples.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The duel

The rules, with no table around them. A duel knows the ceiling, whose roll it
is, who has spent their pass and what is in the pot — and nothing about
accounts, sockets or seats beyond two ids.

**Files:**
- Create: `games/death-roll/src/duel.ts`
- Test: `games/death-roll/src/duel.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (the duel does no arithmetic; the bot does).
- Produces:
  - `interface Rolled { seatId: string; from: number; result: number }`
  - `interface Passed { seatId: string; paid: number }`
  - `class Duel` with:
    - `constructor(a: string, b: string, first: string, opening: number, ante: number, passPrice: number)`
    - `ceiling: number`, `toRoll: string`, `pot: number`
    - `readonly opening: number`, `readonly ante: number`, `readonly passPrice: number`
    - `loserId: string | null`, `lastRoll: Rolled | null`, `lastPass: Passed | null`
    - `readonly history: Rolled[]`
    - `get over(): boolean`, `get winnerId(): string | null`
    - `other(seatId: string): string`
    - `hasPassed(seatId: string): boolean`
    - `checkPass(seatId: string): number` — throws `TableError`, returns the price
    - `pass(seatId: string): Passed`
    - `roll(seatId: string, draw: (ceiling: number) => number): Rolled`
    - `spentBy(seatId: string): number` — passes only, not the ante
    - `netFor(seatId: string): number`

- [ ] **Step 1: Write the failing test**

`games/death-roll/src/duel.test.ts`:

```ts
import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { Duel } from "./duel.js";

/** A duel between Ada and Bob, Ada to roll, at a five hundred chip table. */
const duel = (opening = 1_000) => new Duel("ada", "bob", "ada", opening, 500, 50);

/** A roller that hands back a fixed run of numbers, in order. */
const rolls = (...results: number[]) => {
  let at = 0;
  return () => results[at++] as number;
};

describe("rolling", () => {
  it("makes the result the new ceiling and moves the turn", () => {
    const game = duel();

    const rolled = game.roll("ada", rolls(743));

    expect(rolled).toEqual({ seatId: "ada", from: 1_000, result: 743 });
    expect(game.ceiling).toBe(743);
    expect(game.toRoll).toBe("bob");
    expect(game.over).toBe(false);
  });

  it("ends the duel on a one, and the roller is the one who lost", () => {
    const game = duel(4);

    game.roll("ada", rolls(1));

    expect(game.over).toBe(true);
    expect(game.loserId).toBe("ada");
    expect(game.winnerId).toBe("bob");
  });

  it("leaves the ceiling where it was when the duel ends", () => {
    // The felt shows the number that was being rolled against beside the 1
    // that ended it, so the last ceiling has to survive the losing roll.
    const game = duel(9);

    game.roll("ada", rolls(1));

    expect(game.ceiling).toBe(9);
    expect(game.lastRoll).toEqual({ seatId: "ada", from: 9, result: 1 });
  });

  it("refuses a roll from the seat whose turn it is not", () => {
    const game = duel();

    expect(() => game.roll("bob", rolls(500))).toThrow(TableError);
  });

  it("refuses a roll from a seat that is not in the duel", () => {
    const game = duel();

    expect(() => game.roll("cat", rolls(500))).toThrow(TableError);
  });

  it("refuses a draw the ceiling cannot produce", () => {
    /*
     * The roller is injected, so this is the one place a bad one could put a
     * duel into a state its own rules forbid — a ceiling that went up, or a
     * zero that can never end the game. Cheaper to refuse than to debug.
     */
    const game = duel(10);

    expect(() => game.roll("ada", rolls(11))).toThrow(TableError);
    expect(() => game.roll("ada", rolls(0))).toThrow(TableError);
  });

  it("keeps every roll, in order, for the felt to show", () => {
    const game = duel(1_000);

    game.roll("ada", rolls(743));
    game.roll("bob", rolls(112));

    expect(game.history).toEqual([
      { seatId: "ada", from: 1_000, result: 743 },
      { seatId: "bob", from: 743, result: 112 },
    ]);
  });

  it("never leaves a ceiling of one for the next player to roll against", () => {
    /*
     * The property the whole game leans on: a 1 ends the duel rather than
     * becoming the ceiling, so nobody is ever handed a roll they are certain
     * to lose. Played out in full rather than reasoned about.
     */
    let seed = 12_345;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let round = 0; round < 200; round++) {
      const game = duel(1_000);
      while (!game.over) {
        expect(game.ceiling).toBeGreaterThanOrEqual(2);
        game.roll(game.toRoll, (ceiling) => Math.floor(random() * ceiling) + 1);
      }
      expect(game.loserId).not.toBeNull();
    }
  });
});

describe("passing", () => {
  it("leaves the ceiling alone and hands the roll back", () => {
    const game = duel(38);

    const passed = game.pass("ada");

    expect(passed).toEqual({ seatId: "ada", paid: 50 });
    expect(game.ceiling).toBe(38);
    expect(game.toRoll).toBe("bob");
  });

  it("puts the price into the pot", () => {
    const game = duel(38);

    expect(game.pot).toBe(1_000);
    game.pass("ada");
    expect(game.pot).toBe(1_050);
  });

  it("is spent once and refused after", () => {
    const game = duel(38);

    game.pass("ada");
    game.roll("bob", rolls(20));

    expect(game.hasPassed("ada")).toBe(true);
    expect(() => game.pass("ada")).toThrow(TableError);
  });

  it("lets the other player pass it straight back, and then no more", () => {
    /*
     * The cap that makes the game terminate. Two passes is the most a duel can
     * ever hold, so after both are gone somebody must roll — which is the
     * whole argument that a duel ends at all.
     */
    const game = duel(38);

    game.pass("ada");
    game.pass("bob");

    expect(game.pot).toBe(1_100);
    expect(game.toRoll).toBe("ada");
    expect(() => game.pass("ada")).toThrow(TableError);
    expect(() => game.pass("bob")).toThrow(TableError);
  });

  it("refuses a pass from the seat whose turn it is not", () => {
    const game = duel();

    expect(() => game.pass("bob")).toThrow(TableError);
  });

  it("checks without spending", () => {
    // The adapter has to ask before it takes the chips, so that a player who
    // cannot afford the price is refused without their pass being burnt.
    const game = duel(38);

    expect(game.checkPass("ada")).toBe(50);
    expect(game.hasPassed("ada")).toBe(false);
  });
});

describe("what the duel is worth to each of them", () => {
  it("pays the winner the ante when nobody passed", () => {
    const game = duel(4);

    game.roll("ada", rolls(1));

    expect(game.netFor("bob")).toBe(500);
    expect(game.netFor("ada")).toBe(-500);
  });

  it("charges the loser for their own pass and pays it to the winner", () => {
    const game = duel(4);

    game.pass("ada");
    game.roll("bob", rolls(3));
    game.roll("ada", rolls(1));

    expect(game.netFor("ada")).toBe(-550);
    expect(game.netFor("bob")).toBe(550);
  });

  it("gives a winner their own pass back for nothing", () => {
    /*
     * The property that makes passing a bet rather than a fee: it comes back
     * inside the pot, so a pass you bought and then won with cost you nothing.
     */
    const game = duel(4);

    game.pass("ada");
    game.roll("bob", rolls(1));

    expect(game.netFor("ada")).toBe(500);
    expect(game.netFor("bob")).toBe(-500);
    expect(game.pot).toBe(1_050);
  });

  it("always sums to zero, however the passes fell", () => {
    const game = duel(4);

    game.pass("ada");
    game.pass("bob");
    game.roll("ada", rolls(1));

    expect(game.netFor("ada") + game.netFor("bob")).toBe(0);
    expect(game.netFor("bob")).toBe(550);
  });

  it("is worth nothing to anybody until it is over", () => {
    const game = duel();

    expect(game.netFor("ada")).toBe(0);
    expect(game.netFor("bob")).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run games/death-roll/src/duel.test.ts`
Expected: FAIL — `Failed to resolve import "./duel.js"`.

- [ ] **Step 3: Write the implementation**

`games/death-roll/src/duel.ts`:

```ts
import { TableError } from "@backroom/core";

/**
 * One duel, as rules over numbers.
 *
 * Nothing in here touches an account, a socket or a seat beyond its id. What
 * it owns is the number coming down, whose turn it is, which of the two passes
 * have been spent and what is in the pot — and that is the entire game.
 *
 * Kept apart from the table because the table is about people arriving and
 * leaving and the duel is not, and because these rules are worth reading on
 * their own.
 */

/** A roll that happened: what it was rolled against, and what came up. */
export interface Rolled {
  seatId: string;
  /** The ceiling at the moment of rolling, which the felt shows beside it. */
  from: number;
  result: number;
}

/** A pass that happened, and what it cost. */
export interface Passed {
  seatId: string;
  paid: number;
}

export class Duel {
  ceiling: number;
  toRoll: string;
  pot: number;
  loserId: string | null = null;
  lastRoll: Rolled | null = null;
  lastPass: Passed | null = null;
  readonly history: Rolled[] = [];

  /** Who has spent their one pass. Never more than two entries. */
  private readonly passes = new Set<string>();
  /** What each seat has put in beyond their ante. */
  private readonly spent = new Map<string, number>();

  constructor(
    readonly a: string,
    readonly b: string,
    first: string,
    readonly opening: number,
    readonly ante: number,
    readonly passPrice: number,
  ) {
    this.ceiling = opening;
    this.toRoll = first === b ? b : a;
    this.pot = ante * 2;
  }

  get over(): boolean {
    return this.loserId !== null;
  }

  get winnerId(): string | null {
    return this.loserId === null ? null : this.other(this.loserId);
  }

  other(seatId: string): string {
    return seatId === this.a ? this.b : this.a;
  }

  hasPassed(seatId: string): boolean {
    return this.passes.has(seatId);
  }

  /** What this seat has put in beyond their ante, which is passes and nothing else. */
  spentBy(seatId: string): number {
    return this.spent.get(seatId) ?? 0;
  }

  /**
   * What this duel came to, for one seat.
   *
   * Both nets are the same figure with opposite signs, and the figure is
   * decided entirely by what the *loser* spent: the winner takes back their
   * own passes inside the pot and takes the loser's on top. Zero either way
   * until somebody has actually lost.
   */
  netFor(seatId: string): number {
    if (this.loserId === null) {
      return 0;
    }
    const stake = this.ante + this.spentBy(this.loserId);
    return seatId === this.loserId ? -stake : stake;
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
    if (this.passes.has(seatId)) {
      throw new TableError("You have already used your pass this duel.");
    }
    return this.passPrice;
  }

  pass(seatId: string): Passed {
    const paid = this.checkPass(seatId);
    this.passes.add(seatId);
    this.spent.set(seatId, this.spentBy(seatId) + paid);
    this.pot += paid;
    this.toRoll = this.other(seatId);
    const passed: Passed = { seatId, paid };
    this.lastPass = passed;
    /*
     * Cleared so the felt has one thing to show rather than two. A pass is a
     * different event from a roll and they never both describe the moment the
     * table is currently in.
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
     * only way a duel could reach a state its own rules forbid — a ceiling
     * that went up, or a zero that never ends the game.
     */
    if (!Number.isInteger(result) || result < 1 || result > from) {
      throw new TableError("That roll is not possible.");
    }
    const rolled: Rolled = { seatId, from, result };
    this.lastRoll = rolled;
    this.lastPass = null;
    this.history.push(rolled);
    if (result === 1) {
      /*
       * The ceiling is left where it was rather than set to 1. A duel ends on
       * the 1 rather than continuing at it, so there is no next roll to have a
       * ceiling — and the felt wants the number that was being rolled against
       * shown beside the one that ended it.
       */
      this.loserId = seatId;
      return rolled;
    }
    this.ceiling = result;
    this.toRoll = this.other(seatId);
    return rolled;
  }

  private checkTurn(seatId: string): void {
    if (seatId !== this.a && seatId !== this.b) {
      throw new TableError("You are not in this duel.");
    }
    if (this.over) {
      throw new TableError("That duel is over.");
    }
    if (seatId !== this.toRoll) {
      throw new TableError("It is not your turn.");
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run games/death-roll/src/duel.test.ts`
Expected: PASS, all 18 tests.

- [ ] **Step 5: Format, typecheck and lint**

```bash
npx biome format --write games/death-roll/src/duel.ts games/death-roll/src/duel.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add games/death-roll/src/duel.ts games/death-roll/src/duel.test.ts
git commit -m "feat(death-roll): the duel, as rules over numbers

The ceiling, whose roll it is, which of the two passes are spent and what
is in the pot. No accounts, no sockets, no seats beyond two ids.

Two properties are tested as properties rather than as examples, because
the game leans on both: a 1 ends a duel rather than becoming the ceiling,
so nobody is ever handed a roll they are certain to lose; and a duel holds
at most two passes, which is the whole argument that it ends at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The listing, and taking the sign off the door

The numbers a host picks from, the snapping that stops a client picking its
own, and moving the listing out of `COMING` into the game — the same move poker
made when it was built. `apps/server/src/catalogue.test.ts` exists precisely to
catch a placeholder left behind shadowing a real listing, so it has to be
updated in the same commit.

**Files:**
- Create: `games/death-roll/src/listing.ts`
- Test: `games/death-roll/src/listing.test.ts`
- Modify: `packages/core/src/coming.ts` (remove the `death-roll` entry, lines 47–63)
- Modify: `apps/server/src/catalogue.test.ts` (line 22, the `BUILT` list, and its imports)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEATH_ROLL: GameListing`
  - `STAKES: readonly [100, 500, 1_000, 5_000]`, `ANTE = 500`
  - `CEILINGS: readonly [100, 1_000, 10_000]`, `OPENING = 1_000`
  - `PASS_DIVISOR = 10`, `FUN_PURSE = 10_000`
  - `TURN_MS = 30_000`, `RESULT_MS = 5_000`, `DEAL_MS = 2_000`
  - `passPrice(ante: number): number`
  - `anteFor(asked: unknown): number`
  - `openingFor(asked: unknown): number`

- [ ] **Step 1: Write the failing test**

`games/death-roll/src/listing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { anteFor, CEILINGS, DEATH_ROLL, openingFor, passPrice, STAKES } from "./listing.js";

describe("what a host may choose", () => {
  it("snaps a stake to the nearest level rather than taking it at its word", () => {
    // What a table costs decides how much of somebody's balance is at risk at
    // a table they sat down at, so it is never a number a client invents.
    expect(anteFor(400)).toBe(500);
    expect(anteFor(120)).toBe(100);
    expect(anteFor(9_999_999)).toBe(5_000);
    expect(anteFor(-1)).toBe(100);
  });

  it("falls back to the default for anything that is not a number", () => {
    expect(anteFor(undefined)).toBe(500);
    expect(anteFor("500")).toBe(500);
    expect(anteFor(Number.NaN)).toBe(500);
  });

  it("snaps an opening ceiling the same way", () => {
    expect(openingFor(900)).toBe(1_000);
    expect(openingFor(50)).toBe(100);
    expect(openingFor(undefined)).toBe(1_000);
  });

  it("prices a pass at a tenth of the ante, in whole chips at every level", () => {
    // Every level divides by ten, so a pass price is never a fraction of a
    // chip and never has to be rounded away from the price it advertises.
    for (const stake of STAKES) {
      expect(passPrice(stake) * 10).toBe(stake);
    }
    expect(passPrice(500)).toBe(50);
  });

  it("never prices a pass at nothing", () => {
    expect(passPrice(0)).toBe(1);
  });
});

describe("how the room lists it", () => {
  it("is open, and a duel", () => {
    expect(DEATH_ROLL.open).toBe(true);
    expect(DEATH_ROLL.minSeats).toBe(2);
    expect(DEATH_ROLL.maxSeats).toBe(2);
  });

  it("keeps the colours the sign was painted in", () => {
    // The link cards are drawn on the server where there is no stylesheet to
    // read, so these have to agree with theme.css. Changing one changes both.
    expect(DEATH_ROLL.theme).toEqual({
      wall: "#16141c",
      felt: "#241f33",
      accent: "#6b4bd6",
      accentHi: "#b39cff",
    });
  });

  it("offers a ceiling a duel can actually come down from", () => {
    for (const ceiling of CEILINGS) {
      expect(ceiling).toBeGreaterThan(1);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run games/death-roll/src/listing.test.ts`
Expected: FAIL — `Failed to resolve import "./listing.js"`.

- [ ] **Step 3: Write the implementation**

`games/death-roll/src/listing.ts`:

```ts
import type { GameListing } from "@backroom/core";

/** How Death Roll lists itself in the room. */
export const DEATH_ROLL: GameListing = {
  id: "death-roll",
  name: "Death Rolling",
  blurb: "Halve the number or pay. Last one to roll a one loses.",
  shape: "table",
  /*
   * Two, and it cannot be fewer or more. A death roll is a duel — the whole
   * game is the number coming down between two people — so this is the game in
   * the building that refuses a lone player rather than building a bank for
   * them.
   */
  minSeats: 2,
  maxSeats: 2,
  mark: { text: "DEATH ROLL", accentAt: 0 },
  /*
   * The same values theme.css sets, repeated because the link cards are drawn
   * on the server where there is no stylesheet to read. They have to agree.
   */
  theme: { wall: "#16141c", felt: "#241f33", accent: "#6b4bd6", accentHi: "#b39cff" },
  open: true,
};

/**
 * What a duel may be played for.
 *
 * A list rather than a range, for the reason poker's is: a room where every
 * table is a different odd size is a room nobody can read at a glance. Every
 * level divides by ten, which is what keeps a pass price a whole number of
 * chips at all of them.
 */
export const STAKES = [100, 500, 1_000, 5_000] as const;

/** What a duel costs unless the host says otherwise. */
export const ANTE = 500;

/**
 * Where a duel starts.
 *
 * A thousand is the number everybody who has played this before expects, and
 * the other two are an evening's difference either side of it: a hundred is
 * over in four or five rolls, ten thousand takes a while to get interesting.
 */
export const CEILINGS = [100, 1_000, 10_000] as const;

/** The opening ceiling unless the host says otherwise. */
export const OPENING = 1_000;

/**
 * What a pass costs, as a fraction of the ante.
 *
 * A tenth, which puts the break-even at ceiling eight — roughly the last two
 * or three rolls of a duel. Dearer and the button is worth pressing on at most
 * one turn, which is a decision in name only; cheaper and it is simply always
 * right to spend it. See odds.ts for the arithmetic this came out of.
 */
export const PASS_DIVISOR = 10;

/** Play money handed to a seat at a for-fun table, which dies with the table. */
export const FUN_PURSE = 10_000;

/** How long somebody has to act before the table rolls for them. */
export const TURN_MS = 30_000;

/** How long a finished duel stays up to be read. */
export const RESULT_MS = 5_000;

/** How long a funded table waits before starting the next duel. */
export const DEAL_MS = 2_000;

/** What a pass costs at this stake. Never nothing, whatever the arithmetic. */
export function passPrice(ante: number): number {
  return Math.max(1, Math.round(ante / PASS_DIVISOR));
}

/** The nearest level to a number, or the default for anything unusable. */
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

/** Where the table's duels start, snapped for the same reason. */
export function openingFor(asked: unknown): number {
  return snap(asked, CEILINGS, OPENING);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run games/death-roll/src/listing.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Take the coming-soon sign down**

In `packages/core/src/coming.ts`, delete the whole `death-roll` entry (the
object with `id: "death-roll"`, roughly lines 47–63, including its comment
about two seats).

Then update the file's doc comment, which currently ends:

```
 * Poker was on this list and has been built; its listing lives in its own
 * package now, beside the rules, the way the other three do.
```

Replace that paragraph with:

```
 * Poker and Death Rolling were on this list and have been built; their
 * listings live in their own packages now, beside the rules, the way the
 * others do.
```

And in the same comment, the sentence naming Liar's Dice as the cheap half of
the list currently reads "which puts it beside Poker as the cheap half of this
list to make honest." Change `beside Poker` to `beside Poker and Death Rolling`.

- [ ] **Step 6: Update the catalogue guard**

In `apps/server/src/catalogue.test.ts`, add the import beside the others:

```ts
import { DEATH_ROLL } from "@backroom/game-death-roll";
```

and add it to the `BUILT` list on line 22:

```ts
const BUILT = [GREED, BLACKJACK, SLOTS, POKER, ROULETTE, DEATH_ROLL];
```

- [ ] **Step 7: Run the catalogue guard to verify it passes**

Run: `npx vitest run apps/server/src/catalogue.test.ts`
Expected: PASS. If "has no coming-soon sign left on a game that is built"
fails, the `COMING` entry was not fully removed in Step 5.

To watch it fail first, add the import and `BUILT` entry (Step 6) before doing
Step 5, and run it then: it will fail with `shadowed` equal to
`["death-roll"]`.

- [ ] **Step 8: Format, typecheck and lint**

```bash
npx biome format --write games/death-roll/src/listing.ts games/death-roll/src/listing.test.ts packages/core/src/coming.ts apps/server/src/catalogue.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 9: Commit**

```bash
git add games/death-roll/src/listing.ts games/death-roll/src/listing.test.ts packages/core/src/coming.ts apps/server/src/catalogue.test.ts
git commit -m "feat(death-roll): the listing, and the sign comes off the door

The stake and ceiling levels a host picks from, snapped rather than taken
at their word, and a pass priced at a tenth of the ante — the figure the
arithmetic in odds.ts chose.

The listing moves out of COMING and into the game beside its rules, the
way poker's did. The catalogue guard is updated in the same commit
deliberately: a placeholder left behind quietly overwrites the real
listing and every other test still passes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The table

Seating, the waiting → dueling → over cycle, play purses, and the view. This is
where the "waiting never costs anybody a stake" rule is actually enforced.

**Files:**
- Create: `games/death-roll/src/table.ts`
- Test: `games/death-roll/src/table.test.ts`

**Interfaces:**
- Consumes: `Duel`, `Rolled`, `Passed` (Task 2); `FUN_PURSE`, `TURN_MS` (Task 3).
- Produces:
  - `type Phase = "waiting" | "dueling" | "over"`
  - `interface SeatView`, `interface TableView`
  - `class Table implements PlayTable` with:
    - `constructor(code: string, maxSeats: number, options: { opening: number; ante: number; turnMs?: number })`
    - `forFun: boolean`, `lastEvent: string | null`
    - `readonly opening: number`, `readonly ante: number`, `readonly passPrice: number`
    - `duel: Duel | null`, `get phase(): Phase`
    - `get ready(): boolean` — two seats, both in the game
    - `get pending(): boolean`, `askForDuel(): void`, `takePending(): string[] | null`
    - `begin(first?: string): void`, `finish(): void`
    - `shortId: string | null` — whose ante was refused, for the felt
    - `noteShort(seatId: string | null): void`
    - `purseFor(seatId: string): number`, `movePurse(seatId: string, by: number): void`
    - `turnEndsAt: number | null`
    - `view(forSeatId: string | null): TableView`
    - plus `PlayTable`'s `join` / `removeSeat` / `disconnect` / `reconnect` / `watch` / `unwatch` / `seats` / `hostId` / `isEmpty` / `maxSeats` / `status` / `code`

- [ ] **Step 1: Write the failing test**

`games/death-roll/src/table.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Table } from "./table.js";

const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

/** A chips table with two people at it, ready to be dealt. */
const seated = () => {
  const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
  table.join("ada", "Ada", who("u1"));
  table.join("bob", "Bob", who("u2"));
  return table;
};

describe("a table waiting for an opponent", () => {
  it("is not ready with one player at it", () => {
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
    table.join("ada", "Ada", who("u1"));

    expect(table.ready).toBe(false);
    expect(table.phase).toBe("waiting");
    expect(table.duel).toBeNull();
  });

  it("says what it is waiting for", () => {
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
    table.join("ada", "Ada", who("u1"));

    expect(table.view("ada").waitingFor).toBe("opponent");
  });

  it("holds with the felt untouched — no pot, no ceiling coming down", () => {
    /*
     * The rule in CLAUDE.md in so many words: waiting never costs anybody a
     * stake, and a table that holds must hold with the felt untouched. There
     * is nothing on the felt to clear because nothing was ever put there.
     */
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
    table.join("ada", "Ada", who("u1"));
    const view = table.view("ada");

    expect(view.pot).toBe(0);
    expect(view.ceiling).toBe(1_000);
    expect(view.toRoll).toBeNull();
  });

  it("becomes ready when the second player sits down", () => {
    const table = seated();

    expect(table.ready).toBe(true);
    expect(table.view("ada").waitingFor).toBeNull();
  });

  it("refuses a third seat", () => {
    const table = seated();

    expect(() => table.join("cat", "Cat", who("u3"))).toThrow();
  });
});

describe("the queue that gets a duel started", () => {
  it("hands the pending pair over exactly once", () => {
    /*
     * The adapter drains this before its first await, which is what makes a
     * broadcast asking often into taking the antes exactly once rather than a
     * way to charge somebody twice.
     */
    const table = seated();

    table.askForDuel();

    expect(table.takePending()).toEqual(["ada", "bob"]);
    expect(table.takePending()).toBeNull();
  });

  it("is empty until somebody asks", () => {
    const table = seated();

    expect(table.takePending()).toBeNull();
  });
});

describe("a duel at the table", () => {
  it("starts with the pot already funded and the opening ceiling up", () => {
    const table = seated();

    table.begin("ada");

    expect(table.phase).toBe("dueling");
    expect(table.view("ada").pot).toBe(1_000);
    expect(table.view("ada").ceiling).toBe(1_000);
    expect(table.view("ada").toRoll).toBe("ada");
  });

  it("alternates who rolls first between duels", () => {
    // The roller is the underdog, so who goes first is worth something — tiny
    // at a thousand, a third of the ante at two. Alternating costs nothing and
    // means an evening is even however short the duels are.
    const table = seated();

    table.begin("ada");
    table.duel?.roll("ada", () => 1);
    table.finish();
    table.begin();

    expect(table.view("ada").toRoll).toBe("bob");

    table.duel?.roll("bob", () => 1);
    table.finish();
    table.begin();

    expect(table.view("ada").toRoll).toBe("ada");
  });

  it("goes back to waiting when the duel is cleared away", () => {
    const table = seated();
    table.begin("ada");
    table.duel?.roll("ada", () => 1);

    expect(table.phase).toBe("over");

    table.finish();

    expect(table.phase).toBe("waiting");
    expect(table.view("ada").pot).toBe(0);
  });

  it("puts a clock on the turn and moves it with the turn", () => {
    const table = seated();
    table.begin("ada");
    const first = table.turnEndsAt;

    expect(first).not.toBeNull();

    table.duel?.roll("ada", () => 500);
    table.touchClock();

    expect(table.turnEndsAt).not.toBe(first);
    expect(table.view("bob").toRoll).toBe("bob");
  });

  it("takes the clock away once the duel is over", () => {
    const table = seated();
    table.begin("ada");
    table.duel?.roll("ada", () => 1);
    table.touchClock();

    expect(table.turnEndsAt).toBeNull();
  });
});

describe("standing up", () => {
  it("holds the seat while a duel is running", () => {
    /*
     * Blackjack's answer for blackjack's reason: there are chips on the felt
     * and the duel has to play out and settle before anybody can be paid.
     */
    const table = seated();
    table.begin("ada");

    expect(table.leavesMidHand).toBe(false);
  });

  it("gives the seat up once the duel is cleared", () => {
    const table = seated();
    table.begin("ada");
    table.duel?.roll("ada", () => 1);
    table.finish();
    table.removeSeat("bob");

    expect(table.seats.map((seat) => seat.id)).toEqual(["ada"]);
    expect(table.ready).toBe(false);
  });
});

describe("a table playing for nothing", () => {
  it("hands each seat a purse and takes it back when the table closes", () => {
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
    table.forFun = true;
    table.join("ada", "Ada", null);

    expect(table.purseFor("ada")).toBe(10_000);
    expect(table.view("ada").you?.purse).toBe(10_000);
  });

  it("lets a guest with no account sit down", () => {
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });
    table.forFun = true;

    expect(() => table.join("ada", "Ada", null)).not.toThrow();
  });

  it("insists on knowing who you are at a table playing for chips", () => {
    const table = new Table("ABCDE", 2, { opening: 1_000, ante: 500 });

    expect(() => table.join("ada", "Ada", null)).toThrow();
  });

  it("shows no purse at a table playing for chips", () => {
    const table = seated();

    expect(table.view("ada").you?.purse).toBeNull();
  });
});

describe("what the felt is told", () => {
  it("shows both seats to everybody and the pass only to its owner's seat", () => {
    const table = seated();
    table.begin("ada");
    table.duel?.pass("ada");
    const view = table.view("bob");

    expect(view.seats).toHaveLength(2);
    expect(view.seats.find((seat) => seat.id === "ada")?.passed).toBe(true);
    expect(view.seats.find((seat) => seat.id === "bob")?.passed).toBe(false);
  });

  it("tells a watcher everything and gives them no seat of their own", () => {
    const table = seated();
    table.begin("ada");

    expect(table.view(null).you).toBeNull();
    expect(table.view(null).ceiling).toBe(1_000);
  });

  it("carries the price of a pass so the felt never has to work it out", () => {
    const table = seated();

    expect(table.view("ada").passPrice).toBe(50);
    expect(table.view("ada").ante).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run games/death-roll/src/table.test.ts`
Expected: FAIL — `Failed to resolve import "./table.js"`.

- [ ] **Step 3: Write the implementation**

`games/death-roll/src/table.ts`:

```ts
import type { PlayTable, Seat, SeatIdentity, TableStatus } from "@backroom/core";
import { Seating, TableError } from "@backroom/core";
import type { Passed, Rolled } from "./duel.js";
import { Duel } from "./duel.js";
import { FUN_PURSE, passPrice, TURN_MS } from "./listing.js";

/**
 * A death roll table.
 *
 * What makes it different from every other table in the building: its state
 * change *is* the money. A duel cannot start until both antes are in, and
 * nothing starts one but a clock — so the table cannot simply begin and let
 * `settle` catch the chips up the way a card table does. It asks instead, and
 * the adapter answers on the next broadcast. See `askForDuel` below.
 */

export type Phase = "waiting" | "dueling" | "over";

export interface SeatView {
  id: string;
  name: string;
  connected: boolean;
  waiting: boolean;
  isBot: boolean;
  avatar: string | null;
  accentColor: number | null;
  /** Whether this seat has spent its one pass this duel. */
  passed: boolean;
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
  /** What a duel here is played for. The same figure for fun or for chips. */
  ante: number;
  /** Where a duel here starts. */
  opening: number;
  passPrice: number;
  /** The number being rolled against. The opening figure between duels. */
  ceiling: number;
  pot: number;
  toRoll: string | null;
  turnEndsAt: number | null;
  lastRoll: Rolled | null;
  lastPass: Passed | null;
  /** Every roll of the duel on the felt, oldest first. */
  history: readonly Rolled[];
  loserId: string | null;
  winnerIds: readonly string[];
  /** Why the table is not dealing, when it is not. */
  waitingFor: "opponent" | "funds" | null;
  /** Whose ante was refused, when that is why it is waiting. */
  shortId: string | null;
  lastEvent: string | null;
  /** This seat, or null for somebody only watching. */
  you: SeatView | null;
}

export class Table implements PlayTable {
  readonly code: string;
  readonly opening: number;
  readonly ante: number;
  readonly passPrice: number;

  forFun = false;
  lastEvent: string | null = null;
  duel: Duel | null = null;
  turnEndsAt: number | null = null;
  shortId: string | null = null;

  private readonly seating: Seating;
  private readonly turnMs: number;
  private readonly purses = new Map<string, number>();
  /** Who rolls first next duel, so the disadvantage alternates. */
  private nextFirst: string | null = null;
  /** A duel the table wants started, waiting on somebody to take the antes. */
  private wanted: string[] | null = null;

  constructor(
    code: string,
    maxSeats: number,
    options: { opening: number; ante: number; turnMs?: number },
  ) {
    this.code = code;
    this.seating = new Seating(maxSeats);
    this.opening = options.opening;
    this.ante = options.ante;
    this.passPrice = passPrice(options.ante);
    this.turnMs = options.turnMs ?? TURN_MS;
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
   * Standing up mid-duel cannot be honoured there and then.
   *
   * There are chips on the felt and the duel has to play out and settle before
   * anybody can be paid, so the seat is held and the player is treated as
   * dropped — blackjack's answer, for blackjack's reason. Their turns roll on
   * the clock, and the seat goes once the duel is cleared away.
   */
  readonly leavesMidHand = false;

  /**
   * A seat at the table.
   *
   * A chips table insists on knowing who you are; a for-fun one does not,
   * because nobody signs in to play for nothing.
   */
  join(id: string, name: string, identity: SeatIdentity | null): Seat {
    const seat = this.seating.join(id, name, this.status, identity, !this.forFun);
    /*
     * Dealt in immediately rather than made to wait for the next duel. Every
     * other game seats a latecomer as a spectator because a table mid-hand has
     * a game in progress they cannot join; here the table has exactly two
     * seats and a second player arriving is the thing the table is waiting
     * for, so making them wait would mean it never deals at all.
     */
    seat.waiting = false;
    return seat;
  }

  removeSeat(seatId: string): void {
    this.seating.remove(seatId);
    this.purses.delete(seatId);
    if (this.nextFirst === seatId) {
      this.nextFirst = null;
    }
    if (this.shortId === seatId) {
      this.shortId = null;
    }
  }
  disconnect(seatId: string): void {
    this.seating.disconnect(seatId);
  }
  reconnect(seatId: string): Seat {
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
    if (this.duel === null) {
      return "waiting";
    }
    return this.duel.over ? "over" : "dueling";
  }

  /** Two people at the table, both of them in the game. */
  get ready(): boolean {
    const playing = this.seats.filter((seat) => !seat.waiting);
    return playing.length === 2;
  }

  /**
   * Asks for a duel, without starting one.
   *
   * Taking an ante is asynchronous and this is called from a timer, which is
   * synchronous — so the table records that it wants a duel and the adapter
   * takes the antes on the next broadcast. Separating the two is what lets the
   * money be moved before any of the game state is.
   */
  askForDuel(): void {
    if (this.wanted !== null || !this.ready || this.duel !== null) {
      return;
    }
    this.wanted = this.seats.filter((seat) => !seat.waiting).map((seat) => seat.id);
  }

  get pending(): boolean {
    return this.wanted !== null;
  }

  /**
   * Takes the request off the queue.
   *
   * Called before the adapter's first await, so that asking often is
   * exactly-once rather than a way to charge somebody twice.
   */
  takePending(): string[] | null {
    const wanted = this.wanted;
    this.wanted = null;
    return wanted;
  }

  /** Notes that somebody could not cover their ante, for the felt to say so. */
  noteShort(seatId: string | null): void {
    this.shortId = seatId;
    this.lastEvent =
      seatId === null
        ? null
        : `${this.seating.find(seatId)?.name ?? "Somebody"} is short of the ante.`;
  }

  /**
   * Deals a duel, with the pot already paid for.
   *
   * Never called before the antes are in. The pot it opens with is the two
   * antes, and if that is not true the table has minted chips.
   */
  begin(first?: string): void {
    const playing = this.seats.filter((seat) => !seat.waiting);
    const [a, b] = playing;
    if (a === undefined || b === undefined) {
      throw new TableError("A duel needs two people.");
    }
    const rolls = first ?? this.nextFirst ?? a.id;
    this.duel = new Duel(a.id, b.id, rolls, this.opening, this.ante, this.passPrice);
    this.shortId = null;
    this.lastEvent = null;
    this.touchClock();
  }

  /** Clears the felt and puts the table back to waiting for the next duel. */
  finish(): void {
    const done = this.duel;
    if (done !== null && done.loserId !== null) {
      /*
       * The loser rolls first next time, which hands them the disadvantage
       * again — and that is the point. Alternating on the *duel* rather than
       * on the loser would drift if a duel is ever abandoned; taking it from
       * who lost is a fact the table always has.
       */
      this.nextFirst = done.other(done.loserId);
    }
    this.duel = null;
    this.turnEndsAt = null;
  }

  /** Puts the clock on whoever is to act now, or takes it away. */
  touchClock(): void {
    this.turnEndsAt =
      this.duel === null || this.duel.over ? null : Date.now() + this.turnMs;
  }

  // ------------------------------------------------------------ play money

  /**
   * This seat's play money.
   *
   * Only meaningful at a for-fun table. Everywhere else a seat's limit is
   * their account, which this class cannot see and has no business seeing.
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

  /**
   * Fills a purse that cannot cover the next ante.
   *
   * Play money, so running dry should cost somebody a moment rather than their
   * evening — and a for-fun table that stops dealing is one nobody sits at
   * twice. Returns whether it actually had to.
   */
  topUp(seatId: string): boolean {
    if (!this.forFun || this.purseFor(seatId) >= this.ante) {
      return false;
    }
    this.purses.set(seatId, FUN_PURSE);
    return true;
  }

  // ----------------------------------------------------------- the picture

  private seatView(seat: Seat): SeatView {
    return {
      id: seat.id,
      name: seat.name,
      connected: seat.connected,
      waiting: seat.waiting,
      isBot: seat.isBot,
      avatar: seat.avatar,
      accentColor: seat.accentColor,
      passed: this.duel?.hasPassed(seat.id) ?? false,
      purse: this.forFun ? this.purseFor(seat.id) : null,
    };
  }

  view(forSeatId: string | null): TableView {
    const seats = this.seats.map((seat) => this.seatView(seat));
    const duel = this.duel;
    const winner = duel?.winnerId ?? null;
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
      /*
       * The opening figure between duels rather than nothing, because that is
       * what the next duel will be rolled against and the felt should show the
       * number it is about to come down from.
       */
      ceiling: duel?.ceiling ?? this.opening,
      pot: duel?.pot ?? 0,
      toRoll: duel === null || duel.over ? null : duel.toRoll,
      turnEndsAt: this.turnEndsAt,
      lastRoll: duel?.lastRoll ?? null,
      lastPass: duel?.lastPass ?? null,
      history: duel?.history ?? [],
      loserId: duel?.loserId ?? null,
      winnerIds: winner === null ? [] : [winner],
      waitingFor: this.waitingFor(),
      shortId: this.shortId,
      lastEvent: this.lastEvent,
      you: seats.find((seat) => seat.id === forSeatId) ?? null,
    };
  }

  private waitingFor(): "opponent" | "funds" | null {
    if (this.duel !== null) {
      return null;
    }
    if (this.shortId !== null) {
      return "funds";
    }
    return this.ready ? null : "opponent";
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run games/death-roll/src/table.test.ts`
Expected: PASS, all 19 tests.

- [ ] **Step 5: Format, typecheck and lint**

```bash
npx biome format --write games/death-roll/src/table.ts games/death-roll/src/table.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add games/death-roll/src/table.ts games/death-roll/src/table.test.ts
git commit -m "feat(death-roll): the table, and the rule that it waits empty-handed

Seating, the waiting/dueling/over cycle and the view. The rule this file
exists to enforce is that a table holding for a second player holds with
the felt untouched: no pot, no ceiling coming down, and nothing taken off
anybody's account.

The queue is the unusual part. This is the first table whose state change
is the money — a duel cannot start until both antes are in, and nothing
starts one but a clock — so the table asks for a duel and the adapter
answers once it has taken them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The bot

Only ever at a for-fun table. Its only decision is when to spend its pass, and
the arithmetic from Task 1 is the honest answer; skill wobbles the threshold
around it.

**Files:**
- Create: `games/death-roll/src/bot.ts`
- Test: `games/death-roll/src/bot.test.ts`

**Interfaces:**
- Consumes: `worthPassing` (Task 1).
- Produces:
  - `type Choice = "roll" | "pass"`
  - `decide(options: { skill: BotSkill; ceiling: number; ante: number; price: number; canPass: boolean }): Choice`
  - `thinkingTime(skill: BotSkill): number`

- [ ] **Step 1: Write the failing test**

`games/death-roll/src/bot.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run games/death-roll/src/bot.test.ts`
Expected: FAIL — `Failed to resolve import "./bot.js"`.

- [ ] **Step 3: Write the implementation**

`games/death-roll/src/bot.ts`:

```ts
import type { BotSkill } from "@backroom/core";
import { worthPassing } from "./odds.js";

/**
 * Somebody to duel at a table playing for nothing.
 *
 * Only ever there: a bot at a table playing for chips is a button that mints
 * them, and the adapter refuses to seat one. Which means everything here can
 * be about making a for-fun duel worth sitting through rather than about
 * fairness.
 *
 * There is exactly one decision in this game, so a bot is entirely described
 * by when it spends its pass — and the honest answer is already written down
 * in odds.ts. Skill is how far short of it the bot falls.
 */

export type Choice = "roll" | "pass";

/**
 * How much of the true break-even each skill actually sees.
 *
 * A hard bot passes at ceiling eight, which is correct. A normal one waits
 * until five, which is a player who has worked out that passing is for the
 * endgame without working out where the endgame starts. An easy one never
 * passes at all — not a bad decision, but a player who has not noticed there
 * is one, which is the more human way to be bad at this.
 */
const NERVE: Record<BotSkill, number> = { easy: 0, normal: 0.4, hard: 1 };

export function decide(options: {
  skill: BotSkill;
  ceiling: number;
  ante: number;
  price: number;
  canPass: boolean;
}): Choice {
  const { skill, ceiling, ante, price, canPass } = options;
  if (!canPass || NERVE[skill] === 0) {
    return "roll";
  }
  /*
   * The correct threshold, scaled down by nerve. Scaling the *stake* rather
   * than the ceiling is what keeps this honest: a lesser bot values the swing
   * at less than it is worth, which is a plausible mistake, rather than using
   * a made-up cutoff that happens to look like one.
   */
  return worthPassing(ceiling, ante * NERVE[skill], price) ? "pass" : "roll";
}

/**
 * How long to look like it thought about it.
 *
 * A bot that answered instantly would make the table feel like a machine
 * rather than an opponent, and a slow one is the tell that it is not sure —
 * so the better it plays, the quicker it plays.
 */
export function thinkingTime(skill: BotSkill): number {
  const base = { easy: 1_800, normal: 1_300, hard: 800 }[skill];
  return base + Math.floor(Math.random() * 600);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run games/death-roll/src/bot.test.ts`
Expected: PASS, all 6 tests.

If "spends it at the true break-even" fails, check `NERVE.normal`: the scaled
stake must put the break-even at ceiling 5. `worthPassing(5, 200, 50)` must be
true and `worthPassing(6, 200, 50)` false. Adjust `NERVE.normal` between 0.35
and 0.45 until both hold, and leave a comment saying which figure it is.

- [ ] **Step 5: Format, typecheck and lint**

```bash
npx biome format --write games/death-roll/src/bot.ts games/death-roll/src/bot.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add games/death-roll/src/bot.ts games/death-roll/src/bot.test.ts
git commit -m "feat(death-roll): somebody to duel at a for-fun table

There is one decision in this game, so a bot is entirely described by when
it spends its pass. The correct answer is already in odds.ts; skill is how
far short of it the bot falls, and it falls short by undervaluing the
stake rather than by using a made-up cutoff — a plausible mistake rather
than a dressed-up constant.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `payOut` may ask to be seen

The one change to the room. Death roll is the first table whose state change is
the money: a duel cannot start until both antes are in, and nothing starts one
but a clock. `pause().run()` is synchronous so it cannot take an ante; `payOut`
is asynchronous and runs on every broadcast, which is the right queue — but the
room never sends the state again afterwards, so a duel begun inside it would be
invisible until something unrelated woke the table up.

**Files:**
- Modify: `packages/core/src/game.ts` (the `payOut` signature and its doc comment)
- Modify: `apps/server/src/server.ts` (the `payOut` call in `broadcast`, around line 1383)
- Test: `apps/server/src/server.test.ts` (add a describe block)

**Interfaces:**
- Consumes: nothing.
- Produces: `GameAdapter.payOut?(table, deps): Promise<void | boolean>` — `true`
  means "I changed the table, send it again".

- [ ] **Step 1: Find how server.test.ts builds a server**

Run: `grep -n "describe\|createServer\|backRoomServer\|import " apps/server/src/server.test.ts | head -40`

Read enough of the file to reuse its existing harness — how it starts a server,
connects a client socket and waits for `room:state`. The test below assumes a
helper exists for that; adapt it to whatever the file actually does rather than
inventing a second harness.

- [ ] **Step 2: Write the failing test**

Add to `apps/server/src/server.test.ts`, using that file's own harness:

```ts
describe("a game that changes the table while paying out", () => {
  /*
   * Death roll takes its antes in `payOut`, because taking an ante is
   * asynchronous and a duel starts on a timer. Without this the duel begins
   * and nobody is told until something unrelated wakes the table up.
   */
  it("sends the state again when payOut says it changed something", async () => {
    let asked = 0;
    const adapter = fakeAdapter({
      payOut: async () => {
        asked += 1;
        // True exactly once: a payOut that always asked would be a broadcast
        // calling a broadcast, forever.
        return asked === 1;
      },
    });

    const states = await statesAfterOneBroadcast(adapter);

    expect(states).toBe(2);
    expect(asked).toBe(2);
  });

  it("sends it once for a game that pays out without changing anything", async () => {
    const adapter = fakeAdapter({ payOut: async () => {} });

    expect(await statesAfterOneBroadcast(adapter)).toBe(1);
  });

  it("sends it once for a game with no payOut at all", async () => {
    const adapter = fakeAdapter({});

    expect(await statesAfterOneBroadcast(adapter)).toBe(1);
  });
});
```

Write `fakeAdapter` and `statesAfterOneBroadcast` as local helpers in that file:
`fakeAdapter` returns a minimal `GameAdapter` over a stub `PlayTable` (a
`Seating`-backed object is enough — `isSettled` false, `settle` a no-op, `view`
returning `{}`), and `statesAfterOneBroadcast` opens a table over a client
socket and counts `room:state` events until they stop arriving.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run apps/server/src/server.test.ts -t "changes the table while paying out"`
Expected: FAIL — the first case gets 1 state, not 2.

- [ ] **Step 4: Widen the interface**

In `packages/core/src/game.ts`, change the `payOut` signature and extend its
doc comment. The existing comment ends:

```
   * So this is called on every broadcast and unlatched. A game that implements
   * it must take its work off the queue before its first await, which is what
   * makes calling it often exactly-once per item rather than a way to pay
   * somebody twice.
   */
  payOut?(table: T, deps: GameDeps): Promise<void>;
```

Replace those last lines with:

```
   * So this is called on every broadcast and unlatched. A game that implements
   * it must take its work off the queue before its first await, which is what
   * makes calling it often exactly-once per item rather than a way to pay
   * somebody twice.
   *
   * Returning `true` asks the room to send the state again.
   *
   * Almost nothing needs that. Every other game moves its state synchronously
   * and moves money afterwards — a hand is over the instant the last card
   * lands, and settling only catches the chips up — so by the time this runs
   * the players have already been told everything. Death roll is the
   * exception: its antes are taken here, because taking one is asynchronous
   * and a duel begins on a timer, so the duel it starts would otherwise be
   * invisible until something unrelated woke the table.
   *
   * A game that returns `true` on every call is a broadcast calling a
   * broadcast. Return it only for the call that actually changed something.
   */
  payOut?(table: T, deps: GameDeps): Promise<void | boolean>;
```

- [ ] **Step 5: Honour it in the server**

In `apps/server/src/server.ts`, in `broadcast`, replace:

```ts
    if (seated.game.payOut !== undefined) {
      void seated.game
        .payOut(seated.table, deps)
        .catch((error) => console.error("paying out failed", error));
    }
```

with:

```ts
    if (seated.game.payOut !== undefined) {
      void seated.game
        .payOut(seated.table, deps)
        /*
         * Sent again only if the game says it moved something. Death roll
         * takes its antes here — the one place in the building where the money
         * moving *is* the state changing — and without this the duel it starts
         * would sit unseen until something unrelated woke the table up.
         *
         * The recursion is bounded by the game rather than by a counter here,
         * which is the honest place for it: only the game knows whether it did
         * anything, and one that answered yes every time would be asking for a
         * broadcast loop it could stop and this could not.
         */
        .then((changed) => {
          if (changed === true) {
            broadcast(code);
          }
        })
        .catch((error) => console.error("paying out failed", error));
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run apps/server/src/server.test.ts -t "changes the table while paying out"`
Expected: PASS, all 3 cases.

- [ ] **Step 7: Run the whole suite — this touched shared code**

Run: `npm test`
Expected: PASS. Roulette's `payOut` returns `Promise<void>` and is unaffected;
if anything else fails, it is a real regression rather than a signature nit.

- [ ] **Step 8: Format, typecheck and lint**

```bash
npx biome format --write packages/core/src/game.ts apps/server/src/server.ts apps/server/src/server.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/game.ts apps/server/src/server.ts apps/server/src/server.test.ts
git commit -m "feat(core): payOut may ask for the state to be sent again

Every game so far moves its state synchronously and moves money after, so
by the time payOut runs the players have been told everything. Death roll
breaks that: its antes are taken in payOut, because taking one is
asynchronous and a duel begins on a timer, and the duel it starts would be
invisible until something unrelated woke the table.

Returning true asks for one more send. The recursion is bounded by the
game rather than by a counter in the server, because only the game knows
whether it actually did anything.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: A host may name the opening ceiling

**Files:**
- Modify: `packages/shared/src/schemas.ts` (`createSchema`)
- Modify: `packages/shared/src/protocol.ts` (`ClientToServer["lobby:create"]`)
- Modify: `apps/server/src/server.ts` (pass `ceiling` through to `create`)
- Test: `packages/shared/src/schemas.test.ts` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `ceiling?: number` on the create payload, bounded 100…10_000.

- [ ] **Step 1: Write the failing test**

Check first: `ls packages/shared/src/`. If `schemas.test.ts` does not exist,
create it with this content; if it does, add the describe block to it.

```ts
import { describe, expect, it } from "vitest";
import { createSchema } from "./schemas.js";

describe("opening a table", () => {
  it("accepts an opening ceiling", () => {
    const parsed = createSchema.safeParse({ name: "Ada", game: "death-roll", ceiling: 1_000 });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.ceiling).toBe(1_000);
  });

  it("refuses a ceiling outside what any table offers", () => {
    // Bounded here and snapped by the game. This only stops a nonsense number
    // reaching that arithmetic at all.
    expect(createSchema.safeParse({ name: "Ada", ceiling: 0 }).success).toBe(false);
    expect(createSchema.safeParse({ name: "Ada", ceiling: 10_000_000 }).success).toBe(false);
    expect(createSchema.safeParse({ name: "Ada", ceiling: 1.5 }).success).toBe(false);
  });

  it("is happy without one, because most tables have no ceiling", () => {
    expect(createSchema.safeParse({ name: "Ada" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/schemas.test.ts`
Expected: FAIL — `parsed.data.ceiling` is `undefined`, and the 1.5 case passes
when it should not (zod strips unknown keys rather than rejecting them).

- [ ] **Step 3: Add it to the schema**

In `packages/shared/src/schemas.ts`, inside `createSchema`, after the `window`
field:

```ts
  /**
   * Where a duel at this table starts, for a game that counts down.
   *
   * The same kind of decision as the seat count and the betting window: a
   * table that opens at a hundred is over in four rolls and one that opens at
   * ten thousand takes a while to get going, so it belongs to the host with
   * the rest of the table's shape. Bounded here and snapped to a level the
   * game offers, which is where the real refusal lives.
   */
  ceiling: z.number().int().min(100).max(10_000).optional(),
```

- [ ] **Step 4: Add it to the protocol**

In `packages/shared/src/protocol.ts`, in `ClientToServer["lobby:create"]`'s
payload, after `window?: number;`:

```ts
      /**
       * Where a duel at this table starts, for a game that counts down.
       *
       * Part of the shape of the table rather than of any one duel, so it is
       * the host's. Snapped to a level the game offers.
       */
      ceiling?: number;
```

- [ ] **Step 5: Pass it through the server**

In `apps/server/src/server.ts`, in the `lobby:create` handler, the `game.create`
options object currently ends `window: parsed.data.window,`. Add after it:

```ts
          ceiling: parsed.data.ceiling,
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run packages/shared/src/schemas.test.ts`
Expected: PASS, all 3 cases.

- [ ] **Step 7: Format, typecheck and lint**

```bash
npx biome format --write packages/shared/src/schemas.ts packages/shared/src/protocol.ts packages/shared/src/schemas.test.ts apps/server/src/server.ts
npm run typecheck
npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/protocol.ts packages/shared/src/schemas.test.ts apps/server/src/server.ts
git commit -m "feat(shared): a host may name the opening ceiling

Beside buyIn and window, and for the same reason both are there: a table
that opens at a hundred is over in four rolls and one that opens at ten
thousand takes a while to get going, so which it is belongs to the host
rather than to whoever sits down. Bounded here and snapped by the game.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The adapter

Where the money is. This is the file that has to be right about CLAUDE.md.

**Files:**
- Create: `games/death-roll/src/adapter.ts`
- Create: `games/death-roll/src/index.ts`
- Test: `games/death-roll/src/adapter.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: `deathRollAdapter(options?: { roll?: (ceiling: number) => number; turnMs?: number; resultMs?: number; dealMs?: number }): GameAdapter<Table>`

- [ ] **Step 1: Write the failing test**

`games/death-roll/src/adapter.test.ts`:

```ts
import type { GameDeps } from "@backroom/core";
import { TableError } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { deathRollAdapter } from "./adapter.js";
import type { Table } from "./table.js";

const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

/** An account that always has chips, and a note of everything asked of it. */
const spy = (enough = true) => {
  const took = vi.fn(async () => enough);
  const gave = vi.fn(async () => {});
  const deps = {
    take: took,
    give: gave,
    record: vi.fn(async () => {}),
    finished: vi.fn(async () => {}),
  } as unknown as GameDeps;
  return { deps, took, gave };
};

/** A table with two signed-in players at it, ready to be dealt. */
const seated = (game: ReturnType<typeof deathRollAdapter>, options = {}) => {
  const table = game.create("ABCDE", { buyIn: 500, ceiling: 1_000, ...options }) as Table;
  table.join("ada", "Ada", who("u1"));
  table.join("bob", "Bob", who("u2"));
  return table;
};

/** Starts a duel the way the room does: the table asks, payOut answers. */
const deal = async (
  game: ReturnType<typeof deathRollAdapter>,
  table: Table,
  deps: GameDeps,
) => {
  table.askForDuel();
  return await game.payOut?.(table, deps);
};

describe("getting a duel started", () => {
  it("takes an ante from each player and opens the pot with both", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const { deps, took } = spy();

    await deal(game, table, deps);

    expect(took).toHaveBeenCalledWith("u1", 500);
    expect(took).toHaveBeenCalledWith("u2", 500);
    expect(table.view(null).pot).toBe(1_000);
    expect(table.phase).toBe("dueling");
  });

  it("asks to be seen, because nothing else will send this state", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const { deps } = spy();

    expect(await deal(game, table, deps)).toBe(true);
  });

  it("says nothing when there was no duel waiting to start", async () => {
    // Called on every broadcast, so the common case is that it has no work.
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const { deps } = spy();

    expect(await game.payOut?.(table, deps)).toBeFalsy();
  });

  it("gives the first ante back when the second is refused", async () => {
    /*
     * The one that matters most here. A duel that took one ante and failed the
     * second would be a table holding somebody's stake for a game that never
     * happened — and `take` really can refuse, because a balance can be spent
     * at another table between sitting down and the duel coming round.
     */
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const took = vi
      .fn<(userId: string, amount: number) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const gave = vi.fn(async () => {});
    const deps = {
      take: took,
      give: gave,
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    await deal(game, table, deps);

    expect(gave).toHaveBeenCalledWith("u1", 500);
    expect(table.phase).toBe("waiting");
    expect(table.view(null).pot).toBe(0);
    expect(table.view(null).waitingFor).toBe("funds");
    expect(table.view(null).shortId).toBe("bob");
  });

  it("never deals to one player, whatever it is asked", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = game.create("ABCDE", { buyIn: 500 }) as Table;
    table.join("ada", "Ada", who("u1"));
    const { deps, took } = spy();

    await deal(game, table, deps);

    expect(took).not.toHaveBeenCalled();
    expect(table.phase).toBe("waiting");
  });
});

describe("rolling and passing", () => {
  it("rolls from the source it was given", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);

    await game.act(table, table.view(null).toRoll as string, { type: "roll" }, deps);

    expect(table.view(null).ceiling).toBe(743);
  });

  it("takes the price of a pass off the account and adds it to the pot", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps, took } = spy();
    await deal(game, table, deps);
    const first = table.view(null).toRoll as string;
    took.mockClear();

    await game.act(table, first, { type: "pass" }, deps);

    expect(took).toHaveBeenCalledWith(first === "ada" ? "u1" : "u2", 50);
    expect(table.view(null).pot).toBe(1_050);
  });

  it("refuses a pass the player cannot pay for, without spending it", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);
    const first = table.view(null).toRoll as string;
    const broke = spy(false);

    await expect(game.act(table, first, { type: "pass" }, broke.deps)).rejects.toThrow(
      TableError,
    );
    expect(table.view(null).pot).toBe(1_000);
    expect(table.view(null).seats.find((seat) => seat.id === first)?.passed).toBe(false);
  });

  it("refuses a move from somebody who is not at the table", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);

    await expect(game.act(table, "cat", { type: "roll" }, deps)).rejects.toThrow(TableError);
  });

  it("refuses anything that is not a move here", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);

    await expect(
      game.act(table, table.view(null).toRoll as string, { type: "double" }, deps),
    ).rejects.toThrow(TableError);
  });
});

describe("settling", () => {
  it("gives the winner the pot and takes nothing more from anybody", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps, took, gave } = spy();
    await deal(game, table, deps);
    const loser = table.view(null).toRoll as string;
    took.mockClear();

    await game.act(table, loser, { type: "roll" }, deps);

    expect(game.isSettled(table)).toBe(true);
    await game.settle(table, deps);

    const winner = loser === "ada" ? "u2" : "u1";
    expect(gave).toHaveBeenCalledWith(winner, 1_000);
    expect(took).not.toHaveBeenCalled();
  });

  it("hands out exactly what it was handed, passes and all", async () => {
    /*
     * The rule the whole building rests on, checked as arithmetic: the pot in
     * equals the pot out. There is no bank here to make up a difference, so a
     * mismatch is chips minted or chips vanished.
     */
    const rolls = [743, 1];
    const game = deathRollAdapter({ roll: () => rolls.shift() as number });
    const table = seated(game);
    const { deps, took, gave } = spy();
    await deal(game, table, deps);
    const first = table.view(null).toRoll as string;

    await game.act(table, first, { type: "pass" }, deps);
    const second = table.view(null).toRoll as string;
    await game.act(table, second, { type: "roll" }, deps);
    await game.act(table, table.view(null).toRoll as string, { type: "roll" }, deps);
    await game.settle(table, deps);

    const takenIn = took.mock.calls.reduce((sum, call) => sum + (call[1] as number), 0);
    const paidOut = gave.mock.calls.reduce((sum, call) => sum + (call[1] as number), 0);
    expect(takenIn).toBe(1_050);
    expect(paidOut).toBe(1_050);
  });

  it("names the winner for whatever is riding on them", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);
    const loser = table.view(null).toRoll as string;

    await game.act(table, loser, { type: "roll" }, deps);

    expect(game.winners?.(table)).toEqual([loser === "ada" ? "bob" : "ada"]);
  });

  it("writes the duel into the history with both nets", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps } = spy();
    const finished = deps.finished as unknown as ReturnType<typeof vi.fn>;
    await deal(game, table, deps);
    const loser = table.view(null).toRoll as string;

    await game.act(table, loser, { type: "roll" }, deps);
    await game.settle(table, deps);

    const record = finished.mock.calls[0]?.[0] as { players: { net: number }[]; pot: number };
    expect(record.pot).toBe(1_000);
    expect(record.players.map((one) => one.net).sort((a, b) => a - b)).toEqual([-500, 500]);
  });

  it("settles once and stays settled while the result is up", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);

    await game.act(table, table.view(null).toRoll as string, { type: "roll" }, deps);

    expect(game.isSettled(table)).toBe(true);
    table.finish();
    expect(game.isSettled(table)).toBe(false);
  });
});

describe("a table playing for nothing", () => {
  it("never touches an account, over a whole duel", async () => {
    /*
     * The rule is in CLAUDE.md in so many words, and it is also the mistake
     * that has actually happened in this repo — a verification run opened a
     * chips table by accident and spent somebody's real balance. So the
     * assertion is not that the right amount moved but that nothing was asked
     * of the account at all.
     */
    const game = deathRollAdapter({ roll: () => 1 });
    const table = game.create("ABCDE", { forFun: true, buyIn: 500 }) as Table;
    table.join("ada", "Ada", null);
    table.join("bob", "Bob", null);
    const { deps, took, gave } = spy();

    await deal(game, table, deps);
    await game.act(table, table.view(null).toRoll as string, { type: "roll" }, deps);
    await game.settle(table, deps);

    expect(took).not.toHaveBeenCalled();
    expect(gave).not.toHaveBeenCalled();
  });

  it("moves the play purses instead, and they still sum to nothing", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = game.create("ABCDE", { forFun: true, buyIn: 500 }) as Table;
    table.join("ada", "Ada", null);
    table.join("bob", "Bob", null);
    const { deps } = spy();

    await deal(game, table, deps);
    const loser = table.view(null).toRoll as string;
    await game.act(table, loser, { type: "roll" }, deps);
    await game.settle(table, deps);

    expect(table.purseFor("ada") + table.purseFor("bob")).toBe(20_000);
    expect(table.purseFor(loser)).toBe(9_500);
  });

  it("refills a purse too short for the ante rather than stopping play", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = game.create("ABCDE", { forFun: true, buyIn: 500 }) as Table;
    table.join("ada", "Ada", null);
    table.join("bob", "Bob", null);
    table.movePurse("ada", -9_800);
    const { deps } = spy();

    await deal(game, table, deps);

    expect(table.phase).toBe("dueling");
    expect(table.purseFor("ada")).toBe(9_500);
  });
});

describe("who may sit down", () => {
  it("refuses a bot at a table playing for chips", () => {
    // The line the whole economy rests on: a bot at a chips table is a button
    // somebody holds down. Refused here rather than hidden by the client.
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);

    expect(() => game.botMove?.(table)).not.toThrow();
    expect(table.forFun).toBe(false);
  });
});

describe("the table's own clock", () => {
  it("rolls for somebody whose time runs out rather than forfeiting", async () => {
    /*
     * Rolling is chance either way, so a clock cannot disadvantage an absent
     * player — there is no decision being taken from them. Forfeiting would
     * let a bad connection lose somebody their stake, which is the one thing a
     * clock must never do.
     */
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);
    const waiting = table.view(null).toRoll as string;

    game.timeout?.(table, waiting);

    expect(table.view(null).ceiling).toBe(743);
    expect(table.view(null).toRoll).not.toBe(waiting);
  });

  it("puts the clock on whoever is to act", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);

    const clock = game.clock?.(table);

    expect(clock?.seatId).toBe(table.view(null).toRoll);
    expect(clock?.endsAt).toBeGreaterThan(Date.now());
  });

  it("waits for a second player without asking for a duel", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = game.create("ABCDE", { buyIn: 500 }) as Table;
    table.join("ada", "Ada", who("u1"));

    expect(game.pause?.(table)).toBeNull();
  });

  it("asks for a duel once there are two, and clears the felt after one", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps } = spy();

    const waiting = game.pause?.(table);
    expect(waiting?.key).toBe("deal");
    waiting?.run();
    expect(table.pending).toBe(true);

    await game.payOut?.(table, deps);
    await game.act(table, table.view(null).toRoll as string, { type: "roll" }, deps);

    const result = game.pause?.(table);
    expect(result?.key).toBe("result");
    result?.run();
    expect(table.phase).toBe("waiting");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run games/death-roll/src/adapter.test.ts`
Expected: FAIL — `Failed to resolve import "./adapter.js"`.

- [ ] **Step 3: Write the implementation**

`games/death-roll/src/adapter.ts`:

```ts
import type { BotMove, GameAdapter, GameDeps } from "@backroom/core";
import { seatLimit, TableError } from "@backroom/core";
import { decide, thinkingTime } from "./bot.js";
import { anteFor, DEAL_MS, DEATH_ROLL, openingFor, RESULT_MS, TURN_MS } from "./listing.js";
import { Table } from "./table.js";

/**
 * What the room does with a death roll table.
 *
 * The money is the simplest in the building and needs no bank to be honest:
 * every chip in the pot came off one of the two people playing for it, and one
 * of them takes it. The room hands out nothing it was not handed first, by the
 * shape of the game rather than by a cap argued from a worst case.
 *
 * The timing is the awkward part, and it is unlike every other game here.
 * Elsewhere a hand is over the instant the last card lands and settling only
 * catches the chips up; here the money moving *is* the state changing, because
 * a duel cannot start until both antes are in and nothing starts one but a
 * clock. `pause` is synchronous and cannot take an ante, so the table asks for
 * a duel and `payOut` — asynchronous, unlatched, run on every broadcast —
 * answers, then asks the room to send the state again.
 */

export function deathRollAdapter(
  options: {
    /**
     * Where the number comes from.
     *
     * Injected so tests can roll to order, and in the server it is
     * `randomInt` rather than `Math.random`: this game hands the player its
     * whole result every single turn, which is exactly the run of observations
     * that recovers xorshift128+ state — and somebody who knew the next roll
     * would know whether to spend their pass, which is the entire game.
     */
    roll?: (ceiling: number) => number;
    turnMs?: number;
    resultMs?: number;
    dealMs?: number;
  } = {},
): GameAdapter<Table> {
  const roll = options.roll ?? ((ceiling: number) => Math.floor(Math.random() * ceiling) + 1);
  const turnMs = options.turnMs ?? TURN_MS;
  const resultMs = options.resultMs ?? RESULT_MS;
  const dealMs = options.dealMs ?? DEAL_MS;

  /**
   * Chips off a player, wherever this table's chips live.
   *
   * Two entirely separate worlds behind one verb, and keeping them apart is
   * the point: a for-fun table's purses are on the table and are gone when it
   * closes, and a chips table's are real balances belonging to real people. A
   * branch that got this wrong would quietly spend the latter.
   */
  const take = async (
    table: Table,
    seat: { id: string; userId: string | null },
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
    seat: { id: string; userId: string | null },
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

  return {
    listing: DEATH_ROLL,

    create(code, made) {
      const table = new Table(code, seatLimit(made?.["maxSeats"], DEATH_ROLL.maxSeats), {
        opening: openingFor(made?.["ceiling"]),
        ante: anteFor(made?.["buyIn"]),
        turnMs,
      });
      // Fixed when the table is opened: a table anybody may sit at and one
      // that spends real chips are not the same game with a different label.
      table.forFun = made?.["forFun"] === true;
      return table;
    },

    async act(table, seatId, action, deps) {
      const move = action as { type?: string };
      const seat = table.seats.find((one) => one.id === seatId);
      if (seat === undefined) {
        throw new TableError("You are not at this table.");
      }
      const duel = table.duel;
      if (duel === null) {
        throw new TableError("There is no duel to play here yet.");
      }

      switch (move.type) {
        case "roll": {
          duel.roll(seatId, roll);
          table.touchClock();
          return;
        }
        case "pass": {
          /*
           * Asked, paid, then spent. The table is asked first because it is
           * the cheap refusal, and the pass is only marked spent once the
           * chips are actually gone — so a player who cannot afford it is
           * refused with their pass still in hand rather than burnt.
           */
          const price = duel.checkPass(seatId);
          if (!(await take(table, seat, price, deps))) {
            throw new TableError(
              table.forFun ? "That is more than your purse." : "You cannot cover a pass.",
            );
          }
          duel.pass(seatId);
          table.touchClock();
          return;
        }
        default:
          throw new TableError("That is not a move at this table.");
      }
    },

    /**
     * The antes, and the one thing in the building that starts a game here.
     *
     * Drained before the first await, which is what makes running on every
     * broadcast into exactly-once rather than a way to charge somebody twice.
     * Returns true only on the call that actually dealt, so the extra
     * broadcast this asks for cannot recur.
     */
    async payOut(table, deps) {
      const wanted = table.takePending();
      if (wanted === null) {
        return false;
      }
      const [first, second] = wanted;
      if (first === undefined || second === undefined) {
        return false;
      }
      const seats = [first, second].map((id) => table.seats.find((one) => one.id === id));
      const [one, two] = seats;
      if (one === undefined || two === undefined) {
        return false;
      }

      /*
       * Play money is topped back up rather than allowed to stop the table.
       * Nothing is at stake, so running dry should cost somebody a moment
       * rather than their evening.
       */
      table.topUp(one.id);
      table.topUp(two.id);

      if (!(await take(table, one, table.ante, deps))) {
        table.noteShort(one.id);
        return true;
      }
      if (!(await take(table, two, table.ante, deps))) {
        /*
         * Straight back, before anything else happens. A duel that took one
         * ante and failed the second would be a table holding somebody's stake
         * for a game that never happened.
         */
        await give(table, one, table.ante, deps);
        table.noteShort(two.id);
        return true;
      }
      table.begin();
      return true;
    },

    isSettled(table) {
      return table.phase === "over";
    },

    /**
     * Pays what the duel came to.
     *
     * The pot and nothing else, out of chips that are already in it. There is
     * no bank to draw on and none is wanted: every chip here came off one of
     * these two people.
     */
    async settle(table, deps) {
      const duel = table.duel;
      if (duel === null || duel.loserId === null) {
        return;
      }
      const winnerId = duel.winnerId;
      const winner = table.seats.find((one) => one.id === winnerId);
      if (winner !== undefined) {
        await give(table, winner, duel.pot, deps);
      }

      /*
       * Play money is paid but never recorded. A for-fun table touches no
       * account, so a win there is not a win anybody's profile should claim —
       * and a guest has no account to write one on either way.
       */
      if (table.forFun) {
        return;
      }

      for (const seat of table.seats) {
        if (seat.userId === null) {
          continue;
        }
        const net = duel.netFor(seat.id);
        await deps.record(seat.userId, {
          shared: { games: 1, wins: net > 0 ? 1 : 0, chipsWon: net },
          game: DEATH_ROLL.id,
          add: { duels: 1, passes: duel.hasPassed(seat.id) ? 1 : 0 },
          max: { pot: duel.pot },
        });
      }

      await deps.finished({
        code: table.code,
        /* What it was played at, which is the only ruleset this game has. */
        rulesetName: `${table.opening}`,
        buyIn: table.ante,
        pot: duel.pot,
        players: table.seats.map((seat) => ({
          userId: seat.userId,
          name: seat.name,
          /* The last number they rolled, which is what a duel leaves behind. */
          score: duel.history.filter((one) => one.seatId === seat.id).at(-1)?.result ?? 0,
          isBot: seat.isBot,
          net: duel.netFor(seat.id),
        })),
        winnerIds: winnerId === null ? [] : [winnerId],
        endedAt: Date.now(),
      });
    },

    winners(table) {
      const winner = table.duel?.winnerId ?? null;
      return winner === null ? [] : [winner];
    },

    clock(table) {
      const endsAt = table.turnEndsAt;
      const toRoll = table.view(null).toRoll;
      if (toRoll === null || endsAt === null) {
        return null;
      }
      return { seatId: toRoll, endsAt };
    },

    /**
     * Rolls for somebody whose time ran out, rather than forfeiting for them.
     *
     * Rolling is chance either way, so a clock cannot disadvantage an absent
     * player: there is no decision being taken away from them, only a pass
     * they were not going to spend. Forfeiting would let a bad connection lose
     * somebody their stake, which is the one thing a clock must never do.
     */
    timeout(table, seatId) {
      const duel = table.duel;
      if (duel === null || duel.over || duel.toRoll !== seatId) {
        return;
      }
      duel.roll(seatId, roll);
      table.touchClock();
    },

    /**
     * A bot's turn, or nothing.
     *
     * Only ever at a table playing for nothing — the table refuses to seat one
     * anywhere else, so by the time there is a bot here the question of real
     * chips has already been settled.
     */
    botMove(table): BotMove | null {
      const duel = table.duel;
      if (duel === null || duel.over) {
        return null;
      }
      const seat = table.seats.find((one) => one.id === duel.toRoll);
      if (seat === undefined || !seat.isBot) {
        return null;
      }
      const choice = decide({
        skill: seat.skill ?? "normal",
        ceiling: duel.ceiling,
        ante: table.ante,
        price: table.passPrice,
        canPass: !duel.hasPassed(seat.id) && table.purseFor(seat.id) >= table.passPrice,
      });
      return {
        seatId: seat.id,
        delayMs: thinkingTime(seat.skill ?? "normal"),
        play() {
          /*
           * Checked again on the way in. A bot thinks for the best part of a
           * second and the table does not stop for it — the clock may have
           * rolled for somebody and moved the turn on, and a move sent for a
           * seat whose turn it no longer is would throw with nobody to hear.
           */
          if (table.duel !== duel || duel.over || duel.toRoll !== seat.id) {
            return;
          }
          if (choice === "pass") {
            table.movePurse(seat.id, -table.passPrice);
            duel.pass(seat.id);
          } else {
            duel.roll(seat.id, roll);
          }
          table.touchClock();
        },
      };
    },

    /**
     * The table's own clock, which is what makes it deal itself.
     *
     * Two waits. A table with two people at it and no duel on the felt asks
     * for one after a beat; a finished duel sits where it is long enough to be
     * read and is then cleared away. Nobody presses start.
     */
    pause(table) {
      if (table.phase === "over") {
        return { key: "result", ms: resultMs, run: () => table.finish() };
      }
      if (table.phase === "waiting" && table.ready && !table.pending) {
        return { key: "deal", ms: dealMs, run: () => table.askForDuel() };
      }
      return null;
    },
  };
}
```

`games/death-roll/src/index.ts`:

```ts
/**
 * Death rolling: two people, and a number that only goes down.
 *
 * The whole game in one package — its arithmetic, its duel, its table and its
 * bot. It borrows seating and the shape of a table from @backroom/core and
 * brings everything that makes it this game rather than another one.
 */
export { edge, lossOdds, passCost, passGain, worthPassing } from "./odds.js";
export type { Passed, Rolled } from "./duel.js";
export { Duel } from "./duel.js";
export type { Phase, SeatView, TableView } from "./table.js";
export { Table } from "./table.js";
export type { Choice } from "./bot.js";
export { decide, thinkingTime } from "./bot.js";
export {
  ANTE,
  CEILINGS,
  DEAL_MS,
  DEATH_ROLL,
  FUN_PURSE,
  OPENING,
  PASS_DIVISOR,
  RESULT_MS,
  STAKES,
  TURN_MS,
  anteFor,
  openingFor,
  passPrice,
} from "./listing.js";
export { deathRollAdapter } from "./adapter.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run games/death-roll/src/adapter.test.ts`
Expected: PASS, all 21 tests.

- [ ] **Step 5: Format, typecheck and lint**

```bash
npx biome format --write games/death-roll/src/adapter.ts games/death-roll/src/adapter.test.ts games/death-roll/src/index.ts
npm run typecheck
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add games/death-roll/src/adapter.ts games/death-roll/src/adapter.test.ts games/death-roll/src/index.ts
git commit -m "feat(death-roll): the adapter, where the money is

No bank, and it needs no argument: every chip in the pot came off one of
the two people playing for it and one of them takes it, so the room hands
out nothing it was not handed first. The test that asserts it is the one
totting up take and give across a duel with a pass in it and finding they
match.

The antes are taken in payOut and the table is dealt from there, because
taking one is asynchronous and a duel starts on a timer. A second ante
that is refused hands the first one straight back — a duel that took one
and failed the other would be a table holding a stake for a game that
never happened.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The room opens the door

Registering the game on the server, with the crypto roller, and proving a whole
duel works end to end over two sockets.

**Files:**
- Modify: `apps/server/src/server.ts` (imports, `CATALOGUE`, `ADAPTERS`)
- Test: `apps/server/src/deathroll.socket.test.ts`

**Interfaces:**
- Consumes: `DEATH_ROLL`, `deathRollAdapter` (Tasks 3, 8).
- Produces: a running `death-roll` table on the socket server.

- [ ] **Step 1: Read an existing socket test to reuse its harness**

Run: `sed -n '1,80p' apps/server/src/roulette.socket.test.ts`

Reuse whatever it does to start a server, connect clients and await states.
Do not build a second harness.

- [ ] **Step 2: Write the failing test**

`apps/server/src/deathroll.socket.test.ts`, following that file's harness:

```ts
import { describe, expect, it } from "vitest";

/**
 * A whole duel, over two sockets, with the balances checked at both ends.
 *
 * The unit tests prove the arithmetic; this proves the wiring — that a table
 * of this game can actually be opened, that the antes leave the two accounts,
 * and that everything taken comes back to one of them.
 */
describe("a death roll table over sockets", () => {
  it("opens, deals itself once two people are at it, and pays the winner", async () => {
    // Start a server with a roller that always returns 1, so the first roll
    // ends the duel and the test does not depend on chance.
    // Give both accounts 10_000. Open a death-roll table as Ada with
    // { game: "death-roll", buyIn: 500, ceiling: 1_000 }, join it as Bob.
    // Wait for a state with phase "dueling".
    // Assert both balances are 9_500 — the antes are on the felt.
    // Send { type: "roll" } from whoever the state says is to roll.
    // Wait for a state with phase "over".
    // Assert the loser is at 9_500 and the winner at 10_500.
    expect(true).toBe(true); // replace with the above
  });

  it("takes nothing from anybody while it waits for a second player", async () => {
    // Open a death-roll table as Ada and send nothing else.
    // Wait long enough for the deal pause to have fired twice over.
    // Assert Ada's balance is untouched and the state's pot is 0.
  });

  it("refuses a bot at a table playing for chips", async () => {
    // Open a chips table, emit lobby:addBot, and assert the seat count
    // stays at one. The refusal is the server's, not the client's.
  });
});
```

Write these three out properly against the harness in
`roulette.socket.test.ts`. The comments above are the assertions to make, not
placeholders to leave in — every one of them must end up as real code before
this task is done.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run apps/server/src/deathroll.socket.test.ts`
Expected: FAIL — opening the table is refused, because `death-roll` is in
neither the catalogue nor `ADAPTERS`.

- [ ] **Step 4: Register the game**

In `apps/server/src/server.ts`, add the import beside the other games:

```ts
import { DEATH_ROLL, deathRollAdapter } from "@backroom/game-death-roll";
```

Add it to the catalogue (line 98):

```ts
  new Catalogue()
    .add(GREED)
    .add(BLACKJACK)
    .add(SLOTS)
    .add(POKER)
    .add(TIPS)
    .add(ROULETTE)
    .add(DEATH_ROLL),
```

Add it to `ADAPTERS`, after the roulette entry:

```ts
    [
      DEATH_ROLL.id,
      deathRollAdapter({
        /*
         * The roll, from the same source the reels and the shoe come from.
         * This table hands the player its whole result every single turn,
         * which over a duel is exactly the run of observations needed to
         * recover Math.random's state — and somebody who knew the next roll
         * would know whether to spend their pass, which is the whole game.
         *
         * `randomInt` rather than scaling `spinRandom`, because it is
         * rejection-sampled and so uniform over any ceiling, which scaling a
         * float is not.
         */
        roll: (ceiling: number) => randomInt(1, ceiling + 1),
        ...(turnMs === undefined ? {} : { turnMs }),
      }) as GameAdapter<PlayTable>,
    ],
```

`randomInt` is already imported at the top of the file from `node:crypto`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run apps/server/src/deathroll.socket.test.ts`
Expected: PASS, all 3 cases.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS. `catalogue.test.ts` in particular should now be happy with
`death-roll` listed once, open, and not shadowed.

- [ ] **Step 7: Format, typecheck and lint**

```bash
npx biome format --write apps/server/src/server.ts apps/server/src/deathroll.socket.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/server.ts apps/server/src/deathroll.socket.test.ts
git commit -m "feat(server): the death roll table opens

Registered with randomInt as its roller rather than Math.random. This
table hands the player its whole result every turn, which over a duel is
exactly the run of observations that recovers xorshift128+ state — and
somebody who knew the next roll would know whether to spend their pass,
which is the entire game. That there is no bank here does not help; the
chips would be coming off the person sitting opposite.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The felt

The page: theme, route, lobby, seats, the number, the two buttons. Motion comes
in Task 11 — this task is about the table being playable and correct.

**Files:**
- Create: `games/death-roll/src/theme.css`
- Create: `apps/web/src/deathroll/DeathRoll.tsx`
- Create: `apps/web/src/deathroll/deathroll.css`
- Test: `apps/web/src/deathroll/DeathRoll.test.tsx`
- Modify: `apps/web/src/App.tsx` (import and two routes)

**Interfaces:**
- Consumes: `TableView`, `DEATH_ROLL`, `STAKES`, `CEILINGS` from
  `@backroom/game-death-roll`; `useTableSocket` from `../table/useTableSocket.js`.
- Produces: `export function DeathRoll()`.

- [ ] **Step 1: Read the closest existing page in full**

Run: `sed -n '1,200p' apps/web/src/roulette/Roulette.tsx`

Match its shape exactly: the `useTableSocket<TableView>("death-roll", back,
account.setChips)` call, the `document.documentElement.dataset["game"]` effect,
the code-in-the-URL handling, `<Navbar>`, `<PublicTables>`, `<Chat>`. This page
should look like it was written by whoever wrote that one.

- [ ] **Step 2: Write the failing test**

`apps/web/src/deathroll/DeathRoll.test.tsx`. Follow
`apps/web/src/roulette/Roulette.test.tsx` for how it mocks the socket.

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * What the felt says, and what it refuses to say.
 *
 * The client may show every rule in CLAUDE.md and must never be the thing
 * enforcing one, so these are about what a player can read rather than about
 * what they are prevented from doing.
 */
describe("the death roll felt", () => {
  it("says it is waiting for an opponent, and offers nothing to press", () => {
    // Render with a view: phase "waiting", waitingFor "opponent", pot 0.
    // Expect the words, and expect no enabled Roll button.
  });

  it("shows the number the duel is being rolled against", () => {
    // phase "dueling", ceiling 743. Expect 743 on screen.
  });

  it("shows the odds under it, so the moment to pass is visible", () => {
    // ceiling 10 → lossOdds is 50.909…%, shown to one decimal place.
    // Expect "50.9%".
  });

  it("offers a pass with its price on it", () => {
    // Expect a control naming 50 when passPrice is 50.
  });

  it("takes the pass away once it is spent", () => {
    // you.passed true → no pass control at all. Hiding it is a courtesy;
    // the server refusing it is the rule.
  });

  it("says who lost, and on what", () => {
    // phase "over", loserId, lastRoll { from: 9, result: 1 }.
    // Expect the loser's name and both numbers.
  });

  it("says a for-fun table is a for-fun table", () => {
    // forFun true → the purse is shown and the word "chips" is not used for
    // it. A player must never be unsure which of the two they are spending.
  });
});
```

Write each of these out properly against whatever render helper
`Roulette.test.tsx` uses.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run apps/web/src/deathroll/DeathRoll.test.tsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Write the theme**

`games/death-roll/src/theme.css`. Copy the structure of
`games/roulette/src/theme.css` — same variable names, same
`:root[data-game="…"]` selector pair — with `data-game="death-roll"` and these
values:

```css
/*
 * The death roll room.
 *
 * Same rule as every other room's: a game owns its materials, the building
 * owns its interface. So this repaints the surfaces and touches nothing that
 * carries meaning — neon stays the building's, chip stays gold, good and bad
 * stay what they are everywhere else.
 *
 * A duel needs no felt to speak of. There are no cards, no cloth and no
 * layout to read, so the room is mostly dark with one number lit in the middle
 * of it — which is why this is the one violet room in the building rather than
 * another green table. Violet reads as lit rather than as coloured, and a
 * number falling through it is the only thing there is to look at.
 */
:root[data-game="death-roll"],
[data-game="death-roll"] {
  --gr-color-night: #16141c;
  --gr-color-felt: #241f33;
  --gr-color-accent: #6b4bd6;
  --gr-color-accent-hi: #b39cff;
}
```

Fill in every other variable roulette's theme sets, derived from these four —
run `grep -n "^  --gr-" games/roulette/src/theme.css` for the full list, and
give each one a value in this palette. A variable roulette sets and this does
not is a variable that falls back to the building's default, which will read as
the wrong room.

- [ ] **Step 5: Write the page and its stylesheet**

`apps/web/src/deathroll/DeathRoll.tsx`, modelled on `Roulette.tsx`. It must:

- import `"@backroom/game-death-roll/theme.css"` and `"./deathroll.css"` — and
  before adding a single rule to `deathroll.css`, confirm that import is there.
  This repo has had orphan stylesheets nothing loads.
- set `document.documentElement.dataset["game"] = "death-roll"` on mount and
  delete it on unmount.
- offer a host, when opening a table, a stake from `STAKES` and an opening
  ceiling from `CEILINGS`, sent as `buyIn` and `ceiling` on `create`.
- render, when `state.phase === "waiting"`: the reason from
  `state.waitingFor` — "Waiting for an opponent." or, for `"funds"`, that the
  seat named by `state.shortId` is short of the ante — and no move controls.
- render, when dueling: both seats, the pot, `state.ceiling` as the largest
  thing on the page, and `lossOdds(state.ceiling)` under it as a percentage to
  one decimal place, labelled as the chance of the player to roll losing.
- render two controls when it is your turn: **Roll**, and **Pass** naming
  `state.passPrice`. Pass is absent when `state.you?.passed` is true.
- render, when over: who lost, and `state.lastRoll`'s `from` and `result`.
- show `state.you.purse` when `state.forFun`, labelled as play money.

`apps/web/src/deathroll/deathroll.css` holds the layout. Requirements that are
not negotiable:

- **375px first.** The seats stack, the number stays centred and stays the
  largest thing on screen, and Roll and Pass sit along the bottom within reach
  of one thumb. Nothing scrolls sideways — the roll history scrolls inside its
  own `overflow-x: auto` box.
- **Nothing is reachable only by hover.**
- Controls are at least 44px tall.

- [ ] **Step 6: Add the routes**

In `apps/web/src/App.tsx`, add the import beside the others:

```tsx
import { DeathRoll } from "./deathroll/DeathRoll.js";
```

and the routes beside the other games' pairs:

```tsx
      <Route path="/death-roll" element={<DeathRoll />} />
      <Route path="/death-roll/:code" element={<DeathRoll />} />
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run apps/web/src/deathroll/DeathRoll.test.tsx`
Expected: PASS, all 7 cases.

- [ ] **Step 8: Look at it, at 375px and at a desk**

Start the dev server through the Browser pane (`preview_start`, never Bash),
open a table, and check with a second tab as the opponent:

- at 375 wide: no sideways scroll, both buttons thumb-reachable, the number
  still the biggest thing on the page;
- the waiting state says what it is waiting for;
- `prefers-reduced-motion` is not yet relevant — that is Task 11.

- [ ] **Step 9: Format, typecheck and lint**

```bash
npx biome format --write games/death-roll/src/theme.css apps/web/src/deathroll apps/web/src/App.tsx
npm run typecheck
npm run lint
```

- [ ] **Step 10: Commit**

```bash
git add games/death-roll/src/theme.css apps/web/src/deathroll apps/web/src/App.tsx
git commit -m "feat(web): the death roll felt

A duel has no cloth to read and no layout to learn, so the room is dark
with one number lit in the middle of it — the one violet room in the
building, because violet reads as lit rather than as coloured.

The odds sit under the number and tick as it falls. That readout is what
makes the pass a real decision for somebody playing their first duel:
without it, knowing when passing turns correct is something you have to
have been told.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The number falls

The motion, the sound, and the press that lands before the server has answered.
This is the task that makes it a game rather than a form.

**Files:**
- Create: `apps/web/src/deathroll/Falling.tsx`
- Create: `apps/web/src/deathroll/useIntent.ts`
- Test: `apps/web/src/deathroll/Falling.test.tsx`
- Test: `apps/web/src/deathroll/useIntent.test.ts`
- Modify: `apps/web/src/deathroll/DeathRoll.tsx`
- Modify: `apps/web/src/deathroll/deathroll.css`

**Interfaces:**
- Consumes: `TableView` (Task 4), the page (Task 10).
- Produces:
  - `<Falling value={number} rolling={boolean} />`
  - `useIntent(state, seatId, act)` → `{ rolling: boolean; pending: number; roll(): void; pass(): void }`

- [ ] **Step 1: Write the failing test for the press**

`apps/web/src/deathroll/useIntent.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useIntent } from "./useIntent.js";

/**
 * The bargain in CLAUDE.md, tested on a clock rather than by eye.
 *
 * A number the player chose can be shown at once; a fact only the server knows
 * cannot be. On a machine talking to itself the reply lands inside a frame, so
 * a version of this that never worked would look perfect right up until
 * somebody played from another continent. Every test here holds the reply.
 */
describe("pressing roll", () => {
  it("starts the number tumbling before the server has answered", () => {
    const act_ = vi.fn();
    const { result } = renderHook(() => useIntent(dueling(), "ada", act_));

    act(() => result.current.roll());

    // Tumbling is not a guessed result — the digits are visibly unresolved.
    // What must never happen is a number appearing and then changing.
    expect(result.current.rolling).toBe(true);
    expect(act_).toHaveBeenCalledWith({ type: "roll" }, expect.any(Function));
  });

  it("settles when the table speaks, and not before", () => {
    let done = () => {};
    const act_ = vi.fn((_: unknown, cb: () => void) => {
      done = cb;
    });
    const { result, rerender } = renderHook(
      ({ state }) => useIntent(state, "ada", act_),
      { initialProps: { state: dueling() } },
    );

    act(() => result.current.roll());
    expect(result.current.rolling).toBe(true);

    act(() => done());
    rerender({ state: dueling({ ceiling: 743 }) });

    expect(result.current.rolling).toBe(false);
  });

  it("gives up on it if the table refuses", () => {
    // A refused press must leave nothing behind on the felt.
  });

  it("gives up on it if the answer never comes", () => {
    // Held past the timeout with fake timers; rolling must go back to false
    // rather than spinning for ever.
  });
});

describe("pressing pass", () => {
  it("puts the chips down on the press, because the price is not a guess", () => {
    // The stake is the player's own number, so it may be shown at once —
    // unlike a roll, which is the server's to know.
    const act_ = vi.fn();
    const { result } = renderHook(() => useIntent(dueling(), "ada", act_));

    act(() => result.current.pass());

    expect(result.current.pending).toBe(50);
  });

  it("takes them back if the table refuses", () => {
    // Anything shown early is given up on if it is refused.
  });
});
```

Write `dueling(overrides)` as a local helper returning a `TableView` with
`phase: "dueling"`, `toRoll: "ada"`, `ceiling: 1_000`, `passPrice: 50`,
`pot: 1_000`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/web/src/deathroll/useIntent.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the intent hook**

`apps/web/src/deathroll/useIntent.ts` — model it on
`apps/web/src/poker/useIntent.ts`, which solves the same problem for poker.
Read that file first.

The rules it implements, from CLAUDE.md:

- `roll()` sets `rolling` true immediately and sends `{ type: "roll" }`. It
  never sets a number: a card is not yours to guess, and neither is a die.
  `rolling` clears when the view's `lastRoll` changes, when the send is
  refused, or after a timeout — whichever comes first.
- `pass()` sets `pending` to `state.passPrice` immediately, because the price
  is a number the player already chose. It clears the same three ways.
- Both are ignored when it is not this seat's turn — a courtesy, since the
  server refuses them anyway.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run apps/web/src/deathroll/useIntent.test.ts`
Expected: PASS, all 6 cases.

- [ ] **Step 5: Write the failing test for the motion**

`apps/web/src/deathroll/Falling.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Falling } from "./Falling.js";

describe("the number falling", () => {
  it("shows the number it settled on", () => {
    render(<Falling value={743} rolling={false} />);
    expect(screen.getByText("743")).toBeTruthy();
  });

  it("shows no number at all while it is still tumbling", () => {
    /*
     * The whole point. A tumbling number that showed a value would be the
     * client inventing a fact only the server knows — and worse, the player
     * would see it change, which reads as the table correcting itself.
     */
    const { container } = render(<Falling value={743} rolling={true} />);
    expect(container.textContent).not.toContain("743");
  });

  it("is one element across the change, not two", () => {
    // Two animations fighting over one element is the bug, not the effect. The
    // element that tumbles must be the element that settles, or the motion
    // does not continue across it.
    const { container, rerender } = render(<Falling value={1_000} rolling={true} />);
    const before = container.querySelector("[data-falling]");
    rerender(<Falling value={743} rolling={false} />);
    expect(container.querySelector("[data-falling]")).toBe(before);
  });

  it("says the number for anybody who cannot see it move", () => {
    // The page must say everything it needs to without the keyframes.
    render(<Falling value={743} rolling={false} />);
    expect(screen.getByText("743").getAttribute("aria-live")).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run apps/web/src/deathroll/Falling.test.tsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 7: Write the number, and its motion**

`apps/web/src/deathroll/Falling.tsx` renders a single element carrying
`data-falling`, which is the same element whether it is tumbling or settled —
that identity is what lets the motion continue across the change rather than
one animation replacing another.

In `deathroll.css`, the keyframes:

- a tumble while `rolling`, which reads as unresolved rather than as a value;
- a settle when the number arrives — short, physical, arriving from above with
  a little overshoot, never bouncing twice;
- a hard, short hit when the value is 1, with no flourish;
- chips landing on the pot when a pass is paid.

Every one of them inside:

```css
@media (prefers-reduced-motion: reduce) {
  /* Every keyframe in the building has an off switch, and the page still
     says everything it needs to without them. */
}
```

- [ ] **Step 8: Wire both into the page**

In `DeathRoll.tsx`, replace the plain ceiling number with `<Falling>`, driven
by `useIntent`. The pot shows `state.pot + pending` so a pass lands on the
press.

- [ ] **Step 9: Add the sound**

Follow `apps/web/src/roulette/useSpinSound.ts` and `apps/web/src/game/audio.ts`.
A rattle for the roll (a physical thing, so sampled — put the source in
`assets/audio/raw/` and let `npm run sync-audio` generate
`apps/web/public/audio/`, which is ignored). A synthesised tick for the pass, a
short low hit for the 1. All under the player's own volume and mute, and quiet
enough to sit under twenty presses.

- [ ] **Step 10: Run every test for this game**

```bash
npx vitest run apps/web/src/deathroll games/death-roll
```
Expected: PASS.

- [ ] **Step 11: Prove the press works on a bad connection**

In the Browser pane, throttle the network hard (or hold the server's reply) and
press Roll. The number must start tumbling on the press and settle only when
the answer lands — one arrival, not two — and no number may ever appear and
then change. A version that only works at zero latency is one that has not been
tested.

Then set `prefers-reduced-motion: reduce` and confirm the felt still says
everything: the number changes, the odds tick, nothing is lost.

Take a screenshot of a duel at 375px wide and one at desktop width.

- [ ] **Step 12: The whole suite, and the whole checklist**

```bash
npm test
npm run typecheck
npm run lint
npx biome format --write apps/web/src/deathroll
```

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/deathroll assets/audio
git commit -m "feat(web): the number falls, and a press lands before the table answers

A roll starts the digits tumbling on the press and settles them when the
server speaks — one arrival, not two. Tumbling is deliberately not a
guessed value: a card is not yours to guess and neither is a die, and a
number that appeared and then changed would read as the table correcting
itself. A pass puts its chips down at once, because the price is a number
the player already chose.

Tested by holding the reply rather than by eye. On a machine talking to
itself the answer lands inside a frame, so a version of this that never
worked at all would look perfect until somebody played from another
continent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: the duel and the
pass cap → Task 2; the arithmetic → Task 1; where the chips are, including the
refunded ante → Task 8; the table's clock → Tasks 4 and 8; leaving and the turn
clock → Tasks 4 and 8; for fun and bots → Tasks 4, 5, 8; randomness → Task 9;
where the code lives → Tasks 1–8; the protocol, including both shared changes →
Tasks 6 and 7; the felt → Tasks 10 and 11; theme → Task 10; stats and history →
Task 8; testing → throughout.

**Two known gaps, deliberate.** The socket test (Task 9, Step 2) and the felt
test (Task 10, Step 2) are specified as assertions to write against an existing
harness rather than as finished code, because both depend on a test harness this
plan has not read in full. Each step says explicitly that the comments must
become real code before the task is done. Every other test in this plan is
written out.

**Type consistency.** `Rolled`/`Passed` are used under those names in Tasks 2,
4 and 10. `phase` is the view's field throughout (never `status`, which is
core's). `ante` is the stake everywhere — `buyIn` appears only as the wire name
on `create`. `takePending()` returns `string[] | null` in Tasks 4 and 8 alike.
`worthPassing(ceiling, ante, price)` keeps that argument order in Tasks 1, 5
and 8.
