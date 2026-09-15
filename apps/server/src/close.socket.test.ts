import { MemoryStore } from "@backroom/economy";
import type { Ack, ClientToServer, ServerToClient, TableClosed } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * A table going away with chips on it, driven through the real socket layer.
 *
 * The refunds themselves are proven in each game. What only this can show is
 * the room doing its part: finding the table empty, calling it off rather
 * than dropping it, and telling whoever is still looking.
 */

type Client = Socket<ServerToClient, ClientToServer>;

const RED = "even:1-3-5-7-9-12-14-16-18-19-21-23-25-27-30-32-34-36";
const BANK = 100_000;

let server: BackRoomServer | null = null;
const open: Client[] = [];
/** Every held store call, so a failed test cannot leave the server's close waiting on one. */
const held: Array<() => void> = [];

afterEach(async () => {
  for (const release of held.splice(0)) {
    release();
  }
  for (const socket of open.splice(0)) {
    socket.close();
  }
  if (server !== null) {
    await server.close();
    server = null;
  }
  delete process.env["ADMIN_DISCORD_IDS"];
});

/**
 * A store whose chip movements can be held open one at a time.
 *
 * MemoryStore answers inside the same tick, so every window in which a close
 * and a stake overlap is closed before anything can land in it. A real store
 * across a network holds that window open for as long as the round trip, and
 * this is how a test gets to stand in it.
 */
function gated(store: MemoryStore) {
  const waiting: Array<{
    match: (userId: string, amount: number) => boolean;
    reached: () => void;
    wait: Promise<void>;
  }> = [];
  const proxy = new Proxy(store, {
    get(target, key: string | symbol) {
      const value = Reflect.get(target, key) as unknown;
      if (typeof value !== "function") {
        return value;
      }
      const call = value.bind(target) as (...args: unknown[]) => unknown;
      if (key !== "adjustChips") {
        return call;
      }
      return async (userId: string, amount: number) => {
        const index = waiting.findIndex((one) => one.match(userId, amount));
        if (index >= 0) {
          const [one] = waiting.splice(index, 1);
          one?.reached();
          await one?.wait;
        }
        return call(userId, amount);
      };
    },
  }) as MemoryStore;

  /** Holds the next take (-1) or give (+1) on this account until released. */
  const hold = (userId: string, direction: 1 | -1) => {
    let reached = () => {};
    let release = () => {};
    const arrived = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    waiting.push({
      match: (who, amount) => who === userId && Math.sign(amount) === direction,
      reached,
      wait,
    });
    held.push(release);
    return { arrived, release };
  };
  return { proxy, hold };
}

async function start(timings: { reconnectGraceMs: number; emptyRoomTtlMs: number }) {
  const store = new MemoryStore();
  const ada = await store.upsertDiscordUser({
    discordId: "d1",
    name: "Ada",
    avatar: null,
    accentColor: null,
  });
  const bo = await store.upsertDiscordUser({
    discordId: "d2",
    name: "Bo",
    avatar: null,
    accentColor: null,
  });
  await store.bankAdd("roulette", BANK);
  await store.bankAdd("blackjack", BANK);
  const { proxy, hold } = gated(store);

  const ids = [ada.id, bo.id];
  let seen = 0;
  // Ada, so the admin desk will answer her; read when the server starts.
  process.env["ADMIN_DISCORD_IDS"] = "d1";
  server = createBackRoomServer({
    store: proxy,
    auth: null,
    serveClient: false,
    // Connection order, as the other socket tests do it: Ada first, then Bo.
    identify: () => {
      const id = ids[seen] ?? null;
      seen += 1;
      return id;
    },
    identifyRequest: () => ada.id,
    ...timings,
  });
  // A port fetch will talk to, because the admin desk is reached over HTTP.
  const port = await listenForFetch(server.http);

  const client = async (): Promise<Client> => {
    const socket = connect(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    }) as Client;
    open.push(socket);
    await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
    return socket;
  };
  // Read through the real store, so a held call never holds up an assertion.
  const chipsOf = async (id: string) => (await store.get(id))?.chips ?? -1;
  return { store, ada, bo, client, hold, chipsOf, port };
}

const until = async (check: () => Promise<boolean> | boolean, ms = 3_000) => {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error("timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const openTable = (socket: Client, game: string) =>
  new Promise<string>((resolve) =>
    socket.emit("lobby:create", { name: "Ada", game, forFun: false }, (ack) =>
      resolve(ack.ok ? ack.code : ""),
    ),
  );

const act = (socket: Client, action: Record<string, unknown>) =>
  new Promise<void>((resolve) => socket.emit("game:action", action, () => resolve()));

const watch = (socket: Client, code: string) =>
  new Promise<void>((resolve) => socket.emit("lobby:watch", { code }, () => resolve()));

/** A roulette table with Ada's 200 on red, taken and on the cloth. */
async function stakedWheel(timings: { reconnectGraceMs: number; emptyRoomTtlMs: number }) {
  const started = await start(timings);
  const before = await started.chipsOf(started.ada.id);
  const player = await started.client();
  const code = await openTable(player, "roulette");
  await act(player, { type: "place", spotId: RED, chips: 200 });
  await until(async () => (await started.chipsOf(started.ada.id)) === before - 200);
  return { ...started, before, player, code };
}

describe("a table nobody is sitting at any more", () => {
  it("gives the chips on its cloth back before it is cleared away, and says so", async () => {
    const { store, ada, client, chipsOf, before, player, code } = await stakedWheel({
      reconnectGraceMs: 60_000,
      emptyRoomTtlMs: 150,
    });

    const watcher = await client();
    await watch(watcher, code);
    const closed = new Promise<TableClosed>((resolve) => watcher.on("room:closed", resolve));

    player.close();

    expect(await closed).toEqual({ code, reason: "empty" });
    expect(await chipsOf(ada.id)).toBe(before);
    expect(await store.bank("roulette")).toBe(BANK);
    expect(server?.rooms.has(code)).toBe(false);
  });

  /*
   * The reset only refuses while somebody is seated, and a wheel whose last
   * seat has gone keeps its cloth until the reaper calls it off. Those chips
   * are in the bank, and emptying the whole bank took them with it: the void
   * that followed was refused by the bank, logged, and never paid.
   */
  it("keeps its chips payable when an admin empties the banks before it is cleared away", async () => {
    const { store, ada, chipsOf, before, player, code, port } = await stakedWheel({
      reconnectGraceMs: 100,
      emptyRoomTtlMs: 60_000,
    });
    /*
     * The window shut by hand rather than waited out: it is thirty seconds,
     * and only once it has shut does a leaver's stake ride rather than go
     * home on the next broadcast. The ball is then in the air for eight and
     * a half, far longer than the rest of this takes.
     */
    const table = server?.rooms.get(code)?.table as unknown as { closeBetting(): void; phase: string };
    table.closeBetting();
    expect(table.phase).toBe("spinning");
    player.close();
    // The seat gone, not just disconnected: the reset refuses a seated player.
    await until(() => server?.rooms.get(code)?.table.seats.length === 0);

    const reset = await fetch(`http://localhost:${port}/api/admin/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: { all: true }, parts: ["stats"], emptyBanks: true }),
    });
    expect(reset.status).toBe(200);
    // Everything but red's worst case, which the wheel could still owe her.
    expect(await store.bank("roulette")).toBe(400);

    await server?.closeTable(code, "admin");

    expect(await chipsOf(ada.id)).toBe(before);
    expect(await store.bank("roulette")).toBe(200);
  });
});

describe("a table while it is being called off", () => {
  /*
   * Closing takes as long as its refunds do. For that whole time the table
   * must look finished to anybody still at it: a move refused, and no state
   * sent that could show chips the close has already counted.
   */
  it("refuses a move and sends nobody a state", async () => {
    const { ada, client, hold, player, code } = await stakedWheel({
      reconnectGraceMs: 60_000,
      emptyRoomTtlMs: 60_000,
    });
    const watcher = await client();
    await watch(watcher, code);
    const other = await client();
    const seesBoth = new Promise<void>((resolve) =>
      watcher.on("room:state", (state) => {
        if ((state as { watching?: number }).watching === 2) {
          resolve();
        }
      }),
    );
    await watch(other, code);
    /*
     * Everything sent before the close began has to have arrived before this
     * starts counting: a state already on the wire is not the table speaking
     * after it closed, and counting it would make this fail for a reason that
     * has nothing to do with the close.
     */
    await seesBoth;
    await sleep(150);
    const refund = hold(ada.id, 1);

    const closing = server?.closeTable(code, "admin");
    await refund.arrived;

    let states = 0;
    watcher.on("room:state", () => {
      states += 1;
    });
    const refused = new Promise<string>((resolve) => player.on("room:error", resolve));
    // Not a stake, so nothing in any game refuses it: only the room can.
    player.emit("lobby:setListed", { listed: false });
    // A watcher going is a broadcast that no handler guards.
    other.close();

    expect(await refused).toBe("This table is closing.");
    await sleep(200);
    expect(states).toBe(0);

    refund.release();
    await closing;
  });

  /*
   * A throw whose debit is still on its way when the table closes. The close
   * has already handed back every taunt it could see, so this one has to be
   * handed back by the throw itself.
   */
  it("hands back a taunt whose chips were still being taken", async () => {
    const { store, bo, client, hold, chipsOf } = await start({
      reconnectGraceMs: 60_000,
      emptyRoomTtlMs: 60_000,
    });
    const gif = new Uint8Array(64);
    gif.set([..."GIF89a"].map((letter) => letter.charCodeAt(0)));
    const emote = await store.addEmote({
      name: "Smug",
      cost: 250,
      image: gif,
      sound: null,
      createdBy: "admin",
    });
    const ada = await client();
    const created = await new Promise<Ack>((resolve) =>
      ada.emit("lobby:create", { name: "Ada" }, resolve),
    );
    const code = created.ok ? created.code : "";
    const adaSeat = created.ok ? created.seatId : "";
    const boSocket = await client();
    await new Promise<Ack>((resolve) =>
      boSocket.emit("lobby:join", { name: "Bo", code }, resolve),
    );
    const before = await chipsOf(bo.id);
    const take = hold(bo.id, -1);

    const sent = new Promise<{ ok: boolean }>((resolve) =>
      boSocket.emit("taunt:send", { emoteId: emote.id, seatId: adaSeat }, resolve),
    );
    await take.arrived;
    await server?.closeTable(code, "admin");
    take.release();

    expect((await sent).ok).toBe(false);
    expect(await chipsOf(bo.id)).toBe(before);
  });

  /*
   * A stake whose debit is still on its way when the close begins. Whichever
   * of them finishes first, the chips have to end up back in the account.
   *
   * The room does not wait for the move, and this passes without it doing so:
   * the debit lands on an escrow the void has already closed, which refuses to
   * hold it, and the game gives the chips straight back. Kept because that is
   * the whole of what protects a stake caught this way, end to end.
   */
  it("hands back a stake that was still being taken", async () => {
    const { store, ada, client, hold, chipsOf } = await start({
      reconnectGraceMs: 60_000,
      emptyRoomTtlMs: 60_000,
    });
    const before = await chipsOf(ada.id);
    const player = await client();
    const code = await openTable(player, "roulette");
    const take = hold(ada.id, -1);

    await act(player, { type: "place", spotId: RED, chips: 200 });
    await take.arrived;
    const closing = server?.closeTable(code, "admin");
    await sleep(50);
    take.release();
    await closing;

    await until(async () => (await chipsOf(ada.id)) === before);
    await until(async () => (await store.bank("roulette")) === BANK);
  });

  /*
   * A seat whose grace runs out, or who presses Leave, while the close is
   * still handing chips back. Either one takes the seat away mid-close.
   *
   * The room lets both happen, and these pass anyway: taking a seat away only
   * queues its chips in the escrow or marks it as leaving, and the void takes
   * everything the escrow holds or has queued. Kept so that stays true.
   */
  it("still hands everything back when a dropped seat's grace runs out mid-close", async () => {
    const { store, ada, hold, chipsOf, before, player, code } = await stakedWheel({
      reconnectGraceMs: 100,
      emptyRoomTtlMs: 60_000,
    });
    player.close();
    await until(() => server?.rooms.get(code)?.table.isEmpty === true);
    const refund = hold(ada.id, 1);

    const closing = server?.closeTable(code, "admin");
    await refund.arrived;
    await sleep(300);
    refund.release();
    await closing;

    await until(async () => (await chipsOf(ada.id)) === before);
    await until(async () => (await store.bank("roulette")) === BANK);
  });

  it("still hands everything back when a seat leaves mid-close", async () => {
    const { store, ada, hold, chipsOf, before, player, code } = await stakedWheel({
      reconnectGraceMs: 60_000,
      emptyRoomTtlMs: 60_000,
    });
    const refund = hold(ada.id, 1);

    const closing = server?.closeTable(code, "admin");
    await refund.arrived;
    player.emit("lobby:leave");
    await sleep(200);
    refund.release();
    await closing;

    await until(async () => (await chipsOf(ada.id)) === before);
    await until(async () => (await store.bank("roulette")) === BANK);
  });

  /*
   * Blackjack takes a leaver's bet off the felt and queues it in the escrow,
   * rather than leaving it on the cloth the way the wheel does, so standing up
   * mid-close is a second route to the same chips there and not here.
   */
  it("hands a blackjack bet back exactly once when its seat stands up mid-close", async () => {
    const { store, ada, client, hold, chipsOf } = await start({
      reconnectGraceMs: 60_000,
      emptyRoomTtlMs: 60_000,
    });
    const before = await chipsOf(ada.id);
    const player = await client();
    const code = await openTable(player, "blackjack");
    await act(player, { type: "bet", amount: 100 });
    await until(async () => (await chipsOf(ada.id)) === before - 100);
    expect(server?.rooms.get(code)?.table.status).toBe("lobby");
    const refund = hold(ada.id, 1);

    const closing = server?.closeTable(code, "admin");
    await refund.arrived;
    player.emit("lobby:leave");
    await sleep(200);
    refund.release();
    await closing;
    await sleep(100);

    expect(await chipsOf(ada.id)).toBe(before);
    expect(await store.bank("blackjack")).toBe(BANK);
  });
});

describe("the server stopping", () => {
  it("hands back a blackjack bet still on the felt", async () => {
    const { store, ada, client, chipsOf } = await start({
      reconnectGraceMs: 60_000,
      emptyRoomTtlMs: 60_000,
    });
    const before = await chipsOf(ada.id);
    const player = await client();
    await openTable(player, "blackjack");
    await act(player, { type: "bet", amount: 100 });
    await until(async () => (await chipsOf(ada.id)) === before - 100);
    const closed = new Promise<TableClosed>((resolve) => player.on("room:closed", resolve));

    await server?.closeAllTables("shutdown");

    expect((await closed).reason).toBe("shutdown");
    expect(await chipsOf(ada.id)).toBe(before);
    expect(await store.bank("blackjack")).toBe(BANK);
  });

  it("calls every table off as part of closing", async () => {
    const { ada, client, chipsOf } = await start({
      reconnectGraceMs: 60_000,
      emptyRoomTtlMs: 60_000,
    });
    const before = await chipsOf(ada.id);
    const player = await client();
    await openTable(player, "blackjack");
    await act(player, { type: "bet", amount: 100 });
    await until(async () => (await chipsOf(ada.id)) === before - 100);

    const stopping = server;
    server = null;
    await stopping?.close();

    // MemoryStore's close releases nothing, so it can still be read afterwards.
    expect(await chipsOf(ada.id)).toBe(before);
  });

  /*
   * A reap already under way when the server is told to stop. Stopping must
   * wait for it: the store closes straight afterwards, and a refund still
   * travelling to a real one when it does is a refund that never lands.
   */
  it("waits for a close already under way before it finishes", async () => {
    const { ada, hold, chipsOf, before, code } = await stakedWheel({
      reconnectGraceMs: 60_000,
      emptyRoomTtlMs: 60_000,
    });
    const refund = hold(ada.id, 1);

    const first = server?.closeTable(code, "empty");
    await refund.arrived;
    let done = false;
    const all = server?.closeAllTables("shutdown").then(() => {
      done = true;
    });
    await sleep(100);
    expect(done).toBe(false);

    refund.release();
    await all;
    await first;
    expect(await chipsOf(ada.id)).toBe(before);
  });

  /*
   * Sockets stay open until the very end of a shutdown, and a close waits on
   * every refund, so a slow one leaves plenty of time to open a table and put
   * chips on it. The store closes right after; whatever that table holds has
   * to have gone back before it does.
   */
  it("leaves nothing on a table opened while it is stopping", async () => {
    const { store, ada, bo, client, hold, chipsOf, before } = await stakedWheel({
      reconnectGraceMs: 60_000,
      emptyRoomTtlMs: 60_000,
    });
    const late = await client();
    const boBefore = await chipsOf(bo.id);
    const refund = hold(ada.id, 1);

    const stopping = server;
    server = null;
    const closed = stopping?.close();
    await refund.arrived;

    const created = await new Promise<Ack>((resolve) =>
      late.emit("lobby:create", { name: "Bo", game: "blackjack", forFun: false }, resolve),
    );
    if (created.ok) {
      await act(late, { type: "bet", amount: 100 });
      await until(async () => (await chipsOf(bo.id)) === boBefore - 100);
    } else {
      expect(created.error).toBe("The server is shutting down.");
    }

    refund.release();
    await closed;

    expect(await chipsOf(ada.id)).toBe(before);
    expect(await chipsOf(bo.id)).toBe(boBefore);
    expect(await store.bank("blackjack")).toBe(BANK);
    expect(stopping?.rooms.size).toBe(0);
  });

  /*
   * A game that throws while the close asks whether its hand is decided must
   * not keep its own stakes, nor stop every other table's being handed back.
   */
  for (const broken of ["isSettled", "winners"] as const) {
    it(`still calls every table off when a game's ${broken} throws`, async () => {
      const { store, ada, bo, client, chipsOf, before, code } = await stakedWheel({
        reconnectGraceMs: 60_000,
        emptyRoomTtlMs: 60_000,
      });
      const other = await client();
      const boBefore = await chipsOf(bo.id);
      const blackjack = await openTable(other, "blackjack");
      await act(other, { type: "bet", amount: 100 });
      await until(async () => (await chipsOf(bo.id)) === boBefore - 100);

      const seated = server?.rooms.get(code);
      if (seated === undefined) {
        throw new Error("no wheel");
      }
      const errors: unknown[][] = [];
      const logged = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args);
      };
      try {
        seated.game =
          broken === "isSettled"
            ? {
                ...seated.game,
                isSettled: () => {
                  throw new Error("isSettled broke");
                },
              }
            : {
                ...seated.game,
                isSettled: () => true,
                winners: () => {
                  throw new Error("winners broke");
                },
              };

        const outcome = await server?.closeAllTables("shutdown").then(
          () => "resolved",
          () => "rejected",
        );

        expect(outcome).toBe("resolved");
      } finally {
        console.error = logged;
      }
      expect(await chipsOf(ada.id)).toBe(before);
      expect(await chipsOf(bo.id)).toBe(boBefore);
      expect(await store.bank("roulette")).toBe(BANK);
      expect(await store.bank("blackjack")).toBe(BANK);
      expect(server?.rooms.has(code)).toBe(false);
      expect(server?.rooms.has(blackjack)).toBe(false);
      expect(errors.some((args) => String(args[0]).includes(code))).toBe(true);
    });
  }
});
