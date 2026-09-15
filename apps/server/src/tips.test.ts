import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import { BASE } from "@backroom/game-tips";
import type { ClientToServer, JarView, ServerToClient, TapResult } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * The jar, tested where the money actually moves.
 *
 * The arithmetic — the trickle, the guard, the rhythm check — is proven in
 * games/tips and needs no server. What is only reachable here is whether this
 * end wires it up the right way round: that a tap cannot credit an account
 * without a real token, that a lost race pays nobody twice, and that the
 * whole assembly still cannot outrun the trickle however fast it is driven.
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

interface AtTheJar {
  store: MemoryStore;
  userId: string;
  socket: Client;
  jar: JarView;
}

/**
 * A jar with a known player standing at it.
 *
 * `signedIn: false` says nobody is signed in, which is how a test asks for a
 * guest without standing up a real sign-in.
 */
async function standAtTheJar(options: { signedIn?: boolean } = {}): Promise<AtTheJar> {
  const store = new MemoryStore();
  const player = await store.upsertDiscordUser({
    discordId: "d1",
    name: "Ada",
    avatar: null,
    accentColor: null,
  });

  const as = options.signedIn === false ? null : player.id;
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify: () => as,
    identifyRequest: () => as,
  });
  await listenForFetch(server.http);
  const port = (server.http.address() as AddressInfo).port;

  const socket: Client = connect(`http://localhost:${port}`, {
    transports: ["websocket"],
    forceNew: true,
  });
  open.push(socket);
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));

  const jar = await new Promise<JarView>((resolve) => socket.emit("tips:open", {}, resolve));

  return { store, userId: player.id, socket, jar };
}

function tapWith(socket: Client, token: string): Promise<TapResult> {
  return new Promise((resolve) => socket.emit("tips:tap", { token }, resolve));
}

function buyWith(socket: Client, token: string, upgrade: string): Promise<TapResult> {
  return new Promise((resolve) => socket.emit("tips:buy", { upgrade, token }, resolve));
}

/**
 * Puts chips straight into a jar for a test, bypassing the trickle.
 *
 * Reads the jar's current token off the store and swaps a full one in under
 * it, exactly the way the server itself would — there is no back door here
 * that the real flow does not also use.
 */
async function fillJar(store: MemoryStore, userId: string, level: number): Promise<void> {
  const held = await store.jar(userId);
  if (held === null) {
    throw new Error("no such jar");
  }
  await store.applyJar(userId, held.jar.token, { ...held.jar, level }, 0);
}

describe("the jar over a socket", () => {
  it("refuses a guest, because there is no account to credit", async () => {
    const { socket } = await standAtTheJar({ signedIn: false });
    const result = await tapWith(socket, "anything");
    expect(result.ok).toBe(false);
  });

  it("opens with a jar and a token", async () => {
    const { jar } = await standAtTheJar({ signedIn: true });
    expect(jar.token).not.toBe("");
    expect(jar.brim).toBe(BASE.brim);
    expect(jar.trickle).toBe(BASE.trickle);
  });

  it("pays chips into the account and says so on me:chips", async () => {
    const { socket, jar, userId, store } = await standAtTheJar({ signedIn: true });
    await fillJar(store, userId, BASE.brim);
    const told = new Promise<number>((resolve) => socket.once("me:chips", resolve));
    const result = await tapWith(socket, jar.token);
    expect(result.ok).toBe(true);
    expect(result.ok && result.paid).toBe(BASE.scoop);
    expect(await told).toBe(result.ok ? result.balance : -1);
  });

  it("refuses a stale token and hands back a usable one", async () => {
    const { socket, userId, store } = await standAtTheJar({ signedIn: true });
    await fillJar(store, userId, BASE.brim);
    const stale = await tapWith(socket, "definitely-not-it");
    expect(stale.ok).toBe(false);
    expect(stale.jar.token).not.toBe("");
    // The one it handed back works, which is what stops a client wedging.
    const recovered = await tapWith(socket, stale.jar.token);
    expect(recovered.ok).toBe(true);
  });

  it("refuses an upgrade the player cannot afford, and charges nothing", async () => {
    const { socket, jar } = await standAtTheJar({ signedIn: true });
    const result = await buyWith(socket, jar.token, "glass");
    expect(result.ok).toBe(false);
    expect(result.jar.favours).toBe(0);
    expect(result.jar.bought).toEqual([]);
  });

  /**
   * The end-to-end statement of the whole design.
   *
   * Tap as fast as the server will accept, several hundred times, and the
   * account cannot gain more than the jar could hold. Real elapsed time in a
   * test is a fraction of a second, so the only thing gainable is what was
   * already in the jar when it started — every other test here checks a rule,
   * this one checks that the rules together do the thing the game exists to
   * do.
   */
  it("cannot be made to pay faster than the trickle", async () => {
    const { socket, jar, userId, store } = await standAtTheJar({ signedIn: true });
    await fillJar(store, userId, BASE.brim);
    const before = (await store.get(userId))?.chips ?? 0;
    let token = jar.token;
    const start = Date.now();
    for (let i = 0; i < 400; i++) {
      const result = await tapWith(socket, token);
      token = result.jar.token;
    }
    const elapsed = Date.now() - start;
    const after = (await store.get(userId))?.chips ?? 0;
    // BASE.brim alone is not the true ceiling: 400 round trips take real
    // wall-clock time (draining the brim needs ~60 accepted taps at
    // TAP_FLOOR_MS=50 apiece, already a couple of seconds, more on a loaded
    // runner), and the jar keeps trickling the whole time this loop runs. The
    // bound has to grow with that elapsed time the same way the jar does, or
    // this assertion flakes under load instead of actually proving the cap —
    // do not replace it with a tidy constant.
    const ceiling = BASE.brim + (BASE.trickle * elapsed) / 60_000;
    expect(after - before).toBeLessThanOrEqual(ceiling);
  });
});
