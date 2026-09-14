# Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A leaderboard at `/leaderboard`, reachable from the home page, listing every player with their chips, win rate, W–L, net chips won and chips staked, updating live.

**Architecture:** One new figure (`chipsStaked`) joins `ProfileStats` and rides in the `shared` stat bump every game already writes at the end of a hand. One new `Store` method answers the whole board — rows, the viewer's own standing, and the total — because a rank is a position in the collection rather than a property of a row. One signed-in-only REST route serves it, and one React page polls that route every ten seconds and slides rows to their new ranks when the order changes.

**Tech Stack:** TypeScript, vitest, express, mongoose, React 18 + react-router-dom, testing-library, biome.

**Spec:** `docs/superpowers/specs/2026-09-10-leaderboard-design.md` — read it before Task 1. It argues for every decision below.

## Global Constraints

- **The server is the only authority.** The client may show a rule; it may never be the thing enforcing one. The board's limit, its sort validation and its ranking are all decided server-side.
- **`PublicPlayer` does not change.** The leaderboard gets its own row type. No existing caller may start receiving balances.
- **The route is behind a sign-in.** 401 `{ error: "Sign in first." }` when signed out.
- **Play money and free rounds stake nothing.** The staked counter rides in the existing `shared` bump, which greed already skips unless `forChips`, roulette skips for a for-fun table, and slots already zeroes for a free spin. Do not add the counter anywhere outside that bump.
- **`prefers-reduced-motion` turns every animation off**, and the page still says everything without them.
- **375px is the width to check.** Nothing scrolls sideways.
- **Every task ends green:** `npm test`, `npm run typecheck`, `npm run lint`.
- **Formatting:** `npx biome format --write <the files you touched>`. Never `biome check --write` across the repo — it applies an import-ordering assist this project deliberately leaves off.
- **Before adding to a stylesheet, `grep` that something imports it.** This repo has had orphan `.css` files.
- **Comments say why, not what.**

---

### Task 1: `chipsStaked` joins the shared stats

The one piece of new data in the whole design. Nothing writes to it yet — Task 2 does that — but the field, its zero default and its summing all land here so the rest of the plan can rely on them.

**Files:**
- Modify: `packages/economy/src/store.ts` (the `ProfileStats` interface, `emptyStats()`)
- Modify: `packages/economy/src/mongo-store.ts` (`statsSchema`, `toProfile`)
- Modify: `packages/core/src/game.ts:172` (the adapter-facing `shared` bump type)
- Test: `packages/economy/src/store.test.ts`
- Test: `packages/economy/src/mongo-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ProfileStats.chipsStaked: number`; `emptyStats()` returning it as `0`; `StatBumpLike["shared"]` in core accepting `chipsStaked?: number`.

- [ ] **Step 1: Write the failing tests**

In `packages/economy/src/store.test.ts`, add:

```ts
describe("chips staked", () => {
  it("starts at nothing and sums like the other shared totals", async () => {
    const store = new MemoryStore();
    const player = await store.upsertDiscordUser({
      discordId: "d1",
      name: "Ada",
      avatar: null,
      accentColor: null,
    });
    expect(player.stats.chipsStaked).toBe(0);

    await store.bumpStats(player.id, { shared: { games: 1, wins: 0, chipsWon: -50, chipsStaked: 50 } });
    await store.bumpStats(player.id, { shared: { games: 1, wins: 1, chipsWon: 30, chipsStaked: 20 } });

    const after = await store.get(player.id);
    expect(after?.stats.chipsStaked).toBe(70);
    // The net is still a net: it went down fifty and up thirty.
    expect(after?.stats.chipsWon).toBe(-20);
  });
});
```

In `packages/economy/src/mongo-store.test.ts`, inside the existing `describe.skipIf(...)` block, add:

```ts
it("reads an account written before staking was counted as having staked nothing", async () => {
  const player = await newPlayer();
  // An account exactly as it was before this field existed. `$unset` is the
  // only honest way to make one: a document that has never held the field.
  await mongoose.connection
    .collection("users")
    .updateOne({ _id: new mongoose.Types.ObjectId(player.id) }, { $unset: { "stats.chipsStaked": "" } });

  const before = await store.get(player.id);
  expect(before?.stats.chipsStaked).toBe(0);

  await store.bumpStats(player.id, { shared: { chipsStaked: 40 } });

  const after = await store.get(player.id);
  expect(after?.stats.chipsStaked).toBe(40);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run packages/economy/src/store.test.ts -t "chips staked"`
Expected: FAIL — `expect(received).toBe(0)` with `received: undefined`, because `emptyStats()` has no such field.

(The Mongo test is skipped without a database. To watch it fail too:
`docker run -d --name backroom-test-mongo -p 27018:27017 mongo:7` then
`MONGO_TEST_URL=mongodb://localhost:27018/backroom-test npx vitest run packages/economy/src/mongo-store.test.ts`.
If you cannot run a mongod, say so in your report rather than claiming the test passed.)

- [ ] **Step 3: Add the field**

In `packages/economy/src/store.ts`, in `ProfileStats`:

```ts
/** What every game can answer about a player, whatever the game is. */
export interface ProfileStats {
  games: number;
  wins: number;
  chipsWon: number;
  /**
   * Chips put on the felt, win or lose.
   *
   * Not the opposite of `chipsWon`, which is a net: somebody who turns over a
   * million chips and finishes level has done something, and the net says they
   * did nothing. A free round stakes nothing, because nothing was staked.
   */
  chipsStaked: number;
}
```

And in `emptyStats()`:

```ts
export function emptyStats(): ProfileStats {
  return { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 };
}
```

In `packages/economy/src/mongo-store.ts`, in `statsSchema`:

```ts
const statsSchema = new mongoose.Schema<ProfileStats>(
  {
    games: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    chipsWon: { type: Number, default: 0 },
    chipsStaked: { type: Number, default: 0 },
  },
  { _id: false },
);
```

And in `toProfile`, beside its siblings:

```ts
    stats: {
      games: doc.stats?.games ?? 0,
      wins: doc.stats?.wins ?? 0,
      chipsWon: doc.stats?.chipsWon ?? 0,
      chipsStaked: doc.stats?.chipsStaked ?? 0,
    },
```

In `packages/core/src/game.ts`, at line 172:

```ts
  shared?: { games?: number; wins?: number; chipsWon?: number; chipsStaked?: number };
```

Nothing else needs changing: `MemoryStore.bumpStats` walks `Object.entries(bump.shared)` and adds, and `MongoStore.bumpStats` turns each into an `$inc`, which treats a missing field as zero.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run packages/economy packages/core`
Expected: PASS.

Run: `npm run typecheck`
Expected: clean. If a test fixture somewhere builds a `ProfileStats` literal by hand it will fail here — add `chipsStaked: 0` to it rather than loosening the type.

- [ ] **Step 5: Format and commit**

```bash
npx biome format --write packages/economy/src/store.ts packages/economy/src/mongo-store.ts packages/economy/src/store.test.ts packages/economy/src/mongo-store.test.ts packages/core/src/game.ts
git add packages/economy/src/store.ts packages/economy/src/mongo-store.ts packages/economy/src/store.test.ts packages/economy/src/mongo-store.test.ts packages/core/src/game.ts
git commit -m "feat(economy): count what a player puts on the felt"
```

---

### Task 2: Every game stakes what it took

Four call sites, each one line, each beside the subtraction that already computes the net.

**Files:**
- Modify: `games/greed/src/adapter.ts:183-187`
- Modify: `games/blackjack/src/adapter.ts:550-554`
- Modify: `games/roulette/src/adapter.ts:310-314`
- Modify: `apps/server/src/server.ts:2396`
- Test: `games/greed/src/adapter.test.ts`
- Test: `games/blackjack/src/adapter.test.ts`
- Test: `games/roulette/src/adapter.test.ts`
- Test: `apps/server/src/slots.test.ts`

**Interfaces:**
- Consumes: `StatBumpLike["shared"].chipsStaked` from Task 1.
- Produces: nothing new. After this task `profile.stats.chipsStaked` is a real figure.

- [ ] **Step 1: Write the failing test for greed**

In `games/greed/src/adapter.test.ts`:

```ts
it("stakes the buy-in on everybody who played for it", async () => {
  const adapter = greedAdapter({ roll: sixes });
  const room = playOut(500);
  expect(room.status).toBe("over");

  const book = ledger();
  await adapter.settle(room, book.deps);

  expect(book.recorded).toHaveLength(2);
  expect(book.recorded.map((entry) => entry.bump.shared?.chipsStaked)).toEqual([500, 500]);
});
```

`playOut(buyIn)` and `ledger()` are the file's own helpers, at the top of it — the test above is the shape of "puts a game played for chips on both players' records", which is already in that file. Do not invent a new harness.

A play-money game needs no new test: the adapter's `if (seat.userId === null || !forChips) continue;` guard sits above the record, and the file already covers it.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run games/greed/src/adapter.test.ts -t "stakes the buy-in"`
Expected: FAIL — `expected undefined to be 500`.

- [ ] **Step 3: Make greed stake the buy-in**

`games/greed/src/adapter.ts`, in the `deps.record` call:

```ts
        shared: {
          games: 1,
          wins: seat.won ? 1 : 0,
          chipsWon: seat.got - buyIn,
          chipsStaked: buyIn,
        },
```

- [ ] **Step 4: Run it**

Run: `npx vitest run games/greed/src/adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Repeat for blackjack — test first**

In `games/blackjack/src/adapter.test.ts`, add a test that plays a seat through a hand at a known bet and asserts the recorded bump. The file's `ledger()` helper currently has `async record() {}`; give your test its own deps object that captures instead, in the style of the one at line 271:

```ts
it("stakes what the seat put out, not what came back", async () => {
  let staked: number | null = null;
  const game = blackjackAdapter();
  const table = game.create("TEST1");
  table.join("a", "Ada", identity("u1"));
  seatCompany(table);
  const { deps } = ledger({ u1: 10_000 });
  const watching: GameDeps = {
    ...deps,
    async record(_userId, entry) {
      staked = entry.shared?.chipsStaked ?? null;
    },
  };

  await game.act(table, "a", { type: "bet", amount: 1000 }, watching);
  await game.act(table, "a", { type: "deal" }, watching);
  while (table.phase === "playing") {
    await game.act(table, "a", { type: "stand" }, watching);
  }
  await game.settle(table, watching);

  // A thousand, whatever came back — a hand that won 2,000 still staked 1,000.
  expect(staked).toBe(1000);
});
```

`identity()`, `seatCompany()` and `ledger()` are the file's own helpers; this is the shape of "only ever gives at settlement, because the stakes are already gone", which is already in that file.

Run it, watch it fail (`expected null to be 1000`), then change `games/blackjack/src/adapter.ts`:

```ts
          shared: {
            games: 1,
            wins: seat.back > seat.out ? 1 : 0,
            chipsWon: seat.back - seat.out,
            chipsStaked: seat.out,
          },
```

`seat.out` is what the seat put out across the hand including splits and doubles, which is exactly what was staked.

Run: `npx vitest run games/blackjack/src/adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Repeat for roulette — test first**

In `games/roulette/src/adapter.test.ts`, using the existing `spy()` and `purse()` helpers:

```ts
it("stakes what was on the felt, and records nothing at a for-fun table", async () => {
  const { bank } = purse(1_000_000);
  const game = rouletteAdapter({ bank, pick: () => 0 });
  const table = game.create("ABCDE") as Table;
  table.join("s1", "Ada", who("u1"));
  const { deps } = spy();

  await game.act(table, "s1", { type: "place", spotId: RED, chips: 200 }, deps);
  await game.act(table, "s1", { type: "place", spotId: RED, chips: 100 }, deps);
  await game.settle(table, deps);

  expect(deps.record).toHaveBeenCalledWith(
    "u1",
    expect.objectContaining({ shared: expect.objectContaining({ chipsStaked: 300 }) }),
  );
});
```

Run it, watch it fail, then change `games/roulette/src/adapter.ts`:

```ts
          shared: {
            games: 1,
            wins: paid.back > paid.staked ? 1 : 0,
            chipsWon: paid.back - paid.staked,
            chipsStaked: paid.staked,
          },
```

The for-fun half of the test needs no new code — the adapter already `continue`s past the record for a `table.forFun` table — but assert it, because that guard is the only thing keeping play money off a board of accounts.

Run: `npx vitest run games/roulette/src/adapter.test.ts`
Expected: PASS.

- [ ] **Step 7: Repeat for slots — test first**

In `apps/server/src/slots.test.ts`, following the file's existing harness for spinning:

```ts
it("stakes what the spin cost, and a free spin costs nothing", async () => {
  // Spin once paid, then take a free spin, then read the profile.
  // ...
  const profile = await store.get(playerId);
  expect(profile?.stats.chipsStaked).toBe(stake);
});
```

Run it, watch it fail, then change `apps/server/src/server.ts:2396`:

```ts
            shared: { games: 1, wins: won > cost ? 1 : 0, chipsWon: won - cost, chipsStaked: cost },
```

`cost` is already `wasFree ? 0 : stake`, three lines above — the same variable the wall uses so a free spin never advertises chips nobody put down. Do not reach past it for `stake`.

Run: `npx vitest run apps/server/src/slots.test.ts`
Expected: PASS.

- [ ] **Step 8: Whole suite, then format and commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean.

```bash
npx biome format --write games/greed/src/adapter.ts games/greed/src/adapter.test.ts games/blackjack/src/adapter.ts games/blackjack/src/adapter.test.ts games/roulette/src/adapter.ts games/roulette/src/adapter.test.ts apps/server/src/server.ts apps/server/src/slots.test.ts
git add games apps/server/src/server.ts apps/server/src/slots.test.ts
git commit -m "feat(games): every game says what it staked"
```

---

### Task 3: The board, out of the memory store

**Files:**
- Modify: `packages/economy/src/store.ts` (types, the `Store` method, `MemoryStore` implementation)
- Modify: `packages/economy/src/index.ts` (exports)
- Test: `packages/economy/src/store.test.ts`

**Interfaces:**
- Consumes: `ProfileStats.chipsStaked` (Task 1).
- Produces:
  - `LEADER_SORTS: readonly ["chips", "net", "staked", "games", "wins"]`
  - `type LeaderSort = (typeof LEADER_SORTS)[number]`
  - `interface LeaderRow { id: string; name: string; avatar: string | null; accentColor: number | null; chips: number; stats: ProfileStats }`
  - `interface LeaderBoard { rows: LeaderRow[]; you: { row: LeaderRow; rank: number } | null; total: number }`
  - `leaderValue(row: { chips: number; stats: ProfileStats }, sort: LeaderSort): number`
  - `Store.leaderboard(input: { sort: LeaderSort; limit: number; you: string | null }): Promise<LeaderBoard>`

- [ ] **Step 1: Write the failing tests**

In `packages/economy/src/store.test.ts`:

```ts
describe("the leaderboard", () => {
  /** Four players with the balances a test needs, in the order it names them. */
  async function room(store: MemoryStore, chips: number[]) {
    const ids: string[] = [];
    for (const [index, amount] of chips.entries()) {
      const player = await store.upsertDiscordUser({
        discordId: `d${index}`,
        name: `P${index}`,
        avatar: null,
        accentColor: null,
      });
      await store.adjustChips(player.id, amount - player.chips);
      ids.push(player.id);
    }
    return ids;
  }

  it("orders by chips, richest first", async () => {
    const store = new MemoryStore();
    await room(store, [100, 900, 500]);
    const board = await store.leaderboard({ sort: "chips", limit: 10, you: null });
    expect(board.rows.map((row) => row.chips)).toEqual([900, 500, 100]);
    expect(board.total).toBe(3);
    expect(board.you).toBeNull();
  });

  it("gives everybody on the same figure the same rank, and skips the ones they used up", async () => {
    const store = new MemoryStore();
    const [, , , fourth] = await room(store, [900, 500, 500, 500, 100]);
    const board = await store.leaderboard({ sort: "chips", limit: 10, you: fourth });
    // Three tied for 2nd, so the next one down is 5th and each of the three is 2nd.
    expect(board.you?.rank).toBe(2);
    const last = await store.leaderboard({ sort: "chips", limit: 10, you: (await room(store, []))[0] ?? null });
    expect(last.you).toBeNull();
  });

  it("answers your rank even when you are off the end of the page", async () => {
    const store = new MemoryStore();
    const ids = await room(store, [900, 800, 700, 600, 500]);
    const board = await store.leaderboard({ sort: "chips", limit: 2, you: ids[4] as string });
    expect(board.rows).toHaveLength(2);
    expect(board.you?.rank).toBe(5);
    expect(board.you?.row.id).toBe(ids[4]);
    expect(board.total).toBe(5);
  });

  it("orders by each of the other columns", async () => {
    const store = new MemoryStore();
    const [a, b] = await room(store, [100, 100]);
    await store.bumpStats(a as string, { shared: { games: 1, wins: 1, chipsWon: 10, chipsStaked: 5 } });
    await store.bumpStats(b as string, { shared: { games: 9, wins: 0, chipsWon: -10, chipsStaked: 900 } });

    const byStaked = await store.leaderboard({ sort: "staked", limit: 10, you: null });
    expect(byStaked.rows[0]?.id).toBe(b);
    const byNet = await store.leaderboard({ sort: "net", limit: 10, you: null });
    expect(byNet.rows[0]?.id).toBe(a);
    const byGames = await store.leaderboard({ sort: "games", limit: 10, you: null });
    expect(byGames.rows[0]?.id).toBe(b);
    const byWins = await store.leaderboard({ sort: "wins", limit: 10, you: null });
    expect(byWins.rows[0]?.id).toBe(a);
  });

  it("hands out no balance to anybody the board did not ask about", async () => {
    const store = new MemoryStore();
    await room(store, [100]);
    const board = await store.leaderboard({ sort: "chips", limit: 10, you: null });
    expect(Object.keys(board.rows[0] as object).sort()).toEqual(
      ["accentColor", "avatar", "chips", "id", "name", "stats"].sort(),
    );
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run packages/economy/src/store.test.ts -t "the leaderboard"`
Expected: FAIL — `store.leaderboard is not a function`.

- [ ] **Step 3: Add the types and the method**

In `packages/economy/src/store.ts`, near `PublicPlayer`:

```ts
/**
 * The columns a board may be ordered by.
 *
 * A win rate is not among them, and will not be. It is a ratio of two stored
 * numbers, so there is no index for it — and a player with one lucky hand sits
 * at a hundred percent forever, which makes a board of people who have played
 * once. Every row prints its rate; no column sorts by it.
 */
export const LEADER_SORTS = ["chips", "net", "staked", "games", "wins"] as const;
export type LeaderSort = (typeof LEADER_SORTS)[number];

/**
 * A player as the board prints them.
 *
 * Deliberately not `PublicPlayer`. That type exists to carry no balance and
 * this one exists to carry one, so they are two types rather than one with a
 * flag — nothing that asks who somebody is should ever start being told what
 * they hold because a field was added in the wrong place.
 */
export interface LeaderRow {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  stats: ProfileStats;
}

export interface LeaderBoard {
  rows: LeaderRow[];
  /** The viewer's own standing, wherever they finished. Null if nobody asked. */
  you: { row: LeaderRow; rank: number } | null;
  total: number;
}

/** The figure a sort orders by, read off one row. */
export function leaderValue(row: { chips: number; stats: ProfileStats }, sort: LeaderSort): number {
  switch (sort) {
    case "chips":
      return row.chips;
    case "net":
      return row.stats.chipsWon;
    case "staked":
      return row.stats.chipsStaked;
    case "games":
      return row.stats.games;
    case "wins":
      return row.stats.wins;
  }
}

export function toLeaderRow(profile: {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  stats: ProfileStats;
}): LeaderRow {
  return {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    accentColor: profile.accentColor,
    chips: profile.chips,
    // Copied rather than handed out, for the same reason `toProfile` copies it.
    stats: { ...profile.stats },
  };
}
```

On the `Store` interface, beside `findPlayers`:

```ts
  /**
   * Who is ahead.
   *
   * The one route in the building that publishes balances, which is the exact
   * opposite of what `PublicPlayer` above exists to refuse — see the design
   * doc for why that exception is allowed and how it is kept narrow.
   *
   * Rows and the viewer's own standing come back together because a rank is a
   * position in the whole collection rather than a property of a row: a caller
   * that asked for a page and then went looking for itself would be answering
   * a different question from the one the page answered.
   */
  leaderboard(input: { sort: LeaderSort; limit: number; you: string | null }): Promise<LeaderBoard>;
```

In `MemoryStore`, beside `findPlayers`:

```ts
  async leaderboard({
    sort,
    limit,
    you,
  }: {
    sort: LeaderSort;
    limit: number;
    you: string | null;
  }): Promise<LeaderBoard> {
    const everyone = [...this.people.values()].map(toLeaderRow).sort((a, b) => {
      const apart = leaderValue(b, sort) - leaderValue(a, sort);
      // Id as the tiebreak, so two players on the same figure do not swap
      // places between one poll and the next and make the board animate a
      // reorder that never happened.
      return apart !== 0 ? apart : a.id.localeCompare(b.id);
    });
    const mine = you === null ? null : (everyone.find((row) => row.id === you) ?? null);
    return {
      rows: everyone.slice(0, limit),
      you:
        mine === null
          ? null
          : {
              row: mine,
              // One more than however many are strictly ahead, so everybody on
              // the same figure shares a rank and the next one down skips.
              rank:
                everyone.filter((row) => leaderValue(row, sort) > leaderValue(mine, sort)).length + 1,
            },
      total: everyone.length,
    };
  }
```

In `packages/economy/src/index.ts`, add to the existing export lines:

```ts
export { BANKS, LEADER_SORTS, MemoryStore, STARTING_CHIPS, emptyJarRecord, emptyStats, leaderValue, toLeaderRow } from "./store.js";
export type {
  BankName,
  GameRecord,
  JarRecord,
  LeaderBoard,
  LeaderRow,
  LeaderSort,
  Profile,
  ProfileStats,
  PublicPlayer,
  StatBump,
  Store,
} from "./store.js";
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/economy`
Expected: PASS. `npm run typecheck` will now fail for `MongoStore`, which does not implement the new method — that is Task 4, and it is the next thing you do.

- [ ] **Step 5: Commit**

```bash
npx biome format --write packages/economy/src/store.ts packages/economy/src/store.test.ts packages/economy/src/index.ts
git add packages/economy/src/store.ts packages/economy/src/store.test.ts packages/economy/src/index.ts
git commit -m "feat(economy): a board of who is ahead, out of the memory store"
```

---

### Task 4: The board, out of Mongo

**Files:**
- Modify: `packages/economy/src/mongo-store.ts` (indexes, `leaderboard`)
- Test: `packages/economy/src/mongo-store.test.ts`

**Interfaces:**
- Consumes: `LeaderSort`, `LeaderBoard`, `leaderValue`, `toLeaderRow` (Task 3).
- Produces: `MongoStore.leaderboard`, same signature. The two implementations must agree on ordering and on ties.

- [ ] **Step 1: Write the failing test**

In `packages/economy/src/mongo-store.test.ts`, inside the `describe.skipIf(...)`:

```ts
it("orders by chips and answers a rank from outside the page", async () => {
  const rich = await newPlayer();
  const middle = await newPlayer();
  const poor = await newPlayer();
  await store.adjustChips(rich.id, 5_000);
  await store.adjustChips(poor.id, -5_000);

  const board = await store.leaderboard({ sort: "chips", limit: 1, you: poor.id });
  expect(board.rows).toHaveLength(1);
  expect(board.rows[0]?.id).toBe(rich.id);
  expect(board.you?.row.id).toBe(poor.id);
  // Two players hold more than this one, whatever else is in the database.
  expect(board.you?.rank).toBeGreaterThanOrEqual(3);
  expect(middle.id).not.toBe(rich.id);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `MONGO_TEST_URL=mongodb://localhost:27018/backroom-test npx vitest run packages/economy/src/mongo-store.test.ts`
Expected: FAIL — `store.leaderboard is not a function`. If no mongod is available, run `npm run typecheck` and watch it fail on `MongoStore` not implementing `Store`; that is the failing signal you have.

- [ ] **Step 3: Implement it**

In `packages/economy/src/mongo-store.ts`, beside the other `userSchema.index(...)` calls (there are none yet on this schema — put them straight after the schema definition, in the style of `gameSchema.index(...)` at line 103):

```ts
/*
 * One index per column the board can be ordered by. The board reads the whole
 * collection sorted; without these that is a scan on every poll, and the page
 * polls every ten seconds for everybody looking at it.
 */
userSchema.index({ chips: -1 });
userSchema.index({ "stats.chipsWon": -1 });
userSchema.index({ "stats.chipsStaked": -1 });
userSchema.index({ "stats.games": -1 });
userSchema.index({ "stats.wins": -1 });
```

Then the method, beside `findPlayers`:

```ts
  async leaderboard({
    sort,
    limit,
    you,
  }: {
    sort: LeaderSort;
    limit: number;
    you: string | null;
  }): Promise<LeaderBoard> {
    const field = LEADER_FIELDS[sort];
    const docs = await this.users
      .find({})
      // `_id` as the tiebreak, so equal figures come back in the same order on
      // every poll and the page does not animate a reorder that never happened.
      .sort({ [field]: -1, _id: 1 })
      .limit(limit)
      .lean<Array<UserDoc & { _id: mongoose.Types.ObjectId }>>();
    const rows = docs.map((doc) => toLeaderRow(toProfile(doc)));
    const total = await this.users.estimatedDocumentCount();

    if (you === null || !mongoose.Types.ObjectId.isValid(you)) {
      return { rows, you: null, total };
    }
    const mine = await this.users.findById(you).lean<UserDoc & { _id: mongoose.Types.ObjectId }>();
    if (mine === null) {
      return { rows, you: null, total };
    }
    const row = toLeaderRow(toProfile(mine));
    /*
     * A count of who is strictly ahead, so everybody on the same figure shares
     * a rank. A document written before `chipsStaked` existed has no such
     * field and so matches no `$gt` — which is the right answer, because a
     * missing figure is a zero and nothing here is ever staked less than none.
     */
    const ahead = await this.users.countDocuments({ [field]: { $gt: leaderValue(row, sort) } });
    return { rows, you: { row, rank: ahead + 1 }, total };
  }
```

With this constant near the top of the file, beside the schemas:

```ts
/** Where each of the board's columns actually lives on a user document. */
const LEADER_FIELDS: Record<LeaderSort, string> = {
  chips: "chips",
  net: "stats.chipsWon",
  staked: "stats.chipsStaked",
  games: "stats.games",
  wins: "stats.wins",
};
```

Add `LeaderBoard`, `LeaderSort`, `leaderValue` and `toLeaderRow` to the existing import from `./store.js` at the top of the file.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `MONGO_TEST_URL=mongodb://localhost:27018/backroom-test npx vitest run packages/economy`
Expected: PASS.

Run: `npm run typecheck`
Expected: clean — `MongoStore` satisfies `Store` again.

- [ ] **Step 5: Commit**

```bash
npx biome format --write packages/economy/src/mongo-store.ts packages/economy/src/mongo-store.test.ts
git add packages/economy/src/mongo-store.ts packages/economy/src/mongo-store.test.ts
git commit -m "feat(economy): the board out of Mongo, with an index per column"
```

---

### Task 5: `GET /api/leaderboard`

Its own module mounted from the server, the way transfers and emotes are — not another block in `server.ts`, which is long enough.

**Files:**
- Create: `apps/server/src/leaderboard.ts`
- Create: `apps/server/src/leaderboard.test.ts`
- Modify: `apps/server/src/server.ts` (import, a budget map beside `sendBudgets` at line 384, the mount beside `mountTransfers` at line 938)

**Interfaces:**
- Consumes: `Store.leaderboard`, `LEADER_SORTS`, `LeaderSort` (Tasks 3–4).
- Produces:
  - `BOARD_LIMIT = 100`
  - `readSort(raw: unknown): LeaderSort`
  - `mountLeaderboard(app: Express, deps: LeaderboardRoutes): void`
  - the route's reply shape: `{ sort: LeaderSort; rows: LeaderRow[]; you: { row: LeaderRow; rank: number } | null; total: number }`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/leaderboard.test.ts`, copying the harness from `apps/server/src/transfers.test.ts` (the `start`, `player` and `get` helpers at the top of that file — repeat them rather than importing, the way that file does):

```ts
import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import { afterEach, describe, expect, it } from "vitest";
import { createBackRoomServer } from "./server.js";
import type { BackRoomServer } from "./server.js";

/**
 * The one route in the building that publishes balances.
 *
 * Which is why most of what is tested here is refusal: that it is shut to
 * somebody signed out, that it hands back the board's columns and nothing
 * else, and that how many rows it gives out is the server's decision.
 */

let server: BackRoomServer | null = null;

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
});

async function start(store: MemoryStore, as: string | null): Promise<string> {
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify: () => as,
    identifyRequest: () => as,
  });
  await new Promise<void>((resolve) => server?.http.listen(0, () => resolve()));
  return `http://localhost:${(server.http.address() as AddressInfo).port}`;
}

async function get(url: string) {
  const response = await fetch(url);
  const text = await response.text();
  return { status: response.status, body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown> };
}

async function player(store: MemoryStore, discordId: string, name: string) {
  return store.upsertDiscordUser({ discordId, name, avatar: null, accentColor: null });
}

describe("the leaderboard route", () => {
  it("is shut to somebody signed out", async () => {
    const store = new MemoryStore();
    const url = await start(store, null);
    const answer = await get(`${url}/api/leaderboard`);
    expect(answer.status).toBe(401);
  });

  it("gives the board, your own standing, and nothing about anybody's account", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    await player(store, "d2", "Bram");
    const url = await start(store, ada.discordId);

    const answer = await get(`${url}/api/leaderboard`);
    expect(answer.status).toBe(200);
    const rows = answer.body["rows"] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0] as object).sort()).toEqual(
      ["accentColor", "avatar", "chips", "id", "name", "stats"].sort(),
    );
    expect(JSON.stringify(answer.body)).not.toContain("discordId");
    expect((answer.body["you"] as { rank: number }).rank).toBeGreaterThan(0);
    expect(answer.body["sort"]).toBe("chips");
  });

  it("falls back to chips when asked to sort by something that is not a column", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const url = await start(store, ada.discordId);
    const answer = await get(`${url}/api/leaderboard?sort=winRate`);
    expect(answer.status).toBe(200);
    expect(answer.body["sort"]).toBe("chips");
  });

  it("sorts by a column it does know", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const bram = await player(store, "d2", "Bram");
    await store.bumpStats(bram.id, { shared: { games: 1, wins: 0, chipsWon: -900, chipsStaked: 900 } });
    const url = await start(store, ada.discordId);
    const answer = await get(`${url}/api/leaderboard?sort=staked`);
    const rows = answer.body["rows"] as Array<{ id: string }>;
    expect(rows[0]?.id).toBe(bram.id);
  });

  it("hands out its own number of rows, whatever the caller asks for", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    await player(store, "d2", "Bram");
    const url = await start(store, ada.discordId);
    const answer = await get(`${url}/api/leaderboard?limit=1`);
    expect((answer.body["rows"] as unknown[]).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run apps/server/src/leaderboard.test.ts`
Expected: FAIL — every case returns 404, because the route does not exist.

- [ ] **Step 3: Write the module**

Create `apps/server/src/leaderboard.ts`:

```ts
import { LEADER_SORTS } from "@backroom/economy";
import type { LeaderSort, Store } from "@backroom/economy";
import type { Express, Request } from "express";

/**
 * Who is ahead.
 *
 * This is the one route in the building that publishes balances, which is the
 * exact opposite of the rule `PublicPlayer` exists to keep. The exception is
 * deliberate and written down in the design doc; what keeps it narrow is here:
 * it is behind a sign-in, it hands back the board's columns and nothing else,
 * and how many rows it gives out is not the caller's decision.
 */

/** How many rows a board carries. Not a query parameter: see above. */
export const BOARD_LIMIT = 100;

/**
 * How often one account may ask.
 *
 * The page polls every ten seconds, six a minute, so this has to sit well
 * clear of that — it is here to stop the route being hammered, not to stop
 * somebody pressing the sort headers.
 */
const BOARD_TRIES = 30;
const BOARD_WINDOW_MS = 60_000;

export interface LeaderboardRoutes {
  store: Store;
  /** The signed-in player, or null. */
  whoIs: (request: Request) => Promise<{ id: string } | null>;
  /** True while this account is inside its allowance of requests. */
  withinBudget: (id: string, max: number, windowMs: number) => boolean;
}

/**
 * The column asked for, or chips.
 *
 * A bad one falls back rather than failing: this is a query parameter on a
 * page somebody linked to, not a command, and a link that has gone stale
 * should show a board rather than an error.
 */
export function readSort(raw: unknown): LeaderSort {
  const wanted = String(raw ?? "");
  return (LEADER_SORTS as readonly string[]).includes(wanted) ? (wanted as LeaderSort) : "chips";
}

export function mountLeaderboard(
  app: Express,
  { store, whoIs, withinBudget }: LeaderboardRoutes,
): void {
  app.get("/api/leaderboard", (request, response) => {
    void (async () => {
      const who = await whoIs(request);
      if (who === null) {
        response.status(401).json({ error: "Sign in first." });
        return;
      }
      if (!withinBudget(`board:${who.id}`, BOARD_TRIES, BOARD_WINDOW_MS)) {
        response.status(429).json({ error: "Slow down." });
        return;
      }
      const sort = readSort(request.query["sort"]);
      const board = await store.leaderboard({ sort, limit: BOARD_LIMIT, you: who.id });
      response.json({ sort, ...board });
    })();
  });
}
```

In `apps/server/src/server.ts`:

```ts
import { mountLeaderboard } from "./leaderboard.js";       // beside line 78
```

```ts
  const boardBudgets = new Map<string, Budget>();          // beside line 384
```

```ts
  mountLeaderboard(app, {                                   // beside line 938
    store,
    whoIs: async (request) => {
      const profile = await whoIs(request as express.Request);
      return profile === null ? null : { id: profile.id };
    },
    withinBudget: (id, max, windowMs) => withinBudget(boardBudgets, id, max, windowMs),
  });
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx biome format --write apps/server/src/leaderboard.ts apps/server/src/leaderboard.test.ts apps/server/src/server.ts
git add apps/server/src/leaderboard.ts apps/server/src/leaderboard.test.ts apps/server/src/server.ts
git commit -m "feat(server): a signed-in route for who is ahead"
```

---

### Task 6: What a board says, apart from how it looks

Pure functions, so the arithmetic of the page is tested without a DOM in the way.

**Files:**
- Create: `apps/web/src/leaderboard/board.ts`
- Create: `apps/web/src/leaderboard/board.test.ts`

**Interfaces:**
- Consumes: the route's reply shape from Task 5.
- Produces:
  - `type BoardSort = "chips" | "net" | "staked" | "games" | "wins"`
  - `interface BoardRow { id: string; name: string; avatar: string | null; accentColor: number | null; chips: number; stats: { games: number; wins: number; chipsWon: number; chipsStaked: number } }`
  - `interface Board { sort: BoardSort; rows: BoardRow[]; you: { row: BoardRow; rank: number } | null; total: number }`
  - `winRate(stats: BoardRow["stats"]): number`
  - `figure(row: BoardRow, sort: BoardSort): number`
  - `ranked(rows: BoardRow[], sort: BoardSort): Array<{ row: BoardRow; rank: number }>`
  - `pinned(board: Board): { row: BoardRow; rank: number } | null`
  - `COLUMNS: ReadonlyArray<{ sort: BoardSort; label: string }>`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/leaderboard/board.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pinned, ranked, winRate } from "./board.js";
import type { Board, BoardRow } from "./board.js";

const row = (id: string, chips: number, stats: Partial<BoardRow["stats"]> = {}): BoardRow => ({
  id,
  name: id,
  avatar: null,
  accentColor: null,
  chips,
  stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0, ...stats },
});

describe("what a board says", () => {
  it("calls nobody's win rate a nothing-over-nothing", () => {
    expect(winRate({ games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 })).toBe(0);
    expect(winRate({ games: 4, wins: 1, chipsWon: 0, chipsStaked: 0 })).toBe(25);
  });

  it("gives everybody on the same figure the same rank, and skips after a tie", () => {
    const rows = [row("a", 900), row("b", 500), row("c", 500), row("d", 100)];
    expect(ranked(rows, "chips").map((entry) => entry.rank)).toEqual([1, 2, 2, 4]);
  });

  it("pins you to the bottom only when you are off the end of the page", () => {
    const rows = [row("a", 900), row("b", 500)];
    const off: Board = { sort: "chips", rows, you: { row: row("z", 1), rank: 340 }, total: 340 };
    expect(pinned(off)?.rank).toBe(340);

    const on: Board = { sort: "chips", rows, you: { row: rows[1] as BoardRow, rank: 2 }, total: 2 };
    expect(pinned(on)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run apps/web/src/leaderboard/board.test.ts`
Expected: FAIL — cannot resolve `./board.js`.

- [ ] **Step 3: Write it**

Create `apps/web/src/leaderboard/board.ts`:

```ts
/**
 * The arithmetic of the board, apart from the drawing of it.
 *
 * Here rather than inside the component because none of it is about React:
 * a rank is a rank whether anybody is looking, and it is worth being able to
 * push at these without a DOM in the way.
 */

export type BoardSort = "chips" | "net" | "staked" | "games" | "wins";

export interface BoardRow {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  stats: { games: number; wins: number; chipsWon: number; chipsStaked: number };
}

export interface Board {
  sort: BoardSort;
  rows: BoardRow[];
  you: { row: BoardRow; rank: number } | null;
  total: number;
}

/** The columns you can order by, in the order they are written across a row. */
export const COLUMNS: ReadonlyArray<{ sort: BoardSort; label: string }> = [
  { sort: "chips", label: "chips" },
  { sort: "net", label: "net" },
  { sort: "staked", label: "staked" },
  { sort: "games", label: "games" },
  { sort: "wins", label: "wins" },
];

/** Wins as a percentage. Nobody who has played nothing has won nothing. */
export function winRate(stats: BoardRow["stats"]): number {
  return stats.games === 0 ? 0 : Math.round((stats.wins / stats.games) * 100);
}

export function figure(row: BoardRow, sort: BoardSort): number {
  switch (sort) {
    case "chips":
      return row.chips;
    case "net":
      return row.stats.chipsWon;
    case "staked":
      return row.stats.chipsStaked;
    case "games":
      return row.stats.games;
    case "wins":
      return row.stats.wins;
  }
}

/**
 * The rank against each row, off the order the server sent.
 *
 * Ties share a number and the next one down skips the ones they used up —
 * three players second means the next is fifth. The rows are not re-sorted
 * here: the server decided the order, and a client that decided it again
 * would be a client with an opinion about who is winning.
 */
export function ranked(rows: BoardRow[], sort: BoardSort): Array<{ row: BoardRow; rank: number }> {
  let rank = 0;
  let last: number | null = null;
  return rows.map((row, index) => {
    const value = figure(row, sort);
    if (last === null || value !== last) {
      rank = index + 1;
      last = value;
    }
    return { row, rank };
  });
}

/**
 * Your own row, when the page you are looking at does not contain it.
 *
 * Null when you are already on the board, because a row printed twice reads
 * as two people. Pinning it rather than renumbering you into the last place
 * on the page: a board that quietly calls you hundredth is lying.
 */
export function pinned(board: Board): { row: BoardRow; rank: number } | null {
  if (board.you === null) {
    return null;
  }
  return board.rows.some((row) => row.id === board.you?.row.id) ? null : board.you;
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run apps/web/src/leaderboard/board.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx biome format --write apps/web/src/leaderboard/board.ts apps/web/src/leaderboard/board.test.ts
git add apps/web/src/leaderboard
git commit -m "feat(web): the arithmetic of a leaderboard"
```

---

### Task 7: The page

Static first: it renders rows, it re-sorts, it pins you, it reads on a phone. The polling and the sliding are Task 8.

**Files:**
- Create: `apps/web/src/leaderboard/Leaderboard.tsx`
- Create: `apps/web/src/leaderboard/leaderboard.css`
- Create: `apps/web/src/leaderboard/Leaderboard.test.tsx`
- Create: `apps/web/src/leaderboard/leaderboard.css.test.ts`
- Modify: `apps/web/src/main.tsx` (import the stylesheet beside `./tips/tips.css`)
- Modify: `apps/web/src/App.tsx` (the route, with the other static segments)

**Interfaces:**
- Consumes: `Board`, `BoardRow`, `BoardSort`, `COLUMNS`, `ranked`, `pinned`, `winRate` (Task 6); `GET /api/leaderboard?sort=` (Task 5); `Navbar`, `Avatar`, `Digits`, `useAccount`, `compact`, `exact` from the existing web source.
- Produces: `export function Leaderboard()`, the route `/leaderboard`, and the CSS classes `board`, `board__head`, `board__sort`, `board__row`, `board__row--you`, `board__rank`, `board__who`, `board__chips`, `board__figure`, `board__gap`, `board__note`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/leaderboard/Leaderboard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Leaderboard } from "./Leaderboard.js";

const row = (id: string, name: string, chips: number, stats = {}) => ({
  id,
  name,
  avatar: null,
  accentColor: null,
  chips,
  stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0, ...stats },
});

/** A room where the board answers whatever the test says, and remembers asks. */
function stubFetch(board: unknown) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(url);
      if (url.startsWith("/api/leaderboard")) {
        return { ok: true, json: async () => board };
      }
      if (url === "/api/me") {
        return {
          ok: true,
          json: async () => ({
            signedIn: true,
            signinAvailable: true,
            profile: { id: "u1", name: "Ada", avatar: null, accentColor: null, chips: 900, stats: { games: 0, wins: 0, chipsWon: 0 }, byGame: {} },
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    }),
  );
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the leaderboard page", () => {
  it("prints everybody, their chips and their figures", async () => {
    stubFetch({
      sort: "chips",
      total: 2,
      rows: [row("u1", "Ada", 900, { games: 4, wins: 3, chipsWon: 400, chipsStaked: 1200 }), row("u2", "Bram", 100)],
      you: null,
    });
    render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Ada")).toBeTruthy();
    expect(screen.getByText("Bram")).toBeTruthy();
    // Three wins in four games, said as a rate rather than left to be worked out.
    expect(screen.getByText("75%")).toBeTruthy();
  });

  it("asks the server again when a column is pressed", async () => {
    const asked = stubFetch({ sort: "chips", total: 1, rows: [row("u1", "Ada", 900)], you: null });
    render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );
    await screen.findByText("Ada");

    await userEvent.click(screen.getByRole("button", { name: /staked/i }));

    await waitFor(() => {
      expect(asked.some((url) => url.includes("sort=staked"))).toBe(true);
    });
  });

  it("pins you to the bottom when you are off the end of the board", async () => {
    stubFetch({
      sort: "chips",
      total: 340,
      rows: [row("u9", "Someone", 900)],
      you: { row: row("u1", "Ada", 5), rank: 340 },
    });
    render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("340")).toBeTruthy();
    expect(screen.getByText("Ada")).toBeTruthy();
  });

  it("says to sign in rather than showing an empty board", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/me") {
          return { ok: true, json: async () => ({ signedIn: false, signinAvailable: true }) };
        }
        return { ok: false, status: 401, json: async () => ({ error: "Sign in first." }) };
      }),
    );
    render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/sign in/i)).toBeTruthy();
  });
});
```

Create `apps/web/src/leaderboard/leaderboard.css.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Two promises the building makes that a component test cannot see: that the
 * sheet is actually loaded, and that everything it animates has an off switch.
 * There have been orphan stylesheets in this repo, and rules added to one are
 * silently dead.
 */

const find = (...candidates: string[]) =>
  readFileSync(candidates.find((path) => existsSync(path)) as string, "utf8");

const css = find(
  resolve(process.cwd(), "apps/web/src/leaderboard/leaderboard.css"),
  resolve(process.cwd(), "src/leaderboard/leaderboard.css"),
);
const main = find(
  resolve(process.cwd(), "apps/web/src/main.tsx"),
  resolve(process.cwd(), "src/main.tsx"),
);

describe("the board's stylesheet", () => {
  it("is actually loaded", () => {
    expect(main).toContain("leaderboard/leaderboard.css");
  });

  it("has an off switch for its motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    const off = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(off).toContain(".board__row");
    expect(off).toMatch(/transition:\s*none/);
  });

  it("lets a wide row reflow rather than pushing the page sideways", () => {
    // The row is a grid at width and a wrapped card below the breakpoint; what
    // must never appear is a fixed width or a horizontal scroller on the page.
    expect(css).toContain("@media (max-width:");
    expect(css).not.toMatch(/\.board\s*\{[^}]*overflow-x:\s*scroll/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run apps/web/src/leaderboard`
Expected: FAIL — cannot resolve `./Leaderboard.js`, and the CSS test cannot read the file.

- [ ] **Step 3: Write the page**

Create `apps/web/src/leaderboard/Leaderboard.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "../game/Avatar.js";
import { Digits } from "../game/Digits.js";
import { compact, exact } from "../game/money.js";
import { useAccount } from "../game/useAccount.js";
import { Navbar } from "../nav/Navbar.js";
import { COLUMNS, pinned, ranked, winRate } from "./board.js";
import type { Board, BoardRow, BoardSort } from "./board.js";

/**
 * Who is ahead.
 *
 * The one page in the building that prints other people's balances, which is
 * why it is behind a sign-in and why it says so rather than showing an empty
 * board to somebody who is not.
 */
export function Leaderboard() {
  const account = useAccount();
  const [sort, setSort] = useState<BoardSort>("chips");
  const [board, setBoard] = useState<Board | null>(null);
  const [shut, setShut] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/leaderboard?sort=${sort}`, { credentials: "include" });
    if (response.status === 401) {
      setShut(true);
      return;
    }
    if (!response.ok) {
      // A board that will not answer keeps whatever it last said, rather than
      // replacing everybody with an error nobody can act on.
      return;
    }
    setShut(false);
    setBoard((await response.json()) as Board);
  }, [sort]);

  useEffect(() => {
    void load().catch(() => {
      // Same as above: the last answer is better than no answer.
    });
  }, [load]);

  return (
    <main className="room">
      <Navbar account={account} />
      <p className="room__label">Who's ahead</p>
      {shut ? (
        <p className="panel__note">Sign in to see who's ahead.</p>
      ) : board === null ? (
        <p className="panel__note">Counting.</p>
      ) : (
        <BoardTable board={board} sort={sort} onSort={setSort} you={account.profile?.id ?? null} />
      )}
    </main>
  );
}

function BoardTable({
  board,
  sort,
  onSort,
  you,
}: {
  board: Board;
  sort: BoardSort;
  onSort: (sort: BoardSort) => void;
  you: string | null;
}) {
  const below = pinned(board);

  return (
    <div className="board">
      <div className="board__head">
        {COLUMNS.map((column) => (
          <button
            key={column.sort}
            type="button"
            className={`board__sort${sort === column.sort ? " board__sort--on" : ""}`}
            aria-pressed={sort === column.sort}
            onClick={() => onSort(column.sort)}
          >
            {column.label}
          </button>
        ))}
      </div>

      {ranked(board.rows, board.sort).map((entry) => (
        <Row key={entry.row.id} row={entry.row} rank={entry.rank} mine={entry.row.id === you} />
      ))}

      {below === null ? null : (
        <>
          {/* The distance said out loud rather than closed up: a board that
              quietly renumbers you into the last place on the page is lying. */}
          <p className="board__gap">…{exact(board.total - board.rows.length)} more</p>
          <Row row={below.row} rank={below.rank} mine />
        </>
      )}

      <p className="board__note">
        Chips staked has only been counted since the board opened, so it starts at nothing for
        everybody.
      </p>
    </div>
  );
}

function Row({ row, rank, mine }: { row: BoardRow; rank: number; mine: boolean }) {
  const rate = winRate(row.stats);
  const losses = row.stats.games - row.stats.wins;

  return (
    <div className={`board__row${mine ? " board__row--you" : ""}`} data-id={row.id}>
      <b className="board__rank">{rank}</b>
      <span className="board__who">
        <Avatar
          name={row.name}
          avatar={row.avatar}
          accentColor={row.accentColor}
          className="board__face"
        />
        <span className="board__name">{row.name}</span>
      </span>
      <span className="board__chips" title={`${exact(row.chips)} chips`}>
        <Digits value={compact(row.chips)} />
      </span>
      <span className="board__figure">
        <b>{rate}%</b>
        <small>win rate</small>
      </span>
      <span className="board__figure">
        <b>
          {row.stats.wins}–{losses}
        </b>
        <small>W–L</small>
      </span>
      <span className="board__figure">
        <b className={row.stats.chipsWon < 0 ? "board__down" : "board__up"}>
          {row.stats.chipsWon >= 0 ? "+" : ""}
          {compact(row.stats.chipsWon)}
        </b>
        <small>net</small>
      </span>
      <span className="board__figure">
        <b>{compact(row.stats.chipsStaked)}</b>
        <small>staked</small>
      </span>
    </div>
  );
}
```

Create `apps/web/src/leaderboard/leaderboard.css`. Follow the tokens and idiom of `apps/web/src/game/game.css` — read `.panel`, `.room__label` and the profile's figures before writing, and reuse the variables they use rather than inventing colours:

```css
/*
 * The board.
 *
 * A grid at width and a stack of cards on a phone, because seven figures do
 * not fit across 375px and a table that only lays out on a desk is broken.
 */

.board {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: min(64rem, 100%);
  margin: 0 auto;
}

.board__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0 0.6rem 0.4rem;
}

.board__sort {
  /* A control during a glance, so it is big enough to hit with a thumb. */
  min-height: 2.5rem;
  padding: 0 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--gr-color-smoke-lit);
  background: var(--gr-color-slate);
  color: var(--gr-color-ink-dim);
  font: inherit;
  font-size: var(--gr-text-sm);
  cursor: pointer;
}

.board__sort--on {
  border-color: var(--gr-color-chip-dim);
  background: var(--gr-color-smoke-lit);
  color: var(--gr-color-ink-lit);
}

.board__row {
  display: grid;
  grid-template-columns: 2.5rem minmax(8rem, 1fr) 7rem repeat(4, 5.5rem);
  /* Three named cells and four empty ones: the figures auto-place into those
     in the order the row writes them — rate, W–L, net, staked. */
  grid-template-areas: "rank who chips . . . .";
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.6rem;
  border-radius: 0.6rem;
  background: var(--gr-color-slate);
  /* The one motion a row has: where it sits on the board. Task 8 drives it. */
  transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.board__row--you {
  /* Yours, wherever it falls, without moving it. */
  outline: 1px solid var(--gr-color-chip-dim);
  background: var(--gr-color-smoke);
}

.board__rank {
  grid-area: rank;
  font-family: var(--gr-font-data);
  color: var(--gr-color-ink-dim);
  text-align: right;
}

.board__who {
  grid-area: who;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.board__name {
  /* A long Discord name shortens rather than widening the row. */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board__chips {
  grid-area: chips;
  font-family: var(--gr-font-data);
  color: var(--gr-color-chip-hi);
  text-align: right;
}

.board__figure {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.1;
}

.board__figure small {
  font-size: var(--gr-text-xs);
  color: var(--gr-color-ink-faint);
}

.board__up {
  color: var(--gr-color-good);
}

.board__down {
  color: var(--gr-color-bad);
}

.board__gap,
.board__note {
  text-align: center;
  font-size: var(--gr-text-sm);
  color: var(--gr-color-ink-faint);
}

@media (max-width: 46rem) {
  .board__row {
    /* A card rather than a row: rank, face, name and chips across the top,
       the four smaller figures wrapping underneath. Seven columns do not fit
       across a phone and a table that only lays out on a desk is broken. */
    grid-template-columns: 2.25rem 1fr auto;
    grid-template-areas:
      "rank who chips"
      "figures figures figures";
    row-gap: 0.5rem;
  }

  /* The four figures share one area and lay themselves out inside it. */
  .board__figure {
    grid-area: figures;
    flex-direction: row;
    align-items: baseline;
    gap: 0.3rem;
  }

}

@media (prefers-reduced-motion: reduce) {
  .board__row {
    transition: none;
  }
}
```

Two things to settle while writing it: whether the four figures read better as a nested `.board__figures` flex row than as four elements sharing one grid area (write it whichever way looks right at 375px, and change the component to match), and the exact `max-width` breakpoint — 46rem is a starting point, not a measurement. Take the measurement.

In `apps/web/src/main.tsx`, beside the other page stylesheets:

```ts
import "./leaderboard/leaderboard.css";
```

In `apps/web/src/App.tsx`, with the other static segments and above `/:code`:

```tsx
      <Route path="/leaderboard" element={<Leaderboard />} />
```

with `import { Leaderboard } from "./leaderboard/Leaderboard.js";` at the top.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/web/src/leaderboard`
Expected: PASS.

- [ ] **Step 5: See it, at a phone's width**

Start the dev server and look at `/leaderboard` at 375px wide. Check: nothing scrolls sideways, the sort buttons wrap rather than overflow, and a row reads as a card. Fix the stylesheet until it does.

- [ ] **Step 6: Commit**

```bash
npx biome format --write apps/web/src/leaderboard apps/web/src/main.tsx apps/web/src/App.tsx
git add apps/web/src/leaderboard apps/web/src/main.tsx apps/web/src/App.tsx
git commit -m "feat(web): the leaderboard, at a phone's width"
```

---

### Task 8: It updates live, and you can see who overtook whom

**Files:**
- Create: `apps/web/src/leaderboard/useSlide.ts`
- Create: `apps/web/src/leaderboard/useSlide.test.tsx`
- Modify: `apps/web/src/leaderboard/Leaderboard.tsx` (the poll, and the hook on the list)
- Modify: `apps/web/src/leaderboard/Leaderboard.test.tsx` (a polling test)

**Interfaces:**
- Consumes: everything from Task 7.
- Produces: `useSlide(rows: Array<{ id: string }>): RefObject<HTMLDivElement>` — attach to the element that contains the rows; each row must carry `data-id`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/leaderboard/Leaderboard.test.tsx`:

```tsx
it("asks again on a clock, and shows the new order without being reloaded", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let answer = {
    sort: "chips",
    total: 2,
    rows: [row("u1", "Ada", 900), row("u2", "Bram", 100)],
    you: null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/leaderboard")) {
        return { ok: true, json: async () => answer };
      }
      return { ok: true, json: async () => ({ signedIn: false, signinAvailable: true }) };
    }),
  );

  render(
    <MemoryRouter>
      <Leaderboard />
    </MemoryRouter>,
  );
  await screen.findByText("Ada");

  answer = { ...answer, rows: [row("u2", "Bram", 5000), row("u1", "Ada", 900)] };
  await vi.advanceTimersByTimeAsync(10_000);

  await waitFor(() => {
    const names = screen.getAllByText(/Ada|Bram/).map((node) => node.textContent);
    expect(names[0]).toBe("Bram");
  });
});
```

Create `apps/web/src/leaderboard/useSlide.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSlide } from "./useSlide.js";

/**
 * jsdom lays nothing out, so every element's box is zero and no slide is ever
 * computed. What is worth testing here is therefore not the distance — it is
 * that the hook reads positions before the change and writes a transform after
 * it, on the elements it was given, and that it does neither when the reader
 * has asked for less motion.
 */
function Harness({ ids, reduced }: { ids: string[]; reduced: boolean }) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduced, addEventListener() {}, removeEventListener() {} })),
  );
  const ref = useSlide(ids.map((id) => ({ id })));
  return (
    <div ref={ref}>
      {ids.map((id) => (
        <div key={id} data-id={id} />
      ))}
    </div>
  );
}

describe("sliding a row to its new rank", () => {
  it("moves nothing when nothing has moved", () => {
    const { container, rerender } = render(<Harness ids={["a", "b"]} reduced={false} />);
    rerender(<Harness ids={["a", "b"]} reduced={false} />);
    const first = container.querySelector('[data-id="a"]') as HTMLElement;
    expect(first.style.transform === "" || first.style.transform === "none").toBe(true);
  });

  it("touches nothing at all when the reader has asked for less motion", () => {
    const { container, rerender } = render(<Harness ids={["a", "b"]} reduced />);
    rerender(<Harness ids={["b", "a"]} reduced />);
    const first = container.querySelector('[data-id="a"]') as HTMLElement;
    expect(first.style.transform).toBe("");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run apps/web/src/leaderboard`
Expected: FAIL — cannot resolve `./useSlide.js`, and the polling test times out because nothing asks twice.

- [ ] **Step 3: Write the hook**

Create `apps/web/src/leaderboard/useSlide.ts`:

```ts
import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Rows slide from where they were to where they now are.
 *
 * Overtaking somebody is the one thing this page is for, so it has to be
 * something you watch happen rather than something you notice happened. The
 * old positions are measured before the browser paints the new ones, each row
 * is put back where it was with a transform, and then released — so the
 * distance is real rather than a guess, and a row that did not move does
 * nothing at all.
 *
 * One motion per row: a row that both moves and re-numbers does both inside
 * this one transition, because two animations over one element is the bug.
 */
export function useSlide(rows: Array<{ id: string }>): RefObject<HTMLDivElement> {
  const box = useRef<HTMLDivElement>(null);
  const was = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) {
      return;
    }
    const quiet = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const now = new Map<string, number>();

    for (const child of element.querySelectorAll<HTMLElement>("[data-id]")) {
      const id = child.dataset["id"] as string;
      const top = child.getBoundingClientRect().top;
      now.set(id, top);
      if (quiet) {
        continue;
      }
      const before = was.current.get(id);
      if (before === undefined || before === top) {
        continue;
      }
      // Back to where it was, with no transition, then forward to where it is.
      child.style.transition = "none";
      child.style.transform = `translateY(${before - top}px)`;
      // Read, so the browser takes the jump before the transition is put back.
      void child.offsetHeight;
      child.style.transition = "";
      child.style.transform = "";
    }
    was.current = now;
  }, [rows]);

  return box;
}
```

- [ ] **Step 4: Poll, and hang the hook on the list**

In `Leaderboard.tsx`, add the clock beside the load:

```tsx
  useEffect(() => {
    const tick = () => {
      void load().catch(() => {
        // The last answer is better than no answer.
      });
    };
    tick();
    // The same ten seconds the room refreshes its busyness on: the page is
    // already in that rhythm, and a board rarely changes faster than that.
    const timer = window.setInterval(tick, 10_000);
    return () => window.clearInterval(timer);
  }, [load]);
```

(replacing the plain `useEffect` from Task 7), and in `BoardTable`:

```tsx
  const slide = useSlide(board.rows);
  // ...
    <div className="board" ref={slide}>
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/web/src/leaderboard`
Expected: PASS.

- [ ] **Step 6: Watch it, throttled**

In the browser, open `/leaderboard`, throttle the connection to Slow 3G, and change somebody's balance (win a hand, or use an admin code). The row should slide rather than jump. Then turn on "reduce motion" in the OS and check it simply changes.

- [ ] **Step 7: Commit**

```bash
npx biome format --write apps/web/src/leaderboard
git add apps/web/src/leaderboard
git commit -m "feat(web): the board updates live, and rows slide to their new ranks"
```

---

### Task 9: Getting there from the front door

**Files:**
- Create: `apps/web/src/room/Standings.tsx`
- Create: `apps/web/src/room/Standings.test.tsx`
- Modify: `apps/web/src/room/Room.tsx` (the section, under the tiles)
- Modify: `apps/web/src/leaderboard/leaderboard.css` (the card's rules)

**Interfaces:**
- Consumes: `Board`, `winRate` (Task 6); `GET /api/leaderboard` (Task 5).
- Produces: `export function Standings()`, rendering a `<Link to="/leaderboard">`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/room/Standings.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Standings } from "./Standings.js";

afterEach(() => vi.unstubAllGlobals());

describe("who's ahead, from the front door", () => {
  it("shows the top three and your own place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          sort: "chips",
          total: 40,
          rows: [
            { id: "a", name: "Ada", avatar: null, accentColor: null, chips: 900, stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 } },
            { id: "b", name: "Bram", avatar: null, accentColor: null, chips: 500, stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 } },
            { id: "c", name: "Cyd", avatar: null, accentColor: null, chips: 100, stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 } },
          ],
          you: { row: { id: "z", name: "You", avatar: null, accentColor: null, chips: 5, stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 } }, rank: 12 },
        }),
      })),
    );

    render(
      <MemoryRouter>
        <Standings />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Ada")).toBeTruthy();
    expect(screen.getByText(/12/)).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/leaderboard");
  });

  it("still points at the board when nobody is signed in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    render(
      <MemoryRouter>
        <Standings />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/sign in/i)).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/leaderboard");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/web/src/room/Standings.test.tsx`
Expected: FAIL — cannot resolve `./Standings.js`.

- [ ] **Step 3: Write it**

Create `apps/web/src/room/Standings.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "../game/Avatar.js";
import { compact, exact } from "../game/money.js";
import type { Board } from "../leaderboard/board.js";

/**
 * Who is ahead, from the front door.
 *
 * The top three and your own place, which is the whole of what somebody wants
 * to know without opening the board. Signed out it says so and still links
 * through: a page you cannot see yet is better than a page you never learn is
 * there.
 */
export function Standings() {
  const [board, setBoard] = useState<Board | null>(null);
  const [shut, setShut] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => {
      void fetch("/api/leaderboard", { credentials: "include" })
        .then(async (response) => {
          if (!live) {
            return;
          }
          if (response.status === 401) {
            setShut(true);
            return;
          }
          if (response.ok) {
            setShut(false);
            setBoard((await response.json()) as Board);
          }
        })
        .catch(() => {
          // The last answer is better than an error nobody can act on.
        });
    };
    load();
    // The same clock the room's busyness is on.
    const timer = window.setInterval(load, 10_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Link className="standings" to="/leaderboard">
      {shut || board === null ? (
        <span className="standings__note">Sign in to see who's ahead.</span>
      ) : (
        <>
          <ol className="standings__top">
            {board.rows.slice(0, 3).map((row, index) => (
              <li key={row.id} className="standings__place">
                <b>{index + 1}</b>
                <Avatar
                  name={row.name}
                  avatar={row.avatar}
                  accentColor={row.accentColor}
                  className="standings__face"
                />
                <span className="standings__name">{row.name}</span>
                <span className="standings__chips" title={`${exact(row.chips)} chips`}>
                  {compact(row.chips)}
                </span>
              </li>
            ))}
          </ol>
          {board.you === null ? null : (
            <p className="standings__you">
              You are {board.you.rank} of {exact(board.total)}
            </p>
          )}
        </>
      )}
    </Link>
  );
}
```

In `apps/web/src/room/Room.tsx`, after the machines section and before the bar — the page reads as a gradient from money-and-people down to not-about-money, and a board of balances belongs with the money:

```tsx
      <p className="room__label">Who's ahead</p>
      <div className="room__few">
        <Standings />
      </div>
```

Add the `.standings*` rules to `apps/web/src/leaderboard/leaderboard.css` (already imported), sized so the card is comfortably tappable and wraps at 375px.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/web`
Expected: PASS, including the existing `Room.test.tsx` — its `stubFetch` returns `{ ok: false }` for unknown URLs, which is the "keep quiet" path, so the room still renders. If it does not, fix the component rather than the old test's expectations.

- [ ] **Step 5: Commit**

```bash
npx biome format --write apps/web/src/room/Standings.tsx apps/web/src/room/Standings.test.tsx apps/web/src/room/Room.tsx apps/web/src/leaderboard/leaderboard.css
git add apps/web/src/room apps/web/src/leaderboard/leaderboard.css
git commit -m "feat(web): who's ahead, from the front door"
```

---

### Task 10: Green, and seen

**Files:** none, unless something is wrong.

- [ ] **Step 1: The whole suite**

Run: `npm test`
Expected: clean. If a test elsewhere broke on the new `ProfileStats` field, fix the fixture rather than the type.

- [ ] **Step 2: Types and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Look at it on a phone**

Open `/` and `/leaderboard` at 375px. Check: no sideways scroll on either, the "Who's ahead" card is tappable with a thumb, the sort buttons wrap, and a row reads as a card rather than a squeezed table.

- [ ] **Step 4: Look at it with a slow connection**

Throttle to Slow 3G and load `/leaderboard`. The page must say something immediately ("Counting.") rather than sitting blank, and must keep the board it has when a poll fails.

- [ ] **Step 5: Report**

Say what you ran and what it said. If the Mongo tests were skipped because no mongod was available, say that plainly rather than counting them as passing.
