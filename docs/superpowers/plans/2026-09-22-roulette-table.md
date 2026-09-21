# Roulette Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Roulette table up to `2026-09-16-table-requirements.md` — one screen on a phone, built from the fittings, with slots-style chip keys, a typed custom bet, and a chip that names its bet before it costs anything.

**Architecture:** The page becomes a `play--fit` window whose single flexing row is a *stage* that swaps by phase — the cloth holds it while betting and settling, the wheel takes it while the ball rolls. The cloth's tap handler becomes a full pointer gesture (press previews, lift places, hold takes back). The bespoke chip tray and three act buttons move onto `.key`, joined by a typed custom figure modelled on Slots. Talk, activity and refusals come from the shared `apps/web/src/table/` components that Blackjack and Plinko already use.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + @testing-library/react (jsdom), Biome. CSS is hand-formatted (Biome's CSS formatter is off).

**Spec:** `docs/superpowers/specs/2026-09-22-roulette-table-design.md`

## Global Constraints

Copied from the spec and `CLAUDE.md`. Every task's requirements implicitly include these.

- **The server is the only authority.** The client may *show* a cap; it never enforces one. Every figure the felt computes is a courtesy — `headroom()` is checked again server-side on the way in.
- **Never invent a fact.** A number the player chose shows at once; a fact only the server knows never does. In particular `state.pocket` is populated the moment betting closes so the wheel can roll to it — **nothing may reveal it while `phase === "spinning"`**.
- **`prefers-reduced-motion`:** every keyframe added gets an entry in the sheet's own reduced-motion block, and the page still says everything without it.
- **375px.** No element wider than the window. `document.documentElement.scrollWidth === clientWidth` at every L8 size.
- **Class prefix:** every new class is `rl__`-prefixed (page-level ones are `rl__in`, `rl__stage`). Grep before naming — `game.css` is global and this app bundles every table's CSS into one sheet.
- **Formatter:** `biome format --write <paths>` on files touched. **Never** `biome check --write` across the repo.
- **Stylesheet imports are checked:** grep for the filename before adding rules to a sheet.
- **Every bug fix gets a test watched failing first.**
- **Commands:** `npm test` (vitest run), `npm run typecheck`, `npm run lint` must all be clean.
- **Attribution:** commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

### Run a single test file

```bash
npx vitest run apps/web/src/roulette/Cloth.test.tsx
```

---

### Task 1: `eventSeq` on the roulette table

The activity log keys on a counter, so the same words twice running are two events. Blackjack has one; Roulette does not (§A4). `lastEvent` is also set in only two places today — too thin for a log — so it widens at the same time.

**Files:**
- Modify: `games/roulette/src/table.ts` (interface at :144, field at :221, sites at :539 and :592, view at :656, `join` at :275)
- Test: `games/roulette/src/table.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TableView.eventSeq: number`, consumed by Task 8's `useActivity`; `SeatView.signedIn: boolean`, consumed by Task 9's `TauntPicker`.

- [ ] **Step 1: Write the failing tests**

Append to `games/roulette/src/table.test.ts`:

```ts
describe("what the table says happened", () => {
  it("counts every line, so the same words twice are two events", () => {
    const table = new Table("AAAAA", () => 0, true);
    table.join("a", "Ada", null);
    const first = table.view("a").eventSeq;
    table.join("b", "Bo", null);
    const second = table.view("a").eventSeq;
    expect(second).toBeGreaterThan(first);
    expect(table.view("a").lastEvent).toContain("Bo");
  });

  it("says who left", () => {
    const table = new Table("AAAAA", () => 0, true);
    table.join("a", "Ada", null);
    table.join("b", "Bo", null);
    const before = table.view("a").eventSeq;
    table.leave("b");
    expect(table.view("a").lastEvent).toContain("Bo");
    expect(table.view("a").eventSeq).toBeGreaterThan(before);
  });

  it("never counts backwards across a spin", () => {
    const table = new Table("AAAAA", () => 0, true);
    table.join("a", "Ada", null);
    table.place("a", "even:1-3-5-7-9-11-13-15-17-19-21-23-25-27-29-31-33-35", 100);
    const seen: number[] = [table.view("a").eventSeq];
    table.closeBetting();
    seen.push(table.view("a").eventSeq);
    table.land();
    seen.push(table.view("a").eventSeq);
    table.beginBetting();
    seen.push(table.view("a").eventSeq);
    expect(seen).toEqual([...seen].sort((x, y) => x - y));
  });
});
```

> The spot id above is the "Odd" even-money bet. If `spotAt` rejects it, print the real ids with `[...SPOTS.keys()]` and use an even-money one — the assertion is about the counter, not the bet.

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run games/roulette/src/table.test.ts
```

Expected: FAIL — `eventSeq` is `undefined`, and joining says nothing.

- [ ] **Step 3: Add the counter and the one place that sets it**

In `games/roulette/src/table.ts`, add to `TableView` beside `lastEvent` (:144):

```ts
  lastEvent: string | null;
  /**
   * How many things the table has said. Only ever counts up.
   *
   * What tells the same words twice running apart from one broadcast sent
   * twice — the activity log keys on it (A4 in the table requirements).
   */
  eventSeq: number;
```

Add the field beside the existing one (:221):

```ts
  lastEvent: string | null = null;
  eventSeq = 0;
```

Add the single setter, next to the other private helpers:

```ts
  /**
   * Says what just happened.
   *
   * The only place lastEvent is set, so the counter cannot be forgotten at one
   * of the places the table talks. Copied in shape from Blackjack's, which
   * learned this the same way.
   */
  private say(text: string): void {
    this.lastEvent = text;
    this.eventSeq += 1;
  }
```

Replace both existing assignments with calls: `this.say("No more bets.")` at :539, and `this.say(`${this.pocket}`)` at :592 — **keep the wording exactly**, `Standing` and the History board read these.

Add the counter to the view object beside `lastEvent` (:656):

```ts
      lastEvent: this.lastEvent,
      eventSeq: this.eventSeq,
```

- [ ] **Step 4: Widen what the table says**

In `join` (:275), after the seat is made:

```ts
    this.say(`${seat.name} sat down.`);
```

In `leave`, where the seat is removed, capture the name *before* removing it and say `` `${name} left.` ``. Read the method first — it has a "still has chips riding" path; say it on both, since both are things that happened.

In `land` (:592), the pocket line is what the felt reads, so it stays exactly `` `${this.pocket}` ``. Add a second line **after** the payouts are worked out, in `beginBetting` or at the end of `land` — whichever already has `paid` in hand:

```ts
    const won = [...(this.paid?.entries() ?? [])].filter(([, one]) => one.back > one.staked);
    if (won.length > 0) {
      this.say(
        won
          .map(([seatId, one]) => {
            const name = this.seats.find((seat) => seat.id === seatId)?.name ?? "";
            return `${name} +${(one.back - one.staked).toLocaleString("en-US")}`;
          })
          .join(", "),
      );
    }
```

Do **not** put this inside `land()` before `this.say(`${this.pocket}`)` — the pocket must be the line the felt reads when it settles.

- [ ] **Step 5: Say which seats a taunt can reach**

`TauntPicker` needs to know who has an account, because chips cannot ride on a
guest or a bot. Roulette's `SeatView` has `isBot` but no `signedIn`; Blackjack's
has both (`games/blackjack/src/table.ts:96` and `:1087`). Add it the same way.

To `SeatView` (`games/roulette/src/table.ts:92`):

```ts
  isBot: boolean;
  /** Whether there is an account behind this seat, so a taunt's chips can reach it. */
  signedIn: boolean;
```

and wherever `view()` builds its `seats` array:

```ts
      signedIn: seat.userId !== null,
```

Read the surrounding mapping first — if the seat objects there do not carry
`userId`, take it from the same place `escrow.hold(userId, …)` does in `place`.

Add a test beside the others:

```ts
it("says which seats a taunt could reach", () => {
  const table = new Table("AAAAA", () => 0, true);
  table.join("a", "Ada", null);
  expect(table.view("a").seats[0]?.signedIn).toBe(false);
});
```

- [ ] **Step 6: Run the whole roulette package**

```bash
npx vitest run games/roulette
```

Expected: PASS, including the existing tests that assert on `lastEvent`. If one of them asserts `lastEvent === "No more bets."` right after a join, it is now correct for it to have moved on — update the test to assert what it means (the phase), not the incidental last line.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
npx biome format --write games/roulette/src/table.ts games/roulette/src/table.test.ts
git add games/roulette/src/table.ts games/roulette/src/table.test.ts
git commit -m "$(cat <<'EOF'
feat(roulette): a counter on what the table says, and more of it said

The activity log tells two identical lines apart by a counter, and Roulette
had none (A4). lastEvent also said only two things — "No more bets." and the
pocket — which is not an evening. Seats arriving and leaving and what a spin
paid now say so too, all through one setter so the counter cannot be
forgotten at one of them.

Seats also say whether there is an account behind them, which is what decides
whether a taunt's chips can reach one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `useTableKeys`, extracted from Blackjack

K3's exclusions and K4's clicked-versus-tabbed rule are subtle and already solved once. Extract rather than copy.

**Files:**
- Create: `apps/web/src/table/useTableKeys.ts`
- Create: `apps/web/src/table/useTableKeys.test.tsx`
- Modify: `apps/web/src/blackjack/useBlackjackKeys.ts` (becomes a thin call)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export function useTableKeys(
    root: RefObject<HTMLElement | null>,
    shortcuts: Readonly<Record<string, string>>,
    options?: { readonly handsOverSpace?: string },
  ): void;
  ```
  `shortcuts` maps a lowercased `event.key` to the `aria-keyshortcuts` name on the button. `handsOverSpace` is a CSS selector for pieces that hand Space to the table when clicked (Blackjack's `.bj__chip`); omitted, Space behaves like any other shortcut. Task 6 consumes it.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/table/useTableKeys.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTableKeys } from "./useTableKeys.js";

afterEach(cleanup);

function Harness({ onR, disabled = false }: { onR: () => void; disabled?: boolean }) {
  const root = useRef<HTMLElement | null>(null);
  useTableKeys(root, { r: "R" });
  return (
    <section ref={root}>
      <button type="button" aria-keyshortcuts="R" disabled={disabled} onClick={onR}>
        Same again
      </button>
      <input aria-label="say" />
    </section>
  );
}

describe("useTableKeys", () => {
  it("presses the button that declares the shortcut", () => {
    const onR = vi.fn();
    render(<Harness onR={onR} />);
    fireEvent.keyDown(window, { key: "r" });
    expect(onR).toHaveBeenCalledTimes(1);
  });

  it("does nothing while typing", () => {
    const onR = vi.fn();
    render(<Harness onR={onR} />);
    fireEvent.keyDown(screen.getByLabelText("say"), { key: "r" });
    expect(onR).not.toHaveBeenCalled();
  });

  it("does nothing with a modifier held, or on a repeat", () => {
    const onR = vi.fn();
    render(<Harness onR={onR} />);
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    fireEvent.keyDown(window, { key: "r", metaKey: true });
    fireEvent.keyDown(window, { key: "r", altKey: true });
    fireEvent.keyDown(window, { key: "r", repeat: true });
    expect(onR).not.toHaveBeenCalled();
  });

  it("does nothing for a button that could not be pressed", () => {
    const onR = vi.fn();
    render(<Harness onR={onR} disabled />);
    fireEvent.keyDown(window, { key: "r" });
    expect(onR).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run apps/web/src/table/useTableKeys.test.tsx
```

Expected: FAIL — cannot resolve `./useTableKeys.js`.

- [ ] **Step 3: Move the hook**

Create `apps/web/src/table/useTableKeys.ts` by copying the body of `apps/web/src/blackjack/useBlackjackKeys.ts` verbatim, then making three changes:

1. The signature becomes the one in **Interfaces** above; delete the module-level `SHORTCUTS` constant and read the `shortcuts` argument instead.
2. Replace the two hard-coded `".bj__chip"` strings with `options?.handsOverSpace`. Guard the Space branch so it only runs when a selector was given:

```ts
      const hands = options?.handsOverSpace;
      if (name === "Space" && target !== null && hands !== undefined) {
        const piece = target.closest(hands);
        if (piece !== null ? piece !== clicked : target.closest("a, button") !== null) {
          return;
        }
      }
```

and in `onPointer`:

```ts
    const onPointer = (event: Event) => {
      clicked =
        hands === undefined || !(event.target instanceof Element)
          ? null
          : event.target.closest(hands);
    };
```

Hoist `const hands = options?.handsOverSpace;` to the top of the effect so both closures see the same value, and add it to the effect's dependency array alongside `root` and `shortcuts`.

3. Keep every comment. They are the record of *why* this does not ask `:focus-visible`, and that reason does not belong to Blackjack.

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run apps/web/src/table/useTableKeys.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Make Blackjack's hook a thin call**

Replace the whole body of `apps/web/src/blackjack/useBlackjackKeys.ts` with:

```ts
import type { RefObject } from "react";
import { useTableKeys } from "../table/useTableKeys.js";

/** Which key presses which button, by the name the button declares in aria-keyshortcuts. */
const SHORTCUTS: Readonly<Record<string, string>> = { " ": "Space", s: "S", d: "D", p: "P" };

/**
 * Space for the lit slab; S, D and P for Stand, Double and Split.
 *
 * A chip somebody clicked hands Space to the table: stack chips, press Space,
 * is the rhythm of a bet. A chip reached by keyboard keeps its own Space,
 * since that is how a keyboard adds one at all.
 */
export function useBlackjackKeys(root: RefObject<HTMLElement | null>): void {
  useTableKeys(root, SHORTCUTS, { handsOverSpace: ".bj__chip" });
}
```

`SHORTCUTS` is a module constant, so its identity is stable and the effect will not re-run.

- [ ] **Step 6: Run Blackjack's own key tests**

```bash
npx vitest run apps/web/src/blackjack
```

Expected: PASS, unchanged. If a test imported internals of `useBlackjackKeys`, point it at `useTableKeys` instead.

- [ ] **Step 7: Commit**

```bash
npx biome format --write apps/web/src/table/useTableKeys.ts apps/web/src/table/useTableKeys.test.tsx apps/web/src/blackjack/useBlackjackKeys.ts
git add apps/web/src/table/useTableKeys.ts apps/web/src/table/useTableKeys.test.tsx apps/web/src/blackjack/useBlackjackKeys.ts
git commit -m "$(cat <<'EOF'
refactor(web): table shortcuts are one hook, not one per table

K3's exclusions and K4's clicked-versus-tabbed rule are subtle enough that a
second table copying them would get one of them wrong. Blackjack's hook keeps
its name and its shortcut map and hands the rest over.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `said.ts` — the one line under the keys

One `aria-live` line absorbs the felt's three separate messages (empty bank, the cap refusal, and why a key will not go on). Pure, so it can have a table of tests.

**Files:**
- Create: `apps/web/src/roulette/said.ts`
- Create: `apps/web/src/roulette/said.test.ts`

**Interfaces:**
- Consumes: `MIN_CHIP` from `@backroom/game-roulette`; `exact` from `../game/money.js`.
- Produces:
  ```ts
  export interface Reach {
    /** What the bank can still cover on the best spot on the cloth. */
    most: number;
    /** The balance, or the play purse. Null for somebody with no account. */
    purse: number | null;
    /** What the bank holds. */
    bank: number;
  }
  export function said(input: {
    reach: Reach;
    /** The chip currently held. */
    chip: number;
    /** A figure typed into the custom box, or null. */
    typed: number | null;
    /** Whether the typed figure is the one currently held. */
    holding: boolean;
    /** The table's own refusal of the last press, if there was one. */
    refused: string | null;
    betting: boolean;
  }): string;
  ```
  Task 5 consumes it.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/roulette/said.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { said } from "./said.js";

const base = {
  reach: { most: 10_000, purse: 50_000, bank: 2_000_000 },
  chip: 100,
  typed: null,
  holding: false,
  refused: null,
  betting: true,
};

describe("what the felt says under the keys", () => {
  it("says nothing when there is nothing to say", () => {
    expect(said(base)).toBe("");
  });

  it("says an empty bank before anybody presses anything", () => {
    const out = said({ ...base, reach: { most: 0, purse: 50_000, bank: 0 } });
    expect(out).toBe("The bank is empty — nothing to play for yet.");
  });

  it("an empty bank wins over a refusal, because it is the reason for it", () => {
    const out = said({
      ...base,
      reach: { most: 0, purse: 50_000, bank: 0 },
      refused: "The bank cannot cover a bet there yet.",
    });
    expect(out).toBe("The bank is empty — nothing to play for yet.");
  });

  it("passes the table's own refusal through", () => {
    const out = said({ ...base, refused: "The bank covers 400 on that at the moment." });
    expect(out).toBe("The bank covers 400 on that at the moment.");
  });

  it("says a typed figure is under the smallest chip", () => {
    expect(said({ ...base, typed: 10 })).toBe("Chips here start at 25.");
  });

  it("says a typed figure is over what the bank covers", () => {
    const out = said({ ...base, typed: 20_000 });
    expect(out).toBe("The bank covers 10,000 on the best spot at the moment.");
  });

  it("says a typed figure is over the purse", () => {
    const out = said({ ...base, reach: { most: 10_000, purse: 500, bank: 2_000_000 }, typed: 900 });
    expect(out).toBe("That is more than your 500.");
  });

  it("says nothing about a typed figure already held", () => {
    expect(said({ ...base, typed: 20_000, holding: true })).toBe("");
  });

  it("says nothing at all once the wheel is turning", () => {
    expect(said({ ...base, betting: false, typed: 10 })).toBe("");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run apps/web/src/roulette/said.test.ts
```

Expected: FAIL — cannot resolve `./said.js`.

- [ ] **Step 3: Write it**

Create `apps/web/src/roulette/said.ts`:

```ts
import { MIN_CHIP } from "@backroom/game-roulette";
import { exact } from "../game/money.js";

/**
 * The one line under the chip keys.
 *
 * Pure, and the felt's only source for it, because this is three messages that
 * used to live in three places and disagree about which one won: the empty
 * bank was said in the standing line, the cap refusal replaced it, and why a
 * key was dark was said nowhere at all.
 *
 * N6 in the table requirements: a limit the client can already see is said in
 * place, not left for the server to refuse. It stays a courtesy — the server
 * checks every figure again and is the only thing that can say no.
 */

export interface Reach {
  /** What the bank can still cover on the best spot on the cloth. */
  most: number;
  /** The balance, or the play purse. Null for somebody with no account. */
  purse: number | null;
  /** What the bank holds. */
  bank: number;
}

export function said({
  reach,
  typed,
  holding,
  refused,
  betting,
}: {
  reach: Reach;
  chip: number;
  typed: number | null;
  holding: boolean;
  refused: string | null;
  betting: boolean;
}): string {
  // The wheel is turning. Nothing here is actionable, and a line that stays up
  // through a spin reads as a complaint about the spin.
  if (!betting) {
    return "";
  }

  /*
   * An empty bank is a fact about the table, not a refusal of your press, and
   * it belongs on screen while you are still deciding rather than after you
   * have tried. It wins over a refusal because it is the reason for it.
   */
  if (reach.bank <= 0) {
    return "The bank is empty — nothing to play for yet.";
  }

  if (refused !== null) {
    return refused;
  }

  // A figure already on is not a figure to complain about, however it compares
  // now: the cap moves as other people bet, and a bet already down is down.
  if (typed !== null && !holding) {
    if (typed < MIN_CHIP) {
      return `Chips here start at ${exact(MIN_CHIP)}.`;
    }
    if (reach.purse !== null && typed > reach.purse) {
      return `That is more than your ${exact(reach.purse)}.`;
    }
    if (typed > reach.most) {
      return `The bank covers ${exact(reach.most)} on the best spot at the moment.`;
    }
  }

  return "";
}
```

- [ ] **Step 4: Run them and watch them pass**

```bash
npx vitest run apps/web/src/roulette/said.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx biome format --write apps/web/src/roulette/said.ts apps/web/src/roulette/said.test.ts
git add apps/web/src/roulette/said.ts apps/web/src/roulette/said.test.ts
git commit -m "$(cat <<'EOF'
feat(roulette): one line for every reason a chip will not go down

Three messages lived in three places and disagreed about which one won. One
pure function now decides, with the empty bank ahead of the refusal it causes,
and a table of tests for the order.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The cloth names the bet before it costs anything

Today the cloth previews the bet on **hover**, which on a phone is nothing at all. A press now previews, a lift places, and a hold takes back.

**Files:**
- Modify: `apps/web/src/roulette/Cloth.tsx`
- Modify: `apps/web/src/roulette/roulette.css` (`.rl__aim`, new `.rl__ghost`)
- Create: `apps/web/src/roulette/Cloth.test.tsx`

**Interfaces:**
- Consumes: `nearest`, `ANCHORS` from `./layout.js`; `spotAt`, `pays` from `@backroom/game-roulette`.
- Produces: `Cloth`'s props are **unchanged** — `onPlace(spotId)` and `onTake(spotId)` keep their signatures. Only when they fire changes. Task 7 relies on this.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/roulette/Cloth.test.tsx`. jsdom gives every element a zero-sized rect, so `getBoundingClientRect` is stubbed to make the cloth 700×250 in landscape and the arithmetic predictable:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cloth } from "./Cloth.js";
import { HEIGHT, WIDTH } from "./layout.js";

afterEach(cleanup);

const W = 700;
const H = 250;

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The middle of a square, in client pixels, for the landscape cloth. */
const at = (x: number, y: number) => ({ clientX: (x / WIDTH) * W, clientY: (y / HEIGHT) * H });

/** Straight up on 1 — column 1, bottom row. Its centre is (1.5, 2.5). */
const ONE = at(1.5, 2.5);
/** Straight up on 2 — same column, middle row. Its centre is (1.5, 1.5). */
const TWO = at(1.5, 1.5);

function draw(props: Partial<Parameters<typeof Cloth>[0]> = {}) {
  return render(
    <Cloth placed={[]} mine="you" portrait={false} {...props} />,
  );
}

describe("placing a chip", () => {
  it("names the bet on the press without placing it", () => {
    const onPlace = vi.fn();
    draw({ onPlace });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onPlace).not.toHaveBeenCalled();
    expect(cloth.textContent).toContain("1");
    expect(cloth.textContent).toContain("35");
  });

  it("places on the lift", () => {
    const onPlace = vi.fn();
    draw({ onPlace });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    fireEvent.pointerUp(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onPlace).toHaveBeenCalledWith("straight:1");
  });

  it("follows a slide, and places where the finger ended", () => {
    const onPlace = vi.fn();
    draw({ onPlace });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    fireEvent.pointerMove(cloth, { ...TWO, pointerId: 1 });
    fireEvent.pointerUp(cloth, { ...TWO, button: 0, pointerId: 1 });
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith("straight:2");
  });

  it("takes back instead when the press is held", () => {
    const onPlace = vi.fn();
    const onTake = vi.fn();
    draw({ onPlace, onTake });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    vi.advanceTimersByTime(600);
    expect(cloth.textContent).toContain("Release to take it back");
    fireEvent.pointerUp(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onTake).toHaveBeenCalledWith("straight:1");
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("does nothing when the press is cancelled", () => {
    const onPlace = vi.fn();
    const onTake = vi.fn();
    draw({ onPlace, onTake });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    fireEvent.pointerCancel(cloth, { ...ONE, pointerId: 1 });
    expect(onPlace).not.toHaveBeenCalled();
    expect(onTake).not.toHaveBeenCalled();
  });

  it("does nothing at all when the cloth is shut", () => {
    const onPlace = vi.fn();
    draw({ onPlace, disabled: true });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    fireEvent.pointerUp(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("never places on its way to taking off with the right button", () => {
    const onPlace = vi.fn();
    const onTake = vi.fn();
    draw({ onPlace, onTake });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 2, pointerId: 1 });
    fireEvent.pointerUp(cloth, { ...ONE, button: 2, pointerId: 1 });
    fireEvent.contextMenu(cloth, ONE);
    expect(onPlace).not.toHaveBeenCalled();
    expect(onTake).toHaveBeenCalledWith("straight:1");
  });
});
```

> Verify the straight-up spot id format before running: `node -e "import('./games/roulette/dist/index.js').then(m=>console.log([...m.SPOTS.keys()].slice(0,3)))"`, or read `spot()` in `games/roulette/src/spots.ts` — it builds `` `${kind}:${sorted.join("-")}` ``, so straight up on 1 is `straight:1`. Fix the expected ids if they differ.

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run apps/web/src/roulette/Cloth.test.tsx
```

Expected: FAIL — the current cloth places on `pointerDown`, so "names the bet on the press without placing it" and the slide test both fail.

- [ ] **Step 3: Replace the handlers**

In `apps/web/src/roulette/Cloth.tsx`, add above the component:

```ts
/**
 * How long a press has to be held before it means "take this back".
 *
 * Long enough not to catch a firm tap, short enough that somebody who meant it
 * is not left wondering. The same threshold a browser uses to raise its own
 * context menu on touch, which is the gesture this replaces.
 */
export const HOLD_MS = 500;
```

Replace the `aiming` state and the `onPointerDown` / `onPointerMove` / `onPointerLeave` handlers with a single press record. Keep `spotUnder`, `placeAt`, `spanAt` and everything below them untouched.

```tsx
  /*
   * The press in progress: what it is aimed at, and whether it has been held
   * long enough to mean a take-back.
   *
   * One object rather than three states, because they change together and a
   * render that had the new spot and the old "held" would name one bet and
   * take back another.
   */
  const [press, setPress] = useState<{ spotId: string | null; held: boolean } | null>(null);
  /* Hover, which is a desk's way of asking the same question and costs nothing. */
  const [hovered, setHovered] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endPress = () => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setPress(null);
  };

  useEffect(() => () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
  }, []);
```

The JSX handlers become:

```tsx
      onPointerDown={(event) => {
        /*
         * Only the primary button aims. A right-click is on its way to a
         * context menu, and without this it puts a chip down on the way to
         * taking one off — the pile never shrinks.
         */
        if (disabled || event.button !== 0) {
          return;
        }
        // Capture, so a finger that slides off an element inside the cloth
        // keeps reporting to the cloth. The opposite of Plinko's drop key,
        // which refuses capture because sliding off is its escape — here
        // sliding is how you aim, and lifting outside is the escape.
        event.currentTarget.setPointerCapture(event.pointerId);
        setPress({ spotId: spotUnder(event), held: false });
        holdTimer.current = setTimeout(() => {
          setPress((was) => (was === null ? null : { ...was, held: true }));
        }, HOLD_MS);
      }}
      onPointerMove={(event) => {
        if (press === null) {
          setHovered(spotUnder(event));
          return;
        }
        const spot = spotUnder(event);
        setPress((was) => (was === null || was.spotId === spot ? was : { ...was, spotId: spot }));
      }}
      onPointerUp={(event) => {
        if (press === null) {
          return;
        }
        const { spotId, held } = press;
        endPress();
        // Lifted off the cloth entirely: the way out of a press you did not mean.
        if (spotId === null || spotUnder(event) === null) {
          return;
        }
        if (held) {
          onTake?.(spotId);
        } else {
          onPlace?.(spotId);
        }
      }}
      onPointerCancel={endPress}
      onPointerLeave={() => setHovered(null)}
```

Leave `onContextMenu` exactly as it is — a desk's right-click still takes back, and on touch the browser raises it after the same hold, which `endPress` has already dealt with.

Replace the `aimed` line and the aim block with one that serves both a press and a hover:

```tsx
  const showing = press?.spotId ?? hovered;
  const aimed = showing === null ? null : spotAt(showing);
  const taking = press?.held === true;
```

```tsx
      {aimed === null || disabled ? null : (
        <div
          className={`rl__aim${taking ? " rl__aim--taking" : ""}`}
          style={placeAt(...aimAt(aimed.id))}
        >
          <span className="rl__aim-name">
            {taking ? "Release to take it back" : `${aimed.label}, pays ${pays(aimed)} to 1`}
          </span>
        </div>
      )}
```

Add a ghost chip under the aim while a press is live, so the bet has a place as well as a name:

```tsx
      {press?.spotId == null || disabled ? null : (
        <div className="rl__ghost" style={placeAt(...aimAt(press.spotId))} aria-hidden="true" />
      )}
```

Add `useRef` and `useEffect` to the React import. `pays` is already imported.

- [ ] **Step 4: Dress the ghost, and stop the browser fighting the gesture**

In `apps/web/src/roulette/roulette.css`, beside `.rl__aim`:

```css
/*
 * Where the chip would land. Under the name, not instead of it: the name says
 * what the bet is and this says where it goes, and a press wants both.
 */
.rl__ghost {
  position: absolute;
  width: 22px;
  height: 22px;
  margin: -11px 0 0 -11px;
  border-radius: 50%;
  border: 2px dashed var(--gr-color-chip-dim);
  background: rgb(0 0 0 / 0.25);
  pointer-events: none;
}

.rl__aim--taking .rl__aim-name {
  color: var(--gr-color-bad);
}
```

Change `.rl__cloth`'s `touch-action: manipulation` to `touch-action: none`. A press that aims is a press the browser must not read as a scroll or a double-tap zoom; the cloth scrolls in its own box on a phone (Task 7), and that box is the scroller, not the cloth.

- [ ] **Step 5: Run them and watch them pass**

```bash
npx vitest run apps/web/src/roulette/Cloth.test.tsx
```

Expected: PASS. jsdom has no `setPointerCapture` on elements by default — if it throws, guard it: `event.currentTarget.setPointerCapture?.(event.pointerId)`.

- [ ] **Step 6: Run the whole roulette folder and commit**

```bash
npx vitest run apps/web/src/roulette
npm run typecheck
npx biome format --write apps/web/src/roulette/Cloth.tsx apps/web/src/roulette/Cloth.test.tsx
git add apps/web/src/roulette/Cloth.tsx apps/web/src/roulette/Cloth.test.tsx apps/web/src/roulette/roulette.css
git commit -m "$(cat <<'EOF'
feat(roulette): a chip says what it is before it costs anything

The cloth named the bet on hover, which on a phone is nothing at all — you
tapped a 25px square and found out what you had bought afterwards. A press now
names it and parks a ghost, a slide re-aims, a lift places, and a hold past
500ms turns it into a take-back. A desk is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The controls — chip keys, a custom bet, and three acts

The bespoke `.rl__chip` tray and `.rl__act` buttons move onto the fittings, and a typed figure joins them. Created as its own file and wired in at the same time, so the tree is never carrying two Controls.

**Files:**
- Create: `apps/web/src/roulette/Controls.tsx`
- Create: `apps/web/src/roulette/Controls.test.tsx`
- Modify: `apps/web/src/roulette/Roulette.tsx` (delete the inline `Controls`, import the new one, pass `reach` and `refused`)
- Modify: `apps/web/src/roulette/roulette.css` (`.rl__chip` / `.rl__act` rules → `.key` variants; add `.rl__own`)

**Interfaces:**
- Consumes: `said`, `Reach` from `./said.js` (Task 3); `CHIPS`, `MIN_CHIP` from `@backroom/game-roulette`; `Chip` from `../chips/Chip.js`; `exact` from `../game/money.js`.
- Produces:
  ```ts
  export function Controls(props: {
    chip: number;
    onChip: (value: number) => void;
    reach: Reach;
    refused: string | null;
    open: boolean;       // betting, and not last call
    betting: boolean;
    down: number;        // this seat's chips on the cloth
    canRepeat: boolean;
    busy: boolean;
    onRepeat: () => void;
    onUndo: () => void;
    onClear: () => void;
    taunt?: ReactNode;
  }): JSX.Element;
  export function readChip(typed: string): number | null;
  ```
  Task 7 renders it; Task 9 passes `taunt`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/roulette/Controls.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Controls, readChip } from "./Controls.js";

afterEach(cleanup);

const base = {
  reach: { most: 10_000, purse: 50_000, bank: 2_000_000 },
  refused: null,
  open: true,
  betting: true,
  down: 0,
  canRepeat: true,
  busy: false,
  onRepeat: () => {},
  onUndo: () => {},
  onClear: () => {},
};

function Harness(over: Partial<Parameters<typeof Controls>[0]> = {}) {
  const [chip, setChip] = useState(100);
  return <Controls {...base} chip={chip} onChip={setChip} {...over} />;
}

describe("readChip", () => {
  it("takes a figure with commas and rejects everything else", () => {
    expect(readChip("1,250")).toBe(1250);
    expect(readChip("")).toBe(null);
    expect(readChip("abc")).toBe(null);
  });
});

describe("the chip keys", () => {
  it("is one named group with exactly one chip held", () => {
    render(<Harness />);
    const held = screen
      .getAllByRole("radio")
      .filter((b) => b.getAttribute("aria-checked") === "true");
    expect(held).toHaveLength(1);
  });

  it("moves the hold to the chip pressed", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Bet with 500" }));
    expect(screen.getByRole("radio", { name: "Bet with 500" }).getAttribute("aria-checked")).toBe("true");
  });

  it("darkens a chip the purse cannot cover, but never the one held", () => {
    render(<Harness reach={{ most: 10_000, purse: 300, bank: 2_000_000 }} />);
    expect(screen.getByRole("radio", { name: "Bet with 5,000" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Bet with 100" })).not.toBeDisabled();
  });
});

describe("the custom bet", () => {
  it("does not bet on a keystroke — typing 1000 goes through 1 and 10", () => {
    const onChip = vi.fn();
    render(<Harness onChip={onChip} />);
    fireEvent.change(screen.getByLabelText("Custom chip"), { target: { value: "1000" } });
    expect(onChip).not.toHaveBeenCalled();
  });

  it("puts the typed figure on when it is committed", () => {
    render(<Harness />);
    const box = screen.getByLabelText("Custom chip");
    fireEvent.change(box, { target: { value: "1250" } });
    fireEvent.click(screen.getByRole("button", { name: "Bet it" }));
    expect(screen.getByRole("button", { name: "Held" })).toBeDefined();
  });

  it("commits on Enter too", () => {
    render(<Harness />);
    const box = screen.getByLabelText("Custom chip");
    fireEvent.change(box, { target: { value: "1250" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Held" })).toBeDefined();
  });

  it("will not commit a figure under the smallest chip", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Custom chip"), { target: { value: "10" } });
    expect(screen.getByRole("button", { name: "Bet it" })).toBeDisabled();
    expect(screen.getByRole("status").textContent).toContain("start at 25");
  });

  it("formats on blur", () => {
    render(<Harness />);
    const box = screen.getByLabelText("Custom chip") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "1250" } });
    fireEvent.blur(box);
    expect(box.value).toBe("1,250");
  });
});

describe("the three acts", () => {
  it("are three keys of equal weight, and none of them is a slab", () => {
    const { container } = render(<Harness />);
    expect(container.querySelector(".slab")).toBe(null);
    for (const name of ["Put last round's chips down again", "Undo the last chip you put down", "Take back everything you have on the cloth"]) {
      expect(screen.getByRole("button", { name }).classList.contains("key")).toBe(true);
    }
  });

  it("offers nothing to undo or clear with an empty cloth", () => {
    render(<Harness down={0} />);
    expect(screen.getByRole("button", { name: "Undo the last chip you put down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Take back everything you have on the cloth" })).toBeDisabled();
  });

  it("declares its shortcuts on the buttons themselves", () => {
    render(<Harness down={500} />);
    expect(screen.getByRole("button", { name: "Put last round's chips down again" }).getAttribute("aria-keyshortcuts")).toBe("R");
    expect(screen.getByRole("button", { name: "Undo the last chip you put down" }).getAttribute("aria-keyshortcuts")).toBe("U");
    expect(screen.getByRole("button", { name: "Take back everything you have on the cloth" }).getAttribute("aria-keyshortcuts")).toBe("C");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run apps/web/src/roulette/Controls.test.tsx
```

Expected: FAIL — cannot resolve `./Controls.js`.

- [ ] **Step 3: Write the component**

Create `apps/web/src/roulette/Controls.tsx`:

```tsx
import { CHIPS, MIN_CHIP } from "@backroom/game-roulette";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { Chip } from "../chips/Chip.js";
import { exact } from "../game/money.js";
import type { Reach } from "./said.js";
import { said } from "./said.js";

/** A typed figure, read the way the felt writes one: commas welcome and ignored. */
export function readChip(typed: string): number | null {
  const digits = typed.replace(/[^\d]/g, "");
  return digits === "" ? null : Number(digits);
}

/** Whether a figure can go on at all: big enough, and inside the purse and the bank. */
function covers(chip: number, reach: Reach): boolean {
  return (
    chip >= MIN_CHIP && chip <= reach.most && (reach.purse === null || chip <= reach.purse)
  );
}

/**
 * What you are betting with, and what you can do about what you have already
 * bet.
 *
 * Three acts of equal weight and no lit slab, deliberately. The only one-press
 * action here spends money — "same again" puts a whole round back down — and
 * lighting it the way a primary action is usually lit would be the felt
 * leaning on the player. K1, K2 and F2 are not met, and this is why.
 */
export function Controls({
  chip,
  onChip,
  reach,
  refused,
  open,
  betting,
  down,
  canRepeat,
  busy,
  onRepeat,
  onUndo,
  onClear,
  taunt,
}: {
  chip: number;
  onChip: (value: number) => void;
  reach: Reach;
  refused: string | null;
  open: boolean;
  betting: boolean;
  down: number;
  canRepeat: boolean;
  busy: boolean;
  onRepeat: () => void;
  onUndo: () => void;
  onClear: () => void;
  taunt?: ReactNode;
}) {
  const id = useId();
  /* Half a number is nobody's business but this box's. */
  const [draft, setDraft] = useState(() =>
    CHIPS.includes(chip as (typeof CHIPS)[number]) ? "" : exact(chip),
  );
  const typed = readChip(draft);
  /* The chip held is a figure of the player's own, which no key here is. */
  const ownHeld = !CHIPS.includes(chip as (typeof CHIPS)[number]);
  /* And it is the figure in the box, rather than one typed over it since. */
  const holding = ownHeld && typed === chip;

  const betOwn = () => {
    if (busy || typed === null || !covers(typed, reach)) {
      return;
    }
    setDraft(exact(typed));
    onChip(typed);
  };

  return (
    <div className="rl__controls">
      <div className="rl__tray" role="radiogroup" aria-label="What to bet with">
        {CHIPS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={chip === value}
            aria-label={`Bet with ${exact(value)}`}
            className={`key rl__chip${chip === value ? " rl__chip--picked" : ""}`}
            /* The chip held never goes dark: it is already on, and a cap that
               moved under it is not the same as being unable to cover it. */
            disabled={chip !== value && reach.purse !== null && value > reach.purse}
            onClick={() => onChip(value)}
          >
            <Chip amount={value} />
          </button>
        ))}
      </div>

      <div className="rl__own" data-held={ownHeld || undefined}>
        <label className="rl__own-label" htmlFor={`${id}-own`}>
          Custom chip
        </label>
        <input
          id={`${id}-own`}
          type="text"
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="off"
          aria-label="Custom chip"
          placeholder={reach.most >= MIN_CHIP ? `${exact(MIN_CHIP)} – ${exact(reach.most)}` : "Nothing covered"}
          value={draft}
          disabled={busy || !betting}
          onChange={(event) => setDraft(event.target.value.replace(/[^\d,]/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              betOwn();
            }
          }}
          onBlur={() => setDraft(typed === null ? "" : exact(typed))}
        />
        {/* Latches like a key, because it is one: the box holds a figure, and
            this is what puts it on. Nothing is bet on a keystroke — typing a
            thousand goes through a one and a ten on the way. */}
        <button
          type="button"
          className="key rl__own-set"
          aria-pressed={holding}
          disabled={!holding && (busy || typed === null || !covers(typed, reach))}
          onClick={holding ? undefined : betOwn}
        >
          {holding ? "Held" : "Bet it"}
        </button>
      </div>

      <div className="rl__acts">
        <button
          type="button"
          className="key rl__act"
          /* Written out, not left to how the two spans happen to sit: a name
             and a note with nothing between them read as one run-on word. */
          aria-label="Put last round's chips down again"
          aria-keyshortcuts="R"
          disabled={!open || !canRepeat || busy}
          onClick={onRepeat}
        >
          <span className="rl__act-name">Same again</span>
          <span className="rl__act-note">Last round's chips</span>
        </button>
        <button
          type="button"
          className="key rl__act"
          aria-label="Undo the last chip you put down"
          aria-keyshortcuts="U"
          disabled={!open || down === 0 || busy}
          onClick={onUndo}
        >
          <span className="rl__act-name">Undo</span>
          <span className="rl__act-note">The last chip down</span>
        </button>
        <button
          type="button"
          className="key rl__act"
          aria-label="Take back everything you have on the cloth"
          aria-keyshortcuts="C"
          disabled={!open || down === 0 || busy}
          onClick={onClear}
        >
          <span className="rl__act-name">Clear</span>
          <span className="rl__act-note">Everything you have on</span>
        </button>
        {taunt}
      </div>

      <p className="rl__said" role="status">
        {said({ reach, chip, typed, holding, refused, betting })}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run them and watch them pass**

```bash
npx vitest run apps/web/src/roulette/Controls.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Wire it in and delete the old one**

In `apps/web/src/roulette/Roulette.tsx`:

1. Delete the inline `function Controls({ table, state, chip, onChip })` entirely, and the now-unused `Chip` import.
2. Import the new one: `import { Controls } from "./Controls.js";`
3. In `Felt`, compute what the new props need. `room(spotId)` already exists; the best spot on the cloth is the largest headroom over every anchor:

```tsx
  /*
   * The best the bank can do anywhere on the cloth, which is what the custom
   * box's range is quoted against. Shown, never enforced — the server checks
   * the actual spot again on the way in, and that is the only number that can
   * refuse anything.
   */
  const reach = useMemo(
    () => ({
      most: ANCHORS.reduce((best, one) => Math.max(best, room(one.spotId)), 0),
      purse: mine?.purse ?? null,
      bank: state.bank,
    }),
    [room, mine, state.bank],
  );
```

Import `ANCHORS` from `./layout.js`. `mine` is already `state.you`.

4. Replace the `<Controls …/>` call site:

```tsx
        <Controls
          chip={chip}
          onChip={setChip}
          reach={reach}
          refused={refused}
          open={canBet}
          betting={state.phase === "betting"}
          down={mine?.staked ?? 0}
          canRepeat={state.canRepeat}
          busy={table.busy}
          onRepeat={() => table.act({ type: "repeat" })}
          onUndo={() => table.act({ type: "undo" })}
          onClear={() => table.act({ type: "clear" })}
        />
```

5. `Standing` no longer says the empty-bank or refused lines — `said` does. Cut both branches from `Standing` and drop its `refused` prop, leaving it to say only the phase and the clock. Keep `refused` state in `Felt`; it now feeds `Controls`.

6. Play the cue when a chip lands. In `place()`, after the cap check passes and before `table.act`:

```tsx
    play("bet");
```

Import `play` from `../game/audio.js`. Section 13: *"A cue when a chip is placed (it is silent today)."*

- [ ] **Step 6: Restyle the keys**

In `roulette.css`, the `.rl__chip` and `.rl__act` rules now sit on top of `.key` from the fittings, so they keep only what is theirs. Delete every declaration that `.key` already provides — background, border, radius, padding, font, the hover and disabled states. Keep `.rl__chip svg` sizing and `.rl__chip--picked`'s lit ring; keep `.rl__act`'s two-line stack. Add:

```css
/* The box for a figure of your own, beside the keys it is an alternative to. */
.rl__own {
  display: flex;
  align-items: center;
  gap: var(--gr-space-2);
  flex-wrap: wrap;
  justify-content: center;
}

.rl__own-label {
  font-size: var(--gr-text-xs);
  color: var(--gr-color-ink-dim);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.rl__own input {
  width: 9ch;
  min-height: 44px;
  padding: 0 var(--gr-space-2);
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--gr-color-chip);
  background: var(--gr-color-well);
  border: 1px solid var(--gr-color-edge);
  border-radius: var(--gr-radius-sm);
}

/* One line, always present, so nothing below it moves when it fills. */
.rl__said {
  min-height: 1.4em;
  margin: 0;
  text-align: center;
  font-size: var(--gr-text-sm);
  color: var(--gr-color-ink-dim);
}
```

Check the token names against `packages/ui` before committing — if `--gr-color-well`, `--gr-color-edge` or `--gr-text-xs` do not exist, use whatever `.readout` and `.key` use in `fittings.css`. Rename `.rl__note` to `.rl__said` throughout, or keep `.rl__note` for the "on the cloth / in play money left" figures and let `.rl__said` be the new line — the tests above expect exactly one `role="status"` in the controls, so make sure only one of them has it.

- [ ] **Step 7: Run everything and commit**

```bash
npx vitest run apps/web/src/roulette
npm run typecheck
npx biome format --write apps/web/src/roulette/Controls.tsx apps/web/src/roulette/Controls.test.tsx apps/web/src/roulette/Roulette.tsx
git add apps/web/src/roulette/
git commit -m "$(cat <<'EOF'
feat(roulette): chip keys from the fittings, and a figure of your own

The tray was seven bespoke buttons and the only figures you could bet with.
They are .key now, joined by a typed custom chip — which the server has always
accepted, since check() takes any integer above the smallest chip and the
denominations were only ever a convenience.

The three reasons a chip will not go down are one line under the keys, and a
chip landing finally makes a sound.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: One screen — the shell, the stage, and the swap

The page becomes the window, and its single flexing row is given to whichever of the cloth and the wheel matters in the current phase.

**Files:**
- Modify: `apps/web/src/roulette/Roulette.tsx` (the `<main>` class, `Felt`'s markup, the stage swap)
- Modify: `apps/web/src/roulette/roulette.css` (shell, grid, stage, medallion, swap keyframes, reduced motion)
- Create: `apps/web/src/roulette/roulette.css.test.ts`
- Modify: `apps/web/src/roulette/Roulette.test.tsx`

**Interfaces:**
- Consumes: `Controls` (Task 5), the unchanged `Cloth` props (Task 4), `useTableKeys` (Task 2).
- Produces: the `.rl__corner` column, which Tasks 7 and 8 hang the `?` and talk keys in.

- [ ] **Step 1: Write the failing stylesheet test**

Create `apps/web/src/roulette/roulette.css.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The one-screen rules, read off the files. There is no cascade in a test
 * runner to ask, and these are questions about what is written.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "roulette.css"), "utf8");
const page = readFileSync(join(here, "Roulette.tsx"), "utf8");

describe("the Roulette table's stylesheet", () => {
  it("is actually loaded — an orphan sheet is silently dead", () => {
    expect(page).toContain('import "./roulette.css"');
  });

  it("is a fit page, so the shell is the window (L1)", () => {
    expect(page).toContain("play--fit");
  });

  it("flexes exactly one row, and it is the stage (L2)", () => {
    const grid = /\.rl__in\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(grid).toContain("grid-template-rows");
    expect(grid.match(/minmax\(0,\s*1fr\)/g) ?? []).toHaveLength(1);
  });

  it("sizes the stage from the space it has, not from the viewport (L3)", () => {
    const stage = /\.rl__stage\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(stage).toMatch(/container:\s*rl-stage\s*\/\s*size/);
  });

  it("arranges the desk with a container query, not a media query (L5)", () => {
    expect(css).toContain("@container rl (min-width:");
  });

  it("turns off every keyframe it adds (M1)", () => {
    const declared = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    const off = css.slice(css.indexOf("prefers-reduced-motion"));
    for (const name of declared) {
      expect(off, `${name} has no off switch`).toContain(name.replace("rl-", ""));
    }
  });
});
```

> The last test is loose on purpose — it checks each keyframe's name appears somewhere in the reduced-motion region. If that proves too weak once the sheet is written, tighten it to assert the *selector* that uses each keyframe appears in the `prefers-reduced-motion` block.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run apps/web/src/roulette/roulette.css.test.ts
```

Expected: FAIL — no `play--fit`, no `.rl__in`, no `.rl__stage`.

- [ ] **Step 3: Make the page the window**

In `Roulette.tsx`, replace the `<main>` and its comment:

```tsx
  // The felt is the window; setup and join are pages and scroll like them.
  const atTable = table.taken === null && state !== null;

  return (
    <main className={`play${atTable ? " play--fit" : ""}`}>
```

Delete the `play--wheel` class and its `.play.play--wheel { max-width: … }` rule — `play--fit` in `table.css` owns the page's width now. Add `import "../table/table.css";` to `Roulette.tsx` if it is not already pulled in transitively; the css test asserts `play--fit` is in the page, and `table.css` is what defines it.

- [ ] **Step 4: Build the grid and the stage**

In `Felt`, replace the `<section className="rl">` body's top level:

```tsx
  /*
   * Which of the two gets the stage.
   *
   * The cloth is shut while the ball is rolling and the wheel is decoration
   * while it is not, so a phone gives the stage to whichever is the one that
   * matters. It comes back to the cloth at "settled", not at the next window:
   * settling is when the cloth is worth looking at, with the winning square
   * lit and the payouts landing on the seats.
   */
  const onStage = turning ? "wheel" : "cloth";

  return (
    <section className="rl" data-game="roulette" ref={root}>
      <div className="rl__in">
        <Standing state={state} />

        <div className="rl__stage" data-on={onStage}>
          <div className="rl__cloth-holds table-scroll">
            <Cloth
              placed={state.placed}
              mine={seatId}
              landed={landed}
              disabled={!canBet}
              onPlace={place}
              onTake={(spotId) => {
                if (canBet) {
                  table.act({ type: "take", spotId, chips: chip });
                }
              }}
            />
          </div>
          <div className="rl__wheel-holds">
            <Wheel pocket={state.pocket} spinning={turning} spinMs={SPIN_MS} covered={covered} />
            {/*
              What the medallion says instead of drawing 37 pockets nobody can
              see at this size. Never the result: the view carries the pocket
              all through the spin so the wheel can roll to it, and a caption
              that mentioned it would give the answer away seconds early.
            */}
            <span className="rl__covered">
              {landed === null ? `${covered.size} of 37 covered` : `${landed}`}
            </span>
          </div>
          <div className="rl__corner">{/* talk and ? keys land here in Tasks 7 and 8 */}</div>
        </div>

        {mine === null ? (
          /*
           * A watcher, and no button. There is no "sit down" action on the
           * wire — a seat is taken on the way in — so offering a control that
           * cannot do anything would be worse than saying what you are.
           */
          <p className="rl__watching">{state.watching} watching. Take a seat to play.</p>
        ) : (
          <Controls
            chip={chip}
            onChip={setChip}
            reach={reach}
            refused={refused}
            open={canBet}
            betting={state.phase === "betting"}
            down={mine.staked}
            canRepeat={state.canRepeat}
            busy={table.busy}
            onRepeat={() => table.act({ type: "repeat" })}
            onUndo={() => table.act({ type: "undo" })}
            onClear={() => table.act({ type: "clear" })}
          />
        )}

        <Seats state={state} seatId={seatId} />
      </div>

      <div className="rl__boards">
        <History pockets={state.history} />
        <Winners winners={state.winners} />
      </div>
    </section>
  );
```

Add `const root = useRef<HTMLElement | null>(null);` and `useTableKeys(root, { r: "R", u: "U", c: "C" });` — declare `SHORTCUTS` as a module constant above `Felt` so the effect does not re-run each render.

The `.rl__boards` block is placed *outside* `.rl__in` for now; Task 8 moves History into the grid and Winners into the activity tab. Leaving it here keeps the tree working between the two commits.

- [ ] **Step 5: Write the stylesheet**

In `roulette.css`, replace the layout section (from `/* --- the controls */` header's neighbours through the end-of-file `.rl__table` / `.rl__wheel-holds` block) with:

```css
.rl {
  container: rl / inline-size;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/*
 * The table's four rows. Exactly one of them flexes (L2) — the stage — and
 * everything else takes the height it needs.
 */
.rl__in {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  grid-template-areas: "standing" "stage" "controls" "seats";
  gap: var(--gr-space-2);
}

/*
 * The stage, which is the cloth's or the wheel's depending on the phase.
 *
 * Its own container so both are sized from the room they actually have rather
 * than from the viewport (L3): a short phone shrinks them instead of pushing
 * the controls below the fold.
 */
.rl__stage {
  grid-area: stage;
  container: rl-stage / size;
  position: relative;
  min-height: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas: "corner cloth wheel";
  align-items: center;
  gap: var(--gr-space-2);
}

/*
 * The cloth's box, and the one thing on this page allowed to scroll.
 *
 * Fourteen grid units tall by five wide means the cloth's height is always
 * about 2.8x its width, so squares big enough for a thumb need more height
 * than a 375x560 phone has. The page still does not scroll (L1); this box
 * does, which L6 allows in as many words, and .table-scroll gives it the
 * room's own bar (M2).
 */
.rl__cloth-holds {
  grid-area: cloth;
  max-height: 100cqh;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  justify-content: center;
}

.rl__wheel-holds {
  grid-area: wheel;
  display: grid;
  justify-items: center;
  gap: var(--gr-space-1);
  width: clamp(72px, 22cqw, 96px);
  transition: width var(--gr-motion-slow) var(--gr-ease-out);
}

.rl__covered {
  font-size: var(--gr-text-xs);
  color: var(--gr-color-ink-dim);
  text-align: center;
  line-height: 1.2;
}

.rl__corner {
  grid-area: corner;
  display: grid;
  gap: var(--gr-space-2);
  align-content: start;
  padding-top: var(--gr-space-2);
}

/*
 * The swap. One element changing size rather than two crossfading, so the
 * wheel travels from the medallion into the stage and back — one motion per
 * thing, as the building's rules have it.
 */
.rl__stage[data-on="wheel"] {
  grid-template-columns: auto minmax(0, 1fr) 0;
}

.rl__stage[data-on="wheel"] .rl__wheel-holds {
  position: absolute;
  inset: 0;
  width: auto;
  justify-items: center;
  align-content: center;
  z-index: 2;
}

.rl__stage[data-on="wheel"] .rl__cloth-holds {
  filter: blur(2px) brightness(0.55);
  overflow: hidden;
  transition: filter var(--gr-motion-slow) var(--gr-ease-out);
}

/* Past this the cloth lies down and the wheel moves to a side column of its
   own, so the cloth gets the whole stage width and TURNS_AT can never
   disagree with this query the way it did when the wheel stood beside it. */
@container rl (min-width: 760px) {
  .rl__in {
    grid-template-columns: minmax(0, 1fr) clamp(200px, 26cqw, 300px);
    grid-template-areas:
      "standing side"
      "stage    side"
      "controls side"
      "seats    side";
  }
  .rl__stage {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: "corner cloth";
  }
  .rl__wheel-holds {
    grid-area: unset;
    width: 100%;
  }
  .rl__boards {
    grid-area: side;
  }
  /* A desk has room for both, so nothing swaps. */
  .rl__stage[data-on="wheel"] .rl__cloth-holds {
    filter: none;
  }
  .rl__stage[data-on="wheel"] .rl__wheel-holds {
    position: static;
    inset: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rl__wheel-holds,
  .rl__stage[data-on="wheel"] .rl__cloth-holds {
    transition: none;
  }
}
```

At the desk size the wheel needs to be *inside* the side column rather than the stage. Move its JSX into the `.rl__boards` element at that size with `order`, or — simpler and what this CSS assumes — render the wheel once inside `.rl__stage` and let the container query reposition it. If the grid fights you, the honest fix is to render `<Wheel>` in `.rl__boards` above `<History>` and keep only the medallion caption in the stage; do that rather than duplicating the wheel.

Check every `--gr-*` token used here exists in `packages/ui`. Substitute the nearest real one if not; do not invent tokens.

- [ ] **Step 6: Run the stylesheet test and watch it pass**

```bash
npx vitest run apps/web/src/roulette/roulette.css.test.ts
```

Expected: PASS.

- [ ] **Step 7: Prove the result is not leaked early**

Add to `apps/web/src/roulette/Roulette.test.tsx`:

```tsx
it("says nothing about the pocket while the ball is still in the air (T4)", () => {
  const state = viewWith({ phase: "spinning", pocket: 17 });
  const { container } = render(<Felt table={fakeTable()} state={state} seatId="a" />);
  expect(container.querySelector(".rl__covered")?.textContent).not.toContain("17");
  expect(container.querySelector(".rl__square--won")).toBe(null);
});
```

Use whatever fixture helpers the file already has; if it has none, build a `TableView` literal from `games/roulette/src/table.ts`'s interface. The assertion is the point, not the fixture.

- [ ] **Step 8: Run everything and commit**

```bash
npx vitest run apps/web/src/roulette
npm run typecheck && npm run lint
npx biome format --write apps/web/src/roulette/Roulette.tsx apps/web/src/roulette/roulette.css.test.ts apps/web/src/roulette/Roulette.test.tsx
git add apps/web/src/roulette/
git commit -m "$(cat <<'EOF'
feat(roulette): one screen, and a stage that goes to whoever needs it

The page is the window now (L1), with one flexing row. A phone hasn't the
height for both the wheel and a cloth whose squares you can hit, so the stage
goes to the cloth while you are betting and to the wheel while the ball is
rolling — and back at "settled", which is when the cloth is worth looking at.

The cloth's own box scrolls on short phones. The page does not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: What it pays, behind a `?`

T3. Roulette has no payout sheet at all today.

**Files:**
- Create: `apps/web/src/roulette/HowItPays.tsx`
- Create: `apps/web/src/roulette/HowItPays.test.tsx`
- Modify: `apps/web/src/roulette/Roulette.tsx` (the `?` key in `.rl__corner`)
- Modify: `apps/web/src/roulette/roulette.css`

**Interfaces:**
- Consumes: `kindsOf`, `pays`, `SPOTS`, `type Kind` from `@backroom/game-roulette`.
- Produces:
  ```ts
  export const PAYS_SHEET_ID = "rl-pays";
  export function HowItPays({ open, onClose, lit }: {
    open: boolean;
    onClose: () => void;
    /** The kind of bet currently aimed at, whose row lights. */
    lit: Kind | null;
  }): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/roulette/HowItPays.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HowItPays } from "./HowItPays.js";

afterEach(cleanup);

describe("what it pays", () => {
  it("shows nothing until it is opened", () => {
    const { container } = render(<HowItPays open={false} onClose={() => {}} lit={null} />);
    expect(container.firstChild).toBe(null);
  });

  it("names every kind of bet with what it pays", () => {
    render(<HowItPays open onClose={() => {}} lit={null} />);
    expect(screen.getByText("35 to 1")).toBeDefined();
    expect(screen.getByText("1 to 1")).toBeDefined();
  });

  it("lights the row for the bet being aimed at", () => {
    const { container } = render(<HowItPays open onClose={() => {}} lit="split" />);
    const lit = container.querySelectorAll(".rl__pays-row--lit");
    expect(lit).toHaveLength(1);
    expect(lit[0]?.textContent).toContain("17 to 1");
  });

  it("takes its figures from the rules, not from a list of its own", () => {
    // A straight up pays 35 and a split 17 because 36/n - 1 says so. If the
    // rules ever change, this sheet changes with them or this test fails.
    render(<HowItPays open onClose={() => {}} lit={null} />);
    expect(screen.getByText("17 to 1")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run apps/web/src/roulette/HowItPays.test.tsx
```

Expected: FAIL — cannot resolve `./HowItPays.js`.

- [ ] **Step 3: Write it**

Create `apps/web/src/roulette/HowItPays.tsx`:

```tsx
import type { Kind } from "@backroom/game-roulette";
import { pays, SPOTS } from "@backroom/game-roulette";

export const PAYS_SHEET_ID = "rl-pays";

/** What each kind of bet is called on a sheet, in the order a cloth teaches them. */
const ORDER: ReadonlyArray<{ kind: Kind; name: string; note: string }> = [
  { kind: "straight", name: "Straight up", note: "One number" },
  { kind: "split", name: "Split", note: "Two, on the line between" },
  { kind: "street", name: "Street", note: "A row of three" },
  { kind: "corner", name: "Corner", note: "Four, where they meet" },
  { kind: "trio", name: "Trio", note: "The zero and two beside it" },
  { kind: "basket", name: "Basket", note: "The zero and the first three" },
  { kind: "six", name: "Six line", note: "Two rows" },
  { kind: "column", name: "Column", note: "Twelve, down the cloth" },
  { kind: "dozen", name: "Dozen", note: "Twelve, across it" },
  { kind: "even", name: "Even money", note: "Red, black, odd, even, halves" },
];

/**
 * What every bet on the cloth pays.
 *
 * Every figure comes from `pays()` in the rules rather than from a list here.
 * A sheet that can disagree with the payouts is worse than no sheet — the
 * cloth learned this once already, when `dressOf` went on testing for "2 to 1"
 * after the cloth had started saying "2:1" and quietly styled nothing.
 */
export function HowItPays({
  open,
  onClose,
  lit,
}: {
  open: boolean;
  onClose: () => void;
  lit: Kind | null;
}) {
  if (!open) {
    return null;
  }
  return (
    <div className="rl__pays housing" id={PAYS_SHEET_ID} role="dialog" aria-label="What it pays">
      <ul className="rl__pays-list">
        {ORDER.map(({ kind, name, note }) => {
          const one = [...SPOTS.values()].find((spot) => spot.kind === kind);
          if (one === undefined) {
            return null;
          }
          return (
            <li
              key={kind}
              className={`rl__pays-row${lit === kind ? " rl__pays-row--lit" : ""}`}
            >
              <span className="rl__pays-name">{name}</span>
              <span className="rl__pays-note">{note}</span>
              <span className="rl__pays-odds">{`${pays(one)} to 1`}</span>
            </li>
          );
        })}
      </ul>
      <button type="button" className="key" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run apps/web/src/roulette/HowItPays.test.tsx
```

Expected: PASS. If `pays()` returns a non-integer for a kind, that is a real bug in the rules and `spots.test.ts` should already catch it — do not round it away here.

- [ ] **Step 5: Hang the `?` key in the corner**

In `Roulette.tsx`'s `Felt`, add `const [paysOpen, setPaysOpen] = useState(false);` and put the key in `.rl__corner`:

```tsx
          <div className="rl__corner">
            <button
              type="button"
              className="key key--icon"
              aria-label="What it pays"
              aria-expanded={paysOpen}
              aria-controls={PAYS_SHEET_ID}
              onClick={() => setPaysOpen((was) => !was)}
            >
              ?
            </button>
          </div>
```

- [ ] **Step 6: Light the row the cloth is aiming at**

T3 asks for the sheet to light "the rows that apply to what is selected", so
the cloth has to report what it is aiming at. It already computes it — Task 4
left `aimed` in hand — so this is one prop, not a second mechanism.

Add to `Cloth`'s props in `Cloth.tsx`:

```tsx
  /** What the cloth is currently aimed at, so a payout sheet can light its row. */
  onAim?: (kind: Kind | null) => void;
```

and report it from an effect, so a render is never the thing that calls a
parent's setter:

```tsx
  useEffect(() => {
    onAim?.(aimed?.kind ?? null);
  }, [aimed, onAim]);
```

Import `type Kind` from `@backroom/game-roulette`. The caller must memoise its
handler (`useCallback`) or the effect runs every render.

In `Felt`:

```tsx
  const [aimedKind, setAimedKind] = useState<Kind | null>(null);
```

pass `onAim={setAimedKind}` to `<Cloth>` — a `useState` setter is already
stable — and render the sheet inside `.rl__stage`:

```tsx
          <HowItPays open={paysOpen} onClose={() => setPaysOpen(false)} lit={aimedKind} />
```

Add a test to `HowItPays.test.tsx`'s neighbours in `Cloth.test.tsx`:

```tsx
it("reports what it is aiming at, so the payout sheet can light a row", () => {
  const onAim = vi.fn();
  draw({ onAim });
  const cloth = screen.getByRole("group", { name: "The betting cloth" });
  fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
  expect(onAim).toHaveBeenLastCalledWith("straight");
});
```

Style `.rl__pays` as an absolutely-positioned panel over the stage with `inset: 0`, matching `housing` from the fittings.

- [ ] **Step 7: Run, typecheck and commit**

```bash
npx vitest run apps/web/src/roulette
npm run typecheck
npx biome format --write apps/web/src/roulette/HowItPays.tsx apps/web/src/roulette/HowItPays.test.tsx apps/web/src/roulette/Roulette.tsx
git add apps/web/src/roulette/
git commit -m "$(cat <<'EOF'
feat(roulette): what it pays, within reach and not in the way (T3)

The cloth named a bet and never said what it was worth. Behind a ? in the
corner now, built from pays() so it cannot drift from the rules the way the
cloth's own "2 to 1" once did.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Talk, activity and refusals

The inline chat comes off the page; the table's sentences become a log; the server saying no takes the middle of the board.

**Files:**
- Modify: `apps/web/src/roulette/Roulette.tsx`
- Modify: `apps/web/src/roulette/roulette.css`
- Modify: `apps/web/src/roulette/Roulette.test.tsx`

**Interfaces:**
- Consumes: `TableView.eventSeq` (Task 1); `.rl__corner` (Task 6); `useTalk`, `TalkKey`, `TalkSheet` from `../table/TalkSheet.js`; `useActivity`, `ActivityLog` from `../table/Activity.js`; `Refusal` from `../table/Refusal.js`.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/roulette/Roulette.test.tsx`:

```tsx
describe("the table's furniture", () => {
  it("opens talk rather than pushing it onto the page (C1)", () => {
    const { container } = render(<Felt table={fakeTable()} state={viewWith({})} seatId="a" />);
    // No inline chat: the only way to talk is the key.
    expect(container.querySelector(".chat")).toBe(null);
    expect(screen.getByRole("button", { name: /table talk/i })).toBeDefined();
  });

  it("counts what somebody else said while talk was shut (C2)", () => {
    const chat = [
      { seatId: "b", name: "Bo", text: "evening", at: 1 },
      { seatId: "a", name: "Ada", text: "hello", at: 2 },
    ];
    render(<Felt table={fakeTable({ chat })} state={viewWith({})} seatId="a" />);
    // One of the two was yours, so the count is one.
    expect(screen.getByRole("button", { name: "Table talk, 1 unread" })).toBeDefined();
  });

  it("keeps the pocket board out of the activity log (A3)", () => {
    const state = viewWith({ history: [17, 0, 32] });
    const { container } = render(<Felt table={fakeTable()} state={state} seatId="a" />);
    expect(container.querySelector(".rl__history")).not.toBe(null);
  });
});
```

Match the `ChatMessage` shape to `packages/shared`'s — read it first rather than guessing the field names.

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run apps/web/src/roulette/Roulette.test.tsx
```

Expected: FAIL — there is an inline `.chat` and no talk key.

- [ ] **Step 3: Refusal at the table, a strip on the page (N1, N5)**

In `Roulette()`, replace the error line:

```tsx
      {/* At the table a refusal takes the middle of the board; on a page it stays a strip. */}
      {atTable ? (
        <Refusal message={table.error} id={table.errorKey} />
      ) : table.error !== null ? (
        <p className="play__error">{table.error}</p>
      ) : null}
```

`errorKey` is already on `useTableSocket`, so N3 and N4 come for free.

- [ ] **Step 4: Talk and activity**

In `Felt`, remove the `<Chat …/>` from `Roulette()`'s tree and add to `Felt`:

```tsx
  const talk = useTalk(table.chat, seatId);
  // Kept from the first line the table says, so nothing is lost while talk is
  // shut; the counter tells one broadcast sent twice from two real events.
  const activity = useActivity({ code: state.code, text: state.lastEvent, seq: state.eventSeq });
```

Talk and the pays sheet are two dialogs claiming the same rectangle, so opening one closes the other:

```tsx
  const togglePays = () => {
    talk.close();
    setPaysOpen((was) => !was);
  };
  const toggleTalk = () => {
    setPaysOpen(false);
    talk.toggle();
  };
```

Put the `TalkKey` in `.rl__corner` above the `?`, and render the sheet at the end of the section:

```tsx
      <TalkSheet
        open={talk.open}
        onClose={talk.close}
        log={table.chat}
        seatId={seatId}
        onSay={table.say}
        activity={<ActivityLog entries={activity} />}
      />
```

C5: do **not** wrap `TalkSheet` in a region — the shared `Chat` inside it is already a named one.

- [ ] **Step 5: Move the boards**

History becomes a thin strip inside `.rl__in`, between the standing line and the stage. Winners comes off the phone entirely and lives in the side column at a desk:

```tsx
        <History pockets={state.history} />
```

as a row of the grid (add `"history"` to `grid-template-areas` and an `auto` row), and in the CSS:

```css
/* A phone has not the height for the winners board and the cloth both, so it
   goes where the table's other sentences are. The pocket board stays: it is
   the one record roulette players actually read (A3). */
.rl__boards {
  display: none;
}

@container rl (min-width: 760px) {
  .rl__boards {
    display: grid;
    gap: var(--gr-space-3);
    align-content: start;
    min-height: 0;
    overflow-y: auto;
  }
}
```

and pass Winners into the sheet's activity tab on a phone by rendering it above the log:

```tsx
        activity={
          <>
            <Winners winners={state.winners} />
            <ActivityLog entries={activity} />
          </>
        }
```

- [ ] **Step 6: Run and commit**

```bash
npx vitest run apps/web/src/roulette
npm run typecheck && npm run lint
npx biome format --write apps/web/src/roulette/Roulette.tsx apps/web/src/roulette/Roulette.test.tsx
git add apps/web/src/roulette/
git commit -m "$(cat <<'EOF'
feat(roulette): talk is opened, what happened is kept, and a no is seen

Chat came off the page and behind a key that counts what you missed. The
table's sentences are a log rather than a line that flashes. A refusal takes
the middle of the board with the cloth blurred behind it, and the connection
light keeps saying what it always said.

The pocket board stays on the felt — it is the record players read. Winners
goes where the table's other sentences are on a phone, and keeps its panel at
a desk.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: The taunt key

K5. A spin is the one stretch of a round with nothing to do.

**Files:**
- Modify: `apps/web/src/roulette/Roulette.tsx`
- Modify: `apps/web/src/roulette/roulette.css`

**Interfaces:**
- Consumes: `TauntPicker` (`openClassName="key"`), `TauntStage`, `Controls`'s `taunt` prop (Task 5).

- [ ] **Step 1: Write the failing test**

Add to `Roulette.test.tsx`:

```tsx
it("offers a taunt while the wheel is turning, and not while you are betting (K5)", () => {
  const spinning = render(<Felt table={fakeTable()} state={viewWith({ phase: "spinning", pocket: 17 })} seatId="a" />);
  expect(screen.queryByRole("button", { name: /taunt/i })).not.toBe(null);
  spinning.unmount();
  render(<Felt table={fakeTable()} state={viewWith({ phase: "betting" })} seatId="a" />);
  expect(screen.queryByRole("button", { name: /taunt/i })).toBe(null);
});
```

Check `TauntPicker`'s opening button's accessible name first and match the regex to it.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run apps/web/src/roulette/Roulette.test.tsx
```

Expected: FAIL — no taunt key anywhere.

- [ ] **Step 3: Add it**

In `Felt`, build the picker and hand it to `Controls`:

```tsx
  /* While the ball is rolling, which is the one stretch of a round with
     nothing to do. On the right, so its panel opens on screen. */
  const taunt =
    state.phase === "spinning" ? (
      <TauntPicker
        seats={state.seats.map((seat) => ({
          id: seat.id,
          name: seat.name,
          isBot: seat.isBot,
          signedIn: seat.signedIn,
        }))}
        seatId={seatId}
        chips={account.profile?.chips ?? null}
        stakes={table.stakes}
        onThrow={(emote, at) => table.taunt(emote.id, at)}
        openClassName="key"
      />
    ) : null;
```

`isBot` is already on `SeatView` (`games/roulette/src/table.ts:97`) and `signedIn`
was added in Task 1. `useTableSocket` exposes `stakes`, `landed` and
`taunt(emoteId, seatId, done?)` (`useTableSocket.ts:127`, `:128`, `:136`), so no
hook changes are needed.

`Felt` does not currently receive `account`. Thread it down from `Roulette()`
the way Blackjack does — add `account: Account` to `Felt`'s props and pass
`account={account}` at the call site.

Pass `taunt={taunt}` to `Controls`, and render `<TauntStage landed={table.landed} />` beside `<Felt>` in `Roulette()`, over the felt as Blackjack does.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run apps/web/src/roulette
npm run typecheck
npx biome format --write apps/web/src/roulette/Roulette.tsx apps/web/src/roulette/Roulette.test.tsx
git add apps/web/src/roulette/
git commit -m "$(cat <<'EOF'
feat(roulette): something to do while the ball is in the air

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: The setup screen, and the mockup's orientation control

The last bespoke control, and the gallery that has to keep drawing.

**Files:**
- Modify: `apps/web/src/roulette/Roulette.tsx` (`Sit`'s options)
- Modify: `apps/web/src/style/RouletteMockup.tsx`
- Modify: `apps/web/src/roulette/roulette.css` (delete the `.stakes__*` rules if nothing else uses them — **grep first**)

- [ ] **Step 1: Write the failing test**

Add to `Roulette.test.tsx` (or `TableSetup`'s own tests if that is where setup is exercised):

```tsx
it("asks how long bets stay open with a Seg, not bespoke buttons", () => {
  render(<Sit table={fakeTable()} invited="" account={fakeAccount()} />);
  expect(screen.getByRole("group", { name: "Betting" })).toBeDefined();
  expect(document.querySelector(".stakes__pick")).toBe(null);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run apps/web/src/roulette/Roulette.test.tsx
```

Expected: FAIL — the picker is still `.stakes__pick` buttons.

- [ ] **Step 3: Swap in `Seg`**

In `Sit`, replace the whole `<div className="stakes">` block:

```tsx
        <Seg
          label="Betting"
          value={String(window)}
          onChange={(value) => setWindow(Number(value))}
          options={WINDOWS.map((level) => ({ value: String(level), text: `${level / 1000}s` }))}
        />
```

`Seg` is generic over `string | boolean`, so the window is carried as a string and converted back. Import it from `../fittings/Seg.js`.

Then **grep before deleting**: `grep -rn "stakes__" apps/web/src` — Two-Up and Death Roll may share these classes. Remove only the rules nothing else uses.

- [ ] **Step 4: Give the mockup its orientation control**

In `apps/web/src/style/RouletteMockup.tsx`, add `const [portrait, setPortrait] = useState(false);`, pass `portrait={portrait}` to `<Cloth>`, and add a `Seg` above it:

```tsx
        <Seg
          label="Cloth"
          value={portrait}
          onChange={setPortrait}
          options={[
            { value: false, text: "Laid out" },
            { value: true, text: "On its side" },
          ]}
        />
```

This is the cheapest way to look at both orientations without a server and a seat, and the gallery is where the cloth gets looked at.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/web/src
npm run typecheck && npm run lint
npx biome format --write apps/web/src/roulette/Roulette.tsx apps/web/src/style/RouletteMockup.tsx
git add apps/web/src/roulette/ apps/web/src/style/RouletteMockup.tsx
git commit -m "$(cat <<'EOF'
feat(roulette): the last bespoke control, and a cloth you can turn over

The betting window picker is a Seg like every other choice in the building.
The gallery's cloth gets the orientation switch it always could have had —
Cloth has taken the prop all along and nothing passed it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: The sweep — by hand at every size

Nothing here is optional. §L8 is a checklist that is *checked*, and the spec's definition of done turns on it.

**Files:**
- Modify: whatever the checks turn up.
- Modify: `docs/superpowers/specs/2026-09-16-table-requirements.md` (§13's Roulette row and checklist)

- [ ] **Step 1: Start the app**

Use the preview tooling with the `backroom` configuration from `.claude/launch.json`. Never `npm run dev` through a shell tool. If port 5173 is taken by another session, say so and stop rather than fighting it.

The worktree needs the main checkout's `.env` copied in, or sign-in and the database are off.

- [ ] **Step 2: Walk the L8 sizes**

At **375×560, 375×667, 375×812, 768×1024** and a desk, with a table open and a seat taken, assert in the console:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```

and confirm by eye at each: the chip keys, the custom box and the three acts are all visible **without scrolling the page**; the cloth's squares are big enough to aim at; nothing is clipped. Fix what fails, each fix with a test watched failing first.

- [ ] **Step 3: Walk a whole round on the smallest phone**

At 375×560: place a chip by press-and-lift; slide before lifting and confirm it lands where the finger ended; hold and confirm the label turns and a chip comes off; type a custom figure and bet it; press Undo and Clear; let the window shut and watch the wheel take the stage; watch it hand back at "settled" with the winning square lit.

- [ ] **Step 4: The rest of the by-hand list**

- A throttled connection (DevTools, Slow 3G) — the acts show busy, nothing invents a fact, the stake shows on the press.
- A refusal with the board blurred behind it — bet past the cap on a nearly-empty bank.
- Talk opened on a phone: it rises from the bottom, stops short of the seats, Escape and the scrim close it, focus returns to the key.
- `prefers-reduced-motion: reduce` — the stage still swaps, instantly, and the page still says everything.
- The keyboard alone: Tab to the `.rl__reach` list and place a bet; R, U and C work; none of them fires while typing in the custom box or in talk.

- [ ] **Step 5: Update the requirements document**

In §13's table, Roulette's column becomes `yes` for one screen, fittings, talk sheet, activity log, refusal overlay and taunt key; `R/U/C` for shortcuts; `chip keys + typed` for stake. Tick the Roulette checklist, and strike open questions 3 and 5, recording the answers. Leave the K1/K2/F2 exception written down where a reader of the standard will find it.

- [ ] **Step 6: The full gate, and the PR**

```bash
npm test
npm run typecheck
npm run lint
```

All three clean. Then open the PR, and say in its body which requirements are deliberately unmet (K1, K2, F2) and why.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs: roulette meets the standard, and says where it does not

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Notes for whoever executes this

- **Task 6 is the one that can go wrong.** The grid, the container queries and the swap all land together, and the desk arrangement asks the wheel to live in a different parent at two sizes. If the container query fights you, the honest fix named in the task — render the wheel in the side column and leave only its caption in the stage — is better than duplicating the wheel or reaching for a media query.
- **`TURNS_AT` is load-bearing.** `Cloth` decides its own orientation from its own width, and `roulette.css` has been bitten before by a container query that disagreed with it. If a desk ever shows a portrait cloth, those two numbers have drifted apart again.
- **Do not let the client start enforcing anything.** `reach.most` exists to *say* what the bank covers. Every figure is checked again server-side, per spot, counting everybody's chips — and that is the only thing that can refuse a bet.
