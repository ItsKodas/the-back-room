# Poker table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Poker table up to `2026-09-16-table-requirements.md` and make the whole table — felt, readout and controls — fit a 375px phone with nothing to scroll.

**Architecture:** The page becomes `.play--fit` (the window, not at least the window), chat leaves it for the shared talk sheet, and the felt becomes a size container whose pieces measure themselves against both its axes. Seats stop being placed by React: each carries `--seat` and `--of`, the angle is computed in CSS, and a container query changes the *arrangement* — a horseshoe under 560px, the full oval above, and a side column past 1200px. Everything bespoke in the controls moves to the building's fittings.

**Tech Stack:** TypeScript, React 18, Vite, vitest + @testing-library/react, plain CSS with container queries and CSS trig (`sin()`/`cos()`), biome.

**Spec:** `docs/superpowers/specs/2026-09-22-poker-table-design.md`

## Global Constraints

- `npm test`, `npm run typecheck` and `npm run lint` must all be clean at every commit.
- Format with `biome format --write <paths you touched>`. **Never** `biome check --write` across the repo — it applies an import-ordering assist this project deliberately leaves off.
- Before adding rules to a stylesheet, `grep` for its filename to confirm something imports it. Orphan `.css` files have existed here.
- Every bug fix gets a test **watched failing against the old code** first. A test that merely passes afterwards is not enough.
- Comments say **why**, not what.
- The server is the only authority. The client may show a rule; it may never be the thing enforcing one. Hiding a control is a courtesy; refusing the message is the rule.
- Bots are refused at every table that plays for chips, server-side. This plan does not touch that.
- Every keyframe added or moved gets its off switch in the sheet's own `@media (prefers-reduced-motion: reduce)` block.
- Nothing may be wider than the window at 375px: `document.documentElement.scrollWidth === clientWidth`.
- Class names stay `pk__`-prefixed. `game.css` is global and carries several pages.
- Breakpoints, exactly: **560px** is where the arrangement changes (container query on `.pk`), **1200px** is where the side column appears (container query on `.pk`).
- Keys, exactly: **Space** presses the lit slab (Check when free, Call when not), **F** folds, **R** raises to whatever the amount control shows.
- Seat angle, full oval: `calc(90deg + (var(--seat) / var(--of)) * 360deg)`.
- Seat angle, horseshoe (others only; your own seat is pinned to `90deg`): `calc(150deg + ((var(--seat) - 0.5) / (var(--of) - 1)) * 240deg)`.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/web/src/table/Sheet.tsx` | The generic sheet laid over a table (moved from `blackjack/`) |
| `apps/web/src/table/Sheet.test.tsx` | Its tests (moved) |
| `apps/web/src/table/useTableKeys.ts` | The generic key handler (extracted from `blackjack/`) |
| `apps/web/src/table/useTableKeys.test.tsx` | Its tests (moved) |
| `apps/web/src/poker/Felt.tsx` | The cloth: seats, board, pot, sweeps, corner keys |
| `apps/web/src/poker/Seat.tsx` | One seat |
| `apps/web/src/poker/Controls.tsx` | The bottom row in each of its states |
| `apps/web/src/poker/Amount.tsx` | The raise dial, slider, presets and typed figure |
| `apps/web/src/poker/Readout.tsx` | `T2`: the figure this decision is about, and its model |
| `apps/web/src/poker/PokerSheet.tsx` | The host's table sheet |
| `apps/web/src/poker/poker.css.test.ts` | Layout rules jsdom cannot see |
| `apps/web/src/poker/Readout.test.tsx`, `Amount.test.tsx`, `Controls.test.tsx`, `Seat.test.tsx` | Tests beside each piece |

**Modified**

| File | Change |
|---|---|
| `games/poker/src/table.ts` | `say()` helper, `eventSeq`, `signedIn` on `SeatView` |
| `games/poker/src/table.test.ts` | Tests for both |
| `apps/web/src/poker/Poker.tsx` | Shrinks to the page: routing, lobby, refusal, taunt stage |
| `apps/web/src/poker/Poker.test.tsx` | Follows the split |
| `apps/web/src/poker/poker.css` | The fitted page, the three arrangements, the fittings |
| `apps/web/src/style/PokerMockup.tsx` | Moves in step; shows the horseshoe too |
| `apps/web/src/blackjack/Blackjack.tsx` | Imports `Sheet` and `useTableKeys` from `table/` |
| `apps/web/src/blackjack/blackjack.css` | Sheet rules leave; `bj__sheet--felt` kept as a second class |
| `apps/web/src/table/table.css` | Gains the sheet rules |

**Deleted**

`apps/web/src/blackjack/Sheet.tsx`, `Sheet.test.tsx`, `useBlackjackKeys.ts`, `useBlackjackKeys.test.tsx` (moved, not rewritten).

---

## Task 1: `eventSeq` on the poker view

The activity log cannot tell one broadcast repeated from the same sentence said twice without a counter, and "Ola checked" twice running is the commonest pair of lines at a poker table.

**Files:**
- Modify: `games/poker/src/table.ts` (the 14 `this.lastEvent = …` sites; the view at ~line 701; `TableView` at ~line 224; the field at ~line 290)
- Test: `games/poker/src/table.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TableView.eventSeq: number`, read by `useActivity` in Task 5.

- [ ] **Step 1: Write the failing tests**

Add to `games/poker/src/table.test.ts`, inside the existing top-level `describe`:

```ts
describe("eventSeq", () => {
  it("moves on for every action the table reports", () => {
    const table = seated(2); // the suite's existing helper for a dealt table
    const before = table.view().eventSeq;
    table.act(table.view().toAct ?? "", { type: "check" });
    const after = table.view().eventSeq;
    expect(after).toBe(before + 1);
  });

  it("moves on again for a second action of the same kind", () => {
    const table = seated(3);
    table.act(table.view().toAct ?? "", { type: "check" });
    const between = table.view().eventSeq;
    table.act(table.view().toAct ?? "", { type: "check" });
    // Two checks in a row are two events. The counter is the only thing that
    // can say so — the sentences differ only by a name, and may not differ at
    // all once two players share one.
    expect(table.view().eventSeq).toBe(between + 1);
  });

  it("does not move on when nothing happened", () => {
    const table = seated(2);
    const at = table.view().eventSeq;
    table.view();
    table.view();
    expect(table.view().eventSeq).toBe(at);
  });
});
```

If the suite's helper is not named `seated`, use whatever it already uses to build a dealt two- and three-handed table — do not add a second helper.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run games/poker/src/table.test.ts -t "eventSeq"`
Expected: FAIL — `eventSeq` is not a property of the view (`undefined`).

- [ ] **Step 3: Add the counter and the one place that sets it**

In `games/poker/src/table.ts`, beside the existing `lastEvent` field:

```ts
  lastEvent: string | null = null;
  eventSeq = 0;

  /**
   * Says what just happened.
   *
   * The only place lastEvent is set, so the counter cannot be forgotten at one
   * of the fourteen places this table talks.
   */
  private say(text: string): void {
    this.lastEvent = text;
    this.eventSeq += 1;
  }
```

Replace every `this.lastEvent = <expr>;` with `this.say(<expr>);` — all 14 of them. Add `eventSeq: number;` to the `TableView` interface and `eventSeq: this.eventSeq,` to `view()`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run games/poker/src/table.test.ts`
Expected: PASS, and the rest of the poker suite still green.

- [ ] **Step 5: Commit**

```bash
git add games/poker/src/table.ts games/poker/src/table.test.ts
git commit -m "feat(poker): a counter that tells two identical events apart"
```

---

## Task 2: `Sheet` moves to `table/`

It is already the generic one. Only its `className` prop names blackjack.

**Files:**
- Create: `apps/web/src/table/Sheet.tsx`, `apps/web/src/table/Sheet.test.tsx`
- Delete: `apps/web/src/blackjack/Sheet.tsx`, `apps/web/src/blackjack/Sheet.test.tsx`
- Modify: `apps/web/src/table/table.css`, `apps/web/src/blackjack/blackjack.css` (rules at 774–850 and 1261 and 1665–1666), `apps/web/src/blackjack/Blackjack.tsx`, `apps/web/src/blackjack/TableSheet.tsx` (if it renders `Sheet`)

**Interfaces:**
- Produces: `Sheet({ id, label, heading?, open, onClose, className: "sheet--felt" | "sheet--page", children })`, imported from `../table/Sheet.js`.

- [ ] **Step 1: Move the files with git, so the history follows**

```bash
git mv apps/web/src/blackjack/Sheet.tsx apps/web/src/table/Sheet.tsx
git mv apps/web/src/blackjack/Sheet.test.tsx apps/web/src/table/Sheet.test.tsx
```

- [ ] **Step 2: Rename its classes and its prop**

In `apps/web/src/table/Sheet.tsx`: `bj__scrim` → `sheet__scrim`, `bj__sheet` → `sheet`, `bj__sheet-head` → `sheet__head`, `bj__sheet-title` → `sheet__title`, `bj__sheet-body` → `sheet__body`, and the prop type `"bj__sheet--felt" | "bj__sheet--page"` → `"sheet--felt" | "sheet--page"`. Change its stylesheet import to `./table.css`. The `table-scroll` class on the body stays — it is already the shared one.

- [ ] **Step 3: Move the rules**

Cut `.bj__scrim`, `.bj__sheet`, `.bj__sheet:focus`, `.bj__sheet--felt`, `.bj__sheet--page`, `.bj__sheet-head`, `.bj__sheet-title`, `.bj__sheet-body` (blackjack.css 774–850), the `.bj__sheet--page` override at 1261 and the two reduced-motion selectors at 1665–1666 into `apps/web/src/table/table.css`, renamed to match Step 2. Keep the reduced-motion selectors inside `table.css`'s own `@media (prefers-reduced-motion: reduce)` block.

In `blackjack.css`, leave behind only what is genuinely blackjack's — if the felt sheet needs a different inset there, keep a `.bj__sheet--felt` rule with two classes so it beats the fitting.

- [ ] **Step 4: Update blackjack's callers**

`Blackjack.tsx`: import from `../table/Sheet.js`, and `className="bj__sheet--felt"` becomes `className="sheet--felt"` (add `bj__sheet--felt` as a second class only if Step 3 left a rule for it).

- [ ] **Step 5: Run the suites**

Run: `npx vitest run apps/web/src/table/Sheet.test.tsx apps/web/src/blackjack`
Expected: PASS. Nothing about the sheet's behaviour changed, so no test body should need editing — only its import path.

- [ ] **Step 6: Commit**

```bash
biome format --write apps/web/src/table/Sheet.tsx apps/web/src/table/Sheet.test.tsx apps/web/src/blackjack/Blackjack.tsx
git add -A apps/web/src
git commit -m "refactor(web): the sheet belongs to every table, not to blackjack"
```

---

## Task 3: `useTableKeys` extracted to `table/`

**Files:**
- Create: `apps/web/src/table/useTableKeys.ts`, `apps/web/src/table/useTableKeys.test.tsx`
- Delete: `apps/web/src/blackjack/useBlackjackKeys.ts`, `apps/web/src/blackjack/useBlackjackKeys.test.tsx`
- Modify: `apps/web/src/blackjack/Blackjack.tsx`

**Interfaces:**
- Produces:

```ts
export interface TableKeys {
  /** Which key presses which button, by the name the button declares. */
  shortcuts: Readonly<Record<string, string>>;
  /** What a pointer going down inside hands its keys to the table. Omit where the table has no such piece. */
  holds?: string;
}
export function useTableKeys(root: RefObject<HTMLElement | null>, keys: TableKeys): void
```

- [ ] **Step 1: Move the files**

```bash
git mv apps/web/src/blackjack/useBlackjackKeys.ts apps/web/src/table/useTableKeys.ts
git mv apps/web/src/blackjack/useBlackjackKeys.test.tsx apps/web/src/table/useTableKeys.test.tsx
```

- [ ] **Step 2: Make the two blackjack-shaped things arguments**

In `useTableKeys.ts`: rename the export, take `keys: TableKeys`, delete the module-level `SHORTCUTS` const and read `keys.shortcuts` instead, and replace both `.bj__chip` literals with `keys.holds`. Where `holds` is undefined the Space guard reduces to "a focused button or link presses itself":

```ts
      if (name === "Space" && target !== null) {
        const held = keys.holds === undefined ? null : target.closest(keys.holds);
        /*
         * A piece somebody clicked hands Space to the table: stack chips, press
         * Space, is the rhythm of a bet. A piece reached by keyboard keeps its
         * own Space, since that is how a keyboard presses it at all, and any
         * other focused button or link presses itself.
         */
        if (held !== null ? held !== clicked : target.closest("a, button") !== null) {
          return;
        }
      }
```

and in `onPointer`:

```ts
      clicked =
        keys.holds === undefined || !(event.target instanceof Element)
          ? null
          : event.target.closest(keys.holds);
```

The effect's dependency list becomes `[root, keys.shortcuts, keys.holds]`. Callers must pass a stable `shortcuts` object — declare it as a module-level const, not an inline literal, or the effect re-binds on every render.

- [ ] **Step 3: Update the test file and blackjack**

In `useTableKeys.test.tsx`, call `useTableKeys(ref, { shortcuts: { " ": "Space", s: "S", d: "D", p: "P" }, holds: ".bj__chip" })` wherever it called `useBlackjackKeys(ref)`. Assertions do not change. In `Blackjack.tsx`, declare the map as a module-level const and call the hook with it.

- [ ] **Step 4: Add one test for the no-`holds` case**

```tsx
it("presses the button when the table has no held piece", async () => {
  // A table with no chip tray passes no `holds`, and Space must still reach the slab.
  render(<Harness keys={{ shortcuts: { " ": "Space" } }} />);
  await user.click(screen.getByRole("button", { name: /somewhere else/i }));
  fireEvent.keyDown(window, { key: " " });
  expect(pressed).toBe(1);
});
```

Use the file's existing harness and spy; match its names rather than inventing new ones.

- [ ] **Step 5: Run the suites**

Run: `npx vitest run apps/web/src/table/useTableKeys.test.tsx apps/web/src/blackjack`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
biome format --write apps/web/src/table/useTableKeys.ts apps/web/src/table/useTableKeys.test.tsx apps/web/src/blackjack/Blackjack.tsx
git add -A apps/web/src
git commit -m "refactor(web): the key handler belongs to every table"
```

---

## Task 4: Split `Poker.tsx`

A pure move: no behaviour changes, so the existing suite is the proof. Do this before the redesign so every later task edits a small file.

**Files:**
- Create: `apps/web/src/poker/Felt.tsx`, `Seat.tsx`, `Controls.tsx`, `Amount.tsx`
- Modify: `apps/web/src/poker/Poker.tsx`, `apps/web/src/poker/Poker.test.tsx`

**Interfaces:**
- Produces: `Felt({ table, state, seatId })`, `Seat({ seat, at, of, state, mine, won, said, pending, using, spotlit })`, `Actions({ table, state, me, intent })` from `Controls.tsx`, `OnTurn({ you, me, pot, blind, busy, onAct })` from `Amount.tsx`. All named exports; `Poker` stays the default export of `Poker.tsx`.

- [ ] **Step 1: Move the code, unchanged**

- `Felt.tsx`: `Felt`, `seatAt`, `dodge`, `potsOf`, `useMoment`, `SLOTS`, `MOMENT_MS`, `EMPTY`, `nameOf`, `pointing`, `TABLE_CHIPS`, `fmt`.
- `Seat.tsx`: `Seat`.
- `Controls.tsx`: `Actions`, `Pre`, `PRE_CHOICES`, `clamp`.
- `Amount.tsx`: `OnTurn`.
- `Poker.tsx` keeps `Poker` and `Sit`.

Shared helpers (`fmt`, `TABLE_CHIPS`, `clamp`, `pointing`, `nameOf`, `EMPTY`) are exported from `Felt.tsx` and imported by the others rather than copied. Keep every comment with the code it explains — they carry the reasoning and are not decoration.

- [ ] **Step 2: Run the whole poker suite**

Run: `npx vitest run apps/web/src/poker`
Expected: PASS, untouched. If a test fails, the move changed behaviour — find it rather than editing the test.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Split the test file to match**

Move the tests that exercise a seat into `Seat.test.tsx`, the controls into `Controls.test.tsx`, the amount into `Amount.test.tsx`; `Poker.test.tsx` keeps the page, the lobby and the whole-table cases. No assertion changes.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/web/src/poker
biome format --write apps/web/src/poker
git add -A apps/web/src/poker
git commit -m "refactor(web): the poker felt, its seats and its controls get their own files"
```

---

## Task 5: Talk, activity and refusals

Chat leaves the page, which is what makes the fitted felt affordable in Task 6.

**Files:**
- Modify: `apps/web/src/poker/Poker.tsx`, `apps/web/src/poker/Felt.tsx`, `apps/web/src/poker/poker.css`
- Test: `apps/web/src/poker/Poker.test.tsx`

**Interfaces:**
- Consumes: `TableView.eventSeq` (Task 1).
- Produces: nothing new; `Felt` gains `talk` props — `Felt({ table, state, seatId, talkKey })` where `talkKey` is a `ReactNode` rendered into the felt's top-right corner.

- [ ] **Step 1: Write the failing tests**

In `Poker.test.tsx`:

```tsx
it("keeps talk off the page until it is asked for", () => {
  renderTable(dealtState()); // the file's existing helper
  expect(screen.queryByRole("region", { name: /table talk/i })).toBeNull();
  expect(screen.getByRole("button", { name: /table talk/i })).toBeInTheDocument();
});

it("counts what somebody else said while talk was shut", () => {
  const { rerender } = renderTable(dealtState(), { chat: [] });
  rerender(tableWith({ chat: [{ seatId: "other", name: "Ines", text: "nice hand", at: 1 }] }));
  expect(screen.getByRole("button", { name: /table talk, 1 unread/i })).toBeInTheDocument();
});

it("keeps what the table said as a log rather than flashing it", () => {
  const { rerender } = renderTable(dealtState({ lastEvent: "Ines raised to 200", eventSeq: 1 }));
  rerender(tableWith({ lastEvent: "Tam folded", eventSeq: 2 }));
  fireEvent.click(screen.getByRole("button", { name: /table talk/i }));
  fireEvent.click(screen.getByRole("tab", { name: /activity/i }));
  expect(screen.getByText("Ines raised to 200")).toBeInTheDocument();
  expect(screen.getByText("Tam folded")).toBeInTheDocument();
});

it("puts a refusal over the cloth rather than in a strip", () => {
  renderTable(dealtState(), { error: "Not your turn", errorKey: 1 });
  expect(screen.getByRole("alert")).toHaveTextContent("Not your turn");
  expect(document.querySelector(".play__error")).toBeNull();
});
```

Match the file's existing helpers for building state and re-rendering; do not add a second set.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run apps/web/src/poker/Poker.test.tsx`
Expected: FAIL — no talk key, no tabs, `.play__error` present.

- [ ] **Step 3: Wire the shared pieces in**

In `Poker.tsx`, following `Blackjack.tsx` lines 84–92 and 176–305:

```tsx
const talk = useTalk(table.chat, seatId);
const activity = useActivity(
  state === null ? null : { code: state.code, text: state.lastEvent, seq: state.eventSeq },
);
const log = <ActivityLog entries={activity} />;
```

- At the table, `<Refusal message={table.error} id={table.errorKey} />` replaces the `.play__error` paragraph; off the table (lobby, sign-in, setup) the strip stays — `N5`.
- Delete the `.play__event` paragraph and its `pk__event` rules.
- `<Chat …>` under the felt is replaced by `<TalkSheet open={talk.open} onClose={talk.close} log={table.chat} seatId={seatId} onSay={table.say} activity={log} />`.
- `<TalkKey open={talk.open} unread={talk.unread} onToggle={talk.toggle} />` is passed into `Felt` and rendered inside a `<div className="table-talk-corner">` in the felt's top-right.

Do not wrap `Chat` in a second region — it already names itself "Table talk" (`C5`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/web/src/poker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
biome format --write apps/web/src/poker
git add -A apps/web/src/poker
git commit -m "feat(web): poker's talk is opened rather than pushed, and what happened is kept"
```

---

## Task 6: The fitted page and the felt as a size container

**Files:**
- Modify: `apps/web/src/poker/Poker.tsx`, `apps/web/src/poker/poker.css` (the `.pk` block at 38–72, the `@media (min-width: 561px)` block at 94–104, the `@container (min-width: 561px)` block at 117–127)
- Test: `apps/web/src/poker/poker.css.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `.pk__table` as `container: pk / size`, so every later rule may use `cqi`/`cqh` against the felt.

- [ ] **Step 1: Write the failing stylesheet tests**

Create `apps/web/src/poker/poker.css.test.ts`, copying the `sheet()`, `ruleIn()` and `block()` helpers from `apps/web/src/blackjack/blackjack.css.test.ts` verbatim — they are the suite's convention and re-inventing them is how the two drift.

```ts
const css = sheet("src/poker/poker.css");

describe("one screen", () => {
  it("has exactly one flexing row", () => {
    // The felt gives, everything else takes its own height (L2).
    const grid = ruleIn(css, ".pk");
    expect(grid).toMatch(/grid-template-rows:[^;]*minmax\(0, 1fr\)/);
    expect(grid.match(/minmax\(0, 1fr\)/g)).toHaveLength(1);
  });

  it("does not guess the height of what is not the felt", () => {
    // `--spare: calc(100dvh - 470px)` was that guess, and it was wrong twice.
    expect(css).not.toMatch(/--spare/);
  });

  it("makes the felt a size container so pieces can measure both axes", () => {
    expect(ruleIn(css, ".pk__table")).toMatch(/container:\s*pk\s*\/\s*size/);
  });

  it("sizes the cards against the felt's height as well as its width", () => {
    expect(ruleIn(css, ".pk__cards .bj-card")).toMatch(/min\([^)]*cqi[^)]*cqh[^)]*\)/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run apps/web/src/poker/poker.css.test.ts`
Expected: FAIL on all four — `.pk` is not a grid, `--spare` is present, no size container.

- [ ] **Step 3: Fit the page**

In `Poker.tsx`, the table branch renders `<main className="play play--fit play--poker">`; the lobby and sign-in branches keep plain `.play` so they scroll like pages.

In `poker.css`:

- Delete `--spare`, the `@media (min-width: 561px)` `max-width` block and the `@container (min-width: 561px)` `max-height` block — all three exist to ration a height nobody is measuring any more.
- `.pk` becomes the grid, with its areas **named**, following `.bj__in` in `blackjack.css`:

```css
.pk {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas: "read" "felt" "controls";
  min-height: 0;
  gap: var(--gr-space-2);
}
```

  The names are load-bearing, not decoration: the readout (Task 8), the rules
  and activity panels (Task 12) and the side column (Task 7) all place
  themselves by area, and an area that is not named at this width means an item
  placed into it is auto-placed instead — silently, and only on a phone.
  `.pk__table` takes `grid-area: felt`, the controls `grid-area: controls`.
  The rules and activity panels have no area at this width because they are
  behind keys here; they take theirs in Task 7's desk block.
- `.pk__table` gains `container: pk / size` and keeps `position: relative`. Its `aspect-ratio` moves into the arrangement rules in Task 7.
- Card, face and plate sizes change from `Ncqw` to `min(Ncqi, Mcqh)` inside their existing `clamp()`s. Set them on `.pk__table` as custom properties and let the pieces inherit — never re-declare the same property on the piece itself (`L4`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/web/src/poker`
Expected: PASS.

- [ ] **Step 5: See it**

Start the preview (`preview_start` with `backroom`), open a poker table, and at 375×667 confirm the controls are visible without scrolling and `document.documentElement.scrollWidth === document.documentElement.clientWidth`.

- [ ] **Step 6: Commit**

```bash
biome format --write apps/web/src/poker
git add -A apps/web/src/poker
git commit -m "feat(web): the poker page is the window, and the felt measures itself"
```

---

## Task 7: Three arrangements from one markup

**Files:**
- Modify: `apps/web/src/poker/Felt.tsx` (`seatAt`, `dodge`), `apps/web/src/poker/Seat.tsx`, `apps/web/src/poker/poker.css`
- Test: `apps/web/src/poker/felt.test.ts`, `apps/web/src/poker/poker.css.test.ts`

**Interfaces:**
- Produces: `seatAt(index: number, of: number): React.CSSProperties` returning `{ "--seat": string, "--of": string }` — the same name and signature, a different payload. Nothing else changes shape.

- [ ] **Step 1: Write the failing tests**

In `felt.test.ts`:

```ts
describe("where a seat sits", () => {
  it("says which seat it is and how many there are, and nothing about angles", () => {
    // The arrangement is the stylesheet's decision, so React must not fix it here.
    expect(seatAt(3, 10)).toEqual({ "--seat": "3", "--of": "10" });
  });
});
```

In `poker.css.test.ts`:

```ts
describe("the three arrangements", () => {
  it("places a seat from its index, in CSS", () => {
    const seat = ruleIn(css, ".pk__seat");
    expect(seat).toMatch(/--angle:\s*calc\(90deg \+ \(var\(--seat\) \/ var\(--of\)\) \* 360deg\)/);
    expect(seat).toMatch(/cos\(var\(--angle\)\)/);
    expect(seat).toMatch(/sin\(var\(--angle\)\)/);
  });

  it("opens the ring into a horseshoe on a phone", () => {
    const phone = block(css, "@container pk (max-width: 560px)");
    expect(phone).toMatch(/150deg \+ \(\(var\(--seat\) - 0\.5\) \/ \(var\(--of\) - 1\)\) \* 240deg/);
    // Your own seat is pinned to the bottom rather than spread with the rest.
    expect(phone).toMatch(/\.pk__seat--you\s*\{[^}]*--angle:\s*90deg/);
  });

  it("keeps everybody's cards, face and stake on a phone", () => {
    // They were deleted to buy room the felt did not have. It has it now.
    const phone = block(css, "@container pk (max-width: 560px)");
    expect(phone).not.toMatch(/\.pk__seat \.pk__cards\s*\{[^}]*display:\s*none/);
    expect(phone).not.toMatch(/\.pk__face\s*\{[^}]*display:\s*none/);
  });

  it("gives the felt a side column only once it can pay for one", () => {
    /*
     * Asked of the page's container, not the felt's. A container query can only
     * style what is inside the container it asks, and `.pk` is the felt's
     * ancestor — keyed on `pk` this rule would simply never apply.
     */
    expect(block(css, "@container fit (min-width: 1200px)")).toMatch(/grid-template-areas/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run apps/web/src/poker/felt.test.ts apps/web/src/poker/poker.css.test.ts`
Expected: FAIL — `seatAt` still returns `--cos`/`--sin`, no container blocks.

- [ ] **Step 3: Hand the stylesheet the decision**

`Felt.tsx`:

```ts
/**
 * Which seat this is, and how many there are.
 *
 * Only that. The angle is the stylesheet's to work out, which is what lets a
 * container query change the arrangement — a phone opens the ring into a
 * horseshoe — without React having to measure anything or know it happened.
 */
function seatAt(index: number, of: number): React.CSSProperties {
  return { "--seat": String(index), "--of": String(of) } as React.CSSProperties;
}
```

`dodge()` is deleted: it exists to push a stake out of the pot's column at the top of the oval, and the horseshoe has no seat there while the oval's ring is unchanged — keep it only if Step 5 shows a collision, and if it stays it computes from `--seat`/`--of` in CSS too.

`poker.css`:

```css
.pk__seat {
  --angle: calc(90deg + (var(--seat) / var(--of)) * 360deg);
  left: calc(50% + cos(var(--angle)) * var(--across));
  top: calc(50% + sin(var(--angle)) * var(--down));
}

@container pk (max-width: 560px) {
  .pk__table {
    aspect-ratio: auto;
    --across: 38%;
    --down: 30%;
  }

  /*
   * The ring opens at the bottom. Nine others over an arc from 150° to 390°,
   * centred in it rather than pinned to its ends, so the shape degrades
   * correctly as seats empty: at two seats the one opponent lands at the top,
   * where an opponent belongs.
   */
  .pk__seat {
    --angle: calc(150deg + ((var(--seat) - 0.5) / (var(--of) - 1)) * 240deg);
  }

  /* The bottom of the cloth is yours: your cards, your stack, what you hold. */
  .pk__seat--you {
    --angle: 90deg;
  }
}

/*
 * The readout, the rules and the log come out from behind their keys.
 *
 * Asked of `fit` — the container `.play--fit` already declares in table.css —
 * because `.pk` is the felt's ancestor and cannot answer a query about the
 * felt's own container. The felt's width is what this rule decides, so it
 * cannot also be what decides it.
 */
@container fit (min-width: 1200px) {
  .pk {
    grid-template-columns: minmax(0, 1fr) 330px;
    /* Four areas need four rows: a template with more area rows than track
       rows is invalid and the whole declaration is dropped. */
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    grid-template-areas: "felt read" "felt rules" "felt activity" "felt controls";
  }
}
```

Place this block **after** the base `.pk` rule in the file. `poker.css.test.ts`
reads the first rule matching a selector, so a `.pk` rule sitting above the base
one would be the rule Task 6's tests examine, and they would fail against
correct CSS.

The two queries key off different containers on purpose: the **arrangement of
seats** is the felt's own business and asks `pk`, which the seats are inside;
the **side column** decides how wide the felt is and asks `fit`, which the felt
is inside. Getting these the wrong way round gives a rule that silently never
matches, so the test above pins it.

Delete the `@container (max-width: 560px)` rules that hide `.pk__seat .pk__cards`, `.pk__face`, `.pk__pile` and `.pk__pot-chips`. Keep `.pk__bet { display: none }` and `.pk__wager { display: block }` — the chip ring still does not fit across 375px, and the stake reads on the plate instead.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/web/src/poker`
Expected: PASS.

- [ ] **Step 5: See it at every size**

At 375×812, 375×667 and 375×560: ten seats, no overlaps, nothing off the sides, `scrollWidth === clientWidth`. At 768, 1100 and 1440: the oval, and the column appearing once past 1200. Sit two at a table and confirm the single opponent lands at the top on a phone.

- [ ] **Step 6: Commit**

```bash
biome format --write apps/web/src/poker
git add -A apps/web/src/poker
git commit -m "feat(web): a horseshoe on a phone, the oval at a desk, one markup"
```

---

## Task 8: The readout

**Files:**
- Create: `apps/web/src/poker/Readout.tsx`, `apps/web/src/poker/Readout.test.tsx`
- Modify: `apps/web/src/poker/Poker.tsx`, `apps/web/src/poker/poker.css`

**Interfaces:**
- Produces:

```ts
export interface ReadoutModel {
  label: string;           // "To call", "Pot", "Waiting"
  figure: string;          // "200", "1,840"
  tone: "chips" | "plain";
  note: string;            // "Pot 1,840 · 4,120 left"
  endsAt: number | null;   // the turn clock along the top edge, null when nobody is on the clock
  turnMs: number;
}
export function readoutFor(args: { state: TableView; seatId: string | null }): ReadoutModel
export function Readout({ model }: { model: ReadoutModel }): JSX.Element
```

- [ ] **Step 1: Write the failing tests**

```tsx
describe("readoutFor", () => {
  it("names what this decision costs when it is yours", () => {
    const model = readoutFor({ state: dealtState({ toAct: "me", you: { toCall: 200 } }), seatId: "me" });
    expect(model).toMatchObject({ label: "To call", figure: "200", tone: "chips" });
  });

  it("says checking is free rather than saying zero", () => {
    const model = readoutFor({ state: dealtState({ toAct: "me", you: { toCall: 0 } }), seatId: "me" });
    expect(model.label).toBe("To check");
    expect(model.figure).toBe("Free");
  });

  it("says what the table is waiting for between hands", () => {
    const model = readoutFor({ state: waitingState({ seats: 1 }), seatId: "me" });
    expect(model.note).toMatch(/another player/i);
    expect(model.endsAt).toBeNull();
  });

  it("puts the clock on the readout only while somebody is on it", () => {
    expect(readoutFor({ state: dealtState({ toAct: "other", turnEndsAt: 9_000 }), seatId: "me" }).endsAt).toBe(9_000);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/src/poker/Readout.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

```tsx
/**
 * What this decision is worth, as one figure.
 *
 * A model rather than markup, so what the readout says can be asserted without
 * rendering a table — and so the one place that decides "free" against "200"
 * is the one place a test can reach.
 */
export function readoutFor({ state, seatId }: { state: TableView; seatId: string | null }): ReadoutModel {
  const me = state.seats.find((seat) => seat.id === seatId) ?? null;
  const yours = me !== null && state.toAct === me.id;
  const clock = state.toAct === null ? null : state.turnEndsAt;

  if (state.street === "waiting") {
    const enough = state.seats.filter((seat) => seat.stack > 0).length >= 2;
    return {
      label: "Waiting",
      figure: fmt(state.pot),
      tone: "plain",
      // A table that cannot find a second real player does not deal, and says so.
      note: enough ? "Next hand shortly." : "Waiting for another player.",
      endsAt: null,
      turnMs: state.turnMs,
    };
  }

  if (yours && state.you !== null) {
    const free = state.you.toCall === 0;
    return {
      label: free ? "To check" : "To call",
      // Nought is a number, and a number reads as a price. Checking has none.
      figure: free ? "Free" : fmt(state.you.toCall),
      tone: free ? "plain" : "chips",
      note: `Pot ${fmt(state.pot)} · ${fmt(me.stack)} left`,
      endsAt: clock,
      turnMs: state.turnMs,
    };
  }

  return {
    label: "Pot",
    figure: fmt(state.pot),
    tone: "chips",
    note: state.lastEvent ?? "Waiting for the others.",
    endsAt: clock,
    turnMs: state.turnMs,
  };
}
```

`Readout` renders the model as a `.readout` fitting in the `read` grid area, with the clock as a bar draining along its top edge. Reuse `TurnRing`'s deadline arithmetic rather than writing a second clock. Render it from `Poker.tsx` above the felt.

- [ ] **Step 4: Run, see, commit**

```bash
npx vitest run apps/web/src/poker
biome format --write apps/web/src/poker
git add -A apps/web/src/poker
git commit -m "feat(web): poker says what this decision is worth"
```

---

## Task 9: The controls, from the fittings

**Files:**
- Modify: `apps/web/src/poker/Controls.tsx`, `apps/web/src/poker/Amount.tsx`, `apps/web/src/poker/poker.css`
- Test: `apps/web/src/poker/Controls.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("lights exactly one action", () => {
  renderControls(onYourTurn({ toCall: 200 }));
  expect(document.querySelectorAll(".slab")).toHaveLength(1);
  expect(screen.getByRole("button", { name: /call 200/i })).toHaveClass("slab");
});

it("lights check when checking is free", () => {
  renderControls(onYourTurn({ toCall: 0 }));
  expect(screen.getByRole("button", { name: /^check$/i })).toHaveClass("slab");
});

it("goes busy on the press rather than dead", () => {
  renderControls(onYourTurn({ toCall: 200, busy: true }));
  const call = screen.getByRole("button", { name: /call 200/i });
  expect(call).toHaveClass("is-busy");
  expect(call).not.toBeDisabled();
});

it("dresses the decide-in-advance group as lamps", () => {
  renderControls(somebodyElseDeciding());
  expect(document.querySelectorAll(".lamp").length).toBeGreaterThan(0);
  expect(document.querySelectorAll(".pk__prebtn")).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/src/poker/Controls.test.tsx`
Expected: FAIL — bespoke classes, two lit buttons.

- [ ] **Step 3: Move them over**

`pk__act` → `.slab` for the lit one and `.key` for the rest; `pk__prebtn` → `.lamp` inside `.lamps`; `pk__step` and `pk__slice` → `.key`. Keep the figure on the key it is about. Delete the bespoke rules from `poker.css` as each one goes — a rule left behind is a rule that will be used again by accident.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run apps/web/src/poker
biome format --write apps/web/src/poker
git add -A apps/web/src/poker
git commit -m "feat(web): poker's controls are the building's fittings"
```

---

## Task 10: A raise you can type

**Files:**
- Modify: `apps/web/src/poker/Amount.tsx`, `apps/web/src/poker/poker.css`
- Test: `apps/web/src/poker/Amount.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows what is typed as it is typed", async () => {
  renderAmount({ minRaiseTo: 200, maxRaiseTo: 4_000 });
  await user.clear(screen.getByLabelText(/how much/i));
  await user.type(screen.getByLabelText(/how much/i), "750");
  expect(screen.getByLabelText(/how much/i)).toHaveValue("750");
});

it("holds a typed figure over the cap to the cap, on commit", async () => {
  const onAct = vi.fn();
  renderAmount({ minRaiseTo: 200, maxRaiseTo: 4_000, onAct });
  await user.clear(screen.getByLabelText(/how much/i));
  await user.type(screen.getByLabelText(/how much/i), "99999{Enter}");
  expect(screen.getByLabelText(/how much/i)).toHaveValue("4,000");
});

it("keeps what was there when nothing is typed", async () => {
  renderAmount({ minRaiseTo: 200, maxRaiseTo: 4_000 });
  const box = screen.getByLabelText(/how much/i);
  await user.clear(box);
  fireEvent.blur(box);
  expect(box).toHaveValue("200");
});

it("never sends on a keystroke", async () => {
  const onAct = vi.fn();
  renderAmount({ minRaiseTo: 200, maxRaiseTo: 4_000, onAct });
  await user.type(screen.getByLabelText(/how much/i), "7");
  // The figure is the player's, so it moves at once; the chips are the table's.
  expect(onAct).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run apps/web/src/poker/Amount.test.tsx`, FAIL: no such box.

- [ ] **Step 3: Add the box**

A `.well` input beside the dial, labelled "How much to bet" / "How much to raise to" to match the slider's existing label. Shown as typed; committed on Enter or blur; clamped to `[minRaiseTo, maxRaiseTo]` on commit, not on keystroke; empty on commit keeps the last value. The slider keeps `--at` and its 300ms rest. The cap is a courtesy — the server still validates and still refuses (`S3`).

- [ ] **Step 4: Run and commit**

```bash
npx vitest run apps/web/src/poker
biome format --write apps/web/src/poker
git add -A apps/web/src/poker
git commit -m "feat(web): a raise you can type, held to the cap the server will enforce anyway"
```

---

## Task 11: Keys

**Files:**
- Modify: `apps/web/src/poker/Poker.tsx` (the ref and the hook), `apps/web/src/poker/Controls.tsx` (the `aria-keyshortcuts` attributes)
- Test: `apps/web/src/poker/Controls.test.tsx`

**Interfaces:**
- Consumes: `useTableKeys` (Task 3).

- [ ] **Step 1: Write the failing tests**

```tsx
const POKER_KEYS = { shortcuts: { " ": "Space", f: "F", r: "R" } };

it("Space presses the lit action", () => {
  renderTable(onYourTurn({ toCall: 200 }));
  fireEvent.keyDown(window, { key: " " });
  expect(sent).toEqual([{ type: "call" }]);
});

it("F folds and R raises to what the amount shows", () => {
  renderTable(onYourTurn({ toCall: 200, at: 600 }));
  fireEvent.keyDown(window, { key: "r" });
  expect(sent).toEqual([{ type: "raise", amount: 600 }]);
  fireEvent.keyDown(window, { key: "f" });
  expect(sent).toContainEqual({ type: "fold" });
});

it("does nothing while typing a raise", () => {
  renderTable(onYourTurn({ toCall: 200 }));
  screen.getByLabelText(/how much/i).focus();
  fireEvent.keyDown(screen.getByLabelText(/how much/i), { key: "f" });
  expect(sent).toEqual([]);
});

it("does nothing when the button it stands for could not be pressed", () => {
  renderTable(somebodyElseDeciding());
  fireEvent.keyDown(window, { key: " " });
  expect(sent).toEqual([]);
});

it("does nothing with a modifier held or on a repeat", () => {
  renderTable(onYourTurn({ toCall: 200 }));
  fireEvent.keyDown(window, { key: " ", ctrlKey: true });
  fireEvent.keyDown(window, { key: " ", repeat: true });
  expect(sent).toEqual([]);
});
```

- [ ] **Step 2: Run to verify they fail** — FAIL: nothing is bound.

- [ ] **Step 3: Bind them**

`aria-keyshortcuts="Space"` on the lit slab, `"F"` on Fold, `"R"` on the raise. A module-level `POKER_KEYS` const, a ref on the table root, `useTableKeys(root, POKER_KEYS)`. Pass no `holds` — poker has no piece you click and then press Space at, and typing is already excluded by `K3`.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run apps/web/src/poker
biome format --write apps/web/src/poker
git add -A apps/web/src/poker
git commit -m "feat(web): space checks or calls, F folds, R raises"
```

---

## Task 12: The rules sheet and the host's table sheet

**Files:**
- Create: `apps/web/src/poker/PokerSheet.tsx`
- Modify: `apps/web/src/poker/Felt.tsx`, `apps/web/src/poker/Poker.tsx`, `apps/web/src/poker/Rankings.tsx`, `apps/web/src/poker/poker.css`
- Test: `apps/web/src/poker/Poker.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("offers the host the table behind a key, and nobody else", () => {
  renderTable(dealtState({ hostId: "me" }), { seatId: "me" });
  expect(screen.getByRole("button", { name: /^table$/i })).toBeInTheDocument();
  expect(document.querySelector(".pk__bots")).toBeNull();
});

it("shows no table key to somebody who is not the host", () => {
  renderTable(dealtState({ hostId: "other" }), { seatId: "me" });
  expect(screen.queryByRole("button", { name: /^table$/i })).toBeNull();
});

it("offers bots only where the server would allow them", () => {
  renderTable(dealtState({ hostId: "me", forFun: false }), { seatId: "me" });
  fireEvent.click(screen.getByRole("button", { name: /^table$/i }));
  expect(screen.queryByRole("button", { name: /easy/i })).toBeNull();
});

it("puts what beats what behind the question key", () => {
  renderTable(dealtState());
  fireEvent.click(screen.getByRole("button", { name: /what beats what/i }));
  expect(screen.getByRole("dialog", { name: /what beats what/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail** — FAIL: `pk__bots` row still on the felt, `pk__helpbtn` is not a `key`.

- [ ] **Step 3: Build them**

`PokerSheet` renders into the shared `Sheet` (`sheet--page`): seats taken of the maximum, the listed switch (`table.setListed`), and the three bot buttons **only** when `state.forFun`. `Rankings` renders into a `Sheet` (`sheet--felt`) behind the `?` key, and as a side-column panel past 1200px. Both keys are `.key .key--icon` in the felt's corners: `?` top-left, the table key beside it, talk top-right. Delete `.pk__helpbtn` and `.pk__bots` and their rules.

Opening one closes the other and closes talk — three dialogs must not stack scrims.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run apps/web/src/poker
biome format --write apps/web/src/poker
git add -A apps/web/src/poker
git commit -m "feat(web): the rules and the host's table, behind keys on the felt"
```

---

## Task 13: Taunts

The picker needs to know who can be thrown at, and poker's seat does not say yet.

**Files:**
- Modify: `games/poker/src/table.ts`, `games/poker/src/table.test.ts`, `apps/web/src/poker/Controls.tsx`, `apps/web/src/poker/Poker.tsx`

**Interfaces:**
- Produces: `SeatView.signedIn: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
it("says which seats are somebody with an account", () => {
  // A bot is not a real person and a guest has no account, so neither can be
  // either end of a stake — the server says so, and the view has to as well.
  const table = seated(2, { guest: true });
  expect(table.view().seats.map((seat) => seat.signedIn)).toEqual([true, false]);
});
```

Use whatever the suite already uses to seat a signed-in player and a guest; if
it has no guest helper, seat one with a null `userId` the way the escrow tests
do. Do not add a second seating helper beside the one that exists.

- [ ] **Step 2: Run to verify it fails** — FAIL: `signedIn` is `undefined`.

- [ ] **Step 3: Add it**

`signedIn: seat.userId !== null` in `view()`, `signedIn: boolean` on `SeatView`, mirroring `games/blackjack/src/table.ts:1087`.

- [ ] **Step 4: Hang the picker in the controls**

`Actions` is `({ table, state, me, intent })` as Task 4 left it and has no
account to spend from. Thread `account: Account` in as a fifth prop from
`Poker.tsx`, which already holds it — do not call `useAccount()` a second time
inside the controls, or the corner balance and the picker's balance become two
numbers that can disagree.

In the "somebody else is deciding" branch, on the right:

```tsx
<TauntPicker
  seats={state.seats}
  seatId={seatId}
  chips={account.profile?.chips ?? null}
  stakes={table.stakes}
  openClassName="key"
  onThrow={(emote, at) => {
    // The cost is this player's own number, so it leaves the corner on the press.
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
```

and `<TauntStage landed={table.landed} />` over the felt in `Poker.tsx`.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run games/poker apps/web/src/poker
biome format --write apps/web/src/poker games/poker/src/table.ts
git add -A games/poker apps/web/src/poker
git commit -m "feat(web): something to throw while somebody else decides"
```

---

## Task 14: The mockup, and the pass by hand

**Files:**
- Modify: `apps/web/src/style/PokerMockup.tsx`

- [ ] **Step 1: Bring the mockup back into step**

`/style` draws the real table from the real stylesheet, and that is the only reason it is worth having. Update it for the new markup — `--seat`/`--of`, the fittings, the readout — and give it a control that shows the horseshoe as well as the oval, so the phone arrangement can be looked at without a phone.

- [ ] **Step 2: Run everything**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: all clean. Nothing else counts as done.

- [ ] **Step 3: The L8 pass, by hand**

At 375×560, 375×667, 375×812, 768×1024 and a desk, signed in, at a ten-handed table:

- `document.documentElement.scrollWidth === document.documentElement.clientWidth`;
- Fold, the lit action and the raise are all visible without scrolling;
- ten seats with no overlap, and nothing hanging off the sides;
- talk opens and stops short of the controls; the activity tab is there;
- a refusal takes the middle of the cloth and the cloth blurs behind it;
- with the connection throttled, a press goes down at once, a card arrives face down and turns over when the answer lands;
- with reduced motion on, every one of those still says what happened.

- [ ] **Step 4: Commit**

```bash
biome format --write apps/web/src/style/PokerMockup.tsx
git add -A apps/web/src
git commit -m "feat(web): the style gallery draws the table as it is now"
```

---

## Self-review notes

- **Spec coverage.** `eventSeq` → T1. Shared moves → T2, T3. File split → T4. Talk/activity/refusal (C, A, N) → T5. Layout L1–L4 → T6. L5 arrangements and the dropped 580px floor → T7. Readout T2 → T8. Controls F1–F5 → T9. Typed figure S2 → T10. Keys K2–K4 → T11. Rules T3 and host tools → T12. Taunts K5 → T13. Mockup, L6/L8 and the clean-build gate → T14.
- **Not covered by a task, deliberately:** `N6` (a limit the client can see, said in place) is already met — the raise control clamps to `maxRaiseTo` and always has. If T10 shows otherwise, it is a bug fix and gets a test watched failing first.
- **Ordering constraint:** T5 must precede T6 — the felt cannot take the window until chat has left the page. T1 must precede T5. T3 must precede T11. T2 must precede T12.
