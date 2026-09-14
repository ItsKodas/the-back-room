import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import type { TableView } from "@backroom/game-two-up";
import { STAKE_DIVISOR } from "@backroom/game-two-up";
import type { ClientToServer, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";

/**
 * Two-up, tested where the felt is actually told what the bank holds.
 *
 * The coin and the bank arithmetic are proven in games/two-up and need no
 * server. What is only reachable from here is whether this end wires it up
 * the right way round: that asking for the traditional school actually gets a
 * ring rather than the casino default, that a stake at the casino table moves
 * chips into two-up's own bank rather than the machine's or the felt's, and
 * that the bank refuses what it genuinely cannot cover.
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
  delete process.env["ADMIN_DISCORD_IDS"];
});

/** The bank the coins pay from, funded before anybody opens a table. */
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
 * latest state happens to be — modelled on the same helper in
 * blackjack.socket.test.ts — is what makes a wait immune to a broadcast that
 * already arrived while the test was doing something else between awaits.
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
 * A second account is minted too, in connection order, so a second window can
 * join as somebody real rather than as a ghost reclaiming the host's own
 * seat — `lobby:join` treats a second socket carrying the same identity as a
 * reconnect, not a new seat.
 */
async function openTable(
  options: { bank?: number; ruleset?: string } = {},
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
  await store.bankAdd("two-up", options.bank ?? BANK);

  const ids = [player.id, companion.id];
  let connections = 0;
  const identify = () => ids[connections++] ?? null;
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify,
    identifyRequest: () => player.id,
  });
  await new Promise<void>((resolve) => server?.http.listen(0, () => resolve()));
  const port = (server.http.address() as AddressInfo).port;

  const host = await client(port);
  await new Promise<void>((resolve) =>
    host.emit(
      "lobby:create",
      {
        name: "Ada",
        game: "two-up",
        forFun: false,
        ...(options.ruleset === undefined ? {} : { ruleset: options.ruleset }),
      },
      () => resolve(),
    ),
  );
  return { store, port, userId: player.id, host };
}

describe("a fresh two-up table", () => {
  it("gives a casino table when nobody names a ruleset", async () => {
    const { host } = await openTable();
    const first = await stateWhere(host, (state) => state.seats.length === 1);
    expect(first.school).toBe("casino");
  });

  it("gives a ring when the host asks for the traditional school", async () => {
    const { host } = await openTable({ ruleset: "school" });
    const first = await stateWhere(host, (state) => state.seats.length === 1);
    expect(first.school).toBe("school");
  });
});

describe("a chip placed at the casino table", () => {
  it("moves off the account and into the two-up bank", async () => {
    const { store, userId, host } = await openTable();
    await stateWhere(host, (state) => state.seats.length === 1);
    const bankBefore = await store.bank("two-up");
    const chipsBefore = (await store.get(userId))?.chips ?? 0;

    await act(host, { type: "place", on: "heads", chips: 500 });
    await stateWhere(host, (state) => (state.seats[0]?.staked ?? 0) === 500);

    expect((await store.get(userId))?.chips).toBe(chipsBefore - 500);
    expect(await store.bank("two-up")).toBe(bankBefore + 500);
  });

  it("is refused for a second window once the bank cannot cover any more", async () => {
    /*
     * One shared exposure across the whole cloth, not one per seat — the same
     * property games/two-up/src/bank.ts proves in isolation. A second seat at
     * the same table is refused by the same headroom the first seat just used
     * up, which is only reachable here because it is the server that hands
     * every seat the one bank.
     */
    const { port, store, host } = await openTable({ bank: 1000 });
    const opened = await stateWhere(host, (state) => state.seats.length === 1);

    // The whole bank, staked on heads: nothing left for anybody else on that side.
    await act(host, { type: "place", on: "heads", chips: 1000 });
    await stateWhere(host, (state) => (state.seats[0]?.staked ?? 0) === 1000);
    expect(await store.bank("two-up")).toBe(2000);

    const second = await client(port);
    await new Promise<void>((resolve) =>
      second.emit("lobby:join", { name: "Bo", code: opened.code }, () => resolve()),
    );
    await stateWhere(second, (state) => state.seats.length === 2);

    const refused = refusal(second);
    await act(second, { type: "place", on: "heads", chips: 25 });
    expect(await refused).toMatch(/bank cannot cover/i);
  });
});

describe("what an admin can see of the bank behind the coins", () => {
  it("answers with the cap the worst side bet could take", async () => {
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    const store = new MemoryStore();
    const admin = await store.upsertDiscordUser({
      discordId: "d-admin",
      name: "Admin",
      avatar: null,
      accentColor: null,
    });
    await store.bankAdd("two-up", 90_000);
    server = createBackRoomServer({
      store,
      auth: null,
      serveClient: false,
      identify: () => null,
      identifyRequest: () => admin.id,
    });
    await new Promise<void>((resolve) => server?.http.listen(0, () => resolve()));
    const port = (server.http.address() as AddressInfo).port;

    const response = await fetch(`http://localhost:${port}/api/admin/bank?game=two-up`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { bank: number; maxStake: number };
    expect(body.bank).toBe(90_000);
    expect(body.maxStake).toBe(Math.floor(90_000 / STAKE_DIVISOR));
  });
});
