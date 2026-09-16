import { MemoryStore, STARTING_CHIPS } from "@backroom/economy";
import type { ClientToServer, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackRoomServer } from "./server.js";
import type { BackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * What the building does when its store will not answer.
 *
 * One process holds every table in the room, so a request that fails has to
 * fail on its own: it gets an answer, and the next request — and every hand in
 * progress — carries on. Each test here breaks one store method and then asks
 * something else of the same server to prove it is still standing.
 */

let server: BackRoomServer | null = null;
const open: Socket[] = [];

beforeEach(() => {
  delete process.env["ADMIN_DISCORD_IDS"];
  // The failures below are logged on purpose; the log is not what is tested.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  for (const socket of open.splice(0)) {
    socket.close();
  }
  if (server !== null) {
    await server.close();
    server = null;
  }
  delete process.env["ADMIN_DISCORD_IDS"];
  vi.restoreAllMocks();
});

const broken = () => Promise.reject(new Error("the store is down"));

async function start(store: MemoryStore, http: string | null, sockets: string | null = null) {
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify: () => sockets,
    identifyRequest: () => http,
  });
  return listenForFetch(server.http);
}

/*
 * Bounded, because the failure this file exists for is a request that never
 * answers — and a test that waits on one forever reports a timeout somewhere
 * else instead of the status it was waiting for.
 */
async function call(url: string, body?: unknown) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(2000),
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function stillServing(port: number) {
  expect((await call(`http://localhost:${port}/healthz`)).status).toBe(200);
}

async function player(store: MemoryStore, discordId: string, name = "Ada") {
  return store.upsertDiscordUser({ discordId, name, avatar: null, accentColor: null });
}

function client(port: number): Promise<Socket<ServerToClient, ClientToServer>> {
  return new Promise((resolve) => {
    const socket: Socket<ServerToClient, ClientToServer> = connect(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    });
    open.push(socket);
    socket.on("connect", () => resolve(socket));
  });
}

describe("a route whose store call fails", () => {
  it("answers 500 and keeps serving", async () => {
    const store = new MemoryStore();
    store.bank = broken;
    const port = await start(store, null);

    const answer = await call(`http://localhost:${port}/api/slots`);
    expect(answer.status).toBe(500);
    expect(answer.body["error"]).toEqual(expect.any(String));
    await stillServing(port);
  });

  it("answers 500 from the admin check rather than letting a request through or hanging", async () => {
    const store = new MemoryStore();
    const boss = await player(store, "d-admin");
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    store.get = broken;
    const port = await start(store, boss.id);

    expect((await call(`http://localhost:${port}/api/admin/codes`)).status).toBe(500);
    await stillServing(port);
  });

  it("answers 500 from a route mounted by another module", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1");
    store.findPlayers = broken;
    const port = await start(store, ada.id);

    expect((await call(`http://localhost:${port}/api/players?q=bo`)).status).toBe(500);
    await stillServing(port);
  });
});

describe("an admin change that lands but is not logged", () => {
  it("says the chips moved, so nobody gives them twice", async () => {
    const store = new MemoryStore();
    const boss = await player(store, "d-admin");
    const ada = await player(store, "d1");
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    store.logAdmin = broken;
    const port = await start(store, boss.id);

    const answer = await call(`http://localhost:${port}/api/admin/chips`, {
      op: "add",
      amount: 500,
      target: { ids: [ada.id] },
    });
    expect(answer.status).toBe(500);
    expect(answer.body["error"]).toMatch(/do not repeat/i);
    expect(answer.body["applied"]).toMatchObject({ affected: 1 });
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS + 500);
    await stillServing(port);
  });

  it("says the float went in", async () => {
    const store = new MemoryStore();
    const boss = await player(store, "d-admin");
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    store.logAdmin = broken;
    const port = await start(store, boss.id);

    const answer = await call(`http://localhost:${port}/api/admin/bank`, { amount: 1000 });
    expect(answer.status).toBe(500);
    expect(answer.body["error"]).toMatch(/do not repeat/i);
    expect(answer.body["applied"]).toMatchObject({ bank: 1000 });
    expect(await store.bank("slots")).toBe(1000);
  });
});

describe("a transfer whose live balance push fails", () => {
  it("still answers that it was sent, so it is not sent again", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1");
    const bob = await player(store, "d2", "Bob");
    // Bob has the site open, so paying him means reading his balance to push.
    const port = await start(store, ada.id, bob.id);
    await client(port);
    const get = store.get.bind(store);
    store.get = (id) => (id === bob.id ? broken() : get(id));

    const answer = await call(`http://localhost:${port}/api/send`, { toId: bob.id, amount: 100 });
    expect(answer.status).toBe(200);
    expect(answer.body["ok"]).toBe(true);
    await stillServing(port);
  });
});

describe("a socket event whose store call fails", () => {
  it("still acks the jar", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1");
    store.jar = broken;
    const port = await start(store, null, ada.id);
    const socket = await client(port);

    const jar = await socket.timeout(2000).emitWithAck("tips:open", {});
    expect(jar).toEqual(expect.any(Object));
    await stillServing(port);
  });

  it("acks a refused spin, and does not wedge the machine for the next one", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1");
    store.bank = broken;
    const port = await start(store, null, ada.id);
    const socket = await client(port);

    for (let spin = 0; spin < 2; spin += 1) {
      const result = await socket.timeout(2000).emitWithAck("slots:spin", { stake: 1 });
      expect(result).toMatchObject({ ok: false, error: "Something went wrong." });
    }
    await stillServing(port);
  });
});
