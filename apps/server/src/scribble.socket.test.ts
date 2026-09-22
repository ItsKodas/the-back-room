import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import type { TableView } from "@backroom/game-scribble";
import type { Ack, ChatMessage, ClientToServer, ServerToClient, TableRelay } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

type Client = Socket<ServerToClient, ClientToServer> & { seen: TableView[]; read: number; seatId: string };

const WORDS = "lighthouse, accordion, sandcastle, telescope, pineapple, snowflake, waterfall, butterfly, chocolate, dinosaur";

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

async function start(): Promise<number> {
  server = createBackRoomServer({
    store: new MemoryStore(),
    auth: null,
    serveClient: false,
    identify: () => null,
    // A countdown short enough to wait for, and every other phase long enough never to fire mid-test.
    scribble: { random: () => 0, timings: { countdownMs: 30, pickMs: 60_000, revealMs: 60_000, resultMs: 60_000 } },
  });
  await listenForFetch(server.http);
  return (server.http.address() as AddressInfo).port;
}

function client(port: number): Promise<Client> {
  return new Promise((resolve) => {
    const socket = connect(`http://localhost:${port}`, { transports: ["websocket"], forceNew: true }) as Client;
    socket.seen = [];
    socket.read = 0;
    open.push(socket);
    socket.on("room:state", (state) => {
      socket.seen.push(state as unknown as TableView);
    });
    socket.on("connect", () => resolve(socket));
  });
}

function stateWhere(socket: Client, ok: (state: TableView) => boolean, ms = 3000): Promise<TableView> {
  for (let index = socket.read; index < socket.seen.length; index += 1) {
    const state = socket.seen[index] as TableView;
    if (ok(state)) {
      socket.read = index + 1;
      return Promise.resolve(state);
    }
  }
  socket.read = socket.seen.length;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no matching state")), ms);
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

/**
 * An inert round trip, for finding out when a socket has everything it is going to get.
 *
 * `game:action` is the one event the server always acknowledges, and a payload
 * its schema refuses is acknowledged before the handler reaches a table, a game
 * or a seat — so this asks for nothing and changes nothing. Its only use is the
 * ack: socket.io keeps one connection's messages in order, so by the time this
 * comes back, everything the server had already sent down this connection has
 * arrived.
 */
const answered = (socket: Client) =>
  new Promise<void>((resolve) => socket.emit("game:action", { type: "" }, () => resolve()));

/**
 * Everything one event brought in — for proving something did *not* arrive.
 *
 * Waits for a barrier rather than a window. A window of milliseconds cannot do
 * this job: on a machine running the rest of the suite beside this file the
 * round trip outlasts any window worth picking, so the test stops proving who
 * may see a message and starts reporting how busy the machine was. Nothing here
 * is timing-dependent, which is why there is no number to tune.
 *
 * Read by calling it, naming whichever sockets caused the sending. Those get
 * their round trip first, because the server has to have finished with the
 * cause before a silence anywhere else means anything; this socket's own trip
 * then drains whatever that produced for it.
 */
function heard<E extends "room:relay" | "chat:message" | "room:error">(socket: Client, event: E) {
  const got: unknown[] = [];
  const listener = (payload: unknown) => got.push(payload);
  socket.on(event, listener as never);
  return async (...after: Client[]): Promise<unknown[]> => {
    for (const one of new Set([...after, socket])) {
      await answered(one);
    }
    socket.off(event, listener as never);
    return got;
  };
}

/** The event loop taken away for a while: what a loaded machine does to a worker. */
function stall(ms: number): number {
  const until = Date.now() + ms;
  let spins = 0;
  while (Date.now() < until) {
    spins += 1;
  }
  return spins;
}

/** A table of `names.length` guests, dealt and drawing "lighthouse". Returns clients keyed by seat id. */
async function drawing(names: string[], scribble: Record<string, unknown> = {}) {
  const port = await start();
  const people: Client[] = [];
  for (const [index, name] of names.entries()) {
    const socket = await client(port);
    const ack = await new Promise<Ack>((resolve) => {
      if (index === 0) {
        socket.emit(
          "lobby:create",
          { name, game: "scribble", maxSeats: 8, scribble: { custom: WORDS, onlyCustom: true, ...scribble } },
          resolve,
        );
      } else {
        socket.emit("lobby:join", { name, code: (people[0] as Client & { code: string }).code }, resolve);
      }
    });
    if (!ack.ok) {
      throw new Error(ack.error);
    }
    socket.seatId = ack.seatId;
    (socket as Client & { code: string }).code = ack.code;
    people.push(socket);
  }
  const bySeat = new Map(people.map((socket) => [socket.seatId, socket]));
  const picking = await stateWhere(people[0] as Client, (view) => view.phase === "picking");
  const picker = bySeat.get(picking.turn?.picker as string) as Client;
  picker.emit("game:action", { type: "pick", index: 0 });
  for (const socket of people) {
    await stateWhere(socket, (view) => view.phase === "drawing");
  }
  const drawers = (picking.turn?.drawers ?? []).map((id) => bySeat.get(id) as Client);
  const guessers = people.filter((socket) => !drawers.includes(socket));
  return { people, drawers, guessers };
}

describe("a line being drawn", () => {
  it("reaches everybody else as a relay, and not as a new state", async () => {
    const { drawers, guessers } = await drawing(["Ada", "Bo", "Cy"]);
    const drawer = drawers[0] as Client;
    const listening = guessers.map((socket) => heard(socket, "room:relay"));
    const echo = heard(drawer, "room:relay");
    const statesBefore = guessers.map((socket) => socket.seen.length);

    drawer.emit("game:action", { type: "stroke", id: "k1", seq: 0, ink: "red", size: 1, pts: [10, 10, 20, 20] });

    for (const relays of await Promise.all(listening.map((read) => read(drawer)))) {
      expect(relays).toEqual([
        {
          seatId: drawer.seatId,
          payload: { kind: "stroke", id: "k1", by: drawer.seatId, ink: "red", size: 1, seq: 0, pts: [10, 10, 20, 20] },
        } satisfies TableRelay,
      ]);
    }
    expect(await echo(drawer)).toEqual([]);
    expect(guessers.map((socket) => socket.seen.length)).toEqual(statesBefore);
  });

  it("is refused from somebody who is not drawing", async () => {
    const { guessers } = await drawing(["Ada", "Bo", "Cy"]);
    const guesser = guessers[0] as Client;
    const errors = heard(guesser, "room:error");
    guesser.emit("game:action", { type: "stroke", id: "k1", seq: 0, ink: "red", size: 1, pts: [1, 1] });
    expect(await errors(guesser)).toEqual(["Only the people drawing can draw."]);
  });

  it("tells a refused drawer before the action's own ack, so a client can attribute the refusal correctly", async () => {
    // A pair draws together, so one can reuse the other's line id and be told
    // whose it is — proving the same ordering an ink client's attribution
    // depends on: room:error for a refusal always beats that action's ack.
    const { drawers } = await drawing(["Ada", "Bo", "Cy", "Di"], { mode: "teams", teams: 2 });
    expect(drawers).toHaveLength(2);
    const [first, second] = drawers as [Client, Client];
    await new Promise<void>((resolve) => {
      first.emit("game:action", { type: "stroke", id: "k1", seq: 0, ink: "red", size: 1, pts: [1, 1] }, () => resolve());
    });

    const order: string[] = [];
    second.on("room:error", () => order.push("error"));
    await new Promise<void>((resolve) => {
      second.emit("game:action", { type: "stroke", id: "k1", seq: 1, ink: "red", size: 1, pts: [2, 2] }, () => {
        order.push("ack");
        resolve();
      });
    });
    expect(order).toEqual(["error", "ack"]);
  });
});

describe("chat at a scribble table", () => {
  it("never shows a close guess to anybody but its author", async () => {
    const { drawers, guessers } = await drawing(["Ada", "Bo", "Cy", "Di"]);
    const [author, other] = guessers as [Client, Client];
    const mine = heard(author, "chat:message");
    const theirs = heard(other, "chat:message");
    const drawer = heard(drawers[0] as Client, "chat:message");

    author.emit("chat:send", { text: "lighthose" });

    expect((await mine(author)) as ChatMessage[]).toMatchObject([{ text: "lighthose", kind: "close" }]);
    expect(await theirs(author)).toEqual([]);
    expect(await drawer(author)).toEqual([]);
  });

  it("tells the author their close guess however slowly the round trip comes back", async () => {
    /*
     * The same message as above, with the worker taken away from under it.
     *
     * This is what the machine does to this file when the rest of the suite is
     * running beside it, and what a window of milliseconds cannot survive: the
     * round trip is still in flight when the clock runs out, and a test that
     * was checking who may see a close guess fails over how long the wire took.
     */
    const { guessers } = await drawing(["Ada", "Bo", "Cy", "Di"]);
    const author = guessers[0] as Client;
    const mine = heard(author, "chat:message");

    author.emit("chat:send", { text: "lighthose" });
    stall(400);

    expect((await mine(author)) as ChatMessage[]).toMatchObject([{ text: "lighthose", kind: "close" }]);
  });

  it("tells the room somebody got it without ever sending the word", async () => {
    const { people, guessers } = await drawing(["Ada", "Bo", "Cy", "Di"]);
    const guesser = guessers[0] as Client;
    const everyone = people.map((socket) => heard(socket, "chat:message"));

    guesser.emit("chat:send", { text: "LIGHTHOUSE" });

    for (const lines of await Promise.all(everyone.map((read) => read(guesser)))) {
      expect(lines).toEqual([expect.objectContaining({ seatId: guesser.seatId, kind: "got", text: "got it" })]);
    }
    const after = await stateWhere(people[0] as Client, (view) => view.seats.some((seat) => seat.guessed));
    expect(after.seats.find((seat) => seat.id === guesser.seatId)?.guessed).toBe(true);
  });

  it("sends a wrong guess to the drawer and the other guessers", async () => {
    const { drawers, guessers } = await drawing(["Ada", "Bo", "Cy"]);
    const [author, other] = guessers as [Client, Client];
    const theirs = heard(other, "chat:message");
    const drawer = heard(drawers[0] as Client, "chat:message");
    author.emit("chat:send", { text: "tower" });
    expect(await theirs(author)).toMatchObject([{ text: "tower", kind: "guess" }]);
    expect(await drawer(author)).toMatchObject([{ text: "tower", kind: "guess" }]);
  });

  it("refuses a drawing pair's message that gives the word away", async () => {
    const { drawers } = await drawing(["Ada", "Bo", "Cy", "Di"], { mode: "teams", teams: 2 });
    expect(drawers).toHaveLength(2);
    const drawer = drawers[0] as Client;
    const errors = heard(drawer, "room:error");
    drawer.emit("chat:send", { text: "it's a LIGHT HOUSE" });
    expect(await errors(drawer)).toEqual(["That gives the word away."]);
  });
});
