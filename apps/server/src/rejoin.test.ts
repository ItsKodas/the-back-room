import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import type { Ack, ClientToServer, RoomView, ServerToClient } from "@backroom/shared";
import { io as connect } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { afterEach, expect, describe, it } from "vitest";
import { createBackRoomServer } from "./server.js";
import type { BackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * Coming back to a table you are already sitting at.
 *
 * Leaving a game in progress does not give the seat up — it cannot, because
 * seats are held by index and removing one mid-game would shift the turn order
 * out from under everybody else. So returning has to be a return, not a second
 * arrival, and that is only checkable across separate sockets carrying the
 * same identity: exactly what a browser does when somebody comes back.
 */

type Client = Socket<ServerToClient, ClientToServer> & { latest?: RoomView };

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

/** Identities handed out in connection order, so a socket can "be" somebody. */
async function start(order: Array<string | null>): Promise<number> {
  const store = new MemoryStore();
  const ids: Array<string | null> = [];
  /*
   * Keyed on the name alone, so the same name twice is the same person coming
   * back rather than a stranger who happens to share it. Getting this wrong is
   * how the first version of this test "failed": it minted a second Ada and
   * then complained she was not the first one.
   */
  for (const name of order) {
    if (name === null) {
      ids.push(null);
      continue;
    }
    const profile = await store.upsertDiscordUser({
      discordId: `discord-${name}`,
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
  return (server.http.address() as AddressInfo).port;
}

function client(port: number): Promise<Client> {
  return new Promise((resolve) => {
    const socket: Client = connect(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    });
    open.push(socket);
    socket.on("room:state", (state) => {
      socket.latest = state as unknown as RoomView;
    });
    socket.on("connect", () => resolve(socket));
  });
}

function stateWhere(socket: Client, ok: (room: RoomView) => boolean, ms = 2500) {
  if (socket.latest !== undefined && ok(socket.latest)) {
    return Promise.resolve(socket.latest);
  }
  return new Promise<RoomView>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no matching state")), ms);
    const listener = (raw: unknown) => {
      const room = raw as RoomView;
      if (ok(room)) {
        clearTimeout(timer);
        socket.off("room:state", listener);
        resolve(room);
      }
    };
    socket.on("room:state", listener);
  });
}

const create = (socket: Client, name: string): Promise<Ack> =>
  new Promise((resolve) => socket.emit("lobby:create", { name }, resolve));

const join = (socket: Client, name: string, code: string): Promise<Ack> =>
  new Promise((resolve) => socket.emit("lobby:join", { name, code }, resolve));

describe("leaving a game and coming back to it", () => {
  it("puts you back in your own seat rather than beside it", async () => {
    // Ada, Bram, then Ada again on a second socket.
    const port = await start(["Ada", "Bram", "Ada"]);
    const ada = await client(port);
    const bram = await client(port);

    const opened = await create(ada, "Ada");
    const code = opened.ok ? opened.code : "";
    const seatWas = opened.ok ? opened.seatId : "";
    await join(bram, "Bram", code);
    await stateWhere(ada, (room) => room.seats.length === 2);

    ada.emit("game:action", { type: "start" });
    await stateWhere(bram, (room) => room.status === "playing");

    // Leaving mid-game: the seat is kept, because the turn order is held by
    // index and shuffling it under the other players would be worse.
    ada.emit("lobby:leave");
    await stateWhere(bram, (room) => room.seats.some((seat) => !seat.connected));

    const back = await client(port);
    const rejoined = await join(back, "Ada", code);

    expect(rejoined.ok).toBe(true);
    // The same seat, not a new one beside the old.
    expect(rejoined.ok && rejoined.seatId).toBe(seatWas);

    const room = await stateWhere(back, (view) =>
      view.seats.every((seat) => seat.connected),
    );
    expect(room.seats).toHaveLength(2);
    expect(room.seats.filter((seat) => seat.name === "Ada")).toHaveLength(1);
  });

  it("does not hand somebody else's seat to a different player", async () => {
    const port = await start(["Ada", "Bram", "Cleo"]);
    const ada = await client(port);
    const bram = await client(port);

    const opened = await create(ada, "Ada");
    const code = opened.ok ? opened.code : "";
    await join(bram, "Bram", code);
    await stateWhere(ada, (room) => room.seats.length === 2);

    const cleo = await client(port);
    const joined = await join(cleo, "Cleo", code);

    expect(joined.ok).toBe(true);
    const room = await stateWhere(cleo, (view) => view.seats.length === 3);
    expect(room.seats.map((seat) => seat.name).sort()).toEqual(["Ada", "Bram", "Cleo"]);
  });

  it("seats a guest twice, because a guest cannot be recognised", async () => {
    /*
     * Not a shortcoming so much as the shape of the problem: there is nothing
     * about a second visit from a nameless browser that says it is the same
     * browser. Pinned so the limit is a known one rather than a surprise, and
     * so that signing in visibly buys something.
     */
    const port = await start([null, null]);
    const guest = await client(port);
    const opened = await create(guest, "Wanderer");
    const code = opened.ok ? opened.code : "";
    await stateWhere(guest, (room) => room.seats.length === 1);

    guest.emit("game:action", { type: "start" });
    await stateWhere(guest, (room) => room.status === "playing");
    guest.emit("lobby:leave");

    const again = await client(port);
    await join(again, "Wanderer", code);
    const room = await stateWhere(again, (view) => view.seats.length === 2);
    expect(room.seats).toHaveLength(2);
  });
});

/*
 * A dropped connection arriving after the replacement has already sat down.
 *
 * A browser that blips and comes straight back reclaims its seat on the new
 * connection, and the old connection's disconnect can turn up a long time
 * afterwards — socket.io does not give up on a socket until it has timed out
 * pinging it. Handled unconditionally, that late event marked the seat gone
 * out from under the connection that now owned it.
 *
 * It is a nasty one because the table half-works afterwards. The player shows
 * as dropped out and every hand of theirs is marked done, so the table skips
 * them for good — but betting never asked whether they were connected, so it
 * carried on taking their chips for hands they were never allowed to play.
 */
describe("a stale disconnect from a connection that has been replaced", () => {
  it("does not unseat the player who has already come back", async () => {
    const port = await start(["Ada", "Bram", "Ada"]);
    const ada = await client(port);
    const bram = await client(port);

    const opened = await create(ada, "Ada");
    const code = opened.ok ? opened.code : "";
    const seatWas = opened.ok ? opened.seatId : "";
    await join(bram, "Bram", code);
    await stateWhere(ada, (room) => room.seats.length === 2);

    // Ada comes back on a second connection without the first having dropped
    // yet, which is what a refresh over a flaky line actually looks like.
    const again = await client(port);
    const rejoined = await join(again, "Ada", code);
    expect(rejoined.ok && rejoined.seatId).toBe(seatWas);

    // And only now does the old connection give up.
    ada.close();

    /*
     * Watched from Bram, who is a third party to all of it. A stretch with no
     * disconnection reported is the assertion: the old socket's death must not
     * reach the seat the new one is holding.
     */
    await new Promise((resolve) => setTimeout(resolve, 600));
    const room = await stateWhere(bram, () => true, 2000);
    const hers = room.seats.find((seat) => seat.id === seatWas);
    expect(hers?.connected).toBe(true);
    expect(room.seats).toHaveLength(2);
  });

  it("still marks the seat gone when nobody has taken it over", async () => {
    // The other half of the same rule: a genuine disconnection, with no
    // replacement, must still be noticed. A guard that never fired would make
    // a table full of ghosts.
    const port = await start(["Ada", "Bram"]);
    const ada = await client(port);
    const bram = await client(port);

    const opened = await create(ada, "Ada");
    const code = opened.ok ? opened.code : "";
    await join(bram, "Bram", code);
    await stateWhere(ada, (room) => room.seats.length === 2);

    ada.close();

    const room = await stateWhere(bram, (view) => view.seats.some((seat) => !seat.connected), 3000);
    expect(room.seats.some((seat) => !seat.connected)).toBe(true);
  });
});

