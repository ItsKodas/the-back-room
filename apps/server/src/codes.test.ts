import type { AddressInfo } from "node:net";
import { MemoryStore, STARTING_CHIPS } from "@backroom/economy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackRoomServer } from "./server.js";
import type { BackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

let server: BackRoomServer | null = null;

/*
 * Who is on the admin list is process-wide state, and a test that reads it
 * without setting it is a test that depends on whatever ran before it —
 * including, if the runner ever shares a process between files, something in
 * another file entirely. Cleared going in as well as coming out, so every test
 * here starts from the same place whatever happened first.
 */
beforeEach(() => {
  delete process.env["ADMIN_DISCORD_IDS"];
});

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
  delete process.env["ADMIN_DISCORD_IDS"];
});

/** A server where the signed-in player is whoever we say. */
async function start(store: MemoryStore, as: string | null) {
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify: () => as,
    // The mirror of identify for the HTTP routes, so a test can say who is
    // asking without standing up a real sign-in.
    identifyRequest: () => as,
  });
  await listenForFetch(server.http);
  return `http://localhost:${(server.http.address() as AddressInfo).port}`;
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function player(store: MemoryStore, discordId: string) {
  return store.upsertDiscordUser({ discordId, name: "Ada", avatar: null, accentColor: null });
}

describe("redeeming a code over http", () => {
  it("turns a code into chips, once", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1");
    const minted = await store.mintCode({
      chips: 2500,
      maxRedemptions: null,
      expiresAt: null,
      note: "launch",
      createdBy: "admin",
    });
    const base = await start(store, ada.id);

    const first = await post(`${base}/api/redeem`, { code: minted.code });
    expect(first.body).toMatchObject({ ok: true, chips: 2500 });
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS + 2500);

    const second = await post(`${base}/api/redeem`, { code: minted.code });
    expect(second.body).toMatchObject({ ok: false, reason: "already-redeemed" });
  });

  it("accepts a code typed in any case, with or without its dashes", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1");
    const minted = await store.mintCode({
      chips: 100,
      maxRedemptions: null,
      expiresAt: null,
      note: "",
      createdBy: "admin",
    });
    const base = await start(store, ada.id);

    const typed = minted.code.toLowerCase().replace(/-/g, " ");
    expect((await post(`${base}/api/redeem`, { code: typed })).body).toMatchObject({ ok: true });
  });

  it("turns a guest away without telling them anything about the code", async () => {
    const store = new MemoryStore();
    const base = await start(store, null);
    const attempt = await post(`${base}/api/redeem`, { code: "ANY-CODE-AT" });
    expect(attempt.status).toBe(401);
  });

  it("stops somebody working through the alphabet", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1");
    const base = await start(store, ada.id);

    const tried: number[] = [];
    for (let attempt = 0; attempt < 14; attempt += 1) {
      tried.push((await post(`${base}/api/redeem`, { code: `WRONG-${attempt}` })).status);
    }
    // Ten allowed, then the door shuts on the account rather than the socket.
    expect(tried.filter((status) => status === 429).length).toBeGreaterThan(0);
  });
});

describe("whether /api/me says you are an admin", () => {
  async function me(base: string) {
    return (await (await fetch(`${base}/api/me`)).json()) as { admin?: unknown };
  }

  it("says so to somebody on the list", async () => {
    const store = new MemoryStore();
    const boss = await player(store, "d-admin");
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    expect((await me(await start(store, boss.id))).admin).toBe(true);
  });

  it("says no to somebody who is not, and to a guest", async () => {
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    const store = new MemoryStore();
    const ada = await player(store, "d1");
    expect((await me(await start(store, ada.id))).admin).toBe(false);
    await server?.close();
    server = null;
    expect((await me(await start(store, null))).admin).toBe(false);
  });
});

describe("minting codes", () => {
  it("is invisible to somebody not on the list", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1");
    const base = await start(store, ada.id);

    // 404 rather than 403: whether the page exists is not theirs to learn.
    const listed = await fetch(`${base}/api/admin/codes`);
    expect(listed.status).toBe(404);
    expect((await post(`${base}/api/admin/codes`, { chips: 500 })).status).toBe(404);
  });

  it("is invisible to everybody when the list is empty", async () => {
    process.env["ADMIN_DISCORD_IDS"] = "";
    const store = new MemoryStore();
    const ada = await player(store, "d1");
    const base = await start(store, ada.id);
    expect((await fetch(`${base}/api/admin/codes`)).status).toBe(404);
  });

  it("lets somebody on the list mint, list and revoke", async () => {
    const store = new MemoryStore();
    const boss = await player(store, "d-admin");
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    const base = await start(store, boss.id);

    const minted = await post(`${base}/api/admin/codes`, {
      chips: 5000,
      maxRedemptions: 1,
      note: "sorry about the downtime",
    });
    const code = (minted.body["code"] as { code: string }).code;
    expect(code).toMatch(/^[A-Z0-9-]+$/);

    const listed = (await (await fetch(`${base}/api/admin/codes`)).json()) as {
      codes: Array<{ note: string }>;
    };
    expect(listed.codes[0]?.note).toBe("sorry about the downtime");

    expect((await post(`${base}/api/admin/codes/${code}/revoke`, {})).body).toEqual({
      revoked: true,
    });
    expect(await store.redeem(code, boss.id)).toEqual({ ok: false, reason: "revoked" });
  });

  it("refuses a mint that is not worth minting", async () => {
    const store = new MemoryStore();
    const boss = await player(store, "d-admin");
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    const base = await start(store, boss.id);

    expect((await post(`${base}/api/admin/codes`, { chips: 0 })).status).toBe(400);
    expect((await post(`${base}/api/admin/codes`, { chips: 10_000_000 })).status).toBe(400);
    expect((await post(`${base}/api/admin/codes`, {})).status).toBe(400);
  });
});
