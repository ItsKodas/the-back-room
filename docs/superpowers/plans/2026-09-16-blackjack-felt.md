# Blackjack felt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Blackjack table's web UI to the approved mockups: one screen on a phone and a desk, built from the fittings and PR 1's shared table pieces, with keys, a readout, a rules card, host tools behind a Table key, talk and activity in a sheet, and refusals over the board.

**Architecture:** The server gains `eventSeq` so the shared activity log can tell a repeated sentence from a rebroadcast. The page is split into small presentational pieces under `apps/web/src/blackjack/` (`Readout`, `Seats`, `Moments`, `Controls`, `Sheet`, `HowItPays`, `TableSheet`), all fed from `TableView` through one module of pure helpers (`hands.ts`), so the readout, the seats, the keys and the rules card ask the same questions of the same functions. A `useBlackjackKeys` hook presses the real buttons, found by `aria-keyshortcuts` under the table's ref. `blackjack.css` is rewritten around a `.bj` container with a `.bj__in` grid and a `.bj__felt` size container. `Blackjack.tsx` wires it all up as a `play play--fit` page.

**Tech Stack:** React 18, TypeScript (strict), Vitest + Testing Library (jsdom), plain CSS with container queries, Biome (linter only).

**Spec:** `docs/superpowers/specs/2026-09-16-blackjack-table-design.md` (the "PR 2 — Blackjack" section is binding), under `docs/superpowers/specs/2026-09-16-table-requirements.md`. Visual reference: `docs/design/2026-09-16-blackjack-mockups.html`. Where the spec and the mockups disagree about how something *looks*, the mockups win; about what the table *does*, the spec wins.

## Global Constraints

- `CLAUDE.md` applies throughout: every bug fix gets a test watched failing first; comments say why, not what; motion is short and has an off switch; everything works at 375px; a press shows at once and never invents a fact.
- `npm test`, `npm run typecheck`, `npm run lint` must all be clean at the end.
- **Biome's formatter is disabled in `biome.json`. Do not run `biome format`, and never `biome check --write`.** Keep files tidy by hand; run `npx biome lint <paths>` on touched files.
- Before adding to any stylesheet, grep that something imports it.
- Run one test file with `npx vitest run <path>` from the worktree root.
- Commit messages end with a blank line and `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Greed must stay unchanged, except that its activity log now renders as `table/table.css` intends once the floor stops overriding `.activity`.
- Do not change `apps/web/src/blackjack/Cards.tsx`: the face-down card that arrives on Hit or Double and turns over in place is one arrival and stays one.
- `blackjack.css` is global in practice (App imports every page eagerly) and loads **before** `fittings.css` and `game.css`. Poker and the style gallery deal the same `.bj-card` / `.bj-hand` / `.stack` pieces, so those base rules stay unscoped and unchanged; everything about the table is scoped under `.bj…` classes, and any rule that must beat a fitting (`.readout`, `.well`, `.key`, `.slab`, `.tag`) uses two classes.
- Binding values, verbatim from the spec:
  - phone card widths: dealer `clamp(34px, min(19cqi, 15cqh), 74px)`, your seat `clamp(38px, min(22cqi, 18cqh), 84px)`, other seats `clamp(20px, min(9.5cqi, 8.5cqh), 38px)`;
  - desk (`@container bj (min-width: 760px)`) card widths: dealer `clamp(40px, min(12cqi, 20cqh), 124px)`, your seat `clamp(40px, min(9.5cqi, 17cqh), 100px)`, other seats `clamp(24px, min(6.2cqi, 12cqh), 70px)`; seats along the bottom of the felt, yours `1.5fr` against `1fr` each;
  - split seat card width `clamp(26px, min(12cqi, 15cqh), 52px)`;
  - a dealt hand overlaps by 28% of a card's width; a split box by 42%; the dealer's hand does not overlap;
  - widths set on containers only, inherited by `.bj-card`, which never declares `--bj-card-w` itself;
  - `.bj` is `container: bj / inline-size`; the felt is `container: bj-felt / size`;
  - controls at least `52px` tall; one `.slab` per state of the controls; gold only on chips; good/bad only for outcomes; neon only for what is happening now;
  - keys: **Space** presses the slab (Ready while betting, Hit on your turn), **S** stands, **D** doubles, **P** splits;
  - the table splits once per seat (`hand.fromSplit`); the layout also holds four boxes as a stress case;
  - anything that scrolls on the table wears `.table-scroll`;
  - the floor's panel is renamed `.floor-activity`.

---

## File map

| File | Change |
|---|---|
| `apps/web/src/room/Activity.tsx` | class `activity` → `floor-activity` |
| `apps/web/src/leaderboard/leaderboard.css` | `.activity` → `.floor-activity` |
| `apps/web/src/room/Room.test.tsx` | query follows the rename |
| `apps/web/src/table/table.css.test.ts` | test: no other sheet declares `.activity` |
| `games/blackjack/src/table.ts` | `eventSeq`, `say()` |
| `games/blackjack/src/table.test.ts` | `eventSeq` tests |
| `games/blackjack/src/index.ts` | export `SETTLE_MS` |
| `apps/web/src/blackjack/hands.ts` | **new**: pure helpers over `TableView` |
| `apps/web/src/blackjack/hands.test.ts` | **new** |
| `apps/web/src/blackjack/fixtures.ts` | **new**: `TableView` builders for tests |
| `apps/web/src/blackjack/Readout.tsx` (+ test) | **new** |
| `apps/web/src/blackjack/Seats.tsx` (+ test) | **new**: `Dealer`, `Seats` |
| `apps/web/src/blackjack/Moments.tsx` (+ test) | **new**: banner and stamp |
| `apps/web/src/blackjack/Controls.tsx` (+ test) | **new** |
| `apps/web/src/blackjack/Sheet.tsx` (+ test) | **new** |
| `apps/web/src/blackjack/HowItPays.tsx` (+ test) | **new** |
| `apps/web/src/blackjack/TableSheet.tsx` (+ test) | **new** |
| `apps/web/src/blackjack/useBlackjackKeys.ts` (+ `.test.tsx`) | **new** |
| `apps/web/src/blackjack/blackjack.css` | rewritten |
| `apps/web/src/blackjack/blackjack.css.test.ts` | **new** |
| `apps/web/src/blackjack/Icons.tsx` | add `TableIcon` |
| `apps/web/src/blackjack/Blackjack.tsx` | rewired |
| `apps/web/src/blackjack/Blackjack.test.tsx` | page tests added |

---

### Task 1: The floor gives up the name `.activity`

`apps/web/src/room/Activity.tsx` renders `section.activity`, and `leaderboard.css` (loaded after `table/table.css`) styles `.activity { display: flex … }`, which overrides the shared activity log on every table page.

**Files:**
- Modify: `apps/web/src/table/table.css.test.ts`
- Modify: `apps/web/src/room/Activity.tsx:11`
- Modify: `apps/web/src/leaderboard/leaderboard.css:168-175`
- Modify: `apps/web/src/room/Room.test.tsx:116`

**Interfaces:**
- Consumes: nothing.
- Produces: the floor panel's class is `floor-activity`; only `table/table.css` declares a top-level `.activity` rule.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/table/table.css.test.ts`, change the two imports at the top to:

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
```

Append at the end of the file:

```ts
describe("the activity log's name", () => {
  /*
   * The floor's "On the floor" panel was a .activity too, in a sheet that loads
   * after this one, so its display: flex quietly rebuilt every table's log. A
   * name the shared log depends on belongs to the shared log.
   */
  it("is declared by no stylesheet but this one", () => {
    const root = [resolve(process.cwd(), "apps/web/src"), resolve(process.cwd(), "src")].find((each) =>
      existsSync(join(each, "table/table.css")),
    );
    expect(root, "apps/web/src not found").toBeDefined();
    const claimants = (readdirSync(root as string, { recursive: true }) as string[])
      .map((file) => file.replace(/\\/g, "/"))
      .filter((file) => file.endsWith(".css") && file !== "table/table.css")
      .filter((file) =>
        /^\.activity\s*[,{]/m.test(readFileSync(join(root as string, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")),
      );
    expect(claimants).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run apps/web/src/table/table.css.test.ts`
Expected: FAIL in "is declared by no stylesheet but this one" with `expected [ 'leaderboard/leaderboard.css' ] to deeply equal []`.

- [ ] **Step 3: Rename the floor's class**

`apps/web/src/room/Activity.tsx` line 11, replace `<section className="activity">` with:

```tsx
    <section className="floor-activity">
```

`apps/web/src/leaderboard/leaderboard.css`, replace:

```css
.standings,
.activity {
```

with:

```css
.standings,
.floor-activity {
```

`apps/web/src/room/Room.test.tsx` line 116, replace the line with:

```tsx
    expect(container.querySelector(".rail--left .floor-activity")).toBeTruthy();
```

Check nothing else uses the floor's old class: `git grep -n "\"activity\"" -- apps/web/src` should show no hit in `room/`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run apps/web/src/table/table.css.test.ts apps/web/src/room/Room.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx biome lint apps/web/src/table/table.css.test.ts apps/web/src/room/Activity.tsx apps/web/src/room/Room.test.tsx
git add apps/web/src/table/table.css.test.ts apps/web/src/room/Activity.tsx apps/web/src/room/Room.test.tsx apps/web/src/leaderboard/leaderboard.css
git commit -m "fix(web): the floor's panel gives the shared activity log its name back

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: The table counts what it says (`eventSeq`)

**Files:**
- Modify: `games/blackjack/src/table.ts` (interface `TableView` ~line 126; field ~line 262; the 12 `this.lastEvent = …` assignments at lines 440, 476, 575, 629, 659, 704, 734, 799, 833, 850, 991, 1022; `view()` ~line 1046)
- Modify: `games/blackjack/src/index.ts:17`
- Test: `games/blackjack/src/table.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TableView.eventSeq: number` — 0 on a new table, +1 every time `lastEvent` is set, including to the same words.
  - `SETTLE_MS` exported from `@backroom/game-blackjack` (the readout drains the next-hand clock against it).

- [ ] **Step 1: Write the failing tests**

Append to `games/blackjack/src/table.test.ts`:

```ts
describe("what the table says", () => {
  /*
   * The browser keeps the log from the latest line alone, and it can only tell
   * a second "Ada is ready" from the same broadcast arriving twice if something
   * moves between them.
   */
  it("counts the same words said twice running as two things said", () => {
    const table = new Table("TEST1");
    seatTwo(table);
    table.setReady("a", true);
    expect(table.view().eventSeq).toBe(3);
    table.setReady("a", true);
    expect(table.view().lastEvent).toBe("Ada is ready");
    expect(table.view().eventSeq).toBe(4);
  });

  it("does not move for a look at the table that says nothing new", () => {
    const table = new Table("TEST1");
    seatTwo(table);
    expect(table.view().eventSeq).toBe(2);
    table.view();
    expect(table.view().eventSeq).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run games/blackjack/src/table.test.ts`
Expected: both new tests FAIL with `expected undefined to be 3` / `expected undefined to be 2`.

- [ ] **Step 3: Implement**

In `games/blackjack/src/table.ts`:

In `interface TableView`, directly after `lastEvent: string | null;`, add:

```ts
  /**
   * Moves on every time the table says something, the same words again
   * included. The activity log keys on it, so "Ada is ready" twice running is
   * two lines rather than one.
   */
  eventSeq: number;
```

In `class Table`, directly after `lastEvent: string | null = null;`, add:

```ts
  /** How many things the table has said, for telling a repeat from a rebroadcast. */
  eventSeq = 0;
```

Directly after the `get turnEndsAt()` getter, add:

```ts
  /**
   * Says what just happened.
   *
   * The only place lastEvent is set, so the counter cannot be forgotten at one
   * of the dozen places the table talks.
   */
  private say(text: string): void {
    this.lastEvent = text;
    this.eventSeq += 1;
  }
```

Replace every assignment, keeping the words exactly:

| Line | Old | New |
|---|---|---|
| 440 | ``this.lastEvent = `${seat.name} sat down`;`` | ``this.say(`${seat.name} sat down`);`` |
| 476 | ``this.lastEvent = `${seat.name} dropped out`;`` | ``this.say(`${seat.name} dropped out`);`` |
| 629 | `this.lastEvent = "Cards out";` | `this.say("Cards out");` |
| 659 | ``this.lastEvent = ready ? `${seat.name} is ready` : `${seat.name} is thinking again`;`` | ``this.say(ready ? `${seat.name} is ready` : `${seat.name} is thinking again`);`` |
| 704 | `this.lastEvent = "Waiting for another player";` | `this.say("Waiting for another player");` |
| 734 | ``this.lastEvent = `${seat.name} bust on ${worth.total}`;`` | ``this.say(`${seat.name} bust on ${worth.total}`);`` |
| 799 | ``this.lastEvent = `${seat.name} split`;`` | ``this.say(`${seat.name} split`);`` |
| 833 | ``this.lastEvent = `${seat.name} doubled`;`` | ``this.say(`${seat.name} doubled`);`` |
| 850 | ``this.lastEvent = `${seat.name} ran out of time`;`` | ``this.say(`${seat.name} ran out of time`);`` |
| 991 | ``this.lastEvent = dealer.bust ? `Dealer bust on ${dealer.total}` : `Dealer has ${dealer.total}`;`` | ``this.say(dealer.bust ? `Dealer bust on ${dealer.total}` : `Dealer has ${dealer.total}`);`` |
| 1022 | `this.lastEvent = "Place your bets";` | `this.say("Place your bets");` |

Lines 575–577 (in `bet`), replace:

```ts
    this.lastEvent = withdrawn
      ? `${seat.name} took their chips back`
      : `${seat.name} bet ${amount.toLocaleString("en-US")}`;
```

with:

```ts
    this.say(withdrawn ? `${seat.name} took their chips back` : `${seat.name} bet ${amount.toLocaleString("en-US")}`);
```

In `view()`, directly after `lastEvent: this.lastEvent,`, add:

```ts
      eventSeq: this.eventSeq,
```

Confirm no assignment was missed: `git grep -n "this.lastEvent =" -- games/blackjack/src/table.ts` must print exactly one line (inside `say`).

In `games/blackjack/src/index.ts`, replace `export { LAST_CALL_MS, Table, WINDOWS } from "./table.js";` with:

```ts
export { LAST_CALL_MS, SETTLE_MS, Table, WINDOWS } from "./table.js";
```

- [ ] **Step 4: Run the tests, typecheck, lint**

Run: `npx vitest run games/blackjack`
Expected: all PASS.
Run: `npm run typecheck`
Expected: no errors.
Run: `npx biome lint games/blackjack/src/table.ts games/blackjack/src/table.test.ts games/blackjack/src/index.ts`
Expected: no diagnostics.

- [ ] **Step 5: Commit**

```bash
git add games/blackjack/src/table.ts games/blackjack/src/table.test.ts games/blackjack/src/index.ts
git commit -m "feat(blackjack): count every sentence the table says, so the log keeps repeats

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: One place the felt asks its questions (`hands.ts`) and test fixtures

**Files:**
- Create: `apps/web/src/blackjack/hands.ts`
- Create: `apps/web/src/blackjack/fixtures.ts`
- Test: `apps/web/src/blackjack/hands.test.ts`

**Interfaces:**
- Consumes: `TableView` with `eventSeq` (Task 2); `value` from `@backroom/game-blackjack`.
- Produces (`hands.ts`):
  - `type SeatView = TableView["seats"][number]`, `type HandView = SeatView["hands"][number]`
  - `fmt(n: number): string`, `clockText(seconds: number): string` ("0:14")
  - `paidOut(seat: SeatView): number`
  - `isNatural(hand: HandView): boolean`
  - `availableTo(state: TableView, me: SeatView, chips: number | null, shownStake: number): number | null`
  - `type Offer = { ok: true; cost: number } | { ok: false; reason: string }`
  - `doubleOffer(hand: HandView, available: number | null): Offer`
  - `splitOffer(seat: SeatView, hand: HandView, available: number | null): Offer`
  - `chipRefusal(amount: number, shownStake: number, max: number, available: number | null, lastCall: boolean): string | null`
  - `nextSeatId(state: TableView): string | null`
  - `interface Tag { text: string; tone: "quiet" | "live" | "good" | "bad" | "chips" }`
  - `handTag(hand: HandView): Tag | null`, `seatTag(state: TableView, seat: SeatView): Tag | null`
- Produces (`fixtures.ts`, tests only): `card(rank, suit?)`, `hand(over?)`, `seat(id, name, over?)`, `view(over?)`, `yourTurn(ada?)`, `pairTurn()`, `splitTurn()`, `theirTurn()`, `settledHand()`.

- [ ] **Step 1: Write the fixtures**

Create `apps/web/src/blackjack/fixtures.ts`:

```ts
import type { Card, Rank, Suit, TableView } from "@backroom/game-blackjack";
import type { HandView, SeatView } from "./hands.js";

/*
 * Tables as the server describes them, for tests. Whole views rather than
 * casts, so a field the felt starts reading is a field these have to grow.
 */

export function card(rank: Rank, suit: Suit = "spades"): Card {
  return { rank, suit };
}

export function hand(over: Partial<HandView> = {}): HandView {
  return {
    bet: 0,
    cards: [],
    total: 0,
    soft: false,
    bust: false,
    done: false,
    outcome: null,
    returned: 0,
    fromSplit: false,
    ...over,
  };
}

export function seat(id: string, name: string, over: Partial<SeatView> = {}): SeatView {
  return {
    id,
    name,
    ready: false,
    connected: true,
    waiting: false,
    isBot: false,
    signedIn: true,
    avatar: null,
    accentColor: null,
    hands: [hand()],
    active: 0,
    bet: 0,
    purse: 0,
    ...over,
  };
}

/** Ada (seat "a", the host) and Bo, betting at a table for chips. */
export function view(over: Partial<TableView> = {}): TableView {
  return {
    code: "HG4ME",
    status: "lobby",
    phase: "betting",
    seats: [seat("a", "Ada"), seat("b", "Bo")],
    turnSeatId: null,
    turnEndsAt: null,
    turnMs: 20_000,
    hostId: "a",
    watching: 0,
    lastEvent: null,
    eventSeq: 0,
    dealer: { cards: [], total: 0, hidden: false },
    minBet: 100,
    maxBet: 10_000,
    forFun: false,
    bettingMs: 30_000,
    maxSeats: 6,
    waitingForPlayers: false,
    deadline: null,
    ...over,
  };
}

/** Ada to act on nine and seven against a dealer's ten, Bo stood on nineteen. */
export function yourTurn(ada: Partial<SeatView> = {}): TableView {
  return view({
    status: "playing",
    phase: "playing",
    turnSeatId: "a",
    turnEndsAt: Date.now() + 12_000,
    dealer: { cards: [card("10")], total: 10, hidden: true },
    seats: [
      seat("a", "Ada", {
        bet: 500,
        hands: [hand({ bet: 500, cards: [card("9", "hearts"), card("7", "clubs")], total: 16 })],
        ...ada,
      }),
      seat("b", "Bo", {
        bet: 250,
        hands: [hand({ bet: 250, cards: [card("10", "diamonds"), card("9")], total: 19, done: true })],
      }),
    ],
  });
}

/** Ada dealt a pair of eights, with the decision still to make. */
export function pairTurn(): TableView {
  return yourTurn({ hands: [hand({ bet: 500, cards: [card("8"), card("8", "hearts")], total: 16 })] });
}

/** Ada split eights: the first hand stood on eighteen, the second is being played. */
export function splitTurn(): TableView {
  return yourTurn({
    bet: 1_000,
    active: 1,
    hands: [
      hand({ bet: 500, cards: [card("8"), card("K", "diamonds")], total: 18, done: true, fromSplit: true }),
      hand({ bet: 500, cards: [card("8", "hearts"), card("3", "clubs"), card("9")], total: 20, fromSplit: true }),
    ],
  });
}

/** Bo to act on fourteen; Ada stood on nineteen. */
export function theirTurn(): TableView {
  return view({
    status: "playing",
    phase: "playing",
    turnSeatId: "b",
    turnEndsAt: Date.now() + 9_000,
    dealer: { cards: [card("10")], total: 10, hidden: true },
    seats: [
      seat("a", "Ada", {
        bet: 500,
        hands: [
          hand({
            bet: 500,
            cards: [card("9", "hearts"), card("7", "clubs"), card("3", "diamonds")],
            total: 19,
            done: true,
          }),
        ],
      }),
      seat("b", "Bo", {
        bet: 1_000,
        hands: [hand({ bet: 1_000, cards: [card("8", "clubs"), card("6", "hearts")], total: 14 })],
      }),
    ],
  });
}

/** The dealer made nineteen: Ada's blackjack paid, Bo bust. */
export function settledHand(): TableView {
  return view({
    status: "over",
    phase: "settled",
    deadline: Date.now() + 6_000,
    dealer: { cards: [card("10"), card("9", "clubs")], total: 19, hidden: false },
    seats: [
      seat("a", "Ada", {
        bet: 500,
        hands: [
          hand({
            bet: 500,
            cards: [card("A"), card("K", "hearts")],
            total: 21,
            soft: true,
            done: true,
            outcome: "blackjack",
            returned: 1_250,
          }),
        ],
      }),
      seat("b", "Bo", {
        bet: 1_000,
        hands: [
          hand({
            bet: 1_000,
            cards: [card("8", "clubs"), card("6", "hearts"), card("9", "diamonds")],
            total: 23,
            bust: true,
            done: true,
            outcome: "bust",
          }),
        ],
      }),
    ],
  });
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/blackjack/hands.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { card, hand, seat, settledHand, theirTurn, view, yourTurn } from "./fixtures.js";
import type { SeatView } from "./hands.js";
import {
  availableTo,
  chipRefusal,
  clockText,
  doubleOffer,
  handTag,
  nextSeatId,
  paidOut,
  seatTag,
  splitOffer,
} from "./hands.js";

describe("reading a hand", () => {
  it("adds up what a seat got back across every hand", () => {
    expect(paidOut(seat("a", "Ada", { hands: [hand({ returned: 1_000 }), hand({ returned: 500 })] }))).toBe(1_500);
  });

  it("reads a clock the way a table does", () => {
    expect(clockText(14)).toBe("0:14");
    expect(clockText(65)).toBe("1:05");
  });
});

describe("what a player can still put down", () => {
  it("is the purse at a for-fun table, less a stake shown ahead of the table", () => {
    const table = view({ forFun: true });
    const ada = seat("a", "Ada", { purse: 4_500, bet: 500 });
    expect(availableTo(table, ada, null, 500)).toBe(4_500);
    expect(availableTo(table, ada, null, 1_500)).toBe(3_500);
  });

  it("is the account's balance at a table for chips, and unknown for a guest", () => {
    const ada = seat("a", "Ada");
    expect(availableTo(view(), ada, 12_400, 0)).toBe(12_400);
    expect(availableTo(view(), ada, null, 0)).toBeNull();
  });
});

describe("doubling and splitting", () => {
  const two = hand({ bet: 500, cards: [card("9"), card("7")], total: 16 });

  it("offers a double on two cards, at the hand's stake", () => {
    expect(doubleOffer(two, 12_400)).toEqual({ ok: true, cost: 500 });
  });

  it("says why a double is out", () => {
    expect(doubleOffer(hand({ bet: 500, cards: [card("9"), card("2"), card("5")] }), 12_400)).toEqual({
      ok: false,
      reason: "3 cards",
    });
    expect(doubleOffer(two, 400)).toEqual({ ok: false, reason: "not enough" });
  });

  it("counts a king and a queen as a pair, as the table does", () => {
    const court = hand({ bet: 500, cards: [card("K"), card("Q", "hearts")], total: 20 });
    expect(splitOffer(seat("a", "Ada", { hands: [court] }), court, null)).toEqual({ ok: true, cost: 500 });
  });

  it("says why a split is out", () => {
    expect(splitOffer(seat("a", "Ada", { hands: [two] }), two, 12_400)).toEqual({ ok: false, reason: "no pair" });
    const eights = hand({ bet: 500, cards: [card("8"), card("8", "hearts")], fromSplit: true });
    expect(splitOffer(seat("a", "Ada", { hands: [eights, hand()] }), eights, 12_400)).toEqual({
      ok: false,
      reason: "once a seat",
    });
  });
});

describe("a chip that cannot be added", () => {
  it("says last call first, then the limit, then the balance", () => {
    expect(chipRefusal(100, 0, 10_000, 12_400, true)).toBe("Last call: chips can only come off now");
    expect(chipRefusal(1_000, 9_500, 10_000, 12_400, false)).toBe("1,000 more is past the 10,000 limit");
    expect(chipRefusal(500, 0, 10_000, 300, false)).toBe("You do not have 500 more to bet");
    expect(chipRefusal(500, 9_500, 10_000, 12_400, false)).toBeNull();
  });
});

describe("what a seat says about itself", () => {
  it("while betting", () => {
    const table = view({ seats: [seat("a", "Ada", { ready: true }), seat("b", "Bo", { bet: 250 }), seat("c", "Cy")] });
    expect(table.seats.map((one) => seatTag(table, one))).toEqual([
      { text: "Ready", tone: "live" },
      { text: "Not ready", tone: "quiet" },
      { text: "Yet to bet", tone: "quiet" },
    ]);
  });

  it("sitting out, waiting for the next hand, or gone", () => {
    const base = yourTurn();
    const table = {
      ...base,
      seats: [
        ...base.seats,
        seat("c", "Cy", { waiting: true }),
        seat("d", "Dee", { connected: false, bet: 100 }),
        seat("e", "Eli"),
      ],
    };
    expect(table.seats.slice(2).map((one) => seatTag(table, one)?.text)).toEqual(["Next hand", "Dropped", "Sat out"]);
  });

  it("while a hand is played: nothing on the seat acting, and what the others did", () => {
    const table = theirTurn();
    expect(table.seats.map((one) => seatTag(table, one))).toEqual([{ text: "Stood", tone: "quiet" }, null]);
  });

  it("names the seat the turn goes to next", () => {
    const table = view({
      status: "playing",
      phase: "playing",
      turnSeatId: "a",
      seats: [
        seat("a", "Ada", { bet: 500, hands: [hand({ bet: 500, cards: [card("9"), card("7")], total: 16 })] }),
        seat("b", "Bo", { bet: 250, hands: [hand({ bet: 250, cards: [card("5"), card("6")], total: 11 })] }),
      ],
    });
    expect(nextSeatId(table)).toBe("b");
    expect(seatTag(table, table.seats[1] as SeatView)).toEqual({ text: "Next", tone: "quiet" });
  });

  it("once it is over, in gold only for a payout", () => {
    const table = settledHand();
    expect(table.seats.map((one) => seatTag(table, one))).toEqual([
      { text: "Paid 750", tone: "chips" },
      { text: "Bust", tone: "bad" },
    ]);
    expect(handTag(hand({ bet: 500, done: true, outcome: "won", returned: 1_000 }))).toEqual({
      text: "Won 500",
      tone: "good",
    });
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run apps/web/src/blackjack/hands.test.ts`
Expected: FAIL — `Failed to resolve import "./hands.js"`.

- [ ] **Step 4: Implement**

Create `apps/web/src/blackjack/hands.ts`:

```ts
import type { TableView } from "@backroom/game-blackjack";
import { value } from "@backroom/game-blackjack";

/*
 * What the felt works out from the table's view before drawing anything.
 *
 * One module, so the readout, the seats, the controls, the keys and the rules
 * card ask the same questions of the same functions. A Double key and a lit
 * Double row that disagreed about whether you can double would be the table
 * contradicting itself.
 */

export type SeatView = TableView["seats"][number];
export type HandView = SeatView["hands"][number];

export const fmt = (n: number) => n.toLocaleString("en-US");

/** A clock the way a table reads one out: minutes, then two digits. */
export const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Everything a seat got back, across however many hands it played. */
export function paidOut(seat: SeatView): number {
  return seat.hands.reduce((total, hand) => total + hand.returned, 0);
}

/** Dealt twenty-one. A split hand that makes it is twenty-one and not a blackjack. */
export function isNatural(hand: HandView): boolean {
  return !hand.fromSplit && hand.cards.length === 2 && hand.total === 21;
}

/**
 * What this player could still put on the felt, or null when the browser does
 * not know.
 *
 * The purse at a for-fun table, the account's balance otherwise. Both have had
 * the table's stake taken already, so a stake shown ahead of the table's answer
 * is taken off here as well, or a chip would offer money already on the felt.
 */
export function availableTo(state: TableView, me: SeatView, chips: number | null, shownStake: number): number | null {
  const base = state.forFun ? me.purse : chips;
  return base === null ? null : base - (shownStake - me.bet);
}

/** A move on offer and what it costs, or the reason it is not on offer. */
export type Offer = { ok: true; cost: number } | { ok: false; reason: string };

export function doubleOffer(hand: HandView, available: number | null): Offer {
  // First two cards only: the rule, and the only moment doubling is a decision.
  if (hand.cards.length !== 2) {
    return { ok: false, reason: `${hand.cards.length} cards` };
  }
  if (available !== null && available < hand.bet) {
    return { ok: false, reason: "not enough" };
  }
  return { ok: true, cost: hand.bet };
}

export function splitOffer(seat: SeatView, hand: HandView, available: number | null): Offer {
  // Checked first because it is the answer that stays true for the rest of the hand.
  if (seat.hands.length > 1 || hand.fromSplit) {
    return { ok: false, reason: "once a seat" };
  }
  if (hand.cards.length !== 2) {
    return { ok: false, reason: `${hand.cards.length} cards` };
  }
  const [first, second] = hand.cards;
  // By value, not rank: a king and a queen are a pair, which is how the table counts.
  if (first === undefined || second === undefined || value([first]).total !== value([second]).total) {
    return { ok: false, reason: "no pair" };
  }
  if (available !== null && available < hand.bet) {
    return { ok: false, reason: "not enough" };
  }
  return { ok: true, cost: hand.bet };
}

/**
 * Why a chip cannot be added, or null when it can.
 *
 * Said on the chip before the press, because each of these is something the
 * browser can already see. The server still refuses every one of them.
 */
export function chipRefusal(
  amount: number,
  shownStake: number,
  max: number,
  available: number | null,
  lastCall: boolean,
): string | null {
  if (lastCall) {
    return "Last call: chips can only come off now";
  }
  if (shownStake + amount > max) {
    return `${fmt(amount)} more is past the ${fmt(max)} limit`;
  }
  if (available !== null && amount > available) {
    return `You do not have ${fmt(amount)} more to bet`;
  }
  return null;
}

/** The seat the turn goes to after the one acting, or null. */
export function nextSeatId(state: TableView): string | null {
  // The table's own order: everybody dealt in, which is everybody not waiting with a stake down.
  const inHand = state.seats.filter((seat) => !seat.waiting && seat.bet > 0);
  const at = inHand.findIndex((seat) => seat.id === state.turnSeatId);
  if (at === -1) {
    return null;
  }
  return inHand.slice(at + 1).find((seat) => seat.connected && seat.hands.some((hand) => !hand.done))?.id ?? null;
}

/** A small state on a seat or a hand, and the colour it is allowed. */
export interface Tag {
  text: string;
  tone: "quiet" | "live" | "good" | "bad" | "chips";
}

/** What became of one hand, or null while there is nothing to say. */
export function handTag(hand: HandView): Tag | null {
  switch (hand.outcome) {
    case "blackjack":
      // Gold, because what is being said is a payout, and a payout is chips.
      return { text: `Paid ${fmt(hand.returned - hand.bet)}`, tone: "chips" };
    case "won":
      return { text: `Won ${fmt(hand.returned - hand.bet)}`, tone: "good" };
    case "push":
      return { text: "Push", tone: "quiet" };
    case "lost":
      return { text: "Lost", tone: "bad" };
    case "bust":
      return { text: "Bust", tone: "bad" };
    default:
      if (!hand.done) {
        return null;
      }
      return { text: isNatural(hand) ? "Blackjack" : "Stood", tone: "quiet" };
  }
}

/** What a seat's plate says about it, or null when the plate already says it. */
export function seatTag(state: TableView, seat: SeatView): Tag | null {
  // A dimmed seat says why, or a dim plate reads as a broken one.
  if (seat.waiting) {
    return { text: "Next hand", tone: "quiet" };
  }
  if (!seat.connected) {
    return { text: "Dropped", tone: "quiet" };
  }
  if (state.phase === "betting") {
    if (seat.ready) {
      return { text: "Ready", tone: "live" };
    }
    return { text: seat.bet > 0 ? "Not ready" : "Yet to bet", tone: "quiet" };
  }
  if (seat.bet === 0) {
    return { text: "Sat out", tone: "quiet" };
  }
  // A lit seat is already saying it is acting, and a split seat's boxes each speak for themselves.
  if (seat.hands.length > 1 || state.turnSeatId === seat.id) {
    return null;
  }
  const hand = seat.hands[0];
  if (hand === undefined) {
    return null;
  }
  const said = handTag(hand);
  if (said !== null) {
    return said;
  }
  return nextSeatId(state) === seat.id ? { text: "Next", tone: "quiet" } : null;
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run apps/web/src/blackjack/hands.test.ts`
Expected: all PASS.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck
npx biome lint apps/web/src/blackjack/hands.ts apps/web/src/blackjack/hands.test.ts apps/web/src/blackjack/fixtures.ts
git add apps/web/src/blackjack/hands.ts apps/web/src/blackjack/hands.test.ts apps/web/src/blackjack/fixtures.ts
git commit -m "feat(web): one place the blackjack felt asks what a hand can do

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: The readout (T2)

**Files:**
- Create: `apps/web/src/blackjack/Readout.tsx`
- Test: `apps/web/src/blackjack/Readout.test.tsx`

**Interfaces:**
- Consumes: `fmt`, `clockText`, `paidOut` (Task 3); `LAST_CALL_MS`, `SETTLE_MS` (Task 2); `type Move` from `./useIntent.js`.
- Produces:
  - `interface ReadoutInput { state: TableView; seatId: string | null; mine: number; chips: number | null; move: Move | null; left: number | null; turnLeft: number | null }`
  - `interface Stat { term: string; value: string; chips: boolean }`
  - `interface ReadoutModel { label: string; figure: string; tone: "plain" | "chips" | "good" | "bad"; note: string | null; stats: Stat[]; clock: { part: number; chips: boolean } | null }`
  - `readoutFor(input: ReadoutInput): ReadoutModel`
  - `Readout({ model }: { model: ReadoutModel })` rendering `section.readout.bj__read[aria-label="This hand"]`, `.bj__clock` (+`--chips`) with `--t`, `.bj__label`, `.bj__figure.bj__figure--{tone}`, `.bj__note`, `dl.bj__stats` with `dd.bj__gold` for chips.

What it shows, per the spec's table:

| State | Label / figure | Stats | Clock |
|---|---|---|---|
| Betting, seated | "Your stake" / stake, gold | Balance (Purse at for-fun), gold; Table min–max; Cards out / Last call | betting window, gold |
| Betting, watching | "On the felt" / total staked, gold | Table; Cards out / Last call | betting window, gold |
| Your turn | "Your hand" or "Hand N of M" / total; note "soft" or "a card is coming" | On it / On this hand, gold; Dealer shows; You have | turn, neon |
| Someone else's turn (also watching) | "Bo's hand" or "Bo, hand N of M" / their total | On it, gold; Dealer shows; Bo has | turn, neon |
| Settled, in the hand | "This hand" / +net good, −net bad, "Push"; note "3 to 2" or "across 2 hands" | Back, gold; Dealer; Next hand | next hand, neon |
| Settled, sat out | "This hand" / "Sat out" | Dealer; Next hand | next hand |
| Settled, watching | "Dealer has" / dealer total | Next hand | next hand |

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/blackjack/Readout.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { hand, seat, settledHand, splitTurn, theirTurn, view, yourTurn } from "./fixtures.js";
import type { ReadoutInput } from "./Readout.js";
import { Readout, readoutFor } from "./Readout.js";

const input = (over: Partial<ReadoutInput>): ReadoutInput => ({
  state: view(),
  seatId: "a",
  mine: 0,
  chips: 12_400,
  move: null,
  left: null,
  turnLeft: null,
  ...over,
});

describe("the readout while betting", () => {
  it("makes your stake the figure, in gold, with the balance and the table's limits beside it", () => {
    const model = readoutFor(input({ mine: 500, left: 14 }));
    expect(model.label).toBe("Your stake");
    expect(model.figure).toBe("500");
    expect(model.tone).toBe("chips");
    expect(model.stats).toEqual([
      { term: "Balance", value: "12,400", chips: true },
      { term: "Table", value: "100–10,000", chips: false },
      { term: "Cards out", value: "0:14", chips: false },
    ]);
    expect(model.clock?.chips).toBe(true);
    expect(model.clock?.part).toBeCloseTo(0.467, 3);
  });

  it("says last call when it comes", () => {
    const model = readoutFor(input({ mine: 500, left: 3 }));
    expect(model.stats.at(-1)).toEqual({ term: "Last call", value: "0:03", chips: false });
  });

  it("shows the purse at a for-fun table", () => {
    const state = view({ forFun: true, seats: [seat("a", "Ada", { purse: 4_500 }), seat("b", "Bo")] });
    expect(readoutFor(input({ state })).stats[0]).toEqual({ term: "Purse", value: "4,500", chips: true });
  });
});

describe("the readout while a hand is played", () => {
  it("makes your total the figure on your turn, with what is on it and what the dealer shows", () => {
    const model = readoutFor(input({ state: yourTurn(), turnLeft: 12 }));
    expect(model.label).toBe("Your hand");
    expect(model.figure).toBe("16");
    expect(model.tone).toBe("plain");
    expect(model.note).toBeNull();
    expect(model.stats).toEqual([
      { term: "On it", value: "500", chips: true },
      { term: "Dealer shows", value: "10", chips: false },
      { term: "You have", value: "0:12", chips: false },
    ]);
    expect(model.clock).toEqual({ part: 0.6, chips: false });
  });

  it("says soft, and says a card is coming while one is", () => {
    const soft = yourTurn({ hands: [hand({ bet: 500, total: 17, soft: true })] });
    expect(readoutFor(input({ state: soft })).note).toBe("soft");
    expect(readoutFor(input({ state: yourTurn(), move: "hit" })).note).toBe("a card is coming");
  });

  it("follows the hand being played after a split, and that hand's stake", () => {
    const model = readoutFor(input({ state: splitTurn() }));
    expect(model.label).toBe("Hand 2 of 2");
    expect(model.figure).toBe("20");
    expect(model.stats[0]).toEqual({ term: "On this hand", value: "500", chips: true });
  });

  it("follows somebody else's hand on their turn, under their name", () => {
    const model = readoutFor(input({ state: theirTurn(), turnLeft: 9 }));
    expect(model.label).toBe("Bo's hand");
    expect(model.figure).toBe("14");
    expect(model.stats).toEqual([
      { term: "On it", value: "1,000", chips: true },
      { term: "Dealer shows", value: "10", chips: false },
      { term: "Bo has", value: "0:09", chips: false },
    ]);
  });
});

describe("the readout once the hand is over", () => {
  it("gives the net in the good colour, and what came back in gold", () => {
    const model = readoutFor(input({ state: settledHand(), left: 5 }));
    expect(model.label).toBe("This hand");
    expect(model.figure).toBe("+750");
    expect(model.tone).toBe("good");
    expect(model.note).toBe("3 to 2");
    expect(model.stats).toEqual([
      { term: "Back", value: "1,250", chips: true },
      { term: "Dealer", value: "19", chips: false },
      { term: "Next hand", value: "0:05", chips: false },
    ]);
  });

  it("gives a loss in the bad colour", () => {
    const model = readoutFor(input({ state: settledHand(), seatId: "b" }));
    expect(model.figure).toBe("−1,000");
    expect(model.tone).toBe("bad");
  });

  it("calls a stake that came back a push, and a hand sat out what it was", () => {
    const push = view({
      phase: "settled",
      seats: [seat("a", "Ada", { bet: 500, hands: [hand({ bet: 500, outcome: "push", returned: 500, done: true })] })],
    });
    expect(readoutFor(input({ state: push }))).toMatchObject({ figure: "Push", tone: "plain" });
    const out = view({ phase: "settled", seats: [seat("a", "Ada")] });
    expect(readoutFor(input({ state: out }))).toMatchObject({ figure: "Sat out", tone: "plain" });
  });
});

describe("the readout on screen", () => {
  it("lights only a chips figure gold, and drains its clock along the top", () => {
    const { container } = render(<Readout model={readoutFor(input({ mine: 500, left: 14 }))} />);
    expect(container.querySelector(".bj__figure--chips")?.textContent).toBe("500");
    expect(container.querySelectorAll(".bj__gold")).toHaveLength(1);
    const clock = container.querySelector(".bj__clock");
    expect(clock?.classList.contains("bj__clock--chips")).toBe(true);
    expect(clock?.getAttribute("style")).toContain("--t: 47%");
  });

  it("colours nothing on a total", () => {
    const { container } = render(<Readout model={readoutFor(input({ state: yourTurn(), turnLeft: 12 }))} />);
    expect(container.querySelector(".bj__figure--plain")?.textContent).toBe("16");
    expect(container.querySelector(".bj__clock--chips")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run apps/web/src/blackjack/Readout.test.tsx`
Expected: FAIL — `Failed to resolve import "./Readout.js"`.

- [ ] **Step 3: Implement**

Create `apps/web/src/blackjack/Readout.tsx`:

```tsx
import type { TableView } from "@backroom/game-blackjack";
import { LAST_CALL_MS, SETTLE_MS } from "@backroom/game-blackjack";
import type { CSSProperties } from "react";
import type { SeatView } from "./hands.js";
import { clockText, fmt, paidOut } from "./hands.js";
import type { Move } from "./useIntent.js";

export interface ReadoutInput {
  state: TableView;
  seatId: string | null;
  /** The stake to show: this player's own last press until the table agrees. */
  mine: number;
  /** The account's balance, or null for a guest. */
  chips: number | null;
  /** A move sent and not yet answered. */
  move: Move | null;
  /** Seconds left on the table's deadline: the betting window, or the next hand. */
  left: number | null;
  /** Seconds left on whoever's turn it is. */
  turnLeft: number | null;
}

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
  /** How much of the clock is left, 0 to 1, and whether it is counting down on chips. */
  clock: { part: number; chips: boolean } | null;
}

/** A fraction of a clock, from the seconds left and how long it started at. */
function part(seconds: number | null, of: number): number | null {
  return seconds === null ? null : Math.max(0, Math.min(1, (seconds * 1000) / Math.max(1, of)));
}

/**
 * The one figure this player is deciding about, and what backs it up.
 *
 * Worked out here rather than in the component so every state the table can be
 * in has a test that says what the screen says in it.
 */
export function readoutFor({ state, seatId, mine, chips, move, left, turnLeft }: ReadoutInput): ReadoutModel {
  const me = state.seats.find((seat) => seat.id === seatId) ?? null;
  if (state.phase === "betting") {
    return betting(state, me, mine, chips, left);
  }
  if (state.phase === "playing") {
    return playing(state, seatId, move, turnLeft);
  }
  // The dealer's own turn is played in the same update that settles the hand.
  return settled(state, me, left);
}

function betting(
  state: TableView,
  me: SeatView | null,
  mine: number,
  chips: number | null,
  left: number | null,
): ReadoutModel {
  const lastCall = left !== null && left <= LAST_CALL_MS / 1000;
  const stats: Stat[] = [];
  if (me !== null && state.forFun) {
    stats.push({ term: "Purse", value: fmt(me.purse), chips: true });
  } else if (me !== null && chips !== null) {
    // Beside the stake, because deciding how much to put down is when it matters.
    stats.push({ term: "Balance", value: fmt(chips), chips: true });
  }
  stats.push({ term: "Table", value: `${fmt(state.minBet)}–${fmt(state.maxBet)}`, chips: false });
  if (left !== null) {
    stats.push({ term: lastCall ? "Last call" : "Cards out", value: clockText(left), chips: false });
  }
  const clock = part(left, state.bettingMs);
  return {
    label: me === null ? "On the felt" : "Your stake",
    figure: fmt(me === null ? state.seats.reduce((total, seat) => total + seat.bet, 0) : mine),
    tone: "chips",
    // A table for chips holds rather than deals for one player, and says so.
    note: state.waitingForPlayers ? "waiting for a player" : null,
    stats,
    clock: clock === null ? null : { part: clock, chips: true },
  };
}

function playing(state: TableView, seatId: string | null, move: Move | null, turnLeft: number | null): ReadoutModel {
  const seat = state.seats.find((one) => one.id === state.turnSeatId) ?? null;
  if (seat === null) {
    return { label: "Dealer", figure: String(state.dealer.total), tone: "plain", note: null, stats: [], clock: null };
  }
  const hand = seat.hands[seat.active] ?? seat.hands[0];
  const yours = seat.id === seatId;
  const split = seat.hands.length > 1;
  const which = `${seat.active + 1} of ${seat.hands.length}`;
  const label = yours ? (split ? `Hand ${which}` : "Your hand") : split ? `${seat.name}, hand ${which}` : `${seat.name}'s hand`;
  const stats: Stat[] = [
    { term: split ? "On this hand" : "On it", value: fmt(hand?.bet ?? 0), chips: true },
    { term: "Dealer shows", value: String(state.dealer.total), chips: false },
  ];
  if (turnLeft !== null) {
    stats.push({ term: yours ? "You have" : `${seat.name} has`, value: clockText(turnLeft), chips: false });
  }
  const clock = part(turnLeft, state.turnMs);
  const coming = yours && (move === "hit" || move === "double");
  return {
    label,
    figure: String(hand?.total ?? 0),
    tone: "plain",
    // Said while a card is in the air, so the total is not read as the last word.
    note: coming ? "a card is coming" : hand?.soft === true && !hand.bust ? "soft" : null,
    stats,
    clock: clock === null ? null : { part: clock, chips: false },
  };
}

function settled(state: TableView, me: SeatView | null, left: number | null): ReadoutModel {
  const clock = part(left, SETTLE_MS);
  const next: Stat[] = left === null ? [] : [{ term: "Next hand", value: clockText(left), chips: false }];
  const dealer: Stat = { term: "Dealer", value: String(state.dealer.total), chips: false };
  const drain = clock === null ? null : { part: clock, chips: false };
  if (me === null) {
    return { label: "Dealer has", figure: String(state.dealer.total), tone: "plain", note: null, stats: next, clock: drain };
  }
  if (me.bet === 0 || me.waiting) {
    return { label: "This hand", figure: "Sat out", tone: "plain", note: null, stats: [dealer, ...next], clock: drain };
  }
  const back = paidOut(me);
  // One deal, one answer: a split that wins one hand and loses the other is its net.
  const net = back - me.bet;
  return {
    label: "This hand",
    figure: net > 0 ? `+${fmt(net)}` : net < 0 ? `−${fmt(-net)}` : "Push",
    tone: net > 0 ? "good" : net < 0 ? "bad" : "plain",
    note:
      me.hands.length > 1 ? `across ${me.hands.length} hands` : me.hands[0]?.outcome === "blackjack" ? "3 to 2" : null,
    stats: [{ term: "Back", value: fmt(back), chips: true }, dealer, ...next],
    clock: drain,
  };
}

export function Readout({ model }: { model: ReadoutModel }) {
  return (
    <section className="readout bj__read" aria-label="This hand">
      {model.clock !== null ? (
        <span
          className={`bj__clock${model.clock.chips ? " bj__clock--chips" : ""}`}
          style={{ "--t": `${Math.round(model.clock.part * 100)}%` } as CSSProperties}
          aria-hidden="true"
        />
      ) : null}
      <div className="bj__big">
        <span className="bj__label">{model.label}</span>
        <span className="bj__figure-row">
          <span className={`bj__figure bj__figure--${model.tone}`}>{model.figure}</span>
          {model.note !== null ? <small className="bj__note">{model.note}</small> : null}
        </span>
      </div>
      <dl className="bj__stats">
        {model.stats.map((stat) => (
          <div key={stat.term}>
            <dt>{stat.term}</dt>
            <dd className={stat.chips ? "bj__gold" : undefined}>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run apps/web/src/blackjack/Readout.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck
npx biome lint apps/web/src/blackjack/Readout.tsx apps/web/src/blackjack/Readout.test.tsx
git add apps/web/src/blackjack/Readout.tsx apps/web/src/blackjack/Readout.test.tsx
git commit -m "feat(web): a readout of what this blackjack hand is worth

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: The dealer and the seats (T1, splits)

**Files:**
- Create: `apps/web/src/blackjack/Seats.tsx`
- Test: `apps/web/src/blackjack/Seats.test.tsx`

**Interfaces:**
- Consumes: `fmt`, `paidOut`, `seatTag`, `handTag`, `type Tag`, `type HandView`, `type SeatView` (Task 3); `Hand` from `./Cards.js`; `useBumped` from `./useIntent.js`; `Avatar` from `../game/Avatar.js`; `TurnRing` from `../game/TurnRing.js`; `ChipStack` from `../chips/ChipStack.js`.
- Produces:
  - `Dealer({ dealer, watching }: { dealer: TableView["dealer"]; watching: number })` → `div.bj__dealer` with `p.bj__dealer-who`, two `span.bj__slot` placeholders when there are no cards.
  - `Seats({ state, seatId, stake, arriving }: { state: TableView; seatId: string | null; stake: number; arriving: boolean })` → `div.bj__seats` holding your `article.bj__seat.bj__seat--mine` first and the rest in `div.bj__others` as `article.bj__seat.bj__seat--other`. Modifiers: `bj__seat--turn`, `bj__seat--out`, `bj__seat--paid`, and for your seat only `bj__seat--split` / `bj__seat--four`. Your split grows `div.bj__boxes > div.bj__box` (`--live` / `--wait`) with `.bj__box-top` (label + `<b>` stake) and `.bj__box-play`; somebody else's split is `div.bj__minis > span.bj__mini` (`--live`) with an `<i>` hairline between. Tags are `span.tag.bj__tag` (+ `tag--live`, `tag--chips`, `bj__tag--good`, `bj__tag--bad`). Totals are `p.bj__count` (+ `--bad`, `--chip`, `--ticked`). Your stake pile is `span.bj__pile` (+ `--dropped`).
  - `stake` is the stake shown on your plate while betting (the optimistic one); `arriving` is true while your Hit or Double is in the air.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/blackjack/Seats.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { card, hand, seat, settledHand, splitTurn, view, yourTurn } from "./fixtures.js";
import { Dealer, Seats } from "./Seats.js";

describe("the seats", () => {
  it("put your seat first, marked as yours, and everybody else after it", () => {
    const { container } = render(<Seats state={yourTurn()} seatId="b" stake={0} arriving={false} />);
    const plates = screen.getAllByRole("article");
    expect(plates.map((plate) => plate.getAttribute("aria-label"))).toEqual(["Bo (you)", "Ada"]);
    expect(plates[0]?.classList.contains("bj__seat--mine")).toBe(true);
    expect(container.querySelector(".bj__others")?.textContent).toContain("Ada");
  });

  it("light the seat whose turn it is", () => {
    render(<Seats state={yourTurn()} seatId="b" stake={0} arriving={false} />);
    expect(screen.getByRole("article", { name: "Ada" }).classList.contains("bj__seat--turn")).toBe(true);
    expect(screen.getByRole("article", { name: "Bo (you)" }).classList.contains("bj__seat--turn")).toBe(false);
  });

  it("dim a seat waiting for the next hand or gone, and say which, rather than hide it", () => {
    const base = yourTurn();
    const state = {
      ...base,
      seats: [...base.seats, seat("c", "Cy", { waiting: true }), seat("d", "Dee", { connected: false, bet: 100 })],
    };
    render(<Seats state={state} seatId="a" stake={0} arriving={false} />);
    const cy = screen.getByRole("article", { name: "Cy" });
    const dee = screen.getByRole("article", { name: "Dee" });
    expect(cy.classList.contains("bj__seat--out")).toBe(true);
    expect(cy.textContent).toContain("Next hand");
    expect(dee.classList.contains("bj__seat--out")).toBe(true);
    expect(dee.textContent).toContain("Dropped");
  });

  it("show your stake from the press, before the table has agreed to it", () => {
    render(<Seats state={view()} seatId="a" stake={500} arriving={false} />);
    const mine = screen.getByRole("article", { name: "Ada (you)" });
    expect(mine.querySelector(".bj__bet")?.textContent).toBe("500");
    expect(mine.querySelector(".bj__pile")).not.toBeNull();
  });

  it("put a card on its way face down on your hand while a hit is in the air", () => {
    render(<Seats state={yourTurn()} seatId="a" stake={0} arriving />);
    const mine = screen.getByRole("article", { name: "Ada (you)" });
    expect(mine.querySelectorAll(".bj-card")).toHaveLength(3);
    expect(mine.querySelector(".bj-card--down")).not.toBeNull();
  });

  it("grow a box per hand on your split seat, lighting the one being played", () => {
    const { container } = render(<Seats state={splitTurn()} seatId="a" stake={0} arriving={false} />);
    const mine = screen.getByRole("article", { name: "Ada (you)" });
    expect(mine.classList.contains("bj__seat--split")).toBe(true);
    const boxes = [...container.querySelectorAll(".bj__box")];
    expect(boxes.map((box) => box.className)).toEqual(["bj__box bj__box--wait", "bj__box bj__box--live"]);
    expect(boxes.map((box) => box.querySelector(".bj__box-top b")?.textContent)).toEqual(["500", "500"]);
    expect(boxes[0]?.textContent).toContain("Stood");
  });

  it("show somebody else's split as two small hands on their plate", () => {
    const state = yourTurn();
    const bo = seat("b", "Bo", {
      bet: 1_000,
      hands: [
        hand({ bet: 500, cards: [card("A"), card("9")], total: 20, fromSplit: true, done: true }),
        hand({ bet: 500, cards: [card("A", "hearts"), card("6")], total: 17, fromSplit: true }),
      ],
    });
    const { container } = render(
      <Seats state={{ ...state, seats: [state.seats[0] ?? seat("a", "Ada"), bo] }} seatId="a" stake={0} arriving={false} />,
    );
    expect(container.querySelectorAll(".bj__seat--other .bj__mini")).toHaveLength(2);
    expect(container.querySelector(".bj__seat--other.bj__seat--split")).toBeNull();
  });

  it("say a payout in gold and glow the seat it went to", () => {
    render(<Seats state={settledHand()} seatId="a" stake={0} arriving={false} />);
    const mine = screen.getByRole("article", { name: "Ada (you)" });
    expect(mine.classList.contains("bj__seat--paid")).toBe(true);
    const paid = [...mine.querySelectorAll(".bj__tag")].find((tag) => tag.textContent === "Paid 750");
    expect(paid?.classList.contains("tag--chips")).toBe(true);
    const bust = screen.getByRole("article", { name: "Bo" }).querySelector(".bj__tag");
    expect(bust?.classList.contains("bj__tag--bad")).toBe(true);
  });
});

describe("the dealer", () => {
  it("keeps room for two cards before the deal, and says who is watching", () => {
    const { container } = render(<Dealer dealer={{ cards: [], total: 0, hidden: false }} watching={2} />);
    expect(container.querySelectorAll(".bj__slot")).toHaveLength(2);
    expect(container.textContent).toContain("2 watching");
  });

  it("shows the up card and a card face down until the dealer plays", () => {
    render(<Dealer dealer={{ cards: [card("10")], total: 10, hidden: true }} watching={0} />);
    expect(screen.getByRole("img", { name: "10 of spades" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "face down" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run apps/web/src/blackjack/Seats.test.tsx`
Expected: FAIL — `Failed to resolve import "./Seats.js"`.

- [ ] **Step 3: Implement**

Create `apps/web/src/blackjack/Seats.tsx`:

```tsx
import type { TableView } from "@backroom/game-blackjack";
import { Fragment } from "react";
import { ChipStack } from "../chips/ChipStack.js";
import { Avatar } from "../game/Avatar.js";
import { TurnRing } from "../game/TurnRing.js";
import { Hand } from "./Cards.js";
import type { HandView, SeatView, Tag } from "./hands.js";
import { fmt, handTag, paidOut, seatTag } from "./hands.js";
import { useBumped } from "./useIntent.js";

/** The house, on its own patch at the head of the table. */
export function Dealer({ dealer, watching }: { dealer: TableView["dealer"]; watching: number }) {
  return (
    <div className="bj__dealer">
      <p className="bj__dealer-who">
        Dealer
        {dealer.cards.length > 0 ? <b>{dealer.total}</b> : null}
        {watching > 0 ? (
          <span className="bj__watchers">{watching === 1 ? "1 watching" : `${watching} watching`}</span>
        ) : null}
      </p>
      {/* Everything past the up card arrives when the dealer turns over, so it
          is turned rather than dealt. */}
      {dealer.cards.length === 0 ? (
        <Empty />
      ) : (
        <Hand cards={dealer.cards} hidden={dealer.hidden} turnedFrom={dealer.hidden ? undefined : 1} />
      )}
    </div>
  );
}

/** Where two cards will go, so a hand between deals keeps its height and nothing jumps. */
function Empty() {
  return (
    <span className="bj-hand" aria-hidden="true">
      <span className="bj__slot" />
      <span className="bj__slot" />
    </span>
  );
}

/**
 * Everybody at the table, yours first.
 *
 * Yours is the hand being read, so it gets the big cards; everybody else is a
 * compact plate. The felt scrolls when there are more than fit, never the page.
 */
export function Seats({
  state,
  seatId,
  stake,
  arriving,
}: {
  state: TableView;
  seatId: string | null;
  /** Your stake as shown: your own last press until the table agrees. */
  stake: number;
  /** A card you asked for is in the air. */
  arriving: boolean;
}) {
  const mine = state.seats.find((seat) => seat.id === seatId) ?? null;
  const others = state.seats.filter((seat) => seat.id !== seatId);
  return (
    <div className="bj__seats">
      {mine !== null ? <Plate state={state} seat={mine} mine stake={stake} arriving={arriving} /> : null}
      {others.length > 0 ? (
        <div className="bj__others">
          {others.map((seat) => (
            <Plate key={seat.id} state={state} seat={seat} mine={false} stake={seat.bet} arriving={false} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Plate({
  state,
  seat,
  mine,
  stake,
  arriving,
}: {
  state: TableView;
  seat: SeatView;
  mine: boolean;
  stake: number;
  arriving: boolean;
}) {
  const turn = state.turnSeatId === seat.id;
  const split = seat.hands.length > 1;
  const tag = seatTag(state, seat);
  // Only a stake is this player's to show early; every other figure is the table's.
  const bet = mine && state.phase === "betting" ? stake : seat.bet;
  const hand = seat.hands[0];
  const className = [
    "bj__seat",
    mine ? "bj__seat--mine" : "bj__seat--other",
    turn ? "bj__seat--turn" : "",
    seat.waiting || !seat.connected ? "bj__seat--out" : "",
    mine && split ? "bj__seat--split" : "",
    mine && seat.hands.length > 2 ? "bj__seat--four" : "",
    // Only on the way in. A loss gets nothing, which is quieter to sit through and truer.
    state.phase === "settled" && paidOut(seat) > seat.bet ? "bj__seat--paid" : "",
  ]
    .filter((name) => name !== "")
    .join(" ");

  return (
    <article className={className} aria-label={mine ? `${seat.name} (you)` : seat.name}>
      <header className="bj__seat-head">
        {/* The ring poker draws, round the same thing: how long this seat has
            before the table plays the hand for them. */}
        <span className="bj__face">
          <Avatar name={seat.name} avatar={seat.avatar} accentColor={seat.accentColor} />
          {turn ? <TurnRing endsAt={state.turnEndsAt} turnMs={state.turnMs} /> : null}
        </span>
        <span className="bj__name">
          {seat.name}
          {mine ? " (you)" : ""}
        </span>
        {mine && tag !== null ? <TagMark tag={tag} /> : null}
        {bet > 0 ? (
          <span className="bj__bet">{fmt(bet)}</span>
        ) : state.forFun ? (
          // Play money lives at the table, so the table is the only place to show it.
          <span className="bj__purse">{fmt(seat.purse)}</span>
        ) : null}
      </header>
      {split ? (
        mine ? (
          <Boxes state={state} seat={seat} arriving={arriving} />
        ) : (
          <Minis state={state} seat={seat} />
        )
      ) : hand !== undefined ? (
        <div className="bj__play">
          {mine && bet > 0 ? <Pile amount={bet} /> : null}
          <HandOrEmpty hand={hand} arriving={mine && turn && arriving} />
          {!mine && tag !== null ? <TagMark tag={tag} /> : null}
          <Count hand={hand} />
        </div>
      ) : null}
    </article>
  );
}

/**
 * Your split: one plate, a box per hand.
 *
 * The box the controls act on is lit; the other steps back while it waits,
 * because "your turn" no longer says which cards you are being asked about.
 */
function Boxes({ state, seat, arriving }: { state: TableView; seat: SeatView; arriving: boolean }) {
  const turn = state.turnSeatId === seat.id;
  const four = seat.hands.length > 2;
  return (
    <div className="bj__boxes">
      {seat.hands.map((hand, index) => {
        const live = turn && seat.active === index;
        const tag = handTag(hand);
        return (
          <div
            // Position is the identity: a seat's hands never reorder, and two can hold the same cards.
            // biome-ignore lint/suspicious/noArrayIndexKey: hands are append-only
            key={index}
            className={`bj__box${live ? " bj__box--live" : turn ? " bj__box--wait" : ""}`}
          >
            <span className="bj__box-top">
              {four ? `H${index + 1}` : `Hand ${index + 1}`}
              <b>{fmt(hand.bet)}</b>
            </span>
            <span className="bj__box-play">
              <HandOrEmpty hand={hand} arriving={live && arriving} />
              <Count hand={hand} />
            </span>
            {tag !== null ? <TagMark tag={tag} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Somebody else's split, on a compact plate: two little hands and a hairline between. */
function Minis({ state, seat }: { state: TableView; seat: SeatView }) {
  const turn = state.turnSeatId === seat.id;
  return (
    <div className="bj__minis">
      {seat.hands.map((hand, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: hands are append-only
        <Fragment key={index}>
          {index > 0 ? <i aria-hidden="true" /> : null}
          <span className={`bj__mini${turn && seat.active === index ? " bj__mini--live" : ""}`}>
            <Hand cards={hand.cards} />
            <Count hand={hand} />
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function HandOrEmpty({ hand, arriving }: { hand: HandView; arriving: boolean }) {
  if (hand.cards.length === 0 && !arriving) {
    return <Empty />;
  }
  return <Hand cards={hand.cards} arriving={arriving} />;
}

/** The stake as chips, jumping when it grows, so a chip added is a chip seen landing. */
function Pile({ amount }: { amount: number }) {
  const dropped = useBumped(amount, 320);
  return (
    <span className={`bj__pile${dropped ? " bj__pile--dropped" : ""}`}>
      <ChipStack amount={amount} width={30} />
    </span>
  );
}

const TONE: Record<Tag["tone"], string> = {
  quiet: "tag",
  live: "tag tag--live",
  good: "tag bj__tag--good",
  bad: "tag bj__tag--bad",
  chips: "tag tag--chips",
};

function TagMark({ tag }: { tag: Tag }) {
  // Keyed on the words, so a new state arrives rather than being there all along.
  return (
    <span key={tag.text} className={`${TONE[tag.tone]} bj__tag`}>
      {tag.text}
    </span>
  );
}

/**
 * What a hand is worth, beside the cards it is worth it on.
 *
 * Its own component only because it has to notice when it changes: a total
 * that ticks when a card lands is a number you watched become true.
 */
function Count({ hand }: { hand: HandView }) {
  const ticked = useBumped(hand.total);
  if (hand.cards.length === 0) {
    return null;
  }
  // Only two totals are coloured: gone past twenty-one, and paid as a blackjack.
  const tone = hand.bust ? " bj__count--bad" : hand.outcome === "blackjack" ? " bj__count--chip" : "";
  return (
    <p className={`bj__count${tone}${ticked ? " bj__count--ticked" : ""}`}>
      <span className="bj__count-total">{hand.total}</span>
      {hand.soft && !hand.bust ? <span className="bj__count-soft">soft</span> : null}
    </p>
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run apps/web/src/blackjack/Seats.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck
npx biome lint apps/web/src/blackjack/Seats.tsx apps/web/src/blackjack/Seats.test.tsx
git add apps/web/src/blackjack/Seats.tsx apps/web/src/blackjack/Seats.test.tsx
git commit -m "feat(web): blackjack seat plates, yours first, with a box per split hand

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: The big moments (T5)

**Files:**
- Create: `apps/web/src/blackjack/Moments.tsx`
- Test: `apps/web/src/blackjack/Moments.test.tsx`

**Interfaces:**
- Consumes: `isNatural`, `type SeatView` (Task 3).
- Produces:
  - `MOMENT_MS = 1600`
  - `useMoment(count: number, ms?: number): boolean` — true for `ms` after `count` rises; never on mount; false at once if `count` falls.
  - `Moments({ me }: { me: SeatView | null })` → `p.bj__banner` "Blackjack" once when your one hand is a natural; `p.bj__stamp` "Bust" once each time another of your hands busts. Both `aria-hidden` (the readout and tags already say it).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/blackjack/Moments.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { card, hand, seat } from "./fixtures.js";
import { MOMENT_MS, Moments } from "./Moments.js";

const natural = hand({ bet: 500, cards: [card("A"), card("K", "hearts")], total: 21, soft: true, done: true });
const busted = hand({ bet: 500, cards: [card("K"), card("9"), card("5")], total: 24, bust: true, done: true });
const live = hand({ bet: 500, cards: [card("K"), card("9")], total: 19 });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a blackjack", () => {
  it("gets a banner once, when it is dealt, and not again for the same hand", () => {
    const { container, rerender } = render(<Moments me={seat("a", "Ada")} />);
    expect(container.querySelector(".bj__banner")).toBeNull();

    rerender(<Moments me={seat("a", "Ada", { hands: [natural] })} />);
    expect(container.querySelector(".bj__banner")?.textContent).toBe("Blackjack");

    act(() => vi.advanceTimersByTime(MOMENT_MS));
    expect(container.querySelector(".bj__banner")).toBeNull();

    // The next broadcast about the same hand is not a second blackjack.
    rerender(<Moments me={seat("a", "Ada", { hands: [{ ...natural }] })} />);
    expect(container.querySelector(".bj__banner")).toBeNull();
  });

  it("is not celebrated for somebody arriving at a hand already dealt", () => {
    const { container } = render(<Moments me={seat("a", "Ada", { hands: [natural] })} />);
    expect(container.querySelector(".bj__banner")).toBeNull();
  });
});

describe("a bust", () => {
  it("gets a stamp once per hand that busts", () => {
    const { container, rerender } = render(<Moments me={seat("a", "Ada", { hands: [live, live] })} />);

    rerender(<Moments me={seat("a", "Ada", { hands: [busted, live] })} />);
    expect(container.querySelector(".bj__stamp")?.textContent).toBe("Bust");
    act(() => vi.advanceTimersByTime(MOMENT_MS));
    expect(container.querySelector(".bj__stamp")).toBeNull();

    rerender(<Moments me={seat("a", "Ada", { hands: [busted, busted] })} />);
    expect(container.querySelector(".bj__stamp")).not.toBeNull();
  });

  it("goes as soon as the felt clears for the next hand", () => {
    const { container, rerender } = render(<Moments me={seat("a", "Ada", { hands: [live] })} />);
    rerender(<Moments me={seat("a", "Ada", { hands: [busted] })} />);
    rerender(<Moments me={seat("a", "Ada")} />);
    expect(container.querySelector(".bj__stamp")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run apps/web/src/blackjack/Moments.test.tsx`
Expected: FAIL — `Failed to resolve import "./Moments.js"`.

- [ ] **Step 3: Implement**

Create `apps/web/src/blackjack/Moments.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { SeatView } from "./hands.js";
import { isNatural } from "./hands.js";

/** Long enough to read the word, short enough that it is a moment and not a sign. */
export const MOMENT_MS = 1600;

/**
 * True for a moment each time a count goes up.
 *
 * A count rather than a flag, so a second hand busting after a split is a
 * second stamp. Worked out during render rather than in an effect, so React's
 * development double-run of effects cannot swallow the moment it is for.
 */
export function useMoment(count: number, ms = MOMENT_MS): boolean {
  const [seen, setSeen] = useState(count);
  const [shown, setShown] = useState(false);
  if (count !== seen) {
    setSeen(count);
    // Up is news; down is the felt clearing, and a stamp outliving its hand would be a lie.
    setShown(count > seen);
  }

  useEffect(() => {
    if (!shown) {
      return;
    }
    const id = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(id);
  }, [shown, ms]);

  return shown;
}

/**
 * The two big moments at a blackjack table, each once and never looped: a
 * banner for a hand dealt twenty-one, a stamp for a hand gone past it.
 */
export function Moments({ me }: { me: SeatView | null }) {
  const only = me !== null && me.hands.length === 1 ? me.hands[0] : undefined;
  const natural = useMoment(only !== undefined && isNatural(only) ? 1 : 0);
  const bust = useMoment(me?.hands.filter((hand) => hand.bust).length ?? 0);
  return (
    <>
      {natural ? (
        <p className="bj__banner" aria-hidden="true">
          Blackjack
        </p>
      ) : null}
      {bust ? (
        <p className="bj__stamp" aria-hidden="true">
          Bust
        </p>
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run apps/web/src/blackjack/Moments.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck
npx biome lint apps/web/src/blackjack/Moments.tsx apps/web/src/blackjack/Moments.test.tsx
git add apps/web/src/blackjack/Moments.tsx apps/web/src/blackjack/Moments.test.tsx
git commit -m "feat(web): a blackjack banner and a bust stamp, once each

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: The controls (K1, K5, F1–F5, N6)

**Files:**
- Create: `apps/web/src/blackjack/Controls.tsx`
- Test: `apps/web/src/blackjack/Controls.test.tsx`

**Interfaces:**
- Consumes: `availableTo`, `chipRefusal`, `clockText`, `doubleOffer`, `splitOffer`, `fmt`, `type Offer`, `type SeatView` (Task 3); `Chip`, `MINTED` from `../chips/Chip.js`; `DealIcon`, `UndoIcon` from `./Icons.js`; `LAST_CALL_MS`; `type Move` from `./useIntent.js`.
- Produces:
  - `interface ControlsProps { state: TableView; me: SeatView | null; mine: number; chips: number | null; move: Move | null; left: number | null; turnLeft: number | null; isHost: boolean; taunt: ReactNode; onStake: (amount: number) => void; onReady: (ready: boolean) => void; onDeal: () => void; onMove: (kind: Move) => void }`
  - `Controls(props: ControlsProps)` → root `div.bj__controls` with one of `--watch`, `--bet`, `--turn`, `--wait`. Exactly one `button.slab.bj__main` in every state except watching, which has none. The slab carries `aria-keyshortcuts="Space"`; Stand, Double and Split carry `S`, `D`, `P`. Chips are `button.bj__chip` inside `div.well.bj__tray[role=group][aria-label="Add chips"]`.

| State | Left | Right |
|---|---|---|
| Watching (`me === null`) | `p.bj__watching` note | — |
| Betting | tray above; `key key--icon bj__back` "Take it back"; host-only `key bj__deal` "Deal now" | `slab` "Ready" / "Waiting…", clock or reason under it; disabled when `0 < mine < minBet` |
| Your turn | `key bj__stand` (two columns); `key bj__double`, `key bj__split` with cost (`small.bj__cost`) or reason | `slab` "Hit", both rows; `.is-busy` and disabled while `move !== null` |
| Anyone else's turn, the dealer, sitting a hand out | — | disabled `slab` "Bo's turn" + time left; the taunt key |
| Settled | — | disabled `slab` "Next hand", "in 5s"; the taunt key |

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/blackjack/Controls.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ControlsProps } from "./Controls.js";
import { Controls } from "./Controls.js";
import { pairTurn, seat, settledHand, splitTurn, theirTurn, view, yourTurn } from "./fixtures.js";

function controls(over: Partial<ControlsProps> = {}) {
  const state = over.state ?? view();
  const props: ControlsProps = {
    state,
    me: state.seats[0] ?? null,
    mine: 0,
    chips: 12_400,
    move: null,
    left: 20,
    turnLeft: 12,
    isHost: false,
    taunt: (
      <button type="button" className="key">
        Taunt
      </button>
    ),
    onStake: vi.fn(),
    onReady: vi.fn(),
    onDeal: vi.fn(),
    onMove: vi.fn(),
    ...over,
  };
  const utils = render(<Controls {...props} />);
  return { ...utils, props };
}

const slabs = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>(".slab")];

describe("the controls while betting", () => {
  it("light one slab, Ready, on Space", () => {
    const { container } = controls();
    const [ready, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(ready?.disabled).toBe(false);
    expect(ready?.textContent).toMatch(/^Ready/);
    expect(ready?.getAttribute("aria-keyshortcuts")).toBe("Space");
    expect(ready?.textContent).toContain("cards out 0:20");
  });

  it("stack a chip onto the stake already shown, and take the lot back", () => {
    const state = view({ seats: [seat("a", "Ada", { bet: 500 }), seat("b", "Bo")] });
    const { props } = controls({ state, me: state.seats[0] ?? null, mine: 500 });
    fireEvent.click(screen.getByRole("button", { name: "Add 100" }));
    fireEvent.click(screen.getByRole("button", { name: "Take it back" }));
    expect(vi.mocked(props.onStake).mock.calls).toEqual([[600], [0]]);
  });

  it("say on a chip why it cannot be added", () => {
    const state = view({ seats: [seat("a", "Ada", { bet: 9_500 }), seat("b", "Bo")] });
    controls({ state, me: state.seats[0] ?? null, mine: 9_500 });
    const over = screen.getByRole("button", { name: "1,000 more is past the 10,000 limit" }) as HTMLButtonElement;
    expect(over.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add 500" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("take nothing more at last call, and say so on the slab", () => {
    const { container } = controls({ left: 3 });
    const chips = [...container.querySelectorAll<HTMLButtonElement>(".bj__chip")];
    expect(chips).toHaveLength(5);
    expect(chips.every((chip) => chip.disabled)).toBe(true);
    expect(slabs(container)[0]?.textContent).toContain("last call 0:03");
  });

  it("hold Ready shut on a stake under the minimum, and say what the minimum is", () => {
    const state = view({ minBet: 250, seats: [seat("a", "Ada", { bet: 100 }), seat("b", "Bo")] });
    const { container } = controls({ state, me: state.seats[0] ?? null, mine: 100 });
    const ready = slabs(container)[0];
    expect(ready?.disabled).toBe(true);
    expect(ready?.textContent).toContain("at least 250");
  });

  it("un-ready on a second press", () => {
    const state = view({ seats: [seat("a", "Ada", { bet: 500, ready: true }), seat("b", "Bo")] });
    const { container, props } = controls({ state, me: state.seats[0] ?? null, mine: 500 });
    const waiting = slabs(container)[0];
    expect(waiting?.textContent).toMatch(/^Waiting…/);
    if (waiting !== undefined) {
      fireEvent.click(waiting);
    }
    expect(props.onReady).toHaveBeenCalledWith(false);
  });

  it("offer Deal now to the host and nobody else", () => {
    const { unmount } = controls({ isHost: true });
    expect(screen.getByRole("button", { name: "Deal now" })).toBeTruthy();
    unmount();
    controls({ isHost: false });
    expect(screen.queryByRole("button", { name: "Deal now" })).toBeNull();
  });
});

describe("the controls on your turn", () => {
  it("light Hit on Space, with Stand, Double and Split on their own letters", () => {
    const state = yourTurn();
    const { container } = controls({ state, me: state.seats[0] ?? null });
    const [hit, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(hit?.disabled).toBe(false);
    expect(hit?.textContent).toMatch(/^Hit/);
    expect(hit?.getAttribute("aria-keyshortcuts")).toBe("Space");
    expect(screen.getByRole("button", { name: /^Stand/ }).getAttribute("aria-keyshortcuts")).toBe("S");
    expect(screen.getByRole("button", { name: /^Double/ }).getAttribute("aria-keyshortcuts")).toBe("D");
    expect(screen.getByRole("button", { name: /^Split/ }).getAttribute("aria-keyshortcuts")).toBe("P");
  });

  it("put the cost on Double and the reason on Split", () => {
    const state = yourTurn();
    controls({ state, me: state.seats[0] ?? null });
    const double = screen.getByRole("button", { name: /^Double/ }) as HTMLButtonElement;
    expect(double.querySelector(".bj__cost")?.textContent).toBe("+500");
    const split = screen.getByRole("button", { name: /^Split/ }) as HTMLButtonElement;
    expect(split.disabled).toBe(true);
    expect(split.textContent).toContain("no pair");
  });

  it("split a pair at the price of the hand", () => {
    const state = pairTurn();
    const { props } = controls({ state, me: state.seats[0] ?? null });
    const split = screen.getByRole("button", { name: /^Split/ });
    expect(split.textContent).toContain("+500");
    fireEvent.click(split);
    expect(props.onMove).toHaveBeenCalledWith("split");
  });

  it("say which hand after a split, and why Double and Split are out", () => {
    const state = splitTurn();
    const { container } = controls({ state, me: state.seats[0] ?? null });
    expect(screen.getByRole("button", { name: /^Stand/ }).textContent).toContain("hand 2");
    expect(slabs(container)[0]?.textContent).toContain("hand 2");
    expect(screen.getByRole("button", { name: /^Double/ }).textContent).toContain("3 cards");
    expect(screen.getByRole("button", { name: /^Split/ }).textContent).toContain("once a seat");
  });

  it("hold Hit down, busy, from the press until the table answers", () => {
    const state = yourTurn();
    const { container } = controls({ state, me: state.seats[0] ?? null, move: "hit" });
    const hit = slabs(container)[0];
    expect(hit?.classList.contains("is-busy")).toBe(true);
    expect(hit?.disabled).toBe(true);
    expect(hit?.textContent).toContain("a card is coming");
    expect((screen.getByRole("button", { name: /^Stand/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the controls while somebody else acts", () => {
  it("say whose turn it is on a slab nobody can press, with the taunt beside it", () => {
    const state = theirTurn();
    const { container } = controls({ state, me: state.seats[0] ?? null, turnLeft: 9 });
    const [turn, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(turn?.disabled).toBe(true);
    expect(turn?.textContent).toMatch(/^Bo's turn/);
    expect(turn?.textContent).toContain("0:09");
    expect(screen.getByRole("button", { name: "Taunt" })).toBeTruthy();
  });

  it("count down to the next hand once this one is over", () => {
    const state = settledHand();
    const { container } = controls({ state, me: state.seats[0] ?? null, left: 5 });
    const next = slabs(container)[0];
    expect(next?.disabled).toBe(true);
    expect(next?.textContent).toMatch(/^Next hand/);
    expect(next?.textContent).toContain("in 5s");
  });

  it("give somebody watching a note, not buttons", () => {
    const { container } = controls({ state: yourTurn(), me: null });
    expect(slabs(container)).toHaveLength(0);
    expect(container.textContent).toContain("stood behind the table");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run apps/web/src/blackjack/Controls.test.tsx`
Expected: FAIL — `Failed to resolve import "./Controls.js"`.

- [ ] **Step 3: Implement**

Create `apps/web/src/blackjack/Controls.tsx`:

```tsx
import type { TableView } from "@backroom/game-blackjack";
import { LAST_CALL_MS } from "@backroom/game-blackjack";
import type { ReactNode } from "react";
import { Chip, MINTED } from "../chips/Chip.js";
import type { Offer, SeatView } from "./hands.js";
import { availableTo, chipRefusal, clockText, doubleOffer, fmt, splitOffer } from "./hands.js";
import { DealIcon, UndoIcon } from "./Icons.js";
import type { Move } from "./useIntent.js";

/*
 * Denominations you can stack, smallest first because the tray reads left to
 * right. Taken from MINTED rather than listed again, so what a player may bet
 * with cannot drift from the chips that exist.
 */
const CHIPS = [...MINTED].reverse();

export interface ControlsProps {
  state: TableView;
  /** This player's seat, or null for somebody watching. */
  me: SeatView | null;
  /** The stake to show: this player's own last press until the table agrees. */
  mine: number;
  /** The account's balance, or null for a guest. */
  chips: number | null;
  /** A move sent and not yet answered. */
  move: Move | null;
  /** Seconds on the table's deadline: the betting window, or the next hand. */
  left: number | null;
  /** Seconds left on whoever's turn it is. */
  turnLeft: number | null;
  isHost: boolean;
  /** The taunt key, offered while somebody else is acting. */
  taunt: ReactNode;
  onStake: (amount: number) => void;
  onReady: (ready: boolean) => void;
  onDeal: () => void;
  onMove: (kind: Move) => void;
}

type Seated = Omit<ControlsProps, "me"> & { me: SeatView };

/**
 * The table's bottom row: secondary keys on the left, one lit slab on the
 * right, under the thumb. One slab per state, because two lit buttons have no
 * obvious one.
 */
export function Controls(props: ControlsProps) {
  const { state, me } = props;
  if (me === null) {
    // No seat, so no buttons: offering controls that cannot do anything is worse than saying what you are.
    return (
      <div className="bj__controls bj__controls--watch">
        <p className="bj__watching">You are stood behind the table. Take a seat between hands to play.</p>
      </div>
    );
  }
  if (state.phase === "betting") {
    return <Betting {...props} me={me} />;
  }
  if (state.phase === "playing" && state.turnSeatId === me.id) {
    return <Turn {...props} me={me} />;
  }
  return <Waiting {...props} />;
}

/**
 * Stacking a stake.
 *
 * Chips add rather than replace, the way they do on a real felt, and the whole
 * stack comes back off in one go: a stake you cannot take back before the cards
 * are out would make a misclick cost a hand.
 */
function Betting({ state, me, mine, chips, left, isHost, onStake, onReady, onDeal }: Seated) {
  /*
   * One clock with two jobs: it is what the slab says and what locks the chips.
   * Read once, so a chip never refuses itself a tick before the words say so.
   */
  const lastCall = left !== null && left <= LAST_CALL_MS / 1000;
  const available = availableTo(state, me, chips, mine);
  const short = mine > 0 && mine < state.minBet;
  const under = me.ready
    ? "for the others"
    : short
      ? `at least ${fmt(state.minBet)}`
      : left === null
        ? ""
        : `${lastCall ? "last call" : "cards out"} ${clockText(left)}`;

  return (
    <div className="bj__controls bj__controls--bet">
      <div className="well bj__tray" role="group" aria-label="Add chips">
        {CHIPS.map((amount) => {
          const refused = chipRefusal(amount, mine, state.maxBet, available, lastCall);
          const said = refused ?? `Add ${fmt(amount)}`;
          return (
            <button
              key={amount}
              type="button"
              className="bj__chip"
              disabled={refused !== null}
              aria-label={said}
              title={said}
              onClick={() => onStake(mine + amount)}
            >
              <Chip amount={amount} />
            </button>
          );
        })}
      </div>
      <div className={`bj__row${isHost ? " bj__row--host" : ""}`}>
        <button
          type="button"
          className="key key--icon bj__back"
          aria-label="Take it back"
          disabled={mine === 0}
          onClick={() => onStake(0)}
        >
          <UndoIcon />
        </button>
        {isHost ? (
          // Not what starts a round, which the clock does: for a table done betting early.
          <button type="button" className="key bj__deal" onClick={onDeal}>
            <DealIcon />
            <span>Deal now</span>
          </button>
        ) : null}
        <button
          type="button"
          className="slab bj__main"
          aria-keyshortcuts="Space"
          aria-pressed={me.ready}
          disabled={short}
          onClick={() => onReady(!me.ready)}
        >
          <span>
            {me.ready ? "Waiting…" : "Ready"}
            <kbd>Space</kbd>
          </span>
          <small>{under}</small>
        </button>
      </div>
    </div>
  );
}

function Turn({ state, me, chips, move, onMove }: Seated) {
  // The hand actually being asked about, which after a split is one of two.
  const hand = me.hands[me.active] ?? me.hands[0];
  // Once a move has gone, the whole set goes quiet: a second move on the same cards is not a thing to allow.
  const busy = move !== null;
  const which = me.hands.length > 1 ? `hand ${me.active + 1}` : null;
  const available = availableTo(state, me, chips, me.bet);
  const none: Offer = { ok: false, reason: "no hand" };
  const double = hand === undefined ? none : doubleOffer(hand, available);
  const split = hand === undefined ? none : splitOffer(me, hand, available);
  const under = busy
    ? move === "hit" || move === "double"
      ? "a card is coming"
      : "waiting on the table"
    : (which ?? `on ${hand?.total ?? 0}`);

  return (
    <div className="bj__controls bj__controls--turn">
      <button
        type="button"
        className="key bj__stand"
        aria-keyshortcuts="S"
        disabled={busy}
        onClick={() => onMove("stand")}
      >
        <span>
          Stand
          <kbd>S</kbd>
        </span>
        {which !== null ? <small>{which}</small> : null}
      </button>
      <OfferKey name="Double" shortcut="D" offer={double} busy={busy} onPress={() => onMove("double")} />
      <OfferKey name="Split" shortcut="P" offer={split} busy={busy} onPress={() => onMove("split")} />
      <button
        type="button"
        className={`slab bj__main${busy ? " is-busy" : ""}`}
        aria-keyshortcuts="Space"
        disabled={busy}
        onClick={() => onMove("hit")}
      >
        <span>
          Hit
          <kbd>Space</kbd>
        </span>
        <small>{under}</small>
      </button>
    </div>
  );
}

/** A move that is an answer to a particular hand, with its price or the reason it is out on the key itself. */
function OfferKey({
  name,
  shortcut,
  offer,
  busy,
  onPress,
}: {
  name: "Double" | "Split";
  shortcut: "D" | "P";
  offer: Offer;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      className={`key bj__${name.toLowerCase()}`}
      aria-keyshortcuts={shortcut}
      disabled={busy || !offer.ok}
      onClick={onPress}
    >
      <span>
        {name}
        <kbd>{shortcut}</kbd>
      </span>
      {offer.ok ? <small className="bj__cost">+{fmt(offer.cost)}</small> : <small>{offer.reason}</small>}
    </button>
  );
}

/**
 * Nothing to press but a taunt.
 *
 * The slab stays, out, because a table that runs itself has to say what it is
 * waiting on, or it reads as a table that has stopped.
 */
function Waiting({ state, left, turnLeft, taunt }: ControlsProps) {
  const settled = state.phase === "settled";
  const turn = state.phase === "playing" ? (state.seats.find((seat) => seat.id === state.turnSeatId) ?? null) : null;
  return (
    <div className="bj__controls bj__controls--wait">
      <button type="button" className="slab bj__main" disabled>
        <span>{settled ? "Next hand" : turn !== null ? `${turn.name}'s turn` : "The dealer"}</span>
        <small>{settled ? (left === null ? "" : `in ${left}s`) : turnLeft === null ? "" : clockText(turnLeft)}</small>
      </button>
      {taunt}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run apps/web/src/blackjack/Controls.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck
npx biome lint apps/web/src/blackjack/Controls.tsx apps/web/src/blackjack/Controls.test.tsx
git add apps/web/src/blackjack/Controls.tsx apps/web/src/blackjack/Controls.test.tsx
git commit -m "feat(web): blackjack controls from the fittings, one lit slab per state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Sheets, the rules card and the host's Table sheet (T3, host tools)

**Files:**
- Create: `apps/web/src/blackjack/Sheet.tsx`, `apps/web/src/blackjack/HowItPays.tsx`, `apps/web/src/blackjack/TableSheet.tsx`
- Test: `apps/web/src/blackjack/Sheet.test.tsx`, `apps/web/src/blackjack/HowItPays.test.tsx`, `apps/web/src/blackjack/TableSheet.test.tsx`

**Interfaces:**
- Consumes: `availableTo`, `doubleOffer`, `splitOffer`, `fmt` (Task 3); `Seg` from `../fittings/Seg.js`; `WINDOWS` from `@backroom/game-blackjack`; `type BotSkill` from `@backroom/shared`.
- Produces:
  - `Sheet({ id, label, heading?, open, onClose, className, children })` where `className: "bj__sheet--felt" | "bj__sheet--page"` → when open, `button.bj__scrim` plus `div.bj__sheet[role=dialog][aria-label=label][id=id]` with `.bj__sheet-head`, `h2.bj__sheet-title`, a close key, and `div.bj__sheet-body.table-scroll`. Escape and the scrim close it; on closing, focus returns to the element with `aria-controls={id}`.
  - `PAYS_SHEET_ID = "bj-pays"`; `type PayRow = "blackjack" | "win" | "push" | "dealer" | "double" | "split"`; `interface Pays { lit: PayRow[]; double: number | null; split: number | null }`; `paysFor(state: TableView, seatId: string | null, chips: number | null): Pays`; `HowItPays({ pays }: { pays: Pays })` → `dl.bj__pays > div.bj__pay` (+ `bj__pay--lit`).
  - `TABLE_SHEET_ID = "bj-table"`; `TableSheet({ open, onClose, code, bettingMs, listed, forFun, seated, maxSeats, onWindow, onListed, onBot })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/blackjack/Sheet.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Sheet } from "./Sheet.js";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" aria-controls="test-sheet" onClick={() => setOpen(true)}>
        Open
      </button>
      {/* A fresh function every render, as a careless owner would pass. */}
      <Sheet id="test-sheet" label="How it pays" open={open} onClose={() => setOpen(false)} className="bj__sheet--felt">
        <p>Inside</p>
      </Sheet>
    </div>
  );
}

describe("a sheet at the table", () => {
  it("is not there while shut", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a dialog named for what it holds, and takes the focus", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const sheet = screen.getByRole("dialog", { name: "How it pays" });
    expect(sheet.textContent).toContain("Inside");
    expect(document.activeElement).toBe(sheet);
  });

  it("closes on Escape and hands the focus back to the key that opened it", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    fireEvent.click(opener);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes from its scrim", () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const scrim = container.querySelector(".bj__scrim");
    if (scrim !== null) {
      fireEvent.click(scrim);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
```

Create `apps/web/src/blackjack/HowItPays.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { hand, pairTurn, seat, settledHand, view, yourTurn } from "./fixtures.js";
import { HowItPays, paysFor } from "./HowItPays.js";

describe("what the rules card lights", () => {
  it("lights Double on your turn when you can double, with its price", () => {
    expect(paysFor(yourTurn(), "a", 12_400)).toEqual({ lit: ["double"], double: 500, split: null });
  });

  it("lights Split as well on a pair", () => {
    expect(paysFor(pairTurn(), "a", 12_400)).toEqual({ lit: ["double", "split"], double: 500, split: 500 });
  });

  it("lights nothing on somebody else's turn", () => {
    expect(paysFor(yourTurn(), "b", 12_400).lit).toEqual([]);
  });

  it("lights what each of your hands was paid at, once it is over", () => {
    expect(paysFor(settledHand(), "a", 12_400).lit).toEqual(["blackjack"]);
    const split = view({
      phase: "settled",
      seats: [
        seat("a", "Ada", {
          bet: 1_000,
          hands: [
            hand({ bet: 500, outcome: "won", returned: 1_000, done: true }),
            hand({ bet: 500, outcome: "push", returned: 500, done: true }),
          ],
        }),
      ],
    });
    expect(paysFor(split, "a", 12_400).lit).toEqual(["win", "push"]);
  });
});

describe("the rules card", () => {
  it("lists how the table pays, lighting the rows that apply", () => {
    const { container } = render(<HowItPays pays={{ lit: ["double"], double: 500, split: null }} />);
    const rows = [...container.querySelectorAll(".bj__pay")];
    expect(rows.map((row) => row.querySelector("dt")?.textContent)).toEqual([
      "Blackjack pays",
      "A win pays",
      "A push returns",
      "Dealer stands on",
      "Double on your first two cards",
      "Split a pair, once",
    ]);
    expect(rows.map((row) => row.querySelector("dd")?.textContent)).toEqual([
      "3 to 2",
      "1 to 1",
      "the stake",
      "17",
      "+500",
      "—",
    ]);
    expect(container.querySelectorAll(".bj__pay--lit")).toHaveLength(1);
    expect(container.querySelector(".bj__pay--lit dt")?.textContent).toBe("Double on your first two cards");
  });
});
```

Create `apps/web/src/blackjack/TableSheet.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TableSheetProps } from "./TableSheet.js";
import { TableSheet } from "./TableSheet.js";

function sheet(over: Partial<TableSheetProps> = {}) {
  const props: TableSheetProps = {
    open: true,
    onClose: vi.fn(),
    code: "HG4ME",
    bettingMs: 30_000,
    listed: true,
    forFun: true,
    seated: 2,
    maxSeats: 6,
    onWindow: vi.fn(),
    onListed: vi.fn(),
    onBot: vi.fn(),
    ...over,
  };
  render(<TableSheet {...props} />);
  return props;
}

describe("the host's Table sheet", () => {
  it("is a dialog headed with the table's code", () => {
    sheet();
    const dialog = screen.getByRole("dialog", { name: "Table" });
    expect(within(dialog).getByRole("heading").textContent).toBe("Table HG4ME");
  });

  it("sets how long everybody gets to bet, from the next hand", () => {
    const props = sheet();
    const windows = within(screen.getByRole("group", { name: "Time to bet" }));
    expect(windows.getByRole("button", { name: "30s" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(windows.getByRole("button", { name: "60s" }));
    expect(props.onWindow).toHaveBeenCalledWith(60_000);
    expect(screen.getByText("Takes effect on the next hand.")).toBeTruthy();
  });

  it("sets who can find the table", () => {
    const props = sheet();
    fireEvent.click(within(screen.getByRole("group", { name: "Who can find it" })).getByRole("button", { name: "Private" }));
    expect(props.onListed).toHaveBeenCalledWith(false);
  });

  it("adds a bot at a for-fun table with a seat free", () => {
    const props = sheet();
    fireEvent.click(screen.getByRole("button", { name: "Hard" }));
    expect(props.onBot).toHaveBeenCalledWith("hard");
  });

  it("offers no bot at a table for chips", () => {
    sheet({ forFun: false });
    expect(screen.queryByRole("button", { name: "Easy" })).toBeNull();
  });

  it("offers no bot at a full table", () => {
    sheet({ seated: 6 });
    expect(screen.queryByRole("button", { name: "Easy" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run apps/web/src/blackjack/Sheet.test.tsx apps/web/src/blackjack/HowItPays.test.tsx apps/web/src/blackjack/TableSheet.test.tsx`
Expected: all three files FAIL — `Failed to resolve import "./Sheet.js"` / `"./HowItPays.js"` / `"./TableSheet.js"`.

- [ ] **Step 3: Implement the sheet**

Create `apps/web/src/blackjack/Sheet.tsx`:

```tsx
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

/**
 * Something laid over the table on purpose: the rules card on a phone, the
 * host's settings. Escape and the scrim close it, and focus goes back to the key
 * that opened it, so a keyboard is never left nowhere.
 */
export function Sheet({
  id,
  label,
  heading,
  open,
  onClose,
  className,
  children,
}: {
  /** Matched by the opening key's aria-controls, which is where focus returns. */
  id: string;
  label: string;
  heading?: ReactNode;
  open: boolean;
  onClose: () => void;
  /** Over the felt only, or over the whole table. */
  className: "bj__sheet--felt" | "bj__sheet--page";
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  /*
   * Read through a ref: an owner passing a fresh function each render would
   * otherwise re-run the effect below, pulling focus back into the sheet and
   * throwing it at the opener on every update the table sends.
   */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus();
    };
  }, [open, id]);

  if (!open) {
    return null;
  }

  return (
    <>
      <button type="button" className="bj__scrim" tabIndex={-1} aria-label={`Close ${label}`} onClick={onClose} />
      <div id={id} className={`bj__sheet ${className}`} role="dialog" aria-label={label} ref={panel} tabIndex={-1}>
        <div className="bj__sheet-head">
          <h2 className="bj__sheet-title">{heading ?? label}</h2>
          <button type="button" className="key key--icon" aria-label={`Close ${label}`} onClick={onClose}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="bj__sheet-body table-scroll">{children}</div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Implement the rules card**

Create `apps/web/src/blackjack/HowItPays.tsx`:

```tsx
import type { TableView } from "@backroom/game-blackjack";
import { availableTo, doubleOffer, fmt, splitOffer } from "./hands.js";

export const PAYS_SHEET_ID = "bj-pays";

export type PayRow = "blackjack" | "win" | "push" | "dealer" | "double" | "split";

/** Which rows apply right now, and what Double and Split would cost if they are on offer. */
export interface Pays {
  lit: PayRow[];
  double: number | null;
  split: number | null;
}

/**
 * What the rules card lights: the moves open to you on your turn, and the rows
 * your hands were paid at once it is over. Asked of the same functions the keys
 * ask, so the card and the controls cannot disagree.
 */
export function paysFor(state: TableView, seatId: string | null, chips: number | null): Pays {
  const me = state.seats.find((seat) => seat.id === seatId) ?? null;
  const lit = new Set<PayRow>();
  let double: number | null = null;
  let split: number | null = null;

  const hand = me?.hands[me.active];
  if (me !== null && hand !== undefined && state.phase === "playing" && state.turnSeatId === me.id) {
    const available = availableTo(state, me, chips, me.bet);
    const doubling = doubleOffer(hand, available);
    const splitting = splitOffer(me, hand, available);
    if (doubling.ok) {
      lit.add("double");
      double = doubling.cost;
    }
    if (splitting.ok) {
      lit.add("split");
      split = splitting.cost;
    }
  }

  if (me !== null && state.phase === "settled") {
    for (const one of me.hands) {
      if (one.outcome === "blackjack") {
        lit.add("blackjack");
      } else if (one.outcome === "won") {
        lit.add("win");
      } else if (one.outcome === "push") {
        lit.add("push");
      }
    }
  }

  return { lit: [...lit], double, split };
}

const ROWS: ReadonlyArray<{ row: PayRow; term: string; value: string }> = [
  { row: "blackjack", term: "Blackjack pays", value: "3 to 2" },
  { row: "win", term: "A win pays", value: "1 to 1" },
  { row: "push", term: "A push returns", value: "the stake" },
  { row: "dealer", term: "Dealer stands on", value: "17" },
  { row: "double", term: "Double on your first two cards", value: "" },
  { row: "split", term: "Split a pair, once", value: "" },
];

const cost = (amount: number | null) => (amount === null ? "—" : `+${fmt(amount)}`);

export function HowItPays({ pays }: { pays: Pays }) {
  return (
    <dl className="bj__pays">
      {ROWS.map(({ row, term, value }) => (
        <div key={row} className={`bj__pay${pays.lit.includes(row) ? " bj__pay--lit" : ""}`}>
          <dt>{term}</dt>
          <dd>{row === "double" ? cost(pays.double) : row === "split" ? cost(pays.split) : value}</dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 5: Implement the Table sheet**

Create `apps/web/src/blackjack/TableSheet.tsx`:

```tsx
import { WINDOWS } from "@backroom/game-blackjack";
import type { BotSkill } from "@backroom/shared";
import { Seg } from "../fittings/Seg.js";
import { Sheet } from "./Sheet.js";

export const TABLE_SHEET_ID = "bj-table";

export interface TableSheetProps {
  open: boolean;
  onClose: () => void;
  code: string;
  bettingMs: number;
  listed: boolean;
  forFun: boolean;
  /** How many are sitting at the table now. */
  seated: number;
  maxSeats: number;
  onWindow: (ms: number) => void;
  onListed: (listed: boolean) => void;
  onBot: (skill: BotSkill) => void;
}

const SKILLS: ReadonlyArray<{ skill: BotSkill; text: string }> = [
  { skill: "easy", text: "Easy" },
  { skill: "normal", text: "Normal" },
  { skill: "hard", text: "Hard" },
];

/**
 * The shape of the evening, which is the host's to set: how long everybody gets
 * to bet, who can find the table, and who else sits down. Behind a key, because
 * none of it is anything to do with the hand in front of you.
 */
export function TableSheet({
  open,
  onClose,
  code,
  bettingMs,
  listed,
  forFun,
  seated,
  maxSeats,
  onWindow,
  onListed,
  onBot,
}: TableSheetProps) {
  return (
    <Sheet
      id={TABLE_SHEET_ID}
      label="Table"
      heading={`Table ${code}`}
      open={open}
      onClose={onClose}
      className="bj__sheet--page"
    >
      <div className="bj__field">
        <p className="label">Time to bet</p>
        <Seg
          label="Time to bet"
          options={WINDOWS.map((ms) => ({ value: String(ms), text: `${ms / 1000}s` }))}
          value={String(bettingMs)}
          onChange={(value) => onWindow(Number(value))}
        />
        {/* Not this hand: the deal is already scheduled against the clock that is running. */}
        <p className="hint">Takes effect on the next hand.</p>
      </div>
      <div className="bj__field">
        <p className="label">Who can find it</p>
        <Seg
          label="Who can find it"
          options={[
            { value: true, text: "Public" },
            { value: false, text: "Private" },
          ]}
          value={listed}
          onChange={onListed}
        />
      </div>
      {/* Bots only ever sit at a table playing for nothing, because chips are
          only won from real people. The server refuses either way; this just
          stops offering something that would be turned down. */}
      {forFun && seated < maxSeats ? (
        <div className="bj__field">
          <p className="label">Add a player</p>
          <div className="bj__bots">
            {SKILLS.map(({ skill, text }) => (
              <button key={skill} type="button" className="key key--small" onClick={() => onBot(skill)}>
                {text}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run apps/web/src/blackjack/Sheet.test.tsx apps/web/src/blackjack/HowItPays.test.tsx apps/web/src/blackjack/TableSheet.test.tsx`
Expected: all PASS.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck
npx biome lint apps/web/src/blackjack/Sheet.tsx apps/web/src/blackjack/Sheet.test.tsx apps/web/src/blackjack/HowItPays.tsx apps/web/src/blackjack/HowItPays.test.tsx apps/web/src/blackjack/TableSheet.tsx apps/web/src/blackjack/TableSheet.test.tsx
git add apps/web/src/blackjack/Sheet.tsx apps/web/src/blackjack/Sheet.test.tsx apps/web/src/blackjack/HowItPays.tsx apps/web/src/blackjack/HowItPays.test.tsx apps/web/src/blackjack/TableSheet.tsx apps/web/src/blackjack/TableSheet.test.tsx
git commit -m "feat(web): the blackjack rules card and the host's Table sheet

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Keys (K2–K4)

**Files:**
- Create: `apps/web/src/blackjack/useBlackjackKeys.ts`
- Test: `apps/web/src/blackjack/useBlackjackKeys.test.tsx`

**Interfaces:**
- Consumes: `Controls`, `ControlsProps` (Task 7) in the test only; fixtures (Task 3).
- Produces: `useBlackjackKeys(root: RefObject<HTMLElement | null>): void` — one window `keydown`, `pointerdown` and `focusin` listener each, bound once. On Space, S, D or P it finds `button[aria-keyshortcuts="Space" | "S" | "D" | "P"]` under `root.current` and clicks it, unless the button is disabled or `.is-busy`. Chips are recognised by `.bj__chip`.

The rules (spec, "Keys"):
- nothing in `input`, `textarea`, `select`, `[contenteditable]`, or inside `[role="dialog"]`;
- nothing with Ctrl, Alt or Cmd held, or on a key repeat;
- nothing when the button is disabled or busy;
- Space leaves a focused link or non-chip button alone;
- a chip a pointer last went down on hands Space to the slab; a chip reached by keyboard keeps Space. Remembered on `pointerdown`, forgotten on `focusin` elsewhere, never read from `:focus-visible`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/blackjack/useBlackjackKeys.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableView } from "@backroom/game-blackjack";
import type { Move } from "./useIntent.js";
import { Controls } from "./Controls.js";
import { pairTurn, splitTurn, view, yourTurn } from "./fixtures.js";
import { useBlackjackKeys } from "./useBlackjackKeys.js";

const space = { key: " ", code: "Space" };

function Harness({
  state,
  move = null,
  onMove,
  onReady,
  onStake,
}: {
  state: TableView;
  move?: Move | null;
  onMove: (kind: Move) => void;
  onReady: (ready: boolean) => void;
  onStake: (amount: number) => void;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  useBlackjackKeys(root);
  return (
    <div ref={root}>
      <input aria-label="Message" />
      <textarea aria-label="Note" />
      <select aria-label="Pick">
        <option>one</option>
      </select>
      <div contentEditable suppressContentEditableWarning data-testid="editable">
        words
      </div>
      <div role="dialog" aria-label="Table">
        <button type="button">In the sheet</button>
      </div>
      <a href="#rules">Rules</a>
      <button type="button">Somebody else's key</button>
      <Controls
        state={state}
        me={state.seats[0] ?? null}
        mine={state.seats[0]?.bet ?? 0}
        chips={12_400}
        move={move}
        left={20}
        turnLeft={12}
        isHost={false}
        taunt={null}
        onStake={onStake}
        onReady={onReady}
        onDeal={() => {}}
        onMove={onMove}
      />
    </div>
  );
}

function table(state: TableView, move: Move | null = null) {
  const calls = { onMove: vi.fn(), onReady: vi.fn(), onStake: vi.fn() };
  render(<Harness state={state} move={move} {...calls} />);
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Space and the letters", () => {
  it("readies on Space while betting", () => {
    const calls = table(view());
    fireEvent.keyDown(window, space);
    expect(calls.onReady).toHaveBeenCalledWith(true);
  });

  it("hits on Space on your turn", () => {
    const calls = table(yourTurn());
    fireEvent.keyDown(window, space);
    expect(calls.onMove).toHaveBeenCalledWith("hit");
  });

  it("stands on S, doubles on D and splits on P, capitals included", () => {
    const calls = table(pairTurn());
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    fireEvent.keyDown(window, { key: "D", code: "KeyD" });
    fireEvent.keyDown(window, { key: "p", code: "KeyP" });
    expect(calls.onMove.mock.calls).toEqual([["stand"], ["double"], ["split"]]);
  });
});

describe("keys that leave the page alone", () => {
  it("do nothing in a field, a text area, a list or anything editable", () => {
    const calls = table(pairTurn());
    for (const place of [
      screen.getByRole("textbox", { name: "Message" }),
      screen.getByRole("textbox", { name: "Note" }),
      screen.getByRole("combobox", { name: "Pick" }),
      screen.getByTestId("editable"),
    ]) {
      fireEvent.keyDown(place, space);
      fireEvent.keyDown(place, { key: "s", code: "KeyS" });
    }
    expect(calls.onMove).not.toHaveBeenCalled();
  });

  it("do nothing inside a sheet", () => {
    const calls = table(pairTurn());
    fireEvent.keyDown(screen.getByRole("button", { name: "In the sheet" }), { key: "s", code: "KeyS" });
    expect(calls.onMove).not.toHaveBeenCalled();
  });

  it("leave Ctrl, Alt and Cmd to the browser", () => {
    const calls = table(pairTurn());
    fireEvent.keyDown(window, { key: "d", code: "KeyD", ctrlKey: true });
    fireEvent.keyDown(window, { key: "d", code: "KeyD", altKey: true });
    fireEvent.keyDown(window, { key: "d", code: "KeyD", metaKey: true });
    expect(calls.onMove).not.toHaveBeenCalled();
  });

  it("press once for a key held down", () => {
    const calls = table(pairTurn());
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    fireEvent.keyDown(window, { key: "s", code: "KeyS", repeat: true });
    expect(calls.onMove).toHaveBeenCalledOnce();
  });

  it("do nothing when the button the key stands for could not be pressed", () => {
    const calls = table(splitTurn());
    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    fireEvent.keyDown(window, { key: "p", code: "KeyP" });
    expect(calls.onMove).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    expect(calls.onMove).toHaveBeenCalledWith("stand");
  });

  it("do nothing while a move is still in the air", () => {
    const calls = table(yourTurn(), "hit");
    fireEvent.keyDown(window, space);
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    expect(calls.onMove).not.toHaveBeenCalled();
  });

  it("leave Space to a focused link, or a focused button that is not a chip", () => {
    const calls = table(yourTurn());
    expect(fireEvent.keyDown(screen.getByRole("link", { name: "Rules" }), space)).toBe(true);
    expect(fireEvent.keyDown(screen.getByRole("button", { name: "Somebody else's key" }), space)).toBe(true);
    expect(calls.onMove).not.toHaveBeenCalled();
  });
});

describe("a chip and the Space bar", () => {
  /*
   * Chrome reports a clicked button as :focus-visible the moment any key goes
   * down on it, so asking the browser would always say "keyboard" by the time
   * Space is read. Every element answers yes here, to prove it is not asked.
   */
  function focusVisibleEverywhere() {
    const original = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
      return selector === ":focus-visible" ? true : original.call(this, selector);
    });
  }

  it("hands Space to Ready after a chip is clicked", () => {
    const calls = table(view());
    focusVisibleEverywhere();
    const chip = screen.getByRole("button", { name: "Add 100" });
    fireEvent.pointerDown(chip);
    chip.focus();
    expect(fireEvent.keyDown(chip, space)).toBe(false);
    expect(calls.onReady).toHaveBeenCalledWith(true);
    expect(calls.onStake).not.toHaveBeenCalled();
  });

  it("keeps Space for a chip reached by keyboard", () => {
    const calls = table(view());
    focusVisibleEverywhere();
    const chip = screen.getByRole("button", { name: "Add 100" });
    chip.focus();
    expect(fireEvent.keyDown(chip, space)).toBe(true);
    expect(calls.onReady).not.toHaveBeenCalled();
  });

  it("forgets the click once focus goes somewhere else", () => {
    const calls = table(view());
    const chip = screen.getByRole("button", { name: "Add 100" });
    fireEvent.pointerDown(chip);
    screen.getByRole("button", { name: "Somebody else's key" }).focus();
    chip.focus();
    expect(fireEvent.keyDown(chip, space)).toBe(true);
    expect(calls.onReady).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run apps/web/src/blackjack/useBlackjackKeys.test.tsx`
Expected: FAIL — `Failed to resolve import "./useBlackjackKeys.js"`.

- [ ] **Step 3: Implement**

Create `apps/web/src/blackjack/useBlackjackKeys.ts`:

```ts
import type { RefObject } from "react";
import { useEffect } from "react";

/** Which key presses which button, by the name the button declares in aria-keyshortcuts. */
const SHORTCUTS: Readonly<Record<string, string>> = { " ": "Space", s: "S", d: "D", p: "P" };

/**
 * Space for the lit slab; S, D and P for Stand, Double and Split.
 *
 * Presses the button on screen rather than calling what it calls, so a key can
 * never do what the button would refuse: a disabled or busy button is a key
 * that does nothing. Bound once; the buttons are looked up through the table's
 * ref at the moment the key goes down, so nothing here goes stale.
 */
export function useBlackjackKeys(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    /*
     * The chip a pointer last went down on. Remembered here rather than asked
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
      if ((target?.closest("input, textarea, select, [contenteditable], [role='dialog']") ?? null) !== null) {
        return;
      }
      if (name === "Space" && target !== null) {
        const chip = target.closest(".bj__chip");
        /*
         * A chip somebody clicked hands Space to the table: stack chips, press
         * Space, is the rhythm of a bet. A chip reached by keyboard keeps its
         * own Space, since that is how a keyboard adds one at all, and any other
         * focused button or link presses itself.
         */
        if (chip !== null ? chip !== clicked : target.closest("a, button") !== null) {
          return;
        }
      }
      const button = root.current?.querySelector<HTMLButtonElement>(`button[aria-keyshortcuts="${name}"]`) ?? null;
      if (button === null || button.disabled || button.classList.contains("is-busy")) {
        return;
      }
      // Not the page scrolling, and not a focused chip adding itself on key-up.
      event.preventDefault();
      button.click();
    };
    const onPointer = (event: Event) => {
      clicked = event.target instanceof Element ? event.target.closest(".bj__chip") : null;
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

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run apps/web/src/blackjack/useBlackjackKeys.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck
npx biome lint apps/web/src/blackjack/useBlackjackKeys.ts apps/web/src/blackjack/useBlackjackKeys.test.tsx
git add apps/web/src/blackjack/useBlackjackKeys.ts apps/web/src/blackjack/useBlackjackKeys.test.tsx
git commit -m "feat(web): Space, S, D and P at the blackjack table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `blackjack.css` on one screen (L1–L6, M1–M3)

The whole sheet is rewritten. The card, hand, chip-pile, card-motion and tilt rules are carried over **unchanged** (Poker and the style gallery use them); the table's layout rules are replaced; `.bj__actions`, `.bj__chips`, `.bj__ready`, `.bj__moves`, `.btn--move`, `.panel__head`, `.bj__result`, `.bj__stake*`, `.bj__hands*`, `.bj__hand*`, `.bj__who`, `.bj__whose`, `.bj__floor`, `.bj__watchers` (old form), `.bj__bank` and the `@media (max-width: 720px)` block go.

**Files:**
- Modify (replace entirely): `apps/web/src/blackjack/blackjack.css`
- Test: `apps/web/src/blackjack/blackjack.css.test.ts`

**Interfaces:**
- Consumes: the class names produced by Tasks 4–8 and used by Task 11: `.bj`, `.bj__in`, `.readout.bj__read` and its parts, `.bj__felt`, `.bj__cloth`, `.bj__corner`, `.bj__help`, `.bj__host`, `.bj__dealer`, `.bj__dealer-who`, `.bj__watchers`, `.bj__arc`, `.bj__slot`, `.bj__seats`, `.bj__others`, `.bj__seat` and modifiers, `.bj__seat-head`, `.bj__face`, `.bj__name`, `.bj__bet`, `.bj__purse`, `.bj__play`, `.bj__pile`, `.bj__tag`, `.bj__count*`, `.bj__boxes`, `.bj__box*`, `.bj__minis`, `.bj__mini*`, `.bj__banner`, `.bj__stamp`, `.bj__scrim`, `.bj__sheet*`, `.bj__field`, `.bj__bots`, `.bj__pays`, `.bj__pay*`, `.bj__rules`, `.bj__activity`, `.bj__panel-title`, `.bj__controls*`, `.bj__tray`, `.bj__chip`, `.bj__row*`, `.bj__back`, `.bj__deal`, `.bj__stand`, `.bj__main`, `.bj__cost`, `.bj__watching`.
- Produces: the styles; no code interface.

- [ ] **Step 1: Check the sheet is imported**

Run: `git grep -n "blackjack.css" -- apps/web/src`
Expected: `apps/web/src/blackjack/Blackjack.tsx` and `apps/web/src/style/Deck.tsx` import it. (If neither did, stop: rules added to an orphan sheet are dead.)

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/blackjack/blackjack.css.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Found from the working directory rather than import.meta.url, like the other
 * stylesheet suites, so it runs from the repository root or the web package.
 */
function sheet(path: string): string {
  const found = [resolve(process.cwd(), `apps/web/${path}`), resolve(process.cwd(), path)].find((each) =>
    existsSync(each),
  );
  // Comments stripped: a comment above a rule would read as part of its selector.
  return (found === undefined ? "" : readFileSync(found, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
}

const css = sheet("src/blackjack/blackjack.css");
const shared = sheet("src/table/table.css");

/** The declarations of the first rule for exactly this selector, at any depth. */
function ruleIn(text: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`^\\s*${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
}

/** The body of the first block opened by this at-rule prelude, braces balanced. */
function block(text: string, prelude: string): string {
  const start = text.indexOf(`${prelude} {`);
  if (start === -1) {
    return "";
  }
  let depth = 0;
  for (let at = text.indexOf("{", start); at < text.length; at += 1) {
    if (text[at] === "{") {
      depth += 1;
    } else if (text[at] === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(text.indexOf("{", start) + 1, at);
      }
    }
  }
  return "";
}

const desk = block(css, "@container bj (min-width: 760px)");

describe("the blackjack table on one screen", () => {
  /*
   * The page is the window, not at least the window: the table fills the fitted
   * page, and only the felt flexes inside it.
   */
  it("fills the fitted page, whose shell is exactly the window", () => {
    const shell = ruleIn(shared, ".shell:has(> .play--fit)");
    expect(shell).toContain("height: 100dvh");
    expect(shell).toContain("grid-template-rows: auto minmax(0, 1fr)");
    const table = ruleIn(css, ".bj");
    expect(table).toContain("container: bj / inline-size");
    expect(table).toContain("flex: 1");
    expect(table).toContain("min-height: 0");
  });

  it("flexes only the felt on a phone", () => {
    expect(ruleIn(css, ".bj__in")).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
  });

  it("puts the felt beside a side column past 760px of table, not of window", () => {
    expect(ruleIn(desk, ".bj__in")).toContain(
      'grid-template-areas: "felt read" "felt rules" "felt activity" "felt controls"',
    );
    expect(css).not.toContain("@media (max-width: 720px)");
    expect(css.split("@container bj (min-width: 760px)").length).toBe(2);
  });
});

describe("cards on the felt", () => {
  it("are sized by the felt, a size container, from both its width and its height", () => {
    const felt = ruleIn(css, ".bj__felt");
    expect(felt).toContain("container: bj-felt / size");
    expect(felt).toContain("--bj-card-dealer: clamp(34px, min(19cqi, 15cqh), 74px)");
    expect(felt).toContain("--bj-card-mine: clamp(38px, min(22cqi, 18cqh), 84px)");
    expect(felt).toContain("--bj-card-other: clamp(20px, min(9.5cqi, 8.5cqh), 38px)");
    const wide = ruleIn(desk, ".bj__felt");
    expect(wide).toContain("--bj-card-dealer: clamp(40px, min(12cqi, 20cqh), 124px)");
    expect(wide).toContain("--bj-card-mine: clamp(40px, min(9.5cqi, 17cqh), 100px)");
    expect(wide).toContain("--bj-card-other: clamp(24px, min(6.2cqi, 12cqh), 70px)");
    expect(ruleIn(css, ".bj__seat--split")).toContain("--bj-card-w: clamp(26px, min(12cqi, 15cqh), 52px)");
    expect(ruleIn(desk, ".bj__seats")).toContain("grid-template-columns: minmax(0, 1.5fr)");
  });

  it("inherit their width rather than declaring one on the card itself", () => {
    /*
     * A custom property set on an element beats the one it would inherit, which
     * is how every Greed die once came out one fixed size whatever the felt had.
     */
    const onCard = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(
        ([, selectors = "", body = ""]) =>
          selectors.split(",").some((one) => /\.bj-card$/.test(one.trim())) && body.includes("--bj-card-w:"),
      )
      .map(([, selectors = ""]) => selectors.trim());
    expect(onCard).toEqual([]);
  });

  it("overlap by 28% in a dealt hand and 42% in a split box, and not at all at the dealer's", () => {
    expect(ruleIn(css, ".bj__seat .bj-hand .bj-card + .bj-card")).toContain(
      "margin-left: calc(var(--bj-card-w) * -0.28)",
    );
    expect(ruleIn(css, ".bj__box .bj-hand .bj-card + .bj-card")).toContain(
      "margin-left: calc(var(--bj-card-w) * -0.42)",
    );
    expect(css).not.toMatch(/\.bj__dealer[^{]*\.bj-card \+ \.bj-card/);
  });
});

describe("the rest of the table", () => {
  it("keeps every control at least a thumb tall", () => {
    expect(ruleIn(css, ".bj__controls :is(.slab, .key)")).toContain("min-height: 52px");
  });

  it("scrolls the felt inside itself, never the page", () => {
    expect(ruleIn(css, ".bj__cloth")).toContain("overflow-y: auto");
  });

  it("leaves none of the old buttons and panels behind", () => {
    expect(css).not.toMatch(/\.(btn|panel|bots)(\b|__|--)/);
    expect(css).not.toContain("bj__actions");
  });
});

describe("motion at the blackjack table", () => {
  it("switches off every animation and transition it runs", () => {
    const reduced = block(css, "@media (prefers-reduced-motion: reduce)");
    const outside = css.replace(reduced, "");
    const moving = [...outside.matchAll(/([^{}]+)\{[^{}]*\b(?:animation|animation-name|transition):/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0 && !selector.startsWith("@") && !/^(from|to|\d+%)$/.test(selector));
    expect(moving.length).toBeGreaterThan(0);
    // Exact selectors, not a substring match that .bj__seat would let .bj__seat--turn satisfy.
    const off = [...reduced.matchAll(/([^{}]+)\{/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0);
    for (const selector of moving) {
      expect(off, `${selector} has no off switch`).toContain(selector);
    }
  });

  it("has one off switch, so nothing is left out of a second", () => {
    expect(css.split("@media (prefers-reduced-motion: reduce)").length).toBe(2);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run apps/web/src/blackjack/blackjack.css.test.ts`
Expected: FAIL — among others, "fills the fitted page" (`.bj` has no `container: bj / inline-size`), "inherit their width" (`expected [ '.bj__dealer .bj-card' ] to deeply equal []`), "puts the felt beside a side column" (the `@media (max-width: 720px)` block), "leaves none of the old buttons" (`.btn--move`), "has one off switch" (two blocks).

- [ ] **Step 4: Replace the stylesheet**

Replace the entire contents of `apps/web/src/blackjack/blackjack.css` with:

```css
/*
 * The blackjack table, on one screen.
 *
 * The dealer alone across the head of the felt and everybody else beneath,
 * facing them: every seat plays the house, so the only hand that matters to all
 * of them is the one at the top. On a phone the page is exactly the window — a
 * readout, the felt, and the controls under the thumb — and only the felt
 * flexes, with the cards sized off its height as well as its width, so a short
 * phone shrinks the cards rather than pushing Hit below the fold. Past 760px of
 * table the same markup puts the felt on the left and a side column of readout,
 * rules, activity and controls on the right.
 *
 * Imported by Blackjack.tsx and the style gallery's Deck.tsx. Poker deals the
 * same cards, so the card, hand and chip-pile rules near the end are the
 * building's and stay unscoped; everything about this table is a .bj class.
 * This sheet loads before fittings.css, so a rule that has to beat a fitting
 * uses two classes. What every table shares is in table/table.css.
 */

/* ------------------------------------------------------------- the table */

.bj {
  container: bj / inline-size;
  position: relative;
  flex: 1;
  min-height: 0;
}

/*
 * A grid of its own inside the container, because a container cannot ask a
 * container query about itself.
 */
.bj__in {
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas: "read" "felt" "controls";
  gap: var(--gr-space-2);
}

/* ------------------------------------------------------------ the readout */

.readout.bj__read {
  grid-area: read;
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--gr-space-3);
  padding: 9px 14px 10px;
  overflow: hidden;
  text-align: left;
}

.bj__big {
  display: grid;
  min-width: 0;
}

.bj__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--gr-color-ink-faint);
}

.bj__figure-row {
  display: flex;
  align-items: baseline;
  gap: var(--gr-space-2);
  min-width: 0;
}

.bj__figure {
  font-family: var(--gr-font-data);
  font-size: var(--gr-text-2xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
  color: var(--gr-color-ink-lit);
}

/* Chips, so gold, and lit the way the jackpot is. */
.bj__figure--chips {
  color: var(--gr-color-chip-hi);
  text-shadow:
    0 0 8px color-mix(in srgb, var(--gr-color-chip) 55%, transparent),
    0 0 22px color-mix(in srgb, var(--gr-color-chip) 25%, transparent);
}

/* Good and bad are what happened to the money, never the accent. */
.bj__figure--good {
  color: var(--gr-color-good);
}

.bj__figure--bad {
  color: var(--gr-color-bad);
}

.bj__note {
  white-space: nowrap;
  font-size: var(--gr-text-xs);
  font-weight: 500;
  color: var(--gr-color-ink-dim);
}

.bj__stats {
  display: grid;
  gap: 1px;
  /* Wide enough that a label and its number read as a pair, not a squeeze. */
  min-width: 132px;
  margin: 0;
}

.bj__stats div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: var(--gr-text-xs);
}

.bj__stats dt {
  color: var(--gr-color-ink-dim);
}

.bj__stats dd {
  margin: 0;
  font-family: var(--gr-font-data);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--gr-color-ink);
}

.bj__stats .bj__gold {
  color: var(--gr-color-chip-hi);
}

/* The clock, draining along the top edge of the screen. */
.bj__clock {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--t);
  height: 2px;
  background: var(--gr-color-neon-hi);
  box-shadow: 0 0 8px var(--gr-color-neon);
  transition: width 1s linear;
}

/* Betting: the window is the chips' clock, so it drains in gold. */
.bj__clock--chips {
  background: var(--gr-color-chip-hi);
  box-shadow: 0 0 8px var(--gr-color-chip);
}

/* -------------------------------------------------------------- the felt */

.bj__felt {
  grid-area: felt;
  container: bj-felt / size;
  position: relative;
  min-height: 0;
  border-radius: var(--gr-radius-cab);
  background:
    radial-gradient(110% 70% at 50% 0%, var(--gr-color-felt-lit), transparent 75%),
    var(--gr-color-felt);
  box-shadow:
    inset 0 0 0 1px rgb(0 0 0 / 0.5),
    inset 0 8px 30px rgb(0 0 0 / 0.45);
  overflow: hidden;
  /*
   * Cards take the room the felt has, in both directions. The height terms are
   * what keep the dealer, your hand and the other seats inside the felt on a
   * short phone: smaller cards, never a pushed-off Hit. Set here on the
   * container and inherited; a card never declares its own.
   */
  --bj-card-dealer: clamp(34px, min(19cqi, 15cqh), 74px);
  --bj-card-mine: clamp(38px, min(22cqi, 18cqh), 84px);
  --bj-card-other: clamp(20px, min(9.5cqi, 8.5cqh), 38px);
}

/*
 * Nothing on the felt is text to be selected. Dragging across a hand should not
 * leave half the table highlighted, and a rank is a drawing that happens to be
 * made of letters. Talk sits outside this, where selecting text is the point.
 */
.bj__felt,
.bj-card {
  user-select: none;
  -webkit-user-select: none;
}

/* What scrolls when there are more seats than fit: inside the felt, never the page. */
.bj__cloth {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gr-space-2);
  padding: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* The ? and Table keys, opposite talk's corner. */
.bj__corner {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  display: flex;
  gap: 6px;
}

.bj__corner .key {
  width: 36px;
  min-height: 36px;
  font-weight: 600;
}

/* ------------------------------------------------------------ the dealer */

.bj__dealer {
  display: grid;
  justify-items: center;
  gap: 4px;
  /* Clear of the corner keys on both sides. */
  padding: 4px 48px 6px;
  --bj-card-w: var(--bj-card-dealer);
}

.bj__dealer-who {
  display: flex;
  align-items: baseline;
  gap: var(--gr-space-2);
  margin: 0;
  font-family: var(--gr-font-display);
  font-size: var(--gr-text-sm);
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--gr-color-ink) 55%, transparent);
}

.bj__dealer-who b {
  font-family: var(--gr-font-data);
  font-weight: 600;
  color: var(--gr-color-ink-lit);
}

.bj__watchers {
  font-family: var(--gr-font-ui);
  font-size: var(--gr-text-xs);
  letter-spacing: 0;
  color: var(--gr-color-ink-faint);
}

.bj__arc {
  flex: none;
  height: 1px;
  margin: 0 18px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--gr-color-chip-hi) 28%, transparent), transparent);
}

/* A hand at this table holds exactly the room its cards need. */
.bj .bj-hand {
  min-height: 0;
  gap: 4px;
}

/* Where a card will go, so a hand between deals keeps its height. */
.bj__slot {
  flex: none;
  width: var(--bj-card-w, 47px);
  aspect-ratio: 5 / 7;
  border-radius: 4px;
  background: rgb(0 0 0 / 0.12);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.12);
}

/* ------------------------------------------------------------- the seats */

.bj__seats {
  display: grid;
  gap: 6px;
}

.bj__others {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.bj__seat {
  position: relative;
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 12px;
  background: rgb(0 0 0 / 0.26);
  box-shadow:
    inset 0 0 0 1px rgb(0 0 0 / 0.35),
    var(--gr-lip);
}

/* Yours, marked the way the leaderboard marks your row. */
.bj__seat--mine {
  --bj-card-w: var(--bj-card-mine);
  outline: 1px solid var(--gr-color-chip-dim);
  outline-offset: -1px;
}

/* A compact plate: a line of small cards and what they come to. */
.bj__seat--other {
  --bj-card-w: var(--bj-card-other);
  gap: 4px;
  padding: 6px 8px;
}

/*
 * Whose turn it is, in the room's neon because it is happening now; and a glow
 * that moves, because it is waiting on somebody. The ring is inside the
 * animation too, so the two never fight over the one box-shadow.
 */
.bj__seat--turn {
  background: color-mix(in srgb, var(--gr-color-neon) 14%, rgb(0 0 0 / 0.2));
  box-shadow:
    inset 0 0 0 1px var(--gr-color-neon),
    0 0 18px color-mix(in srgb, var(--gr-color-neon) 35%, transparent);
  animation: bj-waiting 2.1s ease-in-out infinite;
}

/* Waiting for the next hand, or gone: dimmed, never hidden, and its tag says which. */
.bj__seat--out {
  opacity: 0.5;
}

/* Paid. Gold, and only on the way in. */
.bj__seat--paid {
  animation: bj-paid 900ms ease-out;
}

.bj__seat-head {
  display: flex;
  align-items: center;
  gap: var(--gr-space-2);
  min-width: 0;
}

/*
 * The avatar and the clock drawn round it. A wrapper so the ring has something
 * the size of the face to sit on, rather than stretching across the header.
 */
.bj__face {
  position: relative;
  display: inline-flex;
  flex: none;
}

.bj__face .turn-ring {
  position: absolute;
  inset: -3px;
}

.bj__seat .seat__avatar {
  width: 26px;
  height: 26px;
  border-width: 1.5px;
  font-size: 12px;
}

.bj__seat--turn .seat__avatar {
  border-color: var(--gr-color-neon-hi);
  box-shadow: 0 0 10px var(--gr-color-neon);
}

.bj__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gr-text-sm);
  font-weight: 500;
  color: var(--gr-color-ink-lit);
}

/* Gold, because it is their money sitting on the felt. */
.bj__bet {
  margin-left: auto;
  font-family: var(--gr-font-data);
  font-size: var(--gr-text-sm);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--gr-color-chip-hi);
}

/* Play money on a seat that has not bet: faint, because it never reaches an account. */
.bj__purse {
  margin-left: auto;
  font-family: var(--gr-font-data);
  font-size: var(--gr-text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--gr-color-ink-faint);
}

.bj__play {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.bj__pile {
  display: flex;
  flex: none;
}

.bj__pile--dropped {
  animation: bj-drop 300ms cubic-bezier(0.2, 0.9, 0.25, 1);
}

.bj__seat .bj-hand {
  gap: 0;
}

.bj__seat--other .bj-hand {
  gap: 2px;
}

/*
 * A dealt hand overlaps, the way it sits on a real felt. The index is in the
 * corner of every card, so a covered card still says what it is.
 */
.bj__seat .bj-hand .bj-card + .bj-card {
  margin-left: calc(var(--bj-card-w) * -0.28);
}

.bj__seat--other .seat__avatar {
  width: 20px;
  height: 20px;
  font-size: 10px;
}

.bj__seat--other .bj__name {
  font-size: var(--gr-text-xs);
}

.bj__seat--other .bj__bet {
  font-size: 11px;
}

/* A state on a seat or a hand, arriving when it becomes true rather than being there all along. */
.bj__tag {
  animation: bj-said 260ms ease-out;
}

.bj__seat--other .bj__tag {
  padding: 1px 8px 1px 6px;
  font-size: 10.5px;
}

.tag.bj__tag--good {
  color: var(--gr-color-good);
}

.tag.bj__tag--good::before {
  background: var(--gr-color-good);
}

.tag.bj__tag--bad {
  color: var(--gr-color-bad);
}

.tag.bj__tag--bad::before {
  background: var(--gr-color-bad);
}

/* ------------------------------------------------------------- the count */

/* What a hand is worth, at the far end of the row from the stake. */
.bj__count {
  display: grid;
  justify-items: end;
  flex: none;
  margin: 0 0 0 auto;
  line-height: 1;
  font-family: var(--gr-font-data);
  font-variant-numeric: tabular-nums;
}

.bj__count-total {
  font-size: 26px;
  font-weight: 600;
  color: var(--gr-color-ink-lit);
}

.bj__seat--other .bj__count-total {
  font-size: 15px;
}

/* Soft, which is the difference between a decision and a formality. */
.bj__count-soft {
  margin-top: 2px;
  font-family: var(--gr-font-ui);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gr-color-ink-dim);
}

/* Past twenty-one: the bad colour, with a shake in the other direction to a tick. */
.bj__count--bad .bj__count-total {
  color: var(--gr-color-bad);
  animation: bj-bust 420ms ease-in-out;
}

/* Gold, because a blackjack is not a good score — it is a payout. */
.bj__count--chip .bj__count-total {
  color: var(--gr-color-chip-hi);
  text-shadow: 0 0 10px color-mix(in srgb, var(--gr-color-chip) 50%, transparent);
}

/* A total that has just changed, because a card arrived. */
.bj__count--ticked .bj__count-total {
  animation: bj-tick 320ms cubic-bezier(0.3, 1.4, 0.5, 1);
}

/* ------------------------------------------------------------ the splits */

/*
 * A split seat keeps one plate and gains a box per hand. The card size is set
 * on the seat, the container, and inherited.
 */
.bj__seat--split {
  --bj-card-w: clamp(26px, min(12cqi, 15cqh), 52px);
}

/* Not a rule the table plays today; the layout holds it anyway. */
.bj__seat--split.bj__seat--four {
  --bj-card-w: clamp(18px, min(8.5cqi, 10cqh), 32px);
}

.bj__boxes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.bj__seat--four .bj__boxes {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}

.bj__box {
  position: relative;
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 6px 7px 7px;
  border-radius: 10px;
  background: rgb(0 0 0 / 0.22);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.05);
  transition:
    opacity 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

/* The hand the buttons act on. Lit, because it is the one happening now. */
.bj__box--live {
  background: color-mix(in srgb, var(--gr-color-neon) 16%, rgb(0 0 0 / 0.2));
  box-shadow:
    inset 0 0 0 1.5px var(--gr-color-neon-hi),
    0 0 14px color-mix(in srgb, var(--gr-color-neon) 40%, transparent);
}

/* The other steps back while it waits: contrast carries at a glance, a thin rule does not. */
.bj__box--wait {
  opacity: 0.62;
}

.bj__box-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gr-color-ink-faint);
}

.bj__box--live .bj__box-top {
  color: var(--gr-color-neon-hi);
}

.bj__box-top b {
  font-family: var(--gr-font-data);
  font-size: 11px;
  letter-spacing: 0;
  text-transform: none;
  color: var(--gr-color-chip-hi);
}

.bj__box-play {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* Four across has no room for a total beside three cards, so it goes under. */
.bj__seat--four .bj__box-play {
  flex-wrap: wrap;
}

/* Tighter in a box: half a seat's width holds the same cards. */
.bj__box .bj-hand .bj-card + .bj-card {
  margin-left: calc(var(--bj-card-w) * -0.42);
}

.bj__box .bj__count-total {
  font-size: 20px;
}

.bj__seat--four .bj__box {
  padding: 5px;
}

.bj__seat--four .bj__box-top {
  font-size: 9px;
}

.bj__seat--four .bj__box .bj__count-total {
  font-size: 14px;
}

.bj__box .bj__tag {
  justify-self: start;
}

/* Somebody else's split, on a compact plate: two little hands and a hairline between. */
.bj__minis {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.bj__mini {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.bj__mini .bj__count {
  margin-left: 0;
}

.bj__mini .bj__count-total {
  font-size: 13px;
}

.bj__mini--live .bj__count-total {
  color: var(--gr-color-neon-hi);
}

.bj__minis i {
  align-self: stretch;
  width: 1px;
  background: rgb(255 255 255 / 0.12);
}

/* ------------------------------------------------------- the big moments */

/* A hand dealt twenty-one: the one lit word on the felt, once. */
.bj__banner {
  position: absolute;
  left: 50%;
  top: 44%;
  z-index: 3;
  margin: 0;
  padding: 4px 18px 8px;
  font-family: var(--gr-font-display);
  font-size: clamp(1.6rem, 12cqi, 2.4rem);
  line-height: 1;
  white-space: nowrap;
  color: var(--gr-color-chip-hi);
  text-shadow:
    0 0 12px color-mix(in srgb, var(--gr-color-chip) 80%, transparent),
    0 0 36px color-mix(in srgb, var(--gr-color-chip) 45%, transparent),
    0 3px 0 rgb(0 0 0 / 0.6);
  transform: translate(-50%, -50%) rotate(-4deg);
  pointer-events: none;
  animation: bj-banner 420ms var(--gr-settle) both;
}

/* Gone past it: a stamp, once. */
.bj__stamp {
  position: absolute;
  left: 50%;
  top: 46%;
  z-index: 3;
  margin: 0;
  padding: 4px 16px 8px;
  border: 3px solid var(--gr-color-bad);
  border-radius: 10px;
  background: rgb(0 0 0 / 0.35);
  font-family: var(--gr-font-display);
  font-size: clamp(1.8rem, 16cqi, 3rem);
  line-height: 1;
  color: var(--gr-color-bad);
  text-shadow: 0 2px 0 rgb(0 0 0 / 0.4);
  transform: translate(-50%, -50%) rotate(-7deg);
  pointer-events: none;
  animation: bj-stamp 260ms cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
}

/* ------------------------------------------------------------- the sheets */

.bj__scrim {
  position: absolute;
  inset: 0;
  z-index: 4;
  padding: 0;
  border: 0;
  border-radius: inherit;
  background: rgb(0 0 0 / 0.45);
  cursor: default;
  animation: bj-fade 200ms ease both;
}

.bj__sheet {
  position: absolute;
  z-index: 5;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid rgb(0 0 0 / 0.62);
  border-radius: var(--gr-radius-cab);
  background: linear-gradient(
    180deg,
    var(--gr-color-smoke-lit) 0%,
    var(--gr-color-smoke) 10%,
    var(--gr-color-slate) 50%,
    color-mix(in srgb, var(--gr-color-slate) 55%, var(--gr-color-shadow)) 100%
  );
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.09),
    0 -18px 40px rgb(0 0 0 / 0.5);
  animation: bj-rise 300ms var(--gr-settle) both;
}

.bj__sheet:focus {
  outline: none;
}

/* The rules card, over the felt it describes. */
.bj__sheet--felt {
  top: 0;
}

/* The host's settings: up from the bottom, stopping short of the readout. */
.bj__sheet--page {
  top: max(120px, 28%);
}

.bj__sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gr-space-2);
  padding: var(--gr-space-2) var(--gr-space-2) var(--gr-space-2) var(--gr-space-4);
  border-bottom: 1px solid rgb(0 0 0 / 0.45);
}

.bj__sheet-title,
.bj__panel-title {
  margin: 0;
  font-size: var(--gr-text-xs);
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--gr-color-ink-dim);
}

.bj__sheet-body {
  display: flex;
  flex-direction: column;
  gap: var(--gr-space-4);
  flex: 1;
  min-height: 0;
  padding: 14px;
  overflow-y: auto;
}

.bj__field {
  display: grid;
  justify-items: start;
  gap: 6px;
}

.bj__bots {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  width: 100%;
}

/* ------------------------------------------------------ the rules card */

.bj__pays {
  display: grid;
  gap: 1px;
  margin: 0;
}

.bj__pay {
  display: flex;
  justify-content: space-between;
  gap: var(--gr-space-2);
  padding: 4px 6px;
  border-bottom: 1px solid rgb(255 255 255 / 0.05);
  border-radius: 6px;
  font-size: var(--gr-text-xs);
  color: var(--gr-color-ink-dim);
}

.bj__pay dd {
  margin: 0;
  white-space: nowrap;
  font-family: var(--gr-font-data);
  font-weight: 600;
  color: var(--gr-color-ink);
}

/* What applies to the hand in front of you now, found on the card. */
.bj__pay--lit {
  background: color-mix(in srgb, var(--gr-color-neon) 16%, transparent);
  color: var(--gr-color-neon-hi);
}

/* The side column's panels only exist at a desk; a phone reaches them through ? and talk. */
.bj__rules {
  grid-area: rules;
  display: none;
}

.bj__activity {
  grid-area: activity;
  display: none;
}

/* ---------------------------------------------------------- the controls */

.bj__controls {
  grid-area: controls;
  display: grid;
  gap: var(--gr-space-2);
}

.bj__controls :is(.slab, .key) {
  flex-direction: column;
  gap: 1px;
  width: 100%;
  min-height: 52px;
  padding-inline: var(--gr-space-2);
  line-height: 1.15;
}

.bj__controls .key--icon {
  width: 52px;
  padding: 0;
}

.bj__controls .slab {
  font-size: var(--gr-text-lg);
}

.bj__controls small {
  font-family: var(--gr-font-data);
  font-size: var(--gr-text-xs);
  font-weight: 500;
  letter-spacing: 0;
  text-shadow: none;
  opacity: 0.85;
}

.bj__controls .key small {
  color: var(--gr-color-ink-dim);
}

/* A price on a key is chips, so gold, even on a key that is not lit. */
.bj__controls .key .bj__cost {
  color: var(--gr-color-chip-hi);
}

/* A key's letter is for a keyboard, which a phone does not have. */
.bj__controls kbd {
  display: none;
}

/* The chips, sunk into the panel above the keys that act on them. */
.well.bj__tray {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  padding: 6px 8px;
}

/*
 * The chip is drawn, not styled — see Chip.tsx. What is left here is how it
 * behaves under a finger, so the button is nothing but a round hit area.
 */
.bj__chip {
  display: grid;
  place-items: center;
  flex: 0 1 52px;
  width: 52px;
  height: 52px;
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  line-height: 0;
  cursor: pointer;
  transition:
    transform 120ms cubic-bezier(0.2, 0.9, 0.25, 1),
    filter 120ms ease;
}

.bj__chip .chip {
  display: block;
  width: 100%;
  max-width: 48px;
  height: auto;
  filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.5));
}

/* Picked up between finger and thumb, not merely nudged. */
.bj__chip:hover:not(:disabled) {
  transform: translateY(-5px) rotate(-4deg) scale(1.06);
}

/* And put down under the finger, rather than a round trip later. */
.bj__chip:active:not(:disabled) {
  transform: translateY(2px) scale(0.97);
}

.bj__chip:focus-visible {
  outline: 2px solid var(--gr-color-neon-hi);
  outline-offset: 3px;
}

/* Not one you can add: still a chip, just not one you can reach, and it says why. */
.bj__chip:disabled {
  opacity: 0.25;
  cursor: not-allowed;
  filter: grayscale(0.7);
}

.bj__row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  align-items: start;
  gap: var(--gr-space-2);
}

.bj__row--host {
  grid-template-columns: 52px minmax(0, 1fr) minmax(0, 1.4fr);
}

/* Stand across the top, Double and Split under it, Hit down the thumb's side. */
.bj__controls--turn {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.25fr);
  grid-template-rows: auto auto;
  align-items: stretch;
}

.bj__stand {
  grid-column: 1 / 3;
}

.bj__controls--turn .slab {
  grid-column: 3;
  grid-row: 1 / 3;
  /* The slab is drawn as a shadow below itself, so it leaves room for it. */
  height: calc(100% - var(--gr-press));
}

/* Waiting on somebody else: their turn is the wide thing, taunting the other. */
.bj__controls--wait {
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  align-items: start;
}

.bj__controls--wait .taunt-picker {
  width: 100%;
}

.bj__controls--wait .taunt-picker__open {
  flex-direction: row;
}

.bj__watching {
  margin: 0;
  padding: var(--gr-space-2) 0;
  text-align: center;
  font-size: var(--gr-text-sm);
  color: var(--gr-color-ink-dim);
}

/* --------------------------------------------------------------- the desk */

@container bj (min-width: 760px) {
  .bj__in {
    grid-template-columns: minmax(0, 1fr) 330px;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    grid-template-areas: "felt read" "felt rules" "felt activity" "felt controls";
    gap: var(--gr-space-4) var(--gr-space-5);
  }

  .readout.bj__read {
    padding: 14px 18px;
  }

  .bj__figure {
    font-size: var(--gr-text-3xl);
  }

  .bj__stats div {
    font-size: var(--gr-text-sm);
  }

  .bj__rules,
  .bj__activity {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    padding: 12px 14px;
    border-radius: 14px;
    background: rgb(0 0 0 / 0.26);
    box-shadow:
      inset 0 5px 10px rgb(0 0 0 / 0.42),
      0 1px 0 rgb(255 255 255 / 0.05);
  }

  /* The card is in the side column now, so its key would open a second copy. */
  .bj__help {
    display: none;
  }

  .bj__felt {
    --bj-card-dealer: clamp(40px, min(12cqi, 20cqh), 124px);
    --bj-card-mine: clamp(40px, min(9.5cqi, 17cqh), 100px);
    --bj-card-other: clamp(24px, min(6.2cqi, 12cqh), 70px);
  }

  .bj__cloth {
    gap: 18px;
    padding: var(--gr-space-5);
  }

  .bj__dealer {
    padding-top: 14px;
  }

  .bj__dealer .bj-hand {
    gap: 8px;
  }

  .bj__dealer-who {
    font-size: var(--gr-text-base);
  }

  /* Along the bottom of the felt, yours wider: it is the hand you are reading. */
  .bj__seats {
    grid-auto-flow: column;
    grid-template-columns: minmax(0, 1.5fr);
    grid-auto-columns: minmax(0, 1fr);
    align-items: end;
    gap: 12px;
    margin-top: auto;
  }

  .bj__others {
    display: contents;
  }

  .bj__seat {
    gap: 10px;
    padding: 12px;
  }

  .bj__play {
    flex-wrap: wrap;
  }

  .bj__count-total {
    font-size: 30px;
  }

  .bj__seat--other .seat__avatar {
    width: 26px;
    height: 26px;
    font-size: 12px;
  }

  .bj__seat--other .bj__name {
    font-size: var(--gr-text-sm);
  }

  .bj__seat--other .bj__count-total {
    font-size: 22px;
  }

  /* A drawer from the right at a desk, as talk is. */
  .bj__sheet--page {
    top: 0;
    left: auto;
    width: 380px;
  }

  .bj__controls kbd {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    margin-left: 6px;
    padding: 0 4px;
    border-radius: 5px;
    background: rgb(0 0 0 / 0.35);
    box-shadow: inset 0 -1px 0 rgb(255 255 255 / 0.08);
    font-family: var(--gr-font-data);
    font-size: 10.5px;
    font-weight: 500;
    color: var(--gr-color-ink-dim);
    text-shadow: none;
    vertical-align: 1px;
  }
}

/* ============================================ the cards (shared with poker) */

/*
 * Prefixed, unlike most card-game names. `.card` and `.hand` were already
 * taken — Greed's scorecard is a `.card` — and every page loads every game's
 * stylesheet, so the collision once dressed Greed's points table as a playing
 * card.
 */
.bj-hand {
  display: flex;
  gap: 3px;
  min-height: 74px;
  align-items: flex-start;
}

/*
 * A hand that has outgrown its row, overlapped rather than spread. The index
 * lives in the corner of every card, so an overlapped one still says what it is.
 */
.bj-hand--tight .bj-card + .bj-card {
  margin-left: -26px;
}

/*
 * One card, at the size its container asks for. Width only: the drawing
 * carries its own 2.5×3.5 proportion, and every number inside it scales with
 * the box.
 */
.bj-card {
  width: var(--bj-card-w, 47px);
  height: auto;
  flex: none;
  display: block;
  border-radius: var(--gr-radius-md);
  filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.5));
  /* The ink. Everything drawn on the face inherits it, which is the whole of
     the red/black distinction — there is no second set of shapes. */
  color: #1b1b1b;
}

.bj-card--red {
  color: #b0202a;
}

/* Paper, and the only white thing in the room besides the burning middle of
   the sign — which is why a dealt hand pulls the eye without being lit. */
.bj-card__face {
  fill: #fdfbf6;
  stroke: rgb(0 0 0 / 0.32);
  stroke-width: 1;
}

.bj-card__rank {
  font-family: var(--gr-font-display);
  /* A sixth of the card's height, which is where a real deck puts it. */
  font-size: 23px;
  fill: currentColor;
  /* Snapped-to-pixel hinting makes small type jump a pixel at a time as a card turns. */
  text-rendering: geometricPrecision;
}

/* The court's panel: the suit's own colour, at the weight of a wash. */
.bj-card__panel {
  fill: color-mix(in srgb, currentColor 8%, transparent);
  stroke: color-mix(in srgb, currentColor 45%, transparent);
  stroke-width: 1.2;
}

.bj-card__rule {
  stroke: color-mix(in srgb, currentColor 32%, transparent);
  stroke-width: 1.2;
  fill: none;
}

/*
 * The weave, in whatever colours the game being played is dressed in. A
 * table's theme sets these three and gets a deck of its own without a second
 * drawing of one.
 */
.bj-card--down {
  --bj-back: var(--gr-color-neon-deep, #0b3fd4);
  --bj-back-weft: #12203c;
  --bj-back-warp: #1f3a70;
}

.bj-card__back {
  fill: #0d1220;
  stroke: var(--bj-back);
  stroke-width: 1;
}

.bj-card__weft {
  fill: var(--bj-back-weft);
}

.bj-card__warp {
  fill: var(--bj-back-warp);
}

/* The one gold line on the back, which is what ties it to the chips. */
.bj-card__edge {
  fill: none;
  stroke: var(--gr-color-chip);
  stroke-width: 1.1;
  opacity: 0.75;
}

/*
 * A card leans toward the pointer and lifts off the felt. The angles come from
 * the pointer, on the element, in Cards.tsx — this only says what to do with
 * them. The transition is for coming back to rest, not for following the
 * pointer, which is what made the corner type shiver.
 */
.bj-card {
  --tilt-x: 0deg;
  --tilt-y: 0deg;
  position: relative;
  transition:
    transform 220ms ease-out,
    filter 150ms ease-out;
}

.bj-card:hover {
  /* Following the pointer directly; interpolating between sixty updates a second was not smooth. */
  transition: filter 150ms ease-out;
  will-change: transform;
  backface-visibility: hidden;
  /* Above its neighbours, which in an overlapped hand is the whole point. */
  z-index: 6;
  transform: perspective(620px) rotateX(var(--tilt-x)) rotateY(var(--tilt-y)) scale(1.05);
  filter: drop-shadow(0 10px 16px rgb(0 0 0 / 0.6));
}

/* ----------------------------------------------- a stake as a pile of chips */

.stack {
  display: block;
  filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.5));
}

.stack__chip {
  /* An SVG group scales about the document's origin unless told otherwise,
     which throws the chip across the felt instead of settling it. */
  transform-box: fill-box;
  transform-origin: center;
  animation: chip-land 280ms cubic-bezier(0.2, 0.9, 0.25, 1) backwards;
}

/* ============================================================ the motion */

/*
 * Everything that happens at a card table happens to something, and the point
 * of animating it is to say which thing: a card comes from the shoe, a stake
 * lands, a total changes because a card arrived.
 */

/* A chip put down: dropped from a little above and settling, each on its own. */
@keyframes chip-land {
  0% {
    opacity: 0;
    transform: translateY(-15px) scale(1.09);
  }
  70% {
    opacity: 1;
    transform: translateY(2px) scale(0.99);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Out of the shoe — up and to the right of the felt — turning as it comes. */
@keyframes bj-deal {
  0% {
    opacity: 0;
    transform: translate(90px, -120px) rotate(16deg) scale(0.86);
  }
  70% {
    opacity: 1;
    transform: translate(0, 3px) rotate(-2.5deg) scale(1.02);
  }
  100% {
    opacity: 1;
    transform: translate(0, 0) rotate(0deg) scale(1);
  }
}

/* The hole card, turned over: squashed through the middle rather than rotated in 3D. */
@keyframes bj-turn {
  0% {
    transform: scaleX(0.06) rotate(-3deg);
    filter: brightness(1.5);
  }
  55% {
    transform: scaleX(1.06) rotate(1deg);
    filter: brightness(1.12);
  }
  100% {
    transform: scaleX(1) rotate(0deg);
    filter: brightness(1);
  }
}

/*
 * A card turned over where it lies, in two halves: the back folds away and the
 * face opens out in its place. The fold holds its end state, or the back snaps
 * back to full width for the frame between the two and flashes.
 */
@keyframes bj-fold {
  0% {
    transform: scaleX(1);
  }
  100% {
    transform: scaleX(0.05);
    filter: brightness(1.35);
  }
}

@keyframes bj-unfold {
  0% {
    transform: scaleX(0.05);
    filter: brightness(1.35);
  }
  100% {
    transform: scaleX(1);
    filter: brightness(1);
  }
}

.bj-card--deal {
  animation: bj-deal 380ms cubic-bezier(0.2, 0.9, 0.25, 1) backwards;
}

.bj-card--turn {
  animation: bj-turn 320ms cubic-bezier(0.3, 0.8, 0.3, 1) backwards;
}

.bj-card--fold {
  animation: bj-fold 120ms ease-in forwards;
}

.bj-card--unfold {
  animation: bj-unfold 120ms ease-out backwards;
}

/* Dropped onto the felt from the hand that placed it. */
@keyframes bj-drop {
  0% {
    transform: translateY(-16px) scale(1.1);
  }
  60% {
    transform: translateY(2px) scale(0.98);
  }
  100% {
    transform: translateY(0) scale(1);
  }
}

@keyframes bj-tick {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.22);
  }
  100% {
    transform: scale(1);
  }
}

/* Sharper than a tick and sideways, so it does not read as one more card going well. */
@keyframes bj-bust {
  0%,
  100% {
    transform: translateX(0) scale(1);
  }
  15% {
    transform: translateX(-5px) scale(1.06);
  }
  38% {
    transform: translateX(5px) scale(1.06);
  }
  60% {
    transform: translateX(-3px) scale(1.02);
  }
  80% {
    transform: translateX(3px) scale(1.02);
  }
}

@keyframes bj-waiting {
  0%,
  100% {
    box-shadow:
      inset 0 0 0 1px var(--gr-color-neon),
      0 0 6px color-mix(in srgb, var(--gr-color-neon) 20%, transparent);
  }
  50% {
    box-shadow:
      inset 0 0 0 1px var(--gr-color-neon),
      0 0 22px 2px color-mix(in srgb, var(--gr-color-neon) 40%, transparent);
  }
}

@keyframes bj-paid {
  0% {
    box-shadow:
      inset 0 0 0 1px var(--gr-color-chip),
      0 0 0 0 rgb(224 176 72 / 0);
  }
  35% {
    box-shadow:
      inset 0 0 0 1px var(--gr-color-chip-hi),
      0 0 26px 4px rgb(224 176 72 / 0.42);
  }
  100% {
    box-shadow:
      inset 0 0 0 1px rgb(0 0 0 / 0.35),
      0 0 0 0 rgb(224 176 72 / 0);
  }
}

@keyframes bj-said {
  0% {
    opacity: 0;
    transform: translateY(-6px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes bj-banner {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) rotate(-4deg) scale(0.8);
  }
}

@keyframes bj-stamp {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) rotate(-7deg) scale(1.6);
  }
}

@keyframes bj-fade {
  from {
    opacity: 0;
  }
}

@keyframes bj-rise {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
}

/* ------------------------------------------------------------ off switch */

/*
 * Every selector that moves, repeated exactly, so each is switched off by name.
 * blackjack.css.test.ts fails if one is missing. Without the motion every state
 * still reads: the lit seat is still lit, the stamp is still there.
 */
@media (prefers-reduced-motion: reduce) {
  .bj__clock,
  .bj__seat--turn,
  .bj__seat--paid,
  .bj__pile--dropped,
  .bj__tag,
  .bj__count--bad .bj__count-total,
  .bj__count--ticked .bj__count-total,
  .bj__box,
  .bj__banner,
  .bj__stamp,
  .bj__scrim,
  .bj__sheet,
  .bj__chip,
  .bj__chip:hover:not(:disabled),
  .bj__chip:active:not(:disabled),
  .bj-card,
  .bj-card:hover,
  .stack__chip,
  .bj-card--deal,
  .bj-card--turn,
  .bj-card--fold,
  .bj-card--unfold {
    animation: none;
    transition: none;
  }

  .bj__chip:hover:not(:disabled),
  .bj__chip:active:not(:disabled),
  .bj-card:hover {
    transform: none;
  }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run apps/web/src/blackjack/blackjack.css.test.ts apps/web/src/table/table.css.test.ts apps/web/src/game/greed.css.test.ts`
Expected: all PASS.

- [ ] **Step 6: Make sure nothing else leaned on a removed rule**

Run: `npx vitest run apps/web/src/blackjack apps/web/src/poker apps/web/src/style`
Expected: all PASS (the old page is still wired and unstyled until Task 11; its tests do not read CSS).

- [ ] **Step 7: Commit**

```bash
npx biome lint apps/web/src/blackjack/blackjack.css.test.ts
git add apps/web/src/blackjack/blackjack.css apps/web/src/blackjack/blackjack.css.test.ts
git commit -m "feat(web): the blackjack felt on one screen, sized from the room it has

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Wire the page (L1, C1–C5, A1–A2, N1–N5, T3, host tools)

**Files:**
- Modify: `apps/web/src/blackjack/Icons.tsx` (add `TableIcon`)
- Modify (replace entirely): `apps/web/src/blackjack/Blackjack.tsx`
- Modify (replace entirely): `apps/web/src/blackjack/Blackjack.test.tsx`

**Interfaces:**
- Consumes: everything above — `readoutFor`, `Readout` (Task 4); `Dealer`, `Seats` (Task 5); `Moments` (Task 6); `Controls` (Task 7); `Sheet`, `HowItPays`, `paysFor`, `PAYS_SHEET_ID`, `TableSheet`, `TABLE_SHEET_ID` (Task 8); `useBlackjackKeys` (Task 9); the styles (Task 10); `TableView.eventSeq` (Task 2). From PR 1: `TalkKey`, `TalkSheet`, `useTalk` (`../table/TalkSheet.js`), `ActivityLog`, `useActivity` (`../table/Activity.js`), `Refusal` (`../table/Refusal.js`). `useIntent(view, seatId, error, errorKey)`.
- Produces: `Blackjack()` (unchanged export) rendering `main.play.play--fit` at a table, with `section.bj` inside.

- [ ] **Step 1: Write the failing page tests**

Replace the entire contents of `apps/web/src/blackjack/Blackjack.test.tsx` with (the first `describe` is the file's existing test, kept as it was):

```tsx
// @vitest-environment jsdom
import type { TableView } from "@backroom/game-blackjack";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { opensForFun } from "../table/TableSetup.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { Blackjack } from "./Blackjack.js";
import { settledHand, theirTurn, view, yourTurn } from "./fixtures.js";

vi.mock("../table/useTableSocket.js", () => ({ useTableSocket: vi.fn() }));
vi.mock("../game/useAccount.js", () => ({ useAccount: vi.fn() }));
vi.mock("../nav/NavContext.js", () => ({ useNav: vi.fn() }));
vi.mock("../game/audio.js", async (original) => ({
  ...(await original<typeof import("../game/audio.js")>()),
  play: vi.fn(),
  preload: vi.fn(async () => {}),
  unlock: vi.fn(),
}));

/*
 * What a new table opens as.
 *
 * The bug this pins was invisible: the panel defaulted to play money for
 * everybody, because it decided at mount and the account had not come back
 * yet. A profile that has not arrived is indistinguishable from a guest, and
 * the host only found out when the table they had opened would not take a
 * chip.
 */
describe("what a new table plays for", () => {
  it("opens for chips once the account is known", () => {
    expect(opensForFun(null, false)).toBe(false);
  });

  it("opens for play money for somebody with no account", () => {
    expect(opensForFun(null, true)).toBe(true);
  });

  it("follows the account until the host picks, rather than freezing at mount", () => {
    // The whole bug in one line: guest is true while the profile is on its
    // way and false once it lands, and the default has to move with it.
    expect(opensForFun(null, true)).toBe(true);
    expect(opensForFun(null, false)).toBe(false);
  });

  it("keeps what the host picked, whatever the account says", () => {
    // Including a signed-in host deliberately opening a for-fun table, which
    // is the case a default that merely watched the account would undo.
    expect(opensForFun(true, false)).toBe(true);
    expect(opensForFun(false, false)).toBe(false);
    expect(opensForFun(true, true)).toBe(true);
  });
});

const account: Account = {
  profile: {
    id: "u1",
    name: "Ada",
    avatar: null,
    accentColor: null,
    chips: 12_400,
    stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
    byGame: {},
  },
  available: true,
  loading: false,
  admin: false,
  refresh: vi.fn(),
  setChips: vi.fn(),
  signOut: vi.fn(),
};

function socket(state: TableView | null, over: Partial<TableSocketHook<TableView>> = {}): TableSocketHook<TableView> {
  return {
    state,
    listed: true,
    seatId: "a",
    error: null,
    errorKey: 0,
    connected: true,
    taken: null,
    retry: vi.fn(),
    busy: false,
    chat: [],
    say: vi.fn(),
    addBot: vi.fn(),
    setListed: vi.fn(),
    create: vi.fn(),
    join: vi.fn(),
    watch: vi.fn(),
    leave: vi.fn(),
    act: vi.fn(),
    landed: [],
    stakes: [],
    taunt: vi.fn(),
    ...over,
  };
}

function show(hook: TableSocketHook<TableView>) {
  vi.mocked(useTableSocket).mockReturnValue(hook as TableSocketHook<unknown>);
  return render(
    <MemoryRouter initialEntries={["/blackjack/HG4ME"]}>
      <Routes>
        <Route path="/blackjack/:code" element={<Blackjack />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(useAccount).mockReturnValue(account);
  // The taunt catalogue: none, which is a picker that does not render.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, json: async () => ({}) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const slabs = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>(".slab")];

describe("the table's one slab", () => {
  it("is Ready, lit, while betting", () => {
    const { container } = show(socket(view()));
    const [ready, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(ready?.disabled).toBe(false);
    expect(ready?.textContent).toMatch(/^Ready/);
  });

  it("is Hit, lit, on your turn", () => {
    const { container } = show(socket(yourTurn()));
    const [hit, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(hit?.disabled).toBe(false);
    expect(hit?.textContent).toMatch(/^Hit/);
  });

  it("is out, saying whose turn it is, while somebody else acts", () => {
    const { container } = show(socket(theirTurn()));
    const [turn, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(turn?.disabled).toBe(true);
    expect(turn?.textContent).toMatch(/^Bo's turn/);
  });

  it("is out, counting to the next hand, once the hand is over", () => {
    const { container } = show(socket(settledHand()));
    const [next, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(next?.disabled).toBe(true);
    expect(next?.textContent).toMatch(/^Next hand/);
  });

  it("is not there at all for somebody watching", () => {
    const { container } = show(socket(yourTurn(), { seatId: null }));
    expect(slabs(container)).toHaveLength(0);
  });
});

describe("the page at a table", () => {
  it("is the fitted page, with the felt scrolling inside itself", () => {
    const { container } = show(socket(view()));
    expect(container.querySelector("main")?.classList.contains("play--fit")).toBe(true);
    expect(container.querySelector(".bj__cloth.table-scroll")).not.toBeNull();
  });

  it("shows a refusal over the board rather than as a strip", () => {
    const { container } = show(socket(view(), { error: "Last call — you can only take chips back now.", errorKey: 1 }));
    expect(screen.getByRole("alert").textContent).toContain("Last call");
    expect(container.querySelector(".play__error")).toBeNull();
  });

  it("keeps what the table said in a log, and has no event strip", () => {
    const { container } = show(socket(view({ lastEvent: "Ada is ready", eventSeq: 3 })));
    expect(container.querySelector(".play__event")).toBeNull();
    expect(screen.getByRole("list", { name: "Activity" }).textContent).toContain("Ada is ready");
  });

  it("opens talk from a key on the felt, not an inline panel", () => {
    const { container } = show(socket(view()));
    expect(container.querySelector(".table-talk-corner .talk-key")).not.toBeNull();
    expect(container.querySelector(".play__talk")).toBeNull();
  });

  it("keeps the rules card within reach", () => {
    show(socket(yourTurn()));
    expect(screen.getByRole("button", { name: "How it pays" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "How it pays" }).textContent).toContain("Blackjack pays");
  });
});

describe("the host's Table key", () => {
  it("is there for the host", () => {
    show(socket(view({ hostId: "a" })));
    expect(screen.getByRole("button", { name: "Table" })).toBeTruthy();
  });

  it("is not there for anybody else", () => {
    show(socket(view({ hostId: "b" })));
    expect(screen.queryByRole("button", { name: "Table" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run apps/web/src/blackjack/Blackjack.test.tsx`
Expected: the four `opensForFun` tests PASS; every other test FAILS against the old page — no `.slab` (it used `.btn` and `.bj__ready`), `main` without `play--fit`, a `.play__error` strip, a `.play__event` strip, no talk key, no "How it pays", no "Table" key.

- [ ] **Step 3: Add the Table icon**

In `apps/web/src/blackjack/Icons.tsx`, directly after `ClockIcon`, add:

```tsx
/** Two sliders: the table's own settings, which are what a host adjusts. */
export function TableIcon() {
  return (
    <Glyph>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <path d="M4 17h4" />
      <path d="M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </Glyph>
  );
}
```

- [ ] **Step 4: Rewire the page**

Replace the entire contents of `apps/web/src/blackjack/Blackjack.tsx` with:

```tsx
import type { TableView } from "@backroom/game-blackjack";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { play } from "../game/audio.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { useCountdown } from "../game/useCountdown.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { ActivityLog, useActivity } from "../table/Activity.js";
import { Refusal } from "../table/Refusal.js";
import { TableSetup } from "../table/TableSetup.js";
import { TalkKey, TalkSheet, useTalk } from "../table/TalkSheet.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTablePeek } from "../table/useTablePeek.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { TauntPicker } from "../taunt/TauntPicker.js";
import { TauntStage } from "../taunt/TauntStage.js";
import { Controls } from "./Controls.js";
import { HowItPays, PAYS_SHEET_ID, paysFor } from "./HowItPays.js";
import { DiscordIcon, TableIcon } from "./Icons.js";
import { Moments } from "./Moments.js";
import { Readout, readoutFor } from "./Readout.js";
import { Dealer, Seats } from "./Seats.js";
import { Sheet } from "./Sheet.js";
import { TABLE_SHEET_ID, TableSheet } from "./TableSheet.js";
import { useBlackjackKeys } from "./useBlackjackKeys.js";
import { useCardSound } from "./useCardSound.js";
import type { Move } from "./useIntent.js";
import { useIntent } from "./useIntent.js";
import "@backroom/game-blackjack/theme.css";
import "./blackjack.css";

type Table = TableSocketHook<TableView>;

export function Blackjack() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/blackjack"), [navigate]);
  // The balance in the corner follows the hand: the stake goes as the chips
  // are pushed out and the payout lands on the table's own clock, neither of
  // which the browser asked for.
  const table = useTableSocket<TableView>("blackjack", back, account.setChips);
  const { state, seatId } = table;
  useCardSound(state, seatId);

  useNav({
    room: "blackjack",
    game: "Blackjack",
    ...(state !== null
      ? {
          table: {
            code: state.code,
            onLeave: table.leave,
            confirm: state.phase === "playing",
          },
        }
      : {}),
    connected: table.connected,
  });

  // The address bar follows the table, so the link can be shared and a refresh
  // lands back at the same one.
  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/blackjack/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  // The felt, as against setup and sign-in, which are pages and scroll like them.
  const atTable = table.taken === null && state !== null;

  return (
    <main className={`play${atTable ? " play--fit" : ""}`}>
      {/* At the table a refusal takes the middle of the board; on a page it stays a strip. */}
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
        <>
          <BlackjackTable table={table} state={state} seatId={seatId} account={account} />
          {/* Over the felt, because a taunt belongs to the table and not to the cards. */}
          <TauntStage landed={table.landed} />
        </>
      )}
    </main>
  );
}

function BlackjackTable({
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
  /*
   * What this player has asked for, before the table has answered.
   *
   * A move is a round trip, and a round trip is long enough for a button to
   * feel broken. So a press changes the felt at once and the table's answer
   * replaces it — never inventing anything, only showing what was asked for.
   */
  const intent = useIntent(state, seatId, table.error, table.errorKey);
  // A stake is this player's own number, so it shows from the press.
  const mine = intent.bet ?? me?.bet ?? 0;
  const left = useCountdown(state.deadline);
  const turnLeft = useCountdown(state.turnEndsAt);
  const talk = useTalk(table.chat, seatId);
  // Kept from the first line the table says, so nothing is lost while talk is
  // shut; the counter tells "Ada is ready" twice from one broadcast sent twice.
  const activity = useActivity({ code: state.code, text: state.lastEvent, seq: state.eventSeq });
  const [sheet, setSheet] = useState<"pays" | "table" | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const toggleSheet = (which: "pays" | "table") => setSheet((was) => (was === which ? null : which));
  const root = useRef<HTMLElement | null>(null);
  useBlackjackKeys(root);
  const isHost = state.hostId === seatId && seatId !== null;
  const pays = paysFor(state, seatId, chips);

  /**
   * Sends a move, and shows it as sent. Both in one place so the two can never
   * disagree — a move that reached the table without the felt knowing would
   * leave the buttons live for a second move on the same cards.
   */
  const move = (kind: Move) => {
    intent.send(kind);
    table.act({ type: kind });
  };
  const stake = (amount: number) => {
    // Sounded and shown on the press: the whole point of a chip is that it lands under your finger.
    play("bet");
    intent.place(amount);
    table.act({ type: "bet", amount });
  };
  const log = <ActivityLog entries={activity} />;

  return (
    <section className="bj" aria-label="The table" ref={root}>
      <div className="bj__in">
        <Readout model={readoutFor({ state, seatId, mine, chips, move: intent.move, left, turnLeft })} />

        <div className="bj__felt">
          <div className="bj__cloth table-scroll">
            <Dealer dealer={state.dealer} watching={state.watching} />
            <div className="bj__arc" aria-hidden="true" />
            <Seats
              state={state}
              seatId={seatId}
              stake={mine}
              arriving={intent.move === "hit" || intent.move === "double"}
            />
          </div>
          <div className="table-talk-corner">
            <TalkKey open={talk.open} unread={talk.unread} onToggle={talk.toggle} />
          </div>
          <div className="bj__corner">
            <button
              type="button"
              className="key key--icon bj__help"
              aria-label="How it pays"
              aria-controls={PAYS_SHEET_ID}
              aria-expanded={sheet === "pays"}
              onClick={() => toggleSheet("pays")}
            >
              ?
            </button>
            {isHost ? (
              <button
                type="button"
                className="key key--icon bj__host"
                aria-label="Table"
                aria-controls={TABLE_SHEET_ID}
                aria-expanded={sheet === "table"}
                onClick={() => toggleSheet("table")}
              >
                <TableIcon />
              </button>
            ) : null}
          </div>
          <Moments me={me} />
          <Sheet
            id={PAYS_SHEET_ID}
            label="How it pays"
            open={sheet === "pays"}
            onClose={closeSheet}
            className="bj__sheet--felt"
          >
            <HowItPays pays={pays} />
          </Sheet>
        </div>

        <aside className="bj__rules" aria-label="How it pays">
          <h2 className="bj__panel-title">How it pays</h2>
          <HowItPays pays={pays} />
        </aside>

        <aside className="bj__activity" aria-label="Activity">
          <h2 className="bj__panel-title">Activity</h2>
          {log}
        </aside>

        <Controls
          state={state}
          me={me}
          mine={mine}
          chips={chips}
          move={intent.move}
          left={left}
          turnLeft={turnLeft}
          isHost={isHost}
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
                    // Refused, so give the early decrement back.
                    account.refresh();
                  }
                });
              }}
            />
          }
          onStake={stake}
          onReady={(ready) => table.act({ type: "ready", ready })}
          onDeal={() => table.act({ type: "deal" })}
          onMove={move}
        />
      </div>

      {isHost ? (
        <TableSheet
          open={sheet === "table"}
          onClose={closeSheet}
          code={state.code}
          bettingMs={state.bettingMs}
          listed={table.listed}
          forFun={state.forFun}
          seated={state.seats.length}
          maxSeats={state.maxSeats}
          onWindow={(ms) => table.act({ type: "window", ms })}
          onListed={table.setListed}
          onBot={table.addBot}
        />
      ) : null}
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

/**
 * A table you have to be somebody to sit at.
 *
 * Reached by following a link to a table that plays for chips without an
 * account. The link is not broken and this is not a refusal — it is the one
 * step between them and the seat, with the seat still named so they can see
 * they are in the right place.
 */
function SignInToJoin({ code, onWatch }: { code: string; onWatch: () => void }) {
  // Back to this table once Discord is done, rather than the front door: the
  // whole point of following a link is arriving where it pointed.
  const back = `/auth/discord?to=${encodeURIComponent(`/blackjack/${code}`)}`;

  return (
    <div className="join join--gate">
      <section className="housing gate" aria-labelledby="gate-title">
        <div className="housing__head">
          <p className="label">Table {code}</p>
        </div>
        <div className="housing__body">
          <h2 className="gate__title" id="gate-title">
            This one plays for chips
          </h2>
          <p className="gate__note">
            Chips come from an account, so there is one step before you sit down. Sign in and you
            will land back at this table.
          </p>
          <a className="slab slab--wide slab--discord" href={back}>
            <DiscordIcon />
            <span>Sign in with Discord</span>
          </a>
          <button type="button" className="key key--wide" onClick={onWatch}>
            Just watch this one
          </button>
          <p className="panel__note">
            Or <Link to="/blackjack">open a table of your own</Link> — a for-fun one deals play
            money and anybody can sit down.
          </p>
        </div>
      </section>
    </div>
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
  /*
   * What the link they followed actually leads to.
   *
   * Asked before they touch anything, because a table playing for chips needs
   * an account and the useful thing to say then is "sign in", not a form for
   * opening a table of your own.
   */
  const peek = useTablePeek(invited);
  const waiting = peek.table;
  if (waiting !== null && !waiting.forFun && account.profile === null && !account.loading) {
    return <SignInToJoin code={waiting.code} onWatch={() => table.watch(waiting.code)} />;
  }

  return (
    <TableSetup
      game="blackjack"
      pitch="Beat the dealer to twenty-one without going past it. Blackjack pays three to two, the dealer stands on seventeen."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      playsFor={{
        fun: "Play money that lives at the table. Anybody can sit down.",
        guestWarning:
          "Playing for fun deals you five thousand chips that live at the table and nowhere else. Sign in to play for real ones.",
      }}
      note={() =>
        "You get a five-character code to share. Everybody plays the dealer rather than each other."
      }
      onCreate={(name, { forFun, maxSeats }) =>
        table.create(name, { game: "blackjack", forFun, maxSeats })
      }
    />
  );
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run apps/web/src/blackjack`
Expected: all PASS.

- [ ] **Step 6: Check nothing on the table still wears the old parts**

Run: `git grep -nE "btn--move|btn--ghost|bj__actions|\"bots|play__event|play__talk" -- apps/web/src/blackjack`
Expected: no output. (`panel__note` remains only inside `SignInToJoin`, which is a page, not the table.)

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck
npx biome lint apps/web/src/blackjack/Blackjack.tsx apps/web/src/blackjack/Blackjack.test.tsx apps/web/src/blackjack/Icons.tsx
git add apps/web/src/blackjack/Blackjack.tsx apps/web/src/blackjack/Blackjack.test.tsx apps/web/src/blackjack/Icons.tsx
git commit -m "feat(web): the blackjack table on one screen, with talk, activity and refusals

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Verification (performed by the controller, not a subagent)

A checklist. No push and no PR here; the controller takes those up with the user.

- [ ] `npm test` — all green, no skipped suites.
- [ ] `npm run typecheck` — no errors.
- [ ] `npm run lint` — no diagnostics.
- [ ] Run `npx vitest run apps/web/src/blackjack games/blackjack` three times back to back; any failure in one run of three is a flake and a bug to find, not to re-run past.
- [ ] Start the app (`npm run dev`), sign in, open a Blackjack table for chips with a second signed-in window seated, and a for-fun table with bots.
- [ ] At each size — **375×560, 375×667, 375×812, 768×1024, 1280×800** — in the browser's device toolbar:
  - [ ] `document.documentElement.scrollWidth === document.documentElement.clientWidth` in the console is `true`;
  - [ ] the lit slab (Ready while betting, Hit on your turn) is fully visible without scrolling the page;
  - [ ] the page itself does not scroll vertically at the table;
  - [ ] no system scrollbar with arrows appears anywhere (felt, talk sheet, Table sheet, activity panel).
- [ ] **375×560 with six seats** (for-fun table, host adds four bots), signed in: all six plates reachable by scrolling *inside the felt*; Hit still on screen; cards visibly smaller than at 375×812.
- [ ] **A split**: get a pair (a for-fun table and a few hands), press P. The seat grows two boxes, the live one lit and the other dimmed; Stand and Hit say "hand 1"/"hand 2"; Split says "once a seat"; the readout says "Hand 1 of 2" with that hand's stake; another window shows the split as two small hands on the compact plate.
- [ ] **Busy Hit on a slow line**: DevTools → Network → "Slow 3G". Press Hit: the slab goes down busy at once, a face-down card arrives on your hand, and it turns over in place when the answer lands — one arrival, not two. Press Space again while busy: nothing.
- [ ] **Keys**: Space readies while betting and hits on your turn; S, D, P stand, double, split; typing "s" in talk does nothing to the hand; click a chip then press Space → Ready (not another chip); Tab to a chip and press Space → the chip is added.
- [ ] **A refusal**: at last call, or by betting from a second window on the same account, get the table to say no. The card sits over the middle of the board with everything blurred behind it, it sounds once, and the same refusal twice shows and sounds twice.
- [ ] **Talk on a phone** (375×667): the talk key in the felt's top-left opens a sheet that stops below the readout; Activity is its second tab with the newest line at the bottom; Escape and the scrim close it; focus returns to the key.
- [ ] **Rules card**: `?` opens "How it pays" over the felt on a phone; at 1280×800 it is a panel in the side column and the `?` key is gone. Double lights on two cards; Split lights on a pair; after a hand the payout row that applied is lit.
- [ ] **Host Table key**: only the host sees it; Time to bet (15s/30s/60s) changes the next hand's window; Public/Private toggles; bots offered only at a for-fun table with a free seat.
- [ ] **Desk at 1280×800**: felt on the left with the dealer on top and seats along the bottom, yours wider; side column of readout, How it pays, Activity and controls; key letters shown on the keys.
- [ ] **Big moments**: a natural shows "Blackjack" once; a bust shows "Bust" once; neither loops.
- [ ] **Reduced motion** (DevTools → Rendering → `prefers-reduced-motion: reduce`): nothing animates; the turn seat is still lit, the busy slab still down, the banner and stamp still appear.
- [ ] **Greed, unchanged** (375×667 and a desk): its table looks as before, and its activity panel at a desk and activity tab on a phone now render as the shared log (grid of time and line, newest brightest) rather than as a flex column.
- [ ] **The floor**: the room's "On the floor" panel in the left rail looks as it did.

---

## Self-review

**Spec coverage (PR 2 section):**

| Spec item | Task |
|---|---|
| Floor `.activity` → `.floor-activity`, test that no other sheet declares `.activity`, Greed's log checked by hand | 1, 12 |
| Server `eventSeq`, bumped wherever `lastEvent` is set; test with "Ada is ready" twice | 2 |
| Page `play play--fit` at the table, scrolling page on setup and sign-in | 11 |
| `.bj` container `bj / inline-size`, three rows readout / felt `minmax(0, 1fr)` / controls | 10 (grid on `.bj__in`, see note) |
| Felt `bj-felt / size`, dealer patch on top, seats below; yours first and full size; others compact, two across; felt scrolls inside itself | 5, 10, 11 |
| Card clamps on containers only; `.bj-card` never declares `--bj-card-w` | 10 |
| Desk clamps; seats along the bottom, `1.5fr` vs `1fr` | 10 |
| 28% overlap; dealer does not overlap | 10 |
| Splits: one plate, a box per hand with stake, cards (42%), total, outcome; live lit, other dimmed; split card clamp; other's split as two small hands with a hairline; readout "Hand N of M" with that hand's stake; four-box stress layout | 4, 5, 10 |
| `.table-scroll` on everything that scrolls | 8 (sheet body), 11 (cloth; activity and talk already shared) |
| `@container bj (min-width: 760px)` side column: readout, rules, activity, controls | 10, 11 |
| Old `@media (max-width: 720px)` removed | 10 |
| Seats T1: turn lit neon, yours outlined `--gr-color-chip-dim`, waiting/dropped dimmed with state said; gold bet, chip pile, turn ring, paid glow, live split hand marked | 5, 10 |
| Readout T2: all five states, clock along the top edge via `--t` | 4, 10 |
| Rules card T3: `?` key and sheet on a phone, side column at a desk, six rows, lit rows | 8, 10, 11 |
| Big moments T5: banner once, stamp once, in reduced-motion block; T4 face-down card unchanged | 5 (arriving), 6, 10 |
| Controls K1/F1–F5: bottom row, secondary left, one slab right, 52px; betting (tray in `.well`, Take it back 52px icon key, host Deal now, Ready with clock, "Waiting… for the others", un-ready, disabled under minimum); your turn (Stand across two columns, Double/Split with cost or reason, "hand 2", Hit spanning both rows, `.is-busy`); others' turn (disabled slab with time, taunt key); settled ("Next hand in 5s", taunt); watching (the note) | 7, 10 |
| Chip tray: last-call lock, pile bump, balance beside the bet (readout) | 4, 5, 7 |
| Taunt picker `openClassName="key"`; every shortcut `aria-keyshortcuts` | 7, 11 |
| Keys K2–K4: window listener bound once, read through a ref; Space/S/D/P; K3 exclusions; Space leaves links and non-chip buttons; clicked vs tabbed chip, never `:focus-visible` | 9 |
| Host tools: Table key next to `?`, host only; sheet with `role="dialog"`, Escape/scrim close, focus returns; Time to bet Seg over `WINDOWS` with hint; Public/Private Seg; bots `.key--small` at for-fun with a free seat | 8, 11 |
| Talk C1–C5: `TalkKey` top-left of the felt, `TalkSheet` with activity tab, `Chat` not re-wrapped | 11 |
| Activity A1–A2: `useActivity({ code, text: lastEvent, seq: eventSeq })`; desk panel in the side column | 11 |
| `.play__event` and inline `.play__talk` gone | 11 |
| Refusals N1–N5: `Refusal` at the table, `.play__error` on pages; N6 chips refuse over the ceiling before the press, said on the chip | 3, 7, 11 |
| Stylesheet: no `.btn`, `.btn--move`, `.btn--ghost`, `.panel`, `.panel__note`, `.bots` on the table; `bj__` prefixes; every keyframe in the reduced-motion block; lit controls keep pseudo-elements in their corners (only fittings' `.slab` is lit, already fixed there) | 10, 11 |
| Tests: `blackjack.css.test.ts` (shell rules, size container and variables, `.bj-card` not declaring, reduced-motion coverage); key handler tests (Space readies and hits, S/D/P, every K3 exclusion, clicked vs tabbed chip with `:focus-visible` spied true); `Blackjack.test.tsx` (one slab per state, `Refusal` not `.play__error`, no `.play__event`, Table key host only); `games/blackjack` `eventSeq` | 2, 9, 10, 11 |
| By hand: L8 sizes incl. 375×560 with six seats signed in, throttled busy Hit, refusal with the felt blurred, talk on a phone | 12 |

**Decisions this plan makes where the spec left room:**

- `.bj` is the container; its grid is `.bj__in`, because a container cannot be restyled by a query on itself (Greed's `.gt` / `.gt__in`). The phone rows `auto minmax(0, 1fr) auto` sit on `.bj__in`.
- "Exactly one enabled `.slab` per state" is read as one `.slab` per state, lit (enabled) only while betting and on your turn; out (disabled) while somebody else acts and once the hand is over; none for somebody watching, whose controls are the note.
- Looks the mockups decide: the betting clock drains in gold for the whole window (the spec's "gold at last call"); waiting and dropped seats say their state visibly on a phone too (the spec's "screen-reader-only on a phone"), which still says it to a screen reader.
- Behaviour the spec decides: bot keys are absent, not disabled, at a table for chips (the mockup showed them disabled).
- `table.ts` has 12 `lastEvent` assignments, not 13; all go through `say()`, guarded by a grep in Task 2.
- `SETTLE_MS` is exported so the readout can drain the next-hand clock from the fraction left.
- The keys press the button on screen (found by `aria-keyshortcuts` under the table's ref), so "disabled or busy" is the button's own state rather than a second copy of the rules.
- Double and Split are also refused in place when the client can see the player cannot cover them ("not enough"), per N6; the server still decides.

**Placeholder scan:** no TBD/TODO; every code step has complete code; no "similar to Task N".

**Type and name consistency:** `SeatView`/`HandView` from `hands.ts` throughout; `readoutFor(ReadoutInput)` fields match the page's call (`state, seatId, mine, chips, move, left, turnLeft`); `ControlsProps` has no `seatId` and the page passes none; `Seats` props `state, seatId, stake, arriving`; `Sheet` `className` is `"bj__sheet--felt" | "bj__sheet--page"` in both uses; `PAYS_SHEET_ID` / `TABLE_SHEET_ID` match the keys' `aria-controls`; `TableSheetProps.seated` matches the page's `seated={state.seats.length}`; `useMoment`/`MOMENT_MS` match their test; CSS selectors asserted in `blackjack.css.test.ts` (`.bj`, `.bj__in`, `.bj__felt`, `.bj__seat--split`, `.bj__seats`, `.bj__seat .bj-hand .bj-card + .bj-card`, `.bj__box .bj-hand .bj-card + .bj-card`, `.bj__controls :is(.slab, .key)`, `.bj__cloth`) each appear as single-selector rules in the Task 10 sheet.

