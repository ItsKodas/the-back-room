import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import { BUY_IN } from "@backroom/game-poker";
import type { Ack, ClientToServer, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * Poker, driven through the real socket layer.
 *
 * The rules are proved in games/poker and need nothing from a server. What is
 * only reachable from out here is whether this end wired them up the right way
 * round: that sitting down takes chips off an account and standing up gives
 * back what is in front of you, that the two always cancel — and the one that
 * cannot be asked anywhere else, that a hole card never reaches somebody
 * else's client.
 *
 * Which cards came out is never asserted. The deck is the server's own, so
 * what these ask is what has to hold whatever it dealt.
 */

/** As much of the poker view as these tests read. */
interface View {
  code: string;
  street: string;
  pot: number;
  toAct: string | null;
  seats: Array<{
    id: string;
    name: string;
    stack: number;
    committed: number;
    folded: boolean;
    hole: Array<unknown | null>;
  }>;
}

/*
 * Every state the socket has been sent, and how far a test has read — the same
 * arrangement the blackjack socket tests use, and for the same reason. A table
 * deals itself, so a state can come and go between two awaits; reading forward
 * through a stream finds it, and asking for "the state right now" does not.
 */
type Client = Socket<ServerToClient, ClientToServer> & {
  seen: View[];
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

async function startRoom(
  people: string[],
  extra: { reconnectGraceMs?: number } = {},
): Promise<{
  store: MemoryStore;
  port: number;
  ids: string[];
}> {
  const store = new MemoryStore();
  const ids: string[] = [];
  for (const [index, name] of people.entries()) {
    const profile = await store.upsertDiscordUser({
      discordId: `d${index}`,
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
    ...(extra.reconnectGraceMs === undefined
      ? {}
      : { reconnectGraceMs: extra.reconnectGraceMs }),
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
    const socket = connect(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    }) as Client;
    socket.seen = [];
    socket.read = 0;
    open.push(socket);
    socket.on("room:state", (state) => {
      socket.seen.push(state as unknown as View);
    });
    socket.on("connect", () => resolve(socket));
  });
}

/** The next state that matches, counting from wherever the last wait stopped. */
function stateWhere(socket: Client, ok: (view: View) => boolean, ms = 6000): Promise<View> {
  for (let index = socket.read; index < socket.seen.length; index += 1) {
    const view = socket.seen[index] as View;
    if (ok(view)) {
      socket.read = index + 1;
      return Promise.resolve(view);
    }
  }
  socket.read = socket.seen.length;

  return new Promise<View>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `no matching state: read ${socket.read} of ${socket.seen.length}, seen [${socket.seen
              .map((view) => view.street)
              .join(" ")}]`,
          ),
        ),
      ms,
    );
    const listener = (raw: unknown) => {
      const view = raw as View;
      if (ok(view)) {
        clearTimeout(timer);
        socket.off("room:state", listener);
        socket.read = socket.seen.length;
        resolve(view);
      }
    };
    socket.on("room:state", listener);
  });
}

const open_ = (socket: Client, name: string): Promise<Ack> =>
  new Promise((resolve) => socket.emit("lobby:create", { name, game: "poker" }, resolve));

const join = (socket: Client, name: string, code: string): Promise<Ack> =>
  new Promise((resolve) => socket.emit("lobby:join", { name, code }, resolve));

const act = (socket: Client, action: Record<string, unknown>): Promise<void> =>
  new Promise((resolve) => socket.emit("game:action", action as { type: string }, () => resolve()));

/** The next refusal this socket is told about. Arm it before the action. */
function refusal(socket: Client, ms = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("nothing was refused")), ms);
    socket.once("room:error", (message: string) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

/** Two players sat down with chips in front of them, which is a hand about to start. */
async function seatTwo(port: number): Promise<{
  ada: Client;
  bram: Client;
  seatIds: [string, string];
  code: string;
}> {
  const ada = await client(port);
  const bram = await client(port);
  const opened = await open_(ada, "Ada");
  if (!opened.ok) {
    throw new Error(opened.error);
  }
  const joined = await join(bram, "Bram", opened.code);
  if (!joined.ok) {
    throw new Error(joined.error);
  }
  await act(ada, { type: "buyIn" });
  await act(bram, { type: "buyIn" });
  await stateWhere(ada, (view) => view.seats.length === 2 && view.seats.every((s) => s.stack > 0));
  return { ada, bram, seatIds: [opened.seatId, joined.seatId], code: opened.code };
}

describe("sitting down and standing up", () => {
  it("takes the buy-in off the account and puts it on the table", async () => {
    const { store, port, ids } = await startRoom(["Ada"]);
    const ada = await client(port);
    await open_(ada, "Ada");
    const before = (await store.get(ids[0] as string))?.chips ?? 0;

    await act(ada, { type: "buyIn" });

    const view = await stateWhere(ada, (v) => v.seats.some((seat) => seat.stack > 0));
    expect(view.seats[0]?.stack).toBe(BUY_IN);
    expect((await store.get(ids[0] as string))?.chips).toBe(before - BUY_IN);
  });

  it("gives back what is in front of you when you stand up", async () => {
    const { store, port, ids } = await startRoom(["Ada"]);
    const ada = await client(port);
    await open_(ada, "Ada");
    const before = (await store.get(ids[0] as string))?.chips ?? 0;
    await act(ada, { type: "buyIn" });
    await stateWhere(ada, (v) => v.seats.some((seat) => seat.stack > 0));

    ada.emit("lobby:leave");

    // Paid through the room's settle rather than by the table, so not instant.
    for (let tries = 0; tries < 60; tries += 1) {
      if (((await store.get(ids[0] as string))?.chips ?? 0) === before) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect((await store.get(ids[0] as string))?.chips).toBe(before);
  });

  it("refuses a second buy-in while chips are already on the table", async () => {
    const { port } = await startRoom(["Ada"]);
    const ada = await client(port);
    await open_(ada, "Ada");
    await act(ada, { type: "buyIn" });
    await stateWhere(ada, (v) => v.seats.some((seat) => seat.stack > 0));

    const said = refusal(ada);
    await act(ada, { type: "buyIn" });
    expect(await said).toMatch(/already have chips/i);
  });

  it("will not seat a guest for chips", async () => {
    const store = new MemoryStore();
    server = createBackRoomServer({
      store,
      auth: null,
      serveClient: false,
      identify: () => null,
    });
    await listenForFetch(server.http);
    const port = (server.http.address() as AddressInfo).port;

    const guest = await client(port);
    const ack = await open_(guest, "Nobody");
    // Either the room turns them away at the door or the table does at the
    // buy-in. Both are correct; what must not happen is chips on the felt.
    if (ack.ok) {
      const said = refusal(guest);
      await act(guest, { type: "buyIn" });
      expect(await said).toMatch(/sign in/i);
    } else {
      expect(ack.error).toMatch(/sign in/i);
    }
  });
});

describe("a hand at a real table", () => {
  it("never sends one player another player's hole cards", async () => {
    /*
     * The one thing that cannot be checked anywhere but here, and the one that
     * would matter most if it were wrong: a hole card that reached the wrong
     * client is a hand anybody can read out of the network tab, whatever the
     * felt chose to draw.
     */
    const { port } = await startRoom(["Ada", "Bram"]);
    const { ada, bram, seatIds } = await seatTwo(port);
    const [adaSeat, bramSeat] = seatIds;

    const hers = await stateWhere(ada, (v) => v.street === "preflop");
    expect(hers.seats.find((s) => s.id === adaSeat)?.hole.filter(Boolean)).toHaveLength(2);
    expect(hers.seats.find((s) => s.id === bramSeat)?.hole).toEqual([null, null]);

    // And the same the other way round, so this is not one view simply
    // arriving empty for both of them.
    const his = await stateWhere(bram, (v) => v.street === "preflop");
    expect(his.seats.find((s) => s.id === bramSeat)?.hole.filter(Boolean)).toHaveLength(2);
    expect(his.seats.find((s) => s.id === adaSeat)?.hole).toEqual([null, null]);
  });

  it("posts the blinds and asks somebody to act", async () => {
    const { port } = await startRoom(["Ada", "Bram"]);
    const { ada } = await seatTwo(port);

    const dealt = await stateWhere(ada, (v) => v.street === "preflop");
    expect(dealt.toAct).not.toBeNull();
    expect(dealt.pot).toBe(30);
    /*
     * Every chip is still on the table: what the blinds moved, they moved from
     * a stack into the middle of the same felt. `pot` already counts what is
     * committed — a bet adds to both — so committed is not added again here.
     */
    const onFelt = dealt.pot + dealt.seats.reduce((sum, seat) => sum + seat.stack, 0);
    expect(onFelt).toBe(BUY_IN * 2);
  });

  it("hands back a stack when somebody stands up in the middle of a hand", async () => {
    /*
     * Leaving a poker table is a move, not an interruption: you fold, what you
     * have already bet stays in the pot, and your stack comes with you. Most
     * tables cannot do that — a blackjack hand has to play out before anybody
     * can be paid — so the room holds the seat instead and treats the player
     * as dropped. Held here, the stack has nowhere to go and nothing is
     * waiting to reconnect, so it stays on a table nobody is sitting at.
     */
    const { store, port, ids } = await startRoom(["Ada", "Bram"]);
    const before = (await store.get(ids[0] as string))?.chips ?? 0;
    const { ada } = await seatTwo(port);
    const dealt = await stateWhere(ada, (v) => v.street === "preflop");
    expect(dealt.street).toBe("preflop");

    ada.emit("lobby:leave");

    for (let tries = 0; tries < 80; tries += 1) {
      if (((await store.get(ids[0] as string))?.chips ?? 0) > before - BUY_IN) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const back = ((await store.get(ids[0] as string))?.chips ?? 0) - (before - BUY_IN);
    // Their whole stack, less whatever the blind had already put in the pot.
    expect(back).toBeGreaterThanOrEqual(BUY_IN - 20);
    expect(back).toBeLessThanOrEqual(BUY_IN);
  });

  it("pays everybody who stands up, not just the first", async () => {
    /*
     * Both leaves land before anything else is broadcast, so both people are
     * owed at once. Paying them through the room's settle-once flag would pay
     * whoever was first and swallow the other: that flag guards a state a
     * table stays in, and what is owed to people who have left is a queue.
     */
    const { store, port, ids } = await startRoom(["Ada", "Bram"]);
    const held = async () =>
      ((await store.get(ids[0] as string))?.chips ?? 0) +
      ((await store.get(ids[1] as string))?.chips ?? 0);
    const before = await held();
    const { ada, bram } = await seatTwo(port);
    await stateWhere(ada, (v) => v.street === "preflop");

    ada.emit("lobby:leave");
    bram.emit("lobby:leave");

    for (let tries = 0; tries < 80; tries += 1) {
      if ((await held()) === before) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // Both stacks back, and the blinds with them: the pot goes to whoever was
    // left, and by then that is one of these two.
    expect(await held()).toBe(before);
  });

  it("mints nothing across a hand played to the end", async () => {
    /*
     * The rule the whole building rests on, asked of a real hand through a
     * real socket: whatever anybody won came off somebody at the same table.
     */
    const { store, port, ids } = await startRoom(["Ada", "Bram"]);
    const held = async () =>
      ((await store.get(ids[0] as string))?.chips ?? 0) +
      ((await store.get(ids[1] as string))?.chips ?? 0);
    const before = await held();

    const { ada, bram, seatIds } = await seatTwo(port);
    const dealt = await stateWhere(ada, (v) => v.street === "preflop");

    // Whoever is asked folds, which ends the hand however the cards fell.
    await act(dealt.toAct === seatIds[0] ? ada : bram, { type: "fold" });
    await stateWhere(ada, (v) => v.street === "showdown" || v.street === "waiting");

    ada.emit("lobby:leave");
    bram.emit("lobby:leave");
    for (let tries = 0; tries < 80; tries += 1) {
      if ((await held()) === before) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(await held()).toBe(before);
  });
});
