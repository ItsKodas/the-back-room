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
  for (const socket of open.splice(0)) {
    socket.close();
  }
  if (server !== null) {
    await server.close();
    server = null;
  }
});

async function start(timings: { reconnectGraceMs: number; emptyRoomTtlMs: number }) {
  const store = new MemoryStore();
  const ada = await store.upsertDiscordUser({
    discordId: "d1",
    name: "Ada",
    avatar: null,
    accentColor: null,
  });
  const bo = await store.upsertDiscordUser({
    discordId: "d2",
    name: "Bo",
    avatar: null,
    accentColor: null,
  });
  await store.bankAdd("roulette", BANK);
  await store.bankAdd("blackjack", BANK);

  const ids = [ada.id, bo.id];
  let seen = 0;
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    // Connection order, as the other socket tests do it: Ada first, then Bo.
    identify: () => {
      const id = ids[seen] ?? null;
      seen += 1;
      return id;
    },
    identifyRequest: () => ada.id,
    ...timings,
  });
  await new Promise<void>((resolve) => server?.http.listen(0, () => resolve()));
  const port = (server.http.address() as AddressInfo).port;

  const client = async (): Promise<Client> => {
    const socket = connect(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    }) as Client;
    open.push(socket);
    await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
    return socket;
  };
  return { store, ada, bo, client };
}

const until = async (check: () => Promise<boolean> | boolean, ms = 3_000) => {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error("timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const openTable = (socket: Client, game: string) =>
  new Promise<string>((resolve) =>
    socket.emit("lobby:create", { name: "Ada", game, forFun: false }, (ack) =>
      resolve(ack.ok ? ack.code : ""),
    ),
  );

const act = (socket: Client, action: Record<string, unknown>) =>
  new Promise<void>((resolve) => socket.emit("game:action", action, () => resolve()));

describe("a table nobody is sitting at any more", () => {
  it("gives the chips on its cloth back before it is cleared away, and says so", async () => {
    const { store, ada, client } = await start({ reconnectGraceMs: 60_000, emptyRoomTtlMs: 150 });
    const before = (await store.get(ada.id))?.chips ?? 0;
    const player = await client();
    const code = await openTable(player, "roulette");
    await act(player, { type: "place", spotId: RED, chips: 200 });
    await until(async () => (await store.get(ada.id))?.chips === before - 200);

    const watcher = await client();
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
    const player = await client();
    const code = await openTable(player, "roulette");
    const watcher = await client();
    await new Promise<void>((resolve) => watcher.emit("lobby:watch", { code }, () => resolve()));
    const closed = new Promise<void>((resolve) => watcher.on("room:closed", () => resolve()));
    player.close();
    await closed;

    let after = 0;
    watcher.on("room:state", () => {
      after += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(after).toBe(0);
  });
});

describe("the server stopping", () => {
  it("hands back a blackjack bet still on the felt", async () => {
    const { store, ada, client } = await start({ reconnectGraceMs: 60_000, emptyRoomTtlMs: 60_000 });
    const before = (await store.get(ada.id))?.chips ?? 0;
    const player = await client();
    await openTable(player, "blackjack");
    await act(player, { type: "bet", amount: 100 });
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
    const player = await client();
    await openTable(player, "blackjack");
    await act(player, { type: "bet", amount: 100 });
    await until(async () => (await store.get(ada.id))?.chips === before - 100);

    const stopping = server;
    server = null;
    await stopping?.close();

    // MemoryStore's close releases nothing, so it can still be read afterwards.
    expect((await store.get(ada.id))?.chips).toBe(before);
  });
});
