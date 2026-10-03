import type { AddressInfo } from "node:net";
import { MemoryStore, STARTING_CHIPS } from "@backroom/economy";
import type { TableView } from "@backroom/game-uno";
import type { Ack, ClientToServer, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * Uno, driven through the real socket layer.
 *
 * The engine and the table are tested in their own package; what is only
 * reachable here is the seam — that the host's rules survive the trip through
 * the schema and the server to the table, and that each socket is sent its own
 * hand and nothing but a count for anybody else's.
 */

/*
 * Every state a socket has been sent, and how far a test has read.
 *
 * Borrowed from deathroll.socket.test.ts: a table that deals itself passes
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

/** A room with real accounts in it, each starting with `STARTING_CHIPS`. */
async function startRoom(
  people: Array<string | null>,
): Promise<{ store: MemoryStore; port: number; ids: Array<string | null> }> {
  const store = new MemoryStore();
  const ids: Array<string | null> = [];
  for (const [index, name] of people.entries()) {
    if (name === null) {
      ids.push(null);
      continue;
    }
    const profile = await store.upsertDiscordUser({
      discordId: `uno${index}`,
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
    identify: () => {
      const id = ids[seen] ?? null;
      seen += 1;
      return id;
    },
  });
  await listenForFetch(server.http);
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
  extra: { buyIn?: number; forFun?: boolean; uno?: Record<string, boolean | number | string> } = {},
): Promise<Ack> {
  return new Promise((resolve) =>
    socket.emit("lobby:create", { name, game: "uno", ...extra }, resolve),
  );
}

function join(socket: Client, name: string, code: string): Promise<Ack> {
  return new Promise((resolve) => socket.emit("lobby:join", { name, code }, resolve));
}

/** Sends a move and waits for the server to say it has dealt with it. */
function act(socket: Client, action: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => socket.emit("game:action", action as { type: string }, () => resolve()));
}

/** Says this seat is in for the next game. */
function ready(socket: Client): Promise<void> {
  return act(socket, { type: "ready", ready: true });
}

describe("an uno table over sockets", () => {
  it("opens with the host's rules and deals each player a hand only they can see", async () => {
    const { store, port, ids } = await startRoom(["Ada", "Bo"]);
    const host = await client(port);
    const ack = await open_(host, "Ada", { buyIn: 500, uno: { stacking: "mixed", rabbids: true, handSize: 5 } });
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const bo = await client(port);
    await join(bo, "Bo", ack.code);
    const waiting = await stateWhere(host, (view) => view.seats.length === 2);
    expect(waiting.rules.stacking).toBe("mixed");
    expect(waiting.rules.rabbids).toBe(true);

    await Promise.all([ready(host), ready(bo)]);
    const hostPlaying = await stateWhere(host, (view) => view.phase === "playing");
    const boPlaying = await stateWhere(bo, (view) => view.phase === "playing");
    expect(hostPlaying.pot).toBe(1_000);
    expect((await store.get(ids[0] as string))?.chips).toBe(STARTING_CHIPS - 500);

    const boSeat = hostPlaying.seats.find((seat) => seat.id === bo.id);
    expect(boSeat?.cards).toBe(boPlaying.hand?.cards.length);
    expect(boSeat?.shown).toEqual([]);
    const theirs = new Set(boPlaying.hand?.cards.map((card) => card.id));
    expect(hostPlaying.hand?.cards.some((card) => theirs.has(card.id))).toBe(false);

    // Whoever is to act draws, and both screens hear about it. The deal is
    // real randomness, so a round that opened on a Wild needs its colour first.
    const toAct = hostPlaying.toAct === host.id ? host : bo;
    if (hostPlaying.step === "chooseColor") {
      await act(toAct, { type: "color", color: "red" });
      await stateWhere(bo, (view) => view.step === "playing");
    }
    const before = hostPlaying.drawPile;
    await act(toAct, { type: "draw" });
    await stateWhere(bo, (view) => view.drawPile < before);
  });

  it("refuses a rules bag too big to be rules", async () => {
    const { port } = await startRoom(["Ada"]);
    const host = await client(port);
    const uno = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`r${i}`, true]));
    const ack = await open_(host, "Ada", { uno });
    expect(ack.ok).toBe(false);
  });
});
