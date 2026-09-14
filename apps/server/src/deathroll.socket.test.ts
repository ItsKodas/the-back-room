import type { AddressInfo } from "node:net";
import { MemoryStore, STARTING_CHIPS } from "@backroom/economy";
import { DEAL_MS } from "@backroom/game-death-roll";
import type { TableView } from "@backroom/game-death-roll";
import type { Ack, ClientToServer, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";

/**
 * A whole duel, over two sockets, with the balances checked at both ends.
 *
 * The unit tests prove the arithmetic; this proves the wiring — that a table
 * of this game can actually be opened, that the antes leave the two accounts,
 * and that everything taken comes back to one of them.
 */

/*
 * Every state the socket has been sent, and how far a test has read.
 *
 * Borrowed from blackjack.socket.test.ts: a table that deals itself passes
 * through states faster than a test can ask about them, so "the state right
 * now" is not enough — states are kept as a stream and each wait picks up
 * where the last one finished.
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

/**
 * A room with real accounts in it, each starting with `STARTING_CHIPS`.
 *
 * `roll` stands in for the table's own randomness, the way `roll` and
 * `spinRandom` do for the other games registered here — a duel decided by
 * real chance is not a duel a test can end on the first roll.
 */
async function startRoom(
  people: Array<string | null>,
  options: { roll?: (ceiling: number) => number } = {},
): Promise<{ store: MemoryStore; port: number; ids: Array<string | null> }> {
  const store = new MemoryStore();
  const ids: Array<string | null> = [];
  for (const [index, name] of people.entries()) {
    if (name === null) {
      ids.push(null);
      continue;
    }
    const profile = await store.upsertDiscordUser({
      discordId: `dr${index}`,
      name,
      avatar: null,
      accentColor: null,
    });
    ids.push(profile.id);
  }

  let seen = 0;
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    botDelayMs: 5,
    deathRollRoll: options.roll,
    identify: () => {
      const id = ids[seen] ?? null;
      seen += 1;
      return id;
    },
  });
  await new Promise<void>((resolve) => server?.http.listen(0, () => resolve()));
  return { store, port: (server.http.address() as AddressInfo).port, ids };
}

function client(port: number): Promise<Client> {
  return new Promise((resolve) => {
    const socket: Client = connect(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    });
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

/** The next state that matches, counting from wherever the last wait stopped. */
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
      () =>
        reject(
          new Error(
            `no matching state: read ${socket.read} of ${socket.seen.length}, seen [${socket.seen
              .map((view) => view.phase)
              .join(" ")}]`,
          ),
        ),
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

function open_(
  socket: Client,
  name: string,
  extra: { buyIn?: number; ceiling?: number; forFun?: boolean } = {},
): Promise<Ack> {
  return new Promise((resolve) =>
    socket.emit("lobby:create", { name, game: "death-roll", ...extra }, resolve),
  );
}

function join(socket: Client, name: string, code: string): Promise<Ack> {
  return new Promise((resolve) => socket.emit("lobby:join", { name, code }, resolve));
}

describe("a death roll table over sockets", () => {
  it("opens, deals itself once two people are at it, and pays the winner", async () => {
    // A roller that always returns 1, so the first roll ends the duel and
    // the test does not depend on chance.
    const { store, port, ids } = await startRoom(["Ada", "Bo"], { roll: () => 1 });
    const ada = ids[0] as string;
    const bo = ids[1] as string;

    const host = await client(port);
    const ack = await open_(host, "Ada", { buyIn: 500, ceiling: 1_000 });
    expect(ack.ok).toBe(true);
    if (!ack.ok) {
      throw new Error("create failed");
    }

    const guest = await client(port);
    const joined = await join(guest, "Bo", ack.code);
    expect(joined.ok).toBe(true);

    // Both antes are on the felt the moment the table can seat a duel.
    const dueling = await stateWhere(host, (view) => view.phase === "dueling");
    expect(dueling.pot).toBe(1_000);
    expect((await store.get(ada))?.chips).toBe(STARTING_CHIPS - 500);
    expect((await store.get(bo))?.chips).toBe(STARTING_CHIPS - 500);

    // Whoever the table says is to roll, rolls — and with the roller fixed
    // at 1, that roll ends the duel and that seat loses it.
    const hostSeatId = host.id;
    const guestSeatId = guest.id;
    const roller = dueling.toRoll === hostSeatId ? host : guest;
    expect([hostSeatId, guestSeatId]).toContain(dueling.toRoll);

    await new Promise<void>((resolve) => roller.emit("game:action", { type: "roll" }, () => resolve()));

    const over = await stateWhere(host, (view) => view.phase === "over");
    expect(over.loserId).toBe(dueling.toRoll);

    const loserAccount = over.loserId === hostSeatId ? ada : bo;
    const winnerAccount = over.loserId === hostSeatId ? bo : ada;

    // Settling is asynchronous, so wait for the chips rather than assume them.
    await expect.poll(async () => (await store.get(loserAccount))?.chips).toBe(STARTING_CHIPS - 500);
    await expect.poll(async () => (await store.get(winnerAccount))?.chips).toBe(STARTING_CHIPS + 500);
  });

  it("takes nothing from anybody while it waits for a second player", async () => {
    const { store, port, ids } = await startRoom(["Ada"]);
    const ada = ids[0] as string;

    const host = await client(port);
    const ack = await open_(host, "Ada", { buyIn: 500 });
    expect(ack.ok).toBe(true);
    await stateWhere(host, (view) => view.seats.length === 1);

    // Long enough for the deal pause to have fired twice over, if it were
    // ever going to fire with only one person seated.
    await new Promise((resolve) => setTimeout(resolve, DEAL_MS * 2 + 300));

    expect((await store.get(ada))?.chips).toBe(STARTING_CHIPS);
    expect(host.latest?.pot).toBe(0);
  });

  it("refuses a bot at a table playing for chips", async () => {
    const { port } = await startRoom(["Ada"]);
    const host = await client(port);
    await open_(host, "Ada", { buyIn: 500 });
    await stateWhere(host, (view) => view.seats.length === 1);

    const refused = new Promise<string>((resolve) => host.once("room:error", resolve));
    host.emit("lobby:addBot", { skill: "normal" });

    // The refusal is the server's and the table's, not the client's.
    expect(await refused).toMatch(/fun/i);
    expect(host.latest?.seats).toHaveLength(1);
  });
});
