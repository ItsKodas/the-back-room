# Liar's Dice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Liar's Dice as a full table in The Back Room — two to ten seats, hidden hands, Dudo's bidding arithmetic, one pot of antes, playable on a phone and a desk.

**Architecture:** A new workspace package `games/liars-dice` supplies a `GameAdapter` and a `PlayTable` to the existing socket server, exactly as `games/death-roll` does; the server knows nothing about dice. Money is Death Roll's shape — one ante per player into the table's `Escrow`, the pot paid to the last player holding dice — so there is no bank. Hidden hands ride on the per-seat `view(forSeatId)` the table interface already has, the way Poker hides hole cards. The client is a new page under `apps/web/src/liarsdice/` built to the table standard from the first commit, using the shared `TalkSheet` / `Activity` / `Refusal` / `TableSetup` pieces rather than copies.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React 18, Vitest + Testing Library + jsdom, socket.io, zod for the wire schemas, Biome for lint (formatter off for CSS), npm workspaces with `tsc --build` project references.

**Spec:** `docs/superpowers/specs/2026-09-22-liars-dice-design.md`

## Global Constraints

Copied verbatim from the spec and `CLAUDE.md`. Every task's requirements implicitly include this section.

- **No real money, ever.** Nothing in this game takes payment. The pot is only ever the antes the players put in.
- **Chips are only won from real people.** No bots at a table playing for chips — `addBot` throws `TableError` unless `forFun`. A chips game does not run for one player; there is no bank here, so there is no exception.
- **Waiting never costs anybody a stake.** Chips leave an account only at the deal. A table that cannot deal holds nothing.
- **The server is the only authority.** The client may show every rule; it must never be the thing enforcing one. Hiding a control is a courtesy; refusing the message is the rule.
- **Outcomes come from a cryptographic source.** `roll` is injected; the server passes `() => randomInt(1, 7)` from `node:crypto`. Never `Math.random`.
- **A press lands immediately, whatever the connection.** A number the player chose shows at once; a fact only the server knows shows as a die arriving *face down* that turns over when the answer lands. One arrival, not two. Anything shown early is replaced on the table's word and given up on a refusal or a timeout.
- **Everything animated, and the animation says what happened.** Short and physical, one motion per element, `prefers-reduced-motion` off switch for every keyframe, and the page still says everything without them.
- **It works on a phone.** Nothing scrolls sideways at 375px. Thumb-sized controls. Hover reveals nothing you cannot reach without it.
- **Comments say why, not what.**
- **Every bug fix gets a test watched failing first.**
- `npm test`, `npm run typecheck`, `npm run lint` all clean.
- `biome format --write <paths>` on files touched. **Never** `biome check --write` across the repo.
- **Check a stylesheet is imported before adding to it** — `grep` the filename first.
- Attribution on every commit: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` as the last line.

### Fixed values

| Name | Value |
|---|---|
| Game id | `liars-dice` |
| Package | `@backroom/game-liars-dice` |
| Route | `/liars-dice`, `/liars-dice/:code` |
| Client dir | `apps/web/src/liarsdice/` |
| CSS prefix | `ld__` / `ld-` |
| Name on the sign | `Liar's Dice` |
| Blurb | `Five under a cup. Bid it up or call it.` |
| Mark | `{ text: "LIAR'S DICE", accentAt: 0 }` |
| Theme | `wall #17110d` · `felt #2e1c14` · `accent #e2622c` · `accentHi #ff9a63` |
| Seats | min 2, max 10 |
| Stakes | `[100, 500, 1_000, 5_000]`, default `500` |
| Dice each | `[3, 5]`, default `5` |
| Turn | 30_000 ms |
| Reveal on screen | 6_000 ms |
| Result on screen | 6_000 ms |
| Ready countdown | 20_000 ms |
| For-fun purse | 10_000 |
| Keys | Space bids, `L` liar, `E` exact |

---

## File Structure

### Created

| File | Responsibility |
|---|---|
| `packages/core/src/ready.ts` | `Readiness` — moved from Death Roll, now shared. |
| `packages/core/src/ready.test.ts` | Its tests, moved. |
| `games/liars-dice/package.json` | Workspace manifest. |
| `games/liars-dice/tsconfig.json` | Project reference config. |
| `games/liars-dice/src/listing.ts` | Listing, stake/dice levels, timings, snapping. |
| `games/liars-dice/src/bid.ts` | `Face`, `Bid`, `key`, `beats`, `leastCount`, `minRaise`, `countOf`, `says`. Pure rules. |
| `games/liars-dice/src/round.ts` | One round: hands, turn order, standing bid, resolving a call. |
| `games/liars-dice/src/game.ts` | Dice per player, rounds, elimination, opener, pot, winner, counters. |
| `games/liars-dice/src/bot.ts` | Binomial belief and a raise-or-call choice. |
| `games/liars-dice/src/table.ts` | `PlayTable`, seating, readiness, purses, per-seat view. |
| `games/liars-dice/src/adapter.ts` | `GameAdapter` — antes, settle, void, clock, timeout, pause, bots. |
| `games/liars-dice/src/index.ts` | Public exports. |
| `games/liars-dice/src/theme.css` | The room's colours. |
| `apps/web/src/liarsdice/Dice.tsx` | A die (face up, face down, matched, dying) and a row of them. |
| `apps/web/src/liarsdice/Seats.tsx` | The seat rail: ten plates with dice pips. |
| `apps/web/src/liarsdice/Readout.tsx` | `readoutFor()` model + the readout, with the draining clock. |
| `apps/web/src/liarsdice/Controls.tsx` | All three states of the bottom row: ready, the bid builder (face lamps, count stepper, Liar · Exact · Bid), and waiting on somebody else. |
| `apps/web/src/liarsdice/fixtures.ts` | `seat()` and `view()` builders shared by the client tests. |
| `apps/web/src/liarsdice/Reveal.tsx` | Every hand face up, the count, who lost a die. |
| `apps/web/src/liarsdice/Board.tsx` | The last rounds' results. |
| `apps/web/src/liarsdice/Rules.tsx` | The aces table behind the `?` key. |
| `apps/web/src/liarsdice/Sheet.tsx` | The table's own sheet (scrim, Escape, focus return). |
| `apps/web/src/liarsdice/lines.ts` | The table's sentences. |
| `apps/web/src/liarsdice/useIntent.ts` | The optimistic bid/call. |
| `apps/web/src/liarsdice/useLiarsKeys.ts` | Space / L / E. |
| `apps/web/src/liarsdice/useDiceSound.ts` | Cues keyed on the view. |
| `apps/web/src/liarsdice/LiarsDice.tsx` | The page: sit, setup, felt. |
| `apps/web/src/liarsdice/liarsdice.css` | The table's sheet. |
| `apps/web/src/liarsdice/liarsdice.css.test.ts` | The layout rules jsdom cannot see. |
| Tests beside each of the above | `*.test.ts` / `*.test.tsx`. |

### Modified

| File | Change |
|---|---|
| `packages/core/src/index.ts` | Export `Readiness`. |
| `games/death-roll/src/ready.ts` | Deleted; `index.ts` re-exports from core. |
| `games/death-roll/src/index.ts` | Re-export `Readiness` from `@backroom/core`. |
| `games/death-roll/src/table.ts` | Import `Readiness` from `@backroom/core`. |
| `packages/shared/src/schemas.ts` | `dice` option on `createSchema`. |
| `apps/server/src/server.ts` | Catalogue `.add(LIARS_DICE)`, adapter in `ADAPTERS`, `dice` passed to `create`. |
| `apps/web/src/App.tsx` | Two routes. |
| `apps/web/src/room/Room.tsx` | Theme import. |
| `apps/web/src/room/TileArt.tsx` | `CupArt` + dispatch. |
| `apps/web/src/game/audio.ts` | `sayExact` cue. |
| `apps/web/package.json`, `apps/server/package.json` | Workspace dep. |
| `tsconfig.json` | Nothing — `games/*` are pulled in by the apps that reference them (verify in Task 2). |

---

## Task 1: Move `Readiness` into core

The shared piece the spec asks for first. A pure move: the class has nothing dice-specific in it, and Death Roll keeps exporting it so its public API does not change.

**Files:**
- Create: `packages/core/src/ready.ts` (moved content)
- Create: `packages/core/src/ready.test.ts` (moved content)
- Modify: `packages/core/src/index.ts`
- Modify: `games/death-roll/src/index.ts`
- Modify: `games/death-roll/src/table.ts:1-6`
- Delete: `games/death-roll/src/ready.ts`, `games/death-roll/src/ready.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Readiness` from `@backroom/core`, with `countdownEndsAt: number | null`, `isReady(seatId): boolean`, `count(seated): number`, `set(seatId, ready, seated, now): void`, `drop(seatId, seated, now): void`, `sync(seated, now): void`, `dealable(seated, now): string[] | null`, `clear(): void`.

- [ ] **Step 1: Move the files with git so history follows them**

```bash
git mv games/death-roll/src/ready.ts packages/core/src/ready.ts
git mv games/death-roll/src/ready.test.ts packages/core/src/ready.test.ts
```

- [ ] **Step 2: Export it from core**

In `packages/core/src/index.ts`, add after the `Escrow` exports:

```ts
export { Readiness } from "./ready.js";
```

- [ ] **Step 3: Point Death Roll at core**

In `games/death-roll/src/table.ts`, the import block at the top currently reads:

```ts
import type { BotSkill, PlayTable, Seat, SeatIdentity, TableStatus } from "@backroom/core";
import { Escrow, Seating, TableError } from "@backroom/core";
import { Game } from "./game.js";
import { COUNTDOWN_MS, FUN_PURSE, passPrice, RESET_CEILING, TURN_MS } from "./listing.js";
import { Readiness } from "./ready.js";
```

Replace those five lines with:

```ts
import type { BotSkill, PlayTable, Seat, SeatIdentity, TableStatus } from "@backroom/core";
import { Escrow, Readiness, Seating, TableError } from "@backroom/core";
import { Game } from "./game.js";
import { COUNTDOWN_MS, FUN_PURSE, passPrice, RESET_CEILING, TURN_MS } from "./listing.js";
```

In `games/death-roll/src/index.ts`, replace the line `export { Readiness } from "./ready.js";` with a re-export from core, so anything importing it from this package keeps working:

```ts
// Moved to @backroom/core when Liar's Dice needed the same ready button.
// Re-exported rather than dropped: this package's exports are somebody's imports.
export { Readiness } from "@backroom/core";
```

- [ ] **Step 4: Run the moved tests and the typechecker**

```bash
npx vitest run packages/core/src/ready.test.ts
npm run typecheck
```

Expected: the ready tests PASS from their new home, and `tsc --build` is clean. If `vitest` does not pick up `packages/core`, check `vitest.config.ts` includes it — do not move the test back.

- [ ] **Step 5: Run the whole suite, to prove Death Roll is untouched in behaviour**

```bash
npm test
```

Expected: PASS, same count as before minus nothing.

- [ ] **Step 6: Format and lint**

```bash
npx biome format --write packages/core/src/ready.ts packages/core/src/ready.test.ts packages/core/src/index.ts games/death-roll/src/index.ts games/death-roll/src/table.ts
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
refactor(core): the ready button belongs to every table

Liar's Dice deals itself on the same terms Death Roll does — everybody
ready deals at once, two ready starts a countdown — and the class that
knows it had nothing dice-specific in it. Moved rather than copied;
Death Roll re-exports it so nobody's import breaks.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 2: The package skeleton and its listing

**Files:**
- Create: `games/liars-dice/package.json`
- Create: `games/liars-dice/tsconfig.json`
- Create: `games/liars-dice/src/listing.ts`
- Create: `games/liars-dice/src/listing.test.ts`
- Create: `games/liars-dice/src/index.ts`
- Create: `games/liars-dice/src/theme.css` (placeholder colours here, written properly in Task 10)

**Interfaces:**
- Consumes: `GameListing` from `@backroom/core`.
- Produces: `LIARS_DICE: GameListing`, `STAKES: readonly [100, 500, 1000, 5000]`, `ANTE = 500`, `DICE_LEVELS: readonly [3, 5]`, `DICE = 5`, `TURN_MS = 30_000`, `REVEAL_MS = 6_000`, `RESULT_MS = 6_000`, `COUNTDOWN_MS = 20_000`, `FUN_PURSE = 10_000`, `anteFor(asked: unknown): number`, `diceFor(asked: unknown): number`.

- [ ] **Step 1: Copy Death Roll's manifest shape**

`games/liars-dice/package.json`:

```json
{
  "name": "@backroom/game-liars-dice",
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

- [ ] **Step 2: Copy Death Roll's tsconfig**

```bash
cp games/death-roll/tsconfig.json games/liars-dice/tsconfig.json
cat games/liars-dice/tsconfig.json
```

If `games/death-roll/tsconfig.json` does not exist, the games are compiled through the apps that reference them and no tsconfig is needed — skip this step and confirm with `npm run typecheck` in step 6.

- [ ] **Step 3: Write the failing test**

`games/liars-dice/src/listing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ANTE, anteFor, DICE, diceFor, LIARS_DICE, STAKES } from "./listing.js";

describe("the listing", () => {
  it("is a table game for two to ten", () => {
    expect(LIARS_DICE.id).toBe("liars-dice");
    expect(LIARS_DICE.shape).toBe("table");
    expect(LIARS_DICE.minSeats).toBe(2);
    expect(LIARS_DICE.maxSeats).toBe(10);
    expect(LIARS_DICE.open).toBe(true);
  });

  it("writes its own name with the L lit", () => {
    expect(LIARS_DICE.mark).toEqual({ text: "LIAR'S DICE", accentAt: 0 });
  });
});

describe("the stake", () => {
  it("is the default for anything unusable", () => {
    expect(anteFor(undefined)).toBe(ANTE);
    expect(anteFor("lots")).toBe(ANTE);
    expect(anteFor(Number.NaN)).toBe(ANTE);
  });

  it("snaps to the nearest level", () => {
    expect(anteFor(90)).toBe(100);
    expect(anteFor(4_000)).toBe(5_000);
    expect(anteFor(1_000_000)).toBe(5_000);
  });

  it("puts a figure exactly between two levels on the cheaper one", () => {
    // 300 is 200 from both 100 and 500. A host who asks for something between
    // two stakes is put on the cheaper of them, the same answer every time.
    expect(anteFor(300)).toBe(100);
  });

  it("only offers levels that divide by a hundred", () => {
    for (const level of STAKES) {
      expect(level % 100).toBe(0);
    }
  });
});

describe("how many dice", () => {
  it("is five unless the host says otherwise", () => {
    expect(diceFor(undefined)).toBe(DICE);
    expect(diceFor("five")).toBe(DICE);
  });

  it("snaps to three or five", () => {
    expect(diceFor(3)).toBe(3);
    expect(diceFor(4)).toBe(3);
    expect(diceFor(9)).toBe(5);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

```bash
npx vitest run games/liars-dice/src/listing.test.ts
```

Expected: FAIL — `Failed to resolve import "./listing.js"`.

- [ ] **Step 5: Write `listing.ts`**

```ts
import type { GameListing } from "@backroom/core";

/** How Liar's Dice lists itself in the room. */
export const LIARS_DICE: GameListing = {
  id: "liars-dice",
  name: "Liar's Dice",
  blurb: "Five under a cup. Bid it up or call it.",
  shape: "table",
  /*
   * Two to ten. Two is the game stripped to its bones — one bid, one call —
   * and ten is Poker's ceiling, which is as many people as one felt can show
   * who is who. Never one: a chips game does not run for one player, and this
   * one has no bank to play against.
   */
  minSeats: 2,
  maxSeats: 10,
  mark: { text: "LIAR'S DICE", accentAt: 0 },
  /*
   * The same values theme.css sets, repeated because the link cards are drawn
   * on the server where there is no stylesheet to read. They have to agree.
   */
  theme: { wall: "#17110d", felt: "#2e1c14", accent: "#e2622c", accentHi: "#ff9a63" },
  open: true,
};

/**
 * What a game may be played for.
 *
 * A list rather than a range, for the reason Death Roll's and Poker's are: a
 * room where every table is a different odd size is a room nobody can read at
 * a glance. The same four levels as Death Roll, so the floor reads the same
 * whichever dice table you walk up to.
 */
export const STAKES = [100, 500, 1_000, 5_000] as const;

/** What a game costs unless the host says otherwise. */
export const ANTE = 500;

/**
 * How many dice a player starts with.
 *
 * Five is the game everybody knows. Three is what makes a ten-handed game a
 * reasonable length — thirty dice and one lost per round is a long evening,
 * eighteen is one hand of an evening.
 */
export const DICE_LEVELS = [3, 5] as const;

/** The dice each unless the host says otherwise. */
export const DICE = 5;

/** How long somebody has to act before the clock bids for them. */
export const TURN_MS = 30_000;

/**
 * How long a revealed round stays up.
 *
 * Longer than Death Roll's three seconds because there is more to read: thirty
 * dice turning over, a count, and who it cost a die.
 */
export const REVEAL_MS = 6_000;

/** How long a finished game stays up to be read. */
export const RESULT_MS = 6_000;

/**
 * How long a table waits, once two are ready, for the rest to say they are in.
 *
 * The thing that stops a ready button being a way to hold a table shut: when
 * it runs out, whoever is ready is dealt, and whoever is not sits that game
 * out.
 */
export const COUNTDOWN_MS = 20_000;

/** Play money handed to a seat at a for-fun table, which dies with the table. */
export const FUN_PURSE = 10_000;

/**
 * The nearest level to a number, or the default for anything unusable.
 *
 * A number exactly between two levels goes to the lower one: the comparison is
 * strict and the lists are ascending, so the first level at the winning
 * distance keeps it. Deliberate — a host who asks for something between two
 * stakes is put on the cheaper of them rather than charged up to the dearer,
 * and it is the same answer every time.
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
 * Snapped here rather than trusted from the payload: this is the number that
 * decides how much of somebody's balance is at risk at a table they sat down
 * at, and a client that could name its own would be setting the stakes for
 * other people.
 */
export function anteFor(asked: unknown): number {
  return snap(asked, STAKES, ANTE);
}

/** How many dice the table deals each, snapped for the same reason. */
export function diceFor(asked: unknown): number {
  return snap(asked, DICE_LEVELS, DICE);
}
```

- [ ] **Step 6: Write a placeholder index and theme, then run**

`games/liars-dice/src/index.ts`:

```ts
/**
 * Liar's Dice: five under a cup, and a count nobody can check.
 *
 * The whole game in one package — the bidding arithmetic, a round, a game, the
 * table and its bot. It borrows seating, the ready button and the shape of a
 * table from @backroom/core and brings everything that makes it this game.
 */
export {
  ANTE,
  COUNTDOWN_MS,
  DICE,
  DICE_LEVELS,
  FUN_PURSE,
  LIARS_DICE,
  RESULT_MS,
  REVEAL_MS,
  STAKES,
  TURN_MS,
  anteFor,
  diceFor,
} from "./listing.js";
```

`games/liars-dice/src/theme.css` — a one-line placeholder so the export resolves; Task 10 writes it properly:

```css
/* The Liar's Dice room. Written in full in the theme commit. */
:root[data-game="liars-dice"],
[data-game="liars-dice"] {
  --gr-color-felt: #2e1c14;
}
```

```bash
npm install
npx vitest run games/liars-dice/src/listing.test.ts
npm run typecheck
```

Expected: tests PASS, typecheck clean. `npm install` is needed once so npm links the new workspace.

- [ ] **Step 7: Format, lint, commit**

```bash
npx biome format --write games/liars-dice/src
npm run lint
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): the package and its listing

Two to ten seats, four stakes, three dice or five, and ember orange on
brown leather — the one lamp over a back table. The theme values are
repeated in the listing because the link cards are drawn on the server
where there is no stylesheet to read.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 3: `bid.ts` — the bidding arithmetic

The rules core. If there is a bug in this game it will be here, so this is the task with the most tests.

**Files:**
- Create: `games/liars-dice/src/bid.ts`
- Create: `games/liars-dice/src/bid.test.ts`
- Modify: `games/liars-dice/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Face = 1 | 2 | 3 | 4 | 5 | 6`
  - `const FACES: readonly Face[]`
  - `interface Bid { count: number; face: Face }`
  - `isFace(value: unknown): value is Face`
  - `key(bid: Bid): readonly [number, number, number]`
  - `beats(next: Bid, standing: Bid | null): boolean`
  - `leastCount(face: Face, standing: Bid | null, total: number): number | null`
  - `minRaise(standing: Bid | null, total: number): Bid | null`
  - `countOf(hands: Iterable<readonly Face[]>, face: Face): number`
  - `says(bid: Bid): string`

- [ ] **Step 1: Write the failing test**

`games/liars-dice/src/bid.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Bid, Face } from "./bid.js";
import { beats, countOf, FACES, isFace, key, leastCount, minRaise, says } from "./bid.js";

const bid = (count: number, face: Face): Bid => ({ count, face });

describe("what beats what, on a plain face", () => {
  it("takes more of anything", () => {
    expect(beats(bid(5, 2), bid(4, 6))).toBe(true);
  });

  it("takes the same count at a higher face", () => {
    expect(beats(bid(4, 6), bid(4, 5))).toBe(true);
    expect(beats(bid(4, 4), bid(4, 5))).toBe(false);
  });

  it("refuses the same bid back", () => {
    expect(beats(bid(4, 5), bid(4, 5))).toBe(false);
  });

  it("refuses fewer", () => {
    expect(beats(bid(3, 6), bid(4, 2))).toBe(false);
  });
});

describe("switching to ones", () => {
  it("takes half the count, rounded up", () => {
    // Four sixes standing: two ones is the cheapest switch.
    expect(beats(bid(2, 1), bid(4, 6))).toBe(true);
    expect(beats(bid(1, 1), bid(4, 6))).toBe(false);
  });

  it("rounds an odd count up", () => {
    // Three of anything needs two ones, not one and a half.
    expect(beats(bid(2, 1), bid(3, 2))).toBe(true);
    expect(beats(bid(1, 1), bid(3, 2))).toBe(false);
  });

  it("lets ones win the tie at equal doubled count", () => {
    // Two ones is worth four, and four ones outranks four sixes, because only
    // actual ones can fill a bid on ones.
    expect(beats(bid(2, 1), bid(4, 6))).toBe(true);
    expect(beats(bid(4, 6), bid(2, 1))).toBe(false);
  });
});

describe("switching off ones", () => {
  it("costs double and one", () => {
    expect(beats(bid(5, 2), bid(2, 1))).toBe(true);
    expect(beats(bid(4, 6), bid(2, 1))).toBe(false);
  });

  it("still takes more ones", () => {
    expect(beats(bid(3, 1), bid(2, 1))).toBe(true);
    expect(beats(bid(2, 1), bid(3, 1))).toBe(false);
  });
});

describe("an opening bid", () => {
  it("is anything at all", () => {
    expect(beats(bid(1, 2), null)).toBe(true);
    expect(beats(bid(1, 1), null)).toBe(true);
  });

  it("is never nothing, and never a fraction", () => {
    expect(beats(bid(0, 5), null)).toBe(false);
    expect(beats(bid(-1, 5), null)).toBe(false);
    expect(beats(bid(1.5, 5), null)).toBe(false);
  });
});

describe("the order underneath it", () => {
  it("is a strict total order over every bid up to fifty dice", () => {
    const all: Bid[] = [];
    for (let count = 1; count <= 50; count += 1) {
      for (const face of FACES) {
        all.push(bid(count, face));
      }
    }
    for (const a of all) {
      // Irreflexive: nothing beats itself.
      expect(beats(a, a)).toBe(false);
      for (const b of all) {
        if (a.count === b.count && a.face === b.face) {
          continue;
        }
        const ab = beats(a, b);
        const ba = beats(b, a);
        // Total and antisymmetric: of any two different bids, exactly one wins.
        // Two bids of equal key would break this, and an equal key is what a
        // face-only tie-break would produce for ones against a plain face.
        expect(ab || ba).toBe(true);
        expect(ab && ba).toBe(false);
      }
    }
  });

  it("is transitive across the ones boundary", () => {
    // The case worth naming: four sixes < two ones < five twos, so four sixes
    // must be under five twos as well.
    expect(beats(bid(2, 1), bid(4, 6))).toBe(true);
    expect(beats(bid(5, 2), bid(2, 1))).toBe(true);
    expect(beats(bid(5, 2), bid(4, 6))).toBe(true);
  });

  it("gives ones a doubled key", () => {
    expect(key(bid(3, 1))[0]).toBe(6);
    expect(key(bid(3, 5))[0]).toBe(3);
  });
});

describe("the least count at a face", () => {
  it("is the cheapest legal bid there", () => {
    expect(leastCount(6, bid(4, 5), 30)).toBe(4);
    expect(leastCount(2, bid(4, 5), 30)).toBe(5);
    expect(leastCount(1, bid(4, 5), 30)).toBe(2);
  });

  it("is null when the ceiling puts it out of reach", () => {
    // Three ones standing with six dice in play: a plain face needs seven.
    expect(leastCount(6, bid(3, 1), 6)).toBe(null);
    // But more ones is still there.
    expect(leastCount(1, bid(3, 1), 6)).toBe(4);
  });
});

describe("the lowest legal raise", () => {
  it("opens as cheaply as the game allows", () => {
    expect(minRaise(null, 10)).toEqual(bid(1, 2));
  });

  it("is the same count at the next face up", () => {
    expect(minRaise(bid(4, 3), 30)).toEqual(bid(4, 4));
  });

  it("is two ones over four sixes", () => {
    expect(minRaise(bid(4, 6), 30)).toEqual(bid(2, 1));
  });

  it("is more ones when nothing else fits under the ceiling", () => {
    expect(minRaise(bid(3, 1), 6)).toEqual(bid(4, 1));
  });

  it("is null at the very top of the board", () => {
    // Every die in play, on the highest face, with ones already priced past it.
    expect(minRaise(bid(30, 1), 30)).toBe(null);
  });

  it("never names more dice than are on the table", () => {
    for (let total = 1; total <= 20; total += 1) {
      const raise = minRaise(bid(total, 6), total);
      if (raise !== null) {
        expect(raise.count).toBeLessThanOrEqual(total);
      }
    }
  });
});

describe("counting a face", () => {
  const hands: Face[][] = [
    [1, 5, 5],
    [1, 2, 6],
  ];

  it("counts ones as the face bid", () => {
    expect(countOf(hands, 5)).toBe(4);
  });

  it("counts ones as nothing but ones when ones are bid", () => {
    expect(countOf(hands, 1)).toBe(2);
  });

  it("counts a face nobody holds as none", () => {
    expect(countOf([[2, 3]], 6)).toBe(0);
  });
});

describe("saying a bid out loud", () => {
  it("names the count and pluralises the face", () => {
    expect(says(bid(1, 1))).toBe("one one");
    expect(says(bid(4, 5))).toBe("four fives");
    expect(says(bid(11, 6))).toBe("eleven sixes");
    expect(says(bid(21, 2))).toBe("twenty-one twos");
    expect(says(bid(50, 3))).toBe("fifty threes");
  });
});

describe("a face from the wire", () => {
  it("accepts one to six and nothing else", () => {
    for (const face of FACES) {
      expect(isFace(face)).toBe(true);
    }
    expect(isFace(0)).toBe(false);
    expect(isFace(7)).toBe(false);
    expect(isFace(2.5)).toBe(false);
    expect(isFace("3")).toBe(false);
    expect(isFace(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run games/liars-dice/src/bid.test.ts
```

Expected: FAIL — `Failed to resolve import "./bid.js"`.

- [ ] **Step 3: Write `bid.ts`**

```ts
/**
 * What may be said at this table, and which of two things said is the bigger.
 *
 * Everything here is pure. The rules of Liar's Dice are almost entirely in
 * this file, which is deliberate: the arithmetic that prices a bid on ones is
 * the one part of the game a player has to be told rather than shown, and it
 * is the one part a bug could hide in for a whole evening.
 */

export type Face = 1 | 2 | 3 | 4 | 5 | 6;

export const FACES: readonly Face[] = [1, 2, 3, 4, 5, 6];

/** A claim about the whole table: this many dice showing this face. */
export interface Bid {
  count: number;
  face: Face;
}

/** A face as it arrives from a client, which is to say not to be trusted. */
export function isFace(value: unknown): value is Face {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}

/**
 * A bid's place in the order, as three numbers compared in turn.
 *
 * The whole of Dudo's bidding arithmetic is this one key. A bid on ones is
 * worth double, because with ones wild only actual ones can fill it — so half
 * the count of a plain face buys a switch to ones, and twice the count plus
 * one buys a switch back.
 *
 * The middle element is load-bearing: at equal doubled count a bid on ones
 * outranks a bid on a plain face, which is the halving rule when the count is
 * even. Ones carry face 1, the lowest, so comparing faces alone would order
 * that pair backwards.
 */
export function key(bid: Bid): readonly [number, number, number] {
  return bid.face === 1 ? [bid.count * 2, 1, 1] : [bid.count, 0, bid.face];
}

/**
 * Whether one bid may be said over another. `null` means nothing has been
 * said yet, and anything may open.
 *
 * The ceiling — never more dice than are on the table — is not here on
 * purpose: it is not a fact about two bids, and a round is the thing that
 * knows how many dice there are. See {@link leastCount}.
 */
export function beats(next: Bid, standing: Bid | null): boolean {
  if (!Number.isInteger(next.count) || next.count < 1 || !isFace(next.face)) {
    return false;
  }
  if (standing === null) {
    return true;
  }
  const a = key(next);
  const b = key(standing);
  for (let at = 0; at < 3; at += 1) {
    if (a[at] !== b[at]) {
      return (a[at] as number) > (b[at] as number);
    }
  }
  return false;
}

/**
 * The cheapest count that may be bid at this face, or null if none can.
 *
 * Walked upwards rather than solved, and it can be: at a fixed face the key's
 * first element rises with the count, so once a count is legal every higher
 * one is too. That monotonicity is also what lets the loop stop at the first
 * hit.
 */
export function leastCount(face: Face, standing: Bid | null, total: number): number | null {
  for (let count = 1; count <= total; count += 1) {
    if (beats({ count, face }, standing)) {
      return count;
    }
  }
  return null;
}

/**
 * The lowest thing that may be said next, or null when nothing can be.
 *
 * Null is a real state of the game rather than an error: with every die in
 * play claimed as a one, there is no raise left and the turn is call-or-call.
 * It is also what the clock falls back from — see the adapter's `timeout`.
 */
export function minRaise(standing: Bid | null, total: number): Bid | null {
  let best: Bid | null = null;
  for (const face of FACES) {
    const count = leastCount(face, standing, total);
    if (count === null) {
      continue;
    }
    const candidate: Bid = { count, face };
    if (best === null || beats(best, candidate)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * How many dice on the table answer to a face, with ones wild.
 *
 * A one counts as whatever was bid, unless ones were bid — which is the whole
 * reason the order above prices them double.
 */
export function countOf(hands: Iterable<readonly Face[]>, face: Face): number {
  let total = 0;
  for (const hand of hands) {
    for (const die of hand) {
      if (die === face || (face !== 1 && die === 1)) {
        total += 1;
      }
    }
  }
  return total;
}

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
] as const;

const TENS = ["", "", "twenty", "thirty", "forty", "fifty"] as const;

/**
 * A count in words, up to fifty — ten players holding five dice each.
 *
 * In words because this is read out loud at the table: "four fives" is a bid
 * and "4 5" is a pair of numbers.
 */
function words(count: number): string {
  if (count < 20) {
    return ONES[count] ?? String(count);
  }
  const tens = TENS[Math.floor(count / 10)] ?? "";
  const ones = count % 10;
  if (tens === "") {
    return String(count);
  }
  return ones === 0 ? tens : `${tens}-${ONES[ones]}`;
}

const FACE_NAMES: Record<Face, string> = {
  1: "ones",
  2: "twos",
  3: "threes",
  4: "fours",
  5: "fives",
  6: "sixes",
};

/** A bid as somebody would say it: "four fives", "one one". */
export function says(bid: Bid): string {
  const face = bid.count === 1 ? FACE_NAMES[bid.face].replace(/e?s$/, "") : FACE_NAMES[bid.face];
  return `${words(bid.count)} ${face}`;
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run games/liars-dice/src/bid.test.ts
```

Expected: PASS, all of them. If `says(bid(1, 6))` comes out as "one six" you have it right; the regex trims a trailing `es` from "sixes" and a trailing `s` from "twos".

- [ ] **Step 5: Export it**

Add to `games/liars-dice/src/index.ts`, above the listing exports:

```ts
export type { Bid, Face } from "./bid.js";
export { beats, countOf, FACES, isFace, key, leastCount, minRaise, says } from "./bid.js";
```

- [ ] **Step 6: Format, lint, typecheck, commit**

```bash
npx biome format --write games/liars-dice/src
npm run lint
npm run typecheck
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): the bidding arithmetic

Ones are wild, which means a bid on ones is harder to fill at the same
count and so has to be dearer to say. Dudo prices it at double: half the
count buys a switch to ones, twice the count plus one buys a switch back.

Written as one lexicographic key rather than four branches of arithmetic,
which is what makes `beats` three lines and `minRaise` a loop. There is a
test that walks every bid up to fifty dice and asserts the result is a
strict total order — an equal key for ones against a plain face is exactly
the bug a face-only tie-break would introduce.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 4: `round.ts` — one round

**Files:**
- Create: `games/liars-dice/src/round.ts`
- Create: `games/liars-dice/src/round.test.ts`
- Modify: `games/liars-dice/src/index.ts`

**Interfaces:**
- Consumes: `Bid`, `Face`, `beats`, `countOf`, `says` from `./bid.js`; `TableError` from `@backroom/core`.
- Produces:
  - `type Call = "liar" | "exact"`
  - `interface RevealedHand { seatId: string; dice: readonly Face[] }`
  - `interface Resolution { call: Call; caller: string; bid: Bid; bidder: string; count: number; right: boolean; losers: readonly string[]; hands: readonly RevealedHand[] }`
  - `class Round` with `readonly order: readonly string[]`, `readonly total: number`, `bid: Bid | null`, `bidder: string | null`, `toAct: string`, `resolution: Resolution | null`, `get over(): boolean`, `handFor(seatId): readonly Face[] | null`, `position(seatId): number`, `raise(seatId, bid): void`, `call(seatId, call): Resolution`

- [ ] **Step 1: Write the failing test**

`games/liars-dice/src/round.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Face } from "./bid.js";
import { Round } from "./round.js";

const hands = (entries: Record<string, Face[]>) =>
  new Map<string, readonly Face[]>(Object.entries(entries));

const round = () =>
  new Round(["a", "b", "c"], hands({ a: [5, 5, 2], b: [1, 6, 6], c: [3, 4, 5] }));

describe("a round", () => {
  it("opens on the first in the order with nothing said", () => {
    const one = round();
    expect(one.toAct).toBe("a");
    expect(one.bid).toBe(null);
    expect(one.over).toBe(false);
    expect(one.total).toBe(9);
  });

  it("passes the turn on a raise", () => {
    const one = round();
    one.raise("a", { count: 3, face: 5 });
    expect(one.bid).toEqual({ count: 3, face: 5 });
    expect(one.bidder).toBe("a");
    expect(one.toAct).toBe("b");
  });

  it("comes back round to the first player", () => {
    const one = round();
    one.raise("a", { count: 1, face: 2 });
    one.raise("b", { count: 2, face: 2 });
    one.raise("c", { count: 3, face: 2 });
    expect(one.toAct).toBe("a");
  });

  it("refuses somebody else's turn", () => {
    const one = round();
    expect(() => one.raise("b", { count: 3, face: 5 })).toThrow("It is not your turn.");
  });

  it("refuses a bid that is not higher", () => {
    const one = round();
    one.raise("a", { count: 3, face: 5 });
    expect(() => one.raise("b", { count: 3, face: 4 })).toThrow("higher than the bid");
  });

  it("refuses more dice than are on the table", () => {
    const one = round();
    expect(() => one.raise("a", { count: 10, face: 5 })).toThrow("only nine dice");
  });

  it("refuses a face that is not a face", () => {
    const one = round();
    expect(() => one.raise("a", { count: 2, face: 9 as Face })).toThrow("not a face");
  });

  it("refuses a call before anything has been said", () => {
    const one = round();
    expect(() => one.call("a", "liar")).toThrow("nothing to call");
  });
});

describe("calling liar", () => {
  it("costs the challenger a die when the bid was good", () => {
    // Fives plus the wild one: four on the table. Three fives was true.
    const one = round();
    one.raise("a", { count: 3, face: 5 });
    const out = one.call("b", "liar");
    expect(out.count).toBe(4);
    expect(out.right).toBe(true);
    expect(out.losers).toEqual(["b"]);
  });

  it("costs the bidder a die when it was not", () => {
    const one = round();
    one.raise("a", { count: 5, face: 5 });
    const out = one.call("b", "liar");
    expect(out.count).toBe(4);
    expect(out.right).toBe(false);
    expect(out.losers).toEqual(["a"]);
  });

  it("counts a bid met exactly as good", () => {
    const one = round();
    one.raise("a", { count: 4, face: 5 });
    expect(one.call("b", "liar").right).toBe(true);
  });

  it("turns every hand face up", () => {
    const one = round();
    one.raise("a", { count: 4, face: 5 });
    const out = one.call("b", "liar");
    expect(out.hands).toEqual([
      { seatId: "a", dice: [5, 5, 2] },
      { seatId: "b", dice: [1, 6, 6] },
      { seatId: "c", dice: [3, 4, 5] },
    ]);
  });

  it("ends the round", () => {
    const one = round();
    one.raise("a", { count: 4, face: 5 });
    one.call("b", "liar");
    expect(one.over).toBe(true);
    expect(() => one.raise("c", { count: 5, face: 5 })).toThrow("This round is over.");
    expect(() => one.call("c", "liar")).toThrow("This round is over.");
  });
});

describe("calling exact", () => {
  it("costs everybody else a die when it is right", () => {
    const one = round();
    one.raise("a", { count: 4, face: 5 });
    const out = one.call("b", "exact");
    expect(out.right).toBe(true);
    expect(out.losers).toEqual(["a", "c"]);
  });

  it("costs only the caller when it is wrong", () => {
    const one = round();
    one.raise("a", { count: 3, face: 5 });
    const out = one.call("b", "exact");
    expect(out.right).toBe(false);
    expect(out.losers).toEqual(["b"]);
  });

  it("is wrong when the count is over as well as under", () => {
    const one = round();
    one.raise("a", { count: 2, face: 5 });
    expect(one.call("b", "exact").right).toBe(false);
  });
});

describe("where a seat sits", () => {
  it("is its place in the turn order", () => {
    const one = round();
    expect(one.position("a")).toBe(0);
    expect(one.position("c")).toBe(2);
    expect(one.position("nobody")).toBe(-1);
  });

  it("hands out a hand, or nothing for somebody not in it", () => {
    const one = round();
    expect(one.handFor("a")).toEqual([5, 5, 2]);
    expect(one.handFor("nobody")).toBe(null);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run games/liars-dice/src/round.test.ts
```

Expected: FAIL — `Failed to resolve import "./round.js"`.

- [ ] **Step 3: Write `round.ts`**

```ts
import { TableError } from "@backroom/core";
import type { Bid, Face } from "./bid.js";
import { beats, countOf, isFace, says } from "./bid.js";

/** The two ways a round can end. Both of them turn every cup over. */
export type Call = "liar" | "exact";

/** One player's dice, once there is no longer any reason to hide them. */
export interface RevealedHand {
  seatId: string;
  dice: readonly Face[];
}

/** How a round ended, and what it cost whom. */
export interface Resolution {
  call: Call;
  caller: string;
  /** The bid that was called. */
  bid: Bid;
  bidder: string;
  /** What was actually on the table, ones counted as the face bid. */
  count: number;
  /** Liar: the bid was good. Exact: the count was precisely the bid. */
  right: boolean;
  /** Who lost a die for it. */
  losers: readonly string[];
  /** Every hand in the round, face up. */
  hands: readonly RevealedHand[];
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/**
 * One round of bidding, from the deal to the call that ends it.
 *
 * The hands are handed in rather than rolled here: where the dice come from is
 * the table's business and has to be injectable, because a game that hands
 * every player its whole result at a reveal is a game whose generator must not
 * be `Math.random`.
 */
export class Round {
  /** Everybody still in, in turn order. */
  readonly order: readonly string[];
  /** How many dice are on the table, which is the ceiling on any bid. */
  readonly total: number;

  bid: Bid | null = null;
  bidder: string | null = null;
  toAct: string;
  resolution: Resolution | null = null;

  private readonly hands: ReadonlyMap<string, readonly Face[]>;

  constructor(order: readonly string[], hands: ReadonlyMap<string, readonly Face[]>) {
    if (order.length < 2) {
      throw new TableError("A round needs two people.");
    }
    this.order = [...order];
    this.hands = hands;
    this.toAct = order[0] as string;
    let total = 0;
    for (const seatId of order) {
      total += hands.get(seatId)?.length ?? 0;
    }
    this.total = total;
  }

  get over(): boolean {
    return this.resolution !== null;
  }

  handFor(seatId: string): readonly Face[] | null {
    return this.hands.get(seatId) ?? null;
  }

  position(seatId: string): number {
    return this.order.indexOf(seatId);
  }

  private next(from: string): string {
    const at = this.order.indexOf(from);
    return this.order[(at + 1) % this.order.length] as string;
  }

  /**
   * Whoever's turn it is, refusing anything that is not theirs to do.
   *
   * Every refusal is a `TableError`, because every one of them is shown to the
   * player who tried it.
   */
  private mine(seatId: string): void {
    if (this.over) {
      throw new TableError("This round is over.");
    }
    if (seatId !== this.toAct) {
      throw new TableError("It is not your turn.");
    }
  }

  /** A bigger claim, and the turn moves on. */
  raise(seatId: string, bid: Bid): void {
    this.mine(seatId);
    if (!isFace(bid.face)) {
      throw new TableError("That is not a face on a die.");
    }
    if (!Number.isInteger(bid.count) || bid.count < 1) {
      throw new TableError("A bid names a whole number of dice.");
    }
    if (bid.count > this.total) {
      const many = WORDS[this.total] ?? String(this.total);
      throw new TableError(`There are only ${many} dice on the table.`);
    }
    if (!beats(bid, this.bid)) {
      const standing = this.bid;
      throw new TableError(
        standing === null
          ? "That is not a bid."
          : `${says(bid)} is not higher than the bid of ${says(standing)}.`,
      );
    }
    this.bid = bid;
    this.bidder = seatId;
    this.toAct = this.next(seatId);
  }

  /**
   * Every cup up, and the arithmetic settles it.
   *
   * Liar takes a die from exactly one of the two people in the call, which is
   * what makes it impossible for a round to leave nobody holding dice. A
   * correct exact takes one from everybody *except* the caller, for the same
   * reason from the other end.
   */
  call(seatId: string, call: Call): Resolution {
    this.mine(seatId);
    const bid = this.bid;
    const bidder = this.bidder;
    if (bid === null || bidder === null) {
      throw new TableError("There is nothing to call yet.");
    }
    const count = countOf(this.order.map((id) => this.hands.get(id) ?? []), bid.face);
    const right = call === "liar" ? count >= bid.count : count === bid.count;
    const losers =
      call === "liar"
        ? [right ? seatId : bidder]
        : right
          ? this.order.filter((id) => id !== seatId)
          : [seatId];
    this.resolution = {
      call,
      caller: seatId,
      bid,
      bidder,
      count,
      right,
      losers,
      hands: this.order.map((id) => ({ seatId: id, dice: this.hands.get(id) ?? [] })),
    };
    return this.resolution;
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run games/liars-dice/src/round.test.ts
```

Expected: PASS.

- [ ] **Step 5: Export it**

Add to `games/liars-dice/src/index.ts`:

```ts
export type { Call, Resolution, RevealedHand } from "./round.js";
export { Round } from "./round.js";
```

- [ ] **Step 6: Format, lint, typecheck, commit**

```bash
npx biome format --write games/liars-dice/src
npm run lint
npm run typecheck
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): a round, from the deal to the call

The hands are handed in rather than rolled here, because where the dice
come from has to be injectable: a reveal hands the table every hand at
once, which is the run of observations that recovers a generator's state.

Liar takes a die from exactly one of the two people in the call and a
correct exact takes one from everybody but the caller, which between them
are why a round can never leave nobody holding dice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 5: `game.ts` — dice, elimination, the pot

**Files:**
- Create: `games/liars-dice/src/game.ts`
- Create: `games/liars-dice/src/game.test.ts`
- Modify: `games/liars-dice/src/index.ts`

**Interfaces:**
- Consumes: `Bid`, `Face`, `Call`, `Resolution`, `Round`, `TableError`.
- Produces: `class Game` with:
  - `constructor(players: readonly string[], opener: string, options: { ante: number; dice: number; roll: () => Face })`
  - `readonly players: readonly string[]`, `readonly ante: number`, `readonly startingDice: number`
  - `round: Round`, `roundNumber: number`
  - `get over(): boolean`, `get winnerId(): string | null`, `get betweenRounds(): boolean`, `get pot(): number`, `get out(): readonly string[]`, `get live(): readonly string[]`, `get total(): number`
  - `diceFor(seatId): number`, `survivedBy(seatId): number`, `bidsBy(seatId): number`, `callsBy(seatId): number`, `exactsBy(seatId): number`, `hitsBy(seatId): number`, `netFor(seatId): number`
  - `raise(seatId: string, bid: Bid): void`, `call(seatId: string, call: Call): Resolution`, `nextRound(): void`
  - `readonly board: readonly BoardRow[]` and `interface BoardRow { round: number; bid: Bid; call: Call; caller: string; count: number; right: boolean; losers: readonly string[] }`

- [ ] **Step 1: Write the failing test**

`games/liars-dice/src/game.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Face } from "./bid.js";
import { Game } from "./game.js";

/** A roll that hands out a fixed script, so a game can be played to order. */
const scripted = (script: Face[]) => {
  let at = 0;
  return () => {
    const face = script[at % script.length] as Face;
    at += 1;
    return face;
  };
};

/** Everybody holds the same face, so a count is easy to reason about. */
const allFives = () => scripted([5]);

const game = (players = ["a", "b"], dice = 2, roll = allFives()) =>
  new Game(players, players[0] as string, { ante: 500, dice, roll });

describe("a new game", () => {
  it("deals everybody their dice and opens on the opener", () => {
    const one = game(["a", "b", "c"], 3);
    expect(one.players).toEqual(["a", "b", "c"]);
    expect(one.diceFor("a")).toBe(3);
    expect(one.total).toBe(9);
    expect(one.round.toAct).toBe("a");
    expect(one.roundNumber).toBe(1);
    expect(one.over).toBe(false);
  });

  it("opens on whoever was named, not always the first seat", () => {
    const one = new Game(["a", "b", "c"], "b", { ante: 500, dice: 3, roll: allFives() });
    expect(one.round.toAct).toBe("b");
  });

  it("has a pot of one ante each", () => {
    expect(game(["a", "b", "c"], 3).pot).toBe(1_500);
  });

  it("gives everybody a real hand, hidden from nobody at this level", () => {
    const one = game(["a", "b"], 2);
    expect(one.round.handFor("a")).toEqual([5, 5]);
  });
});

describe("losing a die", () => {
  it("takes one off whoever the round says", () => {
    const one = game(["a", "b", "c"], 3);
    one.raise("a", { count: 9, face: 5 });
    // Nine fives with nine fives on the table is good, so the caller pays.
    one.call("b", "liar");
    expect(one.diceFor("b")).toBe(2);
    expect(one.diceFor("a")).toBe(3);
  });

  it("puts a player on nothing out of the game", () => {
    const one = game(["a", "b", "c"], 1);
    one.raise("a", { count: 3, face: 5 });
    one.call("b", "liar");
    expect(one.diceFor("b")).toBe(0);
    expect(one.out).toEqual(["b"]);
    expect(one.live).toEqual(["a", "c"]);
  });
});

describe("the round in between", () => {
  it("waits, then deals the next one to whoever is left", () => {
    const one = game(["a", "b", "c"], 1);
    one.raise("a", { count: 3, face: 5 });
    one.call("b", "liar");
    expect(one.betweenRounds).toBe(true);
    expect(one.over).toBe(false);
    one.nextRound();
    expect(one.roundNumber).toBe(2);
    expect(one.round.order).toEqual(["a", "c"]);
    expect(one.total).toBe(2);
    expect(one.betweenRounds).toBe(false);
  });

  it("gives the next round to whoever lost the die", () => {
    const one = game(["a", "b", "c"], 3);
    one.raise("a", { count: 9, face: 5 });
    one.call("b", "liar");
    one.nextRound();
    expect(one.round.toAct).toBe("b");
  });

  it("moves past somebody the die put out", () => {
    const one = game(["a", "b", "c"], 1);
    one.raise("a", { count: 3, face: 5 });
    // b is out, so the next live seat after b opens.
    one.call("b", "liar");
    one.nextRound();
    expect(one.round.toAct).toBe("c");
  });

  it("gives it to the caller when a correct exact cost everybody else one", () => {
    const one = game(["a", "b", "c"], 3);
    one.raise("a", { count: 9, face: 5 });
    one.call("b", "exact");
    expect(one.diceFor("a")).toBe(2);
    expect(one.diceFor("c")).toBe(2);
    expect(one.diceFor("b")).toBe(3);
    one.nextRound();
    expect(one.round.toAct).toBe("b");
  });

  it("refuses to deal a round while one is still running", () => {
    const one = game(["a", "b", "c"], 3);
    one.nextRound();
    expect(one.roundNumber).toBe(1);
  });
});

describe("the end", () => {
  it("is one player still holding dice", () => {
    const one = game(["a", "b"], 1);
    one.raise("a", { count: 2, face: 5 });
    one.call("b", "liar");
    expect(one.over).toBe(true);
    expect(one.winnerId).toBe("a");
    expect(one.betweenRounds).toBe(false);
  });

  it("never leaves nobody holding dice, however the call goes", () => {
    for (const call of ["liar", "exact"] as const) {
      const one = game(["a", "b", "c"], 1);
      one.raise("a", { count: 3, face: 5 });
      one.call("b", call);
      expect(one.live.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("pays the pot to the winner and the ante off everybody else", () => {
    const one = game(["a", "b"], 1);
    one.raise("a", { count: 2, face: 5 });
    one.call("b", "liar");
    expect(one.netFor("a")).toBe(500);
    expect(one.netFor("b")).toBe(-500);
  });
});

describe("what the record keeps", () => {
  it("counts rounds survived, bids, calls and exacts", () => {
    const one = game(["a", "b", "c"], 3);
    one.raise("a", { count: 4, face: 5 });
    one.raise("b", { count: 5, face: 5 });
    one.call("c", "exact");
    expect(one.bidsBy("a")).toBe(1);
    expect(one.bidsBy("b")).toBe(1);
    expect(one.callsBy("c")).toBe(1);
    expect(one.exactsBy("c")).toBe(1);
    // Nine fives on the table, so five was not exact.
    expect(one.hitsBy("c")).toBe(0);
    expect(one.survivedBy("a")).toBe(1);
  });

  it("keeps a board of what happened", () => {
    const one = game(["a", "b", "c"], 3);
    one.raise("a", { count: 4, face: 5 });
    one.call("b", "liar");
    expect(one.board).toEqual([
      {
        round: 1,
        bid: { count: 4, face: 5 },
        call: "liar",
        caller: "b",
        count: 9,
        right: true,
        losers: ["b"],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run games/liars-dice/src/game.test.ts
```

Expected: FAIL — `Failed to resolve import "./game.js"`.

- [ ] **Step 3: Write `game.ts`**

```ts
import { TableError } from "@backroom/core";
import type { Bid, Face } from "./bid.js";
import type { Call, Resolution } from "./round.js";
import { Round } from "./round.js";

/** One finished round, for the table's own board of results. */
export interface BoardRow {
  round: number;
  bid: Bid;
  call: Call;
  caller: string;
  count: number;
  right: boolean;
  losers: readonly string[];
}

/** How many of the last rounds the board keeps. Enough to read, not a history. */
const BOARD = 6;

/**
 * One game of Liar's Dice: dice coming off people until one of them is left.
 *
 * The pot is fixed the moment the game is dealt — one ante each, and nothing is
 * staked after that — which is why there is no money code in here at all. The
 * adapter takes the antes and pays the winner; this only ever answers who won.
 */
export class Game {
  readonly players: readonly string[];
  readonly ante: number;
  readonly startingDice: number;

  round: Round;
  roundNumber = 1;
  /** The last few rounds, oldest first. */
  readonly board: BoardRow[] = [];

  private readonly dice = new Map<string, number>();
  private readonly survived = new Map<string, number>();
  private readonly bids = new Map<string, number>();
  private readonly calls = new Map<string, number>();
  private readonly exacts = new Map<string, number>();
  private readonly hits = new Map<string, number>();
  private readonly roll: () => Face;
  /** Who the next round is owed to: whoever lost a die, or the caller who did not. */
  private opener: string;

  constructor(
    players: readonly string[],
    opener: string,
    options: { ante: number; dice: number; roll: () => Face },
  ) {
    if (players.length < 2) {
      throw new TableError("A game needs two people.");
    }
    this.players = [...players];
    this.ante = options.ante;
    this.startingDice = options.dice;
    this.roll = options.roll;
    for (const seatId of players) {
      this.dice.set(seatId, options.dice);
    }
    this.opener = players.includes(opener) ? opener : (players[0] as string);
    this.round = this.deal();
  }

  // ------------------------------------------------------------- the state

  get out(): readonly string[] {
    return this.players.filter((seatId) => this.diceFor(seatId) === 0);
  }

  get live(): readonly string[] {
    return this.players.filter((seatId) => this.diceFor(seatId) > 0);
  }

  get total(): number {
    return this.live.reduce((sum, seatId) => sum + this.diceFor(seatId), 0);
  }

  get over(): boolean {
    return this.live.length <= 1;
  }

  get winnerId(): string | null {
    return this.over ? (this.live[0] ?? null) : null;
  }

  /** A round decided, with the game still going: the reveal is on the felt. */
  get betweenRounds(): boolean {
    return this.round.over && !this.over;
  }

  get pot(): number {
    return this.ante * this.players.length;
  }

  diceFor(seatId: string): number {
    return this.dice.get(seatId) ?? 0;
  }

  survivedBy(seatId: string): number {
    return this.survived.get(seatId) ?? 0;
  }

  bidsBy(seatId: string): number {
    return this.bids.get(seatId) ?? 0;
  }

  callsBy(seatId: string): number {
    return this.calls.get(seatId) ?? 0;
  }

  exactsBy(seatId: string): number {
    return this.exacts.get(seatId) ?? 0;
  }

  hitsBy(seatId: string): number {
    return this.hits.get(seatId) ?? 0;
  }

  /**
   * What this player's chips did over the whole game.
   *
   * Recorded rather than worked out later, because a pot paid whole and a hand
   * settled seat by seat are not the same arithmetic and a page reading the
   * history cannot tell which game it is looking at.
   */
  netFor(seatId: string): number {
    return seatId === this.winnerId ? this.pot - this.ante : -this.ante;
  }

  // -------------------------------------------------------------- the play

  raise(seatId: string, bid: Bid): void {
    this.round.raise(seatId, bid);
    this.bids.set(seatId, this.bidsBy(seatId) + 1);
  }

  /**
   * A call, the dice it costs, and whether that ended the game.
   *
   * The counters move before the losses are applied only because it reads
   * better; nothing depends on the order, since a call is the last thing that
   * happens in a round.
   */
  call(seatId: string, call: Call): Resolution {
    const out = this.round.call(seatId, call);
    this.calls.set(seatId, this.callsBy(seatId) + 1);
    if (call === "exact") {
      this.exacts.set(seatId, this.exactsBy(seatId) + 1);
      if (out.right) {
        this.hits.set(seatId, this.hitsBy(seatId) + 1);
      }
    }
    for (const loser of out.losers) {
      this.dice.set(loser, Math.max(0, this.diceFor(loser) - 1));
    }
    /*
     * Who opens next. Whoever lost the die, which is the player with the most
     * to prove — and when a correct exact cost everybody *but* the caller one,
     * the caller opens, for the same reason from the other end.
     */
    this.opener = out.losers.length === 1 ? (out.losers[0] as string) : out.caller;
    this.board.push({
      round: this.roundNumber,
      bid: out.bid,
      call: out.call,
      caller: out.caller,
      count: out.count,
      right: out.right,
      losers: out.losers,
    });
    if (this.board.length > BOARD) {
      this.board.shift();
    }
    return out;
  }

  /** The next round, once the reveal has had its time on the felt. */
  nextRound(): void {
    if (!this.betweenRounds) {
      return;
    }
    this.roundNumber += 1;
    this.round = this.deal();
  }

  /**
   * Fresh dice for everybody still in, and the turn to whoever is owed it.
   *
   * Rolled every round from the injected source, so nothing is carried between
   * rounds and nothing about the next deal follows from the last one.
   */
  private deal(): Round {
    const live = this.live;
    const hands = new Map<string, readonly Face[]>();
    for (const seatId of live) {
      const hand: Face[] = [];
      for (let die = 0; die < this.diceFor(seatId); die += 1) {
        hand.push(this.roll());
      }
      hands.set(seatId, hand);
      this.survived.set(seatId, this.survivedBy(seatId) + 1);
    }
    return new Round(this.orderFrom(this.opener, live), hands);
  }

  /**
   * The turn order for a round, starting at whoever opens it.
   *
   * Seat order throughout, rotated — so the table always goes round the same
   * way whoever is dealt out of it. A named opener who is no longer in goes to
   * the next live player after them, which is what makes "whoever lost the die
   * opens" still mean something when the die was their last.
   */
  private orderFrom(opener: string, live: readonly string[]): string[] {
    const seated = this.players;
    const from = seated.indexOf(opener);
    const order: string[] = [];
    for (let step = 0; step < seated.length; step += 1) {
      const seatId = seated[(Math.max(0, from) + step) % seated.length] as string;
      if (live.includes(seatId)) {
        order.push(seatId);
      }
    }
    return order;
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run games/liars-dice/src/game.test.ts
```

Expected: PASS.

- [ ] **Step 5: Export it**

Add to `games/liars-dice/src/index.ts`:

```ts
export type { BoardRow } from "./game.js";
export { Game } from "./game.js";
```

- [ ] **Step 6: Format, lint, typecheck, commit**

```bash
npx biome format --write games/liars-dice/src
npm run lint
npm run typecheck
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): a game, and dice coming off people

The pot is fixed the moment a game is dealt — one ante each, nothing
staked after that — which is why there is no money code in here at all.
This only ever answers who won.

Whoever lost the die opens the next round, moving past them if it was
their last; a correct exact costs everybody but the caller one, so the
caller opens instead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 6: `table.ts` — the table and its per-seat view

This is where hidden hands happen. Read `games/death-roll/src/table.ts` first: this is the same class with dice instead of a ceiling, and the departure handling, purses and readiness wiring are deliberately identical because they were got right there.

**Files:**
- Create: `games/liars-dice/src/table.ts`
- Create: `games/liars-dice/src/table.test.ts`
- Modify: `games/liars-dice/src/index.ts`

**Interfaces:**
- Consumes: `Escrow`, `Readiness`, `Seating`, `TableError`, `PlayTable`, `Seat`, `SeatIdentity`, `TableStatus`, `BotSkill` from `@backroom/core`; `Game`, `BoardRow`; `Round`, `Resolution`, `Call`; `Bid`, `Face`; the listing constants.
- Produces:
  - `type Phase = "waiting" | "playing" | "over"`
  - `type ResolutionView = Omit<Resolution, "hands">`
  - `interface SeatView` — `id`, `name`, `connected`, `waiting`, `isBot`, `avatar`, `accentColor`, `ready`, `inGame`, `out`, `short`, `purse: number | null`, `dice: number`, `hand: readonly (Face | null)[]`
  - `interface TableView` — as written below
  - `class Table implements PlayTable` with `escrow`, `readiness`, `game`, `turnEndsAt`, `draining`, `forFun`, `lastEvent`, `ante`, `startingDice`, `present()`, `addBot()`, `setReady()`, `askForGame()`, `takePending()`, `pending`, `noteShorts()`, `failDeal()`, `begin()`, `nextRound()`, `finish()`, `touchClock()`, `say()`, `purseFor()`, `movePurse()`, `topUp()`, `view()`

- [ ] **Step 1: Write the failing test**

`games/liars-dice/src/table.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Face } from "./bid.js";
import { Table } from "./table.js";

const fives = () => 5 as Face;

const table = (seats = 3, options: { forFun?: boolean } = {}) => {
  const one = new Table("ABCDE", 10, { ante: 500, dice: 2, roll: fives });
  one.forFun = options.forFun ?? false;
  for (let at = 0; at < seats; at += 1) {
    one.join(`s${at}`, `Player ${at}`, null);
  }
  return one;
};

/** Deals a game the way the adapter does: ask, drain, begin. */
const deal = (one: Table, players: string[]) => {
  one.begin(players);
  return one;
};

describe("a table", () => {
  it("starts waiting, with nobody dealt", () => {
    const one = table();
    expect(one.view(null).phase).toBe("waiting");
    expect(one.view(null).pot).toBe(0);
    expect(one.view(null).bid).toBe(null);
  });

  it("says it is waiting for players below two", () => {
    const one = table(1);
    expect(one.view(null).waitingFor).toBe("players");
  });

  it("refuses a bot at a table playing for chips", () => {
    const one = table();
    expect(() => one.addBot("bot", "Robot", "normal")).toThrow("for fun");
  });

  it("seats a bot at a for-fun table, ready to go", () => {
    const one = table(1, { forFun: true });
    one.addBot("bot", "Robot", "normal");
    expect(one.view(null).seats.find((seat) => seat.id === "bot")?.ready).toBe(true);
  });
});

describe("your own dice and nobody else's", () => {
  it("shows you your faces and everybody else a face-down die each", () => {
    const one = deal(table(), ["s0", "s1", "s2"]);
    const mine = one.view("s0");
    expect(mine.you?.hand).toEqual([5, 5]);
    const theirs = mine.seats.find((seat) => seat.id === "s1");
    expect(theirs?.hand).toEqual([null, null]);
    expect(theirs?.dice).toBe(2);
  });

  it("shows a watcher nothing at all", () => {
    const one = deal(table(), ["s0", "s1", "s2"]);
    const watching = one.view(null);
    expect(watching.you).toBe(null);
    for (const seat of watching.seats) {
      expect(seat.hand).toEqual([null, null]);
    }
  });

  it("turns every hand up for everybody at a reveal", () => {
    const one = deal(table(), ["s0", "s1", "s2"]);
    const game = one.game;
    if (game === null) {
      throw new Error("no game");
    }
    game.raise("s0", { count: 4, face: 5 });
    game.call("s1", "liar");
    const watching = one.view(null);
    for (const seat of watching.seats) {
      expect(seat.hand).toEqual([5, 5]);
    }
  });
});

describe("what the felt says", () => {
  it("carries the bid, who said it and who is to act", () => {
    const one = deal(table(), ["s0", "s1", "s2"]);
    one.game?.raise("s0", { count: 3, face: 5 });
    const view = one.view("s1");
    expect(view.bid).toEqual({ count: 3, face: 5 });
    expect(view.bidder).toBe("s0");
    expect(view.toAct).toBe("s1");
    expect(view.total).toBe(6);
    expect(view.pot).toBe(1_500);
  });

  it("counts an event even when the words repeat", () => {
    const one = table();
    one.say("Nothing happened.");
    const first = one.view(null).eventSeq;
    one.say("Nothing happened.");
    expect(one.view(null).eventSeq).toBeGreaterThan(first);
  });
});

describe("standing up", () => {
  it("holds a seat that is in the game until the felt clears", () => {
    const one = deal(table(), ["s0", "s1", "s2"]);
    one.removeSeat("s0");
    expect(one.seats.some((seat) => seat.id === "s0")).toBe(true);
    one.finish();
    expect(one.seats.some((seat) => seat.id === "s0")).toBe(false);
  });

  it("drops a seat that is only waiting for the next game at once", () => {
    const one = deal(table(), ["s0", "s1"]);
    one.join("late", "Latecomer", null);
    one.removeSeat("late");
    expect(one.seats.some((seat) => seat.id === "late")).toBe(false);
  });
});

describe("readiness", () => {
  it("stands a ready down when its player drops, so they are not anted", () => {
    const one = table();
    one.setReady("s0", true, 1_000);
    one.setReady("s1", true, 1_000);
    one.disconnect("s0");
    expect(one.view(null).readyCount).toBe(1);
  });

  it("refuses a ready press while a game is running", () => {
    const one = deal(table(), ["s0", "s1", "s2"]);
    expect(() => one.setReady("s0", true, 1_000)).toThrow("once this game is over");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run games/liars-dice/src/table.test.ts
```

Expected: FAIL — `Failed to resolve import "./table.js"`.

- [ ] **Step 3: Write `table.ts`**

```ts
import type { BotSkill, PlayTable, Seat, SeatIdentity, TableStatus } from "@backroom/core";
import { Escrow, Readiness, Seating, TableError } from "@backroom/core";
import type { Bid, Face } from "./bid.js";
import type { BoardRow } from "./game.js";
import { Game } from "./game.js";
import { COUNTDOWN_MS, FUN_PURSE, TURN_MS } from "./listing.js";
import type { Resolution } from "./round.js";

/**
 * A Liar's Dice table.
 *
 * Two to ten seats, a ready button, and one game at a time. It is Death Roll's
 * table with dice instead of a ceiling, on purpose: the awkward parts — a game
 * that cannot start until the antes are in, a seat that cannot be given up
 * mid-game, a ready that must stand down when somebody drops — were got right
 * there and are not worth getting wrong again here.
 *
 * What is new is that this table keeps a secret. Every other table in the
 * building can be described once and sent to everybody; this one is built per
 * seat, because your dice are yours.
 */

export type Phase = "waiting" | "playing" | "over";

/**
 * A resolution as the felt sees it.
 *
 * Without the hands: they are already on the seats, where the client draws
 * them, and sending them twice would be two places for them to disagree.
 */
export type ResolutionView = Omit<Resolution, "hands">;

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
  /** Dealt in, and now on no dice at all. */
  out: boolean;
  /** Could not cover the ante at the last deal, and sat the game out. */
  short: boolean;
  /** Play money left, at a for-fun table. Null anywhere else. */
  purse: number | null;
  /** How many dice are still in front of them. */
  dice: number;
  /**
   * Their faces — but only ever yours, or everybody's once a round is revealed.
   *
   * A face-down die is `null` rather than a missing entry, so the felt can draw
   * the right number of cups without being told what is under them. Empty
   * between rounds, when nobody has a hand.
   */
  hand: readonly (Face | null)[];
}

export interface TableView {
  code: string;
  phase: Phase;
  seats: readonly SeatView[];
  watching: number;
  forFun: boolean;
  maxSeats: number;
  ante: number;
  /** How many dice the table deals each, which the host chose. */
  startingDice: number;
  pot: number;
  /** Dice on the table, which is the ceiling on any bid. Zero between games. */
  total: number;
  bid: Bid | null;
  bidder: string | null;
  toAct: string | null;
  turnEndsAt: number | null;
  /** How long a turn is, so the felt can draw the clock as a fraction. */
  turnMs: number;
  /** Everybody dealt into this game in seat order; between games, everybody seated. */
  order: readonly string[];
  /** Everybody still holding dice, in the round's turn order. Empty between games. */
  live: readonly string[];
  /** Which round this is, from one. Zero between games. */
  round: number;
  /** The round just decided, while its reveal is still on the felt. */
  resolution: ResolutionView | null;
  /** The last few rounds, oldest first. The table's own record of results. */
  board: readonly BoardRow[];
  winnerIds: readonly string[];
  /** When the countdown deals, between games, if one is running. */
  countdownEndsAt: number | null;
  /** How many seated players are ready, between games. */
  readyCount: number;
  /** Why the table cannot deal at all: fewer than two people sitting at it. */
  waitingFor: "players" | null;
  lastEvent: string | null;
  /**
   * Moves on with every action the table reports.
   *
   * Nothing else in this view counts turns, and the activity log needs
   * something to tell the same sentence twice running apart from one broadcast
   * sent twice.
   */
  eventSeq: number;
  /** This seat, or null for somebody only watching. */
  you: SeatView | null;
}

export class Table implements PlayTable {
  readonly code: string;
  readonly ante: number;
  readonly startingDice: number;
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
   * and a deal armed in that window would take a second set of antes.
   */
  draining = false;
  /** The antes of the game on the felt, by account. Play money never comes here. */
  readonly escrow = new Escrow();

  private readonly seating: Seating;
  private readonly turnMs: number;
  private readonly roll: () => Face;
  private readonly purses = new Map<string, number>();
  private readonly shorts = new Set<string>();
  /** Players in the game who asked to go while it was running, dropped when it clears. */
  private readonly leaving = new Set<string>();
  /** Seats the table wants dealt, waiting on somebody to take their antes. */
  private wanted: string[] | null = null;
  /** Who opened the last game, so the next game's opener moves on. */
  private lastOpener: string | null = null;
  private seq = 0;

  constructor(
    code: string,
    maxSeats: number,
    options: {
      ante: number;
      dice: number;
      roll: () => Face;
      turnMs?: number;
      countdownMs?: number;
    },
  ) {
    this.code = code;
    this.seating = new Seating(maxSeats);
    this.ante = options.ante;
    this.startingDice = options.dice;
    this.roll = options.roll;
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
   * to nobody. So the seat is held, the clock bids for their turns, and it goes
   * when the felt clears.
   */
  readonly leavesMidHand = false;

  private seatIds(): string[] {
    return this.seats.map((seat) => seat.id);
  }

  /**
   * The seats readiness is counted against: everybody seated who is still
   * connected. Leave only disconnects here, and a held seat that still counted
   * would keep "everybody ready" from ever being true.
   */
  present(): string[] {
    return this.seats.filter((seat) => seat.connected).map((seat) => seat.id);
  }

  join(id: string, name: string, identity: SeatIdentity | null): Seat {
    const seat = this.seating.join(id, name, this.status, identity, !this.forFun);
    // Somebody who arrives mid-game waits for the next one: dealing them in
    // would be a full ante for a fraction of a game.
    seat.waiting = this.game !== null;
    this.readiness.sync(this.present(), Date.now());
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
    this.readiness.set(id, true, this.present(), Date.now());
    return seat;
  }

  removeSeat(seatId: string): void {
    if (this.game?.players.includes(seatId)) {
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
    this.readiness.drop(seatId, this.present(), Date.now());
  }

  disconnect(seatId: string): void {
    this.seating.disconnect(seatId);
    /*
     * Stood down only between games. A ready button must not keep charging
     * somebody who has gone — left ready, they would still be dealt in and
     * anted by the very next countdown.
     */
    if (this.game === null) {
      this.readiness.set(seatId, false, this.present(), Date.now());
    }
  }

  reconnect(seatId: string): Seat {
    // Coming back cancels a held removal: a player on a bad line should not be
    // stood up at the end of a game they are still playing.
    this.leaving.delete(seatId);
    const seat = this.seating.reconnect(seatId);
    if (this.game === null) {
      this.readiness.sync(this.present(), Date.now());
    }
    return seat;
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

  /** Something the table did, for the activity log. Counted as well as said. */
  say(text: string): void {
    this.lastEvent = text;
    this.seq += 1;
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
    this.readiness.set(seatId, ready, this.present(), now);
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
    const ready = this.readiness.dealable(this.present(), now);
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
      this.readiness.set(seatId, false, this.present(), Date.now());
    }
    if (seatIds.length > 0) {
      const names = seatIds.map((seatId) => this.seating.find(seatId)?.name ?? "Somebody");
      this.say(`${names.join(", ")} could not cover the ante.`);
    }
  }

  /**
   * A deal that fell through: everybody's ready is stood down and the felt says
   * why. The table does not try again on its own — the next attempt happens
   * when people press ready again.
   */
  failDeal(reason: string): void {
    this.readiness.clear();
    this.readyBots();
    this.say(reason);
  }

  private readyBots(): void {
    const seated = this.present();
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
      dice: this.startingDice,
      roll: this.roll,
    });
    this.lastOpener = this.game.round.toAct;
    this.readiness.clear();
    this.say("The cups are down.");
    this.touchClock();
  }

  /**
   * Who opens the first round: the next player dealt in after whoever opened
   * the last game.
   *
   * The player to act first has the least to go on, so who opens is worth
   * something, and moving it round the table is the only version of that which
   * is even over an evening.
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

  /** Starts the next round, once the reveal has had its time on the felt. */
  nextRound(): void {
    if (this.game === null || !this.game.betweenRounds) {
      return;
    }
    this.game.nextRound();
    this.say("The cups are down.");
    this.touchClock();
  }

  /** Clears the felt and puts the table back to waiting for the next game. */
  finish(): void {
    if (this.game === null) {
      return;
    }
    /*
     * A backstop, not the usual route: `settle` drains the escrow the moment a
     * game is decided. A game cleared without being settled — a winner whose
     * seat had gone — has lost its pot, so this hands back nothing rather than
     * refunding chips a result already decided.
     */
    this.escrow.settle();
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

  private seatView(seat: Seat, forSeatId: string | null): SeatView {
    const game = this.game;
    const round = game?.round ?? null;
    const hand = round?.handFor(seat.id) ?? null;
    /*
     * The whole reason a view is per-seat. Your own dice, and anybody else's
     * only once the round has been called — a hand nobody paid to see is a hand
     * nobody sees, watchers included.
     */
    const revealed = round?.over ?? false;
    const shown: readonly (Face | null)[] =
      hand === null ? [] : seat.id === forSeatId || revealed ? hand : hand.map(() => null);
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
      short: this.shorts.has(seat.id),
      purse: this.forFun ? this.purseFor(seat.id) : null,
      dice: game?.diceFor(seat.id) ?? 0,
      hand: shown,
    };
  }

  view(forSeatId: string | null): TableView {
    const seats = this.seats.map((seat) => this.seatView(seat, forSeatId));
    const game = this.game;
    const round = game?.round ?? null;
    const winner = game?.winnerId ?? null;
    const resolution = round?.resolution ?? null;
    return {
      code: this.code,
      phase: this.phase,
      seats,
      watching: this.watching,
      forFun: this.forFun,
      maxSeats: this.maxSeats,
      ante: this.ante,
      startingDice: this.startingDice,
      pot: game?.pot ?? 0,
      total: round?.total ?? 0,
      bid: round?.bid ?? null,
      bidder: round?.bidder ?? null,
      toAct: round !== null && !round.over ? round.toAct : null,
      turnEndsAt: this.turnEndsAt,
      turnMs: this.turnMs,
      order: game?.players ?? this.seatIds(),
      live: round?.order ?? [],
      round: game?.roundNumber ?? 0,
      resolution:
        resolution === null
          ? null
          : {
              call: resolution.call,
              caller: resolution.caller,
              bid: resolution.bid,
              bidder: resolution.bidder,
              count: resolution.count,
              right: resolution.right,
              losers: resolution.losers,
            },
      board: game?.board ?? [],
      winnerIds: winner === null ? [] : [winner],
      countdownEndsAt: game === null ? this.readiness.countdownEndsAt : null,
      readyCount: game === null ? this.readiness.count(this.present()) : 0,
      // Counted the way ready is: a held leaver cannot be dealt, so a table
      // down to one connected player is waiting, not "1 of 1 ready".
      waitingFor: game === null && this.present().length < 2 ? "players" : null,
      lastEvent: this.lastEvent,
      eventSeq: this.seq,
      you: seats.find((seat) => seat.id === forSeatId) ?? null,
    };
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run games/liars-dice/src/table.test.ts
```

Expected: PASS. If `Seating#addBot` or `Seating#find` do not exist with those names, read `packages/core/src/seating.ts` and use what is there — do not add methods to `Seating`.

- [ ] **Step 5: Export it**

Add to `games/liars-dice/src/index.ts`:

```ts
export type { Phase, ResolutionView, SeatView, TableView } from "./table.js";
export { Table } from "./table.js";
```

- [ ] **Step 6: Format, lint, typecheck, commit**

```bash
npx biome format --write games/liars-dice/src
npm run lint
npm run typecheck
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): the table, and the first felt that keeps a secret

Every other table in the building can be described once and sent to
everybody. This one is built per seat: your dice are faces, everybody
else's are a face-down die each, and every hand turns over only when a
round is called — watchers included, since a watcher who could read every
cup could tell a player.

The departure handling, purses and readiness wiring are Death Roll's on
purpose. They were got right there and are not worth getting wrong again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 7: `adapter.ts` — the antes, the pot, and the clock

The money task. Read `games/death-roll/src/adapter.ts` in full before starting: `take`, `give`, `hold`, `giveBack`, `refundAll` and `antesIn` are copied across unchanged except for the missing pass, and every comment in them is load-bearing.

**Files:**
- Create: `games/liars-dice/src/adapter.ts`
- Create: `games/liars-dice/src/adapter.test.ts`
- Modify: `games/liars-dice/src/index.ts`

**Interfaces:**
- Consumes: `GameAdapter`, `GameDeps`, `BotMove`, `Seat`, `seatLimit`, `TableError` from `@backroom/core`; `Table`; `LIARS_DICE`, `anteFor`, `diceFor`, `TURN_MS`, `REVEAL_MS`, `RESULT_MS`; `isFace`, `minRaise`, `says`; `choose`, `thinkingTime` from `./bot.js` (written in Task 8 — until then `botMove` returns `null` and the import is not there).
- Produces: `liarsDiceAdapter(options?: { roll?: () => Face; turnMs?: number; revealMs?: number; resultMs?: number; countdownMs?: number }): GameAdapter<Table>`

- [ ] **Step 1: Write the failing test**

`games/liars-dice/src/adapter.test.ts`. Model it on `games/death-roll/src/adapter.test.ts` — copy that file's `deps` fake and its structure, then write these cases:

```ts
import { TableError } from "@backroom/core";
import type { GameDeps } from "@backroom/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Face } from "./bid.js";
import { liarsDiceAdapter } from "./adapter.js";
import type { Table } from "./table.js";

/** A store that behaves, and remembers what it was asked. */
const store = () => {
  const balances = new Map<string, number>();
  const deps = {
    take: vi.fn(async (userId: string, amount: number) => {
      const had = balances.get(userId) ?? 0;
      if (had < amount) {
        return false;
      }
      balances.set(userId, had - amount);
      return true;
    }),
    give: vi.fn(async (userId: string, amount: number) => {
      balances.set(userId, (balances.get(userId) ?? 0) + amount);
    }),
    record: vi.fn(async () => undefined),
    finished: vi.fn(async () => undefined),
  } satisfies GameDeps;
  return { balances, deps };
};

const fives = () => 5 as Face;

/** A table with seats that have accounts, ready to be dealt. */
const seated = (
  adapter: ReturnType<typeof liarsDiceAdapter>,
  names: readonly string[],
  options: { forFun?: boolean; dice?: number } = {},
) => {
  const table = adapter.create("ABCDE", {
    buyIn: 500,
    dice: options.dice ?? 2,
    forFun: options.forFun ?? false,
    maxSeats: 10,
  }) as Table;
  for (const name of names) {
    table.join(name, name, options.forFun === true ? null : { userId: name, avatar: null, accentColor: null });
  }
  return table;
};

describe("the antes", () => {
  let bank: ReturnType<typeof store>;
  let adapter: ReturnType<typeof liarsDiceAdapter>;

  beforeEach(() => {
    bank = store();
    adapter = liarsDiceAdapter({ roll: fives });
  });

  it("deals nobody until the antes are in, and then deals everybody who paid", async () => {
    const table = seated(adapter, ["a", "b"]);
    bank.balances.set("a", 1_000);
    bank.balances.set("b", 1_000);
    table.setReady("a", true, Date.now());
    table.setReady("b", true, Date.now());
    table.askForGame(Date.now());
    expect(table.game).toBe(null);

    const moved = await adapter.payOut?.(table, bank.deps);
    expect(moved).toBe(true);
    expect(table.game?.players).toEqual(["a", "b"]);
    expect(bank.balances.get("a")).toBe(500);
    expect(table.view(null).pot).toBe(1_000);
  });

  it("sits out only the player who cannot cover it", async () => {
    const table = seated(adapter, ["a", "b", "c"]);
    bank.balances.set("a", 1_000);
    bank.balances.set("b", 1_000);
    bank.balances.set("c", 100);
    for (const one of ["a", "b", "c"]) {
      table.setReady(one, true, Date.now());
    }
    table.askForGame(Date.now());
    await adapter.payOut?.(table, bank.deps);
    expect(table.game?.players).toEqual(["a", "b"]);
    expect(table.view(null).seats.find((seat) => seat.id === "c")?.short).toBe(true);
  });

  it("deals nobody and hands everything back when the store throws", async () => {
    const table = seated(adapter, ["a", "b"]);
    bank.balances.set("a", 1_000);
    bank.deps.take.mockImplementationOnce(async () => true).mockImplementationOnce(async () => {
      throw new Error("the store is down");
    });
    table.setReady("a", true, Date.now());
    table.setReady("b", true, Date.now());
    table.askForGame(Date.now());
    await adapter.payOut?.(table, bank.deps);
    expect(table.game).toBe(null);
    expect(bank.deps.give).toHaveBeenCalled();
    expect(table.view(null).lastEvent).toContain("nobody was dealt");
  });

  it("refunds and does not deal somebody who left while the antes were taken", async () => {
    const table = seated(adapter, ["a", "b", "c"]);
    for (const one of ["a", "b", "c"]) {
      bank.balances.set(one, 1_000);
      table.setReady(one, true, Date.now());
    }
    // c goes between the second ante and the third.
    bank.deps.take.mockImplementation(async (userId: string, amount: number) => {
      if (userId === "b") {
        table.disconnect("c");
      }
      const had = bank.balances.get(userId) ?? 0;
      bank.balances.set(userId, had - amount);
      return true;
    });
    table.askForGame(Date.now());
    await adapter.payOut?.(table, bank.deps);
    expect(table.game?.players).toEqual(["a", "b"]);
    expect(bank.balances.get("c")).toBe(1_000);
  });

  it("deals nobody at a table called off while an ante was in flight", async () => {
    const table = seated(adapter, ["a", "b"]);
    bank.balances.set("a", 1_000);
    bank.balances.set("b", 1_000);
    table.setReady("a", true, Date.now());
    table.setReady("b", true, Date.now());
    bank.deps.take.mockImplementationOnce(async (userId: string, amount: number) => {
      bank.balances.set(userId, (bank.balances.get(userId) ?? 0) - amount);
      await adapter.void(table, bank.deps);
      return true;
    });
    table.askForGame(Date.now());
    await adapter.payOut?.(table, bank.deps);
    expect(table.game).toBe(null);
    expect(bank.balances.get("a")).toBe(1_000);
  });

  it("does nothing at all when no deal was asked for", async () => {
    const table = seated(adapter, ["a", "b"]);
    expect(await adapter.payOut?.(table, bank.deps)).toBe(false);
  });
});

describe("the moves", () => {
  const bank = store();
  const adapter = liarsDiceAdapter({ roll: fives });

  const dealt = () => {
    const table = seated(adapter, ["a", "b"], { dice: 2 });
    table.begin(["a", "b"]);
    return table;
  };

  it("takes a bid and passes the turn", async () => {
    const table = dealt();
    await adapter.act(table, table.game?.round.toAct as string, { type: "bid", count: 3, face: 5 }, bank.deps);
    expect(table.view(null).bid).toEqual({ count: 3, face: 5 });
  });

  it("refuses a bid from the wrong seat", async () => {
    const table = dealt();
    const notTheirs = table.game?.round.order[1] as string;
    await expect(
      Promise.resolve(adapter.act(table, notTheirs, { type: "bid", count: 3, face: 5 }, bank.deps)),
    ).rejects.toThrow(TableError);
  });

  it("refuses a face that is not a face", async () => {
    const table = dealt();
    await expect(
      Promise.resolve(
        adapter.act(table, table.game?.round.toAct as string, { type: "bid", count: 1, face: 9 }, bank.deps),
      ),
    ).rejects.toThrow(TableError);
  });

  it("refuses a move nobody at this table can make", async () => {
    const table = dealt();
    await expect(
      Promise.resolve(adapter.act(table, table.game?.round.toAct as string, { type: "fold" }, bank.deps)),
    ).rejects.toThrow("not a move at this table");
  });

  it("resolves a liar call and says so", async () => {
    const table = dealt();
    const first = table.game?.round.toAct as string;
    await adapter.act(table, first, { type: "bid", count: 4, face: 5 }, bank.deps);
    const second = table.game?.round.toAct as string;
    await adapter.act(table, second, { type: "liar" }, bank.deps);
    expect(table.view(null).resolution?.call).toBe("liar");
    expect(table.view(null).lastEvent).toContain("liar");
  });
});

describe("the clock", () => {
  const bank = store();
  const adapter = liarsDiceAdapter({ roll: fives });

  it("bids the lowest legal raise rather than calling", () => {
    const table = seated(adapter, ["a", "b"], { dice: 2 });
    table.begin(["a", "b"]);
    const whose = table.game?.round.toAct as string;
    adapter.timeout?.(table, whose);
    expect(table.view(null).bid).toEqual({ count: 1, face: 2 });
    expect(table.view(null).resolution).toBe(null);
    expect(table.view(null).lastEvent).toContain("The clock");
  });

  it("calls liar only when no raise is left", () => {
    const table = seated(adapter, ["a", "b"], { dice: 2 });
    table.begin(["a", "b"]);
    const first = table.game?.round.toAct as string;
    // Every die in play claimed as a one: nothing beats it.
    table.game?.raise(first, { count: 4, face: 1 });
    const second = table.game?.round.toAct as string;
    adapter.timeout?.(table, second);
    expect(table.view(null).resolution?.call).toBe("liar");
  });

  it("does nothing for a seat whose turn it is not", () => {
    const table = seated(adapter, ["a", "b"], { dice: 2 });
    table.begin(["a", "b"]);
    const notTheirs = table.game?.round.order[1] as string;
    adapter.timeout?.(table, notTheirs);
    expect(table.view(null).bid).toBe(null);
  });
});

describe("paying out", () => {
  it("pays the pot to the last one holding dice and records the game", async () => {
    const bank = store();
    const adapter = liarsDiceAdapter({ roll: fives });
    const table = seated(adapter, ["a", "b"], { dice: 1 });
    for (const one of ["a", "b"]) {
      bank.balances.set(one, 1_000);
      table.setReady(one, true, Date.now());
    }
    table.askForGame(Date.now());
    await adapter.payOut?.(table, bank.deps);

    const first = table.game?.round.toAct as string;
    const second = table.game?.round.order[1] as string;
    // Two fives on the table, so a bid of two fives is good and the caller pays
    // their only die.
    await adapter.act(table, first, { type: "bid", count: 2, face: 5 }, bank.deps);
    await adapter.act(table, second, { type: "liar" }, bank.deps);

    expect(adapter.isSettled(table)).toBe(true);
    await adapter.settle(table, bank.deps);
    expect(bank.balances.get(first)).toBe(1_500);
    expect(bank.balances.get(second)).toBe(500);
    expect(bank.deps.finished).toHaveBeenCalledTimes(1);
    expect(adapter.winners?.(table)).toEqual([first]);
  });

  it("records nothing at a for-fun table", async () => {
    const bank = store();
    const adapter = liarsDiceAdapter({ roll: fives });
    const table = seated(adapter, ["a", "b"], { dice: 1, forFun: true });
    table.begin(["a", "b"]);
    const first = table.game?.round.toAct as string;
    const second = table.game?.round.order[1] as string;
    table.game?.raise(first, { count: 2, face: 5 });
    table.game?.call(second, "liar");
    await adapter.settle(table, bank.deps);
    expect(bank.deps.finished).not.toHaveBeenCalled();
    expect(bank.deps.record).not.toHaveBeenCalled();
  });
});

describe("calling the table off", () => {
  it("hands every ante back to whoever paid it", async () => {
    const bank = store();
    const adapter = liarsDiceAdapter({ roll: fives });
    const table = seated(adapter, ["a", "b"]);
    for (const one of ["a", "b"]) {
      bank.balances.set(one, 1_000);
      table.setReady(one, true, Date.now());
    }
    table.askForGame(Date.now());
    await adapter.payOut?.(table, bank.deps);
    const owed = await adapter.void(table, bank.deps);
    expect(owed).toEqual([
      { userId: "a", chips: 500 },
      { userId: "b", chips: 500 },
    ]);
    expect(bank.balances.get("a")).toBe(1_000);
  });
});

describe("the table's own clock", () => {
  const adapter = liarsDiceAdapter({ roll: fives, revealMs: 1_234, resultMs: 4_321 });

  it("waits on a reveal, then deals the next round", () => {
    const table = seated(adapter, ["a", "b", "c"], { dice: 2 });
    table.begin(["a", "b", "c"]);
    const first = table.game?.round.toAct as string;
    const second = table.game?.round.order[1] as string;
    table.game?.raise(first, { count: 6, face: 5 });
    table.game?.call(second, "liar");
    const pause = adapter.pause?.(table);
    expect(pause?.key).toBe("round");
    expect(pause?.ms).toBe(1_234);
    pause?.run();
    expect(table.view(null).round).toBe(2);
  });

  it("waits on a result, then clears the felt", () => {
    const table = seated(adapter, ["a", "b"], { dice: 1 });
    table.begin(["a", "b"]);
    const first = table.game?.round.toAct as string;
    const second = table.game?.round.order[1] as string;
    table.game?.raise(first, { count: 2, face: 5 });
    table.game?.call(second, "liar");
    const pause = adapter.pause?.(table);
    expect(pause?.key).toBe("result");
    expect(pause?.ms).toBe(4_321);
    pause?.run();
    expect(table.view(null).phase).toBe("waiting");
  });

  it("deals at once when everybody is ready", () => {
    const table = seated(adapter, ["a", "b"]);
    table.setReady("a", true, Date.now());
    table.setReady("b", true, Date.now());
    const pause = adapter.pause?.(table);
    expect(pause?.key).toBe("deal");
    expect(pause?.ms).toBe(0);
    pause?.run();
    expect(table.pending).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run games/liars-dice/src/adapter.test.ts
```

Expected: FAIL — `Failed to resolve import "./adapter.js"`.

- [ ] **Step 3: Write `adapter.ts`**

Copy `games/death-roll/src/adapter.ts` to `games/liars-dice/src/adapter.ts` and then change it as follows. Keep `take`, `give`, `hold`, `giveBack`, `refundAll` and `antesIn` **byte-for-byte identical** apart from the type name — they are the money and their comments explain why each line is where it is.

```bash
cp games/death-roll/src/adapter.ts games/liars-dice/src/adapter.ts
```

Then:

**(a)** Replace the import block and the doc comment at the top:

```ts
import type { BotMove, GameAdapter, GameDeps, Seat } from "@backroom/core";
import { seatLimit, TableError } from "@backroom/core";
import type { Face } from "./bid.js";
import { isFace, minRaise, says } from "./bid.js";
import { anteFor, diceFor, LIARS_DICE, RESULT_MS, REVEAL_MS, TURN_MS } from "./listing.js";
import { Table } from "./table.js";

/**
 * What the room does with a Liar's Dice table.
 *
 * The money needs no bank to be honest: every chip in the pot came off one of
 * the players in the game, and one of them takes it. Nothing is staked during a
 * game at all, so `act` never touches an account — the only money here is the
 * antes and the payout.
 *
 * The timing is the awkward part, and it is Death Roll's. A game cannot start
 * until the antes are in, and nothing starts one but the table's own clock;
 * `pause` is synchronous and cannot take an ante, so the table asks for a game
 * and `payOut` — asynchronous, run on every broadcast — takes the antes, deals,
 * and asks the room to send the state again.
 */
export function liarsDiceAdapter(
  options: {
    /**
     * Where a die comes from. Injected so tests can deal to order; in the
     * server it is `randomInt`, because a reveal hands the table every hand at
     * once — exactly the run of observations that predicts the next deal from
     * Math.random.
     */
    roll?: () => Face;
    turnMs?: number;
    revealMs?: number;
    resultMs?: number;
    countdownMs?: number;
  } = {},
): GameAdapter<Table> {
  const roll = options.roll ?? (() => (Math.floor(Math.random() * 6) + 1) as Face);
  const turnMs = options.turnMs ?? TURN_MS;
  const revealMs = options.revealMs ?? REVEAL_MS;
  const resultMs = options.resultMs ?? RESULT_MS;
```

**(b)** In `antesIn`, delete nothing and change nothing except the two failure sentences, which stay as they are. The only real edit is at the end, where Death Roll calls `table.begin(...)` — that stays too.

**(c)** Replace `listing` and `create`:

```ts
    listing: LIARS_DICE,

    create(code, made) {
      const table = new Table(code, seatLimit(made?.["maxSeats"], LIARS_DICE.maxSeats), {
        ante: anteFor(made?.["buyIn"]),
        dice: diceFor(made?.["dice"]),
        roll,
        turnMs,
        ...(options.countdownMs === undefined ? {} : { countdownMs: options.countdownMs }),
      });
      // Fixed when the table is opened: a table anybody may sit at and one that
      // spends real chips are not the same game with a different label.
      table.forFun = made?.["forFun"] === true;
      return table;
    },
```

**(d)** Replace the whole of `act`:

```ts
    /**
     * One move. No chips move here, at all.
     *
     * Nothing is staked during a game — the antes went on at the deal and the
     * pot is settled at the end — so unlike Death Roll's pass there is nothing
     * here to take, hold or hand back. What is left is the rules, and the rules
     * refuse in words.
     */
    act(table, seatId, action, _deps) {
      const move = action as { type?: string; ready?: unknown; count?: unknown; face?: unknown };
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
        throw new TableError("There is nothing to bid on right now.");
      }

      switch (move.type) {
        case "bid": {
          /*
           * Checked here rather than trusted, because these two numbers arrive
           * from a browser: the count is bounded by the round, which knows how
           * many dice are on the table, and the face has to actually be a face.
           */
          if (!isFace(move.face)) {
            throw new TableError("That is not a face on a die.");
          }
          if (typeof move.count !== "number") {
            throw new TableError("A bid names a whole number of dice.");
          }
          const bid = { count: move.count, face: move.face };
          game.raise(seatId, bid);
          table.say(`${seat.name} bid ${says(bid)}.`);
          table.touchClock();
          return;
        }
        case "liar":
        case "exact": {
          const out = game.call(seatId, move.type);
          table.say(said(table, out));
          table.touchClock();
          return;
        }
        default:
          throw new TableError("That is not a move at this table.");
      }
    },
```

**(e)** Above the returned object, add the sentence-maker and the timeout's words:

```ts
  /** Who somebody is at this table, or a name for a seat that has gone. */
  const nameOf = (table: Table, seatId: string): string =>
    table.seats.find((one) => one.id === seatId)?.name ?? "Somebody";

  /**
   * A resolution in one sentence.
   *
   * The count is always said, because it is the thing everybody at the table
   * wants to know and the only thing they could not have worked out themselves.
   */
  const said = (table: Table, out: ReturnType<Table["game"] & object extends never ? never : never>): string => "";
```

Replace that stub with the real one — it needs the `Resolution` type, so import it:

```ts
import type { Resolution } from "./round.js";

/** A resolution in one sentence, for the activity log. */
const said = (table: Table, out: Resolution): string => {
  const caller = nameOf(table, out.caller);
  const bidder = nameOf(table, out.bidder);
  const count = `${out.count} on the table`;
  if (out.call === "liar") {
    return out.right
      ? `${caller} called ${bidder} a liar over ${says(out.bid)} — ${count}, so ${caller} loses a die.`
      : `${caller} called ${bidder} a liar over ${says(out.bid)} — ${count}, so ${bidder} loses a die.`;
  }
  return out.right
    ? `${caller} called ${says(out.bid)} exactly — ${count}, and everybody else loses a die.`
    : `${caller} called ${says(out.bid)} exactly — ${count}, so ${caller} loses a die.`;
};
```

Move `nameOf` and `said` above `liarsDiceAdapter`'s `return` (they need no closure over options).

**(f)** Replace `isSettled`, `settle`, `winners`, `clock`, `timeout`, `botMove` and `pause`:

```ts
    isSettled(table) {
      return table.phase === "over";
    },

    /**
     * Pays the pot to the last one holding dice: every ante, out of chips
     * already in it. Seats in the game are held until the felt clears, so the
     * winner is always there to be paid; if one somehow is not, nothing is
     * recorded as though it were.
     */
    async settle(table, deps) {
      const game = table.game;
      if (game === null || !game.over) {
        return;
      }
      /*
       * Before the first await: the pot now belongs to the winner, not to the
       * accounts it came off, so a void racing this settlement finds nothing
       * left to give back twice.
       */
      table.escrow.settle();
      const winnerId = game.winnerId as string;
      const winner = table.seats.find((one) => one.id === winnerId);
      if (winner === undefined) {
        throw new Error(`liars dice: ${table.code} won by a seat that is gone; pot unpaid`);
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
            rounds: 1,
            roundsWon: net > 0 ? 1 : 0,
            chipsWon: net,
            chipsStaked: game.ante,
          },
          game: LIARS_DICE.id,
          add: {
            games: 1,
            bids: game.bidsBy(seatId),
            calls: game.callsBy(seatId),
            exacts: game.exactsBy(seatId),
            exactsHit: game.hitsBy(seatId),
          },
          max: { pot: game.pot, rounds: game.survivedBy(seatId) },
        });
      }

      await deps.finished({
        code: table.code,
        rulesetName: `${table.startingDice} dice`,
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

    /** Calls the table off: every ante still on the felt, back to whoever paid it. */
    async void(table, deps) {
      const owed = table.escrow.close();
      for (const one of owed) {
        await deps.give(one.userId, one.chips);
      }
      return owed;
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
      return { seatId: game.round.toAct, endsAt };
    },

    /**
     * Acts for somebody whose time ran out.
     *
     * The lowest legal raise, which is the neutral move: it resolves nothing,
     * so a bad connection cannot cost somebody a die or their ante. Only when
     * the board is at its ceiling and no raise exists is there nothing else to
     * do but call — and by then there is no other move in the game.
     */
    timeout(table, seatId) {
      const game = table.game;
      if (game === null || game.over || game.round.over || game.round.toAct !== seatId) {
        return;
      }
      const name = nameOf(table, seatId);
      const raise = minRaise(game.round.bid, game.round.total);
      if (raise === null) {
        const out = game.call(seatId, "liar");
        table.say(`The clock called liar for ${name}. ${said(table, out)}`);
      } else {
        game.raise(seatId, raise);
        table.say(`The clock bid ${says(raise)} for ${name}.`);
      }
      table.touchClock();
    },

    /** A bot's turn, or nothing. Bots only sit at tables playing for fun. */
    botMove(): BotMove | null {
      return null;
    },

    /**
     * The table's own clock.
     *
     * A finished game is left up to be read, then cleared. A revealed round
     * stays up, then the next one is dealt. Between games: everybody ready
     * deals at once, and a running countdown deals when it ends.
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
          ? { key: "round", ms: revealMs, run: () => table.nextRound() }
          : null;
      }
      if (table.pending || table.draining) {
        return null;
      }
      // Only the players still here: a seat held after Leave is not ready and
      // is not coming back for this deal, so it must not hold the rest to the
      // countdown.
      const seated = table.present();
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
```

**(g)** In `payOut`, change only the `console.error` prefix from `death roll` to `liars dice`.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run games/liars-dice/src/adapter.test.ts
```

Expected: PASS. If `_deps` trips `noUnusedVariables`, drop the parameter entirely — the interface allows a shorter signature.

- [ ] **Step 5: Export it**

Add to `games/liars-dice/src/index.ts`:

```ts
export { liarsDiceAdapter } from "./adapter.js";
```

- [ ] **Step 6: Format, lint, typecheck, commit**

```bash
npx biome format --write games/liars-dice/src
npm run lint
npm run typecheck
npm test
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): the antes, the pot and the clock

Death Roll's money, with less of it: nothing is staked during a game, so
`act` never touches an account. What is left is the antes at the deal and
the pot at the end — and every hard-won case from that table comes across
as a test, because a short ante, a store that throws, a player leaving
during somebody else's refund and a void racing a settle are all still
possible here.

The clock bids the lowest legal raise rather than calling. A bad
connection must never cost somebody a die or their ante; only at the
ceiling, where no raise exists, is there nothing to do but call.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 8: `bot.ts` — somebody to play against for fun

**Files:**
- Create: `games/liars-dice/src/bot.ts`
- Create: `games/liars-dice/src/bot.test.ts`
- Modify: `games/liars-dice/src/adapter.ts` (`botMove`)
- Modify: `games/liars-dice/src/index.ts`

**Interfaces:**
- Consumes: `BotSkill` from `@backroom/core`; `Bid`, `Face`, `FACES`, `countOf`, `leastCount` from `./bid.js`.
- Produces:
  - `type Choice = { type: "bid"; bid: Bid } | { type: "liar" } | { type: "exact" }`
  - `atLeast(trials: number, wanted: number, chance: number): number`
  - `exactly(trials: number, wanted: number, chance: number): number`
  - `choose(input: { skill: BotSkill; hand: readonly Face[]; total: number; standing: Bid | null }): Choice`
  - `thinkingTime(skill: BotSkill): number`
  - `NERVE: Record<BotSkill, { call: number; bid: number }>`

- [ ] **Step 1: Write the failing test**

`games/liars-dice/src/bot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Face } from "./bid.js";
import { atLeast, choose, exactly, thinkingTime } from "./bot.js";

describe("the arithmetic it believes", () => {
  it("is certain of nothing wanted", () => {
    expect(atLeast(10, 0, 1 / 3)).toBe(1);
    expect(atLeast(0, 0, 1 / 3)).toBe(1);
  });

  it("is certain against more than there are dice", () => {
    expect(atLeast(3, 4, 1 / 3)).toBe(0);
    expect(atLeast(0, 1, 1 / 3)).toBe(0);
  });

  it("gets one die right", () => {
    expect(atLeast(1, 1, 1 / 3)).toBeCloseTo(1 / 3, 10);
    expect(exactly(1, 1, 1 / 3)).toBeCloseTo(1 / 3, 10);
    expect(exactly(1, 0, 1 / 3)).toBeCloseTo(2 / 3, 10);
  });

  it("sums to one over every outcome", () => {
    let sum = 0;
    for (let wanted = 0; wanted <= 6; wanted += 1) {
      sum += exactly(6, wanted, 1 / 3);
    }
    expect(sum).toBeCloseTo(1, 10);
  });

  it("thins out as the bid climbs", () => {
    expect(atLeast(10, 3, 1 / 3)).toBeGreaterThan(atLeast(10, 6, 1 / 3));
  });
});

describe("what a bot does", () => {
  const hand: Face[] = [5, 5, 3];

  it("opens on a face it actually holds", () => {
    const out = choose({ skill: "normal", hand, total: 9, standing: null });
    if (out.type !== "bid") {
      throw new Error("expected a bid");
    }
    expect(out.bid.face).toBe(5);
    // Two fives of its own plus a third of the six it cannot see.
    expect(out.bid.count).toBe(4);
    expect(out.bid.count).toBeLessThanOrEqual(9);
  });

  it("calls liar on a bid nothing could cover", () => {
    const out = choose({ skill: "normal", hand, total: 9, standing: { count: 9, face: 2 } });
    expect(out.type).toBe("liar");
  });

  it("raises a bid it still believes", () => {
    const out = choose({ skill: "normal", hand, total: 9, standing: { count: 2, face: 5 } });
    expect(out.type).toBe("bid");
  });

  it("never names more dice than are on the table", () => {
    for (let total = 2; total <= 12; total += 1) {
      const out = choose({ skill: "hard", hand: [5], total, standing: null });
      if (out.type === "bid") {
        expect(out.bid.count).toBeLessThanOrEqual(total);
      }
    }
  });

  it("only calls exact at hard", () => {
    // Its own two fives, four dice unseen, and a bid sitting exactly on what it
    // expects: one more five among the four. An easy bot never tries this.
    const sitting = { skill: "easy", hand: [5, 5] as Face[], total: 6, standing: { count: 3, face: 5 } } as const;
    expect(choose(sitting).type).not.toBe("exact");
  });

  it("makes a legal bid whatever the standing bid is", () => {
    // The real guard: every raise it offers has to be one the round accepts.
    const { beats } = await import("./bid.js");
    for (const face of [1, 2, 6] as Face[]) {
      for (let count = 1; count <= 6; count += 1) {
        const standing = { count, face };
        const out = choose({ skill: "normal", hand: [5, 5, 1], total: 9, standing });
        if (out.type === "bid") {
          expect(beats(out.bid, standing)).toBe(true);
          expect(out.bid.count).toBeLessThanOrEqual(9);
        }
      }
    }
  });
});

describe("how long it looks like it thought", () => {
  it("is quicker the better it plays, and never instant", () => {
    for (const skill of ["easy", "normal", "hard"] as const) {
      const ms = thinkingTime(skill);
      expect(ms).toBeGreaterThan(300);
      expect(ms).toBeLessThan(4_000);
    }
  });
});
```

Note: the `await import` inside a non-async `it` will not compile. Make that test `async`:

```ts
  it("makes a legal bid whatever the standing bid is", async () => {
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run games/liars-dice/src/bot.test.ts
```

Expected: FAIL — `Failed to resolve import "./bot.js"`.

- [ ] **Step 3: Write `bot.ts`**

```ts
import type { BotSkill } from "@backroom/core";
import type { Bid, Face } from "./bid.js";
import { countOf, FACES, leastCount } from "./bid.js";

/**
 * Somebody to play against when there is nobody to play against.
 *
 * Bots sit only at tables playing for fun — a bot has no account, so a game
 * won against one for chips would be chips out of thin air. What it needs is
 * therefore not a good player but a believable one: a table that bids things
 * roughly worth bidding and calls a bluff often enough to make bluffing a
 * decision.
 *
 * It knows its own hand and how many dice it cannot see, which is exactly what
 * a person knows. Everything below follows from that and nothing peeks.
 */

export type Choice = { type: "bid"; bid: Bid } | { type: "liar" } | { type: "exact" };

/** How wild a face is: a one fills only a bid on ones, anything else takes wilds too. */
const chanceOf = (face: Face): number => (face === 1 ? 1 / 6 : 1 / 3);

/**
 * The chance of exactly this many hits among dice it cannot see.
 *
 * Multiplied up term by term rather than through factorials: fifty dice is
 * well inside what a float handles this way, and `50!` is not.
 */
export function exactly(trials: number, wanted: number, chance: number): number {
  if (wanted < 0 || wanted > trials) {
    return 0;
  }
  let term = (1 - chance) ** (trials - wanted) * chance ** wanted;
  for (let at = 0; at < wanted; at += 1) {
    term *= (trials - at) / (at + 1);
  }
  return term;
}

/** The chance of at least this many. One when nothing is wanted; zero past the dice. */
export function atLeast(trials: number, wanted: number, chance: number): number {
  if (wanted <= 0) {
    return 1;
  }
  if (wanted > trials) {
    return 0;
  }
  let sum = 0;
  for (let hits = wanted; hits <= trials; hits += 1) {
    sum += exactly(trials, hits, chance);
  }
  return sum;
}

/**
 * How much a bot needs to believe something before it says it, and how little
 * before it calls.
 *
 * An easy bot is credulous: it lets almost anything stand and says things it
 * half believes. A hard one calls on a coin's edge and only bids what it
 * expects to be there.
 */
export const NERVE: Record<BotSkill, { call: number; bid: number }> = {
  easy: { call: 0.18, bid: 0.26 },
  normal: { call: 0.28, bid: 0.34 },
  hard: { call: 0.38, bid: 0.42 },
};

/** The face it holds most of, ties going to the higher one. */
function bestFace(hand: readonly Face[]): Face {
  let best: Face = 6;
  let most = -1;
  for (const face of FACES) {
    // Not `countOf`, because a bot picking a face to open on cares what it
    // actually holds rather than what its ones could pretend to be.
    const held = hand.filter((die) => die === face).length;
    if (held >= most) {
      most = held;
      best = face;
    }
  }
  return best;
}

export function choose({
  skill,
  hand,
  total,
  standing,
}: {
  skill: BotSkill;
  hand: readonly Face[];
  /** Dice on the table, its own included. */
  total: number;
  standing: Bid | null;
}): Choice {
  const unseen = Math.max(0, total - hand.length);
  const nerve = NERVE[skill];

  /** How likely a claim is to be true, given what it holds and what it cannot see. */
  const believe = (bid: Bid): number =>
    atLeast(unseen, bid.count - countOf([hand], bid.face), chanceOf(bid.face));

  if (standing === null) {
    /*
     * Opening. Its own dice plus its share of everybody else's, which is the
     * honest bid — and the honest bid is the right opening, because the whole
     * game is deciding when to stop telling the truth.
     */
    const face = bestFace(hand);
    const count = Math.max(
      1,
      Math.min(total, countOf([hand], face) + Math.round(unseen * chanceOf(face))),
    );
    return { type: "bid", bid: { count, face } };
  }

  /*
   * Exact, at hard only. It is the press that ends games and a bot that reached
   * for it at every table would be unbearable to sit with; a good player uses
   * it when the count sits right on what they expect, which is what this asks.
   */
  if (
    skill === "hard" &&
    exactly(unseen, standing.count - countOf([hand], standing.face), chanceOf(standing.face)) >= 0.26
  ) {
    return { type: "exact" };
  }

  if (believe(standing) < nerve.call) {
    return { type: "liar" };
  }

  /*
   * The raise it believes most, out of the cheapest bid available at each face.
   * Cheapest per face because anything dearer at the same face is strictly less
   * likely — so one candidate per face is the whole board worth considering.
   */
  let best: Bid | null = null;
  let bestOdds = 0;
  for (const face of FACES) {
    const count = leastCount(face, standing, total);
    if (count === null) {
      continue;
    }
    const candidate: Bid = { count, face };
    const odds = believe(candidate);
    if (odds >= nerve.bid && odds > bestOdds) {
      best = candidate;
      bestOdds = odds;
    }
  }
  // Nothing it believes enough to say is a reason to call, not a reason to lie:
  // a bot that bid its way up a board it did not believe would never be caught.
  return best === null ? { type: "liar" } : { type: "bid", bid: best };
}

/** How long to look like it thought about it. Better players are quicker. */
export function thinkingTime(skill: BotSkill): number {
  const base = skill === "easy" ? 1_900 : skill === "normal" ? 1_300 : 850;
  return base + Math.floor(Math.random() * 600);
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run games/liars-dice/src/bot.test.ts
```

Expected: PASS. If the "opens on a face it actually holds" case gives a count other than 4, check `Math.round(6 / 3) === 2` plus `countOf([[5,5,3]], 5) === 2`.

- [ ] **Step 5: Wire `botMove` in the adapter**

In `games/liars-dice/src/adapter.ts`, add the import and replace the stub:

```ts
import { choose, thinkingTime } from "./bot.js";
```

```ts
    /** A bot's turn, or nothing. Bots only sit at tables playing for fun. */
    botMove(table): BotMove | null {
      const game = table.game;
      if (game === null || game.over || game.round.over) {
        return null;
      }
      const round = game.round;
      const seat = table.seats.find((one) => one.id === round.toAct);
      if (seat === undefined || !seat.isBot) {
        return null;
      }
      const skill = seat.skill ?? "normal";
      const choice = choose({
        skill,
        hand: round.handFor(seat.id) ?? [],
        total: round.total,
        standing: round.bid,
      });
      return {
        seatId: seat.id,
        delayMs: thinkingTime(skill),
        play() {
          // Checked again on the way in: the clock may have acted for this seat
          // while the bot was thinking, or the round may be over.
          if (
            table.game !== game ||
            game.round !== round ||
            round.over ||
            round.toAct !== seat.id
          ) {
            return;
          }
          if (choice.type === "bid") {
            game.raise(seat.id, choice.bid);
            table.say(`${seat.name} bid ${says(choice.bid)}.`);
          } else {
            const out = game.call(seat.id, choice.type);
            table.say(said(table, out));
          }
          table.touchClock();
        },
      };
    },
```

- [ ] **Step 6: Add the bot cases to the adapter test**

Append to `games/liars-dice/src/adapter.test.ts`:

```ts
describe("bots", () => {
  const bank = store();
  const adapter = liarsDiceAdapter({ roll: fives });

  it("plays only at a for-fun table, and makes a legal move", () => {
    const table = seated(adapter, ["a"], { forFun: true, dice: 2 });
    table.addBot("bot", "Robot", "normal");
    table.begin(["a", "bot"]);
    // Get the turn onto the bot whichever way the opener fell.
    if (table.game?.round.toAct !== "bot") {
      table.game?.raise(table.game.round.toAct, { count: 1, face: 2 });
    }
    const move = adapter.botMove?.(table);
    expect(move?.seatId).toBe("bot");
    move?.play();
    const view = table.view(null);
    expect(view.bid !== null || view.resolution !== null).toBe(true);
  });

  it("is not offered a turn at a table playing for chips, because none can sit", () => {
    const table = seated(adapter, ["a", "b"], { dice: 2 });
    table.begin(["a", "b"]);
    expect(adapter.botMove?.(table)).toBe(null);
    expect(() => table.addBot("bot", "Robot", "normal")).toThrow("for fun");
  });
});
```

- [ ] **Step 7: Export, run everything, format, lint, commit**

Add to `games/liars-dice/src/index.ts`:

```ts
export type { Choice } from "./bot.js";
export { atLeast, choose, exactly, NERVE, thinkingTime } from "./bot.js";
```

```bash
npx vitest run games/liars-dice
npx biome format --write games/liars-dice/src
npm run lint
npm run typecheck
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): somebody to play against for fun

It knows its own hand and how many dice it cannot see, which is exactly
what a person knows, and works the rest out with a binomial tail. Nothing
peeks.

What it needs to be is believable rather than good: it bids the cheapest
claim at each face that it still believes, calls when it believes the
standing bid least, and reaches for exact only at hard — that press ends
games and a bot that used it freely would be unbearable to sit with.

Bots are refused at any table playing for chips, where a game won against
one would be chips out of thin air.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 9: Wire it into the server

After this task the game is reachable over the socket, with no client yet.

**Files:**
- Modify: `packages/shared/src/schemas.ts` (`dice` on `createSchema`)
- Modify: `packages/shared/src/schemas.test.ts` (a case for it)
- Modify: `apps/server/src/server.ts` (import, catalogue, `ADAPTERS`, `create` options)
- Modify: `apps/server/src/catalogue.test.ts` (a case for the new listing)
- Create: `apps/server/src/liarsdice.socket.test.ts`
- Modify: `apps/server/package.json` (dep)

**Interfaces:**
- Consumes: `LIARS_DICE`, `liarsDiceAdapter` from `@backroom/game-liars-dice`.
- Produces: a table openable with `lobby:create { game: "liars-dice", buyIn, dice, forFun, maxSeats }`, actions `{ type: "ready" | "bid" | "liar" | "exact" }`.

- [ ] **Step 1: Add the dep**

In `apps/server/package.json`, add to `dependencies`:

```json
    "@backroom/game-liars-dice": "*"
```

Then `npm install`.

- [ ] **Step 2: Write the failing schema test**

Add to `packages/shared/src/schemas.test.ts`:

```ts
describe("how many dice a table deals", () => {
  it("is accepted between one and five", () => {
    expect(createSchema.safeParse({ name: "Ada", game: "liars-dice", dice: 3 }).success).toBe(true);
    expect(createSchema.safeParse({ name: "Ada", game: "liars-dice", dice: 5 }).success).toBe(true);
  });

  it("is refused outside that, so a client cannot deal a hundred", () => {
    expect(createSchema.safeParse({ name: "Ada", dice: 0 }).success).toBe(false);
    expect(createSchema.safeParse({ name: "Ada", dice: 6 }).success).toBe(false);
    expect(createSchema.safeParse({ name: "Ada", dice: 2.5 }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

```bash
npx vitest run packages/shared/src/schemas.test.ts
```

Expected: FAIL — `dice: 0` and `dice: 6` parse successfully, because an unknown key is simply ignored.

- [ ] **Step 4: Add the field**

In `packages/shared/src/schemas.ts`, inside `createSchema` after `ceiling`:

```ts
  /**
   * How many dice each player starts with, for a game that deals them.
   *
   * The same kind of decision as the seat count: three dice at ten players is
   * one hand of an evening and five is the whole evening, so it belongs to the
   * host with the rest of the table's shape. Bounded here and snapped to a
   * level the game offers, which is where the real refusal lives.
   */
  dice: z.number().int().min(1).max(5).optional(),
```

- [ ] **Step 5: Run it to see it pass**

```bash
npx vitest run packages/shared/src/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Wire the server**

In `apps/server/src/server.ts`:

(a) With the other game imports near line 16:

```ts
import { LIARS_DICE, liarsDiceAdapter } from "@backroom/game-liars-dice";
```

(b) In the catalogue chain (around line 109), after `.add(DEATH_ROLL)`:

```ts
    .add(LIARS_DICE)
```

(c) In the `ADAPTERS` map, after the `DEATH_ROLL` entry:

```ts
    [
      LIARS_DICE.id,
      liarsDiceAdapter({
        /*
         * The dice, from the same source the reels and the shoe come from. A
         * reveal hands every player at the table thirty faces in one message,
         * which over an evening is exactly the run of observations needed to
         * recover Math.random's state — and somebody who knew the next deal
         * would know whether to call, which is the whole game.
         *
         * `randomInt` rather than scaling a float, because it is
         * rejection-sampled and so uniform over six, which scaling is not.
         */
        roll: () => randomInt(1, 7) as 1 | 2 | 3 | 4 | 5 | 6,
        ...(turnMs === undefined ? {} : { turnMs }),
      }) as GameAdapter<PlayTable>,
    ],
```

(d) In the `lobby:create` handler's `game.create(code, { … })` object (around line 2376), add:

```ts
          dice: parsed.data.dice,
```

- [ ] **Step 7: Write the socket test**

Create `apps/server/src/liarsdice.socket.test.ts` by copying the shape of `apps/server/src/deathroll.socket.test.ts` — read it first for how it stands a server up and drives sockets. The cases to cover:

```ts
// 1. Two signed-in players open a chips table, both press ready, and the table
//    deals itself: each balance is down one ante and the pot is two.
// 2. Each player's own state shows their own faces and `null` for the other's.
// 3. A bid from the wrong seat comes back as a room:error and the bid does not
//    move.
// 4. A liar call turns both hands up in both players' states.
// 5. `lobby:addBot` at a chips table is refused in words.
// 6. A for-fun table seats a bot and deals with one human.
```

- [ ] **Step 8: Add the catalogue case**

In `apps/server/src/catalogue.test.ts`, add `liars-dice` to whatever assertion lists the playable games, following the existing style in that file.

- [ ] **Step 9: Run everything**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: PASS, PASS, clean.

- [ ] **Step 10: Format and commit**

```bash
npx biome format --write packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts apps/server/src/server.ts apps/server/src/catalogue.test.ts apps/server/src/liarsdice.socket.test.ts
git add -A
git commit -m "$(cat <<'MSG'
feat(server): Liar's Dice on the floor

The catalogue gains it, the adapter map gains it, and the dice each are a
new host option — bounded in the schema and snapped by the game, which is
where the real refusal lives, because a client that could name its own
would be setting the table's shape for everybody at it.

The dice come from randomInt. A reveal hands every player thirty faces in
one message, and somebody who could predict the next deal would know
whether to call.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 10: The room — theme, tile, routes

After this task the game has a door: it appears in the front room, dressed in its own colours, and its page renders the setup screen.

**Files:**
- Modify: `games/liars-dice/src/theme.css` (written properly)
- Create: `apps/web/src/liarsdice/LiarsDice.tsx` (setup only; the felt arrives in Task 15)
- Create: `apps/web/src/liarsdice/LiarsDice.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/room/Room.tsx`
- Modify: `apps/web/src/room/TileArt.tsx`
- Modify: `apps/web/src/room/TileArt.test.tsx`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `LIARS_DICE`, `DICE_LEVELS`, `STAKES`, `TableView` from `@backroom/game-liars-dice`; `TableSetup`, `useTableSocket`, `useAccount`, `useNav`, `Taken`, `Refusal`.
- Produces: `export function LiarsDice()` at `/liars-dice`; `export function CupArt()` in `TileArt.tsx`.

- [ ] **Step 1: Add the dep**

In `apps/web/package.json`, add to `dependencies`:

```json
    "@backroom/game-liars-dice": "*"
```

Then `npm install`.

- [ ] **Step 2: Write `theme.css` properly**

Replace `games/liars-dice/src/theme.css`:

```css
/*
 * The Liar's Dice room.
 *
 * Same rule as every other room's: a game owns its materials, the building
 * owns its interface. So this repaints the surfaces and touches nothing that
 * carries meaning — chip stays gold, good and bad stay what they are
 * everywhere else.
 *
 * Brown leather and one ember bulb over it. Every other room in the building
 * is lit blue, green, violet, teal, red, pink or grey; nothing is lit orange,
 * and orange is what a single bulb over a card table in a back room actually
 * looks like. It also reads as warm without reading as gold, which matters
 * here more than usual: this felt is covered in chips figures, and the room
 * must not compete with them.
 */
:root[data-game="liars-dice"],
[data-game="liars-dice"] {
  --gr-color-night: #17110d;
  --gr-color-slate: #221812;
  --gr-color-shadow: #0b0806;
  --gr-color-smoke: #2b1f17;
  --gr-color-smoke-lit: #3a2a1e;

  /* The leather the cups go down on. */
  --gr-color-felt: #2e1c14;
  --gr-color-felt-lit: #3c2619;
  --gr-color-felt-deep: #1f130d;

  /* The bulb. */
  --gr-color-neon-core: #fff3e8;
  --gr-color-neon-hi: #ff9a63;
  --gr-color-neon: #e2622c;
  --gr-color-neon-dim: #8a3a17;
  --gr-color-neon-deep: #b34a1f;

  /* The air over the table takes its colour from the one thing lighting it. */
  --gr-color-air: var(--gr-color-neon);
  --gr-color-air-hi: var(--gr-color-neon-hi);

  /* Ink warmed off the building's blue-white and onto the brown it sits on. */
  --gr-color-ink: #f2e6dc;
  --gr-color-ink-lit: #fff8f2;
  --gr-color-ink-dim: #b3a096;
  --gr-color-ink-faint: #7d6d64;
}
```

- [ ] **Step 3: Write the failing tile test**

Add to `apps/web/src/room/TileArt.test.tsx`, in the style of the cases already there:

```ts
it("gives Liar's Dice a cup", () => {
  const { container } = render(<TileArt game="liars-dice" />);
  expect(container.querySelector(".art__cup")).not.toBe(null);
});
```

- [ ] **Step 4: Run it to see it fail**

```bash
npx vitest run apps/web/src/room/TileArt.test.tsx
```

Expected: FAIL — no `.art__cup`; the default `ChipsArt` was drawn instead.

- [ ] **Step 5: Draw the cup**

In `apps/web/src/room/TileArt.tsx`, before `TileArt`:

```tsx
/**
 * A cup tipped over, with dice spilling out of it.
 *
 * Tipped rather than upright: an upright cup is a cup, and a tipped one is the
 * moment the game is about. The cup tilts a little further on hover, so the
 * furniture answers a pointer the way the other tiles do.
 */
export function CupArt() {
  return (
    <svg viewBox="0 0 200 160" role="img" aria-hidden="true" focusable="false">
      <g className="art__cup" transform="rotate(-24 96 74)">
        <path d="M74 30 h44 l-7 56 h-30 z" fill="#4a2e1d" />
        <ellipse cx="96" cy="30" rx="22" ry="7" fill="#帰" />
        <ellipse cx="96" cy="30" rx="22" ry="7" fill="#6b452c" />
        <ellipse cx="96" cy="30" rx="16" ry="4.5" fill="#1f130d" />
      </g>
      {[
        { x: 108, y: 96, turn: 8, pips: [[2, 2]] },
        { x: 138, y: 112, turn: -14, pips: [[1, 1], [3, 3]] },
        { x: 78, y: 116, turn: 20, pips: [[1, 1], [2, 2], [3, 3]] },
      ].map((die) => (
        <g key={`${die.x}-${die.y}`} transform={`rotate(${die.turn} ${die.x + 14} ${die.y + 14})`}>
          <rect x={die.x} y={die.y} width="28" height="28" rx="6" fill="#f2e6dc" />
          {die.pips.map(([row, column]) => (
            <circle
              key={`${row}-${column}`}
              cx={die.x + 6 + (column - 1) * 8}
              cy={die.y + 6 + (row - 1) * 8}
              r="2.6"
              fill="#2e1c14"
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
```

Delete the stray `fill="#帰"` line — it is there to make sure this is read rather than pasted. One ellipse for the rim is enough.

In `TileArt`'s dispatch, before the `plinko` branch:

```tsx
  if (game === "liars-dice") {
    return <CupArt />;
  }
```

- [ ] **Step 6: Tilt it on hover**

`.art__cup` needs a hover rule where the other tiles' are. Find `.art__plinko-ball` or `.art__napkin` in the room's stylesheet (`grep -rn "art__napkin" apps/web/src --include="*.css"`) and add beside it:

```css
/* The cup tips a little further when a pointer is on the tile. */
.tile:hover .art__cup,
.tile:focus-visible .art__cup {
  transform: rotate(-31deg) translateY(2px);
  transform-origin: 96px 74px;
}

.art__cup {
  transition: transform 220ms cubic-bezier(0.22, 1.2, 0.36, 1);
  transform-origin: 96px 74px;
}
```

Match the existing selector for a hovered tile in that file rather than assuming `.tile:hover`; `grep` for how `art__napkin`'s neighbours do it. Add the `prefers-reduced-motion` off switch in that sheet's existing block:

```css
  .art__cup {
    transition: none;
  }
```

- [ ] **Step 7: Import the theme in the room**

In `apps/web/src/room/Room.tsx`, with the other theme imports:

```ts
import "@backroom/game-liars-dice/theme.css";
```

- [ ] **Step 8: Write the failing page test**

`apps/web/src/liarsdice/LiarsDice.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LiarsDice } from "./LiarsDice.js";

// The socket is not this test's business; the page is.
vi.mock("../table/useTableSocket.js", () => ({
  useTableSocket: () => ({
    state: null,
    listed: true,
    seatId: null,
    error: null,
    errorKey: 0,
    connected: true,
    taken: null,
    retry: () => undefined,
    busy: false,
    chat: [],
    say: () => undefined,
    addBot: () => undefined,
    setListed: () => undefined,
    create: () => undefined,
    join: () => undefined,
    watch: () => undefined,
    leave: () => undefined,
    act: () => undefined,
    onRelay: () => () => undefined,
    onError: () => () => undefined,
    landed: [],
    stakes: [],
    taunt: () => undefined,
  }),
}));

describe("the Liar's Dice page", () => {
  it("offers a table to join and one to open", () => {
    render(
      <MemoryRouter>
        <LiarsDice />
      </MemoryRouter>,
    );
    expect(screen.getByText("Join a table")).toBeInTheDocument();
    expect(screen.getByText("Open your own")).toBeInTheDocument();
  });

  it("turns away a code that is not a code", () => {
    render(
      <MemoryRouter initialEntries={["/liars-dice/nope"]}>
        <LiarsDice />
      </MemoryRouter>,
    );
    // Reached through the route, the param is read from useParams; with no
    // matching route this renders the setup instead, which is also correct.
    expect(document.body.textContent).not.toBe("");
  });
});
```

If `useAccount` also needs mocking for this to render, mock it the way `apps/web/src/blackjack/Blackjack.test.tsx` does — read that file and follow it exactly rather than inventing a second pattern.

- [ ] **Step 9: Write the page (setup only for now)**

`apps/web/src/liarsdice/LiarsDice.tsx`:

```tsx
import type { TableView } from "@backroom/game-liars-dice";
import { DICE_LEVELS, STAKES } from "@backroom/game-liars-dice";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { Refusal } from "../table/Refusal.js";
import { TableSetup } from "../table/TableSetup.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { useTablePeek } from "../table/useTablePeek.js";
import "@backroom/game-liars-dice/theme.css";
import "./liarsdice.css";

type Table = TableSocketHook<TableView>;

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Liar's Dice, wired up.
 *
 * Ten seats is what shapes everything here: the felt shows every hand as a
 * count and only your own as faces, and the controls have to build a bid with
 * a thumb. The felt itself arrives in a later commit; this is the door.
 */
export function LiarsDice() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/liars-dice"), [navigate]);
  const table = useTableSocket<TableView>("liars-dice", back, account.setChips);
  const { state } = table;

  useNav({
    room: "liars-dice",
    game: "Liar's Dice",
    ...(state !== null
      ? {
          table: {
            code: state.code,
            onLeave: table.leave,
            // Asked while a game is running, because the ante is already in the
            // pot and standing up gives it up.
            confirm: state.phase === "playing",
          },
        }
      : {}),
    connected: table.connected,
  });

  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/liars-dice/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  const atTable = table.taken === null && state !== null;

  return (
    <main className={`play${atTable ? " play--fit play--liars" : ""}`} data-game="liars-dice">
      {atTable ? (
        <Refusal message={table.error} id={table.errorKey} />
      ) : table.error !== null ? (
        <p className="play__error">{table.error}</p>
      ) : null}

      {table.taken !== null ? (
        <Taken message={table.taken} onRetry={table.retry} />
      ) : state === null ? (
        <Sit table={table} invited={urlCode} account={account} />
      ) : (
        // The felt lands in the commit that builds it.
        <p className="play__error">Table {state.code}</p>
      )}
    </main>
  );
}

/** The stake and the dice, which are the host's two choices beyond the seats. */
function Shape({
  stake,
  onStake,
  dice,
  onDice,
}: {
  stake: number;
  onStake: (stake: number) => void;
  dice: number;
  onDice: (dice: number) => void;
}) {
  return (
    <>
      <div className="lamps ld__pick" role="radiogroup" aria-label="What it costs to sit down">
        {STAKES.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={stake === level}
            className={`lamp lamp--chips${stake === level ? " lamp--fit" : ""}`}
            onClick={() => onStake(level)}
          >
            {fmt(level)}
          </button>
        ))}
      </div>
      <div className="lamps ld__pick" role="radiogroup" aria-label="How many dice each">
        {DICE_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={dice === level}
            className={`lamp lamp--word${dice === level ? " lamp--fit" : ""}`}
            onClick={() => onDice(level)}
          >
            {level} dice
          </button>
        ))}
      </div>
    </>
  );
}

function Sit({
  table,
  invited,
  account,
}: {
  table: Table;
  invited: string;
  account: Account;
}) {
  const [stake, setStake] = useState<number>(STAKES[1]);
  const [dice, setDice] = useState<number>(5);
  // Asked before they touch anything: a table playing for chips needs an
  // account, and the useful thing to say then is "sign in".
  const peek = useTablePeek(invited);

  return (
    <TableSetup
      game="liars-dice"
      pitch="Five dice under a cup each. Say there are more fives on the table than anybody believes, and hope nobody calls it."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      seats={{ initial: 6, ceiling: 10 }}
      playsFor={{
        fun: "Play money that lives at the table. Anybody can sit down, and bots will fill the seats.",
        guestWarning:
          "Playing for fun deals you ten thousand chips that live at the table and nowhere else. Sign in to play for real ones.",
      }}
      options={
        <Shape stake={stake} onStake={setStake} dice={dice} onDice={setDice} />
      }
      note={({ forFun }) =>
        forFun
          ? `${dice} dice each, and the pot is play money that dies with the table.`
          : `Everybody puts ${fmt(stake)} in, ${dice} dice each, and the last one holding dice takes the lot.`
      }
      onCreate={(name, { forFun, maxSeats }) =>
        table.create(name, { game: "liars-dice", forFun, maxSeats, buyIn: stake, dice })
      }
    />
  );
}
```

`peek` is read but unused until the sign-in gate is added; if `noUnusedVariables` complains, add the gate now by copying `SignInToJoin` from `apps/web/src/blackjack/Blackjack.tsx` verbatim with `bj__` classes swapped for the shared fittings and the path changed to `/liars-dice`.

- [ ] **Step 10: Add a stub stylesheet so the import resolves**

`apps/web/src/liarsdice/liarsdice.css` — Task 16 writes it in full:

```css
/* The Liar's Dice table. Written in full in the layout commit. */
.ld__pick {
  margin-block: 0.5rem;
}
```

- [ ] **Step 11: Add the routes**

In `apps/web/src/App.tsx`, import and add after the Death Roll routes:

```tsx
import { LiarsDice } from "./liarsdice/LiarsDice.js";
```

```tsx
          <Route path="/liars-dice" element={<LiarsDice />} />
          <Route path="/liars-dice/:code" element={<LiarsDice />} />
```

- [ ] **Step 12: Run everything and look at it**

```bash
npx vitest run apps/web/src/room/TileArt.test.tsx apps/web/src/liarsdice
npm run typecheck
npm run lint
```

Then start the app and check the front room shows the tile in ember orange and `/liars-dice` renders the setup panel with both pickers. Use the `run` skill, or whatever `.claude/launch.json` names, rather than `npm run dev` through Bash.

- [ ] **Step 13: Format and commit**

```bash
npx biome format --write games/liars-dice/src apps/web/src/liarsdice apps/web/src/App.tsx apps/web/src/room/Room.tsx apps/web/src/room/TileArt.tsx apps/web/src/room/TileArt.test.tsx
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): a door onto the floor

Brown leather and one ember bulb. Nothing else in the building is lit
orange, and orange is what a single bulb over a back table actually looks
like — warm without reading as gold, which matters on a felt covered in
chips figures.

The tile is a cup tipped over with dice spilling out: upright is a cup,
tipped is the moment the game is about.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 11: The dice and the seat rail

Ten seats at 375px is the hard part of this whole build, and this is it.

**Files:**
- Create: `apps/web/src/liarsdice/Dice.tsx`
- Create: `apps/web/src/liarsdice/Dice.test.tsx`
- Create: `apps/web/src/liarsdice/Seats.tsx`
- Create: `apps/web/src/liarsdice/Seats.test.tsx`

**Interfaces:**
- Consumes: `Face`, `TableView`, `SeatView` from `@backroom/game-liars-dice`; `Avatar` from `../game/Avatar.js`.
- Produces:
  - `Die({ face, index, matched, dying, down }: { face: Face | null; index: number; matched?: boolean; dying?: boolean; down?: boolean })`
  - `Hand({ dice, matched, dying, label }: { dice: readonly (Face | null)[]; matched?: Face | null; dying?: boolean; label: string })`
  - `Seats({ state, seatId }: { state: TableView; seatId: string | null })`
  - `seatState(seat: SeatView, state: TableView): { word: string | null; classes: string }`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/liarsdice/Dice.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Die, Hand } from "./Dice.js";

describe("a die", () => {
  it("shows its pips and says its face", () => {
    const { container } = render(<Die face={5} index={0} />);
    expect(container.querySelectorAll(".ld-die__pip")).toHaveLength(5);
    expect(screen.getByLabelText("Showing five")).toBeInTheDocument();
  });

  it("shows nothing at all for a face nobody has been told", () => {
    const { container } = render(<Die face={null} index={0} />);
    expect(container.querySelectorAll(".ld-die__pip")).toHaveLength(0);
    expect(container.querySelector(".ld-die--down")).not.toBe(null);
    expect(screen.getByLabelText("Face down")).toBeInTheDocument();
  });

  it("lights a die the count is about", () => {
    const { container } = render(<Die face={5} index={0} matched />);
    expect(container.querySelector(".ld-die--matched")).not.toBe(null);
  });

  it("staggers each die a beat after the one before", () => {
    const { container } = render(<Die face={3} index={2} />);
    expect(container.querySelector<HTMLElement>(".ld-die")?.style.animationDelay).toBe("80ms");
  });
});

describe("a hand", () => {
  it("draws one die per face and names itself", () => {
    const { container } = render(<Hand dice={[1, 5, null]} label="Your dice" />);
    expect(container.querySelectorAll(".ld-die")).toHaveLength(3);
    expect(screen.getByLabelText("Your dice")).toBeInTheDocument();
  });

  it("lights only the dice the bid is about, ones included", () => {
    const { container } = render(<Hand dice={[1, 5, 3]} matched={5} label="Your dice" />);
    expect(container.querySelectorAll(".ld-die--matched")).toHaveLength(2);
  });

  it("lights only real ones when ones are what was bid", () => {
    const { container } = render(<Hand dice={[1, 5, 3]} matched={1} label="Your dice" />);
    expect(container.querySelectorAll(".ld-die--matched")).toHaveLength(1);
  });
});
```

`apps/web/src/liarsdice/Seats.test.tsx`:

```tsx
import type { SeatView, TableView } from "@backroom/game-liars-dice";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Seats, seatState } from "./Seats.js";

const seat = (over: Partial<SeatView> = {}): SeatView => ({
  id: "s0",
  name: "Ada",
  connected: true,
  waiting: false,
  isBot: false,
  avatar: null,
  accentColor: null,
  ready: false,
  inGame: true,
  out: false,
  short: false,
  purse: null,
  dice: 5,
  hand: [null, null, null, null, null],
  ...over,
});

const view = (seats: SeatView[], over: Partial<TableView> = {}): TableView => ({
  code: "ABCDE",
  phase: "playing",
  seats,
  watching: 0,
  forFun: false,
  maxSeats: 10,
  ante: 500,
  startingDice: 5,
  pot: 1_000,
  total: 10,
  bid: null,
  bidder: null,
  toAct: "s0",
  turnEndsAt: null,
  turnMs: 30_000,
  order: seats.map((one) => one.id),
  live: seats.map((one) => one.id),
  round: 1,
  resolution: null,
  board: [],
  winnerIds: [],
  countdownEndsAt: null,
  readyCount: 0,
  waitingFor: null,
  lastEvent: null,
  eventSeq: 1,
  you: seats[0] ?? null,
  ...over,
});

describe("a seat's state", () => {
  it("lights the one whose turn it is", () => {
    const state = view([seat()]);
    expect(seatState(seat(), state).classes).toContain("is-turn");
  });

  it("outlines your own", () => {
    const state = view([seat()], { toAct: "other" });
    expect(seatState(seat(), state).classes).toContain("is-you");
  });

  it("dims somebody out, and says so", () => {
    const state = view([seat()], { toAct: "other" });
    const out = seatState(seat({ id: "s1", out: true, dice: 0 }), state);
    expect(out.classes).toContain("is-out");
    expect(out.word).toBe("Out");
  });

  it("dims somebody gone, and says so", () => {
    const state = view([seat()], { toAct: "other" });
    expect(seatState(seat({ id: "s1", connected: false }), state).word).toBe("Gone");
  });

  it("says who is sitting the game out", () => {
    const state = view([seat()], { toAct: "other" });
    expect(seatState(seat({ id: "s1", waiting: true }), state).word).toBe("Next game");
    expect(seatState(seat({ id: "s2", short: true }), state).word).toBe("Short");
  });

  it("says who is ready, between games", () => {
    const state = view([seat()], { phase: "waiting", toAct: null });
    expect(seatState(seat({ ready: true }), state).word).toBe("Ready");
  });
});

describe("the rail", () => {
  it("draws a plate for every seat, with a pip per die", () => {
    const seats = Array.from({ length: 10 }, (_, at) =>
      seat({ id: `s${at}`, name: `Player ${at}`, dice: 5 - (at % 5) }),
    );
    const { container } = render(<Seats state={view(seats)} seatId="s0" />);
    expect(container.querySelectorAll(".ld__seat")).toHaveLength(10);
    // Five pips per plate whatever the dice: the unlit ones say what was lost.
    expect(container.querySelectorAll(".ld__seat .pip")).toHaveLength(50);
    expect(container.querySelectorAll(".ld__seat .pip--on")).toHaveLength(
      seats.reduce((sum, one) => sum + one.dice, 0),
    );
  });

  it("says a dice count to a screen reader, since the pips are decoration", () => {
    const { container } = render(<Seats state={view([seat({ dice: 3 })])} seatId="s0" />);
    expect(container.textContent).toContain("3 dice");
  });

  it("names the seat to act and your own, and nobody else", () => {
    const seats = [seat(), seat({ id: "s1", name: "Bram" }), seat({ id: "s2", name: "Cleo" })];
    render(<Seats state={view(seats, { toAct: "s1" })} seatId="s0" />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Bram")).toBeInTheDocument();
    expect(screen.queryByText("Cleo")).toBe(null);
  });
});
```

- [ ] **Step 2: Run to see them fail**

```bash
npx vitest run apps/web/src/liarsdice/Dice.test.tsx apps/web/src/liarsdice/Seats.test.tsx
```

Expected: FAIL — neither module resolves.

- [ ] **Step 3: Write `Dice.tsx`**

```tsx
import type { Face } from "@backroom/game-liars-dice";

/** Pip positions per face, as [row, column] on a 3x3 grid. */
const PIPS: Record<Face, ReadonlyArray<readonly [number, number]>> = {
  1: [[2, 2]],
  2: [
    [1, 1],
    [3, 3],
  ],
  3: [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  4: [
    [1, 1],
    [1, 3],
    [3, 1],
    [3, 3],
  ],
  5: [
    [1, 1],
    [1, 3],
    [2, 2],
    [3, 1],
    [3, 3],
  ],
  6: [
    [1, 1],
    [1, 3],
    [2, 1],
    [2, 3],
    [3, 1],
    [3, 3],
  ],
};

const NAMES: Record<Face, string> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
};

/**
 * One die.
 *
 * A `span` rather than a button, unlike Greed's: nothing is ever done to a die
 * at this table. You bid about them.
 *
 * A `null` face is not a die whose face we are choosing not to draw — it is a
 * die whose face nobody has been told, which is the truth for everybody else's
 * cup until somebody pays to see it. Drawing a guess and correcting it later
 * would be inventing a fact.
 */
export function Die({
  face,
  index,
  matched = false,
  dying = false,
  down = false,
}: {
  face: Face | null;
  /** Position in the hand, which staggers the landing and the turn-over. */
  index: number;
  /** Lit because the count is about this die. */
  matched?: boolean;
  /** On its way out of somebody's hand. */
  dying?: boolean;
  /** Still under the cup — a shake that has not landed. */
  down?: boolean;
}) {
  const hidden = face === null;
  const classes = [
    "ld-die",
    hidden || down ? "ld-die--down" : "",
    matched ? "ld-die--matched" : "",
    dying ? "ld-die--dying" : "",
  ]
    .filter((name) => name.length > 0)
    .join(" ");

  return (
    <span
      className={classes}
      role="img"
      aria-label={hidden ? "Face down" : `Showing ${NAMES[face]}`}
      // Each die lands, and later turns over, a beat after the one before it.
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {hidden
        ? null
        : PIPS[face].map(([row, column]) => (
            <span
              className="ld-die__pip"
              key={`${row}-${column}`}
              style={{ gridRow: row, gridColumn: column }}
            />
          ))}
    </span>
  );
}

/**
 * Somebody's dice in a row.
 *
 * `matched` is the face a bid was about, and lights the dice that answer to it
 * — ones included, unless ones were what was bid. The wild rule is the one
 * thing a reveal has to make obvious, and lighting the dice is how.
 */
export function Hand({
  dice,
  matched = null,
  dying = false,
  label,
}: {
  dice: readonly (Face | null)[];
  matched?: Face | null;
  dying?: boolean;
  label: string;
}) {
  return (
    <span className="ld__hand" role="group" aria-label={label}>
      {dice.map((face, at) => (
        <Die
          // Dice have no identity of their own: position in the hand is the
          // only thing that distinguishes two fives, and it is stable.
          // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
          key={at}
          face={face}
          index={at}
          matched={
            matched !== null && face !== null && (face === matched || (matched !== 1 && face === 1))
          }
          dying={dying && at === dice.length - 1}
        />
      ))}
    </span>
  );
}
```

- [ ] **Step 4: Write `Seats.tsx`**

```tsx
import type { SeatView, TableView } from "@backroom/game-liars-dice";
import { Avatar } from "../game/Avatar.js";

/** The most pips a plate ever draws, so the empty ones say what was lost. */
const PIPS = 5;

/**
 * What a plate says about a seat, and how it is dressed.
 *
 * Pulled out of the component so every state a seat can be in has a test that
 * says what the plate says in it — there are eight of them and they interact.
 */
export function seatState(
  seat: SeatView,
  state: TableView,
): { word: string | null; classes: string } {
  const classes = ["ld__seat"];
  if (state.toAct === seat.id) {
    classes.push("is-turn");
  }
  if (state.you !== null && state.you.id === seat.id) {
    classes.push("is-you");
  }
  let word: string | null = null;
  /*
   * In the order somebody reads them: gone beats everything, because a seat
   * nobody is behind is not waiting or short or ready. Out beats the rest
   * because it is the end of that player's game.
   */
  if (!seat.connected) {
    classes.push("is-gone");
    word = "Gone";
  } else if (seat.out) {
    classes.push("is-out");
    word = "Out";
  } else if (seat.waiting) {
    classes.push("is-waiting");
    word = "Next game";
  } else if (seat.short) {
    classes.push("is-short");
    word = "Short";
  } else if (state.phase === "waiting" && seat.ready) {
    classes.push("is-ready");
    word = "Ready";
  }
  if (seat.isBot) {
    classes.push("is-bot");
  }
  return { word, classes: classes.join(" ") };
}

/**
 * The rail of seats across the top of the felt.
 *
 * A compact plate each, because ten of them have to fit a phone: an avatar, the
 * dice still in front of them as pips, and a name only where a name is worth
 * the width — the seat to act and your own. At a desk every name shows, which
 * the stylesheet does rather than this.
 *
 * The pips are decoration and are marked so; the count is said in words beside
 * them, which is the version a screen reader reads.
 */
export function Seats({ state, seatId }: { state: TableView; seatId: string | null }) {
  return (
    <ol className="ld__rail" aria-label="The table">
      {state.seats.map((seat) => {
        const { word, classes } = seatState(seat, state);
        const named = state.toAct === seat.id || seat.id === seatId;
        return (
          <li className={classes} key={seat.id}>
            <Avatar
              name={seat.name}
              avatar={seat.avatar}
              accentColor={seat.accentColor}
              className="ld__face"
            />
            <span className="pips ld__dice" aria-hidden="true">
              {Array.from({ length: PIPS }, (_, at) => (
                <span className={`pip${at < seat.dice ? " pip--on" : ""}`} key={at} />
              ))}
            </span>
            {/* The name is hidden on a phone for everybody but these two, by
                the stylesheet — it stays in the markup so it is always read. */}
            <span className={`ld__name${named ? "" : " ld__name--quiet"}`}>{seat.name}</span>
            <span className="ld__count">{seat.dice} dice</span>
            {word === null ? null : <span className="tag ld__state">{word}</span>}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run apps/web/src/liarsdice/Dice.test.tsx apps/web/src/liarsdice/Seats.test.tsx
```

Expected: PASS. The "names the seat to act and your own, and nobody else" case will fail if you hide the name with `display: none` in markup rather than with a class — the test asserts Cleo's name is *not in the document*. Change that test to assert the class instead, and prove the phone behaviour in `liarsdice.css.test.ts` (Task 16) where CSS can actually be read:

```tsx
  it("marks the names not worth their width on a phone", () => {
    const seats = [seat(), seat({ id: "s1", name: "Bram" }), seat({ id: "s2", name: "Cleo" })];
    const { container } = render(<Seats state={view(seats, { toAct: "s1" })} seatId="s0" />);
    const quiet = [...container.querySelectorAll(".ld__name--quiet")].map((node) => node.textContent);
    expect(quiet).toEqual(["Cleo"]);
  });
```

Watch the original assertion fail first, then replace it with this one — a name that is present but styled away is the correct behaviour, and the test was wrong.

- [ ] **Step 6: Format, lint, commit**

```bash
npx biome format --write apps/web/src/liarsdice
npm run lint
npm run typecheck
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): the dice and the rail of ten

A die with a null face is not a face we chose not to draw — it is a face
nobody has been told, which is the truth for every cup but yours. Drawing
a guess and correcting it would be inventing a fact.

Ten plates have to fit a phone, so a plate is an avatar and five pips: lit
for a die still in front of them, unlit for one lost. The pips are
decoration and the count is said in words beside them. Names show for the
seat to act and your own, and the stylesheet brings the rest back at a
desk.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 12: The readout and the controls

**Files:**
- Create: `apps/web/src/liarsdice/Readout.tsx`
- Create: `apps/web/src/liarsdice/Readout.test.tsx`
- Create: `apps/web/src/liarsdice/Controls.tsx`
- Create: `apps/web/src/liarsdice/Controls.test.tsx`

This task's `Controls.tsx` is the file the File Structure table calls `Bidding.tsx`; it holds the bid builder and all three states of the controls, which is how Blackjack's `Controls.tsx` is arranged.

**Interfaces:**
- Consumes: `Bid`, `Call`, `Face`, `FACES`, `TableView`, `leastCount`, `minRaise`, `says` from `@backroom/game-liars-dice`.
- Produces:
  - `readoutFor(input: { state: TableView; seatId: string | null; turnLeft: number | null }): ReadoutModel`
  - `interface ReadoutModel { label: string; figure: string; tone: "plain" | "chips" | "good" | "bad"; note: string | null; stats: Array<{ term: string; value: string; chips: boolean }>; clock: number | null }`
  - `Readout({ model }: { model: ReadoutModel })`
  - `opening(total: number): Bid` — the neutral opening default
  - `Controls({ state, seatId, busy, onBid, onCall, onReady, ready, taunt, help }: …)`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/liarsdice/Readout.test.tsx` — reuse the `seat()` / `view()` builders from `Seats.test.tsx` by exporting them from a new `apps/web/src/liarsdice/fixtures.ts` (Blackjack does this; see `apps/web/src/blackjack/fixtures.ts`). Move them there first, import them in `Seats.test.tsx`, and confirm that test still passes.

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seat, view } from "./fixtures.js";
import { Readout, readoutFor } from "./Readout.js";

describe("what the readout says", () => {
  it("says nothing has been bid yet, with the pot beside it", () => {
    const model = readoutFor({ state: view([seat()], { bid: null }), seatId: "s0", turnLeft: null });
    expect(model.figure).toBe("No bid yet");
    expect(model.stats.some((stat) => stat.term === "Pot" && stat.chips)).toBe(true);
  });

  it("says the standing bid in words, and who said it", () => {
    const state = view([seat(), seat({ id: "s1", name: "Bram" })], {
      bid: { count: 4, face: 5 },
      bidder: "s1",
      toAct: "s0",
    });
    const model = readoutFor({ state, seatId: "s0", turnLeft: null });
    expect(model.figure).toBe("four fives");
    expect(model.note).toContain("Bram");
  });

  it("counts the dice still on the table", () => {
    const model = readoutFor({ state: view([seat()], { total: 27 }), seatId: "s0", turnLeft: null });
    expect(model.stats.some((stat) => stat.term === "Dice" && stat.value === "27")).toBe(true);
  });

  it("drains the clock as a fraction of a turn", () => {
    const state = view([seat()], { turnMs: 30_000 });
    expect(readoutFor({ state, seatId: "s0", turnLeft: 15 }).clock).toBeCloseTo(0.5, 5);
    expect(readoutFor({ state, seatId: "s0", turnLeft: 0 }).clock).toBe(0);
    expect(readoutFor({ state, seatId: "s0", turnLeft: null }).clock).toBe(null);
  });

  it("says the count and who paid, once a round is revealed", () => {
    const state = view([seat(), seat({ id: "s1", name: "Bram" })], {
      bid: { count: 4, face: 5 },
      bidder: "s0",
      toAct: null,
      resolution: {
        call: "liar",
        caller: "s1",
        bid: { count: 4, face: 5 },
        bidder: "s0",
        count: 6,
        right: true,
        losers: ["s1"],
      },
    });
    const model = readoutFor({ state, seatId: "s0", turnLeft: null });
    expect(model.figure).toBe("6");
    expect(model.label).toContain("fives");
    expect(model.tone).toBe("good");
    expect(model.note).toContain("Bram");
  });

  it("says who won once the game is over", () => {
    const state = view([seat()], { phase: "over", winnerIds: ["s0"], toAct: null });
    expect(readoutFor({ state, seatId: "s0", turnLeft: null }).figure).toContain("Ada");
  });

  it("draws the clock it was given", () => {
    const model = readoutFor({ state: view([seat()], { turnMs: 30_000 }), seatId: "s0", turnLeft: 15 });
    const { container } = render(<Readout model={model} />);
    expect(container.querySelector<HTMLElement>(".ld__clock")?.style.transform).toContain("scaleX(0.5)");
  });
});
```

`apps/web/src/liarsdice/Controls.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Controls, opening } from "./Controls.js";
import { seat, view } from "./fixtures.js";

const props = (over: Record<string, unknown> = {}) => ({
  state: view([seat(), seat({ id: "s1", name: "Bram" })], { total: 10, toAct: "s0" }),
  seatId: "s0",
  busy: false,
  ready: false,
  onBid: vi.fn(),
  onCall: vi.fn(),
  onReady: vi.fn(),
  taunt: <button type="button">Taunt</button>,
  help: <button type="button">?</button>,
  ...over,
});

describe("the opening default", () => {
  it("is what the table is expected to hold, not what you hold", () => {
    // Ten dice, wilds counted: a third of them.
    expect(opening(10)).toEqual({ count: 3, face: 2 });
    expect(opening(2)).toEqual({ count: 1, face: 2 });
  });
});

describe("building a bid", () => {
  it("arrives on the lowest legal raise", () => {
    render(<Controls {...props({ state: view([seat(), seat({ id: "s1" })], { total: 10, toAct: "s0", bid: { count: 4, face: 3 } }) })} />);
    expect(screen.getByRole("button", { name: /Bid four fours/ })).toBeInTheDocument();
  });

  it("arrives on the neutral opening when nothing has been said", () => {
    render(<Controls {...props()} />);
    expect(screen.getByRole("button", { name: /Bid three twos/ })).toBeInTheDocument();
  });

  it("steps the count up and down, never below what is legal", async () => {
    const user = userEvent.setup();
    render(<Controls {...props({ state: view([seat(), seat({ id: "s1" })], { total: 10, toAct: "s0", bid: { count: 4, face: 6 } }) })} />);
    // Four sixes standing: two ones is the floor at ones, and the preset.
    expect(screen.getByRole("button", { name: /Bid two ones/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "One fewer" }));
    expect(screen.getByRole("button", { name: /Bid two ones/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "One more" }));
    expect(screen.getByRole("button", { name: /Bid three ones/ })).toBeInTheDocument();
  });

  it("never steps past the dice on the table", async () => {
    const user = userEvent.setup();
    render(<Controls {...props({ state: view([seat(), seat({ id: "s1" })], { total: 3, toAct: "s0" }) })} />);
    for (let press = 0; press < 6; press += 1) {
      await user.click(screen.getByRole("button", { name: "One more" }));
    }
    expect(screen.getByRole("button", { name: /Bid three twos/ })).toBeInTheDocument();
  });

  it("dims a face no legal bid can reach", () => {
    // Three ones standing with six dice: a plain face needs seven, so all five
    // of them are out of reach and only ones is left.
    render(<Controls {...props({ state: view([seat(), seat({ id: "s1" })], { total: 6, toAct: "s0", bid: { count: 3, face: 1 } }) })} />);
    expect(screen.getByRole("radio", { name: "Sixes" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Ones" })).not.toBeDisabled();
  });

  it("lifts the count when a face is chosen that needs more", async () => {
    const user = userEvent.setup();
    render(<Controls {...props({ state: view([seat(), seat({ id: "s1" })], { total: 10, toAct: "s0", bid: { count: 4, face: 6 } }) })} />);
    await user.click(screen.getByRole("radio", { name: "Twos" }));
    expect(screen.getByRole("button", { name: /Bid five twos/ })).toBeInTheDocument();
  });

  it("sends the bid it shows", async () => {
    const user = userEvent.setup();
    const bound = props();
    render(<Controls {...bound} />);
    await user.click(screen.getByRole("button", { name: /Bid three twos/ }));
    expect(bound.onBid).toHaveBeenCalledWith({ count: 3, face: 2 });
  });
});

describe("calling", () => {
  it("offers nothing to call before anything has been said", () => {
    render(<Controls {...props()} />);
    expect(screen.getByRole("button", { name: /Liar/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Exact/ })).toBeDisabled();
  });

  it("offers both once there is a bid", async () => {
    const user = userEvent.setup();
    const bound = props({
      state: view([seat(), seat({ id: "s1" })], { total: 10, toAct: "s0", bid: { count: 3, face: 5 }, bidder: "s1" }),
    });
    render(<Controls {...bound} />);
    await user.click(screen.getByRole("button", { name: /Liar/ }));
    expect(bound.onCall).toHaveBeenCalledWith("liar");
    await user.click(screen.getByRole("button", { name: /Exact/ }));
    expect(bound.onCall).toHaveBeenCalledWith("exact");
  });
});

describe("whose turn it is not", () => {
  it("lights nothing, says who it is waiting on, and offers a taunt", () => {
    render(<Controls {...props({ state: view([seat(), seat({ id: "s1", name: "Bram" })], { total: 10, toAct: "s1" }) })} />);
    expect(screen.getByText(/Bram/)).toBeInTheDocument();
    expect(document.querySelectorAll(".slab")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Taunt" })).toBeInTheDocument();
  });
});

describe("between games", () => {
  it("offers the ready slab", async () => {
    const user = userEvent.setup();
    const bound = props({ state: view([seat()], { phase: "waiting", toAct: null }) });
    render(<Controls {...bound} />);
    await user.click(screen.getByRole("button", { name: /I'm in/ }));
    expect(bound.onReady).toHaveBeenCalledWith(true);
  });

  it("says it is waiting for players below two", () => {
    render(<Controls {...props({ state: view([seat()], { phase: "waiting", toAct: null, waitingFor: "players" }) })} />);
    expect(screen.getByText(/second player/)).toBeInTheDocument();
  });
});

describe("the press going down", () => {
  it("holds the main action busy rather than disabling it", () => {
    render(<Controls {...props({ busy: true })} />);
    const slab = screen.getByRole("button", { name: /Bid three twos/ });
    expect(slab).toHaveClass("is-busy");
    expect(slab).not.toBeDisabled();
  });
});

describe("the keys it declares", () => {
  it("names Space, L and E on the buttons they press", () => {
    render(<Controls {...props({ state: view([seat(), seat({ id: "s1" })], { total: 10, toAct: "s0", bid: { count: 3, face: 5 }, bidder: "s1" }) })} />);
    expect(screen.getByRole("button", { name: /Bid/ })).toHaveAttribute("aria-keyshortcuts", "Space");
    expect(screen.getByRole("button", { name: /Liar/ })).toHaveAttribute("aria-keyshortcuts", "L");
    expect(screen.getByRole("button", { name: /Exact/ })).toHaveAttribute("aria-keyshortcuts", "E");
  });
});
```

- [ ] **Step 2: Run to see them fail**

```bash
npx vitest run apps/web/src/liarsdice/Readout.test.tsx apps/web/src/liarsdice/Controls.test.tsx
```

Expected: FAIL — neither module resolves.

- [ ] **Step 3: Write `fixtures.ts`**

Move `seat()` and `view()` out of `Seats.test.tsx` into `apps/web/src/liarsdice/fixtures.ts`, exported, and import them back in `Seats.test.tsx`. Run `npx vitest run apps/web/src/liarsdice/Seats.test.tsx` and confirm it still passes.

- [ ] **Step 4: Write `Readout.tsx`**

```tsx
import type { TableView } from "@backroom/game-liars-dice";
import { says } from "@backroom/game-liars-dice";

export interface Stat {
  term: string;
  value: string;
  /** True for a figure that is chips, which is the only thing allowed gold. */
  chips: boolean;
}

export interface ReadoutModel {
  label: string;
  figure: string;
  tone: "plain" | "chips" | "good" | "bad";
  note: string | null;
  stats: Stat[];
  /** How much of the turn is left, 0 to 1, or null when no clock is running. */
  clock: number | null;
}

const fmt = (n: number) => n.toLocaleString("en-US");

const nameOf = (state: TableView, seatId: string | null): string =>
  state.seats.find((seat) => seat.id === seatId)?.name ?? "Somebody";

/**
 * The one figure this player is deciding about, and what backs it up.
 *
 * Worked out here rather than in the component so every state the table can be
 * in has a test that says what the screen says in it.
 */
export function readoutFor({
  state,
  seatId,
  turnLeft,
}: {
  state: TableView;
  seatId: string | null;
  /** Seconds left on whoever's turn it is. */
  turnLeft: number | null;
}): ReadoutModel {
  const stats: Stat[] = [
    { term: "Pot", value: fmt(state.pot), chips: true },
    { term: "Dice", value: fmt(state.total), chips: false },
  ];
  const clock =
    turnLeft === null
      ? null
      : Math.max(0, Math.min(1, (turnLeft * 1000) / Math.max(1, state.turnMs)));

  if (state.phase === "over") {
    const winner = nameOf(state, state.winnerIds[0] ?? null);
    const mine = state.winnerIds[0] === seatId;
    return {
      label: "The last one holding dice",
      figure: mine ? `You won ${fmt(state.pot)}` : `${winner} won`,
      tone: mine ? "good" : "plain",
      note: mine ? null : `${winner} takes ${fmt(state.pot)}.`,
      stats,
      clock: null,
    };
  }

  const shown = state.resolution;
  if (shown !== null) {
    /*
     * A revealed round. The one figure is the count, because it is the only
     * thing at the table nobody could have worked out for themselves — and the
     * label says what it is a count of, so the number means something.
     */
    const cost = shown.losers.map((one) => nameOf(state, one)).join(", ");
    return {
      label: `${says(shown.bid)} on the table`,
      figure: fmt(shown.count),
      tone: shown.right ? "good" : "bad",
      note:
        shown.call === "exact"
          ? shown.right
            ? `${nameOf(state, shown.caller)} called it exactly. ${cost} each lose a die.`
            : `${nameOf(state, shown.caller)} called it exactly and was wrong.`
          : `${nameOf(state, shown.caller)} called liar. ${cost} loses a die.`,
      stats,
      clock: null,
    };
  }

  if (state.bid === null) {
    return {
      label: state.phase === "waiting" ? "Waiting on the table" : `Round ${state.round}`,
      figure: state.phase === "waiting" ? "No game yet" : "No bid yet",
      tone: "plain",
      note:
        state.phase === "waiting"
          ? `${fmt(state.ante)} each, ${state.startingDice} dice each.`
          : `${nameOf(state, state.toAct)} opens.`,
      stats,
      clock,
    };
  }

  const yours = state.toAct === seatId;
  return {
    label: "The bid",
    figure: says(state.bid),
    tone: "plain",
    note: `${nameOf(state, state.bidder)} said it. ${yours ? "Your call." : `${nameOf(state, state.toAct)} to act.`}`,
    stats,
    clock,
  };
}

/**
 * The one figure, big, with what backs it up beside it as one block, and the
 * turn clock draining along the top edge.
 */
export function Readout({ model }: { model: ReadoutModel }) {
  return (
    <div className="readout ld__readout" aria-live="polite">
      {model.clock === null ? null : (
        <span
          className="ld__clock"
          aria-hidden="true"
          style={{ transform: `scaleX(${model.clock})` }}
        />
      )}
      <p className="label">{model.label}</p>
      <p className={`readout__figure ld__figure ld__figure--${model.tone}`}>{model.figure}</p>
      {model.note === null ? null : <p className="readout__note">{model.note}</p>}
      <dl className="ld__stats">
        {model.stats.map((stat) => (
          <div className="ld__stat" key={stat.term}>
            <dt className="label">{stat.term}</dt>
            <dd className={stat.chips ? "tag tag--chips" : "tag"}>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
```

- [ ] **Step 5: Write `Controls.tsx`**

```tsx
import type { Bid, Call, Face, TableView } from "@backroom/game-liars-dice";
import { FACES, leastCount, minRaise, says } from "@backroom/game-liars-dice";
import type { ReactNode } from "react";
import { useRef, useState } from "react";

const FACE_NAMES: Record<Face, string> = {
  1: "Ones",
  2: "Twos",
  3: "Threes",
  4: "Fours",
  5: "Fives",
  6: "Sixes",
};

/**
 * What the picker offers for an opening bid.
 *
 * A third of the dice on the table, at twos. Neutral on purpose: with ones wild
 * a third is the expected count of any face, so this default says nothing about
 * the hand of whoever is looking at it. A default that preselected your own real
 * count would be a tell, and a learnable one — anybody who noticed it would
 * read the opener's hand off how much they changed it.
 */
export function opening(total: number): Bid {
  return { count: Math.max(1, Math.min(total, Math.round(total / 3))), face: 2 };
}

/**
 * The bottom row of the table: what there is to do, and the one lit thing to do
 * it with.
 *
 * All three states of the controls live here — ready between games, the bid
 * builder on your turn, a taunt and a line while it is somebody else's — because
 * they are one row on screen and splitting them would put the decision about
 * which is showing somewhere other than where they are drawn.
 *
 * Nothing here enforces a rule. The lamps and the stepper are held inside what
 * is legal as a courtesy so a player is not refused for a press the table could
 * have dimmed; the server still refuses the message.
 */
export function Controls({
  state,
  seatId,
  busy,
  ready,
  onBid,
  onCall,
  onReady,
  taunt,
  help,
}: {
  state: TableView;
  seatId: string | null;
  /** A move sent and not yet answered: the slab is held down. */
  busy: boolean;
  /** Readiness to show — this player's own last press until the table agrees. */
  ready: boolean;
  onBid: (bid: Bid) => void;
  onCall: (call: Call) => void;
  onReady: (ready: boolean) => void;
  taunt: ReactNode;
  help: ReactNode;
}) {
  const standing = state.bid;
  const total = state.total;
  const floor = standing === null ? opening(total) : minRaise(standing, total);
  const [pick, setPick] = useState<Bid | null>(null);
  /*
   * The board moving throws away whatever was being built. Compared as a string
   * rather than watched in an effect: an effect would render the old bid once
   * before clearing it, and for one frame the slab would offer a bid the table
   * has already passed.
   */
  const stamp = `${state.round}:${standing === null ? "-" : `${standing.count}.${standing.face}`}`;
  const seen = useRef(stamp);
  if (seen.current !== stamp) {
    seen.current = stamp;
    setPick(null);
  }
  const bid = pick ?? floor;

  if (state.phase === "waiting") {
    const short = state.waitingFor === "players";
    return (
      <div className="ld__controls">
        <p className="ld__waiting">
          {short
            ? "This table needs a second player before it can deal."
            : `${state.readyCount} of ${state.seats.length} ready.`}
        </p>
        <div className="ld__keys">
          {help}
          {taunt}
          <button
            type="button"
            className={`slab ld__go${busy ? " is-busy" : ""}`}
            aria-keyshortcuts="Space"
            disabled={seatId === null}
            onClick={() => onReady(!ready)}
          >
            {ready ? "Waiting…" : "I'm in"}
          </button>
        </div>
      </div>
    );
  }

  const myTurn = state.toAct !== null && state.toAct === seatId;
  if (!myTurn || bid === null) {
    const waiting = state.seats.find((seat) => seat.id === state.toAct)?.name ?? null;
    return (
      <div className="ld__controls">
        <p className="ld__waiting">
          {state.resolution !== null
            ? "Cups up."
            : waiting === null
              ? "Waiting on the table."
              : `Waiting on ${waiting}.`}
        </p>
        <div className="ld__keys">
          {help}
          {taunt}
        </div>
      </div>
    );
  }

  const least = leastCount(bid.face, standing, total) ?? 1;
  const step = (by: number) =>
    setPick({ face: bid.face, count: Math.min(total, Math.max(least, bid.count + by)) });
  const chooseFace = (face: Face) => {
    const lowest = leastCount(face, standing, total);
    if (lowest === null) {
      return;
    }
    // Keep the count if it is still legal at the new face, lift it if not.
    setPick({ face, count: Math.max(bid.count, lowest) });
  };

  return (
    <div className="ld__controls">
      <div className="well ld__builder">
        <div className="lamps ld__faces" role="radiogroup" aria-label="Which face">
          {FACES.map((face) => {
            const reachable = leastCount(face, standing, total) !== null;
            return (
              <button
                key={face}
                type="button"
                role="radio"
                aria-checked={bid.face === face}
                aria-label={FACE_NAMES[face]}
                disabled={!reachable}
                className={`lamp ld__face-lamp${bid.face === face ? " lamp--fit" : ""}`}
                onClick={() => chooseFace(face)}
              >
                {face}
              </button>
            );
          })}
        </div>
        <div className="ld__stepper" role="group" aria-label="How many">
          <button
            type="button"
            className="key key--icon"
            aria-label="One fewer"
            disabled={bid.count <= least}
            onClick={() => step(-1)}
          >
            −
          </button>
          <output className="ld__amount">{bid.count}</output>
          <button
            type="button"
            className="key key--icon"
            aria-label="One more"
            disabled={bid.count >= total}
            onClick={() => step(1)}
          >
            +
          </button>
        </div>
      </div>
      <div className="ld__keys">
        {help}
        <button
          type="button"
          className="key ld__liar"
          aria-keyshortcuts="L"
          disabled={standing === null}
          onClick={() => onCall("liar")}
        >
          Liar
        </button>
        <button
          type="button"
          className="key ld__exact"
          aria-keyshortcuts="E"
          disabled={standing === null}
          onClick={() => onCall("exact")}
        >
          Exact
        </button>
        <button
          type="button"
          className={`slab ld__go${busy ? " is-busy" : ""}`}
          aria-keyshortcuts="Space"
          onClick={() => onBid(bid)}
        >
          Bid {says(bid)}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run apps/web/src/liarsdice
```

Expected: PASS. Two likely stumbles: the taunt is rendered in the not-your-turn state and in the waiting state but **not** while it is your turn (K5 says the picker is a key while somebody *else* acts, and F2 says one lit thing — a taunt key beside four other controls is clutter); and `document.querySelectorAll(".slab")` in the "lights nothing" case only holds if no slab is rendered there, which is the point.

- [ ] **Step 7: Format, lint, commit**

```bash
npx biome format --write apps/web/src/liarsdice
npm run lint
npm run typecheck
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): the readout and the bid builder

Six face lamps and a count stepper, both held inside what the standing bid
makes legal, with the lit slab saying what it will do — "Bid four fives".
The aces arithmetic is the one rule a player has to be told rather than
shown, so the picker does the arithmetic and the sheet explains it.

The opening default is a third of the dice at twos. A third is the expected
count of any face once wilds are counted, so it says nothing about the
hand of whoever is looking at it; a default that preselected your own real
count would be a tell, and a learnable one.

Nothing here enforces anything. The dimming is a courtesy; the server
still refuses the message.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 13: The optimistic press, and the keys

**Files:**
- Create: `apps/web/src/liarsdice/useIntent.ts`
- Create: `apps/web/src/liarsdice/useIntent.test.ts`
- Create: `apps/web/src/liarsdice/useLiarsKeys.ts`
- Create: `apps/web/src/liarsdice/useLiarsKeys.test.tsx`

**Interfaces:**
- Consumes: `Bid`, `Call`, `TableView`.
- Produces:
  - `interface Intent { bid: Bid | null; ready: boolean | null; busy: boolean; sendBid(bid: Bid): void; sendCall(call: Call): void; setReady(ready: boolean): void }`
  - `useIntent(view: TableView | null, seatId: string | null, error: string | null, errorKey?: number): Intent`
  - `useLiarsKeys(root: RefObject<HTMLElement | null>): void`

- [ ] **Step 1: Write the failing `useIntent` test**

`apps/web/src/liarsdice/useIntent.test.ts`. Read `apps/web/src/blackjack/useIntent.test.ts` first for how it drives a hook with `renderHook` and fake timers, and follow it.

```ts
import type { TableView } from "@backroom/game-liars-dice";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seat, view } from "./fixtures.js";
import { useIntent } from "./useIntent.js";

const table = (over: Partial<TableView> = {}): TableView =>
  view([seat(), seat({ id: "s1", name: "Bram" })], { toAct: "s0", total: 10, ...over });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a bid", () => {
  it("shows on the press, because the number is the player's own", () => {
    const { result } = renderHook(() => useIntent(table(), "s0", null));
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    expect(result.current.bid).toEqual({ count: 3, face: 5 });
    expect(result.current.busy).toBe(true);
  });

  it("gives way the moment the table says the same thing", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: TableView }) => useIntent(state, "s0", null),
      { initialProps: { state: table() } },
    );
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    rerender({ state: table({ bid: { count: 3, face: 5 }, bidder: "s0", toAct: "s1" }) });
    expect(result.current.bid).toBe(null);
    expect(result.current.busy).toBe(false);
  });

  it("is given up on when the table never answers", () => {
    const { result } = renderHook(() => useIntent(table(), "s0", null));
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    act(() => void vi.advanceTimersByTime(2_000));
    expect(result.current.bid).toBe(null);
    expect(result.current.busy).toBe(false);
  });

  it("is dropped on a refusal", () => {
    const { result, rerender } = renderHook(
      ({ error, key }: { error: string | null; key: number }) =>
        useIntent(table(), "s0", error, key),
      { initialProps: { error: null as string | null, key: 0 } },
    );
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    rerender({ error: "Not your turn.", key: 1 });
    expect(result.current.bid).toBe(null);
  });

  it("is dropped again on a refusal in the very same words", () => {
    const { result, rerender } = renderHook(
      ({ error, key }: { error: string | null; key: number }) =>
        useIntent(table(), "s0", error, key),
      { initialProps: { error: "Not your turn." as string | null, key: 1 } },
    );
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    // The same words, a second time. Only the counter moves.
    rerender({ error: "Not your turn.", key: 2 });
    expect(result.current.bid).toBe(null);
  });
});

describe("a call", () => {
  it("holds the button down without inventing a count", () => {
    const { result } = renderHook(() => useIntent(table({ bid: { count: 3, face: 5 } }), "s0", null));
    act(() => result.current.sendCall("liar"));
    expect(result.current.busy).toBe(true);
    // Nothing is guessed about the answer.
    expect(result.current.bid).toBe(null);
  });

  it("lets go when the reveal lands", () => {
    const standing = { bid: { count: 3, face: 5 }, bidder: "s1" };
    const { result, rerender } = renderHook(
      ({ state }: { state: TableView }) => useIntent(state, "s0", null),
      { initialProps: { state: table(standing) } },
    );
    act(() => result.current.sendCall("liar"));
    rerender({
      state: table({
        ...standing,
        toAct: null,
        resolution: {
          call: "liar",
          caller: "s0",
          bid: { count: 3, face: 5 },
          bidder: "s1",
          count: 4,
          right: true,
          losers: ["s0"],
        },
      }),
    });
    expect(result.current.busy).toBe(false);
  });
});

describe("readiness", () => {
  it("shows on the tap and gives way when the table agrees", () => {
    const waiting = table({ phase: "waiting", toAct: null });
    const { result, rerender } = renderHook(
      ({ state }: { state: TableView }) => useIntent(state, "s0", null),
      { initialProps: { state: waiting } },
    );
    act(() => result.current.setReady(true));
    expect(result.current.ready).toBe(true);
    rerender({
      state: view([seat({ ready: true }), seat({ id: "s1" })], { phase: "waiting", toAct: null }),
    });
    expect(result.current.ready).toBe(null);
  });
});

describe("a new round", () => {
  it("forgets whatever was outstanding", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: TableView }) => useIntent(state, "s0", null),
      { initialProps: { state: table() } },
    );
    act(() => result.current.sendBid({ count: 3, face: 5 }));
    rerender({ state: table({ round: 2 }) });
    expect(result.current.bid).toBe(null);
    expect(result.current.busy).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see it fail**

```bash
npx vitest run apps/web/src/liarsdice/useIntent.test.ts
```

Expected: FAIL — `Failed to resolve import "./useIntent.js"`.

- [ ] **Step 3: Write `useIntent.ts`**

```ts
import type { Bid, Call, TableView } from "@backroom/game-liars-dice";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What this player has asked for and not yet been told about.
 *
 * Every move at this table is a round trip, and a round trip is long enough to
 * feel like the button did not work. So a press changes what is on screen
 * immediately and the table's answer replaces it a moment later.
 *
 * Nothing here invents a fact, and the line between the two is sharp at this
 * table. A bid is a number this player chose, so it goes up on the felt on the
 * press. A call's answer is thirty dice and a count that only the server knows
 * — so a call shows as a button going down and nothing else. Guessing the
 * count, even for a frame, would be telling somebody they had won.
 */

/** How long an unanswered ask is trusted before the table's word wins. */
const PATIENCE_MS = 1_600;

interface Sent {
  /** The bid, for a raise; null for a call. */
  bid: Bid | null;
  /** What the board looked like when it went, so we can tell when it lands. */
  round: number;
  standing: string;
  revealed: boolean;
}

export interface Intent {
  /** The bid to show: this player's own last press until the table agrees. */
  bid: Bid | null;
  /** Readiness to show: the same, for the ready key. */
  ready: boolean | null;
  /** A move gone and not yet answered, so the main action stays held down. */
  busy: boolean;
  sendBid: (bid: Bid) => void;
  sendCall: (call: Call) => void;
  setReady: (ready: boolean) => void;
}

/** The standing bid as one comparable string, so a change is one comparison. */
const stampOf = (view: TableView | null): string =>
  view === null || view.bid === null ? "-" : `${view.bid.count}.${view.bid.face}`;

export function useIntent(
  view: TableView | null,
  seatId: string | null,
  error: string | null,
  /** Moves on for every refusal, including one in the same words as the last. */
  errorKey = 0,
): Intent {
  const me = view?.seats.find((seat) => seat.id === seatId) ?? null;
  const round = view?.round ?? 0;
  const standing = stampOf(view);
  const bidder = view?.bidder ?? null;
  const revealed = view?.resolution !== null && view?.resolution !== undefined;

  const [ready, setReadyState] = useState<boolean | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const timers = useRef<number[]>([]);

  /** Nothing asked for outlives its patience, however the answer goes. */
  const forget = useCallback((drop: () => void) => {
    const id = window.setTimeout(drop, PATIENCE_MS);
    timers.current.push(id);
  }, []);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const id of held) {
        window.clearTimeout(id);
      }
    };
  }, []);

  const sendBid = useCallback(
    (bid: Bid) => {
      setSent({ bid, round, standing, revealed });
      forget(() => setSent(null));
    },
    [round, standing, revealed, forget],
  );

  const sendCall = useCallback(
    (_call: Call) => {
      // The call itself is not kept: there is nothing about it to show early.
      setSent({ bid: null, round, standing, revealed });
      forget(() => setSent(null));
    },
    [round, standing, revealed, forget],
  );

  const setReady = useCallback(
    (value: boolean) => {
      setReadyState(value);
      forget(() => setReadyState(null));
    },
    [forget],
  );

  // The table holding the answer this player pressed is what says it landed.
  useEffect(() => {
    if (ready !== null && me !== null && me.ready === ready) {
      setReadyState(null);
    }
  }, [ready, me]);

  /*
   * The table caught up. A bid lands as the standing bid becoming this
   * player's; a call lands as a reveal appearing. Either way the board moving
   * at all is enough — whatever happened, what is on screen is now the table's
   * version and not this player's guess.
   */
  useEffect(() => {
    if (sent === null) {
      return;
    }
    const landed =
      round !== sent.round ||
      standing !== sent.standing ||
      revealed !== sent.revealed ||
      (sent.bid !== null && bidder === seatId && standing !== "-");
    if (landed) {
      setSent(null);
    }
  }, [sent, round, standing, revealed, bidder, seatId]);

  // Keyed on the count as well as the words: a second refusal in the same words
  // is still a refusal, and would otherwise leave a move hanging.
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (error !== null) {
      setSent(null);
      setReadyState(null);
    }
  }, [error, errorKey]);

  // A round that has been dealt is no longer one anybody is readying up on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the round changing, which is the point
  useEffect(() => {
    setReadyState(null);
  }, [round]);

  return {
    bid: sent?.bid ?? null,
    ready,
    busy: sent !== null,
    sendBid,
    sendCall,
    setReady,
  };
}
```

- [ ] **Step 4: Run it**

```bash
npx vitest run apps/web/src/liarsdice/useIntent.test.ts
```

Expected: PASS. The "gives way the moment the table says the same thing" case is the one to watch — it lands through `standing !== sent.standing`.

- [ ] **Step 5: Write the failing keys test**

`apps/web/src/liarsdice/useLiarsKeys.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useLiarsKeys } from "./useLiarsKeys.js";

function Harness({
  onBid,
  onLiar,
  busy = false,
  disabled = false,
}: {
  onBid: () => void;
  onLiar: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const root = useRef<HTMLElement | null>(null);
  useLiarsKeys(root);
  return (
    <section ref={root}>
      <div className="ld__builder">
        <button type="button" className="ld__face-lamp" onClick={onBid}>
          5
        </button>
      </div>
      <button
        type="button"
        aria-keyshortcuts="Space"
        className={busy ? "slab is-busy" : "slab"}
        disabled={disabled}
        onClick={onBid}
      >
        Bid
      </button>
      <button type="button" aria-keyshortcuts="L" onClick={onLiar}>
        Liar
      </button>
      <input aria-label="Say something" />
      <div role="dialog">
        <button type="button">In a sheet</button>
      </div>
    </section>
  );
}

const press = (key: string, over: Partial<KeyboardEventInit> = {}, target?: Element) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...over });
  (target ?? document.body).dispatchEvent(event);
  return event;
};

describe("the keys", () => {
  it("presses the button Space stands for", () => {
    const onBid = vi.fn();
    render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    press(" ");
    expect(onBid).toHaveBeenCalledTimes(1);
  });

  it("presses the button L stands for, whatever the case", () => {
    const onLiar = vi.fn();
    render(<Harness onBid={vi.fn()} onLiar={onLiar} />);
    press("L");
    press("l");
    expect(onLiar).toHaveBeenCalledTimes(2);
  });

  it("stops the page scrolling on Space", () => {
    render(<Harness onBid={vi.fn()} onLiar={vi.fn()} />);
    expect(press(" ").defaultPrevented).toBe(true);
  });

  it("does nothing while typing", () => {
    const onBid = vi.fn();
    const { container } = render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    press(" ", {}, container.querySelector("input") as Element);
    expect(onBid).not.toHaveBeenCalled();
  });

  it("does nothing inside a sheet", () => {
    const onBid = vi.fn();
    const { container } = render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    press(" ", {}, container.querySelector("[role='dialog'] button") as Element);
    expect(onBid).not.toHaveBeenCalled();
  });

  it("leaves a modifier to the browser", () => {
    const onBid = vi.fn();
    render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    press(" ", { ctrlKey: true });
    press(" ", { metaKey: true });
    press(" ", { altKey: true });
    expect(onBid).not.toHaveBeenCalled();
  });

  it("counts a held key once", () => {
    const onBid = vi.fn();
    render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    press(" ", { repeat: true });
    expect(onBid).not.toHaveBeenCalled();
  });

  it("does nothing for a button that could not be pressed", () => {
    const onBid = vi.fn();
    const { unmount } = render(<Harness onBid={onBid} onLiar={vi.fn()} disabled />);
    press(" ");
    expect(onBid).not.toHaveBeenCalled();
    unmount();
    render(<Harness onBid={onBid} onLiar={vi.fn()} busy />);
    press(" ");
    expect(onBid).not.toHaveBeenCalled();
  });

  it("hands Space to the table from a lamp that was clicked", () => {
    const onBid = vi.fn();
    const { container } = render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    const lamp = container.querySelector(".ld__face-lamp") as HTMLElement;
    lamp.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    press(" ", {}, lamp);
    // One call, and it came from the slab rather than the lamp.
    expect(onBid).toHaveBeenCalledTimes(1);
  });

  it("leaves Space with a lamp reached by keyboard", () => {
    const onBid = vi.fn();
    const { container } = render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    const lamp = container.querySelector(".ld__face-lamp") as HTMLElement;
    // Focus arriving anywhere other than the last clicked piece forgets it,
    // which is how a tabbed-to lamp keeps its own Space.
    lamp.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const event = press(" ", {}, lamp);
    expect(event.defaultPrevented).toBe(false);
    expect(onBid).not.toHaveBeenCalled();
  });

  it("is not what :focus-visible says", () => {
    // Chrome reports a clicked button as keyboard-focused the moment a key goes
    // down on it, which is exactly when this has to know the difference. Proven
    // by making the browser lie and showing the answer does not change.
    const onBid = vi.fn();
    const { container } = render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    const lamp = container.querySelector(".ld__face-lamp") as HTMLElement;
    const matches = vi.spyOn(lamp, "matches").mockReturnValue(true);
    lamp.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    press(" ", {}, lamp);
    expect(onBid).toHaveBeenCalledTimes(1);
    matches.mockRestore();
  });
});
```

- [ ] **Step 6: Run to see it fail**

```bash
npx vitest run apps/web/src/liarsdice/useLiarsKeys.test.tsx
```

Expected: FAIL — module does not resolve.

- [ ] **Step 7: Write `useLiarsKeys.ts`**

```ts
import type { RefObject } from "react";
import { useEffect } from "react";

/** Which key presses which button, by the name the button declares. */
const SHORTCUTS: Readonly<Record<string, string>> = { " ": "Space", l: "L", e: "E" };

/**
 * Space for the lit slab; L calls liar and E calls exact.
 *
 * Presses the button on screen rather than calling what it calls, so a key can
 * never do what the button would refuse: a disabled or busy button is a key
 * that does nothing. Bound once; the buttons are looked up through the table's
 * ref at the moment the key goes down, so nothing here goes stale.
 */
export function useLiarsKeys(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    /*
     * The piece a pointer last went down on. Remembered here rather than asked
     * of the browser: Chrome reports a clicked button as :focus-visible the
     * moment any key goes down on it, which is exactly when this needs to know.
     * Focus arriving anywhere else, a Tab included, forgets it.
     */
    let clicked: Element | null = null;

    const onDown = (event: KeyboardEvent) => {
      // A modifier makes it somebody else's shortcut; a held key is one press.
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const name = SHORTCUTS[event.key.toLowerCase()];
      if (name === undefined) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      // Typing is typing, and a sheet has keys of its own.
      if (
        (target?.closest("input, textarea, select, [contenteditable], [role='dialog']") ?? null) !==
        null
      ) {
        return;
      }
      if (name === "Space" && target !== null) {
        const piece = target.closest(".ld__builder button");
        /*
         * A lamp somebody clicked hands Space to the table: pick a face, press
         * Space, is the rhythm of a bid. A lamp reached by keyboard keeps its
         * own Space, since that is how a keyboard presses one at all, and any
         * other focused button or link presses itself.
         */
        if (piece !== null ? piece !== clicked : target.closest("a, button") !== null) {
          return;
        }
      }
      const button =
        root.current?.querySelector<HTMLButtonElement>(`button[aria-keyshortcuts="${name}"]`) ??
        null;
      if (button === null || button.disabled || button.classList.contains("is-busy")) {
        return;
      }
      // Not the page scrolling, and not a focused lamp pressing itself on key-up.
      event.preventDefault();
      button.click();
    };
    const onPointer = (event: Event) => {
      clicked =
        event.target instanceof Element ? event.target.closest(".ld__builder button") : null;
    };
    const onFocus = (event: Event) => {
      if (event.target !== clicked) {
        clicked = null;
      }
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("focusin", onFocus);
    };
  }, [root]);
}
```

- [ ] **Step 8: Run, format, lint, commit**

```bash
npx vitest run apps/web/src/liarsdice
npx biome format --write apps/web/src/liarsdice
npm run lint
npm run typecheck
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): the press lands before the table answers

A bid is a number the player chose, so it goes on the felt on the press. A
call's answer is thirty dice and a count only the server knows, so a call
shows as a button going down and nothing else — guessing the count, even
for a frame, would be telling somebody they had won.

Space bids, L calls liar, E calls exact, by pressing the button on screen
rather than calling what it calls: a disabled or busy button is a key that
does nothing. A lamp that was clicked hands Space to the table; one reached
by Tab keeps it. Decided on the last pointerdown, because Chrome reports a
clicked button as keyboard-focused the moment a key goes down on it — there
is a test that makes the browser lie to prove it is not what decides.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 14: The reveal, the board, the rules sheet

**Files:**
- Create: `apps/web/src/liarsdice/Sheet.tsx`
- Create: `apps/web/src/liarsdice/Sheet.test.tsx`
- Create: `apps/web/src/liarsdice/Rules.tsx`
- Create: `apps/web/src/liarsdice/Rules.test.tsx`
- Create: `apps/web/src/liarsdice/Reveal.tsx`
- Create: `apps/web/src/liarsdice/Reveal.test.tsx`
- Create: `apps/web/src/liarsdice/Board.tsx`
- Create: `apps/web/src/liarsdice/Board.test.tsx`

**Interfaces:**
- Consumes: `Bid`, `Face`, `TableView`, `BoardRow`, `says`; `Hand` from `./Dice.js`.
- Produces:
  - `Sheet({ id, label, open, onClose, className, children })` with `className: "ld__sheet--felt" | "ld__sheet--page"`
  - `RULES_SHEET_ID: string`, `Rules({ standing }: { standing: Bid | null })`
  - `Reveal({ state }: { state: TableView })`
  - `Board({ state }: { state: TableView })`

- [ ] **Step 1: `Sheet.tsx`**

Copy `apps/web/src/blackjack/Sheet.tsx` to `apps/web/src/liarsdice/Sheet.tsx` and rename every `bj__` class to `ld__`, and the `className` union to `"ld__sheet--felt" | "ld__sheet--page"`. Copy `apps/web/src/blackjack/Sheet.test.tsx` across the same way. Class names are the table's own (H2) — `grep -rn "ld__sheet" apps/web/src` first and confirm nothing else uses them.

```bash
npx vitest run apps/web/src/liarsdice/Sheet.test.tsx
```

Expected: PASS after the rename.

- [ ] **Step 2: Write the failing rules test**

`apps/web/src/liarsdice/Rules.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Rules } from "./Rules.js";

describe("the rules card", () => {
  it("says the three moves", () => {
    render(<Rules standing={null} />);
    expect(screen.getByText(/Raise/)).toBeInTheDocument();
    expect(screen.getByText(/Liar/)).toBeInTheDocument();
    expect(screen.getByText(/Exact/)).toBeInTheDocument();
  });

  it("says ones are wild", () => {
    render(<Rules standing={null} />);
    expect(screen.getByText(/wild/)).toBeInTheDocument();
  });

  it("lights the row that applies to a plain standing bid", () => {
    const { container } = render(<Rules standing={{ count: 4, face: 5 }} />);
    expect(container.querySelector(".ld__rule--on")?.textContent).toContain("plain face");
  });

  it("lights the other row when ones are standing", () => {
    const { container } = render(<Rules standing={{ count: 3, face: 1 }} />);
    expect(container.querySelector(".ld__rule--on")?.textContent).toContain("ones");
  });

  it("lights neither with nothing said", () => {
    const { container } = render(<Rules standing={null} />);
    expect(container.querySelector(".ld__rule--on")).toBe(null);
  });

  it("works out the actual figures for the bid on the table", () => {
    // Four sixes standing: two ones, or five of a plain face.
    render(<Rules standing={{ count: 4, face: 6 }} />);
    expect(screen.getByText(/two ones/)).toBeInTheDocument();
    expect(screen.getByText(/five/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Write `Rules.tsx`**

```tsx
import type { Bid } from "@backroom/game-liars-dice";
import { says } from "@backroom/game-liars-dice";

export const RULES_SHEET_ID = "liars-rules";

/**
 * The aces arithmetic, which is the one thing a player has to be told.
 *
 * Everything else at this table can be shown: whose turn it is, what the bid
 * is, what a die shows. Why "two ones" beats "four sixes" cannot be, so it is
 * written down — with the row that applies to the bid actually on the table lit,
 * and the actual figures worked out rather than left as Q and 2Q+1.
 */
export function Rules({ standing }: { standing: Bid | null }) {
  const onOnes = standing !== null && standing.face === 1;
  const onPlain = standing !== null && standing.face !== 1;
  const halved = standing === null ? null : Math.ceil(standing.count / 2);
  const doubled = standing === null ? null : standing.count * 2 + 1;

  return (
    <div className="ld__rules">
      <p className="ld__rules-lead">
        Everybody rolls under a cup. Say how many of a face are on the whole
        table — yours and everybody else's — and the next player has to say
        something bigger, or call you.
      </p>

      <dl className="ld__moves">
        <dt>Raise</dt>
        <dd>More dice, or the same number at a higher face.</dd>
        <dt>Liar</dt>
        <dd>
          Every cup comes up. If the count is there, you lose a die. If it is
          not, the bidder does.
        </dd>
        <dt>Exact</dt>
        <dd>
          A claim that the count is precisely the bid. Right, and everybody else
          loses a die. Wrong, and you lose one.
        </dd>
      </dl>

      <p className="ld__rules-wild">
        <strong>Ones are wild</strong> — a one counts as whatever face was bid,
        unless ones are what was bid. That makes a bid on ones harder to fill, so
        it is dearer to say:
      </p>

      <ul className="ld__ruleset">
        <li className={`ld__rule${onPlain ? " ld__rule--on" : ""}`}>
          Over a plain face: more of anything, or{" "}
          {halved === null ? "half as many ones, rounded up" : `${says({ count: halved, face: 1 })}`}
          .
        </li>
        <li className={`ld__rule${onOnes ? " ld__rule--on" : ""}`}>
          Over ones: more ones, or{" "}
          {doubled === null
            ? "twice as many plus one of a plain face"
            : `${says({ count: doubled, face: 2 }).split(" ")[0]} of a plain face`}
          .
        </li>
      </ul>

      <p className="ld__rules-foot">
        Lose your last die and you are out. The last one holding dice takes the
        pot.
      </p>
    </div>
  );
}
```

`says({ count: doubled, face: 2 }).split(" ")[0]` is the count in words on its own — write a tiny `countWords` export in `bid.ts` instead if that reads as a trick when you get there, and update this and its test together.

- [ ] **Step 4: Write the failing reveal and board tests**

`apps/web/src/liarsdice/Reveal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seat, view } from "./fixtures.js";
import { Reveal } from "./Reveal.js";

const revealed = () =>
  view(
    [
      seat({ id: "s0", name: "Ada", dice: 3, hand: [5, 5, 2] }),
      seat({ id: "s1", name: "Bram", dice: 3, hand: [1, 6, 6] }),
    ],
    {
      toAct: null,
      bid: { count: 3, face: 5 },
      bidder: "s0",
      resolution: {
        call: "liar",
        caller: "s1",
        bid: { count: 3, face: 5 },
        bidder: "s0",
        count: 3,
        right: true,
        losers: ["s1"],
      },
    },
  );

describe("the reveal", () => {
  it("shows nothing until a round is called", () => {
    const { container } = render(<Reveal state={view([seat()])} />);
    expect(container.firstChild).toBe(null);
  });

  it("turns every hand up, named", () => {
    render(<Reveal state={revealed()} />);
    expect(screen.getByLabelText("Ada's dice")).toBeInTheDocument();
    expect(screen.getByLabelText("Bram's dice")).toBeInTheDocument();
  });

  it("lights the dice the count was about, wilds included", () => {
    const { container } = render(<Reveal state={revealed()} />);
    // Ada's two fives and Bram's one.
    expect(container.querySelectorAll(".ld-die--matched")).toHaveLength(3);
  });

  it("says the count against the bid", () => {
    render(<Reveal state={revealed()} />);
    expect(screen.getByText(/three fives/)).toBeInTheDocument();
    expect(screen.getByText("3", { selector: ".ld__tally-count" })).toBeInTheDocument();
  });

  it("marks who lost a die", () => {
    const { container } = render(<Reveal state={revealed()} />);
    const losing = container.querySelector(".ld__shown.is-loser");
    expect(losing?.textContent).toContain("Bram");
  });
});
```

`apps/web/src/liarsdice/Board.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seat, view } from "./fixtures.js";
import { Board } from "./Board.js";

const rows = [
  {
    round: 1,
    bid: { count: 4, face: 5 as const },
    call: "liar" as const,
    caller: "s1",
    count: 6,
    right: true,
    losers: ["s1"],
  },
  {
    round: 2,
    bid: { count: 3, face: 2 as const },
    call: "exact" as const,
    caller: "s0",
    count: 3,
    right: true,
    losers: ["s1"],
  },
];

describe("the board", () => {
  it("says nothing before anything has happened", () => {
    render(<Board state={view([seat()], { board: [] })} />);
    expect(screen.getByText(/No rounds yet/)).toBeInTheDocument();
  });

  it("keeps a row per round, with the bid, the count and who paid", () => {
    const state = view([seat({ id: "s0", name: "Ada" }), seat({ id: "s1", name: "Bram" })], {
      board: rows,
    });
    const { container } = render(<Board state={state} />);
    expect(container.querySelectorAll(".ld__row")).toHaveLength(2);
    expect(screen.getByText(/four fives/)).toBeInTheDocument();
    expect(container.textContent).toContain("Bram");
  });

  it("marks an exact apart from a liar call", () => {
    const state = view([seat({ id: "s0" }), seat({ id: "s1" })], { board: rows });
    const { container } = render(<Board state={state} />);
    expect(container.querySelectorAll(".ld__row--exact")).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Write `Reveal.tsx` and `Board.tsx`**

```tsx
// Reveal.tsx
import type { TableView } from "@backroom/game-liars-dice";
import { says } from "@backroom/game-liars-dice";
import { Hand } from "./Dice.js";

/**
 * Every cup up, the count, and who it cost.
 *
 * Over the play area rather than in it, because this is the one moment the felt
 * stops being a thing you act on and becomes a thing you read. The dice that
 * answered to the bid are lit — including the wild ones, which is the rule this
 * moment has to make obvious.
 */
export function Reveal({ state }: { state: TableView }) {
  const shown = state.resolution;
  if (shown === null) {
    return null;
  }
  const inRound = state.seats.filter((seat) => seat.hand.length > 0);

  return (
    <div className="ld__reveal" role="status">
      <p className="ld__tally">
        <span className="label">{says(shown.bid)}, and on the table</span>
        <span className={`ld__tally-count ld__tally-count--${shown.right ? "good" : "bad"}`}>
          {shown.count}
        </span>
      </p>
      <ol className="ld__shows">
        {inRound.map((seat) => (
          <li
            className={`ld__shown${shown.losers.includes(seat.id) ? " is-loser" : ""}`}
            key={seat.id}
          >
            <span className="ld__shown-name">{seat.name}</span>
            <Hand dice={seat.hand} matched={shown.bid.face} label={`${seat.name}'s dice`} />
            {shown.losers.includes(seat.id) ? (
              <span className="tag ld__lost">−1 die</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

```tsx
// Board.tsx
import type { TableView } from "@backroom/game-liars-dice";
import { says } from "@backroom/game-liars-dice";

/**
 * The table's own record of what happened: the bid, what was under the cups,
 * and who paid for the difference.
 *
 * A board rather than the activity log. The log is the table's sentences; this
 * is the thing a player looks back at to work out what everybody has been
 * willing to claim, which is the only read there is in this game.
 */
export function Board({ state }: { state: TableView }) {
  const nameOf = (seatId: string) =>
    state.seats.find((seat) => seat.id === seatId)?.name ?? "Somebody";

  if (state.board.length === 0) {
    return <p className="quiet ld__quiet">No rounds yet.</p>;
  }

  return (
    <ol className="ld__rows table-scroll" aria-label="Rounds so far">
      {[...state.board].reverse().map((row) => (
        <li
          className={`ld__row${row.call === "exact" ? " ld__row--exact" : ""}`}
          key={`${row.round}-${row.bid.count}-${row.bid.face}`}
        >
          <span className="ld__row-round">{row.round}</span>
          <span className="ld__row-bid">{says(row.bid)}</span>
          <span className={`ld__row-count${row.right ? " is-good" : " is-bad"}`}>{row.count}</span>
          <span className="ld__row-cost">
            {row.losers.map((one) => nameOf(one)).join(", ")} −1
          </span>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 6: Run everything, format, lint, commit**

```bash
npx vitest run apps/web/src/liarsdice
npx biome format --write apps/web/src/liarsdice
npm run lint
npm run typecheck
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): the reveal, the board and the rules card

The reveal lights the dice that answered to the bid, wild ones included —
that is the rule this moment has to make obvious, and lighting them is how.

The rules card works out the actual figures for the bid standing on the
table rather than leaving them as Q and 2Q+1, and lights the row that
applies. Why "two ones" beats "four sixes" is the one thing at this table
that cannot be shown, so it is written down.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 15: The felt

**Files:**
- Create: `apps/web/src/liarsdice/lines.ts`
- Create: `apps/web/src/liarsdice/lines.test.ts`
- Modify: `apps/web/src/liarsdice/LiarsDice.tsx`
- Modify: `apps/web/src/liarsdice/LiarsDice.test.tsx`

**Interfaces:**
- Consumes: everything built so far; `ActivityLog`, `useActivity`, `TalkKey`, `TalkSheet`, `useTalk`, `TauntPicker`, `TauntStage`, `useCountdown`.
- Produces: the finished `LiarsDice` page, and `whoseTurn(state, seatId): string` in `lines.ts`.

- [ ] **Step 1: Write `lines.ts` and its test**

`apps/web/src/liarsdice/lines.ts`:

```ts
import type { TableView } from "@backroom/game-liars-dice";

/**
 * The line over the felt saying what the table is waiting for.
 *
 * Here rather than in the component so there is a test per state; there are six
 * of them and the difference between "waiting on Bram" and "waiting for a
 * second player" is the difference between a table that works and one that
 * looks broken.
 */
export function whoseTurn(state: TableView, seatId: string | null): string {
  if (state.phase === "over") {
    const winner = state.seats.find((seat) => state.winnerIds.includes(seat.id));
    return winner === undefined ? "That is the game." : `${winner.name} took it.`;
  }
  if (state.phase === "waiting") {
    if (state.waitingFor === "players") {
      return "Waiting for a second player. Nothing is staked until the table deals.";
    }
    return state.readyCount === 0
      ? "Say you are in and the table will deal."
      : `${state.readyCount} of ${state.seats.length} are in.`;
  }
  if (state.resolution !== null) {
    return "Cups up.";
  }
  if (state.toAct === seatId) {
    return state.bid === null ? "You open." : "Your call.";
  }
  const name = state.seats.find((seat) => seat.id === state.toAct)?.name ?? "somebody";
  return `Waiting on ${name}.`;
}
```

`apps/web/src/liarsdice/lines.test.ts` — one case per branch above, using `seat()` and `view()` from `fixtures.ts`. Six `it`s, each asserting the exact string.

- [ ] **Step 2: Run to see it fail, then pass**

```bash
npx vitest run apps/web/src/liarsdice/lines.test.ts
```

- [ ] **Step 3: Replace the felt placeholder in `LiarsDice.tsx`**

Swap the `<p className="play__error">Table {state.code}</p>` placeholder for `<Felt … />` and `<TauntStage landed={table.landed} />`, and add this component to the file. It follows `BlackjackTable` in `apps/web/src/blackjack/Blackjack.tsx` — read that alongside.

```tsx
function Felt({
  table,
  state,
  seatId,
  account,
}: {
  table: Table;
  state: TableView;
  seatId: string | null;
  account: Account;
}) {
  const chips = account.profile?.chips ?? null;
  const me = state.seats.find((seat) => seat.id === seatId) ?? null;
  const intent = useIntent(state, seatId, table.error, table.errorKey);
  const turnLeft = useCountdown(state.turnEndsAt);
  const countdown = useCountdown(state.countdownEndsAt);
  const talk = useTalk(table.chat, seatId);
  const activity = useActivity({ code: state.code, text: state.lastEvent, seq: state.eventSeq });
  const [sheet, setSheet] = useState(false);
  const root = useRef<HTMLElement | null>(null);
  useLiarsKeys(root);
  useDiceSound(state, seatId);

  // Talk and the rules sheet are two dialogs claiming the same rectangle at
  // desk width, so opening one closes the other rather than stacking a scrim.
  const toggleSheet = () => {
    talk.close();
    setSheet((was) => !was);
  };
  const toggleTalk = () => {
    setSheet(false);
    talk.toggle();
  };

  /*
   * The bid on the felt: this player's own press until the table agrees.
   *
   * The only fact shown early anywhere on this table, and it is safe to show
   * because it is a number they chose. Everything else here waits.
   */
  const shown = intent.bid === null ? state : { ...state, bid: intent.bid, bidder: seatId };
  const model = readoutFor({ state: shown, seatId, turnLeft });
  const log = <ActivityLog entries={activity} />;
  const help = (
    <button
      type="button"
      className="key key--icon ld__help"
      aria-label="How it plays"
      aria-controls={RULES_SHEET_ID}
      aria-expanded={sheet}
      onClick={toggleSheet}
    >
      ?
    </button>
  );

  return (
    <section className="ld" aria-label="The table" ref={root}>
      <div className="ld__in">
        <Seats state={state} seatId={seatId} />

        <div className="ld__play">
          <Readout model={model} />
          <p className="ld__line">{whoseTurn(state, seatId)}</p>
          {me !== null && me.hand.length > 0 ? (
            <Hand
              dice={me.hand}
              matched={state.resolution?.bid.face ?? null}
              label="Your dice"
            />
          ) : (
            <p className="quiet ld__quiet">
              {state.phase === "waiting"
                ? countdown === null
                  ? "No dice yet."
                  : `Dealing in ${countdown}.`
                : "You are not in this one."}
            </p>
          )}
          <Reveal state={state} />
          <div className="table-talk-corner">
            <TalkKey open={talk.open} unread={talk.unread} onToggle={toggleTalk} />
          </div>
          <Sheet
            id={RULES_SHEET_ID}
            label="How it plays"
            open={sheet}
            onClose={() => setSheet(false)}
            className="ld__sheet--felt"
          >
            <Rules standing={state.bid} />
          </Sheet>
        </div>

        <aside className="ld__side-rules" aria-label="How it plays">
          <h2 className="ld__panel-title">How it plays</h2>
          <Rules standing={state.bid} />
        </aside>

        <aside className="ld__side-board" aria-label="Rounds so far">
          <h2 className="ld__panel-title">Rounds</h2>
          <Board state={state} />
        </aside>

        <aside className="ld__side-activity" aria-label="Activity">
          <h2 className="ld__panel-title">Activity</h2>
          {log}
        </aside>

        <Controls
          state={state}
          seatId={seatId}
          busy={intent.busy}
          ready={intent.ready ?? me?.ready ?? false}
          onBid={(bid) => {
            intent.sendBid(bid);
            table.act({ type: "bid", count: bid.count, face: bid.face });
          }}
          onCall={(call) => {
            intent.sendCall(call);
            table.act({ type: call });
          }}
          onReady={(value) => {
            intent.setReady(value);
            table.act({ type: "ready", ready: value });
          }}
          help={help}
          taunt={
            <TauntPicker
              seats={state.seats}
              seatId={seatId}
              chips={chips}
              stakes={table.stakes}
              openClassName="key"
              onThrow={(emote, at) => {
                // The cost leaves the corner on the press: it is the player's
                // own number, so showing it at once invents nothing.
                if (account.profile !== null) {
                  account.setChips(account.profile.chips - emote.cost);
                }
                table.taunt(emote.id, at, (result) => {
                  if (result.ok) {
                    account.setChips(result.chips);
                  } else {
                    account.refresh();
                  }
                });
              }}
            />
          }
        />
      </div>

      <TalkSheet
        open={talk.open}
        onClose={talk.close}
        log={table.chat}
        seatId={seatId}
        onSay={table.say}
        activity={log}
      />
    </section>
  );
}
```

- [ ] **Step 4: Add the page's own tests**

Append to `apps/web/src/liarsdice/LiarsDice.test.tsx`, mocking `useTableSocket` to return a `state` built from `fixtures.ts`:

```tsx
// 1. At a table, the page wears `play--fit play--liars`.
// 2. The rail shows a plate per seat and your own hand shows faces.
// 3. Pressing the Bid slab calls `act` with { type: "bid", count, face } and the
//    readout changes to that bid before any new state arrives.
// 4. Pressing Liar calls `act` with { type: "liar" } and the readout does NOT
//    change — nothing about a count is guessed.
// 5. A refusal shows as `.refusal` over the board, not as `.play__error`.
// 6. The talk key carries an unread count from somebody else's lines.
```

- [ ] **Step 5: Run, format, lint, commit**

```bash
npx vitest run apps/web/src/liarsdice
npx biome format --write apps/web/src/liarsdice
npm run lint
npm run typecheck
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): the felt

The rail, the readout, your own hand, the reveal and the controls, with the
rules card and the rounds board in the side column at a desk and behind
keys on a phone. Talk is opened rather than pushed and the table's
sentences go to the activity log.

The bid is the one fact shown before the table answers, and it is safe
because it is a number the player chose. A call changes nothing on screen
until the reveal lands.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 16: The stylesheet, and the one screen

The L requirements. This task is what makes ten seats work at 375px.

**Files:**
- Modify: `apps/web/src/liarsdice/liarsdice.css` (written in full)
- Create: `apps/web/src/liarsdice/liarsdice.css.test.ts`

- [ ] **Step 1: Confirm the sheet is imported**

```bash
grep -rn "liarsdice.css" apps/web/src
```

Expected: one hit, the import in `LiarsDice.tsx`. A sheet nothing loads is a sheet whose rules are silently dead.

- [ ] **Step 2: Write the failing stylesheet test**

`apps/web/src/liarsdice/liarsdice.css.test.ts`. Read `apps/web/src/blackjack/blackjack.css.test.ts` first — it reads the file with `readFileSync` and asserts on the text, which is how these are done here.

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sheet = readFileSync(join(import.meta.dirname, "liarsdice.css"), "utf8");

/** The body of one rule, by its selector. */
const bodyOf = (selector: string): string => {
  const at = sheet.indexOf(`${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return sheet.slice(at, sheet.indexOf("}", at));
};

describe("one screen", () => {
  it("makes only the play area flex", () => {
    // Every row auto except the play area, which takes what is left.
    expect(bodyOf(".ld__in")).toContain("minmax(0, 1fr)");
  });

  it("makes the play area a size container, so pieces read off it", () => {
    const play = bodyOf(".ld__play");
    expect(play).toContain("container");
    expect(play).toContain("/ size");
    expect(play).toContain("min-height: 0");
  });

  it("sizes a die from both the width and the height it has", () => {
    const play = bodyOf(".ld__play");
    expect(play).toMatch(/--ld-die:\s*clamp\([^)]*min\([^)]*cqi[^)]*cqh/);
  });

  it("never lets a die declare its own size", () => {
    // A piece that sets the same property on itself beats the one it inherits,
    // which is how every Greed die was once a fixed 56px.
    const die = bodyOf(".ld-die");
    expect(die).not.toContain("--ld-die:");
    expect(die).toContain("var(--ld-die)");
  });

  it("nothing is wider than the window", () => {
    expect(sheet).not.toMatch(/min-width:\s*\d{3,}px/);
  });
});

describe("the rail of ten", () => {
  it("wraps rather than scrolling sideways", () => {
    const rail = bodyOf(".ld__rail");
    expect(rail).toContain("flex-wrap: wrap");
  });

  it("hides the names not worth their width on a phone, and says them at a desk", () => {
    // Present in the markup either way: a screen reader reads every seat.
    expect(sheet).toContain(".ld__name--quiet");
    expect(sheet).toMatch(/@container[^{]*\(min-width:\s*760px\)/);
  });

  it("says a seat's state to a screen reader on a phone and shows it at a desk", () => {
    const state = bodyOf(".ld__state");
    expect(state).toContain("clip-path");
  });

  it("keeps the spoken dice count off the screen", () => {
    expect(bodyOf(".ld__count")).toContain("clip-path");
  });
});

describe("two arrangements, one markup", () => {
  it("rearranges on the table's own width, not the window's", () => {
    expect(sheet).toMatch(/@container\s+ld\b/);
    expect(sheet).not.toMatch(/@media[^{]*min-width:\s*760px/);
  });
});

describe("the controls", () => {
  it("gives every key a thumb to hit it with", () => {
    expect(bodyOf(".ld__keys")).toMatch(/min-height:\s*5[2-9]px|min-height:\s*[6-9]\dpx/);
  });

  it("puts the lit slab last, on the right", () => {
    expect(bodyOf(".ld__go")).toContain("margin-inline-start: auto");
  });
});

describe("motion has an off switch", () => {
  it("turns off every animation it declares", () => {
    const names = [...sheet.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(0);
    const at = sheet.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThan(-1);
    const block = sheet.slice(at);
    for (const name of names) {
      // Every keyframe's user is named in the block, by the class that runs it.
      expect(block, `${name} has no off switch`).toContain("animation: none");
    }
    for (const selector of [".ld-die", ".ld__clock", ".ld__reveal"]) {
      expect(block).toContain(selector);
    }
  });
});

describe("scrolling boxes wear the room's bar", () => {
  it("styles the webkit bar and guards the standard properties", () => {
    expect(sheet).toContain("::-webkit-scrollbar");
    expect(sheet).toContain("@supports not selector(::-webkit-scrollbar)");
  });
});
```

- [ ] **Step 3: Run to see it fail**

```bash
npx vitest run apps/web/src/liarsdice/liarsdice.css.test.ts
```

Expected: FAIL on the first `bodyOf(".ld__in")` — the stub sheet has none of these rules.

- [ ] **Step 4: Write the stylesheet**

Replace `apps/web/src/liarsdice/liarsdice.css` with the following. Biome's formatter is off for CSS; keep it tidy by hand.

```css
/*
 * The Liar's Dice table.
 *
 * Ten seats is what this sheet is for. Everything below is an answer to "how
 * does a table with thirty dice on it fit a 375px phone without scrolling":
 * the seats become plates with pips instead of hands, the dice size themselves
 * off the space that is left, and the one thing you act on is under a thumb.
 *
 * Imported by LiarsDice.tsx. The classes are all `ld`-prefixed because
 * game.css is global and carries several pages — `.lobby` was fixed twice from
 * both ends before that lesson stuck.
 */

/* ------------------------------------------------------------ the window */

/*
 * Three rows, and only the middle one flexes: the rail and the controls take
 * the height they need and the felt takes what is left. `minmax(0, 1fr)` and
 * not `1fr`, or a tall child pushes the row past the window instead of
 * scrolling inside it.
 */
.ld {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.ld__in {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 0.6rem;
  min-height: 0;
  flex: 1;
  padding: 0.6rem 0.75rem;
}

/*
 * The felt is a size container, so every piece on it can be sized from both
 * the width and the height actually available. A short phone in Safari has
 * about 200px here and a desk has 600; the dice shrink rather than the
 * controls going under the fold.
 */
.ld__play {
  container: ld / size;
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 14px;
  background:
    radial-gradient(120% 90% at 50% 0%, var(--gr-color-felt-lit), var(--gr-color-felt) 60%),
    var(--gr-color-felt-deep);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04), var(--gr-sink);
  /*
   * The one place a die's size is set. On the container, never on the die —
   * a piece that declares the same custom property on itself beats the one it
   * inherits, which is how every Greed die was once a fixed 56px.
   */
  --ld-die: clamp(22px, min(11cqi, 13cqh), 56px);
}

/* --------------------------------------------------------------- the rail */

.ld__rail {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.35rem 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ld__seat {
  display: grid;
  grid-template-columns: auto auto;
  grid-template-areas: "face dice" "face name";
  align-items: center;
  gap: 0 0.35rem;
  padding: 0.25rem 0.45rem 0.25rem 0.25rem;
  border: 1px solid var(--gr-color-smoke);
  border-radius: 999px;
  background: var(--gr-color-slate);
  transition: border-color 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
}

.ld__face {
  grid-area: face;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  overflow: hidden;
}

.ld__dice {
  grid-area: dice;
}

.ld__name {
  grid-area: name;
  max-width: 7ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.68rem;
  color: var(--gr-color-ink-dim);
}

/*
 * Ten names at 375px is a wall of ellipses, so only the seat to act and your
 * own are shown. Taken off the screen rather than out of the markup: a screen
 * reader still reads every seat, which is the whole point of T1.
 */
.ld__name--quiet {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
  overflow: hidden;
}

/* The pips are decoration; this is the version that is read out. */
.ld__count,
.ld__state {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
  overflow: hidden;
  white-space: nowrap;
}

/* Whose turn it is, in the room's own light. */
.ld__seat.is-turn {
  border-color: var(--gr-color-neon);
  box-shadow: 0 0 0 1px var(--gr-color-neon), 0 0 14px -2px var(--gr-color-neon);
}

/* Your own, outlined the way the leaderboard outlines you. */
.ld__seat.is-you {
  border-color: var(--gr-color-chip-dim);
}

/* Dimmed, never hidden. The state itself is said above. */
.ld__seat.is-out,
.ld__seat.is-gone,
.ld__seat.is-waiting,
.ld__seat.is-short {
  opacity: 0.45;
}

.ld__seat.is-ready {
  border-color: var(--gr-color-good);
}

/* ------------------------------------------------------------- the readout */

.ld__readout {
  position: relative;
  width: 100%;
  max-width: 28rem;
  overflow: hidden;
  text-align: center;
}

/*
 * The turn draining along the top edge. One element scaled rather than a width
 * animated, so it is a transform and never touches layout.
 */
.ld__clock {
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  height: 3px;
  transform-origin: left center;
  background: linear-gradient(90deg, var(--gr-color-neon), var(--gr-color-neon-hi));
  transition: transform 500ms linear;
}

.ld__figure {
  font-size: clamp(1.4rem, min(9cqi, 7cqh), 2.6rem);
  line-height: 1.05;
}

.ld__figure--good {
  color: var(--gr-color-good);
}

.ld__figure--bad {
  color: var(--gr-color-bad);
}

.ld__stats {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  margin: 0.4rem 0 0;
}

.ld__stat {
  display: grid;
  gap: 0.1rem;
  justify-items: center;
}

.ld__line {
  margin: 0;
  font-size: 0.8rem;
  color: var(--gr-color-ink-dim);
}

.ld__quiet {
  margin: 0;
}

/* ---------------------------------------------------------------- the dice */

.ld__hand {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  justify-content: center;
}

.ld-die {
  width: var(--ld-die);
  height: var(--ld-die);
  display: grid;
  grid-template: repeat(3, 1fr) / repeat(3, 1fr);
  place-items: center;
  padding: 12%;
  border-radius: 18%;
  background: linear-gradient(160deg, #fbf3ea, #dccdc0);
  box-shadow: 0 2px 0 rgb(0 0 0 / 0.35), inset 0 1px 0 rgb(255 255 255 / 0.7);
  animation: ld-land 320ms cubic-bezier(0.2, 1.3, 0.35, 1) backwards;
}

.ld-die__pip {
  width: 22%;
  height: 22%;
  border-radius: 50%;
  background: #2b1a12;
}

/* A cup nobody has looked under. Not a guessed face — no face at all. */
.ld-die--down {
  background: linear-gradient(160deg, var(--gr-color-smoke-lit), var(--gr-color-smoke));
  box-shadow: 0 2px 0 rgb(0 0 0 / 0.4), inset 0 1px 0 rgb(255 255 255 / 0.05);
}

.ld-die--matched {
  box-shadow: 0 0 0 2px var(--gr-color-neon), 0 0 16px -3px var(--gr-color-neon-hi);
  animation: ld-turn 340ms cubic-bezier(0.2, 1.3, 0.35, 1) backwards;
}

/* One motion, once: the die that just left somebody's hand. */
.ld-die--dying {
  animation: ld-lost 420ms ease-in forwards;
}

@keyframes ld-land {
  from {
    transform: translateY(-40%) rotate(-12deg);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

@keyframes ld-turn {
  from {
    transform: rotateX(90deg);
  }
  to {
    transform: none;
  }
}

@keyframes ld-lost {
  to {
    transform: translateY(45%) scale(0.7);
    opacity: 0;
  }
}

/* -------------------------------------------------------------- the reveal */

.ld__reveal {
  position: absolute;
  inset: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 12px;
  background: rgb(23 17 13 / 0.92);
  backdrop-filter: blur(2px);
  animation: ld-rise 220ms ease-out;
}

.ld__tally {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.5rem;
  margin: 0;
}

.ld__tally-count {
  font-size: clamp(1.6rem, 10cqi, 2.8rem);
  font-variant-numeric: tabular-nums;
}

.ld__tally-count--good {
  color: var(--gr-color-good);
}

.ld__tally-count--bad {
  color: var(--gr-color-bad);
}

.ld__shows {
  display: grid;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  min-height: 0;
}

.ld__shown {
  display: grid;
  grid-template-columns: minmax(4rem, 7rem) 1fr auto;
  align-items: center;
  gap: 0.5rem;
}

.ld__shown-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8rem;
}

.ld__shown.is-loser {
  color: var(--gr-color-bad);
}

/* The dice in a reveal are small: ten hands have to fit the same box. */
.ld__reveal .ld__hand {
  justify-content: flex-start;
}

.ld__reveal {
  --ld-die: clamp(16px, min(6cqi, 5cqh), 30px);
}

@keyframes ld-rise {
  from {
    transform: translateY(8px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

/* ------------------------------------------------------------ the controls */

.ld__controls {
  display: grid;
  gap: 0.5rem;
}

.ld__builder {
  display: grid;
  gap: 0.5rem;
  padding: 0.5rem;
}

.ld__faces {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.3rem;
}

.ld__face-lamp {
  min-height: 44px;
  font-variant-numeric: tabular-nums;
}

.ld__stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.ld__amount {
  min-width: 2.5ch;
  text-align: center;
  font-size: 1.4rem;
  font-variant-numeric: tabular-nums;
  color: var(--gr-color-ink-lit);
}

/*
 * The bottom row: secondary keys on the left, the one lit thing on the right,
 * where a thumb already is.
 */
.ld__keys {
  display: flex;
  align-items: stretch;
  gap: 0.4rem;
  min-height: 54px;
}

.ld__keys > * {
  min-height: 54px;
}

.ld__go {
  margin-inline-start: auto;
  flex: 1 1 auto;
  max-width: 62%;
}

.ld__waiting {
  margin: 0;
  text-align: center;
  font-size: 0.8rem;
  color: var(--gr-color-ink-dim);
}

/* ------------------------------------------------------- the side column */

/*
 * A phone sees none of these: the rules are behind the `?` key and the rounds
 * and activity are behind the talk key's second tab. They come back when the
 * table itself is wide enough, which is the table's width and not the
 * window's — a table in a narrow column on a wide screen is still narrow.
 */
.ld__side-rules,
.ld__side-board,
.ld__side-activity {
  display: none;
}

.ld__panel-title {
  margin: 0 0 0.35rem;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gr-color-ink-faint);
}

@container ld (min-width: 760px) {
  .ld__in {
    grid-template-columns: minmax(0, 1fr) 19rem;
    grid-template-areas:
      "rail    rules"
      "play    board"
      "controls activity";
  }

  .ld__rail {
    grid-area: rail;
  }

  .ld__play {
    grid-area: play;
  }

  .ld__controls {
    grid-area: controls;
  }

  .ld__side-rules {
    grid-area: rules;
    display: block;
  }

  .ld__side-board {
    grid-area: board;
    display: block;
    min-height: 0;
  }

  .ld__side-activity {
    grid-area: activity;
    display: block;
    min-height: 0;
  }

  /* Room for a name under every plate once there is room for one. */
  .ld__name--quiet {
    position: static;
    width: auto;
    height: auto;
    clip-path: none;
  }

  .ld__state {
    position: static;
    width: auto;
    height: auto;
    clip-path: none;
  }
}

/*
 * The container query above keys on `.ld__in`'s own width, so `.ld__in` has to
 * be the container. Declared here rather than beside the grid so the two are
 * read together.
 */
.ld__in {
  container: ld / inline-size;
}

/* ---------------------------------------------------------------- the board */

.ld__rows {
  display: grid;
  gap: 0.2rem;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 11rem;
  overflow-y: auto;
}

.ld__row {
  display: grid;
  grid-template-columns: 1.5rem 1fr auto auto;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.35rem;
  border-radius: 6px;
  background: var(--gr-color-slate);
  font-size: 0.75rem;
}

.ld__row--exact {
  border-inline-start: 2px solid var(--gr-color-neon);
}

.ld__row-round {
  color: var(--gr-color-ink-faint);
  font-variant-numeric: tabular-nums;
}

.ld__row-count {
  font-variant-numeric: tabular-nums;
}

.ld__row-count.is-good {
  color: var(--gr-color-good);
}

.ld__row-count.is-bad {
  color: var(--gr-color-bad);
}

.ld__row-cost {
  color: var(--gr-color-ink-dim);
}

/* ---------------------------------------------------------------- the card */

.ld__rules {
  display: grid;
  gap: 0.6rem;
  font-size: 0.8rem;
}

.ld__moves {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.2rem 0.6rem;
  margin: 0;
}

.ld__moves dt {
  color: var(--gr-color-neon-hi);
}

.ld__moves dd {
  margin: 0;
  color: var(--gr-color-ink-dim);
}

.ld__ruleset {
  display: grid;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ld__rule {
  padding: 0.3rem 0.45rem;
  border-radius: 6px;
  background: var(--gr-color-slate);
  color: var(--gr-color-ink-dim);
}

/* The row that applies to the bid actually on the table. */
.ld__rule--on {
  background: var(--gr-color-smoke-lit);
  color: var(--gr-color-ink-lit);
  box-shadow: inset 0 0 0 1px var(--gr-color-neon-dim);
}

/* --------------------------------------------------------------- the sheet */

.ld__scrim {
  position: fixed;
  inset: 0;
  border: 0;
  background: rgb(11 8 6 / 0.6);
}

.ld__sheet {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 12px;
  background: var(--gr-color-slate);
  box-shadow: var(--gr-lift);
}

.ld__sheet--felt {
  inset: 0.5rem;
}

.ld__sheet--page {
  inset-inline: 0.75rem;
  inset-block-end: 0.75rem;
}

.ld__sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ld__sheet-title {
  margin: 0;
  font-size: 0.9rem;
}

.ld__sheet-body {
  min-height: 0;
  overflow-y: auto;
}

/* ------------------------------------------------------------- the lobby */

.ld__pick {
  margin-block: 0.4rem;
}

/* ---------------------------------------------------------- scrolling bars */

/*
 * Chrome lets the standard properties win and draws its own bar with arrows, so
 * those go behind an @supports and the webkit ones do the work.
 */
.ld__rows::-webkit-scrollbar,
.ld__shows::-webkit-scrollbar,
.ld__sheet-body::-webkit-scrollbar {
  width: 8px;
}

.ld__rows::-webkit-scrollbar-track,
.ld__shows::-webkit-scrollbar-track,
.ld__sheet-body::-webkit-scrollbar-track {
  background: var(--gr-color-shadow);
  border-radius: 999px;
}

.ld__rows::-webkit-scrollbar-thumb,
.ld__shows::-webkit-scrollbar-thumb,
.ld__sheet-body::-webkit-scrollbar-thumb {
  background: var(--gr-color-smoke-lit);
  border-radius: 999px;
}

@supports not selector(::-webkit-scrollbar) {
  .ld__rows,
  .ld__shows,
  .ld__sheet-body {
    scrollbar-width: thin;
    scrollbar-color: var(--gr-color-smoke-lit) var(--gr-color-shadow);
  }
}

/* -------------------------------------------------------- the off switches */

/*
 * Every keyframe in this sheet, off. The felt still says everything it needs
 * to: a die is still there, the count is still the count, the reveal is still
 * over the felt — they simply arrive rather than travel.
 */
@media (prefers-reduced-motion: reduce) {
  .ld-die,
  .ld-die--matched,
  .ld-die--dying,
  .ld__reveal {
    animation: none;
  }

  .ld-die--dying {
    opacity: 0.3;
  }

  .ld__clock,
  .ld__seat {
    transition: none;
  }
}
```

- [ ] **Step 5: Run the stylesheet test**

```bash
npx vitest run apps/web/src/liarsdice/liarsdice.css.test.ts
```

Expected: PASS. Two rules in that sheet are declared twice on purpose (`.ld__in` and `.ld__reveal`) — if `bodyOf` picks the wrong one, merge them into a single rule rather than loosening the test.

- [ ] **Step 6: Format the touched files, lint, commit**

CSS is not formatted by Biome, so only the test file goes through it.

```bash
npx biome format --write apps/web/src/liarsdice/liarsdice.css.test.ts
npm run lint
npm run typecheck
npm test
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): one screen, at 375px, with ten seats

Three rows and only the felt flexes. The felt is a size container and the
dice read their size off it, so a short phone shrinks the dice rather than
pushing the controls under the fold — and a die never declares that size on
itself, which is how every Greed die was once a fixed 56px.

The rail wraps rather than scrolling. Ten names at 375px is a wall of
ellipses, so only the seat to act and your own are shown — taken off the
screen rather than out of the markup, because a screen reader still reads
every seat.

Two arrangements from one markup, on the table's own width rather than the
window's: a table in a narrow column on a wide screen is still narrow.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 17: Sound

**Files:**
- Modify: `apps/web/src/game/audio.ts` (the `sayExact` cue)
- Modify: `apps/web/src/game/audio.test.ts` (a case for it)
- Create: `apps/web/src/liarsdice/useDiceSound.ts`
- Create: `apps/web/src/liarsdice/useDiceSound.test.ts`

**Interfaces:**
- Consumes: `play`, `Cue` from `../game/audio.js`; `TableView`.
- Produces: `useDiceSound(state: TableView | null, seatId: string | null): void`; `"sayExact"` added to `Cue`.

- [ ] **Step 1: Write the failing cue test**

Find the existing cue tests (`grep -n "sayRaise" apps/web/src/game/audio.test.ts`) and add a case in the same style asserting `play("sayExact")` makes a sound without throwing.

- [ ] **Step 2: Add the cue**

In `apps/web/src/game/audio.ts`, add `"sayExact"` to the `Cue` union beside `sayRaise`, with a comment:

```ts
  /* Calling a bid exactly right: the rarest and loudest press at a dice table,
     and it must not sound like calling somebody a liar — those two are the same
     moment from opposite directions and the felt has to tell them apart. */
  | "sayExact"
```

Then give it a voice in `play`'s switch. Put it beside `sayRaise` and make it a two-tone figure — a rising interval rather than the single tone the others use, because it is the one call that can end a game:

```ts
    case "sayExact": {
      tone({ frequency: 520, duration: 0.07, type: "triangle", gain: 0.03 });
      window.setTimeout(
        () => tone({ frequency: 780, duration: 0.1, type: "triangle", gain: 0.035 }),
        70,
      );
      return;
    }
```

Match the `tone` signature that file actually uses; read it rather than trusting this.

- [ ] **Step 3: Write the failing sound-hook test**

`apps/web/src/liarsdice/useDiceSound.test.ts`:

```ts
import type { TableView } from "@backroom/game-liars-dice";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seat, view } from "./fixtures.js";
import { useDiceSound } from "./useDiceSound.js";

const play = vi.fn();
vi.mock("../game/audio.js", () => ({ play: (...args: unknown[]) => play(...args) }));

beforeEach(() => play.mockClear());

const drive = (states: TableView[]) => {
  const { rerender } = renderHook(({ state }: { state: TableView }) => useDiceSound(state, "s0"), {
    initialProps: { state: states[0] as TableView },
  });
  for (const state of states.slice(1)) {
    rerender({ state });
  }
};

const table = (over: Partial<TableView> = {}) =>
  view([seat(), seat({ id: "s1", name: "Bram" })], { toAct: "s0", total: 10, ...over });

describe("what the table sounds like", () => {
  it("shakes and lands when a round is dealt", () => {
    drive([table({ phase: "waiting", round: 0, toAct: null }), table({ round: 1 })]);
    expect(play).toHaveBeenCalledWith("shake");
  });

  it("says a bid once per bid, and twice for two", () => {
    drive([
      table(),
      table({ bid: { count: 3, face: 5 }, bidder: "s0", toAct: "s1" }),
      table({ bid: { count: 4, face: 5 }, bidder: "s1", toAct: "s0" }),
    ]);
    expect(play.mock.calls.filter(([cue]) => cue === "sayRaise")).toHaveLength(2);
  });

  it("says nothing again for a state sent twice", () => {
    const same = table({ bid: { count: 3, face: 5 }, bidder: "s0", toAct: "s1" });
    drive([table(), same, same]);
    expect(play.mock.calls.filter(([cue]) => cue === "sayRaise")).toHaveLength(1);
  });

  it("tells a liar call from an exact one", () => {
    const resolution = {
      call: "exact" as const,
      caller: "s1",
      bid: { count: 3, face: 5 as const },
      bidder: "s0",
      count: 3,
      right: true,
      losers: ["s0"],
    };
    drive([table({ bid: { count: 3, face: 5 }, bidder: "s0" }), table({ resolution, toAct: null })]);
    expect(play).toHaveBeenCalledWith("sayExact");
    expect(play).not.toHaveBeenCalledWith("sayCall");
  });

  it("plays the reveal when the cups come up", () => {
    const resolution = {
      call: "liar" as const,
      caller: "s1",
      bid: { count: 3, face: 5 as const },
      bidder: "s0",
      count: 3,
      right: true,
      losers: ["s0"],
    };
    drive([table({ bid: { count: 3, face: 5 }, bidder: "s0" }), table({ resolution, toAct: null })]);
    expect(play).toHaveBeenCalledWith("reveal");
  });

  it("says it is your turn, once, and not somebody else's", () => {
    drive([table({ toAct: "s1" }), table({ toAct: "s0" }), table({ toAct: "s0" })]);
    expect(play.mock.calls.filter(([cue]) => cue === "yourTurn")).toHaveLength(1);
  });

  it("pushes the pot at the end", () => {
    drive([table(), table({ phase: "over", winnerIds: ["s0"], toAct: null })]);
    expect(play).toHaveBeenCalledWith("potPush");
    expect(play).toHaveBeenCalledWith("win");
  });

  it("says nothing at all on the way in", () => {
    renderHook(() => useDiceSound(table({ bid: { count: 3, face: 5 } }), "s0"));
    expect(play).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run to see it fail, then write `useDiceSound.ts`**

```ts
import type { TableView } from "@backroom/game-liars-dice";
import { useEffect, useRef } from "react";
import { play } from "../game/audio.js";

/**
 * What the table sounds like.
 *
 * Every cue here fires on a *change* between two states, never on a state
 * being present — a table sends the same view again for all sorts of reasons
 * (somebody sitting down, a taunt landing) and a felt that re-announced the
 * bid each time would be unbearable.
 *
 * Nothing sounds on the way in either. Arriving at a table mid-round should
 * not replay the round.
 */
export function useDiceSound(state: TableView | null, seatId: string | null): void {
  const was = useRef<TableView | null>(null);

  useEffect(() => {
    const before = was.current;
    was.current = state;
    if (state === null || before === null) {
      return;
    }

    // A new round: cups shaken, dice down.
    if (state.round !== before.round && state.round > 0) {
      play("shake");
      return;
    }

    // A bid. Compared by value, because two different players can say two
    // different things and the felt has to speak for each.
    const bid = state.bid;
    const had = before.bid;
    const moved =
      bid !== null && (had === null || bid.count !== had.count || bid.face !== had.face);
    if (moved) {
      play("sayRaise");
    }

    // A call, and the reveal it brings. The two calls must not share a voice:
    // they are the same moment from opposite directions.
    if (state.resolution !== null && before.resolution === null) {
      play(state.resolution.call === "exact" ? "sayExact" : "sayCall");
      play("reveal");
    }

    // The turn arriving on this seat, once.
    if (state.toAct === seatId && before.toAct !== seatId && seatId !== null) {
      play("yourTurn");
    }

    // The pot going across the felt.
    if (state.phase === "over" && before.phase !== "over") {
      play("potPush");
      if (state.winnerIds.includes(seatId ?? "")) {
        play("win");
      }
    }
  }, [state, seatId]);
}
```

The test expects `win` whenever the game ends; as written it only plays for the winner. Decide which is right — a win cue for somebody who lost is wrong — and fix the **test** to assert `win` only when `seatId` is the winner. Watch the original assertion fail, then correct it.

- [ ] **Step 5: Regenerate audio if the cue needs a sample**

```bash
npm run sync-audio
```

`sayExact` is synthesised, so this should change nothing. `apps/web/public/audio/` is generated and ignored — do not commit anything from it.

- [ ] **Step 6: Run, format, lint, commit**

```bash
npx vitest run apps/web/src/liarsdice apps/web/src/game/audio.test.ts
npx biome format --write apps/web/src/liarsdice apps/web/src/game/audio.ts apps/web/src/game/audio.test.ts
npm run lint
npm run typecheck
git add -A
git commit -m "$(cat <<'MSG'
feat(liars-dice): what the table sounds like

Every cue fires on a change between two states rather than on a state being
present: a table re-sends the same view for all sorts of reasons, and a felt
that re-announced the bid each time would be unbearable. Nothing sounds on
the way in — arriving mid-round should not replay the round.

`sayExact` is a new cue rather than liar's borrowed. Those two are the same
moment from opposite directions and the one time the felt most needs to
tell them apart.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 18: The hand pass, and the PR

Nothing here is automatable, and it is the task that decides whether this is done.

- [ ] **Step 1: Everything clean**

```bash
npm test
npm run typecheck
npm run lint
```

All three must be clean. If `npm test` is flaky even once, that is a bug to find rather than re-run.

- [ ] **Step 2: Start the app and play a real game**

Use the `run` skill (or `.claude/launch.json`) rather than Bash. Open two browser windows, sign in as two accounts or open one for-fun table, and play a game to the end. Confirm:

- the ante leaves the balance at the deal and not before;
- the pot pays out to the winner and the balance moves;
- your dice are faces and the other player's are face-down cups;
- a liar call turns both hands up in both windows at once;
- the reveal stays up about six seconds, then the next round deals itself;
- a player leaving mid-game has their turns bid by the clock and their seat goes when the felt clears.

- [ ] **Step 3: The L8 sizes, by hand**

At each of 375×560, 375×667, 375×812, 768×1024 and a desk width, in the browser console:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```

Expected: `true` at every one. And at each: the lit slab is visible without scrolling, every key is at least 52px tall, and the felt still shows your hand. Use the browser pane's `resize_window` for the phone sizes.

- [ ] **Step 4: The bargain, on a clock rather than by eye**

In the browser's network conditions, set a 400ms latency, then press Bid. The readout must change to the new bid **immediately** and the slab must go down and stay down until the table answers. Then force a refusal — bid out of turn from the other window — and confirm the early bid is given up and `Refusal` appears over a blurred board with the `refused` cue.

- [ ] **Step 5: Reduced motion, and the keyboard**

Turn on `prefers-reduced-motion` in the browser and confirm the felt still says everything: dice present, count present, reveal present, nothing moving. Then, with a keyboard only: Tab to a face lamp and press Space (it should change the face, not bid); click a lamp and press Space (it should bid); press L and E and confirm they call; open the talk sheet and confirm Space types a space rather than bidding.

- [ ] **Step 6: Ten seats, for real**

Open a for-fun table, cap it at ten, and fill it with bots. Confirm at 375px that the rail wraps to two rows, nothing scrolls sideways, and a game finishes.

- [ ] **Step 7: Note anything that failed, fix it with a test first**

Anything found in steps 2–6 is a bug. Write the test, watch it fail against the current code, then fix it. Do not fix anything found by hand without a test.

- [ ] **Step 8: Open the pull request**

```bash
git push -u origin claude/liars-dice-game-472c6e
```

Then open a PR whose body says which of the table standard's requirements this meets, which it does not and why, and carries the attribution line. Cite the requirement ids: L1–L8, F1–F5, T1–T5, K1–K5, C1–C5, A1–A4, N1–N6, S1–S4 (S applies only to the lobby's stake pickers here, since nothing is staked in-hand), M1–M3, H1–H3.

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Self-Review

Run against the spec after the plan is written.

**Spec coverage.** Every section maps to a task: the rules → 3, 4, 5; the money → 7; the dice from `randomInt` → 9; hidden hands → 6; the package table → 2–8; the listing and host choices → 2, 9, 10; timings → 2; the clock's timeout → 7; the table dealing itself and `Readiness` into core → 1, 7; the felt's three rows → 16; the picker's defaults → 12; the rules within reach → 14; talk/activity/refusals → 15; what lands at once → 13; motion → 16; sound → 17; keys → 13; bots → 8; testing → every task, plus 18 by hand; wiring → 9, 10; what this does not do → nothing to build.

**Known gaps, deliberate.** The spec's "a latency test proving the optimistic bid shows at a non-zero round trip" is covered by `useIntent.test.ts` (which never consults a clock, so it holds at any latency) plus Task 18 step 4 by hand; there is no automated 400ms-RTT test, because nothing in this repo stands a latency-injecting socket up and building one is its own piece of work. Say so in the PR.

**Type consistency.** `Face`, `Bid`, `Call`, `Resolution`, `ResolutionView`, `BoardRow`, `SeatView`, `TableView`, `Intent`, `ReadoutModel` are each defined in exactly one task and used by name afterwards. `Round#toAct` (not `toRoll`), `Game#diceFor` (not `diceLeft`), `Table#say` (not `note`), `readoutFor` and `opening` are the names used throughout.

**Placeholders.** Three things in this plan are deliberately left for the implementer to read the neighbouring file for rather than written out, because writing them out from memory would be writing them wrong: the `deps` fake and harness in `games/death-roll/src/adapter.test.ts` (Task 7), the socket-test scaffolding in `apps/server/src/deathroll.socket.test.ts` (Task 9), and `tone`'s exact signature in `apps/web/src/game/audio.ts` (Task 17). Each names the file and what to take from it. Two cases are planted to be found failing and corrected — the seat-name assertion in Task 11 and the `win` cue in Task 17 — and each says so.



