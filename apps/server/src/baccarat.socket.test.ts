import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import type { TableView } from "@backroom/game-baccarat";
import type { ClientToServer, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * Baccarat, tested where the felt is actually told what the bank holds.
 *
 * The cloth, the shoe and the cap arithmetic are all proven in games/baccarat
 * and need no server. What is only reachable from here is whether this end
 * wires it up the right way round: that a chip at the table moves real chips
 * into baccarat's own bank rather than another game's, that the bank's refusal
 * reaches a client in words, that the table's own clock — armed by the server,
 * not by a test calling a method directly — really does let an empty window
 * pass without dealing, and that a bot is turned away from a table playing for
 * chips exactly as it is welcomed at one playing for nothing.
 */

type Client = Socket<ServerToClient, ClientToServer> & {
  latest?: TableView;
  seen: TableView[];
  read: number;
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

/** The bank the cloth pays from, funded before anybody opens a table. */
const BANK = 100_000;

function client(port: number): Promise<Client> {
  return new Promise((resolve) => {
    const socket: Client = connect(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    }) as Client;
    socket.seen = [];
    socket.read = 0;
    open.push(socket);
    socket.on("room:state", (state) => {
      socket.latest = state as unknown as TableView;
      socket.seen.push(socket.latest);
    });
    socket.on("connect", () => resolve(socket));
  });
}

/**
 * The next state that matches, counting from wherever the last wait stopped.
 *
 * Modelled on the same helper in roulette.socket.test.ts and
 * twoup.socket.test.ts — reading forward through the stream rather than
 * looking at whatever arrived last is what keeps a wait honest about a
 * broadcast that landed while the test was doing something else.
 */
function stateWhere(socket: Client, ok: (state: TableView) => boolean, ms = 2000) {
  for (let index = socket.read; index < socket.seen.length; index += 1) {
    const state = socket.seen[index] as TableView;
    if (ok(state)) {
      socket.read = index + 1;
      return Promise.resolve(state);
    }
  }
  socket.read = socket.seen.length;

  return new Promise<TableView>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no matching state: read ${socket.read} of ${socket.seen.length}`)),
      ms,
    );
    const listener = (raw: unknown) => {
      const state = raw as TableView;
      if (ok(state)) {
        clearTimeout(timer);
        socket.off("room:state", listener);
        socket.read = socket.seen.length;
        resolve(state);
      }
    };
    socket.on("room:state", listener);
  });
}

/** Sends a move and waits for the server to say it has dealt with it. */
function act(socket: Client, action: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) =>
    socket.emit("game:action", action as { type: string }, () => resolve()),
  );
}

/**
 * The next refusal this socket is told about.
 *
 * Armed before the action that causes it, because the answer can arrive
 * before the ack does.
 */
function refusal(socket: Client, ms = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("nothing was refused")), ms);
    socket.once("room:error", (message: string) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

/**
 * Opens a table, with a real bank behind it and a real account at it.
 *
 * A second account is minted too, in connection order, so a second window can
 * join as somebody real rather than as a ghost reclaiming the host's own seat.
 */
async function openTable(
  options: { bank?: number; forFun?: boolean; windowMs?: number } = {},
): Promise<{ store: MemoryStore; port: number; userId: string; host: Client }> {
  const store = new MemoryStore();
  const player = await store.upsertDiscordUser({
    discordId: "d1",
    name: "Ada",
    avatar: null,
    accentColor: null,
  });
  const companion = await store.upsertDiscordUser({
    discordId: "d2",
    name: "Bo",
    avatar: null,
    accentColor: null,
  });
  await store.bankAdd("baccarat", options.bank ?? BANK);

  const ids = [player.id, companion.id];
  let connections = 0;
  const identify = () => ids[connections++] ?? null;
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    botDelayMs: 5,
    // The server's own fallback window, not something a client can ask for —
    // `create` only reaches for it when a host's own request is absent or not
    // one of `WINDOWS`, which nothing below ever sends.
    ...(options.windowMs === undefined ? {} : { baccaratWindowMs: options.windowMs }),
    identify,
    identifyRequest: () => player.id,
  });
  await listenForFetch(server.http);
  const port = (server.http.address() as AddressInfo).port;

  const host = await client(port);
  await new Promise<void>((resolve) =>
    host.emit(
      "lobby:create",
      { name: "Ada", game: "baccarat", forFun: options.forFun ?? false },
      () => resolve(),
    ),
  );
  return { store, port, userId: player.id, host };
}

describe("a fresh baccarat table", () => {
  it("lets a host open it and a second player join", async () => {
    const { port, host } = await openTable();
    const opened = await stateWhere(host, (state) => state.seats.length === 1);

    const second = await client(port);
    await new Promise<void>((resolve) =>
      second.emit("lobby:join", { name: "Bo", code: opened.code }, () => resolve()),
    );
    const joined = await stateWhere(second, (state) => state.seats.length === 2);

    expect(joined.seats.map((seat) => seat.name)).toEqual(["Ada", "Bo"]);
  });
});

describe("a chip placed on the cloth", () => {
  it("leaves the account and appears in the view", async () => {
    const { store, userId, host } = await openTable();
    await stateWhere(host, (state) => state.seats.length === 1);
    const chipsBefore = (await store.get(userId))?.chips ?? 0;

    await act(host, { type: "place", spotId: "player", chips: 500 });
    const placed = await stateWhere(host, (state) => (state.seats[0]?.staked ?? 0) === 500);

    expect((await store.get(userId))?.chips).toBe(chipsBefore - 500);
    expect(await store.bank("baccarat")).toBe(BANK + 500);
    expect(placed.placed).toContainEqual({
      seatId: placed.seats[0]?.id,
      spotId: "player",
      chips: 500,
    });
  });

  it("is refused in words when the bank cannot cover it", async () => {
    const { host } = await openTable({ bank: 0 });
    await stateWhere(host, (state) => state.seats.length === 1);

    const refused = refusal(host);
    await act(host, { type: "place", spotId: "player", chips: 500 });

    expect(await refused).toMatch(/bank cannot cover/i);
    // Refused, so nothing reached the cloth.
    expect(host.latest?.seats[0]?.staked).toBe(0);
  });
});

describe("the window's own clock", () => {
  it("shuts an empty cloth without dealing, and opens a fresh window", async () => {
    /*
     * The real `WINDOWS` never run shorter than fifteen seconds, which a host
     * picks from and `create` validates a client's request against — neither
     * of which this test is exercising. `baccaratWindowMs` is the server's
     * own fallback for exactly this: a seam to hurry the table's real clock,
     * never a value a client can ask for.
     */
    const { host } = await openTable({ windowMs: 200 });
    const opened = await stateWhere(host, (state) => state.seats.length === 1);
    expect(opened.phase).toBe("betting");
    expect(opened.coup).toBeNull();

    // Nothing is ever staked here, so the next betting window this table
    // opens is the window's own clock speaking, not a coup being dealt.
    const reopened = await stateWhere(
      host,
      (state) => state.phase === "betting" && (state.deadline ?? 0) > (opened.deadline ?? 0),
    );

    expect(reopened.coup).toBeNull();
    expect(reopened.history).toHaveLength(0);
    expect(reopened.placed).toHaveLength(0);
  });
});

describe("chips are only won from real people", () => {
  it("refuses a bot at a table playing for chips", async () => {
    const { host } = await openTable();
    await stateWhere(host, (state) => state.seats.length === 1);

    const refused = refusal(host);
    host.emit("lobby:addBot", { skill: "hard" });

    expect(await refused).toMatch(/playing for fun/i);
    expect(host.latest?.seats).toHaveLength(1);
  });

  it("seats a bot at a table playing for nothing", async () => {
    const { host } = await openTable({ forFun: true });
    await stateWhere(host, (state) => state.seats.length === 1);

    host.emit("lobby:addBot", { skill: "hard" });
    const withBot = await stateWhere(host, (state) => state.seats.length === 2);

    expect(withBot.seats[1]?.isBot).toBe(true);
  });
});
