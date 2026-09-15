# Table Void Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any table can be called off with every committed chip returned to the account it came from, taunt pools returned, bank reservations released, and clients told with `room:closed`; used by the empty-room reaper and server shutdown.

**Architecture:** A synchronous per-table `Escrow` (packages/core) records chips that left an account for the current round. Tables hold into it where they land chips; adapters drain its leave-refund queue in `payOut` and empty it in a new `GameAdapter.void`. The server gains `closeTable(code, reason)` which stops timers, finishes any decided round, voids, returns taunt pools, emits `room:closed` and deletes the room.

**Tech Stack:** TypeScript monorepo (npm workspaces), vitest, socket.io, React. Biome for formatting.

**Spec:** `docs/superpowers/specs/2026-09-14-table-void-design.md` — read the "Revisions made while planning" section; it overrides the sections below it.

## Global Constraints

- Read `CLAUDE.md` before starting. Money rules there are absolute: the server is the only authority, play money never touches an account, waiting never costs anybody a stake.
- Every bug fix / refund gets a test that has been **watched failing** without the refund. Each task below says how.
- Comments say why, not what. Match the surrounding comment style (full sentences, explain the hazard).
- Play-money (`forFun`, or greed `buyIn === 0`) tables and guest seats (`userId === null`) never write to an escrow.
- A refused `bank.take` during a refund is logged with `console.error` naming the game, table code, chips and user, and is never paid from anywhere else.
- Run a single package's tests with `npx vitest run <path>` from the repo root.
- After each task: `npx biome format --write <files you touched>` (never `biome check --write`). At the end `npm test`, `npm run typecheck`, `npm run lint` must all be clean.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: `Escrow` in core

**Files:**
- Create: `packages/core/src/escrow.ts`
- Create: `packages/core/src/escrow.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces (exported from `@backroom/core`):
  ```ts
  export interface Stake { userId: string; chips: number }
  export class Escrow {
    hold(userId: string, chips: number): boolean;
    release(userId: string, chips: number): void;
    refund(userId: string, chips?: number): void;
    takeDue(): Stake[];
    get due(): readonly Stake[];
    heldBy(userId: string): number;
    get total(): number;
    settle(): Stake[];
    close(): Stake[];
    get closed(): boolean;
  }
  ```

- [ ] **Step 1: Write the failing test** — `packages/core/src/escrow.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { Escrow } from "./escrow.js";

describe("what a table is holding for the people at it", () => {
  it("adds up what each account has put down", () => {
    const escrow = new Escrow();
    expect(escrow.hold("u1", 100)).toBe(true);
    escrow.hold("u1", 50);
    escrow.hold("u2", 20);
    expect(escrow.heldBy("u1")).toBe(150);
    expect(escrow.total).toBe(170);
  });

  it("lets chips that went back by an ordinary route come off", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 100);
    escrow.release("u1", 40);
    expect(escrow.heldBy("u1")).toBe(60);
    escrow.release("u1", 60);
    expect(escrow.heldBy("u1")).toBe(0);
    expect(escrow.total).toBe(0);
  });

  it("queues a leaver's chips rather than paying them, because a seat cannot await", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 100);
    escrow.hold("u2", 30);
    escrow.refund("u1");
    expect(escrow.heldBy("u1")).toBe(0);
    expect(escrow.due).toEqual([{ userId: "u1", chips: 100 }]);
    expect(escrow.takeDue()).toEqual([{ userId: "u1", chips: 100 }]);
    expect(escrow.due).toEqual([]);
    expect(escrow.total).toBe(30);
  });

  it("queues only part of an account when told how much", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 100);
    escrow.refund("u1", 70);
    expect(escrow.heldBy("u1")).toBe(30);
    expect(escrow.takeDue()).toEqual([{ userId: "u1", chips: 70 }]);
  });

  it("never queues more than an account holds", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 10);
    escrow.refund("u1", 500);
    escrow.refund("u2");
    expect(escrow.takeDue()).toEqual([{ userId: "u1", chips: 10 }]);
  });

  it("hands the round's stakes over once it is decided", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 100);
    escrow.hold("u2", 50);
    expect(escrow.settle()).toEqual([
      { userId: "u1", chips: 100 },
      { userId: "u2", chips: 50 },
    ]);
    expect(escrow.total).toBe(0);
    expect(escrow.hold("u1", 10)).toBe(true);
  });

  it("gives up everything on closing, the queue included, and refuses what arrives later", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 100);
    escrow.hold("u2", 50);
    escrow.refund("u2");
    const owed = escrow.close();
    expect(owed).toEqual([
      { userId: "u2", chips: 50 },
      { userId: "u1", chips: 100 },
    ]);
    expect(escrow.closed).toBe(true);
    expect(escrow.total).toBe(0);
    expect(escrow.due).toEqual([]);
    expect(escrow.hold("u1", 5)).toBe(false);
    expect(escrow.close()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/src/escrow.test.ts`
Expected: FAIL — cannot resolve `./escrow.js`.

- [ ] **Step 3: Implement** — `packages/core/src/escrow.ts`

```ts
/** Chips that left one account for this round, and have not come back or been decided. */
export interface Stake {
  userId: string;
  chips: number;
}

/**
 * What a table is holding for the people at it.
 *
 * Every chip here has already left an account, and until the round is decided
 * it still belongs to that account. That is the whole of why this exists: a
 * table that is called off, or a seat that goes while bets can still be
 * changed, has to be able to say whose chips are on the felt — and by then the
 * seat that put them there may be gone, which is why it is keyed by account.
 *
 * Nothing here is asynchronous, on purpose. A table can empty it before its
 * first await, which is what makes draining it on every broadcast exactly-once
 * rather than a way to pay somebody twice.
 *
 * Play money never comes here. A for-fun table's chips are the table's own and
 * die with it; putting them in an escrow would be one step from paying them
 * into an account.
 */
export class Escrow {
  private readonly held = new Map<string, number>();
  private queued: Stake[] = [];
  private shut = false;

  /** Whether the table has been called off, after which nothing more is held. */
  get closed(): boolean {
    return this.shut;
  }

  /** Everything held across every account. */
  get total(): number {
    let total = 0;
    for (const chips of this.held.values()) {
      total += chips;
    }
    return total;
  }

  /** What is waiting to be handed back, without taking it. */
  get due(): readonly Stake[] {
    return this.queued;
  }

  heldBy(userId: string): number {
    return this.held.get(userId) ?? 0;
  }

  /**
   * Records chips that have just been taken.
   *
   * False once the table is closed. The caller then gives back what it took:
   * the void has already paid out everything it knew about, and this stake
   * arrived too late to be part of it.
   */
  hold(userId: string, chips: number): boolean {
    if (this.shut) {
      return false;
    }
    if (chips > 0) {
      this.held.set(userId, this.heldBy(userId) + chips);
    }
    return true;
  }

  /** Chips that went back by an ordinary route: a lowered bet, a take-back, a refund. */
  release(userId: string, chips: number): void {
    const left = this.heldBy(userId) - chips;
    if (left > 0) {
      this.held.set(userId, left);
    } else {
      this.held.delete(userId);
    }
  }

  /**
   * Queues an account's chips to be handed back.
   *
   * A queue because the moment somebody leaves is a synchronous one — a seat
   * is removed without anybody to await the economy — so the chips are owed
   * here and paid on the table's next broadcast.
   */
  refund(userId: string, chips?: number): void {
    const has = this.heldBy(userId);
    const moving = Math.min(has, chips ?? has);
    if (moving <= 0) {
      return;
    }
    this.release(userId, moving);
    this.queued.push({ userId, chips: moving });
  }

  /** Empties the queue. Call before the first await. */
  takeDue(): Stake[] {
    return this.queued.splice(0);
  }

  /**
   * The round is decided, so its stakes now belong to the result.
   *
   * The queue is left alone: chips owed to a leaver are owed whatever the
   * round came to.
   */
  settle(): Stake[] {
    const stakes = [...this.held].map(([userId, chips]) => ({ userId, chips }));
    this.held.clear();
    return stakes;
  }

  /** Calls the table off: everything owed, queued or held, and nothing held again. */
  close(): Stake[] {
    this.shut = true;
    return [...this.takeDue(), ...this.settle()];
  }
}
```

In `packages/core/src/index.ts` add after the ledger export line:

```ts
export { Escrow } from "./escrow.js";
export type { Stake } from "./escrow.js";
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run packages/core/src/escrow.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Format and commit**

```bash
npx biome format --write packages/core/src/escrow.ts packages/core/src/escrow.test.ts packages/core/src/index.ts
git add packages/core/src/escrow.ts packages/core/src/escrow.test.ts packages/core/src/index.ts
git commit -m "feat(core): an escrow of the chips a round is holding"
```

---

### Task 2: Ledger release, taunt refund, optional `void` on the adapter

**Files:**
- Modify: `packages/core/src/ledger.ts`
- Modify: `packages/core/src/taunts.ts`
- Modify: `packages/core/src/game.ts`
- Test: `packages/core/src/ledger.test.ts` (create if absent), `packages/core/src/taunts.test.ts`

**Interfaces:**
- Consumes: `Stake` from Task 1.
- Produces:
  - `BankLedger.release(table: object): void`
  - `Taunts.refund(code: string): Taunt[]`
  - `GameAdapter.void?(table: T, deps: GameDeps): Promise<Stake[]>` — **optional in this task**; Task 9 makes it required once every game has it.

- [ ] **Step 1: Write failing tests**

`packages/core/src/ledger.test.ts` (create; if it exists, add the `describe`):

```ts
import { describe, expect, it } from "vitest";
import { BankLedger } from "./ledger.js";

describe("a table that has closed", () => {
  it("stops holding the bank's chips however much its cloth still says it owes", () => {
    const ledger = new BankLedger();
    const closed = {};
    const live = {};
    ledger.owes(closed, () => 500);
    expect(ledger.owedElsewhere(live)).toBe(500);
    ledger.release(closed);
    expect(ledger.owedElsewhere(live)).toBe(0);
  });
});
```

Append to `packages/core/src/taunts.test.ts` (reuse its existing taunt factory if it has one; otherwise build a `Taunt` literal with every field from `taunts.ts`):

```ts
describe("a table called off before anybody won", () => {
  it("hands every taunt back and empties the pool", () => {
    const taunts = new Taunts();
    const one = { id: "t1", emoteId: "e", chips: 40, fromSeatId: "a", fromUserId: "u1", fromName: "Ada", atSeatId: "b", atUserId: "u2", atName: "Bo", at: 0 };
    const two = { ...one, id: "t2", chips: 60 };
    taunts.add("ROOM1", one);
    taunts.add("ROOM1", two);
    expect(taunts.refund("ROOM1")).toEqual([one, two]);
    expect(taunts.at("ROOM1")).toEqual([]);
    expect(taunts.refund("ROOM1")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/core/src/ledger.test.ts packages/core/src/taunts.test.ts`
Expected: FAIL — `ledger.release is not a function`, `taunts.refund is not a function`.

- [ ] **Step 3: Implement**

`ledger.ts`, inside `BankLedger` after `owes`:

```ts
  /**
   * Takes a table out of the book for good.
   *
   * For a table that has been called off. Its cloth may still hold chips when
   * it goes — they have just been handed back, and the objects are not cleared
   * — and a promise read off that cloth would hold the bank's chips for a table
   * nobody will ever sit at again.
   */
  release(table: object): void {
    this.promises.delete(table);
  }
```

`taunts.ts`: add after `forget`:

```ts
  /**
   * Takes a table's pool away to be handed back to whoever threw each taunt.
   *
   * For a table called off before its hand reached a result. Nobody lost, so
   * nothing is burned: the taunt was staked on an outcome that never came.
   */
  refund(code: string): Taunt[] {
    const pool = this.pools.get(code) ?? [];
    this.pools.delete(code);
    return pool;
  }
```

Also rewrite the third bullet of the file header comment ("A taunt that is never collected is burned…") to: a taunt whose target loses is burned — you paid to mock somebody and it stayed paid — and a taunt at a table called off before the hand finished goes back to whoever threw it, because nobody lost. Update `forget`'s doc to say it is the old burn-on-close path kept for callers that want it (leave the method).

`game.ts`: import `import type { Stake } from "./escrow.js";` and add to `GameAdapter` after `payOut?`:

```ts
  /**
   * Calls off the hand in progress and gives back every chip committed to it.
   *
   * For a table that is closing — nobody left, the server stopping, an admin
   * closing it. The room settles a round that is already decided before it
   * calls this, so what is refunded here is only ever a round with no result:
   * void never rewrites an outcome. Every chip goes back to the account it
   * came from, through the bank it went into, and a banked table leaves the
   * bank's book.
   *
   * Returns what it refunded.
   */
  void?(table: T, deps: GameDeps): Promise<Stake[]>;
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run packages/core`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
npx biome format --write packages/core/src/ledger.ts packages/core/src/ledger.test.ts packages/core/src/taunts.ts packages/core/src/taunts.test.ts packages/core/src/game.ts
git add packages/core
git commit -m "feat(core): release a closed table from the book, hand back its taunts"
```

---

### Task 3: Greed

**Files:**
- Modify: `games/greed/src/room.ts` (add `readonly escrow = new Escrow()`; call `this.escrow.settle()` at the top of `private finish()`)
- Modify: `games/greed/src/adapter.ts` (`start` case, new `payOut`, new `void`)
- Test: `games/greed/src/adapter.test.ts`

**Interfaces:**
- Consumes: `Escrow`, `Stake` from `@backroom/core`; `GameAdapter.void?`.
- Produces: `Room.escrow: Escrow`; `greedAdapter().void`.

Greed has no bank and can't be left mid-game (`Room.removeSeat` does nothing unless `status === "lobby"`). So there's no leave rule to add. What is new: buy-ins are held, a player who left during the take loop gets their buy-in back, and a void refunds every buy-in.

- [ ] **Step 1: Write failing tests** — append to `games/greed/src/adapter.test.ts`

```ts
/** A store that keeps balances, so a refund can be seen rather than inferred. */
function wallet(start: Record<string, number>) {
  const held = { ...start };
  const deps: GameDeps = {
    take: async (userId, amount) => {
      if ((held[userId] ?? 0) < amount) return false;
      held[userId] = (held[userId] ?? 0) - amount;
      return true;
    },
    give: async (userId, amount) => {
      held[userId] = (held[userId] ?? 0) + amount;
    },
    record: async () => {},
    finished: async () => {},
  };
  return { held, deps };
}

describe("a Greed table called off mid-game", () => {
  it("hands every buy-in back to the account it came from", async () => {
    const adapter = greedAdapter({ roll: sixes });
    const room = adapter.create("TEST1") as Room;
    room.join("a", "Ada", who(1));
    room.join("b", "Bram", who(2));
    room.setBuyIn(500);
    const { held, deps } = wallet({ u1: 1_000, u2: 1_000 });

    await adapter.act(room, "a", { type: "start" }, deps);
    expect(held).toEqual({ u1: 500, u2: 500 });
    expect(room.escrow.total).toBe(1_000);

    const refunded = await adapter.void?.(room, deps);
    expect(held).toEqual({ u1: 1_000, u2: 1_000 });
    expect(refunded).toEqual([
      { userId: "u1", chips: 500 },
      { userId: "u2", chips: 500 },
    ]);
  });

  it("refunds nothing once the game is over, because the pot is the winner's", async () => {
    const adapter = greedAdapter({ roll: sixes });
    const room = playOut(500);
    const { deps, given } = ledger();
    expect(room.escrow.total).toBe(0);
    await adapter.void?.(room, deps);
    expect(given).toEqual([]);
  });

  it("gives a buy-in straight back if the table closed while it was being taken", async () => {
    const adapter = greedAdapter({ roll: sixes });
    const room = adapter.create("TEST1") as Room;
    room.join("a", "Ada", who(1));
    room.join("b", "Bram", who(2));
    room.setBuyIn(500);
    const { held, deps } = wallet({ u1: 1_000, u2: 1_000 });
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow: GameDeps = {
      ...deps,
      take: async (userId, amount) => {
        const ok = await deps.take(userId, amount);
        if (userId === "u2") await gate;
        return ok;
      },
    };

    const starting = adapter.act(room, "a", { type: "start" }, slow).catch((error) => error);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await adapter.void?.(room, deps);
    release();
    const outcome = await starting;

    expect(outcome).toBeInstanceOf(Error);
    expect(held).toEqual({ u1: 1_000, u2: 1_000 });
    expect(room.status).toBe("lobby");
  });

  it("gives back the buy-in of somebody who left while the others were paying", async () => {
    const adapter = greedAdapter({ roll: sixes });
    const room = adapter.create("TEST1") as Room;
    room.join("a", "Ada", who(1));
    room.join("b", "Bram", who(2));
    room.join("c", "Cy", who(3));
    room.setBuyIn(500);
    const { held, deps } = wallet({ u1: 1_000, u2: 1_000, u3: 1_000 });
    const leaving: GameDeps = {
      ...deps,
      take: async (userId, amount) => {
        const ok = await deps.take(userId, amount);
        if (userId === "u3") room.removeSeat("b");
        return ok;
      },
    };

    await adapter.act(room, "a", { type: "start" }, leaving);
    await adapter.payOut?.(room, deps);

    expect(held["u2"]).toBe(1_000);
    expect(room.escrow.total).toBe(1_000);
  });
});
```

Check `Room.removeSeat` and `Room.setBuyIn` exist under those names (grep `room.ts`); adjust the calls if not.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run games/greed/src/adapter.test.ts`
Expected: FAIL — `room.escrow` undefined / `adapter.void` undefined.

- [ ] **Step 3: Implement**

`room.ts`: `import { Escrow } from "@backroom/core";` (merge with any existing core import), add the field `readonly escrow = new Escrow();` next to `buyIn`, with a comment saying it holds the buy-ins taken at the start of a game played for chips. At the first line of `private finish()` add `this.escrow.settle();` and a comment: the game is decided, so the buy-ins now belong to the pot.

`adapter.ts` — replace the `start` case body with:

```ts
      case "start": {
        // Every stake before a card is dealt, and anything already taken put
        // back if one of them cannot pay. Nobody ends up half-way into a game.
        const paid: string[] = [];
        const giveBack = async () => {
          for (const refund of paid) {
            room.escrow.release(refund, room.buyIn);
            await deps.give(refund, room.buyIn);
          }
        };
        if (room.buyIn > 0) {
          for (const seat of room.seats) {
            if (seat.userId === null) {
              continue;
            }
            if (!(await deps.take(seat.userId, room.buyIn))) {
              await giveBack();
              // A refusal, not a fault: it is shown to the player as it is.
              throw new TableError(`${seat.name} cannot cover the buy-in.`);
            }
            /*
             * Held the moment it is taken. A table called off while the rest
             * were paying has already handed back everything it knew about,
             * and this one arrived too late to be in it.
             */
            if (!room.escrow.hold(seat.userId, room.buyIn)) {
              await deps.give(seat.userId, room.buyIn);
              await giveBack();
              throw new TableError("This table is closing.");
            }
            paid.push(seat.userId);
          }
        }
        try {
          room.start(seatId);
        } catch (error) {
          await giveBack();
          throw error;
        }
        /*
         * Anybody who paid and then left while the others were being asked.
         * The lobby lets a seat go, and every take above is an await: the
         * game started without them and the pot does not count them, so their
         * buy-in is theirs.
         */
        for (const userId of paid) {
          if (!room.seats.some((seat) => seat.userId === userId)) {
            room.escrow.refund(userId, room.buyIn);
          }
        }
        return;
      }
```

Add to the returned adapter object (after `winners`):

```ts
  /** Buy-ins owed back to somebody who left before the game began. */
  async payOut(room, deps) {
    for (const owed of room.escrow.takeDue()) {
      await deps.give(owed.userId, owed.chips);
    }
  },

  async void(room, deps) {
    const owed = room.escrow.close();
    for (const one of owed) {
      await deps.give(one.userId, one.chips);
    }
    return owed;
  },
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run games/greed`
Expected: PASS (all greed tests, old and new).

- [ ] **Step 5: Watch the refund test fail without the refund**

Temporarily change the `void` loop body to `continue;`, run `npx vitest run games/greed/src/adapter.test.ts -t "hands every buy-in back"`, confirm it FAILS on the balance assertion, then restore the loop and confirm it passes again.

- [ ] **Step 6: Format and commit**

```bash
npx biome format --write games/greed/src/room.ts games/greed/src/adapter.ts games/greed/src/adapter.test.ts
git add games/greed
git commit -m "feat(greed): hold buy-ins in escrow and hand them back when a table is called off"
```

---

### Task 4: Death roll

**Files:**
- Modify: `games/death-roll/src/table.ts` (add `readonly escrow = new Escrow()`; `this.escrow.settle()` at the top of `finish()`)
- Modify: `games/death-roll/src/adapter.ts` (antes, pass, `settle`, `void`)
- Test: `games/death-roll/src/adapter.test.ts`

**Interfaces:**
- Consumes: `Escrow` from `@backroom/core`.
- Produces: `Table.escrow`; `deathRollAdapter().void`.

Death roll holds a leaver's seat until the duel ends (`removeSeat` puts it in `leaving` while a duel exists), so the winner is always present at settle. Only escrow and void are new. A for-fun table never holds.

- [ ] **Step 1: Write failing tests** — append to `games/death-roll/src/adapter.test.ts`

```ts
describe("a duel called off before anybody lost", () => {
  it("hands both antes and any pass back", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const { deps, gave } = spy();
    await deal(game, table, deps);
    const duel = table.duel;
    expect(duel).not.toBeNull();
    const roller = duel?.toRoll as string;
    await game.act(table, roller, { type: "pass" }, deps);
    const price = table.passPrice;
    const who = table.seats.find((seat) => seat.id === roller)?.userId as string;

    const refunded = await game.void?.(table, deps);

    const back = (userId: string) =>
      gave.mock.calls.filter(([id]) => id === userId).reduce((total, [, chips]) => total + (chips as number), 0);
    expect(back("u1") + back("u2")).toBe(table.ante * 2 + price);
    expect(back(who)).toBe(table.ante + price);
    expect(refunded?.reduce((total, one) => total + one.chips, 0)).toBe(table.ante * 2 + price);
  });

  it("refunds nothing once the duel has been settled", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps, gave } = spy();
    await deal(game, table, deps);
    const roller = table.duel?.toRoll as string;
    await game.act(table, roller, { type: "roll" }, deps);
    expect(game.isSettled(table)).toBe(true);
    await game.settle(table, deps);
    gave.mockClear();

    await game.void?.(table, deps);
    expect(gave).not.toHaveBeenCalled();
  });

  it("gives back an ante taken after the table closed", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const { deps, gave } = spy();
    table.askForDuel();
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = { ...deps, take: async (userId: string, chips: number) => { await gate; return deps.take(userId, chips); } } as GameDeps;

    const dealing = game.payOut?.(table, slow);
    await game.void?.(table, deps);
    release();
    await dealing;

    const back = gave.mock.calls.reduce((total, [, chips]) => total + (chips as number), 0);
    expect(back).toBe(table.ante * 2);
    expect(table.duel).toBeNull();
  });
});
```

If a roll of `1` doesn't end the duel under this game's rules, use whatever the existing "settle" tests in this file use to finish a duel.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run games/death-roll/src/adapter.test.ts`
Expected: FAIL — `game.void` undefined.

- [ ] **Step 3: Implement**

`table.ts`: import `Escrow` from `@backroom/core`; add `readonly escrow = new Escrow();` beside `duel` with a comment (the antes and passes of the duel on the felt, by account). In `finish()` add `this.escrow.settle();` as its first statement, with a comment that `settle` has normally drained it already and this is a backstop: a duel cleared without being settled loses its pot rather than handing back chips that were lost.

`adapter.ts`:

1. Add a helper after `give`:

```ts
  /**
   * Records chips just taken for the duel, or hands them straight back if the
   * table has been called off in the meantime. Play money is never held.
   */
  const held = async (
    table: Table,
    seat: { id: string; userId: string | null },
    chips: number,
    deps: GameDeps,
  ): Promise<boolean> => {
    if (table.forFun || seat.userId === null) {
      return true;
    }
    if (table.escrow.hold(seat.userId, chips)) {
      return true;
    }
    await deps.give(seat.userId, chips);
    return false;
  };

  /** Chips going back before the duel is decided: off the escrow, then to them. */
  const giveBack = async (
    table: Table,
    seat: { id: string; userId: string | null },
    chips: number,
    deps: GameDeps,
  ): Promise<void> => {
    if (!table.forFun && seat.userId !== null) {
      table.escrow.release(seat.userId, chips);
    }
    await give(table, seat, chips, deps);
  };
```

2. In `antesIn`:
   - After the first take succeeds: `if (!(await held(table, one, table.ante, deps))) { return true; }`
   - After the second take succeeds (`paid` true): `if (!(await held(table, two, table.ante, deps))) { await giveBack(table, one, table.ante, deps); return true; }`
   - Replace every `give(table, one, table.ante, deps)` / `give(table, two, …)` that returns an ante **after it was held** with `giveBack(...)`. That's the both-antes-back-on-`gone` pair. The first ante's refund in the second-take catch and refused branches happens before the second hold. The first ante *was* held by then, so those become `giveBack` too.
3. In `act` `pass`: after the take succeeds, `if (!(await held(table, seat, price, deps))) { throw new TableError("This table is closing."); }`. The refund in the `duel.pass` catch becomes `giveBack(table, seat, price, deps)`.
4. In `settle`, right after the `duel === null || duel.loserId === null` guard: `table.escrow.settle();` with a comment (before the first await, the pot now belongs to the winner).
5. Add to the adapter object:

```ts
    async void(table, deps) {
      const owed = table.escrow.close();
      for (const one of owed) {
        await deps.give(one.userId, one.chips);
      }
      return owed;
    },
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run games/death-roll`
Expected: PASS (old and new).

- [ ] **Step 5: Watch the refund test fail without the refund** — make `void`'s loop `continue;`, run `-t "hands both antes"`, confirm FAIL, restore, confirm PASS.

- [ ] **Step 6: Format and commit**

```bash
npx biome format --write games/death-roll/src/table.ts games/death-roll/src/adapter.ts games/death-roll/src/adapter.test.ts
git add games/death-roll
git commit -m "feat(death-roll): hold antes and passes in escrow and hand them back when a duel is called off"
```

---

### Task 5: Poker

**Files:**
- Modify: `games/poker/src/table.ts`
- Modify: `games/poker/src/adapter.ts`
- Modify: `games/poker/src/table.test.ts`, `games/poker/src/forfun.test.ts` (tests that read `owedOut`)
- Create: `games/poker/src/adapter.test.ts`

**Interfaces:**
- Consumes: `Escrow` from `@backroom/core`.
- Produces: `Table.escrow`; `Table.owedOut` removed (replaced by `table.escrow.due`); `pokerAdapter().payOut` drains `escrow.takeDue()`; `pokerAdapter().void`.

For poker, escrow holds **each account's claim on the table's chips**. The invariant is `escrow.total === sum(seat.stack + seat.paid) + ghosts` on a chips table.
- `buyIn` holds the stack.
- Betting moves chips from stack to `paid` and doesn't touch escrow.
- `award` calls `escrow.settle()` and re-holds each seated account's new stack.
- `leave` / `takeOffTable` queue only the stack (`refund(userId, chips)`). What a leaver already bet stays held under their account until `award` gives it to the winners, or a void gives it back.

- [ ] **Step 1: Write failing tests** — `games/poker/src/adapter.test.ts`

```ts
import type { GameDeps } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { pokerAdapter } from "./adapter.js";
import type { Table } from "./table.js";

const identity = (userId: string) => ({ userId, avatar: null, accentColor: null });

function wallet(start: Record<string, number>) {
  const held = { ...start };
  const deps: GameDeps = {
    take: async (userId, amount) => {
      if ((held[userId] ?? 0) < amount) return false;
      held[userId] = (held[userId] ?? 0) - amount;
      return true;
    },
    give: async (userId, amount) => {
      held[userId] = (held[userId] ?? 0) + amount;
    },
    record: async () => {},
    finished: async () => {},
  };
  return { held, deps };
}

/** Two players bought in at a chips table, a hand dealt and some chips in the middle. */
async function midHand() {
  const adapter = pokerAdapter();
  const table = adapter.create("CHP01", { buyIn: 2_000 }) as Table;
  table.join("a", "Ada", identity("u1"));
  table.join("b", "Bram", identity("u2"));
  const { held, deps } = wallet({ u1: 10_000, u2: 10_000 });
  await adapter.act(table, "a", { type: "buyIn" }, deps);
  await adapter.act(table, "b", { type: "buyIn" }, deps);
  table.deal();
  return { adapter, table, held, deps };
}

/** Every chip an account could claim: stacks in front of seats plus the pot, ghosts included. */
const onTable = (table: Table) =>
  table.seats.reduce((total, seat) => total + seat.stack, 0) + table.pot;

describe("a poker table called off mid-hand", () => {
  it("hands every account back its stack and what it had bet", async () => {
    const { adapter, table, held, deps } = await midHand();
    expect(table.pot).toBeGreaterThan(0);
    expect(table.escrow.total).toBe(onTable(table));

    await adapter.void?.(table, deps);

    expect(held).toEqual({ u1: 10_000, u2: 10_000 });
  });

  it("gives a leaver their stack now and their bet back if the hand is called off", async () => {
    const { adapter, table, held, deps } = await midHand();
    const bet = table.seats.find((seat) => seat.id === "a")?.paid ?? 0;
    table.leave("a");
    await adapter.payOut?.(table, deps);
    expect(held["u1"]).toBe(10_000 - bet);

    await adapter.void?.(table, deps);
    expect(held).toEqual({ u1: 10_000, u2: 10_000 });
  });

  it("keeps the claim equal to the chips on the table across a finished hand", async () => {
    const { adapter, table, deps } = await midHand();
    for (let guard = 0; guard < 50 && table.street !== "showdown"; guard += 1) {
      const toAct = table.toAct;
      if (toAct === null) break;
      table.act(toAct, "call");
    }
    expect(table.street).toBe("showdown");
    expect(table.escrow.total).toBe(onTable(table));
    await adapter.void?.(table, deps);
  });

  it("gives back a buy-in whose seat went while the chips were being taken", async () => {
    const adapter = pokerAdapter();
    const table = adapter.create("CHP01", { buyIn: 2_000 }) as Table;
    table.join("a", "Ada", identity("u1"));
    table.join("b", "Bram", identity("u2"));
    const { held, deps } = wallet({ u1: 10_000, u2: 10_000 });
    const leaving: GameDeps = {
      ...deps,
      take: async (userId, amount) => {
        const ok = await deps.take(userId, amount);
        table.leave("a");
        return ok;
      },
    };

    await expect(adapter.act(table, "a", { type: "buyIn" }, leaving)).rejects.toThrow();
    expect(held["u1"]).toBe(10_000);
  });
});
```

If `table.act(toAct, "call")` throws when a check is due, use `table.owed(seat) > 0 ? "call" : "check"`, reading the seat off `table.seats`.

In `forfun.test.ts`:
- Replace `expect(table.owedOut).toEqual([])` with `expect(table.escrow.due).toEqual([])`.
- Replace the chips-table expectation with `expect(table.escrow.due).toEqual([{ userId: "u1", chips: 2_000 }])`.

In `table.test.ts`, update every `owedOut` read the same way (`made.owedOut` → `made.escrow.due`, dropping `name` from the expected objects).

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run games/poker`
Expected: FAIL — `escrow` undefined.

- [ ] **Step 3: Implement**

`table.ts`:
1. Import `Escrow` from `@backroom/core`. Replace the `owedOut` field and its comment with:

```ts
  /**
   * What each account can claim from the chips on this table.
   *
   * A buy-in is held when it lands and a stack standing up is queued back to
   * its account; everything between is stacks moving around the felt, which
   * does not change anybody's claim until a pot is awarded. That is what lets a
   * hand called off halfway hand every chip back to the person who brought it.
   *
   * Never written at a table playing for nothing.
   */
  readonly escrow = new Escrow();
```

2. `buyIn(seatId, chips)`, after the `chips <= 0` return and before `seat.stack += chips`:

```ts
    /*
     * Held here rather than by whoever took the chips, so recording the claim
     * and putting the stack down are one step. A table called off while the
     * chips were being taken refuses, and the taker gives them back.
     */
    if (!this.forFun && seat.userId !== null && !this.escrow.hold(seat.userId, chips)) {
      throw new TableError("This table is closing.");
    }
```

3. In `takeOffTable` and `leave`, replace each `this.owedOut.push({ userId, name, chips })` with `this.escrow.refund(<userId>, <chips>)` (same guards).
4. In `award()`, just before `const first = this.paid[0];`:

```ts
    /*
     * Every chip in the middle is in somebody's stack now, so every claim is
     * whatever that account has in front of it. A leaver's bet was theirs until
     * this moment and is the winner's after it.
     */
    if (!this.forFun) {
      this.escrow.settle();
      for (const seat of this.seats) {
        if (seat.userId !== null) {
          this.escrow.hold(seat.userId, seat.stack);
        }
      }
    }
```

`adapter.ts`:
1. `buyIn` case: after the take, replace `table.buyIn(seatId, table.entry); return;` with:

```ts
          /*
           * And given straight back if the seat is gone or the table closed
           * while the chips were being taken: the stack never landed, so
           * nobody else can be holding them.
           */
          try {
            table.buyIn(seatId, table.entry);
          } catch (error) {
            await deps.give(seat.userId, table.entry);
            throw error;
          }
          return;
```

2. `payOut`: replace `table.owedOut.splice(0)` with `table.escrow.takeDue()` and update the loop to `deps.give(one.userId, one.chips)`.
3. Add `void`:

```ts
    async void(table, deps) {
      const owed = table.escrow.close();
      for (const one of owed) {
        await deps.give(one.userId, one.chips);
      }
      return owed;
    },
```

4. Update the `cashOut` comment and the `isSettled` block comment where they mention `owedOut` to say "the escrow's queue".

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run games/poker`
Expected: PASS. If the showdown invariant test shows the escrow drifting, find the stack-changing path that skipped escrow (`rg "stack [+-]?=" games/poker/src/table.ts`). Fix that path; don't loosen the assertion.

- [ ] **Step 5: Watch it fail without the refund** — make `void`'s loop `continue;`, run `-t "hands every account back"`, confirm FAIL, restore.

- [ ] **Step 6: Format and commit**

```bash
npx biome format --write games/poker/src
git add games/poker
git commit -m "feat(poker): escrow each account's claim on the table and hand it back when called off"
```

---

### Task 6: Blackjack

**Files:**
- Modify: `games/blackjack/src/table.ts` (`escrow` field; `removeSeat` queues during betting; `escrow.settle()` where `this.phase = "settled"` at ~line 966)
- Modify: `games/blackjack/src/adapter.ts` (bet/double/split hold; `owing` 0 once closed; new `payOut` + `void`)
- Test: `games/blackjack/src/adapter.test.ts`

**Interfaces:**
- Consumes: `Escrow`, `ledgerOf(bank).release`.
- Produces: `Table.escrow`; `blackjackAdapter().payOut`, `.void`.

- [ ] **Step 1: Write failing tests** — append to `games/blackjack/src/adapter.test.ts`

```ts
describe("a blackjack table called off", () => {
  function vaultOf(start: number) {
    let held = start;
    return {
      read: () => held,
      bank: {
        async holds() { return held; },
        async add(amount: number) { held += amount; },
        async take(amount: number) { if (amount > held) return false; held -= amount; return true; },
      },
    };
  }

  it("hands a bet on the felt back out of the bank", async () => {
    const { bank, read } = vaultOf(100_000);
    const game = blackjackAdapter({ bank });
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    const { deps, balances } = ledger({ u1: 10_000 });

    await game.act(table, "a", { type: "bet", amount: 500 }, deps);
    expect(balances["u1"]).toBe(9_500);
    expect(read()).toBe(100_500);

    await game.void?.(table, deps);
    expect(balances["u1"]).toBe(10_000);
    expect(read()).toBe(100_000);
  });

  it("hands back a doubled hand that was dealt but never finished", async () => {
    const { bank, read } = vaultOf(100_000);
    const game = blackjackAdapter({ bank });
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    const { deps, balances } = ledger({ u1: 10_000 });
    await game.act(table, "a", { type: "bet", amount: 500 }, deps);
    Object.defineProperty(table, "shoe", {
      value: { refresh() {}, draw: (() => { const cards = ["5", "9", "6", "7"].map((rank) => ({ rank, suit: "spades" })); return () => cards.shift() ?? { rank: "2", suit: "hearts" }; })() },
    });
    await game.act(table, "a", { type: "deal" }, deps);
    if (table.phase === "playing") {
      await game.act(table, "a", { type: "double" }, deps).catch(() => {});
    }

    if (!game.isSettled(table)) {
      await game.void?.(table, deps);
      expect(balances["u1"]).toBe(10_000);
      expect(read()).toBe(100_000);
    }
  });

  it("returns a bet to somebody who leaves while bets are still open", async () => {
    const { bank, read } = vaultOf(100_000);
    const game = blackjackAdapter({ bank });
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    table.join("b", "Bo", identity("u2"));
    const { deps, balances } = ledger({ u1: 10_000, u2: 10_000 });
    await game.act(table, "a", { type: "bet", amount: 500 }, deps);

    table.removeSeat("a");
    await game.payOut?.(table, deps);

    expect(balances["u1"]).toBe(10_000);
    expect(read()).toBe(100_000);
  });

  it("stops holding the bank's chips for a table that has been called off", async () => {
    const { bank } = vaultOf(100_000);
    const game = blackjackAdapter({ bank });
    const closed = game.create("TEST1");
    closed.join("a", "Ada", identity("u1"));
    const other = game.create("TEST2");
    other.join("b", "Bo", identity("u2"));
    const { deps } = ledger({ u1: 10_000, u2: 10_000 });
    await game.act(closed, "a", { type: "bet", amount: 500 }, deps);

    await game.void?.(closed, deps);
    const { ledgerOf } = await import("@backroom/core");
    expect(ledgerOf(bank).owedElsewhere(other)).toBe(0);
  });
});
```

The doubled-hand test's shoe setup has to deal the player a hard 11 that stays in `playing`. Match what the existing `stack(table, ranks)` helper in this file deals: player card, then dealer, then player, then dealer. Pick ranks so the player isn't on 21 and the dealer has no blackjack. Then **remove the `if` guards** so the test really asserts: it has to double successfully and then void.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run games/blackjack/src/adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`table.ts`:
1. Import `Escrow`; add `readonly escrow = new Escrow();` with a comment (every stake on the felt by account, bets, doubles and splits, until the dealer settles them).
2. `removeSeat`, inside the lobby branch, before `this.seating.remove(seatId)`:

```ts
    /*
     * Bets are still open, so the chips on this seat are still theirs to take
     * back — they could have pressed zero a moment ago. Queued, because this
     * cannot await the bank; the adapter pays it on the next broadcast.
     */
    const leaving = this.seating.find(seatId);
    if (leaving?.userId != null && !this.forFun) {
      this.escrow.refund(leaving.userId);
    }
```

3. Immediately before `this.phase = "settled";` (~line 966) add `this.escrow.settle();` with a comment (the dealer has played, so every stake now belongs to its result).

`adapter.ts`:
1. `owing`: first line `if (table.escrow.closed) { return 0; }` with a comment (a called-off table owes nothing, and an act queued behind the void would otherwise put its reservation back on the way out of `serially`).
2. `bet`: after the take succeeds (`owed > 0`), before the `owed < 0` branch:

```ts
            if (owed > 0 && !table.escrow.hold(seat.userId, owed)) {
              await deps.give(seat.userId, owed);
              throw new TableError("This table is closing.");
            }
            if (owed < 0) {
              table.escrow.release(seat.userId, -owed);
            }
```

   (Keep the existing `if (owed < 0) { await deps.give(...) }` after it.)
3. `double` and `split`: after `table.double(seatId)` / `table.split(seatId)` succeeds and before `bank?.add`:

```ts
            if (!table.escrow.hold(seat.userId, extra)) {
              await deps.give(seat.userId, extra);
              throw new TableError("This table is closing.");
            }
```

   (`stake` instead of `extra` for split.)
4. Add a refund helper above the returned object:

```ts
  /**
   * Chips out of the bank and back to where they came from, in the bank's own
   * queue. Only ever stakes — everything here went into the bank as it was
   * placed — so a refusal means something outside the book moved the bank.
   */
  const handBack = async (table: Table, owed: readonly { userId: string; chips: number }[], deps: GameDeps) =>
    serially(table, async () => {
      for (const one of owed) {
        if (bank !== null && banked(table) && !(await bank.take(one.chips))) {
          console.error(`blackjack ${table.code}: the bank refused ${one.chips} owed back to ${one.userId}`);
          continue;
        }
        await deps.give(one.userId, one.chips);
      }
    });
```

   Import `GameDeps` as a type from `@backroom/core`.
5. Add to the adapter object:

```ts
    /** Bets owed back to somebody who stood up while the felt was still open. */
    async payOut(table, deps) {
      const owed = table.escrow.takeDue();
      if (owed.length > 0) {
        await handBack(table, owed, deps);
      }
    },

    async void(table, deps) {
      const owed = table.escrow.close();
      await handBack(table, owed, deps);
      ledger?.release(table);
      return owed;
    },
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run games/blackjack`
Expected: PASS (the whole package, including `split.test.ts` and `forfun.test.ts`).

- [ ] **Step 5: Watch it fail without the refund** — change `handBack`'s `deps.give` line to `continue;`, run `-t "hands a bet on the felt back"`, confirm FAIL, restore.

- [ ] **Step 6: Format and commit**

```bash
npx biome format --write games/blackjack/src/table.ts games/blackjack/src/adapter.ts games/blackjack/src/adapter.test.ts
git add games/blackjack
git commit -m "feat(blackjack): escrow stakes, return a bet on leaving the open felt, hand everything back when called off"
```

---

### Task 7: Roulette

**Files:**
- Modify: `games/roulette/src/table.ts` (`escrow`, `accounts` map + `accountOf`, `place` holds, `take`/`undo`/`clear` release, `removeSeat` rule, `land` settles)
- Modify: `games/roulette/src/adapter.ts` (`place`/`repeat` refund when landing throws, `owing` 0 when closed, `payOut` drains, `settle` pays departed accounts, `void`)
- Test: `games/roulette/src/adapter.test.ts`

**Interfaces:**
- Consumes: `Escrow`, `ledgerOf(bank).release`.
- Produces: `Table.escrow`, `Table.accountOf(seatId): string | null`; `rouletteAdapter().void`.

- [ ] **Step 1: Write failing tests** — append to `games/roulette/src/adapter.test.ts`

```ts
function wallet(start: Record<string, number>) {
  const held = { ...start };
  const deps = {
    take: async (userId: string, amount: number) => {
      if ((held[userId] ?? 0) < amount) return false;
      held[userId] = (held[userId] ?? 0) - amount;
      return true;
    },
    give: async (userId: string, amount: number) => {
      held[userId] = (held[userId] ?? 0) + amount;
    },
    record: async () => {},
    finished: async () => {},
  } as GameDeps;
  return { held, deps };
}

describe("a roulette table called off", () => {
  it("hands every chip on the cloth back out of the bank", async () => {
    const { bank, held: inBank } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { held, deps } = wallet({ u1: 1_000 });

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    expect(table.escrow.total).toBe(200);

    await game.void?.(table, deps);
    expect(held["u1"]).toBe(1_000);
    expect(inBank()).toBe(1_000_000);
  });

  it("keeps the escrow and the cloth in step as chips go on and come off", async () => {
    const { bank } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { deps } = wallet({ u1: 5_000 });
    const onCloth = () => table.placed.reduce((total, one) => total + one.chips, 0);

    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    await game.act(table, "s1", { type: "place", spotId: RED, chips: 100 }, deps);
    expect(table.escrow.total).toBe(onCloth());
    await game.act(table, "s1", { type: "undo" }, deps);
    expect(table.escrow.total).toBe(onCloth());
    await game.act(table, "s1", { type: "clear" }, deps);
    expect(table.escrow.total).toBe(0);
  });

  it("returns chips to somebody who leaves while bets are open", async () => {
    const { bank, held: inBank } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { held, deps } = wallet({ u1: 1_000 });
    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);

    table.removeSeat("s1");
    await game.payOut?.(table, deps);

    expect(held["u1"]).toBe(1_000);
    expect(inBank()).toBe(1_000_000);
  });

  it("still pays somebody who left after the ball was in", async () => {
    const { bank } = purse(1_000_000);
    // Pocket 1 is red.
    const game = rouletteAdapter({ bank, pick: () => 1 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { held, deps } = wallet({ u1: 1_000 });
    await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
    table.closeBetting();
    table.removeSeat("s1");
    table.land();

    await game.settle(table, deps);

    expect(held["u1"]).toBe(1_200);
  });

  it("gives back a chip the table refused after it was paid for", async () => {
    const { bank, held: inBank } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const table = game.create("ABCDE") as Table;
    table.join("s1", "Ada", who("u1"));
    const { held, deps } = wallet({ u1: 1_000 });
    const shutting = { ...deps, take: async (userId: string, amount: number) => { const ok = await deps.take(userId, amount); table.closeBetting(); return ok; } } as GameDeps;
    table.join("s2", "Bo", who("u2"));
    await game.act(table, "s2", { type: "place", spotId: RED, chips: 10 }, wallet({ u2: 100 }).deps);

    await expect(game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, shutting)).rejects.toThrow();

    expect(held["u1"]).toBe(1_000);
    expect(inBank()).toBe(1_000_010);
  });

  it("stops holding the bank's chips for a table that has been called off", async () => {
    const { bank } = purse(1_000_000);
    const game = rouletteAdapter({ bank, pick: () => 0 });
    const closed = game.create("ABCDE") as Table;
    closed.join("s1", "Ada", who("u1"));
    const other = game.create("FGHIJ") as Table;
    const { deps } = wallet({ u1: 1_000 });
    await game.act(closed, "s1", { type: "place", spotId: RED, chips: 200 }, deps);

    await game.void?.(closed, deps);

    const { ledgerOf } = await import("@backroom/core");
    expect(ledgerOf(bank).owedElsewhere(other)).toBe(0);
  });
});
```

If pocket 1 isn't red in this table's `spin`/`pick` mapping, choose the `pick` index whose pocket is red. The `RED` spot id lists the red numbers. Stakes on red pay 1:1, so the balance becomes 1 200.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run games/roulette/src/adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`table.ts`:
1. Import `Escrow`. Add:

```ts
  /** Every chip on the cloth by the account it came from, until the ball decides it. */
  readonly escrow = new Escrow();

  /**
   * The account behind each seat that has been at this spin, seated or not.
   *
   * A seat that stands up once the ball is in still has chips riding on it,
   * and what the wheel decides is theirs. Pruned when the cloth is swept, since
   * the spin that owes somebody is the spin they were in.
   */
  private readonly accounts = new Map<string, string | null>();

  accountOf(seatId: string): string | null {
    return this.accounts.get(seatId) ?? null;
  }
```

2. `join`: capture the returned seat, `this.accounts.set(seat.id, identity?.userId ?? null)`, return it.
3. `removeSeat` becomes:

```ts
  removeSeat(seatId: string): void {
    const userId = this.accountOf(seatId);
    this.seating.remove(seatId);
    this.previous.delete(seatId);
    /*
     * While bets are open their chips are still theirs to take back, so they
     * go back. Once the window has shut the chips ride: the ball is in, and
     * what it decides is paid to their account whether they watch or not.
     */
    if (this.phase === "betting") {
      this.placed = this.placed.filter((one) => one.seatId !== seatId);
      if (userId !== null && !this.forFun) {
        this.escrow.refund(userId);
      }
    }
  }
```

   Update the `leavesMidHand` doc comment to match (nothing is kept from a leaver: open bets come back, and closed ones are paid).
4. `place(seatId, spotId, chips)`: after its `this.check(...)` line, and before `this.placed` changes:

```ts
    const userId = this.seats.find((seat) => seat.id === seatId)?.userId ?? null;
    if (!this.forFun && userId !== null && !this.escrow.hold(userId, chips)) {
      throw new TableError("This table is closing.");
    }
```

   Bots only place at for-fun tables, so they never reach the hold.
5. In `take`, `undo` and `clear`: work out the chips that came off for the seat (sum of the seat's `placed` before minus after), then `this.escrow.release(userId, off)` for a chips table with a signed-in seat. Put the release inside the table methods so the adapter's `giveBack` rollback (`table.placed = before`) must also re-hold. Simplest: in the adapter's `giveBack`, when it restores `table.placed = before`, call `table.escrow.hold(userId, off)` back. Make this change in the adapter too (see below).
6. `land()`: first statement after the guard, `this.escrow.settle();` with a comment (the ball has landed, so the cloth now belongs to its result).
7. `beginBetting()`: after sweeping, prune `accounts` to seated ids (the same loop two-up's `beginRound` uses).

`adapter.ts`:
1. `owing`: `if (table.escrow.closed) { return 0; }` first, with the same comment as blackjack.
2. `giveBack`: in the refusal branch, after `table.placed = before;`, re-hold: `if (seat.userId !== null && !table.forFun) table.escrow.hold(seat.userId, off);`. `off` is computed before that branch; move its computation above if needed.
3. `place`: wrap `table.place(seatId, spot.id, chips)`:

```ts
            /*
             * And straight back out if the cloth refuses it now. Taking the
             * chips is an await, and the table does not stand still for it:
             * last call can arrive, the window can shut on its own clock, the
             * seat can go. The chips are in the bank by then, so they come out
             * the way a take-back does.
             */
            try {
              table.place(seatId, spot.id, chips);
            } catch (error) {
              await pay(table, seat, chips, deps);
              throw error;
            }
```

4. `repeat`: same wrapper around its `table.place`, with `return` instead of `throw` in the catch (after paying back).
5. `pay` already does `bank.take` then `give`, so reuse it for refunds.
6. `payOut`: keep the housed refresh, and first drain the queue:

```ts
    async payOut(table, deps) {
      const owed = table.escrow.takeDue();
      if (owed.length > 0) {
        await serially(table, async () => {
          for (const one of owed) {
            await pay(table, { id: one.userId, userId: one.userId }, one.chips, deps);
          }
        });
      }
      if (!table.forFun) {
        const elsewhere = ledger?.owedElsewhere(table) ?? 0;
        table.housed = (await holds(table)) - elsewhere;
      }
    },
```

   Rewrite its doc comment: it pays back chips owed to somebody who stood up while bets were open, and it refreshes the cap the felt shows.
7. `settle`: replace the `seat === undefined → continue` lookup with the two-up rule:

```ts
          const here = table.seats.find((one) => one.id === seatId);
          const userId = here?.userId ?? table.accountOf(seatId);
          const seat = { id: seatId, userId };
```

   Then use `seat` / `userId` in the existing pay and record calls (`seat.userId === null` becomes `userId === null`). Add the same comment two-up has: a decided payout is theirs, seated or not.
8. `void`:

```ts
    async void(table, deps) {
      const owed = table.escrow.close();
      await serially(table, async () => {
        for (const one of owed) {
          await pay(table, { id: one.userId, userId: one.userId }, one.chips, deps);
        }
      });
      ledger?.release(table);
      return owed;
    },
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run games/roulette`
Expected: PASS (whole package).

- [ ] **Step 5: Watch it fail without the refund** — replace `void`'s `pay(...)` with nothing, run `-t "hands every chip on the cloth back"`, confirm FAIL, restore. Then revert only the `removeSeat` refund line, run `-t "returns chips to somebody who leaves"`, confirm FAIL, restore.

- [ ] **Step 6: Format and commit**

```bash
npx biome format --write games/roulette/src/table.ts games/roulette/src/adapter.ts games/roulette/src/adapter.test.ts
git add games/roulette
git commit -m "feat(roulette): escrow the cloth, return open bets on leaving, pay closed ones, hand back when called off"
```

---

### Task 8: Two-up (casino and ring)

**Files:**
- Modify: `games/two-up/src/table.ts`
- Modify: `games/two-up/src/adapter.ts`
- Test: `games/two-up/src/adapter.test.ts`

**Interfaces:**
- Consumes: `Escrow`, `ledgerOf(bank).release`; `Table.accountOf` already exists.
- Produces: `Table.escrow`; `twoUpAdapter().void`.

The **casino** school gets exactly what roulette got in Task 7: `place` holds; `take`/`undo`/`clear` release through the adapter's `giveBack`; `removeSeat` in `"betting"` filters and refunds, and otherwise leaves the chips; `read()` settles; `place`/`repeat` refund if landing throws; `owing` returns 0 once closed; `payOut` drains; `void`. `settle` already pays departed accounts.

For the **ring** school, `setCentre` and `cover` hold. The adapter's existing refund-on-throw `pay` must also release, but only when the hold happened. A throw *before* the hold (a failed check) means nothing was held, so hold as the last thing before mutating `centre`/`covers`, after every check. Then any throw means nothing was held. `removeSeat` keeps centre and covers already. `read()` calls `escrow.settle()` for both schools.

- [ ] **Step 1: Write failing tests** — append to `games/two-up/src/adapter.test.ts`

```ts
describe("a two-up table called off", () => {
  it("hands a casino chip back out of the bank", async () => {
    const { held, deps } = purse({ u0: 1_000 });
    const { bank, read } = bankOf(100_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);

    await adapter.void?.(table, deps);

    expect(held["u0"]).toBe(1_000);
    expect(read()).toBe(100_000);
  });

  it("returns a casino chip to somebody who leaves while bets are open", async () => {
    const { held, deps } = purse({ u0: 1_000 });
    const { bank, read } = bankOf(100_000);
    const adapter = twoUpAdapter({ bank });
    const table = adapter.create("ABCD", { ruleset: "casino" });
    sit(table, "s0", "u0");
    await adapter.act(table, "s0", { type: "place", on: "heads", chips: 100 }, deps);

    table.removeSeat("s0");
    await adapter.payOut?.(table, deps);

    expect(held["u0"]).toBe(1_000);
    expect(read()).toBe(100_000);
  });

  it("hands back a ring's centre and covers before the coins decide", async () => {
    const { held, deps } = purse({ u0: 1_000, u1: 1_000 });
    const adapter = twoUpAdapter();
    const table = adapter.create("ABCD", { ruleset: "school" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    table.beginRound();
    const spinner = table.spinnerId as string;
    const other = spinner === "s0" ? "s1" : "s0";
    await adapter.act(table, spinner, { type: "centre", chips: 200 }, deps);
    await adapter.act(table, other, { type: "cover", chips: 150 }, deps);
    expect(table.escrow.total).toBe(350);

    await adapter.void?.(table, deps);

    expect(held).toEqual({ u0: 1_000, u1: 1_000 });
  });

  it("does not hold a cover the table refused", async () => {
    const { deps } = purse({ u0: 1_000, u1: 1_000 });
    const adapter = twoUpAdapter();
    const table = adapter.create("ABCD", { ruleset: "school" });
    sit(table, "s0", "u0");
    sit(table, "s1", "u1");
    table.beginRound();
    const spinner = table.spinnerId as string;
    await adapter.act(table, spinner, { type: "centre", chips: 200 }, deps);
    await expect(adapter.act(table, spinner, { type: "cover", chips: 100 }, deps)).rejects.toThrow();
    expect(table.escrow.total).toBe(200);
  });
});
```

Also copy Task 7's "escrow and cloth in step", "gives back a chip refused after it was paid for" and "stops holding the bank's chips" tests, adapted to casino two-up (`on: "heads"`, `bankOf`, `purse`, `sit`). Check `beginRound()` is what deals seats in and names a spinner, as the file's `sitBot` note says; adjust if the existing ring tests set a round up differently.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run games/two-up/src/adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**, following Task 7 step 3 for the casino paths. Two-up-specific changes:
- `table.ts` `removeSeat`: only when `this.school === "casino" && this.phase === "betting"` filter `placed` and `escrow.refund(accountOf)`. Otherwise keep `placed` (and centre and covers, as now). Update the method's comment to the new rule.
- `setCentre` / `cover`: after the last check (`seatId !== spinnerId`, or the overshoot check for a cover), before assigning:

```ts
    const userId = this.seats.find((seat) => seat.id === seatId)?.userId ?? null;
    if (!this.forFun && userId !== null && !this.escrow.hold(userId, chips)) {
      throw new TableError("This table is closing.");
    }
```

- `read()`: `this.escrow.settle();` immediately before `this.phase = "settled";`.
- Adapter ring branch: the catch around `setCentre`/`cover` already calls `pay`. Nothing was held when it throws, so no release is needed. Say so in a one-line comment there.
- Adapter `void` and `payOut` use `serially` and `pay` exactly as in roulette. `pay` skips the bank for a ring, so the same code serves both schools. Call `ledger?.release(table)` only matters for casino; calling it for a ring is harmless.

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run games/two-up`
Expected: PASS.

- [ ] **Step 5: Watch it fail without the refund** — neuter `void`'s `pay`, run `-t "hands back a ring's centre"` and `-t "hands a casino chip back"`, confirm both FAIL, restore.

- [ ] **Step 6: Format and commit**

```bash
npx biome format --write games/two-up/src/table.ts games/two-up/src/adapter.ts games/two-up/src/adapter.test.ts
git add games/two-up
git commit -m "feat(two-up): escrow casino chips and ring stakes, hand them back when a table is called off"
```

---

### Task 9: `room:closed`, `closeTable`, reap and shutdown

**Files:**
- Modify: `packages/shared/src/protocol.ts` (+ export from `packages/shared/src/index.ts`)
- Modify: `packages/core/src/game.ts` (make `void` required)
- Modify: `apps/server/src/server.ts`
- Create: `apps/server/src/close.socket.test.ts`
- Modify: `apps/server/src/taunts.test.ts`

**Interfaces:**
- Consumes: every adapter's `void`; `Taunts.refund`.
- Produces:
  - `export type TableClosedReason = "empty" | "shutdown" | "admin";`
  - `export interface TableClosed { code: string; reason: TableClosedReason }`
  - `ServerToClient["room:closed"]: (closed: TableClosed) => void`
  - `BackRoomServer.closeTable(code: string, reason: TableClosedReason): Promise<void>`
  - `BackRoomServer.closeAllTables(reason: TableClosedReason): Promise<void>`

- [ ] **Step 1: Protocol and interface**

In `protocol.ts`, above `ServerToClient`:

```ts
/** Why a table stopped existing. */
export type TableClosedReason = "empty" | "shutdown" | "admin";

export interface TableClosed {
  code: string;
  reason: TableClosedReason;
}
```

Inside `ServerToClient`:

```ts
  /**
   * The table you were at has been called off, and anything you had on it has
   * gone back to your chips.
   *
   * Sent because nothing else would say so. A table closing is not a state the
   * table can broadcast — there is no table left to build one from — and a
   * felt that simply stopped updating reads as a connection that died.
   */
  "room:closed": (closed: TableClosed) => void;
```

Export `TableClosed` and `TableClosedReason` from `packages/shared/src/index.ts` next to `ServerToClient`.

In `game.ts` change `void?(` to `void(`. Run `npm run typecheck`. Expected: clean, because every adapter implemented it in Tasks 3–8. A failure names an adapter that was missed.

- [ ] **Step 2: Write failing server tests** — `apps/server/src/close.socket.test.ts`

```ts
import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import type { ClientToServer, ServerToClient, TableClosed } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";

/**
 * A table going away with chips on it, driven through the real socket layer.
 *
 * The refunds themselves are proven in each game. What only this can show is
 * the room doing its part: finding the table empty, calling it off rather
 * than dropping it, and telling whoever is still looking.
 */

type Client = Socket<ServerToClient, ClientToServer>;

const RED = "even:1-3-5-7-9-12-14-16-18-19-21-23-25-27-30-32-34-36";
const BANK = 100_000;

let server: BackRoomServer | null = null;
const open: Client[] = [];

afterEach(async () => {
  for (const socket of open.splice(0)) socket.close();
  if (server !== null) {
    await server.close();
    server = null;
  }
});

async function start(timings: { reconnectGraceMs: number; emptyRoomTtlMs: number }) {
  const store = new MemoryStore();
  const ada = await store.upsertDiscordUser({ discordId: "d1", name: "Ada", avatar: null, accentColor: null });
  const bo = await store.upsertDiscordUser({ discordId: "d2", name: "Bo", avatar: null, accentColor: null });
  await store.bankAdd("roulette", BANK);
  await store.bankAdd("blackjack", BANK);
  const bySocket = new Map<string, string>();
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify: (socket) => bySocket.get((socket as { handshake: { auth: { who?: string } } }).handshake.auth.who ?? "") ?? null,
    identifyRequest: () => ada.id,
    ...timings,
  });
  await new Promise<void>((resolve) => server?.http.listen(0, () => resolve()));
  const port = (server.http.address() as AddressInfo).port;
  bySocket.set("ada", ada.id);
  bySocket.set("bo", bo.id);
  const client = async (who: string): Promise<Client> => {
    const socket = connect(`http://localhost:${port}`, { transports: ["websocket"], forceNew: true, auth: { who } }) as Client;
    open.push(socket);
    await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
    return socket;
  };
  return { store, ada, bo, client };
}

const until = async (check: () => Promise<boolean> | boolean, ms = 3_000) => {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe("a table nobody is sitting at any more", () => {
  it("gives the chips on its cloth back before it is cleared away, and says so", async () => {
    const { store, ada, client } = await start({ reconnectGraceMs: 60_000, emptyRoomTtlMs: 150 });
    const before = (await store.get(ada.id))?.chips ?? 0;
    const player = await client("ada");
    const code = await new Promise<string>((resolve) =>
      player.emit("lobby:create", { name: "Ada", game: "roulette", forFun: false }, (ack) => resolve(ack.ok ? ack.code : "")),
    );
    await new Promise<void>((resolve) => player.emit("game:action", { type: "place", spotId: RED, chips: 200 }, () => resolve()));
    await until(async () => (await store.get(ada.id))?.chips === before - 200);

    const watcher = await client("bo");
    await new Promise<void>((resolve) => watcher.emit("lobby:watch", { code }, () => resolve()));
    const closed = new Promise<TableClosed>((resolve) => watcher.on("room:closed", resolve));

    player.close();

    expect(await closed).toEqual({ code, reason: "empty" });
    expect((await store.get(ada.id))?.chips).toBe(before);
    expect(await store.bank("roulette")).toBe(BANK);
    expect(server?.rooms.has(code)).toBe(false);
  });

  it("sends nothing further into a table once it is gone", async () => {
    const { client } = await start({ reconnectGraceMs: 60_000, emptyRoomTtlMs: 100 });
    const player = await client("ada");
    const code = await new Promise<string>((resolve) =>
      player.emit("lobby:create", { name: "Ada", game: "roulette", forFun: false }, (ack) => resolve(ack.ok ? ack.code : "")),
    );
    const watcher = await client("bo");
    await new Promise<void>((resolve) => watcher.emit("lobby:watch", { code }, () => resolve()));
    const closed = new Promise<void>((resolve) => watcher.on("room:closed", () => resolve()));
    player.close();
    await closed;

    let after = 0;
    watcher.on("room:state", () => { after += 1; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(after).toBe(0);
  });
});

describe("the server stopping", () => {
  it("hands back a blackjack bet still on the felt", async () => {
    const { store, ada, client } = await start({ reconnectGraceMs: 60_000, emptyRoomTtlMs: 60_000 });
    const before = (await store.get(ada.id))?.chips ?? 0;
    const player = await client("ada");
    await new Promise<void>((resolve) =>
      player.emit("lobby:create", { name: "Ada", game: "blackjack", forFun: false }, () => resolve()),
    );
    await new Promise<void>((resolve) => player.emit("game:action", { type: "bet", amount: 100 }, () => resolve()));
    await until(async () => (await store.get(ada.id))?.chips === before - 100);
    const closed = new Promise<TableClosed>((resolve) => player.on("room:closed", resolve));

    await server?.closeAllTables("shutdown");

    expect((await closed).reason).toBe("shutdown");
    expect((await store.get(ada.id))?.chips).toBe(before);
    expect(await store.bank("blackjack")).toBe(BANK);
  });

  it("calls every table off as part of closing", async () => {
    const { store, ada, client } = await start({ reconnectGraceMs: 60_000, emptyRoomTtlMs: 60_000 });
    const before = (await store.get(ada.id))?.chips ?? 0;
    const player = await client("ada");
    await new Promise<void>((resolve) =>
      player.emit("lobby:create", { name: "Ada", game: "blackjack", forFun: false }, () => resolve()),
    );
    await new Promise<void>((resolve) => player.emit("game:action", { type: "bet", amount: 100 }, () => resolve()));
    await until(async () => (await store.get(ada.id))?.chips === before - 100);

    const stopping = server;
    server = null;
    await stopping?.close();

    expect((await store.get(ada.id))?.chips).toBe(before);
  });
});
```

Check how existing socket tests (`roulette.socket.test.ts`, `taunts.test.ts`, `blackjack.socket.test.ts`) identify two different users, and copy that mechanism instead of the `auth.who` trick above if theirs differs. Also check the `lobby:create` ack shape. If `MemoryStore` throws on reads after `close()`, keep the balance read before the close in the last test by reading through a second reference — `MemoryStore.close` is expected to be a no-op, so confirm it.

In `apps/server/src/taunts.test.ts`, add a test using that file's existing setup: a signed-in player throws a taunt at another, then `await server.closeTable(code, "admin")`, and the thrower's balance is back to what it was before the throw.

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run apps/server/src/close.socket.test.ts apps/server/src/taunts.test.ts`
Expected: FAIL — `closeAllTables` is not a function, no `room:closed`, balances short.

- [ ] **Step 4: Implement in `server.ts`**

1. Import `TableClosedReason` from `@backroom/shared`. Add `closeTable` and `closeAllTables` to `BackRoomServer`, with doc comments (the admin panel's "close all tables" is built on the second).
2. Beside `settled`:

```ts
  /**
   * Tables being called off right now.
   *
   * Closing talks to the economy, so it takes a moment, and for that moment a
   * table must neither deal nor take a stake: everything on it is being handed
   * back, and a chip that landed now would be a chip the refund never saw.
   */
  const closing = new Set<string>();
  /** A settlement still moving chips, so a close can wait for it to finish. */
  const settling = new Map<string, Promise<void>>();
```

3. Pull the settle block out of `broadcast` into:

```ts
  /** Pays a finished hand and then its taunts. Called once per finished hand. */
  function settleNow(code: string, seated: Seated): Promise<void> {
    const won = seated.game.winners?.(seated.table) ?? null;
    const run = seated.game
      .settle(seated.table, deps)
      .then(() => payTaunts(code, seated, won))
      .catch((error) => console.error("settling failed", error))
      .finally(() => {
        if (settling.get(code) === run) {
          settling.delete(code);
        }
      });
    settling.set(code, run);
    return run;
  }
```

   Keep the existing comments that explain reading winners before settling and paying taunts after. In `broadcast` the branch becomes `settled.add(code); void settleNow(code, seated);`.
4. At the top of `broadcast`, after the `seated === undefined` return: `if (closing.has(code)) { return; }`.
5. In `guard`, after the `seated === undefined` check: `if (closing.has(seat.code)) { socket.emit("room:error", "This table is closing."); return; }`. In `lobby:join`, `lobby:resume` and `lobby:watch`, after the `room === undefined` check: `if (closing.has(<code>)) { ack({ ok: false, error: "This table is closing." }); return; }`. In `taunt:send`, after `seated === undefined`, refuse the same way before any chips are taken.
6. Add:

```ts
  /**
   * Calls a table off and gives back everything on it.
   *
   * The one way a table stops existing. A hand that has already been decided
   * is paid exactly as it would have been — closing a table never rewrites a
   * result — and only then is whatever is still undecided handed back: stakes
   * to the accounts they came from, taunts to whoever threw them. Everybody
   * still looking is told, because a felt that simply stopped would read as a
   * dead connection.
   *
   * A step that fails is logged and the close carries on. A half-closed table
   * is worse than a loud log, and at shutdown there is no second attempt.
   */
  async function closeTable(code: string, reason: TableClosedReason): Promise<void> {
    const seated = rooms.get(code);
    if (seated === undefined || closing.has(code)) {
      return;
    }
    closing.add(code);
    const clock = turnClocks.get(code);
    if (clock !== undefined) clearTimeout(clock);
    turnClocks.delete(code);
    const waiting = pauses.get(code);
    if (waiting !== undefined) clearTimeout(waiting.timer);
    pauses.delete(code);
    const bot = botMoves.get(code);
    if (bot !== undefined) clearTimeout(bot);
    botMoves.delete(code);

    await settling.get(code);
    if (seated.game.isSettled(seated.table) && !settled.has(code)) {
      settled.add(code);
      await settleNow(code, seated);
    }
    try {
      await seated.game.void(seated.table, deps);
    } catch (error) {
      console.error(`closing ${code}: calling off the table failed`, error);
    }
    for (const taunt of taunts.refund(code)) {
      try {
        await deps.give(taunt.fromUserId, taunt.chips);
      } catch (error) {
        console.error(`closing ${code}: handing back a taunt to ${taunt.fromUserId} failed`, error);
      }
    }

    io.to(code).emit("room:closed", { code, reason });
    for (const [socketId, seat] of [...sockets]) {
      if (seat.code === code) {
        sockets.delete(socketId);
        void io.sockets.sockets.get(socketId)?.leave(code);
      }
    }
    rooms.delete(code);
    settled.delete(code);
    settling.delete(code);
    closing.delete(code);
  }

  async function closeAllTables(reason: TableClosedReason): Promise<void> {
    await Promise.all([...rooms.keys()].map((code) => closeTable(code, reason)));
  }
```

   Check `sockets`' value type in this file and adjust the destructuring if needed.
7. `reapWhenEmpty`'s timer body becomes:

```ts
    later(() => {
      if (rooms.get(code)?.table.isEmpty === true) {
        void closeTable(code, "empty");
      }
    }, emptyRoomTtlMs);
```

   Replace its old burn comment with one saying an empty table is called off, not dropped: anything still on it goes back.
8. `close()`: first line `await closeAllTables("shutdown");` with a comment (before the timers go and before the store closes, because handing chips back needs both). Return `closeTable` and `closeAllTables` from `createBackRoomServer`.

- [ ] **Step 5: Run and watch them pass**

Run: `npx vitest run apps/server`
Expected: PASS (whole server suite; the existing `server.test.ts` reap tests still pass).

- [ ] **Step 6: Watch it fail without the refund** — in `closeTable`, comment out the `void` call and run `-t "gives the chips on its cloth back"`, which should FAIL. Restore it. The chips may still come back through the grace-period leave path, but not within this test's 60-second grace, which is the point of that setting.

- [ ] **Step 7: Format and commit**

```bash
npx biome format --write packages/shared/src/protocol.ts packages/shared/src/index.ts packages/core/src/game.ts apps/server/src/server.ts apps/server/src/close.socket.test.ts apps/server/src/taunts.test.ts
git add packages/shared packages/core/src/game.ts apps/server
git commit -m "feat(server): call a table off and hand everything back when it empties or the server stops"
```

---

### Task 10: The client leaves a closed table

**Files:**
- Modify: `apps/web/src/table/useTableSocket.ts`
- Modify: `apps/web/src/game/useRoom.ts`
- Test: `apps/web/src/table/useTableSocket.test.ts`, `apps/web/src/game/useRoom.test.ts`

**Interfaces:**
- Consumes: `TableClosed` from `@backroom/shared`; `"room:closed"` event.

- [ ] **Step 1: Write failing tests**

Append inside `useTableSocket.test.ts`'s describe block (or in a new describe with the same `beforeEach`):

```ts
  it("leaves a table that has been closed, and says why", async () => {
    const onLeave = vi.fn();
    const { result } = renderHook(() => useTableSocket("blackjack", onLeave));
    handlers.get("room:state")?.({ game: "blackjack", code: "ABCDE", listed: true, taunts: [], seats: [] });
    await waitFor(() => expect(result.current.state).not.toBeNull());

    handlers.get("room:closed")?.({ code: "ABCDE", reason: "empty" });

    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
    expect(result.current.state).toBeNull();
    expect(result.current.error).toMatch(/closed/i);
    expect(fake.emit).not.toHaveBeenCalledWith("lobby:leave");
  });

  it("ignores the close of a table it is not at", async () => {
    const onLeave = vi.fn();
    renderHook(() => useTableSocket("blackjack", onLeave));
    handlers.get("room:state")?.({ game: "blackjack", code: "ABCDE", listed: true, taunts: [], seats: [] });
    handlers.get("room:closed")?.({ code: "ZZZZZ", reason: "empty" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onLeave).not.toHaveBeenCalled();
  });
```

Check the hook's return names (`state`, `error`) and fix the test to match what `useTableSocket` returns. Write the same pair in `useRoom.test.ts` for greed. `useRoom` navigates, so assert with the `MemoryRouter` wrapper: render a `useLocation` beside it, or assert `result.current.room` becomes null plus the error message.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run apps/web/src/table/useTableSocket.test.ts apps/web/src/game/useRoom.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`useTableSocket.ts`:
- Keep `const codeRef = useRef<string | null>(null)` updated in the `room:state` handler (`codeRef.current = (raw as { code?: string }).code ?? null`).
- Keep `const onLeaveRef = useRef(onLeave)` synced in an effect.
- Add inside the socket effect:

```ts
    /*
     * The table was called off. Everything that was on it has already gone
     * back to the account, and the balance arrives on its own through
     * me:chips — so all that is left is to stop showing a felt that no longer
     * exists. No lobby:leave: there is nothing left to leave.
     */
    socket.on("room:closed", (closed: TableClosed) => {
      if (closed.code !== codeRef.current) {
        return;
      }
      codeRef.current = null;
      writeSeat(game, null);
      setState(null);
      setSeatId(null);
      setChat([]);
      setError("That table closed. Anything you had on it went back to your chips.");
      onLeaveRef.current();
    });
```

`useRoom.ts`: the same, with `writeSeat(null)`, `setRoom(null)`, and `navigateRef.current("/greed")` in place of `onLeave` (keep a ref to `navigate`).

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run apps/web/src/table apps/web/src/game`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
npx biome format --write apps/web/src/table/useTableSocket.ts apps/web/src/table/useTableSocket.test.ts apps/web/src/game/useRoom.ts apps/web/src/game/useRoom.test.ts
git add apps/web/src/table apps/web/src/game
git commit -m "feat(web): leave a table the server has closed"
```

---

### Task 11: Whole-repo verification

- [ ] **Step 1:** `npm test` — expect every suite to pass. Run it twice: a close test that passes once and fails once is a flake, and flakes are bugs (CLAUDE.md), so find the race instead of re-running.
- [ ] **Step 2:** `npm run typecheck` — expect clean.
- [ ] **Step 3:** `npm run lint` — expect clean.
- [ ] **Step 4:** `rg "owedOut|taunts.forget" --glob '!docs/**'` — expect no leftover callers that should use the new paths (`forget` may remain defined, but nothing in `server.ts` should call it).
- [ ] **Step 5:** Commit any formatting fallout: `git commit -am "chore: format"` (only if there is any).
