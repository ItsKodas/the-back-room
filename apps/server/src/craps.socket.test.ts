import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import type { Table, TableView } from "@backroom/game-craps";
import type { ClientToServer, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * Craps, tested where the felt is actually told what the bank holds and where
 * the table's own clock is the real one.
 *
 * The rulebook and the bank arithmetic are proven in games/craps and need no
 * server. What is only reachable from here is whether this end wires it up
 * the right way round: that a table can actually be opened and played over a
 * socket, that a stake moves into craps' own bank rather than anybody else's,
 * and that a table nobody presses anything at still deals itself — the whole
 * of CLAUDE.md's "a table that deals itself".
 */

type Client = Socket<ServerToClient, ClientToServer> & {
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

/** The bank the table pays from, funded before anybody opens a table. */
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
      socket.seen.push(state as unknown as TableView);
    });
    socket.on("connect", () => resolve(socket));
  });
}

/**
 * The next state that matches, counting from wherever the last wait stopped.
 *
 * Reading forward through the stream rather than looking at whatever the
 * latest state happens to be, the same as blackjack.socket.test.ts and
 * twoup.socket.test.ts — a table that deals itself passes through states
 * faster than a test can ask about them.
 */
function stateWhere(socket: Client, ok: (state: TableView) => boolean, ms = 3000) {
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
 * Refusals do not come back on the ack — that only says the server has dealt
 * with the message, refused or not — so a test that wants the reason has to
 * listen for it. Armed before the action that causes it, because the answer
 * can arrive before the ack does.
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
 * `timings` threads through to `crapsWindow` / `crapsRollMs` / `crapsSettleMs`
 * on the server itself, the same hook `bettingMs` and friends give blackjack —
 * so a test that wants the table's own clock to actually run does not have to
 * sit through a real fifteen-second window to watch it.
 */
async function openTable(
  options: { bank?: number; timings?: { window?: number; rollMs?: number; settleMs?: number } } = {},
): Promise<{ store: MemoryStore; port: number; userId: string; host: Client; code: string }> {
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
  await store.bankAdd("craps", options.bank ?? BANK);

  const ids = [player.id, companion.id];
  let connections = 0;
  const timings = options.timings ?? {};
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify: () => ids[connections++] ?? null,
    identifyRequest: () => player.id,
    ...(timings.window === undefined ? {} : { crapsWindow: timings.window }),
    ...(timings.rollMs === undefined ? {} : { crapsRollMs: timings.rollMs }),
    ...(timings.settleMs === undefined ? {} : { crapsSettleMs: timings.settleMs }),
  });
  await listenForFetch(server.http);
  const port = (server.http.address() as AddressInfo).port;

  const host = await client(port);
  const code = await new Promise<string>((resolve) =>
    host.emit("lobby:create", { name: "Ada", game: "craps", forFun: false }, (ack: { ok: boolean; code?: string }) =>
      resolve(ack.code ?? ""),
    ),
  );
  return { store, port, userId: player.id, host, code };
}

describe("a craps table over a socket", () => {
  it("opens, seats somebody, and deals itself", async () => {
    const { host } = await openTable();
    const first = await stateWhere(host, (state) => state.seats.length === 1);
    expect(first.phase).toBe("betting");
    expect(first.shooterId).toBe(first.seats[0]?.id);

    // The whole cloth addressable: a chip on one spot of every kind lands.
    await act(host, { type: "place", spotId: "pass", chips: 300 });
    await act(host, { type: "place", spotId: "field", chips: 300 });
    await act(host, { type: "place", spotId: "place:6", chips: 600 });
    await act(host, { type: "place", spotId: "hard:8", chips: 60 });
    await act(host, { type: "place", spotId: "any7", chips: 300 });

    const laid = await stateWhere(host, (state) => state.placed.length === 5);
    expect(laid.placed.map((one) => one.spotId).sort()).toEqual(
      ["any7", "field", "hard:8", "pass", "place:6"].sort(),
    );
  });

  it("takes a chip on the pass line and shows it to everybody at the table", async () => {
    const { port, host, code } = await openTable();
    await stateWhere(host, (state) => state.seats.length === 1);

    const second = await client(port);
    await new Promise<void>((resolve) => second.emit("lobby:join", { name: "Bo", code }, () => resolve()));
    await stateWhere(second, (state) => state.seats.length === 2);

    await act(host, { type: "place", spotId: "pass", chips: 300 });

    const seen = await stateWhere(
      second,
      (state) => (state.seats.find((seat) => seat.name === "Ada")?.staked ?? 0) === 300,
    );
    expect(seen.placed.find((one) => one.spotId === "pass")?.chips).toBe(300);
  });

  it("refuses a bet naming a spot that does not exist", async () => {
    const { host, code } = await openTable();
    await stateWhere(host, (state) => state.seats.length === 1);

    const refused = refusal(host);
    await act(host, { type: "place", spotId: "hard:7", chips: 300 });
    expect(await refused).toMatch(/no such bet/i);

    // Never reached the cloth, not even for a moment.
    const table = server?.rooms.get(code)?.table as unknown as Table | undefined;
    expect(table?.placed).toEqual([]);
  });

  it("rolls on its own clock when the shooter does nothing", async () => {
    // Nobody ever presses "roll" — the table's own clock has to seal the
    // felt, release the dice and land them entirely on its own, which is the
    // whole of CLAUDE.md's table that deals itself: a ready button one idle
    // player can hold shut is not this. Cut to a handful of milliseconds so
    // the test proves the clock runs on its own without sitting through a
    // real fifteen-second window to watch it.
    const { host } = await openTable({ timings: { window: 60, rollMs: 40, settleMs: 40 } });
    await stateWhere(host, (state) => state.seats.length === 1);
    await act(host, { type: "place", spotId: "pass", chips: 300 });
    await stateWhere(host, (state) => state.placed.length === 1);

    const settling = await stateWhere(host, (state) => state.phase === "settling");
    expect(settling.dice).not.toBeNull();
  });

  it("pays a winner out of the craps bank and nowhere else", async () => {
    /*
     * Dice fixed at 3 and 4, which never changes: a natural seven on every
     * come-out, so a pass line bet always wins straight away and the test
     * never has to wait out a whole point cycle.
     */
    const faces = [2, 3];
    let at = 0;
    const spinRandom = () => {
      const face = faces[at % faces.length] as number;
      at += 1;
      // floor(value * 6) === face picks out die face `face + 1`.
      return (face + 0.5) / 6;
    };

    const store = new MemoryStore();
    const player = await store.upsertDiscordUser({
      discordId: "d1",
      name: "Ada",
      avatar: null,
      accentColor: null,
    });
    await store.bankAdd("craps", 100_000);
    await store.bankAdd("roulette", 50_000);

    // Cut to a handful of milliseconds, the same as "rolls on its own clock":
    // this test is about which bank moves, not about sitting through a real
    // window to watch it happen.
    server = createBackRoomServer({
      store,
      auth: null,
      serveClient: false,
      identify: () => player.id,
      identifyRequest: () => player.id,
      spinRandom,
      crapsWindow: 60,
      crapsRollMs: 40,
      crapsSettleMs: 40,
    });
    await listenForFetch(server.http);
    const port = (server.http.address() as AddressInfo).port;
    const socket = await client(port);
    await new Promise<void>((resolve) =>
      socket.emit("lobby:create", { name: "Ada", game: "craps", forFun: false }, () => resolve()),
    );
    await stateWhere(socket, (state) => state.seats.length === 1);

    const chipsBefore = (await store.get(player.id))?.chips ?? 0;
    await act(socket, { type: "place", spotId: "pass", chips: 300 });
    await stateWhere(socket, (state) => state.placed.length === 1);

    // Paid straight back: stake and an equal win, six hundred for three hundred.
    await stateWhere(
      socket,
      (state) => (state.paid.find((one) => one.seatId === state.seats[0]?.id)?.back ?? 0) > 0,
    );

    expect((await store.get(player.id))?.chips).toBe(chipsBefore + 300);
    expect(await store.bank("craps")).toBe(100_000 - 300);
    expect(await store.bank("roulette")).toBe(50_000);
  });
});
