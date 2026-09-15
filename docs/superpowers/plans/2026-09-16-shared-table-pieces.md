# Shared table pieces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Do section 12 of the table requirements once, with Greed moved onto the result and unchanged to look at, so Blackjack (PR 2) and every later table can use it.

**Architecture:** `useTableSocket` counts refusals the way Greed's `useRoom` already does, and every optimistic-move hook clears on that count. Talk, activity, refusal and stake components move from `apps/web/src/game/` to `apps/web/src/table/`, with their shared styles split out of `greed.css` into `table/table.css`. A `.play--fit` page class replaces `.play--greed`'s one-screen rules.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library (jsdom), plain CSS with container queries, Biome.

**Spec:** `docs/superpowers/specs/2026-09-16-blackjack-table-design.md` (PR 1 section), under `docs/superpowers/specs/2026-09-16-table-requirements.md`.

## Global Constraints

- `CLAUDE.md` applies: every bug fix gets a test watched failing first; comments say why, not what.
- `npm test`, `npm run typecheck`, `npm run lint` all clean at the end.
- Format with `npx biome format --write <paths>` on touched TS/TSX files only. **Never** `biome check --write`. Biome's formatter is off for CSS: keep sheets tidy by hand.
- Before adding to any stylesheet, `grep` that something imports it.
- Greed must look and behave exactly as before. No visual change is in scope.
- Run a single test file with: `npx vitest run <path>` from the worktree root.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **One deviation from the spec, deliberate:** the `useIntent` hooks take `errorKey` *alongside* `error`, not in place of it. A test for a key-only signature would pass against the old code (a number is "not null"), so it could never be watched failing. Keeping both lets the failing test use the same words twice with a new key.

---

## File map

| File | Change |
|---|---|
| `apps/web/src/table/useTableSocket.ts` | `errorKey`, `refuse()`, clear keyed on both |
| `apps/web/src/table/useTableSocket.test.ts` | refusal counting tests |
| `apps/web/src/blackjack/useIntent.ts` (+ test) | `errorKey` param |
| `apps/web/src/poker/useIntent.ts` | `errorKey` param |
| `apps/web/src/poker/useIntent.test.ts` | **new** |
| `apps/web/src/deathroll/useIntent.ts` (+ test) | `errorKey` param |
| `apps/web/src/twoup/TwoUp.tsx` (+ test) | effects keyed on `errorKey` |
| `apps/web/src/{blackjack/Blackjack,poker/Poker,deathroll/DeathRoll}.tsx` | pass `table.errorKey` |
| `apps/web/src/game/{TalkSheet,Activity,Refusal,Stake}.tsx` (+ tests) | **move** to `apps/web/src/table/` |
| `apps/web/src/table/Activity.tsx` | `useActivity(source)` |
| `apps/web/src/table/table.css` | **new**: shared rules out of `greed.css` |
| `apps/web/src/table/table.css.test.ts` | **new** |
| `apps/web/src/game/greed.css` (+ test) | shared rules removed |
| `apps/web/src/game/Play.tsx`, `Table.tsx`, `ScoreCard.tsx` | new imports, `play--fit`, corner and scroll classes |

---

### Task 1: `useTableSocket` counts every refusal

**Files:**
- Modify: `apps/web/src/table/useTableSocket.ts`
- Test: `apps/web/src/table/useTableSocket.test.ts`

**Interfaces:**
- Produces: `TableSocketHook<TView>.errorKey: number` — 0 until the first refusal, +1 on every refusal (`room:error`, a refused create/join/watch ack, a refused taunt). Not bumped by `room:closed`.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe` in `apps/web/src/table/useTableSocket.test.ts`. Also change the `vitest` import to include `afterEach`:

```ts
  it("counts the same refusal twice as two refusals", async () => {
    /*
     * React will not re-render for a string it already has, so a table that
     * says the same no twice would otherwise say it once and then go quiet.
     */
    const { result } = renderHook(() => useTableSocket("blackjack", () => {}));
    handlers.get("room:error")?.("Last call — you can only take chips back now.");
    await waitFor(() => expect(result.current.errorKey).toBe(1));
    handlers.get("room:error")?.("Last call — you can only take chips back now.");
    await waitFor(() => expect(result.current.errorKey).toBe(2));
    expect(result.current.error).toBe("Last call — you can only take chips back now.");
  });

  it("counts a refused join as a refusal", async () => {
    const { result } = renderHook(() => useTableSocket("blackjack", () => {}));
    result.current.join("Ada", "ABCDE");
    const call = fake.emit.mock.calls.find((args) => args[0] === "lobby:join");
    const ack = call?.[2] as (result: { ok: false; error: string }) => void;
    ack({ ok: false, error: "No table with that code." });
    await waitFor(() => expect(result.current.errorKey).toBe(1));
  });

  it("does not count a closed table as a refusal", async () => {
    // A notice, not a no: the player lands on a page that shows it as a strip.
    const { result } = renderHook(() => useTableSocket("blackjack", () => {}));
    handlers.get("room:state")?.({ game: "blackjack", code: "ABCDE", listed: true, taunts: [], seats: [] });
    await waitFor(() => expect(result.current.state).not.toBeNull());
    handlers.get("room:closed")?.({ code: "ABCDE", reason: "empty" });
    await waitFor(() => expect(result.current.error).toMatch(/closed/i));
    expect(result.current.errorKey).toBe(0);
  });

  it("gives a repeated refusal its own four seconds", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTableSocket("blackjack", () => {}));
    act(() => handlers.get("room:error")?.("Not your turn."));
    act(() => vi.advanceTimersByTime(3_000));
    act(() => handlers.get("room:error")?.("Not your turn."));
    act(() => vi.advanceTimersByTime(3_000));
    // Six seconds after the first, three after the second: still showing.
    expect(result.current.error).toBe("Not your turn.");
    act(() => vi.advanceTimersByTime(1_100));
    expect(result.current.error).toBeNull();
  });
```

Change the testing-library import to `import { act, renderHook, waitFor } from "@testing-library/react";`, and add to the top-level `describe`:

```ts
  afterEach(() => {
    vi.useRealTimers();
    fake.emit.mockClear();
  });
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run apps/web/src/table/useTableSocket.test.ts`
Expected: the three `errorKey` tests FAIL (`expected undefined to be 1` / `to be 0`), and "gives a repeated refusal its own four seconds" FAILS (error is null after 6s).

- [ ] **Step 3: Implement**

In `apps/web/src/table/useTableSocket.ts`:

Add to `TableSocketHook<TView>` after `error: string | null;`:

```ts
  /** Moves on for every refusal, so the same words twice are still shown twice. */
  errorKey: number;
```

After the `useState` for `error`, add:

```ts
  /*
   * Counted, not just stored: React will not re-render for a string it already
   * has, so a table saying the same no twice would otherwise say it once.
   */
  const [errorKey, setErrorKey] = useState(0);
  /** The table or the server saying no to something this player did. */
  const refuse = useCallback((message: string) => {
    setError(message);
    setErrorKey((key) => key + 1);
  }, []);
```

Replace `socket.on("room:error", (message: string) => setError(message));` with:

```ts
    socket.on("room:error", (message: string) => refuse(message));
```

Change the socket effect's dependency list from `[game]` to `[game, refuse]`. `refuse` is stable, so the socket is still only made once per game.

Leave `room:closed`'s `setError(...)` exactly as it is.

In `create`, `join` and `watch`, replace `setError(result.error);` with `refuse(result.error);`, and add `refuse` to each `useCallback` dependency list (`[game, refuse]`).

In `taunt`, replace `setError(result.error);` with `refuse(result.error);` and its dependency list `[]` with `[refuse]`.

Replace the clear effect with:

```ts
  // Complaints clear themselves rather than stacking up. Keyed on the refusal as
  // well as the words, so a second identical refusal gets its full four seconds
  // instead of vanishing on the first one's clock.
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (error === null) {
      return;
    }
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error, errorKey]);
```

Add `errorKey,` after `error,` in the returned object.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run apps/web/src/table/useTableSocket.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
npx biome format --write apps/web/src/table/useTableSocket.ts apps/web/src/table/useTableSocket.test.ts
git add apps/web/src/table/useTableSocket.ts apps/web/src/table/useTableSocket.test.ts
git commit -m "fix(web): count every refusal at a table, not every new sentence

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Pending moves give up on a repeated refusal

A pending move clears on `[error]` only, so a second refusal in the same words leaves it hanging until its patience runs out. Fixed in all four places.

**Files:**
- Modify: `apps/web/src/blackjack/useIntent.ts`, `apps/web/src/blackjack/useIntent.test.ts`, `apps/web/src/blackjack/Blackjack.tsx:163`
- Modify: `apps/web/src/poker/useIntent.ts`, `apps/web/src/poker/Poker.tsx:212`
- Create: `apps/web/src/poker/useIntent.test.ts`
- Modify: `apps/web/src/deathroll/useIntent.ts`, `apps/web/src/deathroll/useIntent.test.ts`, `apps/web/src/deathroll/DeathRoll.tsx:109`
- Modify: `apps/web/src/twoup/TwoUp.tsx:181-202`, `apps/web/src/twoup/TwoUp.test.tsx`

**Interfaces:**
- Consumes: `TableSocketHook.errorKey` (Task 1).
- Produces:
  - `blackjack useIntent(view, seatId, error: string | null, errorKey = 0): Intent`
  - `poker useIntent(view, seatId, error: string | null, errorKey = 0): Intent`
  - `deathroll useIntent(state, seatId, act, error: string | null, errorKey = 0): Intent`

- [ ] **Step 1: Write the failing tests**

Append to the `describe("a move, before the table has answered")` block in `apps/web/src/blackjack/useIntent.test.ts`:

```ts
  it("gives up on a move refused in the same words as the last refusal", () => {
    /*
     * The table said no, then this player tried again and it said no in the
     * same words. The words did not change, so only the count can say so.
     */
    const no = "You cannot cover that bet.";
    const { result, rerender } = renderHook(
      ({ key }: { key: number }) => useIntent(table(), "a", no, key),
      { initialProps: { key: 1 } },
    );
    act(() => result.current.send("double"));

    rerender({ key: 2 });

    expect(result.current.move).toBeNull();
  });
```

Create `apps/web/src/poker/useIntent.test.ts`:

```ts
// @vitest-environment jsdom
import type { TableView } from "@backroom/game-poker";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useIntent } from "./useIntent.js";

/** Only what the hook reads: whose turn it is. */
const view = (toAct: string | null) => ({ toAct }) as unknown as TableView;

describe("a poker move, before the table has answered", () => {
  it("gives up on a move the table refused", () => {
    const { result, rerender } = renderHook(
      ({ error }: { error: string | null }) => useIntent(view("a"), "a", error),
      { initialProps: { error: null as string | null } },
    );
    act(() => result.current.send("raise", 400));

    rerender({ error: "That raise is below the minimum." });

    expect(result.current.move).toBeNull();
  });

  it("gives up on a move refused in the same words as the last refusal", () => {
    const no = "That raise is below the minimum.";
    const { result, rerender } = renderHook(
      ({ key }: { key: number }) => useIntent(view("a"), "a", no, key),
      { initialProps: { key: 1 } },
    );
    act(() => result.current.send("raise", 400));
    expect(result.current.move).toBe("raise");

    rerender({ key: 2 });

    expect(result.current.move).toBeNull();
    expect(result.current.committed).toBeNull();
  });
});
```

Append to the `describe("pressing roll")` block in `apps/web/src/deathroll/useIntent.test.ts`:

```ts
  it("gives up on a roll refused in the same words as the last refusal", () => {
    const act_ = vi.fn();
    const { result, rerender } = renderHook(
      ({ key }: { key: number }) => useIntent(playing(), "ada", act_, "Not your roll.", key),
      { initialProps: { key: 1 } },
    );

    act(() => result.current.roll());
    expect(result.current.rolling).toBe(true);

    rerender({ key: 2 });
    expect(result.current.rolling).toBe(false);
  });
```

Append to `describe("the two-up felt")` in `apps/web/src/twoup/TwoUp.test.tsx`, directly after "gives up the optimistic chip when the table refuses it":

```ts
  it("gives up the optimistic chip when the table refuses it in the same words again", () => {
    const act = vi.fn();
    const no = "You do not have the chips for that.";
    const { container, rerender } = render(
      <Felt table={stub({ act, error: no, errorKey: 1 })} state={view()} seatId="s1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Heads" }));
    expect(container.querySelector(".tu__spot-mine")?.textContent).toBe("25");

    rerender(<Felt table={stub({ act, error: no, errorKey: 2 })} state={view()} seatId="s1" />);
    expect(container.querySelector(".tu__spot-mine")).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run apps/web/src/blackjack/useIntent.test.ts apps/web/src/poker/useIntent.test.ts apps/web/src/deathroll/useIntent.test.ts apps/web/src/twoup/TwoUp.test.tsx`
Expected: each new "same words" test FAILS (move / rolling / chip still shown). Poker's first test PASSES (it covers today's behaviour, since the hook had no test).

- [ ] **Step 3: Implement**

`apps/web/src/blackjack/useIntent.ts` — signature:

```ts
export function useIntent(
  view: TableView | null,
  seatId: string | null,
  error: string | null,
  /** Moves on for every refusal, including one in the same words as the last. */
  errorKey = 0,
): Intent {
```

and the refusal effect:

```ts
  // Keyed on the count as well as the words: a second refusal in the same
  // words is still a refusal, and would otherwise leave the move hanging.
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (error !== null) {
      setBet(null);
      setSent(null);
    }
  }, [error, errorKey]);
```

`apps/web/src/poker/useIntent.ts` — add the same `errorKey = 0` parameter after `error`, and:

```ts
  /** A refusal takes it back at once rather than waiting out the patience. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (error !== null) {
      setSent(null);
    }
  }, [error, errorKey]);
```

`apps/web/src/deathroll/useIntent.ts` — add `errorKey = 0,` after `error: string | null,` in the signature, put the same `biome-ignore` line directly above the refusal `useEffect` (keep its existing comment above that), and change its dependencies from `[error]` to `[error, errorKey]`.

`apps/web/src/twoup/TwoUp.tsx` — both refusal effects (the one clearing `setPending`/`setPendingCentre`/`setPendingCover`, and the one clearing `setSwung`) change their dependencies from `[table.error]` to `[table.error, table.errorKey]`, each with this line directly above `useEffect(`:

```ts
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
```

Callers:
- `apps/web/src/blackjack/Blackjack.tsx:163` → `const intent = useIntent(state, seatId, table.error, table.errorKey);`
- `apps/web/src/poker/Poker.tsx:212` → `const intent = useIntent(state, seatId, table.error, table.errorKey);`
- `apps/web/src/deathroll/DeathRoll.tsx:109` → `const intent = useIntent(state, seatId, table.act, table.error, table.errorKey);`

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run apps/web/src/blackjack apps/web/src/poker apps/web/src/deathroll apps/web/src/twoup`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
npx biome format --write apps/web/src/blackjack/useIntent.ts apps/web/src/blackjack/useIntent.test.ts apps/web/src/blackjack/Blackjack.tsx apps/web/src/poker/useIntent.ts apps/web/src/poker/useIntent.test.ts apps/web/src/poker/Poker.tsx apps/web/src/deathroll/useIntent.ts apps/web/src/deathroll/useIntent.test.ts apps/web/src/deathroll/DeathRoll.tsx apps/web/src/twoup/TwoUp.tsx apps/web/src/twoup/TwoUp.test.tsx
git add apps/web/src/blackjack apps/web/src/poker apps/web/src/deathroll apps/web/src/twoup
git commit -m "fix(web): a move refused twice in the same words is given up twice

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Talk, activity, refusal and stake move to `table/`

**Files:**
- Move: `apps/web/src/game/{TalkSheet,Activity,Refusal,Stake}.tsx` and `{TalkSheet,Activity,Refusal,Stake}.test.tsx` → `apps/web/src/table/`
- Modify: `apps/web/src/table/Activity.tsx`, `apps/web/src/table/Activity.test.tsx`, `apps/web/src/table/Refusal.tsx`, `apps/web/src/table/Refusal.test.tsx`, `apps/web/src/table/TalkSheet.tsx`, `apps/web/src/game/Play.tsx`

**Interfaces:**
- Produces, from `apps/web/src/table/`:
  - `TalkSheet.js`: `useTalk`, `TalkKey`, `TalkSheet`, `TalkPanel` (unchanged props)
  - `Refusal.js`: `Refusal({ message, id })` (unchanged)
  - `Stake.js`: `Stake`, `STAKE_SETTLE_MS` (unchanged; still takes Greed's `RoomView` until a second table needs it)
  - `Activity.js`:
    ```ts
    export interface ActivitySource { code: string; text: string | null; seq: number }
    export function useActivity(source: ActivitySource | null): ActivityEntry[]
    export function ActivityLog({ entries }: { entries: readonly ActivityEntry[] }): JSX.Element
    ```

- [ ] **Step 1: Move the files**

```bash
for name in TalkSheet Activity Refusal Stake; do
  git mv apps/web/src/game/$name.tsx apps/web/src/table/$name.tsx
  git mv apps/web/src/game/$name.test.tsx apps/web/src/table/$name.test.tsx
done
```

- [ ] **Step 2: Fix the relative imports**

- `apps/web/src/table/TalkSheet.tsx`: `import { Chat } from "./Chat.js";` → `import { Chat } from "../game/Chat.js";` (`../fittings/Seg.js` is unchanged).
- `apps/web/src/table/Refusal.tsx`: `import { play } from "./audio.js";` → `import { play } from "../game/audio.js";`
- `apps/web/src/table/Refusal.test.tsx`: both `"./audio.js"` (the import and the `vi.mock`) → `"../game/audio.js"`.
- `apps/web/src/table/Stake.tsx`: `../chips/Chip.js` is unchanged. Check for any other `./` import with `grep -n 'from "\./' apps/web/src/table/Stake.tsx` and point each at `../game/`.
- `apps/web/src/game/Play.tsx` lines 13, 15–17:

```ts
import { Stake } from "../table/Stake.js";
import { TalkKey, TalkPanel, TalkSheet, useTalk } from "../table/TalkSheet.js";
import { ActivityLog, useActivity } from "../table/Activity.js";
import { Refusal } from "../table/Refusal.js";
```

Run: `npx vitest run apps/web/src/table apps/web/src/game && npm run typecheck`
Expected: PASS — a pure move.

- [ ] **Step 3: Write the failing Activity tests against the new source shape**

Replace the top of `apps/web/src/table/Activity.test.tsx` (imports through `texts`) with:

```ts
// @vitest-environment jsdom
import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActivitySource } from "./Activity.js";
import { ActivityLog, useActivity } from "./Activity.js";

function room(code: string, text: string | null, seq = 0): ActivitySource {
  return { code, text, seq };
}

function log(initial: ActivitySource | null) {
  return renderHook(({ view }) => useActivity(view), { initialProps: { view: initial } });
}

const texts = (entries: ReturnType<typeof useActivity>) => entries.map((entry) => entry.text);
```

Add inside `describe("the activity log")`:

```ts
  it("forgets the log when the table goes", () => {
    const { result, rerender } = log(room("AAAAA", "Koda goes first"));
    rerender({ view: null });
    expect(result.current).toEqual([]);
  });
```

The remaining five `useActivity` tests keep their bodies. `room(...)` now builds the new shape.

Run: `npx vitest run apps/web/src/table/Activity.test.tsx`
Expected: FAIL. The old `useActivity` reads `room.lastEvent`, which the new shape does not have, so every line it keeps is `undefined` and the text assertions fail.

- [ ] **Step 4: Implement `useActivity(source)`**

In `apps/web/src/table/Activity.tsx`, remove `import type { RoomView } from "@backroom/shared";` and replace `useActivity` with:

```ts
/**
 * What a table says, as a log: which table, its latest line, and a counter that
 * moves on with every action it reports. The counter is what tells the same
 * words twice running ("Koda rolled 5") apart from one broadcast sent twice.
 */
export interface ActivitySource {
  code: string;
  text: string | null;
  seq: number;
}

/**
 * Everything the table has said happened, oldest first.
 *
 * The server only ever sends the latest line, so the history is kept here as
 * lines arrive. A line is new when its words change, or when the counter moves
 * on. The counter starting again (a new turn, at Greed) is not an action, so it
 * adds nothing. A different table is a different log.
 */
export function useActivity(source: ActivitySource | null): ActivityEntry[] {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const last = useRef<{ code: string; text: string | null; seq: number } | null>(null);
  const nextId = useRef(1);
  // Taken apart so a caller building a fresh object each render does not make
  // every render look like news.
  const code = source?.code ?? null;
  const text = source?.text ?? null;
  const seq = source?.seq ?? 0;

  useEffect(() => {
    if (code === null) {
      last.current = null;
      setEntries([]);
      return;
    }
    const prev = last.current;
    last.current = { code, text, seq };

    const sameTable = prev !== null && prev.code === code;
    if (!sameTable) {
      setEntries([]);
    }
    if (text === null) {
      return;
    }
    if (sameTable && prev.text === text && seq <= prev.seq) {
      return;
    }
    const entry = { id: nextId.current, at: Date.now(), text };
    nextId.current += 1;
    setEntries((list) => [...(sameTable ? list : []), entry].slice(-KEEP));
  }, [code, text, seq]);

  return entries;
}
```

In `apps/web/src/game/Play.tsx`, replace `const activity = useActivity(room);` with:

```ts
  // Kept from the first line the table says, so nothing is lost while talk is
  // shut. Greed's roll counter is what tells two identical throws apart.
  const activity = useActivity(
    room === null ? null : { code: room.code, text: room.lastEvent, seq: room.turn?.rollSeq ?? 0 },
  );
```

- [ ] **Step 5: Run the tests to watch them pass**

Run: `npx vitest run apps/web/src/table apps/web/src/game`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
npx biome format --write apps/web/src/table/TalkSheet.tsx apps/web/src/table/TalkSheet.test.tsx apps/web/src/table/Activity.tsx apps/web/src/table/Activity.test.tsx apps/web/src/table/Refusal.tsx apps/web/src/table/Refusal.test.tsx apps/web/src/table/Stake.tsx apps/web/src/table/Stake.test.tsx apps/web/src/game/Play.tsx
git add -A apps/web/src/table apps/web/src/game
git commit -m "refactor(web): talk, activity, refusal and stake belong to every table

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `table.css` and `.play--fit`

**Files:**
- Create: `apps/web/src/table/table.css`, `apps/web/src/table/table.css.test.ts`
- Modify: `apps/web/src/game/greed.css`, `apps/web/src/game/greed.css.test.ts`
- Modify: `apps/web/src/table/TalkSheet.tsx`, `apps/web/src/table/Activity.tsx`, `apps/web/src/table/Refusal.tsx` (import the sheet)
- Modify: `apps/web/src/game/Play.tsx:95`, `apps/web/src/game/Table.tsx:346`, `apps/web/src/game/ScoreCard.tsx:171`

**Interfaces:**
- Produces CSS classes every table can use:
  - `.play--fit`: the one-screen page, and the `fit` inline-size container;
  - `.table-talk-corner`: pins the talk key to a play area's top-left;
  - `.table-scroll`: the room's scrollbar on any scrolling box;
  - `.talk`, `.talk__*`, `.talk-panel`, `.talk-key`, `.talk-key__count`, `.activity`, `.activity__*`, `.talk__activity`, `.refusal`, `.refusal__*` (names unchanged).
- A play area that hosts the talk sheet or a refusal must be `position: relative`.

- [ ] **Step 1: Write the failing stylesheet tests**

Create `apps/web/src/table/table.css.test.ts`:

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
  return found === undefined ? "" : readFileSync(found, "utf8");
}

/*
 * Comments stripped: a comment above a rule would otherwise read as part of its
 * selector, and a comment naming a property would read as a declaration.
 */
const css = sheet("src/table/table.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule for exactly this selector, at any depth. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`^\\s*${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
}

/** The body of the first block opened by this at-rule prelude, braces balanced. */
function block(prelude: string): string {
  const start = css.indexOf(`${prelude} {`);
  if (start === -1) {
    return "";
  }
  let depth = 0;
  for (let at = css.indexOf("{", start); at < css.length; at += 1) {
    if (css[at] === "{") {
      depth += 1;
    } else if (css[at] === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(css.indexOf("{", start) + 1, at);
      }
    }
  }
  return "";
}

describe("a table on one screen", () => {
  /*
   * The page is the window, not at least the window: a table that grew to its
   * content would scroll its controls off a phone.
   */
  it("makes the shell exactly the window, with only the page's row flexing", () => {
    const shell = rule(".shell:has(> .play--fit)");
    expect(shell).toContain("height: 100dvh");
    expect(shell).toContain("grid-template-rows: auto minmax(0, 1fr)");
  });

  it("lets the page shrink to its row rather than push past it", () => {
    const page = rule(".play--fit");
    expect(page).toContain("display: flex");
    expect(page).toContain("flex-direction: column");
    expect(page).toContain("min-height: 0");
  });

  it("is the container the talk drawer asks about, at any table", () => {
    expect(rule(".play--fit")).toMatch(/container: fit \/ inline-size/);
    expect(css).toContain("@container fit (min-width: 760px)");
    expect(css).not.toContain("@container gt");
  });
});

describe("scrolling boxes at a table", () => {
  /*
   * Chrome lets scrollbar-width and scrollbar-color win over ::-webkit-scrollbar
   * and draws its system bar, arrows and all. The standard properties may only
   * appear where the drawn bar is not understood.
   */
  it("keeps the standard scrollbar properties to browsers without the drawn bar", () => {
    const guarded = block("@supports not selector(::-webkit-scrollbar)");
    expect(guarded).toContain("scrollbar-width: thin");
    expect(css.replace(guarded, "")).not.toMatch(/scrollbar-(width|color):/);
  });
});

describe("motion at a table", () => {
  it("switches off every animation it runs", () => {
    const reduced = block("@media (prefers-reduced-motion: reduce)");
    const outside = css.replace(reduced, "");
    const animated = [...outside.matchAll(/([^{}]+)\{[^{}]*\banimation(?:-name)?:/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0 && !selector.startsWith("@") && !/^(from|to|\d+%)$/.test(selector));
    expect(animated.length).toBeGreaterThan(0);
    for (const selector of animated) {
      expect(reduced, `${selector} has no off switch`).toContain(selector);
    }
  });
});
```

Append to `apps/web/src/game/greed.css.test.ts`:

```ts
describe("what greed.css leaves to the building", () => {
  /*
   * Talk, activity, refusals and the one-screen page are every table's, so they
   * live in table/table.css. A second copy here is a second thing to keep in
   * step, and the first one to drift.
   */
  it("carries no shared table rules of its own", () => {
    expect(css).not.toMatch(/^\.(talk|talk__scrim|activity|refusal|refusal__card) \{/m);
    expect(css).not.toContain("play--greed");
    expect(css).not.toMatch(/^:is\(\.activity/m);
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run apps/web/src/table/table.css.test.ts apps/web/src/game/greed.css.test.ts`
Expected: the `table.css` tests FAIL (the sheet is empty and missing), and "carries no shared table rules of its own" FAILS.

- [ ] **Step 3: Create `apps/web/src/table/table.css`**

Build the file in this order. Where a step says "move", cut the lines out of `apps/web/src/game/greed.css` verbatim (line numbers are as of commit `922e477`; locate by the section comment if they have shifted) and apply only the listed edits.

1. Header, written fresh:

```css
/*
 * What every table in the building has, whatever is played at it: the page
 * that is exactly the window, table talk, the activity log, a refusal over the
 * board, and the room's own scrollbars.
 *
 * Imported by TalkSheet.tsx, Activity.tsx and Refusal.tsx, which is what makes
 * it load. Every table page uses at least one of them.
 */
```

2. **Move** `greed.css` lines 14–62 ("the window", through `.play--greed > .play__error`). Replace every `.play--greed` with `.play--fit`. In the `.play--fit { … }` rule, add as its first two declarations:

```css
  /* The container the talk drawer asks about, whatever table is inside. */
  container: fit / inline-size;
```

3. **Move** `greed.css` lines 1002–1206 ("table talk", through `.talk-key__count`), with these edits:
   - `gt-fade` → `table-fade` (the `animation` and the `@keyframes` name);
   - `gt-talk-up` → `table-talk-up`, `gt-talk-in` → `table-talk-in`;
   - `@container gt (min-width: 760px)` → `@container fit (min-width: 760px)`;
   - `.gt__talk` → `.table-talk-corner` (both rules), and its comment → `/* The talk key, pinned to a play area's top-left corner. On the table rather than the bar: a phone's bar is already as full as a phone is wide, and a corner costs the table no row. */`;
   - in the comment above `.talk__scrim`, "stops short of the lanes, so the race stays in view" → "stops short of the scores, so the game stays in view".

4. **Move** `greed.css` lines 1235–1296 (`.activity` through `.talk__head .seg`), with `gt-line-in` → `table-line-in`. **Leave** the "the activity" section comment and `.gt__activity` (lines 1208–1233) in `greed.css`: they are Greed's grid.

5. **Move** `greed.css` lines 1298–1342 ("scrolling"). In every selector list, replace `.card` with `.table-scroll`, so each list reads `:is(.activity, .table-scroll, .talk .chat__log, .talk-panel .chat__log)`.

6. **Move** `greed.css` lines 1344–1414 ("a refusal"), with `gt-fade` → `table-fade` and `gt-refuse` → `table-refuse`.

7. Off switch, written fresh:

```css
/* ------------------------------------------------------------ off switch */

@media (prefers-reduced-motion: reduce) {
  .talk,
  .talk__scrim,
  .activity__line:last-child,
  .refusal__scrim,
  .refusal__card {
    animation: none;
    transition: none;
  }
}
```

In `greed.css`'s own `@media (prefers-reduced-motion: reduce)` block, delete the five lines `.talk,` through `.refusal__card` so the list ends at `.die--greed {`.

- [ ] **Step 4: Load the sheet and switch Greed onto the shared classes**

Check nothing imports it yet, then add the imports:

```bash
grep -rn "table.css" apps/web/src --include=*.tsx --include=*.ts
```

Expected: only `table.css.test.ts`. Then add `import "./table.css";` as the last import in each of `apps/web/src/table/TalkSheet.tsx`, `apps/web/src/table/Activity.tsx` and `apps/web/src/table/Refusal.tsx`.

Replace the header comment's last paragraph in `greed.css` ("Imported by Table.tsx…") with:

```css
 * Imported by Table.tsx, which is what makes it load. What every table shares —
 * the page on one screen, talk, activity, refusals, scrollbars — is in
 * table/table.css.
```

- `apps/web/src/game/Play.tsx:95` → `<main className={`play${atTable ? " play--fit" : ""}`}>`
- `apps/web/src/game/Table.tsx:346` → `{talkKey !== undefined ? <div className="table-talk-corner">{talkKey}</div> : null}`
- `apps/web/src/game/ScoreCard.tsx:171` → `<dl className="card table-scroll" aria-label="What everything scores">`

Check nothing else still uses a removed name:

```bash
grep -rn "play--greed\|gt__talk\|gt-fade\|gt-talk\|gt-line-in\|gt-refuse\|@container gt.*talk" apps/web/src
```

Expected: no output.

- [ ] **Step 5: Run the tests to watch them pass**

Run: `npx vitest run apps/web/src/table apps/web/src/game apps/web/src/nav`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
npx biome format --write apps/web/src/table/table.css.test.ts apps/web/src/table/TalkSheet.tsx apps/web/src/table/Activity.tsx apps/web/src/table/Refusal.tsx apps/web/src/game/greed.css.test.ts apps/web/src/game/Play.tsx apps/web/src/game/Table.tsx apps/web/src/game/ScoreCard.tsx
git add apps/web/src/table apps/web/src/game
git commit -m "refactor(web): what every table wears, out of greed.css

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Verify Greed is unchanged, and open the PR

**Files:** none changed unless a check fails. A fix then gets its own failing test first.

- [ ] **Step 1: The whole suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean. Some test fakes of `TableSocketHook` are typed (`apps/web/src/poker/Poker.test.tsx` `stub()`). If typecheck flags a missing `errorKey`, add `errorKey: 0,` after `error: null,` in that fake.

- [ ] **Step 2: Greed by hand**

- Copy the main checkout's `.env` into the worktree if it is missing.
- Start the dev server through the Browser pane: `preview_start` with the project's launch config, or create `.claude/launch.json` for `npm run dev`.
- Open a Greed table (practise alone) and check each of these at 375×667 and at a desk (1280×800):
  - `document.documentElement.scrollWidth === document.documentElement.clientWidth`;
  - Roll is visible without scrolling;
  - the talk key sits in the felt's top-left, and opens a sheet from the bottom on a phone and a drawer from the right at a desk;
  - the Activity tab lists lines;
  - a refused action (press Bank with an invalid pick through the console: `document.querySelector('.key[aria-keyshortcuts="B"]')?.removeAttribute('disabled')`, then click it) blurs the felt and shows the card;
  - the score card and activity log scroll with the room's bar, not the system one.
- Take a screenshot at each size for the PR.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin HEAD
gh pr create --base master --title "Shared table pieces: refusal counting, talk, activity, refusal, one screen" --body "$(cat <<'EOF'
Section 12 of docs/superpowers/specs/2026-09-16-table-requirements.md, done once so every table can move onto it. Greed moves onto it and looks the same.

- **N3:** `useTableSocket` exposes `errorKey`, bumped on every refusal. `room:closed` does not bump it (N4).
- **Pending moves:** Blackjack's, Poker's and Death Roll's `useIntent`, and Two-Up's felt, now give up on a second refusal in the same words. Each fix has a test watched failing first.
- **Shared components:** `TalkSheet`, `Activity`, `Refusal` and `Stake` move to `apps/web/src/table/`. `useActivity` takes `{ code, text, seq }` (A4).
- **Shared styles:** `table/table.css` holds talk, activity, refusal, scrollbars (M2) and their reduced-motion block (M1).
- **L1, L7:** `.play--fit` replaces `.play--greed`.

Design: docs/superpowers/specs/2026-09-16-blackjack-table-design.md (PR 1).

Checked by hand: Greed at 375×667 and at a desk — no sideways scroll, Roll in view, talk sheet and drawer, activity tab, refusal overlay, scrollbars.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
