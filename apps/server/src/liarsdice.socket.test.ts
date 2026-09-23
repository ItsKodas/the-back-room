import type { AddressInfo } from "node:net";
import { MemoryStore, STARTING_CHIPS } from "@backroom/economy";
import type { TableView } from "@backroom/game-liars-dice";
import type { Ack, ClientToServer, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * Liar's Dice, driven through the real socket layer.
 *
 * The engine is tested directly in its own package; what is only reachable
 * here is the seam a table built per seat exists to prove — that a player's
 * own socket is handed their own faces and `null` for everybody else's, and
 * that a call turns every cup over for both screens at once, not just the
 * caller's.
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

/**
 * A room with real accounts in it, each starting with `STARTING_CHIPS`.
 *
 * No injectable roll here, unlike death roll's `deathRollRoll`: the server
 * always deals this game from `randomInt`, on purpose (Ruling 3 — a reveal
 * hands every player at the table its whole hand, which is exactly the run of
 * observations that would recover `Math.random`'s state). What is exercised
 * below never depends on which faces came up, only on who is allowed to see
 * them and when.
 */
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
      discordId: `ld${index}`,
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
  extra: { buyIn?: number; dice?: number; forFun?: boolean } = {},
): Promise<Ack> {
  return new Promise((resolve) =>
    socket.emit("lobby:create", { name, game: "liars-dice", ...extra }, resolve),
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

describe("a liar's dice table over sockets", () => {
  it("deals two players once both are ready, taking one ante each into the pot", async () => {
    const { store, port, ids } = await startRoom(["Ada", "Bo"]);
    const host = await client(port);
    const ack = await open_(host, "Ada", { buyIn: 500 });
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const bo = await client(port);
    await join(bo, "Bo", ack.code);
    await stateWhere(host, (view) => view.seats.length === 2);

    await Promise.all([ready(host), ready(bo)]);

    const playing = await stateWhere(host, (view) => view.phase === "playing");
    expect(playing.pot).toBe(1_000);
    expect((await store.get(ids[0] as string))?.chips).toBe(STARTING_CHIPS - 500);
    expect((await store.get(ids[1] as string))?.chips).toBe(STARTING_CHIPS - 500);
  });

  it("shows each player their own faces and null for the other's, until a call turns every cup over", async () => {
    const { port } = await startRoom(["Ada", "Bo"]);
    const host = await client(port);
    const ack = await open_(host, "Ada", { buyIn: 500, dice: 3 });
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const bo = await client(port);
    await join(bo, "Bo", ack.code);
    await stateWhere(host, (view) => view.seats.length === 2);

    await Promise.all([ready(host), ready(bo)]);
    const hostPlaying = await stateWhere(host, (view) => view.phase === "playing");
    const boPlaying = await stateWhere(bo, (view) => view.phase === "playing");

    // This is the whole point of a table built per seat: your own hand is
    // real dice, everybody else's on your own screen is a face-down cup.
    const hostHand = hostPlaying.you?.hand ?? [];
    const boHand = boPlaying.you?.hand ?? [];
    expect(hostHand).toHaveLength(3);
    expect(hostHand.every((face) => face !== null)).toBe(true);
    expect(boHand).toHaveLength(3);
    expect(boHand.every((face) => face !== null)).toBe(true);

    const hostSeesBo = hostPlaying.seats.find((seat) => seat.id === bo.id);
    expect(hostSeesBo?.hand).toEqual([null, null, null]);
    const boSeesHost = boPlaying.seats.find((seat) => seat.id === host.id);
    expect(boSeesHost?.hand).toEqual([null, null, null]);

    // A bid anybody can make: one die of any face is never more than the
    // table holds, whatever it rolled.
    const toAct = hostPlaying.toAct as string;
    const bidder = toAct === host.id ? host : bo;
    await act(bidder, { type: "bid", count: 1, face: 1 });
    // The ack fires the moment the action is dispatched, not once it has
    // landed — the game runs inside the same fire-and-forget guard every
    // other table's actions do — so the call below has to wait for the bid
    // to actually be on the felt rather than racing it there.
    await stateWhere(host, (view) => view.bid !== null);

    const caller = toAct === host.id ? bo : host;
    await act(caller, { type: "liar" });
    const settled = await stateWhere(host, (view) => view.resolution !== null);
    const settledForBo = await stateWhere(bo, (view) => view.resolution !== null);

    // Turned face up for both screens, and they agree with what each player
    // saw of their own hand before the call.
    const hostAfter = settled.seats.find((seat) => seat.id === host.id);
    const boAfter = settled.seats.find((seat) => seat.id === bo.id);
    expect(hostAfter?.hand).toEqual(hostHand);
    expect(boAfter?.hand).toEqual(boHand);
    const hostAfterFromBo = settledForBo.seats.find((seat) => seat.id === host.id);
    const boAfterFromBo = settledForBo.seats.find((seat) => seat.id === bo.id);
    expect(hostAfterFromBo?.hand).toEqual(hostHand);
    expect(boAfterFromBo?.hand).toEqual(boHand);
  });

  it("refuses a bid from the wrong seat, and leaves the standing bid where it was", async () => {
    const { port } = await startRoom(["Ada", "Bo"]);
    const host = await client(port);
    const ack = await open_(host, "Ada", { buyIn: 500 });
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const bo = await client(port);
    await join(bo, "Bo", ack.code);
    await stateWhere(host, (view) => view.seats.length === 2);

    await Promise.all([ready(host), ready(bo)]);
    const playing = await stateWhere(host, (view) => view.phase === "playing");

    const toAct = playing.toAct as string;
    const opener = toAct === host.id ? host : bo;

    await act(opener, { type: "bid", count: 1, face: 1 });
    const bid = await stateWhere(host, (view) => view.bid !== null);
    expect(bid.bid).toEqual({ count: 1, face: 1 });
    expect(bid.bidder).toBe(toAct);

    // The bid moved the turn on, so the wrong seat now is the one that just
    // went — not the one it started as.
    const nowToAct = bid.toAct as string;
    const wrongSeat = nowToAct === host.id ? bo : host;

    const refused = new Promise<string>((resolve) => wrongSeat.once("room:error", resolve));
    wrongSeat.emit("game:action", { type: "bid", count: 2, face: 1 });

    expect(await refused).toMatch(/turn/i);
    // Refused, so the bid on the felt is still the opener's first one.
    expect(host.latest?.bid).toEqual({ count: 1, face: 1 });
    expect(host.latest?.bidder).toBe(toAct);
  });

  it("refuses a bot at a table playing for chips", async () => {
    const { port } = await startRoom(["Ada"]);
    const host = await client(port);
    await open_(host, "Ada", { buyIn: 500 });
    await stateWhere(host, (view) => view.seats.length === 1);

    const refused = new Promise<string>((resolve) => host.once("room:error", resolve));
    host.emit("lobby:addBot", { skill: "normal" });

    expect(await refused).toMatch(/fun/i);
    expect(host.latest?.seats).toHaveLength(1);
  });

  it("seats a bot at a for-fun table and deals with one human", async () => {
    const { port } = await startRoom(["Ada"]);
    const host = await client(port);
    const ack = await open_(host, "Ada", { forFun: true });
    if (!ack.ok) {
      throw new Error("create failed");
    }
    await stateWhere(host, (view) => view.seats.length === 1);

    host.emit("lobby:addBot", { skill: "normal" });
    await stateWhere(host, (view) => view.seats.length === 2);
    await ready(host);

    const playing = await stateWhere(host, (view) => view.phase === "playing", 5_000);
    expect(playing.seats.some((seat) => seat.isBot)).toBe(true);
    expect(playing.seats.filter((seat) => !seat.isBot)).toHaveLength(1);
    // Play money, not a real account: nothing at a for-fun table has one.
    expect(playing.seats.every((seat) => seat.purse !== null)).toBe(true);
  });
});
