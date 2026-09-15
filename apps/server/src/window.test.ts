import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import type { ClientToServer, ServerToClient } from "@backroom/shared";
import { io as connect } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createBackRoomServer } from "./server.js";
import type { BackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * One window per game, per account.
 *
 * Only checkable across separate sockets carrying the same identity — which is
 * exactly what a second tab, a second browser and a second device all look
 * like from here. The window id is what tells those apart from a refresh.
 */

type Client = Socket<ServerToClient, ClientToServer>;

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
    identify: () => {
      const id = ids[seen] ?? null;
      seen += 1;
      return id;
    },
  });
  await listenForFetch(server.http);
  return (server.http.address() as AddressInfo).port;
}

/**
 * Connects and reports which way it went.
 *
 * Both outcomes are wanted, so neither rejects: a refusal is the result under
 * test as much as an arrival is.
 */
function arrive(
  port: number,
  auth: { game?: string; window?: string },
): Promise<{ ok: true; socket: Client } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const socket: Client = connect(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      auth,
    });
    open.push(socket);
    socket.on("connect", () => resolve({ ok: true, socket }));
    socket.on("connect_error", (error: Error) =>
      resolve({ ok: false, error: error.message }),
    );
  });
}

describe("one window per game", () => {
  it("turns away a second window on the same game", async () => {
    const port = await start(["Ada", "Ada"]);
    const first = await arrive(port, { game: "slots", window: "w1" });
    expect(first.ok).toBe(true);

    const second = await arrive(port, { game: "slots", window: "w2" });
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error).toBe(
      "You already have Slots open in another window.",
    );
  });

  it("lets the same window back in, which is what a refresh is", async () => {
    /*
     * The test that matters most. Without it the rule is first-wins against
     * the player's own refresh, and a socket that died on a train holds their
     * machine shut for the length of socket.io's ping timeout.
     */
    const port = await start(["Ada", "Ada"]);
    const first = await arrive(port, { game: "blackjack", window: "w1" });
    expect(first.ok).toBe(true);

    const again = await arrive(port, { game: "blackjack", window: "w1" });
    expect(again.ok).toBe(true);
  });

  it("lets one person play two different games at once", async () => {
    const port = await start(["Ada", "Ada"]);
    expect((await arrive(port, { game: "slots", window: "w1" })).ok).toBe(true);
    expect((await arrive(port, { game: "blackjack", window: "w2" })).ok).toBe(true);
  });

  it("does not keep one player out of another player's game", async () => {
    const port = await start(["Ada", "Bram"]);
    expect((await arrive(port, { game: "slots", window: "w1" })).ok).toBe(true);
    expect((await arrive(port, { game: "slots", window: "w2" })).ok).toBe(true);
  });

  it("never turns a guest away, having nothing to key one on", async () => {
    /*
     * The same limit `reclaimable` already lives with: there is nothing about
     * a second visit from a nameless browser that says it is the same browser.
     * Pinned so it is a known limit rather than a surprise.
     */
    const port = await start([null, null]);
    expect((await arrive(port, { game: "slots", window: "w1" })).ok).toBe(true);
    expect((await arrive(port, { game: "slots", window: "w2" })).ok).toBe(true);
  });

  it("lets a socket that names no game through", async () => {
    // Every existing client is one of these, and none of them may break.
    const port = await start(["Ada", "Ada"]);
    expect((await arrive(port, {})).ok).toBe(true);
    expect((await arrive(port, {})).ok).toBe(true);
  });

  it("frees the game when the window holding it closes", async () => {
    const port = await start(["Ada", "Ada"]);
    const first = await arrive(port, { game: "slots", window: "w1" });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    first.socket.close();
    // Long enough for the server to see the close, short enough that it is not
    // secretly waiting out a ping timeout — which would mean the release is
    // not the thing under test.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const second = await arrive(port, { game: "slots", window: "w2" });
    expect(second.ok).toBe(true);
  });

  it("still refuses a second window whose window id fails its own schema", async () => {
    /*
     * `window: ""` fails the shared schema's `min(1)` on its own. A `safeParse`
     * over the whole handshake object would then discard `game` as well and
     * let the socket straight through unclaimed — one bad field is not
     * license to skip the rule for a socket that otherwise declared a valid
     * game.
     */
    const port = await start(["Ada", "Ada"]);
    const first = await arrive(port, { game: "slots", window: "w1" });
    expect(first.ok).toBe(true);

    const second = await arrive(port, { game: "slots", window: "" });
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error).toBe(
      "You already have Slots open in another window.",
    );
  });

  it("does not let a refused window release the one that holds it", async () => {
    const port = await start(["Ada", "Ada", "Ada"]);
    const first = await arrive(port, { game: "slots", window: "w1" });
    expect(first.ok).toBe(true);

    const refused = await arrive(port, { game: "slots", window: "w2" });
    expect(refused.ok).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // The holder is still the holder. A refusal that released the claim on its
    // way out would make the rule self-clearing and useless.
    const third = await arrive(port, { game: "slots", window: "w3" });
    expect(third.ok).toBe(false);
  });
});
