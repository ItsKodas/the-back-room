import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import { FUN_PURSE, capsFor, maxStake } from "@backroom/game-plinko";
import type { ClientToServer, PlinkoDrop, PlinkoFloor, PlinkoResult, PlinkoRisk, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * The board, tested where the money moves.
 *
 * The arithmetic is proven in games/plinko. What is only reachable here is
 * whether this end wires it the right way round: stake into the bank before
 * the path, the win out of the bank, and the two always cancelling.
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
  delete process.env["ADMIN_DISCORD_IDS"];
});

interface Floor {
  base: string;
  store: MemoryStore;
  ids: string[];
  clients: Client[];
}

/**
 * A board with a known bank and some known players at it.
 *
 * Who is asking comes off the handshake's `as`, so two sockets are two people.
 * `draws` is the path source, cycled; absent means the real one.
 */
async function openBoard(
  options: {
    bank?: number;
    chips?: number;
    players?: number;
    signedIn?: boolean;
    draws?: number[];
    store?: MemoryStore;
    admin?: boolean;
  } = {},
): Promise<Floor> {
  const store = options.store ?? new MemoryStore();
  const ids: string[] = [];
  for (let n = 0; n < (options.players ?? 1); n += 1) {
    const player = await store.upsertDiscordUser({
      discordId: `d${n}`,
      name: `P${n}`,
      avatar: null,
      accentColor: null,
    });
    if (options.chips !== undefined) {
      const current = (await store.get(player.id))?.chips ?? 0;
      await store.adjustChips(player.id, options.chips - current);
    }
    ids.push(player.id);
  }
  if (options.bank !== undefined && options.bank > 0) {
    await store.bankAdd("plinko", options.bank);
  }
  if (options.admin === true) {
    process.env["ADMIN_DISCORD_IDS"] = "d0";
  }
  const draws = options.draws;
  let next = 0;
  // An empty `as` is a guest, not an account called "".
  const asking = (request: unknown) =>
    new URL((request as { url?: string }).url ?? "/", "http://here").searchParams.get("as") || null;
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify: (socket) => (options.signedIn === false ? null : asking(socket.request)),
    identifyRequest: () => (options.signedIn === false ? null : (ids[0] ?? null)),
    ...(draws === undefined
      ? {}
      : { plinkoDraw: () => draws[next++ % draws.length] as number }),
  });
  await listenForFetch(server.http);
  const port = (server.http.address() as AddressInfo).port;
  const base = `http://localhost:${port}`;
  const clients = await Promise.all(ids.map((as) => join(base, as)));
  return { base, store, ids, clients };
}

async function join(base: string, as: string): Promise<Client> {
  const socket: Client = connect(base, { transports: ["websocket"], forceNew: true, query: { as } });
  open.push(socket);
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
  return socket;
}

function drop(client: Client, stake: number, risk: PlinkoRisk = "low", forFun = false): Promise<PlinkoResult> {
  return new Promise((resolve) =>
    client.emit("plinko:drop", { stake, risk, ...(forFun ? { forFun: true } : {}) }, resolve),
  );
}

function watch(client: Client): Promise<PlinkoFloor> {
  return new Promise((resolve) => client.emit("plinko:watch", {}, resolve));
}

/** The draw whose path goes right `rights` times: the first `rights` rows right, the rest left. */
function into(rights: number): number {
  return rights === 0 ? 0 : ((1 << rights) - 1) << (12 - rights);
}

describe("a ball", () => {
  it("mints nothing: what the player gains the bank loses, every drop", async () => {
    const draws = Array.from({ length: 13 }, (_, bucket) => into(bucket));
    const { store, ids, clients } = await openBoard({ bank: 5_000_000, chips: 1_000_000, draws });
    const [player] = ids as [string];
    const [client] = clients as [Client];
    const risks: PlinkoRisk[] = ["low", "medium", "high"];
    for (let n = 0; n < 39; n += 1) {
      const chipsBefore = (await store.get(player))?.chips ?? 0;
      const bankBefore = await store.bank("plinko");
      const result = await drop(client, 10 * (1 + (n % 5)), risks[n % 3]);
      expect(result.ok).toBe(true);
      const chipsAfter = (await store.get(player))?.chips ?? 0;
      const bankAfter = await store.bank("plinko");
      expect(chipsAfter - chipsBefore + (bankAfter - bankBefore), `drop ${n}`).toBe(0);
    }
  });

  it("pays the table's multiplier for the bucket it lands in", async () => {
    const { clients } = await openBoard({ bank: 1_000_000, chips: 10_000, draws: [into(0)] });
    const result = await drop(clients[0] as Client, 50, "high");
    expect(result).toMatchObject({ ok: true, bucket: 0, mult: 1700, won: 8500, stake: 50, risk: "high" });
  });

  it("answers with the balance, the bank and what the bank now covers", async () => {
    const { store, ids, clients } = await openBoard({ bank: 50_000, chips: 1_000, draws: [into(6)] });
    const result = await drop(clients[0] as Client, 100, "low");
    if (!result.ok) throw new Error(result.error);
    expect(result.balance).toBe((await store.get(ids[0] as string))?.chips);
    expect(result.bank).toBe(await store.bank("plinko"));
    expect(result.caps).toEqual(capsFor(result.bank));
  });

  it("is refused over the cap, with nothing moved", async () => {
    const { store, ids, clients } = await openBoard({ bank: 50_000, chips: 100_000 });
    const over = maxStake(50_000, "high") + 10;
    const result = await drop(clients[0] as Client, over, "high");
    expect(result.ok).toBe(false);
    expect(await store.bank("plinko")).toBe(50_000);
    expect((await store.get(ids[0] as string))?.chips).toBe(100_000);
  });

  it("says so when the bank is empty", async () => {
    const { clients } = await openBoard({ bank: 0, chips: 100 });
    const result = await drop(clients[0] as Client, 10);
    expect(result).toEqual({ ok: false, error: "The bank is empty. Nothing to play for yet." });
  });

  it("refuses a stake that is not in tens", async () => {
    const { clients } = await openBoard({ bank: 50_000, chips: 100 });
    expect((await drop(clients[0] as Client, 15)).ok).toBe(false);
  });

  it("refuses chips to somebody not signed in", async () => {
    const { store, base } = await openBoard({ bank: 50_000, players: 0 });
    const guest = await join(base, "");
    expect(await drop(guest, 10)).toEqual({ ok: false, error: "Sign in to play for chips." });
    expect(await store.bank("plinko")).toBe(50_000);
  });

  it("refuses a stake the player has not got", async () => {
    const { clients, store } = await openBoard({ bank: 50_000, chips: 5 });
    expect(await drop(clients[0] as Client, 10)).toEqual({ ok: false, error: "Not enough chips." });
    expect(await store.bank("plinko")).toBe(50_000);
  });

  it("does not take its randomness from Math.random", async () => {
    // Every result hands the player its whole path — exactly the run of
    // observations that recovers xorshift128+. Pinned, the paths must still move.
    const real = Math.random;
    Math.random = () => 0.5;
    try {
      const { clients } = await openBoard({ bank: 5_000_000, chips: 100_000 });
      const paths = new Set<string>();
      for (let n = 0; n < 12; n += 1) {
        const result = await drop(clients[0] as Client, 10);
        if (result.ok) paths.add(result.path.join(""));
      }
      expect(paths.size).toBeGreaterThan(1);
    } finally {
      Math.random = real;
    }
  });

  it("keeps a count of what the player has done at it", async () => {
    const { clients, store, ids } = await openBoard({ bank: 1_000_000, chips: 10_000, draws: [into(0)] });
    await drop(clients[0] as Client, 10, "high");
    await drop(clients[0] as Client, 20, "high");
    const stats = (await store.get(ids[0] as string))?.byGame["plinko"];
    expect(stats?.["drops"]).toBe(2);
    expect(stats?.["staked"]).toBe(30);
    expect(stats?.["bestDrop"]).toBe(3400);
  });
});

describe("balls in the air", () => {
  it("refuses the eleventh while ten are waiting", async () => {
    /*
     * A store whose bank read can be held, so ten drops queue behind the first
     * inside the ledger. The eleventh must be refused at once rather than
     * joining a queue somebody could grow faster than it clears.
     */
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class Held extends MemoryStore {
      held = true;
      override async bank(which: Parameters<MemoryStore["bank"]>[0]): Promise<number> {
        if (which === "plinko" && this.held) await gate;
        return super.bank(which);
      }
    }
    const store = new Held();
    store.held = false;
    const { clients } = await openBoard({ store, bank: 5_000_000, chips: 100_000, draws: [into(6)] });
    store.held = true;
    const client = clients[0] as Client;
    const first = Array.from({ length: 10 }, () => drop(client, 10));
    // Let the ten reach the server before the eleventh.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const eleventh = await drop(client, 10);
    expect(eleventh).toEqual({ ok: false, error: "Too many balls in the air." });
    store.held = false;
    release();
    const results = await Promise.all(first);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it("settles two players dropping at once, both paid, bank never below zero", async () => {
    const bank = 169 * 100;
    const { store, clients } = await openBoard({ bank, chips: 1_000_000, players: 2, draws: [into(0)] });
    const cap = maxStake(bank, "high");
    const results = await Promise.all(clients.map((client) => drop(client, cap, "high")));
    expect(results.some((result) => result.ok)).toBe(true);
    for (const result of results) {
      expect(result.ok ? "paid" : result.error).not.toMatch(/short/);
    }
    expect(await store.bank("plinko")).toBeGreaterThanOrEqual(0);
  });
});

describe("the floor", () => {
  it("tells everybody else about a paid ball, and not the one who dropped it", async () => {
    const { clients } = await openBoard({ bank: 1_000_000, chips: 10_000, players: 2, draws: [into(3)] });
    const [dropper, watcher] = clients as [Client, Client];
    await watch(dropper);
    await watch(watcher);
    const selfHeard: PlinkoDrop[] = [];
    dropper.on("plinko:dropped", (news) => selfHeard.push(news));
    // The watcher's first news is the proof this landed; a round trip on the
    // dropper afterwards proves it heard nothing, without a fixed sleep.
    const heardOne = new Promise<PlinkoDrop>((resolve) => watcher.once("plinko:dropped", resolve));
    await drop(dropper, 10, "medium");
    const news = await heardOne;
    expect(news).toMatchObject({ by: { name: "P0" }, risk: "medium", bucket: 3, stake: 10 });
    await watch(dropper);
    expect(selfHeard).toHaveLength(0);
  });

  it("never tells anybody about a ball played for nothing", async () => {
    const { clients, store, ids } = await openBoard({ bank: 1_000_000, chips: 10_000, players: 2 });
    const [dropper, watcher] = clients as [Client, Client];
    await watch(watcher);
    const heard: PlinkoDrop[] = [];
    watcher.on("plinko:dropped", (news) => heard.push(news));
    const result = await drop(dropper, 100, "low", true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.ok).toBe(true);
    expect(heard).toHaveLength(0);
    expect(await store.bank("plinko")).toBe(1_000_000);
    expect((await store.get(ids[0] as string))?.chips).toBe(10_000);
  });

  it("gives somebody walking up the recent drops, who is here, and the bank", async () => {
    const { clients } = await openBoard({ bank: 1_000_000, chips: 10_000, players: 2, draws: [into(6)] });
    const [first, second] = clients as [Client, Client];
    await watch(first);
    await drop(first, 10);
    const floor = await watch(second);
    expect(floor.recent).toHaveLength(1);
    expect(floor.here.map((one) => one.name).sort()).toEqual(["P0", "P1"]);
    expect(floor.caps).toEqual(capsFor(floor.bank));
  });

  it("tells the floor when somebody leaves", async () => {
    const { clients } = await openBoard({ bank: 1_000, players: 2 });
    const [stays, goes] = clients as [Client, Client];
    await watch(stays);
    await watch(goes);
    const seen = new Promise<string[]>((resolve) =>
      stays.on("plinko:here", (here) => {
        if (here.length === 1) resolve(here.map((one) => one.name));
      }),
    );
    goes.close();
    expect(await seen).toEqual(["P0"]);
  });
});

describe("play money", () => {
  it("plays for nothing, signed in or not", async () => {
    const { base } = await openBoard({ players: 0, signedIn: false });
    const guest = await join(base, "");
    const result = await drop(guest, 100, "high", true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.balance).toBe(FUN_PURSE - 100 + result.won);
  });
});

describe("stocking the bank", () => {
  it("lets an admin float the Plinko bank and no other", async () => {
    const { base, store } = await openBoard({ admin: true });
    const response = await fetch(`${base}/api/admin/bank`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 50_000, game: "plinko" }),
    });
    expect(response.status).toBe(200);
    expect(await store.bank("plinko")).toBe(50_000);
    expect(await store.bank("slots")).toBe(0);
  });

  it("puts up a sign anybody can read", async () => {
    const { base } = await openBoard({ bank: 50_000, players: 0 });
    const sign = (await (await fetch(`${base}/api/plinko`)).json()) as unknown;
    expect(sign).toEqual({ bank: 50_000, caps: { low: 7140, medium: 1560, high: 290 } });
  });
});
