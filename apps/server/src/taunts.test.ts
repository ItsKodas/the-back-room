import type { AddressInfo } from "node:net";
import { MemoryStore, STARTING_CHIPS } from "@backroom/economy";
import type { Die } from "@backroom/rules";
import type { Ack, ClientToServer, RoomView, ServerToClient, TauntPlay } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createBackRoomServer } from "./server.js";
import type { BackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * Taunts, driven through the real socket layer.
 *
 * The pool's arithmetic is tested directly in `@backroom/core`, where it can
 * be pushed at without a table in the way. What is only reachable here is
 * everything the building wraps around it: that the chips actually leave an
 * account before the picture lands, that a bot and a guest are refused at both
 * ends, and that a settled hand pays the pool out and throws the emote back.
 */

/** Enough of any game's view for these tests: the room's own fields plus the
    one blackjack field they steer by. */
type View = RoomView & {
  taunts?: Array<{ seatId: string; chips: number }>;
  phase?: string;
};

type Client = Socket<ServerToClient, ClientToServer> & {
  latest?: View;
  seen: View[];
  read: number;
  taunts: TauntPlay[];
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
 * A table with real accounts at it.
 *
 * Six ones every roll, so a turn is worth 8,000 and any target below that is
 * won by whoever banks first. That determinism is the point: these tests are
 * about what happens to the chips when somebody wins, not about who does.
 */
async function start(
  people: string[],
): Promise<{ store: MemoryStore; port: number; ids: string[] }> {
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
    roll: () => [1, 1, 1, 1, 1, 1] as Die[],
    botDelayMs: 5,
    farklePauseMs: 20,
    identify: () => {
      // Connection order is the only way to say who somebody is without
      // standing up a real sign-in. A name absent from the list is a guest.
      const id = ids[seen] ?? null;
      seen += 1;
      return id;
    },
    // Every HTTP request is the first person listed. Only a test that also
    // puts them on the admin allowlist gets anything out of it.
    identifyRequest: () => ids[0] ?? null,
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
    socket.taunts = [];
    open.push(socket);
    socket.on("room:state", (state) => {
      socket.latest = state as unknown as Client["latest"];
      socket.seen.push(socket.latest as NonNullable<Client["latest"]>);
    });
    socket.on("taunt:play", (taunt) => socket.taunts.push(taunt));
    socket.on("connect", () => resolve(socket));
  });
}

/** Sends a move and waits for the server to say it has dealt with it. */
const act = (socket: Client, action: Record<string, unknown>) =>
  new Promise<void>((resolve) => socket.emit("game:action", action, () => resolve()));

/** The next state that matches, reading forward from where the last wait stopped. */
function stateWhere(
  socket: Client,
  ok: (state: NonNullable<Client["latest"]>) => boolean,
  ms = 2500,
): Promise<NonNullable<Client["latest"]>> {
  for (let index = socket.read; index < socket.seen.length; index += 1) {
    const state = socket.seen[index] as NonNullable<Client["latest"]>;
    if (ok(state)) {
      socket.read = index + 1;
      return Promise.resolve(state);
    }
  }
  socket.read = socket.seen.length;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no matching state")), ms);
    const onState = (raw: unknown) => {
      const state = raw as NonNullable<Client["latest"]>;
      if (ok(state)) {
        clearTimeout(timer);
        socket.off("room:state", onState);
        socket.read = socket.seen.length;
        resolve(state);
      }
    };
    socket.on("room:state", onState);
  });
}

const create = (socket: Client, name: string) =>
  new Promise<Ack>((resolve) => socket.emit("lobby:create", { name }, resolve));

const join = (socket: Client, name: string, code: string) =>
  new Promise<Ack>((resolve) => socket.emit("lobby:join", { name, code }, resolve));

const throwAt = (socket: Client, emoteId: string, seatId: string) =>
  new Promise<{ ok: boolean; error?: string; chips?: number }>((resolve) =>
    socket.emit("taunt:send", { emoteId, seatId }, resolve),
  );

/** Waits for something to have been thrown, since sending is a round trip. */
function tauntWhere(socket: Client, ok: (one: TauntPlay) => boolean, ms = 2500) {
  const found = socket.taunts.find(ok);
  if (found !== undefined) {
    return Promise.resolve(found);
  }
  return new Promise<TauntPlay>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("nothing thrown")), ms);
    const onPlay = (one: TauntPlay) => {
      if (ok(one)) {
        clearTimeout(timer);
        socket.off("taunt:play", onPlay);
        resolve(one);
      }
    };
    socket.on("taunt:play", onPlay);
  });
}

const ascii = (text: string): number[] => [...text].map((letter) => letter.charCodeAt(0));

function gif(): Uint8Array {
  const out = new Uint8Array(64);
  out.set(ascii("GIF89a"));
  return out;
}

async function emote(store: MemoryStore, cost: number, withSound = false) {
  const sound = new Uint8Array(32);
  sound.set(ascii("ID3"));
  return store.addEmote({
    name: "Smug",
    cost,
    image: gif(),
    sound: withSound ? sound : null,
    createdBy: "admin",
  });
}

/** Two signed-in players at a friendly table, and an emote to throw. */
async function table(cost = 250, target = 2000, withSound = false) {
  const { store, port, ids } = await start(["Ada", "Bo"]);
  const made = await emote(store, cost, withSound);

  const ada = await client(port);
  const created = await create(ada, "Ada");
  const code = created.ok ? created.code : "";
  const adaSeat = created.ok ? created.seatId : "";

  const bo = await client(port);
  const joined = await join(bo, "Bo", code);
  const boSeat = joined.ok ? joined.seatId : "";

  await stateWhere(ada, (state) => state.seats.length === 2);
  /*
   * No final round, so banking past the target ends the game there and then.
   * With one, the table would sit waiting on the other player to take a turn
   * nobody in these tests is going to take — and what is being tested is what
   * happens to the pool once somebody has won, not how Greed decides it.
   */
  ada.emit("lobby:setRules", { targetScore: target, entryThreshold: 0, finalRound: false });
  await stateWhere(ada, (state) => state.ruleset.targetScore === target);

  return {
    store,
    port,
    code,
    ada,
    bo,
    adaSeat,
    boSeat,
    emoteId: made.id,
    adaId: ids[0] as string,
    boId: ids[1] as string,
  };
}

/** What somebody's account actually holds. */
async function chipsOf(store: MemoryStore, id: string): Promise<number> {
  return (await store.get(id))?.chips ?? -1;
}

/** Plays one turn of six ones and banks it, which wins against a low target. */
async function winWith(socket: Client) {
  socket.emit("game:action", { type: "start" });
  await stateWhere(socket, (state) => state.status === "playing");
  socket.emit("game:action", { type: "roll" });
  await stateWhere(socket, (state) => (state.turn?.dice.length ?? 0) === 6);
  for (let index = 0; index < 6; index += 1) {
    socket.emit("game:action", { type: "toggle", index });
  }
  await stateWhere(socket, (state) => (state.turn?.selection ?? 0) > 0);
  socket.emit("game:action", { type: "bank" });
  return stateWhere(socket, (state) => state.status === "over");
}

describe("throwing one", () => {
  it("takes the chips and shows everybody at the table", async () => {
    const { store, ada, bo, adaSeat, boSeat, emoteId, adaId, boId } = await table(250);

    const sent = await throwAt(bo, emoteId, adaSeat);

    expect(sent.ok).toBe(true);
    expect(sent.chips).toBe(STARTING_CHIPS - 250);
    const landed = await tauntWhere(ada, (one) => !one.revenge);
    expect(landed).toMatchObject({
      atSeatId: adaSeat,
      atName: "Ada",
      fromSeatId: boSeat,
      fromName: "Bo",
      chips: 250,
      revenge: false,
      image: `/api/emotes/${emoteId}/image`,
      sound: null,
    });
    // Taken from the account, not merely promised.
    expect(await chipsOf(store, boId)).toBe(STARTING_CHIPS - 250);
    // And not yet given to the target: it is staked on them, not handed over.
    expect(await chipsOf(store, adaId)).toBe(STARTING_CHIPS);
  });

  it("carries the sound when the emote has one", async () => {
    const { store, port } = await start(["Ada", "Bo"]);
    const made = await emote(store, 10, true);
    const ada = await client(port);
    const created = await create(ada, "Ada");
    const code = created.ok ? created.code : "";
    const bo = await client(port);
    await join(bo, "Bo", code);
    await stateWhere(ada, (state) => state.seats.length === 2);

    await throwAt(bo, made.id, created.ok ? created.seatId : "");

    const landed = await tauntWhere(ada, () => true);
    expect(landed.sound).toBe(`/api/emotes/${made.id}/sound`);
  });

  it("puts what was staked onto the seat it was thrown at", async () => {
    const { ada, bo, adaSeat, emoteId } = await table(250);

    await throwAt(bo, emoteId, adaSeat);

    const state = await stateWhere(
      ada,
      (one) => (one.taunts ?? []).some((stake) => stake.chips > 0),
    );
    expect(state.taunts).toEqual([{ seatId: adaSeat, chips: 250 }]);
  });

  it("stacks several onto the same seat", async () => {
    const { ada, bo, adaSeat, emoteId } = await table(100);

    await throwAt(bo, emoteId, adaSeat);
    await throwAt(bo, emoteId, adaSeat);

    const state = await stateWhere(
      ada,
      (one) => (one.taunts ?? []).some((stake) => stake.chips === 200),
    );
    expect(state.taunts).toEqual([{ seatId: adaSeat, chips: 200 }]);
  });

  it("reports the sender's balance back, so the picker can settle to the truth", async () => {
    const { bo, adaSeat, emoteId } = await table(1000);

    expect((await throwAt(bo, emoteId, adaSeat)).chips).toBe(STARTING_CHIPS - 1000);
    expect((await throwAt(bo, emoteId, adaSeat)).chips).toBe(STARTING_CHIPS - 2000);
  });
});

describe("what is refused", () => {
  it("refuses somebody taunting themselves", async () => {
    const { bo, boSeat, emoteId } = await table();

    const sent = await throwAt(bo, emoteId, boSeat);

    expect(sent).toMatchObject({ ok: false });
    expect(sent.error).toMatch(/somebody else/i);
  });

  it("refuses an emote that does not exist", async () => {
    const { bo, adaSeat } = await table();

    expect(await throwAt(bo, "not-an-emote", adaSeat)).toMatchObject({ ok: false });
  });

  it("refuses a retired emote", async () => {
    const { store, bo, adaSeat, emoteId } = await table();
    await store.retireEmote(emoteId);

    expect(await throwAt(bo, emoteId, adaSeat)).toMatchObject({ ok: false });
  });

  it("refuses a seat nobody is in", async () => {
    const { bo, emoteId } = await table();

    expect(await throwAt(bo, emoteId, "nobody")).toMatchObject({ ok: false });
  });

  /*
   * The building's central rule, at the paying end. A player cannot come out
   * richer unless real people were in it with them, and a bot is not one — so
   * a pool can never be filled by, or paid to, something that is not a person.
   */
  it("refuses a bot at either end", async () => {
    const { ada, bo, adaSeat, emoteId } = await table();
    ada.emit("lobby:addBot", { skill: "easy" });
    const withBot = await stateWhere(ada, (state) => state.seats.some((seat) => seat.isBot));
    const botSeat = withBot.seats.find((seat) => seat.isBot)?.id ?? "";

    const sent = await throwAt(bo, emoteId, botSeat);

    expect(sent).toMatchObject({ ok: false });
    expect(sent.error).toMatch(/signed-in/i);
    expect(adaSeat).not.toBe(botSeat);
  });

  /* And at the other end: a guest has no account for the chips to leave. */
  it("refuses a guest throwing one", async () => {
    const { store, port } = await start(["Ada"]);
    const made = await emote(store, 100);
    const ada = await client(port);
    const created = await create(ada, "Ada");
    // The third connection is past the end of the identity list, so a guest.
    const guest = await client(port);
    await join(guest, "Nobody", created.ok ? created.code : "");
    await stateWhere(ada, (state) => state.seats.length === 2);

    const sent = await throwAt(guest, made.id, created.ok ? created.seatId : "");

    expect(sent).toMatchObject({ ok: false });
    expect(sent.error).toMatch(/sign in/i);
  });

  it("refuses a guest as the target", async () => {
    const { store, port } = await start(["Ada"]);
    const made = await emote(store, 100);
    const ada = await client(port);
    const created = await create(ada, "Ada");
    const guest = await client(port);
    const joined = await join(guest, "Nobody", created.ok ? created.code : "");
    await stateWhere(ada, (state) => state.seats.length === 2);

    const sent = await throwAt(ada, made.id, joined.ok ? joined.seatId : "");

    expect(sent).toMatchObject({ ok: false });
  });

  it("refuses somebody who cannot afford it, and takes nothing", async () => {
    const { store, ada, bo, adaSeat, emoteId, adaId, boId } = await table(STARTING_CHIPS + 1);

    const sent = await throwAt(bo, emoteId, adaSeat);

    expect(sent).toMatchObject({ ok: false });
    expect(sent.error).toMatch(/not enough/i);
    // Nothing landed, and nothing left either account.
    expect(ada.taunts).toEqual([]);
    expect(await chipsOf(store, boId)).toBe(STARTING_CHIPS);
    expect(await chipsOf(store, adaId)).toBe(STARTING_CHIPS);
  });

  it("refuses somebody who is not at a table", async () => {
    const { store, port } = await start(["Ada"]);
    const made = await emote(store, 10);
    const loose = await client(port);

    expect(await throwAt(loose, made.id, "anyone")).toMatchObject({ ok: false });
  });

  it("throttles a flood of them", async () => {
    const { bo, adaSeat, emoteId } = await table(1);

    const sent = [];
    for (let index = 0; index < 5; index += 1) {
      sent.push(await throwAt(bo, emoteId, adaSeat));
    }

    expect(sent.filter((one) => one.ok)).toHaveLength(3);
    expect(sent.filter((one) => !one.ok)).toHaveLength(2);
  });
});

describe("when the hand settles", () => {
  it("pays the whole pool to a target who won", async () => {
    const { store, ada, bo, adaSeat, emoteId, adaId, boId } = await table(250);
    await throwAt(bo, emoteId, adaSeat);
    expect(await chipsOf(store, boId)).toBe(STARTING_CHIPS - 250);

    await winWith(ada);
    // The pool clearing off the felt is the settlement having finished.
    const state = await stateWhere(ada, (one) => (one.taunts ?? []).length === 0);

    // Ada was mocked and then won, so the 250 Bo staked on her is hers.
    expect(state.taunts).toEqual([]);
    expect(await chipsOf(store, adaId)).toBe(STARTING_CHIPS + 250);
    expect(await chipsOf(store, boId)).toBe(STARTING_CHIPS - 250);
  });

  /*
   * The arithmetic the whole design rests on, asserted end to end rather than
   * only in the pool's own tests: chips move between two real accounts and the
   * total across them does not change. Nothing here mints.
   */
  it("moves chips between players without creating any", async () => {
    const { store, ada, bo, adaSeat, emoteId, adaId, boId } = await table(250);
    const before = (await chipsOf(store, adaId)) + (await chipsOf(store, boId));
    await throwAt(bo, emoteId, adaSeat);

    await winWith(ada);
    await stateWhere(ada, (one) => (one.taunts ?? []).length === 0);

    expect((await chipsOf(store, adaId)) + (await chipsOf(store, boId))).toBe(before);
  });

  it("throws the emote back at whoever sent it", async () => {
    const { ada, bo, adaSeat, boSeat, emoteId } = await table(250);
    await throwAt(bo, emoteId, adaSeat);
    await tauntWhere(bo, (one) => !one.revenge);

    await winWith(ada);

    const back = await tauntWhere(bo, (one) => one.revenge);
    expect(back).toMatchObject({
      revenge: true,
      // Turned around: it is now aimed at the person who threw it.
      atSeatId: boSeat,
      atName: "Bo",
      fromSeatId: adaSeat,
      fromName: "Ada",
      emoteId,
      chips: 250,
    });
  });

  /*
   * A friendly table is the case this whole arrangement exists for. Greed does
   * not record a friendly at all — it returns before writing any history — so
   * a pool that resolved off the history would never pay out here. It resolves
   * off who won instead, which every table knows whatever it plays for.
   */
  it("resolves at a table played for nothing", async () => {
    const { ada, bo, adaSeat, emoteId } = await table(250);
    await throwAt(bo, emoteId, adaSeat);

    const over = await winWith(ada);

    expect(over.buyIn).toBe(0);
    await tauntWhere(bo, (one) => one.revenge);
  });

  it("burns a pool whose target did not win", async () => {
    const { store, ada, bo, boSeat, emoteId, adaId, boId } = await table(250);
    // Ada mocks Bo, then Ada is the one who wins.
    await throwAt(ada, emoteId, boSeat);
    await tauntWhere(bo, (one) => !one.revenge);

    await winWith(ada);

    const state = await stateWhere(ada, (one) => (one.taunts ?? []).length === 0);
    expect(state.taunts).toEqual([]);
    // Nothing came back: a burned taunt is not replayed at anybody.
    expect(bo.taunts.filter((one) => one.revenge)).toEqual([]);
    /*
     * And the chips are gone rather than refunded. Ada paid to mock somebody
     * who then lost, and it stayed paid — which is the whole of what makes a
     * taunt cost anything.
     */
    expect(await chipsOf(store, adaId)).toBe(STARTING_CHIPS - 250);
    expect(await chipsOf(store, boId)).toBe(STARTING_CHIPS);
  });
});

/*
 * An admin deleting an emote does not take a pool's chips with it, and the
 * spec promises the replay still happens — the name, with no picture behind
 * it and no sound. Forgetting the emote on delete dropped the replay
 * outright: the chips were paid, and nobody saw anything thrown back.
 */
describe("a pool holding an emote an admin deletes", () => {
  afterEach(() => {
    delete process.env["ADMIN_DISCORD_IDS"];
  });

  it("still throws it back, by name and without its sound", async () => {
    // Ada is d0, and every HTTP request in this file is Ada.
    process.env["ADMIN_DISCORD_IDS"] = "d0";
    const { store, port, ada, bo, adaSeat, boSeat, emoteId, adaId } = await table(250, 2000, true);
    await throwAt(bo, emoteId, adaSeat);
    const thrown = await tauntWhere(bo, (one) => !one.revenge);
    expect(thrown.sound).toBe(`/api/emotes/${emoteId}/sound`);

    const deleted = await fetch(`http://localhost:${port}/api/admin/emotes/${emoteId}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(deleted.status).toBe(200);

    await winWith(ada);

    const back = await tauntWhere(bo, (one) => one.revenge);
    expect(back).toMatchObject({
      revenge: true,
      emoteId,
      name: "Smug",
      sound: null,
      atSeatId: boSeat,
      fromSeatId: adaSeat,
      chips: 250,
    });
    expect(await chipsOf(store, adaId)).toBe(STARTING_CHIPS + 250);
  });
});

/**
 * A pool that has to survive the table moving on underneath it.
 *
 * Blackjack settles a hand, pays it out, and then clears the felt on its own
 * clock. Settling talks to the economy, so it yields — and against a real
 * database it yields for as long as the round trips take, which is easily
 * longer than the beat before the next hand opens.
 *
 * That is what broke this in production. Who won was being asked of the table
 * *after* settling had finished, by which time `beginBetting` had emptied
 * every seat's hands, so the table answered "nobody won" and every pool was
 * burned: no chips to the person who had been mocked, and no emote thrown
 * back at whoever mocked them. `settle` in the game itself carries a comment
 * warning about precisely this hazard, and this is the same mistake one layer
 * out.
 *
 * The shoe is fixed here rather than dealt for, so the hand below has one
 * outcome and the test is about the pool rather than about luck.
 */
describe("a pool at a table that deals itself", () => {
  /** The constant that deals this seat a hand it wins, every time. */
  const A_WINNING_SHOE = 0.7;

  /**
   * A store that answers as slowly as a real one across a network.
   *
   * Not an exaggeration for effect: settling a hand is several round trips per
   * seat, and the whole failure is settling outlasting the beat before the
   * next hand. MemoryStore answers within the same tick, which is exactly why
   * this went unnoticed everywhere but production.
   */
  function slow(store: MemoryStore, ms: number): MemoryStore {
    const wait = () => new Promise((resolve) => setTimeout(resolve, ms));
    return new Proxy(store, {
      get(target, key: string | symbol) {
        const value = Reflect.get(target, key) as unknown;
        if (typeof value !== "function") {
          return value;
        }
        const call = value.bind(target) as (...args: unknown[]) => unknown;
        if (key !== "adjustChips" && key !== "bumpStats" && key !== "recordGame") {
          return call;
        }
        return async (...args: unknown[]) => {
          await wait();
          return call(...args);
        };
      },
    }) as MemoryStore;
  }

  it("pays and throws back even when settling outlasts the felt being cleared", async () => {
    const store = new MemoryStore();
    await store.bankAdd("blackjack", 5_000_000);
    const ids: string[] = [];
    for (const [index, name] of ["Ada", "Bo"].entries()) {
      const profile = await store.upsertDiscordUser({
        discordId: `bj${index}`,
        name,
        avatar: null,
        accentColor: null,
      });
      ids.push(profile.id);
    }
    const made = await emote(store, 250);

    let seen = 0;
    server = createBackRoomServer({
      store: slow(store, 120),
      auth: null,
      serveClient: false,
      spinRandom: () => A_WINNING_SHOE,
      // The felt clears almost at once, and settling takes far longer. That
      // ordering is the bug, so it is the ordering the test arranges.
      settleMs: 30,
      bettingMs: 30_000,
      identify: () => {
        const id = ids[seen] ?? null;
        seen += 1;
        return id;
      },
    });
    await listenForFetch(server.http);
    const port = (server.http.address() as AddressInfo).port;

    const ada = await client(port);
    const created = await new Promise<Ack>((resolve) =>
      ada.emit("lobby:create", { name: "Ada", game: "blackjack" }, resolve),
    );
    const code = created.ok ? created.code : "";
    const adaSeat = created.ok ? created.seatId : "";
    const bo = await client(port);
    const joined = await join(bo, "Bo", code);
    const boSeat = joined.ok ? joined.seatId : "";
    await stateWhere(ada, (state) => state.seats.length === 2);

    // Bo mocks Ada, and Ada is about to win the hand.
    expect((await throwAt(bo, made.id, adaSeat)).ok).toBe(true);

    await act(ada, { type: "bet", amount: 500 });
    await act(ada, { type: "deal" });
    const dealt = await stateWhere(ada, (state) => state.phase !== "betting", 4000);
    if (dealt.phase === "playing") {
      await act(ada, { type: "stand" });
    }

    const back = await tauntWhere(bo, (one) => one.revenge, 8000);

    expect(back).toMatchObject({
      revenge: true,
      atSeatId: boSeat,
      fromSeatId: adaSeat,
      chips: 250,
    });
    // And the chips actually reached the person who was mocked and then won.
    const settled = await chipsOf(store, ids[0] as string);
    expect(settled).toBeGreaterThanOrEqual(STARTING_CHIPS + 250);
  }, 20_000);
});
