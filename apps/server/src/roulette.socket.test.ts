import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import type { ClientToServer, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * The wheel, tested where the felt is actually told what the bank holds.
 *
 * The cap arithmetic is proven in games/roulette and needs no server. What is
 * only reachable from here is whether the figure ever reaches a client — the
 * bank is a question for the store, so a view built synchronously cannot ask
 * it, and the answer has to be waiting by the time the first one is built.
 */

type Client = Socket<ServerToClient, ClientToServer> & {
  seen: { bank: number; code: string; seats: unknown[] }[];
};

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

/** The bank the wheel pays from, funded before anybody opens a table. */
const BANK = 100_000;

async function openTable(): Promise<Client> {
  const store = new MemoryStore();
  const player = await store.upsertDiscordUser({
    discordId: "d1",
    name: "Ada",
    avatar: null,
    accentColor: null,
  });
  await store.bankAdd("roulette", BANK);

  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify: () => player.id,
    identifyRequest: () => player.id,
  });
  await listenForFetch(server.http);
  const port = (server.http.address() as AddressInfo).port;

  const socket = connect(`http://localhost:${port}`, {
    transports: ["websocket"],
    forceNew: true,
  }) as Client;
  socket.seen = [];
  socket.on("room:state", (state) => {
    socket.seen.push(state as unknown as Client["seen"][number]);
  });
  open.push(socket);
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));

  await new Promise<void>((resolve) =>
    socket.emit("lobby:create", { name: "Ada", game: "roulette", forFun: false }, () => resolve()),
  );
  return socket;
}

describe("a fresh roulette table", () => {
  it("tells the felt what the bank holds in its very first state", async () => {
    const socket = await openTable();
    const first = socket.seen.find((state) => state.seats.length === 1);
    expect(first).toBeDefined();
    expect(first?.bank).toBe(BANK);
  });
});
