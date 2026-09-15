import type { AddressInfo } from "node:net";
import type { Die } from "@backroom/rules";
import type { Ack, ClientToServer, RoomView, ServerToClient } from "@backroom/shared";
import { io as connect } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createBackRoomServer } from "./server.js";
import type { BackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";
import { MemoryStore, STARTING_CHIPS } from "@backroom/economy";

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

describe("playing for chips", () => {
  /** Everyone signs in; the fake identity is per-socket so seats differ. */
  async function startTable(options: {
    identities: Record<string, string | null>;
    roll?: () => Die[];
  }): Promise<{ store: MemoryStore; port: number }> {
    const store = new MemoryStore();
    let seen = 0;
    const order = Object.values(options.identities);
    server = createBackRoomServer({
      store,
      auth: null,
      serveClient: false,
      botDelayMs: 5,
      farklePauseMs: 20,
      roll: options.roll,
      // Hand out identities in connection order.
      identify: () => {
        const id = order[seen] ?? null;
        seen += 1;
        return id;
      },
    });
    await listenForFetch(server.http);
    return { store, port: (server.http.address() as AddressInfo).port };
  }

  function client(port: number): Promise<Client> {
    return new Promise((resolve) => {
      const socket: Client = connect(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      open.push(socket);
      socket.on("room:state", (state) => {
        socket.latest = state;
      });
      socket.on("connect", () => resolve(socket));
    });
  }

  function stateWhere(socket: Client, ok: (state: RoomView) => boolean, ms = 2500) {
    if (socket.latest !== undefined && ok(socket.latest)) {
      return Promise.resolve(socket.latest);
    }
    return new Promise<RoomView>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no matching state")), ms);
      const listener = (state: RoomView) => {
        if (ok(state)) {
          clearTimeout(timer);
          socket.off("room:state", listener);
          resolve(state);
        }
      };
      socket.on("room:state", listener);
    });
  }

  function create(socket: Client, name: string): Promise<Ack> {
    return new Promise((resolve) => socket.emit("lobby:create", { name }, resolve));
  }

  function nextError(socket: Client): Promise<string> {
    return new Promise((resolve) => socket.once("room:error", resolve));
  }

  it("refuses a stake at a table with a guest in it", async () => {
    const { store, port } = await startTable({ identities: { a: null } });
    const person = await store.upsertDiscordUser({
      discordId: "d1",
      name: "Ada",
      avatar: null,
      accentColor: null,
    });
    expect(person.chips).toBe(STARTING_CHIPS);

    const host = await client(port);
    await create(host, "Ada"); // identified as a guest
    const complaint = nextError(host);
    host.emit("lobby:setBuyIn", { amount: 500 });
    expect(await complaint).toMatch(/signed in/i);
  });

  it("refuses a bot at a table playing for chips", async () => {
    const store = new MemoryStore();
    const person = await store.upsertDiscordUser({
      discordId: "d1",
      name: "Ada",
      avatar: null,
      accentColor: null,
    });
    const { port } = await startTable({ identities: { a: person.id } });

    const host = await client(port);
    await create(host, "Ada");
    host.emit("lobby:setBuyIn", { amount: 500 });
    await stateWhere(host, (view) => view.buyIn === 500);

    const complaint = nextError(host);
    host.emit("lobby:addBot", { skill: "normal" });
    expect(await complaint).toMatch(/free/i);
  });

  it("takes the stake at the deal and pays the pot to the winner", async () => {
    const store = new MemoryStore();
    const ada = await store.upsertDiscordUser({
      discordId: "d1",
      name: "Ada",
      avatar: null,
      accentColor: null,
    });
    // Six 1s every roll: 8,000 in one turn, so Ada wins at once.
    server = createBackRoomServer({
      store,
      auth: null,
      serveClient: false,
      farklePauseMs: 20,
      roll: () => [1, 1, 1, 1, 1, 1] as Die[],
      identify: () => ada.id,
    });
    await listenForFetch(server.http);
    const port = (server.http.address() as AddressInfo).port;

    const host = await client(port);
    await create(host, "Ada");
    host.emit("lobby:setBuyIn", { amount: 500 });
    await stateWhere(host, (view) => view.buyIn === 500);
    host.emit("lobby:setRules", { targetScore: 2000 });
    await stateWhere(host, (view) => view.ruleset.targetScore === 2000);

    host.emit("game:action", { type: "start" });
    await stateWhere(host, (view) => view.status === "playing");
    // The stake is gone the moment the game is dealt.
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS - 500);

    host.emit("game:action", { type: "roll" });
    await stateWhere(host, (view) => (view.turn?.dice.length ?? 0) === 6);
    for (let index = 0; index < 6; index += 1) {
      host.emit("game:action", { type: "toggle", index });
    }
    await stateWhere(host, (view) => (view.turn?.selection ?? 0) > 0);
    host.emit("game:action", { type: "bank" });
    await stateWhere(host, (view) => view.status === "over");

    // Solo table, so the pot is their own stake coming back.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS);
    const games = await store.recentGames(ada.id, 5);
    expect(games).toHaveLength(1);
    expect(games[0]?.buyIn).toBe(500);
  });

  it("will not deal when a player cannot cover the stake", async () => {
    const store = new MemoryStore();
    const ada = await store.upsertDiscordUser({
      discordId: "d1",
      name: "Ada",
      avatar: null,
      accentColor: null,
    });
    await store.adjustChips(ada.id, -(STARTING_CHIPS - 10));
    server = createBackRoomServer({
      store,
      auth: null,
      serveClient: false,
      identify: () => ada.id,
    });
    await listenForFetch(server.http);
    const port = (server.http.address() as AddressInfo).port;

    const host = await client(port);
    await create(host, "Ada");
    host.emit("lobby:setBuyIn", { amount: 500 });
    await stateWhere(host, (view) => view.buyIn === 500);

    const complaint = nextError(host);
    host.emit("game:action", { type: "start" });
    expect(await complaint).toMatch(/cannot cover/i);
    // And the balance is untouched, not partly taken.
    expect((await store.get(ada.id))?.chips).toBe(10);
  });
});

describe("who a seat belongs to", () => {
  /** A table where the only connection is signed in as `profileName`. */
  async function tableAs(
    profileName: string | null,
    look: { avatar: string | null; accentColor: number | null } = {
      avatar: null,
      accentColor: null,
    },
  ) {
    const store = new MemoryStore();
    let userId: string | null = null;
    if (profileName !== null) {
      const person = await store.upsertDiscordUser({
        discordId: "d1",
        name: profileName,
        avatar: look.avatar,
        accentColor: look.accentColor,
      });
      userId = person.id;
    }
    server = createBackRoomServer({
      store,
      auth: null,
      serveClient: false,
      identify: () => userId,
    });
    await listenForFetch(server.http);
    return (server.http.address() as AddressInfo).port;
  }

  /**
   * A table with several real accounts, handed out in connection order.
   *
   * Needed because one account can no longer hold two seats at one table —
   * joining a table you already sit at returns you to your seat — so a test
   * that wants two players needs two people.
   */
  async function tableWithPeople(names: string[], options: { roll?: () => Die[] } = {}) {
    const store = new MemoryStore();
    const ids: string[] = [];
    for (const name of names) {
      const person = await store.upsertDiscordUser({
        discordId: `discord-${name}`,
        name,
        avatar: null,
        accentColor: null,
      });
      ids.push(person.id);
    }
    let seen = 0;
    server = createBackRoomServer({
      store,
      auth: null,
      serveClient: false,
      farklePauseMs: 20,
      ...(options.roll === undefined ? {} : { roll: options.roll }),
      identify: () => ids[seen++] ?? null,
    });
    await listenForFetch(server.http);
    return { store, ids, port: (server.http.address() as AddressInfo).port };
  }

  function client(port: number): Promise<Client> {
    return new Promise((resolve) => {
      const socket: Client = connect(`http://localhost:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      open.push(socket);
      socket.on("room:state", (state) => {
        socket.latest = state;
      });
      socket.on("connect", () => resolve(socket));
    });
  }

  function stateWhere(socket: Client, ok: (state: RoomView) => boolean, ms = 2500) {
    if (socket.latest !== undefined && ok(socket.latest)) {
      return Promise.resolve(socket.latest);
    }
    return new Promise<RoomView>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no matching state")), ms);
      const listener = (state: RoomView) => {
        if (ok(state)) {
          clearTimeout(timer);
          socket.off("room:state", listener);
          resolve(state);
        }
      };
      socket.on("room:state", listener);
    });
  }

  it("seats a signed-in player under their profile name, not one they sent", async () => {
    const port = await tableAs("Ada");
    const host = await client(port);
    // The client claims to be someone else entirely.
    await new Promise((resolve) => host.emit("lobby:create", { name: "Not Ada" }, resolve));
    const view = await stateWhere(host, (state) => state.seats.length === 1);
    expect(view.seats[0]?.name).toBe("Ada");
  });

  it("does the same when joining an existing table", async () => {
    const { port } = await tableWithPeople(["Ada", "Bram"]);
    const host = await client(port);
    const created = await new Promise<Ack>((resolve) =>
      host.emit("lobby:create", { name: "Ada" }, resolve),
    );
    const code = created.ok ? created.code : "";

    const other = await client(port);
    // Whatever the client types, the seat is named by the account behind it.
    await new Promise((resolve) => other.emit("lobby:join", { name: "Impostor", code }, resolve));
    const view = await stateWhere(other, (state) => state.seats.length === 2);
    expect(view.seats.map((seat) => seat.name)).toEqual(["Ada", "Bram"]);
  });

  it("lets a guest keep the name they typed", async () => {
    const port = await tableAs(null);
    const host = await client(port);
    await new Promise((resolve) => host.emit("lobby:create", { name: "Whoever" }, resolve));
    const view = await stateWhere(host, (state) => state.seats.length === 1);
    expect(view.seats[0]?.name).toBe("Whoever");
  });

  it("carries a signed-in player's picture and colour to the table", async () => {
    const port = await tableAs("Ada", {
      avatar: "https://cdn.discordapp.com/avatars/1/abc.png?size=128",
      accentColor: 0x5865f2,
    });
    const host = await client(port);
    await new Promise((resolve) => host.emit("lobby:create", { name: "Ada" }, resolve));
    const view = await stateWhere(host, (state) => state.seats.length === 1);
    expect(view.seats[0]?.avatar).toContain("cdn.discordapp.com");
    expect(view.seats[0]?.accentColor).toBe(0x5865f2);
  });

  it("gives a guest neither", async () => {
    const port = await tableAs(null);
    const host = await client(port);
    await new Promise((resolve) => host.emit("lobby:create", { name: "Whoever" }, resolve));
    const view = await stateWhere(host, (state) => state.seats.length === 1);
    expect(view.seats[0]?.avatar).toBeNull();
    expect(view.seats[0]?.accentColor).toBeNull();
  });

  it("does not charge or credit someone who arrived mid-game", async () => {
    const { store, ids, port } = await tableWithPeople(["Ada", "Cy"], {
      roll: () => [1, 1, 1, 1, 1, 1] as Die[],
    });
    const ada = { id: ids[0] as string };
    const cy = ids[1] as string;

    const host = await client(port);
    const created = await new Promise<Ack>((resolve) =>
      host.emit("lobby:create", { name: "Ada" }, resolve),
    );
    const code = created.ok ? created.code : "";
    host.emit("lobby:setBuyIn", { amount: 500 });
    await stateWhere(host, (view) => view.buyIn === 500);
    host.emit("lobby:setRules", { targetScore: 2000 });
    await stateWhere(host, (view) => view.ruleset.targetScore === 2000);

    host.emit("game:action", { type: "start" });
    await stateWhere(host, (view) => view.status === "playing");
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS - 500);

    // Somebody wanders in after the deal.
    const late = await client(port);
    await new Promise((resolve) => late.emit("lobby:join", { name: "Cy", code }, resolve));
    const seated = await stateWhere(host, (view) => view.seats.length === 2);
    expect(seated.seats[1]?.waiting).toBe(true);
    // Their stake was never taken, because they are not in this game.
    expect((await store.get(cy))?.chips).toBe(STARTING_CHIPS);
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS - 500);

    host.emit("game:action", { type: "roll" });
    await stateWhere(host, (view) => (view.turn?.dice.length ?? 0) === 6);
    for (let index = 0; index < 6; index += 1) {
      host.emit("game:action", { type: "toggle", index });
    }
    await stateWhere(host, (view) => (view.turn?.selection ?? 0) > 0);
    host.emit("game:action", { type: "bank" });
    const over = await stateWhere(host, (view) => view.status === "over");

    // The latecomer is not among the winners of a game they never played.
    expect(over.winnerIds).not.toContain(seated.seats[1]?.id);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const games = await store.recentGames(ada.id, 5);
    expect(games[0]?.players.map((player) => player.name)).toEqual(["Ada"]);
  });
});
