# The Admin Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/admin` as a tabbed desk (Banks · Players · Codes · Emotes · Log) and give it chip grants, removals, exact balances, per-part player resets, an admin log, and hard emote deletion.

**Architecture:** New store methods on the `Store` interface (both `MemoryStore` and `MongoStore`) do the data work; a new `apps/server/src/admin-desk.ts` mounts the routes behind the existing `requireAdmin`, validated by zod schemas in `@backroom/shared/schemas`; the web admin page is split into one component per tab with its own `admin.css`.

**Tech Stack:** TypeScript, Express 5 + socket.io, Mongoose, zod, React + react-router-dom, Vitest + Testing Library, Biome.

**Spec:** `docs/superpowers/specs/2026-09-14-admin-desk-design.md`

## Global Constraints

- Read `CLAUDE.md` before starting. Comments say why, not what, in the voice of the surrounding code.
- Every admin route answers 404 `{ error: "Not found." }` to non-admins — use the existing `requireAdmin`, never a new check.
- Bulk id lists: at most 500 ids. Amounts: whole numbers, at most 10,000,000; ≥ 1 for add/remove, ≥ 0 for set. Notes: optional, trimmed, at most 120 characters.
- `remove` never takes a balance below zero.
- Reset never deletes the user document, and never changes `_id`, `discordId`, `name`, `avatar` or `accentColor`.
- A reset is refused with 409 while any targeted player is seated at a live table (for `{ all: true }`: any table with a non-bot seat that has a `userId`).
- `emptyBanks` only with `{ all: true }`.
- Users list pages 50 at a time; `listUsers` caps `limit` at 100. Log pages 50 at a time.
- Every page checked at 375px wide; nothing scrolls sideways; every keyframe has a `prefers-reduced-motion` off switch.
- After editing: `npx biome format --write <files you touched>` — **never** `biome check --write`.
- `npm test`, `npm run typecheck`, `npm run lint` clean before each commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `packages/economy/src/store.ts` | New types (`AdminTarget`, `ResetPart`, `BalanceOp`, `AdminUserRow`, `AdminLogEntry`) and the `MemoryStore` implementations |
| `packages/economy/src/admin.test.ts` (new) | Store-level tests for every new method, against `MemoryStore` |
| `packages/economy/src/mongo-store.ts` | `MongoStore` implementations and the `adminlog` collection |
| `packages/economy/src/mongo-store.test.ts` | The same cases against a real Mongo (skipped without `MONGO_TEST_URL`) |
| `packages/economy/src/index.ts` | Export the new types and `RESET_PARTS` |
| `packages/shared/src/schemas.ts` | `adminChipsSchema`, `adminResetSchema` |
| `apps/server/src/admin-desk.ts` (new) | `mountAdminDesk` routes and the pure `tablesHolding` helper |
| `apps/server/src/admin-desk.test.ts` (new) | Route tests on a bare express app, plus wiring tests through `createBackRoomServer` |
| `apps/server/src/server.ts` | Wire `mountAdminDesk`, the bulk-route body parser, float logging, `emotesSeen` eviction |
| `apps/web/src/taunt/TauntStage.tsx` | Hide the picture of a replay whose emote was deleted |
| `apps/web/src/admin/api.ts` (new) | `fmt`, `adminGet`, `adminPost` |
| `apps/web/src/admin/Admin.tsx` | Shell: access check, tab bar, tab in URL |
| `apps/web/src/admin/Banks.tsx` (new) | `BANKS` and the bank cards |
| `apps/web/src/admin/Codes.tsx` (new) | Mint row and code list |
| `apps/web/src/admin/Players.tsx` (new) | Search, list, selection, action bar |
| `apps/web/src/admin/dialogs.tsx` (new) | `ChipsDialog`, `ResetDialog` |
| `apps/web/src/admin/Emotes.tsx` | Upload form and emote card grid with Retire / Delete |
| `apps/web/src/admin/Log.tsx` (new) | Log list and `describeEntry` |
| `apps/web/src/admin/admin.css` (new) | All admin styles, imported from `Admin.tsx` |
| `apps/web/src/admin/*.test.tsx` | Web tests |
| `CLAUDE.md` | Amend the money rule |

---

### Task 1: Commit the navbar admin link

Already implemented and verified in this worktree (uncommitted): `/api/me` returns `admin`, `useAccount` exposes `account.admin`, the navbar shows a key-icon link to `/admin` for admins.

**Files:**
- Modify (already done): `apps/server/src/server.ts`, `apps/server/src/codes.test.ts`, `apps/web/src/game/useAccount.ts`, `apps/web/src/nav/Navbar.tsx`
- Create (already done): `apps/web/src/nav/Navbar.test.tsx`

- [ ] **Step 1: Confirm the tests pass**

Run: `npx vitest run apps/server/src/codes.test.ts apps/web/src/nav/Navbar.test.tsx`
Expected: all pass.

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/server.ts apps/server/src/codes.test.ts apps/web/src/game/useAccount.ts apps/web/src/nav/Navbar.tsx apps/web/src/nav/Navbar.test.tsx
git commit -m "feat(nav): a way to the admin desk, for admins

/api/me says whether the signed-in player is on the admin list, and the
bar offers a link to the desk when they are. A courtesy only: every admin
route still asks the list itself.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Store types and the MemoryStore implementation

**Files:**
- Modify: `packages/economy/src/store.ts`
- Modify: `packages/economy/src/index.ts`
- Create: `packages/economy/src/admin.test.ts`

**Interfaces:**
- Produces (exported from `@backroom/economy`):

```ts
export type AdminTarget = { all: true } | { ids: string[] };
export const RESET_PARTS = ["balance", "stats", "jar", "history"] as const;
export type ResetPart = (typeof RESET_PARTS)[number];
export type BalanceOp = "add" | "remove" | "set";
export interface AdminUserRow {
  id: string; name: string; avatar: string | null; accentColor: number | null;
  chips: number; games: number; createdAt: number;
}
export type AdminLogKind = "add" | "remove" | "set" | "reset" | "float" | "empty-banks" | "delete-emote";
export interface AdminLogEntry {
  id: string; at: number; by: string; byName: string; kind: AdminLogKind;
  amount: number; affected: number; target: "all" | string[];
  parts: ResetPart[] | null; subject: string | null; note: string;
}
// On Store:
listUsers(input: { query: string; offset: number; limit: number }): Promise<{ rows: AdminUserRow[]; total: number }>;
adjustBalances(input: { target: AdminTarget; op: BalanceOp; amount: number }): Promise<{ affected: number; moved: number }>;
resetUsers(input: { target: AdminTarget; parts: readonly ResetPart[] }): Promise<{ affected: number }>;
bankEmpty(which: BankName): Promise<number>;
deleteEmote(id: string): Promise<boolean>;
logAdmin(entry: Omit<AdminLogEntry, "id" | "at">): Promise<AdminLogEntry>;
adminLog(input: { limit: number; before: number | null }): Promise<AdminLogEntry[]>;
```

`subject` is the bank name for `float`, the emote name for `delete-emote`, null otherwise. `parts` is non-null only for `reset`.

- [ ] **Step 1: Write the failing tests**

Create `packages/economy/src/admin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MemoryStore, STARTING_CHIPS, emptyJarRecord } from "./store.js";

/*
 * Everything an admin can do to players, against the store that doubles as
 * the no-database mode. The Mongo versions are held to the same cases in
 * mongo-store.test.ts; this file is the one that always runs.
 */

async function people(store: MemoryStore, names: string[]) {
  const out = [];
  for (const [index, name] of names.entries()) {
    out.push(
      await store.upsertDiscordUser({ discordId: `d${index}`, name, avatar: null, accentColor: null }),
    );
  }
  return out;
}

const ascii = (text: string): number[] => [...text].map((letter) => letter.charCodeAt(0));

function gif(): Uint8Array {
  const out = new Uint8Array(64);
  out.set(ascii("GIF89a"));
  return out;
}

describe("listing players for the admin", () => {
  it("lists everybody richest first, and pages", async () => {
    const store = new MemoryStore();
    const [ada, bo, cy] = await people(store, ["Ada", "Bo", "Cy"]);
    await store.adjustChips(bo.id, 500);
    await store.adjustChips(cy.id, -500);

    const first = await store.listUsers({ query: "", offset: 0, limit: 2 });
    expect(first.total).toBe(3);
    expect(first.rows.map((row) => row.id)).toEqual([bo.id, ada.id]);
    const second = await store.listUsers({ query: "", offset: 2, limit: 2 });
    expect(second.rows.map((row) => row.id)).toEqual([cy.id]);
  });

  it("finds by the start of a name, in any case, and counts only the matches", async () => {
    const store = new MemoryStore();
    await people(store, ["Ada", "Adam", "Bo"]);
    const found = await store.listUsers({ query: "AD", offset: 0, limit: 50 });
    expect(found.rows.map((row) => row.name).sort()).toEqual(["Ada", "Adam"]);
    expect(found.total).toBe(2);
  });

  it("carries games played and when they joined", async () => {
    const store = new MemoryStore();
    const [ada] = await people(store, ["Ada"]);
    await store.bumpStats(ada.id, { shared: { games: 3 } });
    const [row] = (await store.listUsers({ query: "", offset: 0, limit: 50 })).rows;
    expect(row.games).toBe(3);
    expect(row.createdAt).toBeGreaterThan(0);
  });
});

describe("moving balances", () => {
  it("adds to the players named and nobody else", async () => {
    const store = new MemoryStore();
    const [ada, bo] = await people(store, ["Ada", "Bo"]);
    const result = await store.adjustBalances({ target: { ids: [ada.id] }, op: "add", amount: 5000 });
    expect(result).toEqual({ affected: 1, moved: 5000 });
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS + 5000);
    expect((await store.get(bo.id))?.chips).toBe(STARTING_CHIPS);
  });

  it("takes away no further than zero, and says what it actually took", async () => {
    const store = new MemoryStore();
    const [ada, bo] = await people(store, ["Ada", "Bo"]);
    await store.adjustChips(bo.id, -9000);
    const result = await store.adjustBalances({
      target: { ids: [ada.id, bo.id] },
      op: "remove",
      amount: 5000,
    });
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS - 5000);
    expect((await store.get(bo.id))?.chips).toBe(0);
    expect(result).toEqual({ affected: 2, moved: -6000 });
  });

  it("sets a balance outright", async () => {
    const store = new MemoryStore();
    const [ada] = await people(store, ["Ada"]);
    const result = await store.adjustBalances({ target: { ids: [ada.id] }, op: "set", amount: 250 });
    expect((await store.get(ada.id))?.chips).toBe(250);
    expect(result).toEqual({ affected: 1, moved: 250 - STARTING_CHIPS });
  });

  it("reaches everybody", async () => {
    const store = new MemoryStore();
    const everyone = await people(store, ["Ada", "Bo", "Cy"]);
    const result = await store.adjustBalances({ target: { all: true }, op: "add", amount: 1 });
    expect(result).toEqual({ affected: 3, moved: 3 });
    for (const one of everyone) {
      expect((await store.get(one.id))?.chips).toBe(STARTING_CHIPS + 1);
    }
  });

  it("ignores an id nobody has", async () => {
    const store = new MemoryStore();
    const result = await store.adjustBalances({ target: { ids: ["nobody"] }, op: "add", amount: 1 });
    expect(result).toEqual({ affected: 0, moved: 0 });
  });
});

describe("resetting players", () => {
  it("resets only the parts asked for", async () => {
    const store = new MemoryStore();
    const [ada] = await people(store, ["Ada"]);
    await store.adjustChips(ada.id, 777);
    await store.bumpStats(ada.id, { shared: { games: 4, wins: 2 }, game: "greed", add: { farkles: 3 } });

    await store.resetUsers({ target: { ids: [ada.id] }, parts: ["stats"] });
    const after = await store.get(ada.id);
    expect(after?.chips).toBe(STARTING_CHIPS + 777);
    expect(after?.stats).toEqual({ games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 });
    expect(after?.byGame).toEqual({});

    await store.resetUsers({ target: { ids: [ada.id] }, parts: ["balance"] });
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS);
  });

  it("keeps who they are", async () => {
    const store = new MemoryStore();
    const [ada] = await people(store, ["Ada"]);
    await store.resetUsers({ target: { all: true }, parts: ["balance", "stats", "jar", "history"] });
    const after = await store.get(ada.id);
    expect(after?.id).toBe(ada.id);
    expect(after?.discordId).toBe(ada.discordId);
    expect(after?.name).toBe("Ada");
  });

  it("empties the tip jar", async () => {
    const store = new MemoryStore();
    const [ada] = await people(store, ["Ada"]);
    await store.applyJar(ada.id, "", { ...emptyJarRecord(), level: 5, token: "t1" }, 0);
    await store.resetUsers({ target: { ids: [ada.id] }, parts: ["jar"] });
    expect((await store.get(ada.id))?.jar).toEqual(emptyJarRecord());
  });

  it("forgets redemptions, so a used code can be used again", async () => {
    const store = new MemoryStore();
    const [ada] = await people(store, ["Ada"]);
    const code = await store.mintCode({
      chips: 100, maxRedemptions: null, expiresAt: null, note: "", createdBy: "admin",
    });
    expect((await store.redeem(code.code, ada.id)).ok).toBe(true);
    expect((await store.redeem(code.code, ada.id)).ok).toBe(false);

    await store.resetUsers({ target: { ids: [ada.id] }, parts: ["history"] });
    expect((await store.listCodes(1))[0]?.redemptions).toBe(0);
    expect((await store.redeem(code.code, ada.id)).ok).toBe(true);
  });

  it("forgets transfers either way round", async () => {
    const store = new MemoryStore();
    const [ada, bo] = await people(store, ["Ada", "Bo"]);
    expect((await store.send(ada.id, bo.id, 100)).ok).toBe(true);
    await store.resetUsers({ target: { ids: [bo.id] }, parts: ["history"] });
    expect(await store.transfers(ada.id, 10)).toEqual([]);
    expect(await store.sentSince(ada.id, 0)).toBe(0);
  });

  it("takes them out of a shared game without taking the game from anybody else", async () => {
    const store = new MemoryStore();
    const [ada, bo] = await people(store, ["Ada", "Bo"]);
    await store.recordGame({
      code: "ABCD", rulesetName: "greed", buyIn: 0, pot: 0, winnerIds: [], endedAt: 1,
      players: [
        { userId: ada.id, name: "Ada", score: 1, isBot: false },
        { userId: bo.id, name: "Bo", score: 2, isBot: false },
      ],
    });
    await store.recordGame({
      code: "EFGH", rulesetName: "greed", buyIn: 0, pot: 0, winnerIds: [], endedAt: 2,
      players: [
        { userId: ada.id, name: "Ada", score: 1, isBot: false },
        { userId: null, name: "Bot", score: 2, isBot: true },
      ],
    });

    await store.resetUsers({ target: { ids: [ada.id] }, parts: ["history"] });
    expect(await store.recentGames(ada.id, 10)).toEqual([]);
    const bos = await store.recentGames(bo.id, 10);
    expect(bos).toHaveLength(1);
    expect(bos[0]?.players.map((player) => player.name)).toEqual(["Bo"]);
  });

  it("counts only players who exist", async () => {
    const store = new MemoryStore();
    await people(store, ["Ada", "Bo"]);
    expect(await store.resetUsers({ target: { all: true }, parts: ["balance"] })).toEqual({ affected: 2 });
    expect(await store.resetUsers({ target: { ids: ["nobody"] }, parts: ["balance"] })).toEqual({
      affected: 0,
    });
  });
});

describe("emptying a bank", () => {
  it("leaves it at zero and says what was in it", async () => {
    const store = new MemoryStore();
    await store.bankAdd("roulette", 1234);
    expect(await store.bankEmpty("roulette")).toBe(1234);
    expect(await store.bank("roulette")).toBe(0);
    expect(await store.bankEmpty("roulette")).toBe(0);
  });
});

describe("deleting an emote", () => {
  it("removes it and its files for good", async () => {
    const store = new MemoryStore();
    const made = await store.addEmote({ name: "Smug", cost: 250, image: gif(), sound: null, createdBy: "a" });
    expect(await store.deleteEmote(made.id)).toBe(true);
    expect(await store.listEmotes(true)).toEqual([]);
    expect(await store.emoteAsset(made.id, "image")).toBeNull();
    expect(await store.deleteEmote(made.id)).toBe(false);
  });
});

describe("the admin log", () => {
  it("hands entries back newest first, and pages by time", async () => {
    const store = new MemoryStore();
    const base = {
      by: "u1", byName: "Koda", amount: 5, affected: 1, target: "all" as const,
      parts: null, subject: null, note: "",
    };
    const first = await store.logAdmin({ ...base, kind: "add" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await store.logAdmin({ ...base, kind: "remove" });

    const all = await store.adminLog({ limit: 50, before: null });
    expect(all.map((entry) => entry.id)).toEqual([second.id, first.id]);
    const older = await store.adminLog({ limit: 50, before: second.at });
    expect(older.map((entry) => entry.id)).toEqual([first.id]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run packages/economy/src/admin.test.ts`
Expected: FAIL — `store.listUsers is not a function` (and TypeScript errors for the other methods).

- [ ] **Step 3: Add the types and interface methods to `store.ts`**

After `emptyJarRecord` (before `export interface Store`), add:

```ts
/**
 * Who an admin action is aimed at.
 *
 * Everybody is its own shape rather than a very long list, because "every
 * player" has to include the one who signs up between the admin loading the
 * page and pressing the button.
 */
export type AdminTarget = { all: true } | { ids: string[] };

/** What a reset can wipe, each on its own so an admin chooses. */
export const RESET_PARTS = ["balance", "stats", "jar", "history"] as const;
export type ResetPart = (typeof RESET_PARTS)[number];

export type BalanceOp = "add" | "remove" | "set";

/**
 * A player as the admin desk lists them.
 *
 * Its own type rather than `LeaderRow`, for the reason `LeaderRow` is not
 * `PublicPlayer`: what the desk may see is decided here, not inherited.
 */
export interface AdminUserRow {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  games: number;
  createdAt: number;
}

export type AdminLogKind =
  | "add"
  | "remove"
  | "set"
  | "reset"
  | "float"
  | "empty-banks"
  | "delete-emote";

/**
 * One thing an admin did.
 *
 * Grants are chips nobody won, so every one is written down with who did it —
 * the same reason a code is revoked rather than deleted. `amount` is what
 * actually moved, not what was asked for.
 */
export interface AdminLogEntry {
  id: string;
  at: number;
  by: string;
  byName: string;
  kind: AdminLogKind;
  amount: number;
  affected: number;
  target: "all" | string[];
  /** What a reset wiped. Null for everything else. */
  parts: ResetPart[] | null;
  /** The bank floated or the emote deleted. Null for everything else. */
  subject: string | null;
  note: string;
}
```

Inside `export interface Store`, before `close(): Promise<void>;`, add:

```ts
  /** Players for the admin desk, richest first, optionally by name prefix. */
  listUsers(input: {
    query: string;
    offset: number;
    limit: number;
  }): Promise<{ rows: AdminUserRow[]; total: number }>;

  /**
   * Adds, removes or sets balances. Removal stops at zero rather than
   * refusing, and `moved` is the net chips that actually moved.
   */
  adjustBalances(input: {
    target: AdminTarget;
    op: BalanceOp;
    amount: number;
  }): Promise<{ affected: number; moved: number }>;

  /**
   * Wipes the chosen parts of players, keeping the players.
   *
   * The document and its id stay, which is what keeps a reset player signed
   * in: a session holds nothing but that id.
   */
  resetUsers(input: { target: AdminTarget; parts: readonly ResetPart[] }): Promise<{ affected: number }>;

  /** Sets a bank to zero, returning what it held. */
  bankEmpty(which: BankName): Promise<number>;

  /** Removes an emote and its files for good. */
  deleteEmote(id: string): Promise<boolean>;

  logAdmin(entry: Omit<AdminLogEntry, "id" | "at">): Promise<AdminLogEntry>;
  /** Newest first; `before` is an `at` to page back from. */
  adminLog(input: { limit: number; before: number | null }): Promise<AdminLogEntry[]>;
```

- [ ] **Step 4: Implement them on `MemoryStore`**

Add two fields beside the others in `MemoryStore`:

```ts
  /** When each profile was made, which the profile itself does not carry. */
  private readonly joined = new Map<string, number>();
  private readonly adminEntries: AdminLogEntry[] = [];
```

In `upsertDiscordUser`, just before `this.people.set(profile.id, profile);` add:

```ts
    this.joined.set(profile.id, Date.now());
```

Add these methods before `close()`:

```ts
  /** The profiles an admin action reaches. Unknown ids are simply not there. */
  private targeted(target: AdminTarget): Profile[] {
    if ("all" in target) {
      return [...this.people.values()];
    }
    return [...new Set(target.ids)]
      .map((id) => this.people.get(id))
      .filter((one): one is Profile => one !== undefined);
  }

  async listUsers({
    query,
    offset,
    limit,
  }: {
    query: string;
    offset: number;
    limit: number;
  }): Promise<{ rows: AdminUserRow[]; total: number }> {
    const wanted = query.trim().toLowerCase();
    const matching = [...this.people.values()]
      .filter((person) => person.name.toLowerCase().startsWith(wanted))
      .sort((a, b) => b.chips - a.chips || a.id.localeCompare(b.id));
    return {
      total: matching.length,
      rows: matching.slice(offset, offset + Math.min(limit, 100)).map((person) => ({
        id: person.id,
        name: person.name,
        avatar: person.avatar,
        accentColor: person.accentColor,
        chips: person.chips,
        games: person.stats.games,
        createdAt: this.joined.get(person.id) ?? 0,
      })),
    };
  }

  async adjustBalances({
    target,
    op,
    amount,
  }: {
    target: AdminTarget;
    op: BalanceOp;
    amount: number;
  }): Promise<{ affected: number; moved: number }> {
    const reached = this.targeted(target);
    let moved = 0;
    for (const profile of reached) {
      const before = profile.chips;
      profile.chips =
        op === "add" ? before + amount : op === "remove" ? Math.max(0, before - amount) : amount;
      moved += profile.chips - before;
    }
    return { affected: reached.length, moved };
  }

  async resetUsers({
    target,
    parts,
  }: {
    target: AdminTarget;
    parts: readonly ResetPart[];
  }): Promise<{ affected: number }> {
    const reached = this.targeted(target);
    const ids = new Set(reached.map((profile) => profile.id));
    for (const profile of reached) {
      if (parts.includes("balance")) {
        profile.chips = STARTING_CHIPS;
      }
      if (parts.includes("stats")) {
        profile.stats = emptyStats();
        profile.byGame = {};
      }
      if (parts.includes("jar")) {
        profile.jar = emptyJarRecord();
      }
    }
    if (parts.includes("history")) {
      this.forgetHistory(ids);
    }
    return { affected: reached.length };
  }

  private forgetHistory(ids: Set<string>): void {
    const kept = this.ledger.filter((one) => !ids.has(one.fromId) && !ids.has(one.toId));
    this.ledger.splice(0, this.ledger.length, ...kept);

    for (const claim of [...this.redeemed]) {
      const split = claim.lastIndexOf(":");
      const code = claim.slice(0, split);
      if (ids.has(claim.slice(split + 1))) {
        this.redeemed.delete(claim);
        const record = this.codes.get(code);
        if (record !== undefined) {
          record.redemptions = Math.max(0, record.redemptions - 1);
        }
      }
    }

    const games = this.games
      .map((game) => ({
        ...game,
        players: game.players.filter((player) => player.userId === null || !ids.has(player.userId)),
      }))
      // A record nobody signed in is still in says nothing about anybody.
      .filter((game) => game.players.some((player) => player.userId !== null));
    this.games.splice(0, this.games.length, ...games);
  }

  async bankEmpty(which: BankName): Promise<number> {
    const held = this.house.get(which) ?? 0;
    this.house.set(which, 0);
    return held;
  }

  async deleteEmote(id: string): Promise<boolean> {
    this.emoteFiles.delete(id);
    return this.emotes.delete(id);
  }

  async logAdmin(entry: Omit<AdminLogEntry, "id" | "at">): Promise<AdminLogEntry> {
    const written: AdminLogEntry = { ...entry, id: randomUUID(), at: Date.now() };
    this.adminEntries.unshift(written);
    return written;
  }

  async adminLog({ limit, before }: { limit: number; before: number | null }): Promise<AdminLogEntry[]> {
    return this.adminEntries
      .filter((entry) => before === null || entry.at < before)
      .slice(0, limit);
  }
```

Note: `redeemed` keys are `${normaliseCode(code)}:${userId}` and `codes` is keyed by `normaliseCode(code)`, so `code` above is already the map key.

- [ ] **Step 5: Export from the package**

In `packages/economy/src/index.ts`, add `RESET_PARTS` to the value export from `./store.js` and add to the type export:

```ts
  AdminLogEntry,
  AdminLogKind,
  AdminTarget,
  AdminUserRow,
  BalanceOp,
  ResetPart,
```

- [ ] **Step 6: Make MongoStore compile**

`MongoStore implements Store` will now fail typecheck. Add temporary stubs to `MongoStore` so this task's commit is green; Task 3 replaces every one:

```ts
  async listUsers(): Promise<{ rows: AdminUserRow[]; total: number }> {
    throw new Error("listUsers is not implemented for Mongo yet");
  }
```

…and the same `throw` shape for `adjustBalances`, `resetUsers`, `bankEmpty`, `deleteEmote`, `logAdmin`, `adminLog` (import the types from `./store.js`).

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run packages/economy/src/admin.test.ts` → PASS
Run: `npm run typecheck` → clean

- [ ] **Step 8: Format and commit**

```bash
npx biome format --write packages/economy/src/store.ts packages/economy/src/index.ts packages/economy/src/admin.test.ts packages/economy/src/mongo-store.ts
git add packages/economy/src
git commit -m "feat(economy): admin balances, resets, emote deletion and a log, in memory

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The MongoStore implementation

**Files:**
- Modify: `packages/economy/src/mongo-store.ts`
- Modify: `packages/economy/src/mongo-store.test.ts`

**Interfaces:**
- Consumes: every type and `Store` method from Task 2.
- Produces: real implementations replacing Task 2's stubs; an `AdminLog` model on collection `adminlogs`.

- [ ] **Step 1: Write the failing Mongo tests**

Append inside the `describe.skipIf(...)` block in `mongo-store.test.ts` (it has `store`, `newPlayer()`):

```ts
  describe("the admin desk", () => {
    it("adds, removes to no lower than zero, and sets", async () => {
      const ada = await newPlayer();
      const bo = await newPlayer();
      await store.adjustChips(bo.id, -9000);
      const took = await store.adjustBalances({ target: { ids: [ada.id, bo.id] }, op: "remove", amount: 5000 });
      expect(took).toEqual({ affected: 2, moved: -6000 });
      expect((await store.get(bo.id))?.chips).toBe(0);

      expect(await store.adjustBalances({ target: { ids: [ada.id] }, op: "add", amount: 5 })).toEqual({
        affected: 1,
        moved: 5,
      });
      await store.adjustBalances({ target: { ids: [ada.id] }, op: "set", amount: 42 });
      expect((await store.get(ada.id))?.chips).toBe(42);
    });

    it("lists by name prefix with games and a join date", async () => {
      const ada = await newPlayer();
      await store.bumpStats(ada.id, { shared: { games: 2 } });
      const found = await store.listUsers({ query: ada.name, offset: 0, limit: 100 });
      const row = found.rows.find((one) => one.id === ada.id);
      expect(row?.games).toBe(2);
      expect(row?.createdAt).toBeGreaterThan(0);
    });

    it("resets the chosen parts and keeps the player", async () => {
      const ada = await newPlayer();
      await store.adjustChips(ada.id, 500);
      await store.bumpStats(ada.id, { shared: { wins: 1 }, game: "greed", add: { farkles: 1 } });
      await store.resetUsers({ target: { ids: [ada.id] }, parts: ["stats"] });
      const after = await store.get(ada.id);
      expect(after?.chips).toBe(STARTING_CHIPS + 500);
      expect(after?.stats.wins).toBe(0);
      expect(after?.byGame).toEqual({});
      expect(after?.discordId).toBe(ada.discordId);
    });

    it("forgets a redemption, so the code works for them again", async () => {
      const ada = await newPlayer();
      const code = await store.mintCode({
        chips: 10, maxRedemptions: null, expiresAt: null, note: "", createdBy: "admin",
      });
      expect((await store.redeem(code.code, ada.id)).ok).toBe(true);
      await store.resetUsers({ target: { ids: [ada.id] }, parts: ["history"] });
      expect((await store.redeem(code.code, ada.id)).ok).toBe(true);
    });

    it("takes a player out of a shared game and deletes a game nobody is left in", async () => {
      const ada = await newPlayer();
      const bo = await newPlayer();
      await store.recordGame({
        code: `S${Date.now()}`, rulesetName: "greed", buyIn: 0, pot: 0, winnerIds: [], endedAt: Date.now(),
        players: [
          { userId: ada.id, name: "Ada", score: 1, isBot: false },
          { userId: bo.id, name: "Bo", score: 1, isBot: false },
        ],
      });
      await store.resetUsers({ target: { ids: [ada.id] }, parts: ["history"] });
      expect(await store.recentGames(ada.id, 10)).toEqual([]);
      expect((await store.recentGames(bo.id, 10))[0]?.players).toHaveLength(1);
    });

    it("empties a bank and deletes an emote", async () => {
      await store.bankAdd("two-up", 77);
      expect(await store.bankEmpty("two-up")).toBeGreaterThanOrEqual(77);
      expect(await store.bank("two-up")).toBe(0);

      const image = new Uint8Array(64);
      image.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      const made = await store.addEmote({ name: "Gone", cost: 1, image, sound: null, createdBy: "a" });
      expect(await store.deleteEmote(made.id)).toBe(true);
      expect(await store.emoteAsset(made.id, "image")).toBeNull();
    });

    it("writes the log and reads it back newest first", async () => {
      const entry = await store.logAdmin({
        by: "u", byName: "Koda", kind: "float", amount: 1, affected: 0, target: "all",
        parts: null, subject: "slots", note: "mongo test",
      });
      const [latest] = await store.adminLog({ limit: 1, before: null });
      expect(latest?.id).toBe(entry.id);
      expect(latest?.subject).toBe("slots");
    });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run (needs a mongod — see the file's header comment):
`MONGO_TEST_URL=mongodb://localhost:27018/greed-test npx vitest run packages/economy/src/mongo-store.test.ts`
Expected: FAIL with "listUsers is not implemented for Mongo yet". Without a mongod the suite is skipped; note that in the commit message rather than claiming it ran.

- [ ] **Step 3: Add the log schema and model**

Near the transfer schema in `mongo-store.ts`:

```ts
interface AdminLogDoc extends Omit<AdminLogEntry, "id"> {
  _id: string;
}

const adminLogSchema = new mongoose.Schema<AdminLogDoc>(
  {
    _id: { type: String, required: true },
    at: { type: Number, required: true },
    by: { type: String, required: true },
    byName: { type: String, required: true },
    kind: { type: String, required: true },
    amount: { type: Number, required: true },
    affected: { type: Number, required: true },
    // "all", or the ids — Mixed because it is one or the other.
    target: { type: mongoose.Schema.Types.Mixed, required: true },
    parts: { type: [String], default: null },
    subject: { type: String, default: null },
    note: { type: String, default: "" },
  },
  { timestamps: false },
);
adminLogSchema.index({ at: -1 });
```

Add `createdAt?: Date;` to `interface UserDoc` (the schema already has `timestamps: true`).

In the class: `private readonly adminLogs: Model<AdminLogDoc>;` and in the constructor
`this.adminLogs = connection.model<AdminLogDoc>("AdminLog", adminLogSchema);`

- [ ] **Step 4: Replace the stubs with implementations**

```ts
  /** The filter an admin target means. Ids that are not ObjectIds reach nobody. */
  private userFilter(target: AdminTarget): Record<string, unknown> {
    if ("all" in target) {
      return {};
    }
    return { _id: { $in: target.ids.filter((id) => mongoose.Types.ObjectId.isValid(id)) } };
  }

  private targetIds(target: AdminTarget): string[] | null {
    return "all" in target ? null : target.ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  }

  async listUsers({
    query,
    offset,
    limit,
  }: {
    query: string;
    offset: number;
    limit: number;
  }): Promise<{ rows: AdminUserRow[]; total: number }> {
    // Escaped for the same reason findPlayers escapes: a name is not a pattern.
    const safe = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = safe.length === 0 ? {} : { name: new RegExp(`^${safe}`, "i") };
    const [docs, total] = await Promise.all([
      this.users
        .find(filter)
        .select("name avatar accentColor chips stats.games createdAt")
        .sort({ chips: -1, _id: 1 })
        .skip(Math.max(0, offset))
        .limit(Math.min(limit, 100))
        .lean<Array<UserDoc & { _id: mongoose.Types.ObjectId }>>(),
      this.users.countDocuments(filter),
    ]);
    return {
      total,
      rows: docs.map((doc) => ({
        id: doc._id.toString(),
        name: doc.name,
        avatar: doc.avatar,
        accentColor: doc.accentColor,
        chips: doc.chips,
        games: doc.stats?.games ?? 0,
        createdAt: doc.createdAt instanceof Date ? doc.createdAt.getTime() : 0,
      })),
    };
  }

  /*
   * `moved` for a removal or a set is the sum of balances read just before
   * the update and just after it. A hand settling between the two reads is
   * counted as if the admin moved it — the log can be off by a live payout,
   * never the balance itself, which the single update decides.
   */
  async adjustBalances({
    target,
    op,
    amount,
  }: {
    target: AdminTarget;
    op: BalanceOp;
    amount: number;
  }): Promise<{ affected: number; moved: number }> {
    const filter = this.userFilter(target);
    const sum = async () => {
      const [summed] = await this.users.aggregate<{ total: number; count: number }>([
        { $match: filter },
        { $group: { _id: null, total: { $sum: "$chips" }, count: { $sum: 1 } } },
      ]);
      return { total: summed?.total ?? 0, count: summed?.count ?? 0 };
    };
    const before = await sum();
    if (op === "add") {
      await this.users.updateMany(filter, { $inc: { chips: amount } });
    } else if (op === "set") {
      await this.users.updateMany(filter, { $set: { chips: amount } });
    } else {
      await this.users.updateMany(filter, [
        { $set: { chips: { $max: [0, { $subtract: ["$chips", amount] }] } } },
      ]);
    }
    const after = await sum();
    return { affected: before.count, moved: after.total - before.total };
  }

  async resetUsers({
    target,
    parts,
  }: {
    target: AdminTarget;
    parts: readonly ResetPart[];
  }): Promise<{ affected: number }> {
    const filter = this.userFilter(target);
    const affected = await this.users.countDocuments(filter);
    const set: Record<string, unknown> = {};
    if (parts.includes("balance")) {
      set["chips"] = STARTING_CHIPS;
    }
    if (parts.includes("stats")) {
      set["stats"] = emptyStats();
      set["byGame"] = {};
    }
    if (parts.includes("jar")) {
      set["jar"] = emptyJarRecord();
    }
    if (Object.keys(set).length > 0) {
      await this.users.updateMany(filter, { $set: set });
    }
    if (parts.includes("history")) {
      await this.forgetHistory(this.targetIds(target));
    }
    return { affected };
  }

  /** Null ids means everybody. */
  private async forgetHistory(ids: string[] | null): Promise<void> {
    if (ids === null) {
      await Promise.all([
        this.ledger.deleteMany({}),
        this.redemptions.deleteMany({}),
        this.codes.updateMany({}, { $set: { redemptions: 0 } }),
        this.games.deleteMany({}),
      ]);
      return;
    }
    await this.ledger.deleteMany({ $or: [{ fromId: { $in: ids } }, { toId: { $in: ids } }] });

    const claims = await this.redemptions.find({ userId: { $in: ids } }).lean<RedemptionDoc[]>();
    const perCode = new Map<string, number>();
    for (const claim of claims) {
      perCode.set(claim.code, (perCode.get(claim.code) ?? 0) + 1);
    }
    await Promise.all(
      [...perCode].map(([code, count]) =>
        this.codes.updateOne({ code }, [
          { $set: { redemptions: { $max: [0, { $subtract: ["$redemptions", count] }] } } },
        ]),
      ),
    );
    await this.redemptions.deleteMany({ userId: { $in: ids } });

    await this.games.updateMany(
      { "players.userId": { $in: ids } },
      { $pull: { players: { userId: { $in: ids } } } },
    );
    // A record nobody signed in is still in says nothing about anybody.
    await this.games.deleteMany({ players: { $not: { $elemMatch: { userId: { $type: "string" } } } } });
  }

  async bankEmpty(which: BankName): Promise<number> {
    const before = await this.house.findOneAndUpdate(
      { _id: bankId(which) },
      { $set: { amount: 0 } },
      { upsert: true, returnDocument: "before" },
    );
    return before?.amount ?? 0;
  }

  async deleteEmote(id: string): Promise<boolean> {
    const result = await this.emotes.deleteOne({ _id: id });
    return result.deletedCount === 1;
  }

  async logAdmin(entry: Omit<AdminLogEntry, "id" | "at">): Promise<AdminLogEntry> {
    const written: AdminLogEntry = { ...entry, id: randomUUID(), at: Date.now() };
    const { id, ...rest } = written;
    await this.adminLogs.create({ _id: id, ...rest });
    return written;
  }

  async adminLog({ limit, before }: { limit: number; before: number | null }): Promise<AdminLogEntry[]> {
    const docs = await this.adminLogs
      .find(before === null ? {} : { at: { $lt: before } })
      .sort({ at: -1 })
      .limit(limit)
      .lean<AdminLogDoc[]>();
    return docs.map(({ _id, ...rest }) => ({ ...rest, id: _id }));
  }
```

Note on the `games.deleteMany` filter: it matches games with no player whose `userId` is a string — including games that *never* had one (all bots/guests). Those records are unreachable from any profile already (`recentGames` looks them up by `userId`), so removing them loses nothing a player can see.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm run typecheck` → clean
Run (with mongod): `MONGO_TEST_URL=... npx vitest run packages/economy/src/mongo-store.test.ts` → PASS
Run: `npx vitest run packages/economy` → PASS

- [ ] **Step 6: Format and commit**

```bash
npx biome format --write packages/economy/src/mongo-store.ts packages/economy/src/mongo-store.test.ts
git add packages/economy/src
git commit -m "feat(economy): admin balances, resets, emote deletion and a log, in Mongo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The admin desk routes

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Create: `apps/server/src/admin-desk.ts`
- Create: `apps/server/src/admin-desk.test.ts`
- Modify: `apps/server/src/server.ts` (the `smallJson` skip at ~453, mounting beside `mountLeaderboard` at ~1035, a `tellChipsTo` helper beside `tellChips` at ~814, bank float logging at ~1153)

**Interfaces:**
- Consumes: Task 2's store methods and types.
- Produces:

```ts
// @backroom/shared/schemas
export const adminChipsSchema; export type AdminChipsPayload;
export const adminResetSchema; export type AdminResetPayload;

// apps/server/src/admin-desk.ts
export const ADMIN_BULK_PATHS: readonly string[]; // ["/api/admin/chips", "/api/admin/reset"]
export interface SeatedTable { seats: ReadonlyArray<{ userId: string | null; isBot: boolean }> }
export function tablesHolding(tables: Iterable<SeatedTable>, target: AdminTarget): number;
export interface AdminDeskRoutes {
  store: Store;
  requireAdmin: RequestHandler;
  whoIs: (request: Request) => Promise<{ id: string; name: string } | null>;
  tellChipsTo: (target: AdminTarget) => Promise<void>;
  tables: () => Iterable<SeatedTable>;
  forgetEmote: (id: string) => void;
}
export function mountAdminDesk(app: Express, deps: AdminDeskRoutes): void;
```

Routes: `GET /api/admin/users`, `POST /api/admin/chips`, `POST /api/admin/reset`, `GET /api/admin/log`, `POST /api/admin/emotes/:id/delete`.

- [ ] **Step 1: Add the schemas**

In `packages/shared/src/schemas.ts`, after `MintCodePayload`:

```ts
/**
 * Who an admin action reaches. Capped so one request cannot name the whole
 * playerbase by hand — that is what `all` is for.
 */
const adminTargetSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500) }).strict(),
]);

const adminNoteSchema = z.string().max(120).optional();

/** Giving, taking or setting chips. Set may be zero; the others may not. */
export const adminChipsSchema = z
  .object({
    op: z.enum(["add", "remove", "set"]),
    amount: z.number().int().min(0).max(10_000_000),
    target: adminTargetSchema,
    note: adminNoteSchema,
  })
  .refine((body) => body.op === "set" || body.amount >= 1);

export type AdminChipsPayload = z.infer<typeof adminChipsSchema>;

/** Wiping parts of players. Emptying the banks only makes sense for everybody. */
export const adminResetSchema = z
  .object({
    target: adminTargetSchema,
    parts: z.array(z.enum(["balance", "stats", "jar", "history"])).min(1),
    emptyBanks: z.boolean().optional(),
    note: adminNoteSchema,
  })
  .refine((body) => body.emptyBanks !== true || "all" in body.target);

export type AdminResetPayload = z.infer<typeof adminResetSchema>;
```

- [ ] **Step 2: Write the failing route tests**

Create `apps/server/src/admin-desk.test.ts`:

```ts
import type { AddressInfo } from "node:net";
import type { AdminTarget } from "@backroom/economy";
import { MemoryStore, STARTING_CHIPS } from "@backroom/economy";
import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { SeatedTable } from "./admin-desk.js";
import { mountAdminDesk, tablesHolding } from "./admin-desk.js";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";

/*
 * The desk's routes on a bare app, so a test can say who is seated and who
 * was told their balance without standing up tables and sockets. The last
 * block goes through the real server, because whether the routes are behind
 * the allowlist is a fact about the wiring, not about this module.
 */

let http: Server | null = null;
let server: BackRoomServer | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => (http === null ? resolve() : http.close(() => resolve())));
  http = null;
  if (server !== null) {
    await server.close();
    server = null;
  }
  delete process.env["ADMIN_DISCORD_IDS"];
});

async function desk(options: { tables?: SeatedTable[] } = {}) {
  const store = new MemoryStore();
  const admin = await store.upsertDiscordUser({ discordId: "d-admin", name: "Koda", avatar: null, accentColor: null });
  const told: AdminTarget[] = [];
  const forgotten: string[] = [];
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  mountAdminDesk(app, {
    store,
    requireAdmin: (_request, _response, next) => next(),
    whoIs: async () => ({ id: admin.id, name: admin.name }),
    tellChipsTo: async (target) => {
      told.push(target);
    },
    tables: () => options.tables ?? [],
    forgetEmote: (id) => forgotten.push(id),
  });
  await new Promise<void>((resolve) => {
    http = app.listen(0, () => resolve());
  });
  const base = `http://localhost:${(http?.address() as AddressInfo).port}`;
  return { store, admin, told, forgotten, base };
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const player = (store: MemoryStore, discordId: string, name = "Ada") =>
  store.upsertDiscordUser({ discordId, name, avatar: null, accentColor: null });

describe("which tables hold somebody", () => {
  const seat = (userId: string | null, isBot = false) => ({ userId, isBot });

  it("counts tables with one of the named players at them", () => {
    const tables = [{ seats: [seat("a"), seat("b")] }, { seats: [seat("c")] }, { seats: [seat("a")] }];
    expect(tablesHolding(tables, { ids: ["a"] })).toBe(2);
    expect(tablesHolding(tables, { ids: ["z"] })).toBe(0);
  });

  it("counts, for everybody, any table with a signed-in person — not bots or guests", () => {
    const tables = [{ seats: [seat(null, true)] }, { seats: [seat(null)] }, { seats: [seat("a")] }];
    expect(tablesHolding(tables, { all: true })).toBe(1);
  });
});

describe("listing players", () => {
  it("pages and searches", async () => {
    const { store, base } = await desk();
    await player(store, "d1", "Ada");
    await player(store, "d2", "Bo");
    const body = (await (await fetch(`${base}/api/admin/users?q=ad`)).json()) as {
      rows: Array<{ name: string }>;
      total: number;
    };
    expect(body.rows.map((row) => row.name)).toEqual(["Ada"]);
    expect(body.total).toBe(1);
  });
});

describe("moving chips", () => {
  it("gives chips, tells the players, and writes it down", async () => {
    const { store, base, told } = await desk();
    const ada = await player(store, "d1");
    const answer = await post(`${base}/api/admin/chips`, {
      op: "add", amount: 500, target: { ids: [ada.id] }, note: "  sorry  ",
    });
    expect(answer.body).toEqual({ affected: 1, moved: 500 });
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS + 500);
    expect(told).toEqual([{ ids: [ada.id] }]);
    const [entry] = await store.adminLog({ limit: 1, before: null });
    expect(entry).toMatchObject({ kind: "add", amount: 500, affected: 1, byName: "Koda", note: "sorry" });
  });

  it("logs what a removal actually took", async () => {
    const { store, base } = await desk();
    const ada = await player(store, "d1");
    await post(`${base}/api/admin/chips`, { op: "remove", amount: 99_999, target: { ids: [ada.id] } });
    const [entry] = await store.adminLog({ limit: 1, before: null });
    expect(entry).toMatchObject({ kind: "remove", amount: STARTING_CHIPS });
  });

  it("refuses a bad body", async () => {
    const { base } = await desk();
    expect((await post(`${base}/api/admin/chips`, { op: "add", amount: 0, target: { all: true } })).status).toBe(400);
    expect((await post(`${base}/api/admin/chips`, { op: "add", amount: 1, target: { ids: [] } })).status).toBe(400);
    expect((await post(`${base}/api/admin/chips`, { op: "steal", amount: 1, target: { all: true } })).status).toBe(400);
  });

  it("allows setting a balance to zero", async () => {
    const { store, base } = await desk();
    const ada = await player(store, "d1");
    expect((await post(`${base}/api/admin/chips`, { op: "set", amount: 0, target: { ids: [ada.id] } })).status).toBe(200);
    expect((await store.get(ada.id))?.chips).toBe(0);
  });
});

describe("resetting players", () => {
  it("resets the parts asked for and logs them", async () => {
    const { store, base, told } = await desk();
    const ada = await player(store, "d1");
    await store.adjustChips(ada.id, 123);
    const answer = await post(`${base}/api/admin/reset`, { target: { ids: [ada.id] }, parts: ["balance"] });
    expect(answer.body).toEqual({ affected: 1 });
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS);
    expect(told).toEqual([{ ids: [ada.id] }]);
    const [entry] = await store.adminLog({ limit: 1, before: null });
    expect(entry).toMatchObject({ kind: "reset", parts: ["balance"], affected: 1 });
  });

  it("refuses while a targeted player is seated, and changes nothing", async () => {
    // MemoryStore ids are `u_<discordId>`, so the seat can name the player
    // before the player exists.
    const { store, base } = await desk({ tables: [{ seats: [{ userId: "u_d1", isBot: false }] }] });
    const ada = await player(store, "d1");
    await store.adjustChips(ada.id, 5);
    const answer = await post(`${base}/api/admin/reset`, { target: { ids: [ada.id] }, parts: ["balance"] });
    expect(answer.status).toBe(409);
    expect(answer.body["seatedAt"]).toBe(1);
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS + 5);
    expect(await store.adminLog({ limit: 1, before: null })).toEqual([]);
  });

  it("empties the banks for everybody, and only for everybody", async () => {
    const { store, base } = await desk();
    const ada = await player(store, "d1");
    await store.bankAdd("slots", 1000);
    await store.bankAdd("blackjack", 500);

    expect((await post(`${base}/api/admin/reset`, { target: { ids: [ada.id] }, parts: ["balance"], emptyBanks: true })).status).toBe(400);

    const answer = await post(`${base}/api/admin/reset`, { target: { all: true }, parts: ["balance"], emptyBanks: true });
    expect(answer.body).toEqual({ affected: 2, emptied: 1500 });
    expect(await store.bank("slots")).toBe(0);
    const [latest, reset] = await store.adminLog({ limit: 2, before: null });
    expect(latest).toMatchObject({ kind: "empty-banks", amount: 1500 });
    expect(reset).toMatchObject({ kind: "reset", target: "all" });
  });
});

describe("deleting an emote", () => {
  it("removes it, forgets it, and logs its name", async () => {
    const { store, base, forgotten } = await desk();
    const image = new Uint8Array(64);
    image.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const made = await store.addEmote({ name: "Smug", cost: 250, image, sound: null, createdBy: "a" });

    expect((await post(`${base}/api/admin/emotes/${made.id}/delete`, {})).body).toEqual({ ok: true });
    expect(await store.listEmotes(true)).toEqual([]);
    expect(forgotten).toEqual([made.id]);
    const [entry] = await store.adminLog({ limit: 1, before: null });
    expect(entry).toMatchObject({ kind: "delete-emote", subject: "Smug" });
    expect((await post(`${base}/api/admin/emotes/${made.id}/delete`, {})).status).toBe(404);
  });
});

describe("the log route", () => {
  it("pages back by time", async () => {
    const { store, base } = await desk();
    const base_ = { by: "u", byName: "K", amount: 1, affected: 1, target: "all" as const, parts: null, subject: null, note: "" };
    const old = await store.logAdmin({ ...base_, kind: "add" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const recent = await store.logAdmin({ ...base_, kind: "set" });
    const first = (await (await fetch(`${base}/api/admin/log`)).json()) as { entries: Array<{ id: string }> };
    expect(first.entries.map((one) => one.id)).toEqual([recent.id, old.id]);
    const back = (await (await fetch(`${base}/api/admin/log?before=${recent.at}`)).json()) as { entries: Array<{ id: string }> };
    expect(back.entries.map((one) => one.id)).toEqual([old.id]);
  });
});

describe("through the real server", () => {
  async function start(store: MemoryStore, as: string | null) {
    server = createBackRoomServer({ store, auth: null, serveClient: false, identify: () => as, identifyRequest: () => as });
    await new Promise<void>((resolve) => server?.http.listen(0, () => resolve()));
    return `http://localhost:${(server.http.address() as AddressInfo).port}`;
  }

  it("hides every desk route from somebody not on the list", async () => {
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    const store = new MemoryStore();
    const ada = await player(store, "d1");
    const base = await start(store, ada.id);
    expect((await fetch(`${base}/api/admin/users`)).status).toBe(404);
    expect((await fetch(`${base}/api/admin/log`)).status).toBe(404);
    expect((await post(`${base}/api/admin/chips`, { op: "add", amount: 1, target: { all: true } })).status).toBe(404);
    expect((await post(`${base}/api/admin/reset`, { target: { all: true }, parts: ["balance"] })).status).toBe(404);
    expect((await post(`${base}/api/admin/emotes/x/delete`, {})).status).toBe(404);
  });

  it("takes a list of 500 ids, which is more than the building's small parser allows", async () => {
    const store = new MemoryStore();
    const boss = await player(store, "d-admin", "Koda");
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    const base = await start(store, boss.id);
    const ids = Array.from({ length: 500 }, (_, index) => `0123456789abcdef0123${String(index).padStart(4, "0")}`);
    const answer = await post(`${base}/api/admin/chips`, { op: "add", amount: 1, target: { ids } });
    expect(answer.status).toBe(200);
  });

  it("writes a bank float into the log", async () => {
    const store = new MemoryStore();
    const boss = await player(store, "d-admin", "Koda");
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    const base = await start(store, boss.id);
    await post(`${base}/api/admin/bank`, { amount: 50, game: "roulette" });
    const [entry] = await store.adminLog({ limit: 1, before: null });
    expect(entry).toMatchObject({ kind: "float", amount: 50, subject: "roulette", byName: "Koda" });
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run apps/server/src/admin-desk.test.ts`
Expected: FAIL — cannot find module `./admin-desk.js`.

- [ ] **Step 4: Write `admin-desk.ts`**

```ts
import { BANKS } from "@backroom/economy";
import type { AdminLogEntry, AdminTarget, Store } from "@backroom/economy";
import { adminChipsSchema, adminResetSchema } from "@backroom/shared/schemas";
import type { Express, Request, RequestHandler } from "express";
import express from "express";

/**
 * The admin desk: players, their chips, and the record of what was done.
 *
 * Every route here is behind the allowlist that mints codes, because giving
 * chips is the same power as minting them — chips nobody won. That is also
 * why every one of them writes to the log before it answers.
 */

/**
 * The routes that take a list of ids.
 *
 * The building parses JSON at eight kilobytes and five hundred ids is about
 * thirteen, so these carry their own parser and the small one steps aside for
 * them, the way it already does for an emote upload.
 */
export const ADMIN_BULK_PATHS: readonly string[] = ["/api/admin/chips", "/api/admin/reset"];
const bulkJson = express.json({ limit: "64kb" });

const PAGE = 50;

export interface SeatedTable {
  seats: ReadonlyArray<{ userId: string | null; isBot: boolean }>;
}

/**
 * How many live tables have somebody a reset would touch sitting at them.
 *
 * Seated rather than connected: a player who dropped mid-hand still has
 * chips on that felt, and nothing can give those back yet. Until tables can
 * be voided, a reset that would land under a live hand is refused.
 */
export function tablesHolding(tables: Iterable<SeatedTable>, target: AdminTarget): number {
  const wanted = "all" in target ? null : new Set(target.ids);
  let count = 0;
  for (const table of tables) {
    const held = table.seats.some(
      (seat) => !seat.isBot && seat.userId !== null && (wanted === null || wanted.has(seat.userId)),
    );
    if (held) {
      count += 1;
    }
  }
  return count;
}

export interface AdminDeskRoutes {
  store: Store;
  requireAdmin: RequestHandler;
  whoIs: (request: Request) => Promise<{ id: string; name: string } | null>;
  /** Pushes fresh balances to whoever this reached and is connected. */
  tellChipsTo: (target: AdminTarget) => Promise<void>;
  /** The live tables, read at the moment a reset is asked for. */
  tables: () => Iterable<SeatedTable>;
  /** Drops an emote from whatever the server remembers of it. */
  forgetEmote: (id: string) => void;
}

function logTarget(target: AdminTarget): "all" | string[] {
  return "all" in target ? "all" : [...new Set(target.ids)];
}

export function mountAdminDesk(app: Express, deps: AdminDeskRoutes): void {
  const { store, requireAdmin, whoIs, tellChipsTo, tables, forgetEmote } = deps;

  async function log(request: Request, entry: Omit<AdminLogEntry, "id" | "at" | "by" | "byName">) {
    const who = await whoIs(request);
    await store.logAdmin({ ...entry, by: who?.id ?? "unknown", byName: who?.name ?? "unknown" });
  }

  app.get("/api/admin/users", requireAdmin, (request, response) => {
    void (async () => {
      const offset = Math.max(0, Math.floor(Number(request.query["offset"] ?? 0)) || 0);
      const query = String(request.query["q"] ?? "").slice(0, 32);
      response.json(await store.listUsers({ query, offset, limit: PAGE }));
    })();
  });

  app.post("/api/admin/chips", requireAdmin, bulkJson, (request, response) => {
    void (async () => {
      const parsed = adminChipsSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "That is not something the desk can do." });
        return;
      }
      const { op, amount, target, note } = parsed.data;
      const result = await store.adjustBalances({ target, op, amount });
      await log(request, {
        kind: op,
        // What moved, not what was asked: taking 5,000 from somebody holding
        // 1,200 took 1,200, and the record should say so.
        amount: op === "set" ? amount : Math.abs(result.moved),
        affected: result.affected,
        target: logTarget(target),
        parts: null,
        subject: null,
        note: (note ?? "").trim(),
      });
      await tellChipsTo(target);
      response.json(result);
    })();
  });

  app.post("/api/admin/reset", requireAdmin, bulkJson, (request, response) => {
    void (async () => {
      const parsed = adminResetSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "That is not something the desk can do." });
        return;
      }
      const { target, parts, emptyBanks, note } = parsed.data;
      const held = tablesHolding(tables(), target);
      if (held > 0) {
        response.status(409).json({
          error: held === 1 ? "A table still has them seated." : `${held} tables still have them seated.`,
          seatedAt: held,
        });
        return;
      }
      const result = await store.resetUsers({ target, parts });
      await log(request, {
        kind: "reset",
        amount: 0,
        affected: result.affected,
        target: logTarget(target),
        parts: [...parts],
        subject: null,
        note: (note ?? "").trim(),
      });
      let emptied: number | undefined;
      if (emptyBanks === true) {
        emptied = 0;
        for (const bank of BANKS) {
          emptied += await store.bankEmpty(bank);
        }
        await log(request, {
          kind: "empty-banks",
          amount: emptied,
          affected: 0,
          target: "all",
          parts: null,
          subject: null,
          note: (note ?? "").trim(),
        });
      }
      await tellChipsTo(target);
      response.json(emptied === undefined ? result : { ...result, emptied });
    })();
  });

  app.get("/api/admin/log", requireAdmin, (request, response) => {
    void (async () => {
      const raw = Number(request.query["before"]);
      const before = Number.isFinite(raw) && raw > 0 ? raw : null;
      response.json({ entries: await store.adminLog({ limit: PAGE, before }) });
    })();
  });

  /**
   * Deletes an emote for good.
   *
   * A pool still holding it keeps its chips — those live on the taunt, not on
   * the emote — and its replay shows the name with nothing behind it.
   */
  app.post("/api/admin/emotes/:id/delete", requireAdmin, (request, response) => {
    void (async () => {
      const id = String(request.params["id"] ?? "");
      const emote = (await store.listEmotes(true)).find((one) => one.id === id);
      if (emote === undefined || !(await store.deleteEmote(id))) {
        response.status(404).json({ error: "No such emote." });
        return;
      }
      forgetEmote(id);
      await log(request, {
        kind: "delete-emote",
        amount: 0,
        affected: 0,
        target: "all",
        parts: null,
        subject: emote.name,
        note: "",
      });
      response.json({ ok: true });
    })();
  });
}
```

- [ ] **Step 5: Wire it into `server.ts`**

1. Import: `import { ADMIN_BULK_PATHS, mountAdminDesk } from "./admin-desk.js";` and add `AdminTarget` to the `@backroom/economy` type import.

2. The small parser skip (~line 455):

```ts
    if (request.path === EMOTE_UPLOAD_PATH || ADMIN_BULK_PATHS.includes(request.path)) {
```

Update the comment above it to name both.

3. Beside `tellChips` (~line 828), add:

```ts
  /** `tellChips` for everybody an admin action reached who has a screen open. */
  async function tellChipsTo(target: AdminTarget): Promise<void> {
    const connected = new Set<string>();
    for (const socket of io.sockets.sockets.values()) {
      const userId = socket.data.identity?.userId;
      if (typeof userId === "string") {
        connected.add(userId);
      }
    }
    const wanted = "all" in target ? connected : new Set(target.ids.filter((id) => connected.has(id)));
    await Promise.all([...wanted].map((userId) => tellChips(userId)));
  }
```

4. After `mountLeaderboard(...)` (~line 1042):

```ts
  mountAdminDesk(app, {
    store,
    requireAdmin,
    whoIs: async (request) => {
      const profile = await whoIs(request);
      return profile === null ? null : { id: profile.id, name: profile.name };
    },
    tellChipsTo,
    tables: () => [...rooms.values()].map((room) => room.table),
    forgetEmote: (id) => emotesSeen.delete(id),
  });
```

If `room.table.seats` does not typecheck as `SeatedTable` for every game's table, map explicitly: `({ seats: room.table.seats.map((seat) => ({ userId: seat.userId, isBot: seat.isBot })) })`.

5. In `POST /api/admin/bank`, after `await store.bankAdd(which, amount);`:

```ts
      const profile = await whoIs(request);
      await store.logAdmin({
        by: profile?.id ?? "unknown",
        byName: profile?.name ?? "unknown",
        kind: "float",
        amount,
        affected: 0,
        target: "all",
        parts: null,
        subject: which,
        note: "",
      });
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run apps/server/src/admin-desk.test.ts` → PASS
Then confirm the 500-id test really needs the parser change: temporarily revert step 5.2, re-run that test, watch it fail with 413/400, restore.
Run: `npm test` → PASS; `npm run typecheck` → clean; `npm run lint` → clean.

- [ ] **Step 7: Format and commit**

```bash
npx biome format --write packages/shared/src/schemas.ts apps/server/src/admin-desk.ts apps/server/src/admin-desk.test.ts apps/server/src/server.ts
git add packages/shared/src/schemas.ts apps/server/src
git commit -m "feat(server): the admin desk's routes — chips, resets, the log, emote deletion

Resets are refused while anybody they touch is seated: nothing can give
back what is on a live felt yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: A deleted emote's replay shows its name

**Files:**
- Modify: `apps/web/src/taunt/TauntStage.tsx:92`
- Modify: `apps/web/src/taunt/TauntStage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add `fireEvent` to the file's `@testing-library/react` import, then add inside `describe("the taunt stage", ...)` (the file already has the `taunt({ id })` builder and fake timers):

```tsx
  it("hides the picture of an emote that has since been deleted, and keeps the line", () => {
    const { container } = render(<TauntStage landed={[taunt({ id: "t1" })]} />);
    const art = container.querySelector(".taunt-stage__art") as HTMLImageElement;
    fireEvent.error(art);
    expect(art.hidden).toBe(true);
    expect(container.querySelector(".taunt-stage")?.textContent).toContain("Ada");
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run apps/web/src/taunt/TauntStage.test.tsx`
Expected: FAIL — `expected false to be true`.

- [ ] **Step 3: Implement**

```tsx
      {/*
        * An emote can be deleted while a pool still owes its replay. The line
        * below says everything that matters, so a picture that no longer
        * exists steps aside rather than drawing a broken image. The section
        * is keyed by play, so the next one starts visible again.
        */}
      <img
        className="taunt-stage__art"
        src={showing.image}
        alt=""
        onError={(event) => {
          event.currentTarget.hidden = true;
        }}
      />
```

- [ ] **Step 4: Run, format, commit**

Run: `npx vitest run apps/web/src/taunt/TauntStage.test.tsx` → PASS

```bash
npx biome format --write apps/web/src/taunt/TauntStage.tsx apps/web/src/taunt/TauntStage.test.tsx
git add apps/web/src/taunt
git commit -m "fix(taunt): a deleted emote's replay shows its line, not a broken image

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The tabbed shell, Banks and Codes

**Files:**
- Create: `apps/web/src/admin/api.ts`, `Banks.tsx`, `Codes.tsx`, `admin.css`, `AdminTabs.test.tsx`
- Modify: `apps/web/src/admin/Admin.tsx` (becomes the shell)
- Keep passing: `apps/web/src/admin/Admin.test.tsx` (imports `BANKS` from `./Admin.js` — re-export it)

**Interfaces:**
- Produces:

```ts
// api.ts
export const fmt: (n: number) => string;
export async function adminGet<T>(path: string): Promise<T | null>;
export async function adminPost<T>(path: string, body: unknown): Promise<{ ok: true; body: T } | { ok: false; status: number; error: string }>;
// Admin.tsx
export const TABS: ReadonlyArray<{ id: TabId; label: string }>;
export type TabId = "banks" | "players" | "codes" | "emotes" | "log";
export { BANKS } from "./Banks.js";
// Banks.tsx
export const BANKS; export function Banks(): JSX.Element;
// Codes.tsx
export function Codes(): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/admin/AdminTabs.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Admin } from "./Admin.js";

function stubFetch(allowed = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/me") {
        return { ok: true, json: async () => ({ signedIn: false, signinAvailable: false }) };
      }
      if (url.startsWith("/api/admin/")) {
        if (!allowed) {
          return { ok: false, status: 404, json: async () => ({ error: "Not found." }) };
        }
        if (url.startsWith("/api/admin/bank")) {
          return { ok: true, json: async () => ({ bank: 1000, maxStake: 10 }) };
        }
        if (url.startsWith("/api/admin/log")) {
          return { ok: true, json: async () => ({ entries: [] }) };
        }
        if (url.startsWith("/api/admin/users")) {
          return { ok: true, json: async () => ({ rows: [], total: 0 }) };
        }
        if (url.startsWith("/api/admin/codes")) {
          return { ok: true, json: async () => ({ codes: [] }) };
        }
        if (url.startsWith("/api/admin/emotes")) {
          return { ok: true, json: async () => ({ emotes: [] }) };
        }
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
}

let where = "";
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}`;
  return null;
}

function show(at: string) {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/admin" element={<><Admin /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the admin desk's tabs", () => {
  it("opens on the banks when the URL names no tab", async () => {
    stubFetch();
    show("/admin");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Banks" }).getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByRole("tabpanel").textContent).toContain("Slots");
  });

  it("opens the tab the URL names, and a press changes the URL", async () => {
    stubFetch();
    show("/admin?tab=codes");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Codes" }).getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(screen.getByRole("tab", { name: "Log" }));
    expect(where).toBe("/admin?tab=log");
    expect(screen.getByRole("tab", { name: "Log" }).getAttribute("aria-selected")).toBe("true");
  });

  it("says there is no such page to somebody the server turns away", async () => {
    stubFetch(false);
    show("/admin");
    await waitFor(() => expect(screen.getByText("No such page.")).toBeTruthy());
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run apps/web/src/admin/AdminTabs.test.tsx`
Expected: FAIL — no element with role `tab`.

- [ ] **Step 3: Write `api.ts`**

```ts
/** Numbers as the desk prints them. */
export const fmt = (n: number) => n.toLocaleString("en-US");

/** A desk read. Null for a refusal or no connection — the tab says so. */
export async function adminGet<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { credentials: "include" });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * A desk write, with the server's own words when it refuses. The server
 * decides every limit; this only carries its answer back.
 */
export async function adminPost<T>(
  path: string,
  body: unknown,
): Promise<{ ok: true; body: T } | { ok: false; status: number; error: string }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      return { ok: false, status: response.status, error: answer.error ?? "That was refused." };
    }
    return { ok: true, body: answer as T };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the room." };
  }
}
```

- [ ] **Step 4: Write `Banks.tsx`**

Move `BANKS` (with its doc comment, unchanged) and `Bank` out of `Admin.tsx`. The paragraph about banks moves out of every card to once above the grid:

```tsx
import { useCallback, useEffect, useState } from "react";
import { adminGet, adminPost, fmt } from "./api.js";

/* BANKS, with its existing doc comment, exactly as it is in Admin.tsx today */
export const BANKS = [
  { game: "slots", label: "Slots", per: "a spin" },
  { game: "blackjack", label: "Blackjack", per: "a hand" },
  { game: "roulette", label: "Roulette", per: "straight up" },
  { game: "two-up", label: "Two-up", per: "a five-odds chip" },
] as const;

interface Held {
  bank: number;
  maxStake: number;
}

export function Banks() {
  return (
    <>
      <p className="desk__lede">
        Players fill each bank from then on, chip for chip, and every win comes back out of it.
        A float is the only other way in. Each game keeps its own — a shared one would be
        whichever game keeps the most quietly paying for the one that keeps the least.
      </p>
      <div className="desk__grid">
        {BANKS.map((bank) => (
          <Bank key={bank.game} game={bank.game} label={bank.label} per={bank.per} />
        ))}
      </div>
    </>
  );
}

function Bank({ game, label, per }: { game: string; label: string; per: string }) {
  const [held, setHeld] = useState<Held | null>(null);
  const [amount, setAmount] = useState("50000");
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(() => {
    void adminGet<Held>(`/api/admin/bank?game=${game}`).then(setHeld);
  }, [game]);

  useEffect(load, [load]);

  const float = () => {
    const chips = Number(amount);
    if (!Number.isFinite(chips) || chips < 1) {
      setSaid("Give it an amount.");
      return;
    }
    void adminPost<Held>("/api/admin/bank", { amount: Math.floor(chips), game }).then((answer) => {
      if (!answer.ok) {
        setSaid(answer.error);
        return;
      }
      setHeld(answer.body);
      setSaid(`Added ${fmt(Math.floor(chips))}.`);
    });
  };

  return (
    <section className="panel desk__card">
      <p className="panel__label">{label}</p>
      {held === null ? (
        <p className="panel__note">Could not read it.</p>
      ) : (
        <>
          <strong className="desk__figure code__chips">{fmt(held.bank)}</strong>
          <p className="panel__note">
            {held.maxStake < 1
              ? `Empty, so ${label.toLowerCase()} will not take a stake at all.`
              : `Covers ${fmt(held.maxStake)} ${per}.`}
          </p>
        </>
      )}
      <form
        className="desk__inline"
        onSubmit={(event) => {
          event.preventDefault();
          float();
        }}
      >
        <input
          className="field__input"
          aria-label={`Float for ${label}`}
          value={amount}
          inputMode="numeric"
          onChange={(event) => setAmount(event.target.value)}
        />
        <button type="submit" className="btn btn--small">
          Float
        </button>
      </form>
      {said === null ? null : (
        <p className="panel__note" role="status">
          {said}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Write `Codes.tsx`**

Move `Code`, `Row` and `Mint` out of `Admin.tsx`. The mint form becomes one wrapping row, and the list loads itself:

```tsx
import { useCallback, useEffect, useState } from "react";
import { adminGet, adminPost, fmt } from "./api.js";

interface Code {
  code: string;
  chips: number;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: number | null;
  note: string;
  createdAt: number;
  revoked: boolean;
}

export function Codes() {
  const [codes, setCodes] = useState<Code[] | null>(null);

  const load = useCallback(() => {
    void adminGet<{ codes: Code[] }>("/api/admin/codes").then((body) => setCodes(body?.codes ?? []));
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <Mint onMinted={load} />
      <section className="panel">
        <p className="panel__label">Codes</p>
        {codes === null || codes.length === 0 ? (
          <p className="panel__note">None minted yet.</p>
        ) : (
          <div className="scroller">
            <table className="history">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>For</th>
                  <th className="history__num">Chips</th>
                  <th className="history__num">Used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {codes.map((entry) => (
                  <Row key={entry.code} entry={entry} onRevoked={load} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
```

`Row` is unchanged from today's `Admin.tsx` except its revoke becomes
`void adminPost("/api/admin/codes/" + entry.code + "/revoke", {}).then(onRevoked);`.

`Mint` keeps its state and `mint` logic (switch the fetch to `adminPost<{ code: Code }>("/api/admin/codes", {...})`, saying `answer.ok ? \`Minted ${answer.body.code.code}\` : answer.error`), and renders:

```tsx
    <section className="panel">
      <p className="panel__label">New code</p>
      <form
        className="desk__row"
        onSubmit={(event) => {
          event.preventDefault();
          mint();
        }}
      >
        <label className="field">
          <span className="field__label">Chips</span>
          <input className="field__input" value={chips} inputMode="numeric" onChange={(event) => setChips(event.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">People (blank: anyone, once each)</span>
          <input className="field__input" value={uses} inputMode="numeric" placeholder="anyone" onChange={(event) => setUses(event.target.value)} />
        </label>
        <label className="field desk__grow">
          <span className="field__label">What it is for</span>
          <input className="field__input" value={note} maxLength={120} placeholder="Launch weekend" onChange={(event) => setNote(event.target.value)} />
        </label>
        <button type="submit" className="btn">Mint</button>
      </form>
      {said === null ? null : <p className="panel__note" role="status">{said}</p>}
    </section>
```

- [ ] **Step 6: Rewrite `Admin.tsx` as the shell**

Players, Emotes and Log tabs render placeholders here that Tasks 7–9 replace. To keep this task's test green the placeholders are real components — `Emotes` already exists; create minimal `Players.tsx` and `Log.tsx` returning `<p className="panel__note">Loading…</p>` so the import resolves.

```tsx
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccount } from "../game/useAccount.js";
import { Navbar } from "../nav/Navbar.js";
import { Banks } from "./Banks.js";
import { Codes } from "./Codes.js";
import { Emotes } from "./Emotes.js";
import { Log } from "./Log.js";
import { Players } from "./Players.js";
import "./admin.css";

export { BANKS } from "./Banks.js";

export type TabId = "banks" | "players" | "codes" | "emotes" | "log";

export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "banks", label: "Banks" },
  { id: "players", label: "Players" },
  { id: "codes", label: "Codes" },
  { id: "emotes", label: "Emotes" },
  { id: "log", label: "Log" },
];

const PANELS: Record<TabId, () => JSX.Element> = {
  banks: Banks,
  players: Players,
  codes: Codes,
  emotes: Emotes,
  log: Log,
};

/**
 * The admin desk.
 *
 * Reachable only by the Discord ids in the allowlist, and invisible to anyone
 * else — the server answers "not found" rather than "not allowed", so whether
 * this page exists is not something a visitor learns by asking.
 *
 * The tab lives in the URL so a reload stays where it was and one admin can
 * send another straight to the players.
 */
export function Admin() {
  const account = useAccount();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: TabId = TABS.some((one) => one.id === asked) ? (asked as TabId) : "banks";

  useEffect(() => {
    void fetch("/api/admin/log", { credentials: "include" })
      .then((response) => setAllowed(response.ok))
      .catch(() => setAllowed(false));
  }, []);

  const Panel = PANELS[tab];

  return (
    <main className="room">
      <Navbar account={account} />
      {allowed === null ? null : allowed ? (
        <div className="desk">
          <div className="desk__tabs" role="tablist" aria-label="Admin desk">
            {TABS.map((one) => (
              <button
                key={one.id}
                type="button"
                role="tab"
                id={`desk-tab-${one.id}`}
                aria-selected={one.id === tab}
                aria-controls="desk-panel"
                className="desk__tab"
                onClick={() => setParams({ tab: one.id })}
              >
                {one.label}
              </button>
            ))}
          </div>
          <div
            className="desk__panel"
            role="tabpanel"
            id="desk-panel"
            aria-labelledby={`desk-tab-${tab}`}
            key={tab}
          >
            <Panel />
          </div>
        </div>
      ) : (
        <p className="not-found">No such page.</p>
      )}
    </main>
  );
}
```

If the project's React types do not expose a global `JSX`, type `PANELS` as `Record<TabId, () => ReactNode>` with `import type { ReactNode } from "react"`.

`Emotes` currently renders a fragment of two panels — that is fine inside the tabpanel until Task 8.

- [ ] **Step 7: Write `admin.css` (shell, banks, codes)**

First confirm it is imported: `grep -rn "admin.css" apps/web/src` must show `Admin.tsx`.

```css
/* ------------------------------------------------------------ the admin desk */

.desk {
  display: grid;
  gap: var(--gr-space-4);
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding-block: var(--gr-space-4);
}

.desk__tabs {
  display: flex;
  gap: var(--gr-space-1);
  overflow-x: auto;
  border-bottom: var(--gr-edge-hair);
  /* The bar scrolls inside itself on a narrow phone; the page never does. */
  scrollbar-width: none;
}

.desk__tab {
  flex: none;
  min-height: 44px;
  padding: 0 var(--gr-space-4);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--gr-color-ink-dim);
  font-family: var(--gr-font-ui);
  font-size: var(--gr-text-sm);
  font-weight: 500;
  cursor: pointer;
}

.desk__tab:hover {
  color: var(--gr-color-ink);
}

.desk__tab[aria-selected="true"] {
  color: var(--gr-color-neon-hi);
  border-bottom-color: var(--gr-color-neon);
}

.desk__tab:focus-visible {
  outline: 2px solid var(--gr-color-neon-hi);
  outline-offset: -2px;
}

/* One short arrival per tab: the panel is keyed by tab, so this plays once. */
.desk__panel {
  display: grid;
  gap: var(--gr-space-4);
  animation: desk-arrive 160ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

@keyframes desk-arrive {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

.desk__lede {
  margin: 0;
  font-size: var(--gr-text-sm);
  color: var(--gr-color-ink-dim);
  max-width: 70ch;
}

.desk__grid {
  display: grid;
  gap: var(--gr-space-3);
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}

.desk__card {
  display: grid;
  gap: var(--gr-space-2);
  align-content: start;
}

.desk__card .panel__label,
.desk__card .panel__note {
  margin: 0;
}

.desk__figure {
  font-family: var(--gr-font-data);
  font-size: var(--gr-text-xl);
  font-variant-numeric: tabular-nums;
}

.desk__inline {
  display: flex;
  gap: var(--gr-space-2);
}

.desk__inline .field__input {
  flex: 1;
  min-width: 0;
}

.desk__row {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--gr-space-3);
}

.desk__row .field {
  margin: 0;
}

.desk__grow {
  flex: 1 1 220px;
}

@media (max-width: 480px) {
  .desk__row > * {
    flex: 1 1 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .desk__panel {
    animation: none;
  }
}
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run apps/web/src/admin` → PASS (both `Admin.test.tsx` and `AdminTabs.test.tsx`)
Run: `npm run typecheck && npm run lint` → clean

- [ ] **Step 9: Check it in the browser at 375px and at desktop**

Start the dev server with the Browser pane (`preview_start`), sign in as an admin (or run the server with `ADMIN_DISCORD_IDS` including your id), open `/admin`, switch tabs, `resize_window` to 375×812, confirm nothing scrolls sideways (`document.documentElement.scrollWidth === 375`), reset with preset `desktop`. Screenshot both.

- [ ] **Step 10: Format and commit**

```bash
npx biome format --write apps/web/src/admin
git add apps/web/src/admin
git commit -m "feat(admin): the desk as tabs, with banks and codes laid out to be used

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Players — list, selection, grants and resets

**Files:**
- Modify: `apps/web/src/admin/Players.tsx` (replace the placeholder)
- Create: `apps/web/src/admin/dialogs.tsx`
- Create: `apps/web/src/admin/Players.test.tsx`
- Modify: `apps/web/src/admin/admin.css`

**Interfaces:**
- Consumes: `adminGet`, `adminPost`, `fmt` from `api.ts`; routes from Task 4.
- Produces:

```ts
// dialogs.tsx
export type Who = { all: true } | { ids: string[] };
export function chipsSentence(op: "add" | "remove" | "set", amount: number, count: number | "everyone"): string;
export function ChipsDialog(props: { op: "add" | "remove" | "set"; who: Who; count: number | "everyone"; onClose: () => void; onDone: () => void }): JSX.Element;
export function ResetDialog(props: { who: Who; count: number | "everyone"; onClose: () => void; onDone: () => void }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/admin/Players.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chipsSentence } from "./dialogs.js";
import { Players } from "./Players.js";

const ROWS = [
  { id: "u1", name: "Ada", avatar: null, accentColor: null, chips: 12_000, games: 4, createdAt: 1 },
  { id: "u2", name: "Bo", avatar: null, accentColor: null, chips: 900, games: 1, createdAt: 2 },
];

const posted: Array<{ url: string; body: unknown }> = [];

function stubFetch(resetAnswer: { status: number; body: unknown } = { status: 200, body: { affected: 1 } }) {
  posted.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        posted.push({ url, body });
        if (url === "/api/admin/reset") {
          return { ok: resetAnswer.status === 200, status: resetAnswer.status, json: async () => resetAnswer.body };
        }
        return { ok: true, status: 200, json: async () => ({ affected: 1, moved: 1 }) };
      }
      return { ok: true, status: 200, json: async () => ({ rows: ROWS, total: 2 }) };
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("what a chips dialog says it will do", () => {
  it("says it in words", () => {
    expect(chipsSentence("add", 5000, 3)).toBe("Give 5,000 chips to 3 players.");
    expect(chipsSentence("remove", 5000, 1)).toBe("Take up to 5,000 chips from 1 player.");
    expect(chipsSentence("set", 0, "everyone")).toBe("Set everyone's balance to 0 chips.");
  });
});

describe("the players tab", () => {
  it("raises the action bar with how many are selected", async () => {
    stubFetch();
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Selected players" })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ada" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bo" }));
    const bar = screen.getByRole("region", { name: "Selected players" });
    expect(bar.textContent).toContain("2 selected");
  });

  it("gives chips to the selected players", async () => {
    stubFetch();
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ada" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected players" })).getByRole("button", { name: "Add" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Chips"), { target: { value: "250" } });
    fireEvent.change(within(dialog).getByLabelText("Note"), { target: { value: "bug" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Give" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      url: "/api/admin/chips",
      body: { op: "add", amount: 250, target: { ids: ["u1"] }, note: "bug" },
    });
  });

  it("will not reset everyone until RESET is typed", async () => {
    stubFetch();
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Reset everyone…" }));

    const dialog = screen.getByRole("dialog");
    const go = within(dialog).getByRole("button", { name: "Reset" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Type RESET to confirm"), { target: { value: "reset" } });
    expect(go.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Type RESET to confirm"), { target: { value: "RESET" } });
    expect(go.disabled).toBe(false);

    fireEvent.click(within(dialog).getByLabelText("Also empty the banks"));
    fireEvent.click(go);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({ target: { all: true }, parts: ["balance"], emptyBanks: true, note: "" });
  });

  it("offers to empty the banks only when resetting everyone", async () => {
    stubFetch();
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ada" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected players" })).getByRole("button", { name: "Reset…" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Also empty the banks")).toBeNull();
    expect(within(dialog).queryByLabelText("Type RESET to confirm")).toBeNull();
  });

  it("shows the server's refusal when players are still seated", async () => {
    stubFetch({ status: 409, body: { error: "2 tables still have them seated.", seatedAt: 2 } });
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ada" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected players" })).getByRole("button", { name: "Reset…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("2 tables still have them seated."));
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run apps/web/src/admin/Players.test.tsx`
Expected: FAIL — `chipsSentence` is not exported / no "Ada".

- [ ] **Step 3: Write `dialogs.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { adminPost, fmt } from "./api.js";

export type Who = { all: true } | { ids: string[] };

const PARTS = [
  { id: "balance", label: "Balance", hint: "back to the starting 10,000" },
  { id: "stats", label: "Stats", hint: "totals and every game's figures" },
  { id: "jar", label: "Tip jar", hint: "level, favours and tonight's pay" },
  { id: "history", label: "History", hint: "transfers, redeemed codes, past games" },
] as const;

type Part = (typeof PARTS)[number]["id"];

function whom(count: number | "everyone"): string {
  return count === "everyone" ? "everyone" : count === 1 ? "1 player" : `${fmt(count)} players`;
}

/** What pressing the button will do, said before it is pressed. */
export function chipsSentence(op: "add" | "remove" | "set", amount: number, count: number | "everyone"): string {
  switch (op) {
    case "add":
      return `Give ${fmt(amount)} chips to ${whom(count)}.`;
    case "remove":
      return `Take up to ${fmt(amount)} chips from ${whom(count)}.`;
    case "set":
      return count === "everyone"
        ? `Set everyone's balance to ${fmt(amount)} chips.`
        : `Set ${whom(count)}'s balance to ${fmt(amount)} chips.`;
  }
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="desk__scrim" onClick={onClose}>
      <div
        ref={box}
        className="panel desk__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="panel__label">{title}</p>
        {children}
      </div>
    </div>
  );
}

const VERB = { add: "Give", remove: "Take", set: "Set" } as const;
const TITLE = { add: "Give chips", remove: "Take chips", set: "Set balance" } as const;

export function ChipsDialog({
  op,
  who,
  count,
  onClose,
  onDone,
}: {
  op: "add" | "remove" | "set";
  who: Who;
  count: number | "everyone";
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(op === "set" ? "10000" : "1000");
  const [note, setNote] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chips = Math.floor(Number(amount));
  const valid = Number.isFinite(chips) && chips >= (op === "set" ? 0 : 1) && chips <= 10_000_000;

  const go = () => {
    setBusy(true);
    void adminPost<{ affected: number; moved: number }>("/api/admin/chips", {
      op,
      amount: chips,
      target: who,
      note: note.trim(),
    }).then((answer) => {
      setBusy(false);
      if (!answer.ok) {
        setSaid(answer.error);
        return;
      }
      onDone();
    });
  };

  return (
    <Dialog title={TITLE[op]} onClose={onClose}>
      <form
        className="desk__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !busy) {
            go();
          }
        }}
      >
        <label className="field">
          <span className="field__label">Chips</span>
          <input className="field__input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Note</span>
          <input className="field__input" maxLength={120} value={note} placeholder="Why" onChange={(event) => setNote(event.target.value)} />
        </label>
        <p className="panel__note">{valid ? chipsSentence(op, chips, count) : "A whole number, up to 10,000,000."}</p>
        {said === null ? null : <p className="panel__note desk__bad" role="alert">{said}</p>}
        <div className="desk__buttons">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={!valid || busy}>
            {VERB[op]}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ResetDialog({
  who,
  count,
  onClose,
  onDone,
}: {
  who: Who;
  count: number | "everyone";
  onClose: () => void;
  onDone: () => void;
}) {
  const everyone = "all" in who;
  const [parts, setParts] = useState<Set<Part>>(new Set(["balance"]));
  const [emptyBanks, setEmptyBanks] = useState(false);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Resetting everybody is the one press on this desk that cannot be taken
  // back by another press, so it asks for more than a click.
  const ready = parts.size > 0 && (!everyone || typed === "RESET") && !busy;

  const flip = (part: Part) => {
    setParts((current) => {
      const next = new Set(current);
      if (next.has(part)) {
        next.delete(part);
      } else {
        next.add(part);
      }
      return next;
    });
  };

  const go = () => {
    setBusy(true);
    void adminPost<{ affected: number }>("/api/admin/reset", {
      target: who,
      parts: PARTS.map((part) => part.id).filter((id) => parts.has(id)),
      ...(everyone ? { emptyBanks } : {}),
      note: note.trim(),
    }).then((answer) => {
      setBusy(false);
      if (!answer.ok) {
        setSaid(answer.error);
        return;
      }
      onDone();
    });
  };

  return (
    <Dialog title={everyone ? "Reset everyone" : `Reset ${whom(count)}`} onClose={onClose}>
      <form
        className="desk__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) {
            go();
          }
        }}
      >
        <fieldset className="desk__parts">
          <legend className="field__label">What to wipe</legend>
          {PARTS.map((part) => (
            <label key={part.id} className="desk__check">
              <input type="checkbox" checked={parts.has(part.id)} onChange={() => flip(part.id)} />
              <span>
                {part.label} <small>{part.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {everyone ? (
          <>
            <label className="desk__check">
              <input type="checkbox" checked={emptyBanks} onChange={(event) => setEmptyBanks(event.target.checked)} />
              <span>Also empty the banks</span>
            </label>
            <label className="field">
              <span className="field__label">Type RESET to confirm</span>
              <input className="field__input" value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
            </label>
          </>
        ) : null}
        <label className="field">
          <span className="field__label">Note</span>
          <input className="field__input" maxLength={120} value={note} placeholder="Why" onChange={(event) => setNote(event.target.value)} />
        </label>
        <p className="panel__note">Players stay signed in. Nobody seated at a table can be reset until they leave it.</p>
        {said === null ? null : <p className="panel__note desk__bad" role="alert">{said}</p>}
        <div className="desk__buttons">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn desk__danger" disabled={!ready}>
            Reset
          </button>
        </div>
      </form>
    </Dialog>
  );
}
```

Note: `aria-label="Also empty the banks"` is reached by `getByLabelText` through the wrapping `<label>`; if Testing Library does not associate it, give the checkbox `aria-label="Also empty the banks"` directly.

- [ ] **Step 4: Write `Players.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "../game/Avatar.js";
import { adminGet, fmt } from "./api.js";
import { ChipsDialog, ResetDialog } from "./dialogs.js";
import type { Who } from "./dialogs.js";

interface Row {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  games: number;
  createdAt: number;
}

const PAGE = 50;

type Open =
  | { kind: "add" | "remove" | "set"; who: Who; count: number | "everyone" }
  | { kind: "reset"; who: Who; count: number | "everyone" }
  | null;

const joined = (at: number) =>
  at > 0 ? new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

/**
 * Everybody with an account, and what an admin may do to them.
 *
 * Selection is by id and survives paging and searching, so an admin can
 * gather a handful of people from different pages and act on them once.
 */
export function Players() {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ rows: Row[]; total: number } | null>(null);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<Open>(null);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = encodeURIComponent(query.trim());
    void adminGet<{ rows: Row[]; total: number }>(`/api/admin/users?q=${q}&offset=${offset}`).then((body) =>
      setPage(body ?? { rows: [], total: 0 }),
    );
  }, [query, offset]);

  useEffect(load, [load]);

  const toggle = (row: Row) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        next.set(row.id, row.name);
      }
      return next;
    });
  };

  const picked: Who = { ids: [...selected.keys()] };
  const close = () => setOpen(null);
  const done = (what: string) => () => {
    setOpen(null);
    setSaid(what);
    load();
  };

  return (
    <>
      <div className="desk__row desk__players-head">
        <label className="field desk__grow">
          <span className="field__label">Find a player</span>
          <input
            className="field__input"
            type="search"
            value={query}
            placeholder="Name"
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        <button type="button" className="btn btn--ghost" onClick={() => setOpen({ kind: "add", who: { all: true }, count: "everyone" })}>
          Give everyone…
        </button>
        <button type="button" className="btn btn--ghost desk__danger" onClick={() => setOpen({ kind: "reset", who: { all: true }, count: "everyone" })}>
          Reset everyone…
        </button>
      </div>

      {said === null ? null : <p className="panel__note" role="status">{said}</p>}

      <section className="panel">
        {page === null ? (
          <p className="panel__note">Loading…</p>
        ) : page.rows.length === 0 ? (
          <p className="panel__note">Nobody by that name.</p>
        ) : (
          <ul className="desk__people">
            {page.rows.map((row) => (
              <li key={row.id} className={`desk__person${selected.has(row.id) ? " desk__person--on" : ""}`}>
                <label className="desk__pick">
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.name}`}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row)}
                  />
                </label>
                <Avatar name={row.name} avatar={row.avatar} accentColor={row.accentColor} className="desk__face" />
                <span className="desk__name">{row.name}</span>
                <span className="desk__chips code__chips">{fmt(row.chips)}</span>
                <span className="desk__meta">
                  {fmt(row.games)} games · joined {joined(row.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {page !== null && page.total > PAGE ? (
          <div className="desk__buttons">
            <button type="button" className="btn btn--ghost btn--small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Previous
            </button>
            <span className="panel__note">
              {fmt(offset + 1)}–{fmt(Math.min(offset + PAGE, page.total))} of {fmt(page.total)}
            </span>
            <button type="button" className="btn btn--ghost btn--small" disabled={offset + PAGE >= page.total} onClick={() => setOffset(offset + PAGE)}>
              Next
            </button>
          </div>
        ) : null}
      </section>

      {selected.size === 0 ? null : (
        <section className="desk__bar" aria-label="Selected players">
          <span className="desk__count">{fmt(selected.size)} selected</span>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setSelected(new Map())}>
            Clear
          </button>
          <span className="desk__spacer" />
          {(["add", "remove", "set"] as const).map((kind) => (
            <button key={kind} type="button" className="btn btn--small" onClick={() => setOpen({ kind, who: picked, count: selected.size })}>
              {kind === "add" ? "Add" : kind === "remove" ? "Remove" : "Set"}
            </button>
          ))}
          <button type="button" className="btn btn--small desk__danger" onClick={() => setOpen({ kind: "reset", who: picked, count: selected.size })}>
            Reset…
          </button>
        </section>
      )}

      {open === null ? null : open.kind === "reset" ? (
        <ResetDialog who={open.who} count={open.count} onClose={close} onDone={done("Reset done.")} />
      ) : (
        <ChipsDialog op={open.kind} who={open.who} count={open.count} onClose={close} onDone={done("Done.")} />
      )}
    </>
  );
}
```

Check `Avatar`'s props against `apps/web/src/game/Avatar.tsx` (the navbar passes `name`, `avatar`, `accentColor`, `className`).

- [ ] **Step 5: Add the Players and dialog styles to `admin.css`**

```css
.desk__players-head {
  align-items: end;
}

.desk__people {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}

.desk__person {
  display: grid;
  grid-template-columns: 44px 32px minmax(0, 1fr) auto;
  grid-template-areas: "pick face name chips" "pick face meta chips";
  align-items: center;
  column-gap: var(--gr-space-3);
  padding: var(--gr-space-2) 0;
  border-bottom: var(--gr-edge-soft);
}

.desk__person:last-child {
  border-bottom: none;
}

.desk__person--on {
  background: color-mix(in srgb, var(--gr-color-neon) 8%, transparent);
}

/* A whole 44px column to press, not a 13px box. */
.desk__pick {
  grid-area: pick;
  display: grid;
  place-items: center;
  min-height: 44px;
  cursor: pointer;
}

.desk__pick input {
  width: 18px;
  height: 18px;
}

.desk__face {
  grid-area: face;
  width: 32px;
  height: 32px;
}

.desk__name {
  grid-area: name;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.desk__meta {
  grid-area: meta;
  font-size: var(--gr-text-xs);
  color: var(--gr-color-ink-dim);
}

.desk__chips {
  grid-area: chips;
  font-family: var(--gr-font-data);
  font-variant-numeric: tabular-nums;
}

/* Pinned to the bottom, where a thumb already is. */
.desk__bar {
  position: sticky;
  bottom: var(--gr-space-3);
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gr-space-2);
  padding: var(--gr-space-3);
  border: 1px solid color-mix(in srgb, var(--gr-color-neon) 45%, transparent);
  border-radius: var(--gr-radius-sm);
  background: rgb(8 12 20 / 0.94);
  box-shadow: var(--gr-lift-low);
  animation: desk-arrive 160ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.desk__count {
  font-weight: 500;
}

.desk__spacer {
  flex: 1;
}

.desk__scrim {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding-inline: var(--gr-space-4);
  background: rgb(0 0 0 / 0.55);
}

.desk__dialog {
  width: min(420px, 100%);
  max-height: calc(100dvh - 2 * var(--gr-space-4));
  overflow-y: auto;
  background: rgb(10 14 22 / 0.98);
  animation: desk-arrive 160ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.desk__form {
  display: grid;
  gap: var(--gr-space-3);
}

.desk__form .field,
.desk__form .panel__note {
  margin: 0;
}

.desk__parts {
  display: grid;
  gap: var(--gr-space-1);
  margin: 0;
  padding: 0;
  border: none;
}

.desk__check {
  display: flex;
  align-items: center;
  gap: var(--gr-space-3);
  min-height: 44px;
  cursor: pointer;
}

.desk__check small {
  color: var(--gr-color-ink-dim);
}

.desk__buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: var(--gr-space-2);
}

.desk__bad {
  color: var(--gr-color-bad);
}

.btn.desk__danger:not(:disabled) {
  border-color: color-mix(in srgb, var(--gr-color-bad) 60%, transparent);
  color: var(--gr-color-bad);
  background: color-mix(in srgb, var(--gr-color-bad) 10%, transparent);
}

@media (max-width: 480px) {
  .desk__person {
    grid-template-columns: 44px 32px minmax(0, 1fr);
    grid-template-areas: "pick face name" "pick face chips" "pick face meta";
  }

  .desk__bar .btn {
    flex: 1 1 calc(50% - var(--gr-space-2));
    min-height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .desk__bar,
  .desk__dialog {
    animation: none;
  }
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run apps/web/src/admin` → PASS
Run: `npm run typecheck && npm run lint` → clean

- [ ] **Step 7: Check in the browser**

On `/admin?tab=players`: select two players, give chips, confirm the balances in the list move; open Reset everyone and confirm the button stays disabled until `RESET`. At 375px: the action bar's buttons wrap in pairs, rows stack, `scrollWidth === 375`. Screenshot. Reset the viewport to `desktop`.

- [ ] **Step 8: Format and commit**

```bash
npx biome format --write apps/web/src/admin
git add apps/web/src/admin
git commit -m "feat(admin): the players tab — find, select, give, take, set, reset

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Emotes — card grid with Retire and Delete

**Files:**
- Modify: `apps/web/src/admin/Emotes.tsx`
- Create: `apps/web/src/admin/Emotes.test.tsx`
- Modify: `apps/web/src/admin/admin.css`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Emotes } from "./Emotes.js";

const EMOTE = {
  id: "e1", name: "Smug", cost: 250, imageMime: "image/gif", soundMime: null,
  imageBytes: 2048, soundBytes: null, createdAt: 1, retired: false,
};

const posted: string[] = [];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stub() {
  posted.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted.push(url);
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ emotes: [EMOTE] }) };
    }),
  );
}

describe("deleting an emote", () => {
  it("asks once before it sends", async () => {
    stub();
    render(<Emotes />);
    const card = await waitFor(() => screen.getByRole("article", { name: "Smug" }));
    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));
    expect(posted).toEqual([]);
    fireEvent.click(within(card).getByRole("button", { name: "Delete for good?" }));
    await waitFor(() => expect(posted).toEqual(["/api/admin/emotes/e1/delete"]));
  });

  it("stops asking after a moment", async () => {
    stub();
    render(<Emotes />);
    const card = await waitFor(() => screen.getByRole("article", { name: "Smug" }));
    vi.useFakeTimers();
    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(within(card).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(posted).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run apps/web/src/admin/Emotes.test.tsx`
Expected: FAIL — no `article` named "Smug".

- [ ] **Step 3: Implement**

In `Emotes.tsx`:

1. Replace the second `<section className="panel">` (the table) with:

```tsx
      <section className="panel">
        <p className="panel__label">Emotes</p>
        {emotes === null || emotes.length === 0 ? (
          <p className="panel__note">None yet.</p>
        ) : (
          <div className="desk__emotes">
            {emotes.map((emote) => (
              <EmoteCard key={emote.id} emote={emote} onChanged={load} />
            ))}
          </div>
        )}
        <p className="panel__note">
          Retiring one stops it being offered and keeps its picture for any replay still owed.
          Deleting one removes it for good; a replay still owed shows its name without it.
        </p>
      </section>
```

2. Add below `Emotes`:

```tsx
/**
 * One emote, and the two ways to be rid of it.
 *
 * Delete arms on the first press and fires on the second, and disarms itself
 * after a moment — the same bargain as leaving a table, because it is the
 * one press here that cannot be undone.
 */
function EmoteCard({ emote, onChanged }: { emote: Emote; onChanged: () => void }) {
  const [arming, setArming] = useState(false);

  useEffect(() => {
    if (!arming) {
      return;
    }
    const timer = setTimeout(() => setArming(false), 3000);
    return () => clearTimeout(timer);
  }, [arming]);

  const post = (path: string) => {
    void fetch(path, { method: "POST", credentials: "include" }).then(onChanged);
  };

  return (
    <article className={`desk__emote${emote.retired ? " desk__emote--retired" : ""}`} aria-label={emote.name}>
      <img className="desk__emote-art" src={`/api/emotes/${emote.id}/image`} alt="" />
      <div className="desk__emote-text">
        <strong>{emote.name}</strong>
        <span className="panel__note">
          <span className="code__chips">{fmt(emote.cost)}</span> · {emote.soundMime === null ? "no sound" : "sound"} ·{" "}
          {size(emote.imageBytes + (emote.soundBytes ?? 0))}
          {emote.retired ? " · retired" : ""}
        </span>
      </div>
      <div className="desk__buttons">
        {emote.retired ? null : (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => post(`/api/admin/emotes/${emote.id}/retire`)}>
            Retire
          </button>
        )}
        <button
          type="button"
          className={`btn btn--ghost btn--small${arming ? " desk__danger" : ""}`}
          onClick={() => {
            if (arming) {
              post(`/api/admin/emotes/${emote.id}/delete`);
              return;
            }
            setArming(true);
          }}
        >
          {arming ? "Delete for good?" : "Delete"}
        </button>
      </div>
    </article>
  );
}
```

3. Wrap the upload form's fields (name, cost, picture, sound) in `<div className="desk__two">…</div>` so they sit in two columns on a desk.

4. Update the `fmt` import to come from `./api.js` and delete the local `fmt`.

- [ ] **Step 4: Add styles to `admin.css`**

```css
.desk__two {
  display: grid;
  gap: var(--gr-space-3);
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.desk__emotes {
  display: grid;
  gap: var(--gr-space-3);
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  margin-bottom: var(--gr-space-3);
}

.desk__emote {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: var(--gr-space-2) var(--gr-space-3);
  align-items: center;
  padding: var(--gr-space-3);
  border: var(--gr-edge-hair);
  border-radius: var(--gr-radius-sm);
}

.desk__emote .desk__buttons {
  grid-column: 1 / -1;
  justify-content: flex-start;
}

.desk__emote--retired {
  opacity: 0.6;
}

.desk__emote-art {
  width: 56px;
  height: 56px;
  object-fit: contain;
  border-radius: var(--gr-radius-sm);
  background: rgb(0 0 0 / 0.3);
}

.desk__emote-text {
  display: grid;
  min-width: 0;
}

.desk__emote-text strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desk__emote-text .panel__note {
  margin: 0;
}
```

- [ ] **Step 5: Run, check, commit**

Run: `npx vitest run apps/web/src/admin` → PASS; `npm run typecheck && npm run lint` → clean.
Browser: `/admin?tab=emotes` at desktop and 375px; delete a test emote; screenshot.

```bash
npx biome format --write apps/web/src/admin
git add apps/web/src/admin
git commit -m "feat(admin): emotes as cards, and deleting one for good

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The log tab

**Files:**
- Modify: `apps/web/src/admin/Log.tsx` (replace the placeholder)
- Create: `apps/web/src/admin/Log.test.tsx`
- Modify: `apps/web/src/admin/admin.css`

**Interfaces:**
- Produces: `export function describeEntry(entry: LogEntry): string;` where `LogEntry` mirrors `AdminLogEntry` from Task 2 (redeclared here — the web bundle cannot import `@backroom/economy`).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "./Log.js";
import { Log, describeEntry } from "./Log.js";

const entry = (over: Partial<LogEntry>): LogEntry => ({
  id: "x", at: 1_700_000_000_000, by: "u", byName: "Koda", kind: "add", amount: 5000,
  affected: 1, target: ["u1"], parts: null, subject: null, note: "", ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("what a log line says", () => {
  it("says each kind of act in words", () => {
    expect(describeEntry(entry({}))).toBe("Gave 5,000 chips to 1 player");
    expect(describeEntry(entry({ kind: "add", target: "all", affected: 40 }))).toBe("Gave 5,000 chips to everyone (40)");
    expect(describeEntry(entry({ kind: "remove", affected: 3, target: ["a", "b", "c"] }))).toBe("Took 5,000 chips from 3 players");
    expect(describeEntry(entry({ kind: "set", amount: 0 }))).toBe("Set 1 player's balance to 0 chips");
    expect(describeEntry(entry({ kind: "reset", parts: ["balance", "stats"], affected: 2, target: ["a", "b"] }))).toBe(
      "Reset balance and stats for 2 players",
    );
    expect(describeEntry(entry({ kind: "reset", parts: ["balance", "stats", "history"], target: "all", affected: 9 }))).toBe(
      "Reset balance, stats and history for everyone (9)",
    );
    expect(describeEntry(entry({ kind: "float", amount: 50_000, subject: "roulette" }))).toBe("Floated 50,000 chips into the roulette bank");
    expect(describeEntry(entry({ kind: "empty-banks", amount: 12 }))).toBe("Emptied the banks of 12 chips");
    expect(describeEntry(entry({ kind: "delete-emote", subject: "Smug" }))).toBe("Deleted the emote Smug");
  });
});

describe("the log tab", () => {
  it("loads older entries from the last one shown", async () => {
    const first = Array.from({ length: 50 }, (_, index) => entry({ id: `n${index}`, at: 2000 - index }));
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        const entries = url.includes("before=") ? [entry({ id: "old", at: 10, note: "the oldest" })] : first;
        return { ok: true, status: 200, json: async () => ({ entries }) };
      }),
    );
    render(<Log />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(50));
    fireEvent.click(screen.getByRole("button", { name: "Load older" }));
    await waitFor(() => expect(screen.getByText("the oldest")).toBeTruthy());
    expect(calls[1]).toBe(`/api/admin/log?before=${2000 - 49}`);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run apps/web/src/admin/Log.test.tsx`
Expected: FAIL — `describeEntry` is not exported.

- [ ] **Step 3: Implement `Log.tsx`**

```tsx
import { useEffect, useState } from "react";
import { adminGet, fmt } from "./api.js";

/** `AdminLogEntry`, as the page receives it. Redeclared: this bundle cannot import the economy. */
export interface LogEntry {
  id: string;
  at: number;
  by: string;
  byName: string;
  kind: "add" | "remove" | "set" | "reset" | "float" | "empty-banks" | "delete-emote";
  amount: number;
  affected: number;
  target: "all" | string[];
  parts: string[] | null;
  subject: string | null;
  note: string;
}

const PAGE = 50;

function whom(entry: LogEntry): string {
  if (entry.target === "all") {
    return `everyone (${fmt(entry.affected)})`;
  }
  return entry.affected === 1 ? "1 player" : `${fmt(entry.affected)} players`;
}

function list(words: string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** One act, said the way somebody would say what they did. */
export function describeEntry(entry: LogEntry): string {
  const chips = `${fmt(entry.amount)} chips`;
  switch (entry.kind) {
    case "add":
      return `Gave ${chips} to ${whom(entry)}`;
    case "remove":
      return `Took ${chips} from ${whom(entry)}`;
    case "set":
      return entry.target === "all"
        ? `Set everyone's balance to ${chips} (${fmt(entry.affected)})`
        : `Set ${whom(entry)}'s balance to ${chips}`;
    case "reset":
      return `Reset ${list(entry.parts ?? [])} for ${whom(entry)}`;
    case "float":
      return `Floated ${chips} into the ${entry.subject ?? "unknown"} bank`;
    case "empty-banks":
      return `Emptied the banks of ${chips}`;
    case "delete-emote":
      return `Deleted the emote ${entry.subject ?? ""}`.trim();
  }
}

const when = (at: number) =>
  new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Log() {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    void adminGet<{ entries: LogEntry[] }>("/api/admin/log").then((body) => {
      const got = body?.entries ?? [];
      setEntries(got);
      setMore(got.length === PAGE);
    });
  }, []);

  const older = () => {
    const last = entries?.at(-1);
    if (last === undefined) {
      return;
    }
    void adminGet<{ entries: LogEntry[] }>(`/api/admin/log?before=${last.at}`).then((body) => {
      const got = body?.entries ?? [];
      setEntries((current) => [...(current ?? []), ...got]);
      setMore(got.length === PAGE);
    });
  };

  return (
    <section className="panel">
      <p className="panel__label">What has been done</p>
      {entries === null ? (
        <p className="panel__note">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="panel__note">Nothing yet.</p>
      ) : (
        <ul className="desk__log">
          {entries.map((entry) => (
            <li key={entry.id} className="desk__log-line">
              <span className="desk__log-what">{describeEntry(entry)}</span>
              <span className="desk__log-who">
                {entry.byName} · {when(entry.at)}
              </span>
              {entry.note === "" ? null : <span className="desk__log-note">{entry.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {more ? (
        <div className="desk__buttons">
          <button type="button" className="btn btn--ghost btn--small" onClick={older}>
            Load older
          </button>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Styles**

```css
.desk__log {
  list-style: none;
  margin: 0 0 var(--gr-space-3);
  padding: 0;
}

.desk__log-line {
  display: grid;
  gap: 2px;
  padding: var(--gr-space-2) 0;
  border-bottom: var(--gr-edge-soft);
}

.desk__log-line:last-child {
  border-bottom: none;
}

.desk__log-what {
  font-weight: 500;
}

.desk__log-who,
.desk__log-note {
  font-size: var(--gr-text-xs);
  color: var(--gr-color-ink-dim);
}

.desk__log-note {
  font-style: italic;
}
```

- [ ] **Step 5: Run, check, commit**

Run: `npx vitest run apps/web/src/admin` → PASS; `npm run typecheck && npm run lint` → clean.
Browser: do a grant and a float, open `/admin?tab=log`, confirm both lines; 375px check; screenshot.

```bash
npx biome format --write apps/web/src/admin
git add apps/web/src/admin
git commit -m "feat(admin): the log, in words

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: House rule, full verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Amend the money rule**

In `CLAUDE.md`, under "There is no real money here, ever", replace:

```
Players get chips daily and nowhere else, except from redemption codes an
admin mints.
```

with:

```
Players get chips daily and nowhere else, except from an admin: by a
redemption code they mint, or by a grant written into the admin log. Both are
the same power — chips nobody won — so both sit behind the same allowlist, and
neither is ever a thing a player can cause.
```

- [ ] **Step 2: Full suite**

Run: `npm test` → all pass
Run: `npm run typecheck` → clean
Run: `npm run lint` → clean (the pre-existing biome config migration notice is not a failure)

- [ ] **Step 3: Whole-desk pass in the browser**

With the dev server: every tab at desktop and at 375×812. For each, run `document.documentElement.scrollWidth` in `javascript_tool` and confirm it equals the viewport width. Turn on reduced motion emulation if available (or check computed `animation-name` is `none` under the media query). Screenshot each tab at 375px and send them with `SendUserFile`. Reset the viewport to `desktop`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: chips may come from an admin by code or by logged grant

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** store additions (T2, T3) · routes and 409 rule (T4) · live balances via `tellChipsTo` (T4) · emote deletion incl. `emotesSeen` and the replay (T4, T5) · float logging (T4) · 64KB bulk parser (T4) · tabs in URL (T6) · banks paragraph once (T6) · compact mint row (T6) · players list, action bar, dialogs, `RESET` gate, empty-banks only for everyone, 409 in words, phone cards (T7) · emote cards, arming delete (T8) · log in words, load older (T9) · CLAUDE.md (T10) · 375px and reduced motion (T6–T10).
- **Known approximation:** Mongo `moved` for remove/set can include a hand settling between its two reads; the balance itself is decided by one update. Documented in the code comment.
- **Type names used across tasks:** `AdminTarget`, `ResetPart`, `BalanceOp`, `AdminUserRow`, `AdminLogEntry`/`LogEntry`, `SeatedTable`, `tablesHolding`, `mountAdminDesk`, `tellChipsTo`, `ADMIN_BULK_PATHS`, `adminChipsSchema`, `adminResetSchema`, `adminGet`, `adminPost`, `fmt`, `chipsSentence`, `ChipsDialog`, `ResetDialog`, `describeEntry`, `TABS`, `TabId`, `BANKS`.
