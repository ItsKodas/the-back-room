import type { AddressInfo } from "node:net";
import { MemoryStore, STARTING_CHIPS } from "@backroom/economy";
import type { TableView } from "@backroom/game-death-roll";
import type { Ack, ClientToServer, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";

/**
 * A whole game, over three sockets, with the balances checked at both ends.
 *
 * The unit tests prove the arithmetic; this proves the wiring — that a table
 * of this game can actually be opened, that the antes leave every account
 * dealt in, and that everything taken comes back to one of them.
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

/** Says this seat is in for the next game. */
function ready(socket: Client): Promise<void> {
  return new Promise((resolve) =>
    socket.emit("game:action", { type: "ready", ready: true }, () => resolve()),
  );
}

describe("a death roll table over sockets", () => {
  it("deals three players once they are all ready, and pays the last one standing", async () => {
    // A roller that always returns 1, so every roll puts somebody out.
    const { store, port, ids } = await startRoom(["Ada", "Bo", "Cy"], { roll: () => 1 });
    const accounts = new Map<string, string>();

    const host = await client(port);
    const ack = await open_(host, "Ada", { buyIn: 500, ceiling: 1_000 });
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const bo = await client(port);
    const cy = await client(port);
    await join(bo, "Bo", ack.code);
    await join(cy, "Cy", ack.code);
    accounts.set(host.id as string, ids[0] as string);
    accounts.set(bo.id as string, ids[1] as string);
    accounts.set(cy.id as string, ids[2] as string);
    const sockets = new Map([
      [host.id as string, host],
      [bo.id as string, bo],
      [cy.id as string, cy],
    ]);

    await Promise.all([ready(host), ready(bo), ready(cy)]);

    // Antes go on at the deal and not before.
    const playing = await stateWhere(host, (view) => view.phase === "playing");
    expect(playing.pot).toBe(1_500);
    for (const account of accounts.values()) {
      expect((await store.get(account))?.chips).toBe(STARTING_CHIPS - 500);
    }

    const first = playing.toRoll as string;
    await new Promise<void>((resolve) =>
      sockets.get(first)?.emit("game:action", { type: "roll" }, () => resolve()),
    );

    // The felt shows who went out, then the next round starts at 100.
    const second = await stateWhere(host, (view) => view.round === 2 && view.toRoll !== null, 8_000);
    expect(second.ceiling).toBe(100);
    const next = second.toRoll as string;
    await new Promise<void>((resolve) =>
      sockets.get(next)?.emit("game:action", { type: "roll" }, () => resolve()),
    );

    const over = await stateWhere(host, (view) => view.phase === "over", 8_000);
    const winner = over.winnerIds[0] as string;
    expect([first, next]).not.toContain(winner);

    for (const [seatId, account] of accounts) {
      const expected = seatId === winner ? STARTING_CHIPS + 1_000 : STARTING_CHIPS - 500;
      await expect.poll(async () => (await store.get(account))?.chips).toBe(expected);
    }
  }, 20_000);

  it("takes nothing from anybody while nobody is ready, though the same table deals as soon as both are", async () => {
    const { store, port, ids } = await startRoom(["Ada", "Bo"]);
    const host = await client(port);
    const ack = await open_(host, "Ada", { buyIn: 500 });
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const bo = await client(port);
    await join(bo, "Bo", ack.code);
    await stateWhere(host, (view) => view.seats.length === 2);

    /*
     * The wait is only meaningful if a table that could deal would have dealt
     * inside it — so the second half of this test presses ready and requires
     * the deal within the same span. Two seated and nobody ready runs exactly
     * the path an all-ready table deals through, with a zero-length pause, so
     * a table that stopped consulting readiness fails the first half.
     */
    const WINDOW_MS = 1_000;
    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS));

    expect((await store.get(ids[0] as string))?.chips).toBe(STARTING_CHIPS);
    expect((await store.get(ids[1] as string))?.chips).toBe(STARTING_CHIPS);
    expect(host.seen.every((view) => view.phase === "waiting" && view.pot === 0)).toBe(true);

    await Promise.all([ready(host), ready(bo)]);
    const playing = await stateWhere(host, (view) => view.phase === "playing", WINDOW_MS);
    expect(playing.pot).toBe(1_000);
  });

  it("tells every screen a deal fell through when the store fails while taking the antes", async () => {
    const { store, port, ids } = await startRoom(["Ada", "Bo"]);
    const host = await client(port);
    const ack = await open_(host, "Ada", { buyIn: 500 });
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const bo = await client(port);
    await join(bo, "Bo", ack.code);
    await stateWhere(bo, (view) => view.seats.length === 2);

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    store.adjustChips = async () => {
      throw new Error("store down");
    };
    try {
      await Promise.all([ready(host), ready(bo)]);

      // Waited for as an event rather than a sleep: without the rebroadcast
      // this state is never sent at all.
      const failed = await stateWhere(
        bo,
        (view) => /could not take the antes/.test(view.lastEvent ?? ""),
      );
      expect(failed.phase).toBe("waiting");
      expect(failed.readyCount).toBe(0);
      expect(failed.seats.every((seat) => !seat.ready)).toBe(true);
    } finally {
      logged.mockRestore();
    }
    expect((await store.get(ids[0] as string))?.chips).toBe(STARTING_CHIPS);
    expect((await store.get(ids[1] as string))?.chips).toBe(STARTING_CHIPS);
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
