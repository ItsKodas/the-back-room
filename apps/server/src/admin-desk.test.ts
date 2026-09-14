import type { AddressInfo } from "node:net";
import type { AdminTarget, BankName } from "@backroom/economy";
import { BANKS, MemoryStore, STARTING_CHIPS } from "@backroom/economy";
import type { ClientToServer, ServerToClient } from "@backroom/shared";
import express from "express";
import type { Server } from "node:http";
import type { Socket } from "socket.io-client";
import { io as connectSocket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeatedTable } from "./admin-desk.js";
import { mountAdminDesk, tablesHolding } from "./admin-desk.js";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";

/**
 * A store that can hold a slot pull open mid-round, so a test can prove a
 * concurrent admin reset queues behind it rather than landing inside it.
 *
 * Gates `bank("slots")` specifically, and only its first call after `hold()`
 * arms it: the spin handler reads the cap with it at the very start of its
 * round and reads it again for the ack it sends back at the very end, and
 * only the first of those is the moment worth holding open — gating the
 * second would just hang every spin forever.
 */
class GatedStore extends MemoryStore {
  readonly log: string[] = [];
  private armed = false;
  private release: (() => void) | null = null;
  private gate: Promise<void> | null = null;
  private waitingResolve: (() => void) | null = null;
  /** Resolves once a spin has actually reached the gate and is paused there. */
  readonly waiting: Promise<void> = new Promise((resolve) => {
    this.waitingResolve = resolve;
  });

  hold(): void {
    this.armed = true;
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  open(): void {
    this.release?.();
  }

  override async bank(which: BankName): Promise<number> {
    if (which === "slots" && this.armed) {
      this.armed = false;
      this.log.push("spin:holding");
      this.waitingResolve?.();
      await this.gate;
      this.log.push("spin:resumed");
    }
    return super.bank(which);
  }

  override async bankEmpty(which: BankName): Promise<number> {
    if (which === "slots") {
      this.log.push("empty:slots");
    }
    return super.bankEmpty(which);
  }
}

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
    // A stand-in for the real server's guarded version, which queues through
    // each game's own `BankLedger` — this module never sees that guard, and
    // the route test above is only proving the response and the log, not
    // the ordering. The ordering is proved through the real server, below.
    emptyBanks: async () => {
      let total = 0;
      for (const bank of BANKS) {
        total += await store.bankEmpty(bank);
      }
      return total;
    },
    forgetEmote: (id) => forgotten.push(id),
  });
  // Captured from `listen`'s own return, not read back off the module-level
  // `http` — that one exists for `afterEach` to close, and is only ever
  // `null` before this line runs and after the suite is done with it.
  const listening: Server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  http = listening;
  const base = `http://localhost:${(listening.address() as AddressInfo).port}`;
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
    const back = (await (await fetch(`${base}/api/admin/log?before=${recent.at}&beforeId=${recent.id}`)).json()) as {
      entries: Array<{ id: string }>;
    };
    expect(back.entries.map((one) => one.id)).toEqual([old.id]);
  });

  it("pages on the time and the id together, so a shared millisecond skips nobody", async () => {
    const { store, base } = await desk();
    const base_ = { by: "u", byName: "K", amount: 1, affected: 1, target: "all" as const, parts: null, subject: null, note: "" };
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      await store.logAdmin({ ...base_, kind: "reset" });
      await store.logAdmin({ ...base_, kind: "empty-banks" });
    } finally {
      clock.mockRestore();
    }
    const read = async (query: string) =>
      ((await (await fetch(`${base}/api/admin/log${query}`)).json()) as { entries: Array<{ id: string }> }).entries.map(
        (one) => one.id,
      );

    const all = await read("");
    expect(all).toHaveLength(2);
    const [top, below] = all;
    expect(await read(`?before=${now}&beforeId=${top}`)).toEqual([below]);
    // One without the other is not a cursor, so it reads as the first page.
    expect(await read(`?before=${now}`)).toEqual(all);
    expect(await read(`?beforeId=${top}`)).toEqual(all);
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

  /*
   * The reset route's `emptyBanks` used to walk `store.bankEmpty` directly,
   * which does not queue against the same `BankLedger` a slot pull's stake
   * and payout run inside. That let an admin's empty land between a pull's
   * cap read and its payout — a paid winning spin whose payout then found
   * the bank it had just been promised empty, and refused. Routing through
   * the real, server-provided `emptyBanks` (rather than the bare-app test
   * double the other tests above use) is the whole point here: it is the
   * dependency the fix actually lives behind.
   */
  it("queues an empty-banks reset behind an in-flight slot pull instead of landing inside it", async () => {
    const store = new GatedStore();
    const admin = await player(store, "d-admin", "Koda");
    const gambler = await player(store, "d1", "Ada");
    await store.bankAdd("slots", 1_000_000);
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";

    server = createBackRoomServer({
      store,
      auth: null,
      serveClient: false,
      identify: () => gambler.id,
      identifyRequest: () => admin.id,
    });
    await new Promise<void>((resolve) => server?.http.listen(0, () => resolve()));
    const base = `http://localhost:${(server.http.address() as AddressInfo).port}`;

    const client: Socket<ServerToClient, ClientToServer> = connectSocket(base, {
      transports: ["websocket"],
      forceNew: true,
    });
    await new Promise<void>((resolve) => client.on("connect", () => resolve()));

    store.hold();
    const spinAck = new Promise<{ ok: boolean }>((resolve) => {
      client.emit("slots:spin", { stake: 100 }, resolve as (result: unknown) => void);
    });
    // Waits for the real hold point, not a timer: the spin has reached the
    // ledger's queue and is paused inside it, exactly where a reset would
    // otherwise be free to land.
    await store.waiting;

    const resetPromise = post(`${base}/api/admin/reset`, {
      target: { all: true },
      parts: ["balance"],
      emptyBanks: true,
    });
    // However long this waits, the empty cannot have run yet: it is queued
    // behind the still-open spin in the same `BankLedger`, not racing it, so
    // this holds regardless of how generous the wait is.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.log).not.toContain("empty:slots");

    store.open();
    const [spinResult, resetResult] = await Promise.all([spinAck, resetPromise]);

    expect(spinResult.ok).toBe(true);
    expect(resetResult.status).toBe(200);
    expect(store.log).toEqual(["spin:holding", "spin:resumed", "empty:slots"]);

    client.close();
  });
});
