import type { AddressInfo } from "node:net";
import { MemoryStore, STARTING_CHIPS } from "@backroom/economy";
import type { TableView } from "@backroom/game-blackjack";
import type { Ack, ClientToServer, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { maxStake as blackjackMaxStake } from "@backroom/game-blackjack";
import { createBackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * Blackjack, driven through the real socket layer.
 *
 * The engine is tested directly in its own package; what is only reachable
 * here is the seam the second game was built to prove — one `game:action`
 * event carrying verbs the server has never heard of, a view emitted per seat
 * because one card is face down, and chips moving as each stake is placed
 * rather than once at the end.
 *
 * The shoe is the server's own, so nothing here asserts which cards came out.
 * It asserts what must hold whatever they were: what the hand cost, what the
 * payload was allowed to contain, and that the chips agree with the outcome
 * the table announced.
 */

/*
 * Every state the socket has been sent, and how far a test has read.
 *
 * A continuous table passes through states faster than a test can ask about
 * them — a settled hand is on screen for a moment and then the felt is clear
 * again — so a test that only ever sees "the state right now" is a test that
 * fails whenever the machine is quick. States are kept as a stream instead,
 * and each wait picks up where the last one finished.
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
 * A room with real accounts in it.
 *
 * Each name becomes a profile with a starting balance; null is a guest. The
 * ids are handed to sockets in connection order, which is the only way to say
 * who somebody is without standing up a Discord round-trip.
 */
async function startRoom(
  people: Array<string | null>,
  /*
   * How fast the table comes round. Left alone by most of these, because a
   * table that deals itself every fraction of a second would race the very
   * actions they are trying to take; the one test that is about the loop
   * turns it right down.
   */
  timings: {
    bettingMs?: number;
    settleMs?: number;
    turnMs?: number;
    lastCallMs?: number;
    reconnectGraceMs?: number;
    /** What the blackjack bank starts with, for the tests that are about it. */
    bank?: number;
  } = {},
  // A long window for bets so the table does not deal underneath a test that
  // is still setting itself up, and almost no wait between rounds so one that
  // needs several hands is not sitting through six seconds of each.
  { bettingMs = 30_000, settleMs = 80 } = timings,
): Promise<{
  store: MemoryStore;
  port: number;
  ids: Array<string | null>;
}> {
  const store = new MemoryStore();
  /*
   * A float in the blackjack bank, because a chips table now pays out of one.
   * Without it every bet here is refused with "the bank is empty", which is
   * correct and tells you nothing about the seam these tests are for. Deep
   * enough that the cap is never what refuses a stake in this file.
   */
  await store.bankAdd("blackjack", timings.bank ?? 10_000_000);
  const ids: Array<string | null> = [];
  for (const [index, name] of people.entries()) {
    if (name === null) {
      ids.push(null);
      continue;
    }
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
    // Bots think for a moment in a real room; here that moment is nothing.
    botDelayMs: 5,
    bettingMs,
    settleMs,
    ...(timings.turnMs === undefined ? {} : { turnMs: timings.turnMs }),
    ...(timings.lastCallMs === undefined ? {} : { lastCallMs: timings.lastCallMs }),
    ...(timings.reconnectGraceMs === undefined
      ? {}
      : { reconnectGraceMs: timings.reconnectGraceMs }),
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

/**
 * The next state that matches, counting from wherever the last wait stopped.
 *
 * Reading forward through the stream rather than looking at the latest state
 * is what makes these tests independent of how fast the table is: a hand that
 * settled and cleared while the test was between two awaits is still there to
 * be found. It also keeps them honest — a wait cannot be satisfied by a state
 * from a hand two deals ago, because that has already been read past.
 */
function stateWhere(socket: Client, ok: (state: TableView) => boolean, ms = 2500) {
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
            // What the stream actually held, because "no matching state" on
            // its own says nothing about which wait gave up or why.
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

/**
 * Opens a table for chips with somebody else already sitting at it.
 *
 * A table playing for chips will not deal to one person — chips are only won
 * from real people — so a test about one player's hand still needs a second
 * seat. The companion never bets, so they are never dealt in and nothing about
 * the hand under test changes.
 */
async function openWithCompany(port: number, host: Client): Promise<string> {
  await open_(host, "Ada");
  const code = (await stateWhere(host, (view) => view.seats.length === 1)).code;
  const company = await client(port);
  await new Promise<void>((resolve) =>
    company.emit("lobby:join", { name: "Bo", code }, () => resolve()),
  );
  await stateWhere(host, (view) => view.seats.length === 2);
  return code;
}

function open_(socket: Client, name: string, forFun = false): Promise<Ack> {
  return new Promise((resolve) =>
    socket.emit("lobby:create", { name, game: "blackjack", forFun }, resolve),
  );
}

/**
 * The next refusal this socket is told about.
 *
 * Refusals do not come back on the ack — that only says the server has dealt
 * with the message, refused or not — so a test that wants the reason has to
 * listen for it. Armed before the action that causes it, because the answer
 * can arrive before the ack does.
 */
function refusal(socket: Client, ms = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("nothing was refused")), ms);
    socket.once("room:error", (message: string) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

/** Sends a move and waits for the server to say it has dealt with it. */
function act(socket: Client, action: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) =>
    socket.emit("game:action", action as { type: string }, () => resolve()),
  );
}

/**
 * Bets and deals until a hand arrives that still has a decision in it.
 *
 * A natural blackjack is over inside `deal` — the seat is done, the dealer
 * plays, and the table settles before the first broadcast — so a hand that
 * reaches the playing phase is only about nineteen times in twenty. The shoe
 * is the server's own and cannot be seeded from out here, so this deals again
 * rather than asserting on a hand that may not exist.
 */
async function dealLive(socket: Client, stake = 500): Promise<TableView> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await act(socket, { type: "bet", amount: stake });
    await act(socket, { type: "deal" });
    const dealt = await stateWhere(socket, (view) => view.phase !== "betting");
    if (dealt.phase === "playing" && dealt.turnSeatId !== null) {
      return dealt;
    }
    // That hand is already over — `dealt` is the settled state itself, and
    // waiting for another would be waiting for a hand nobody is going to
    // deal. Nothing to ask for either: the felt clears itself and opens again
    // on the table's own clock, which the harness turns right down.
    await stateWhere(socket, (view) => view.phase === "betting");
  }
  throw new Error("twelve hands running were over before they began");
}

describe("blackjack over the wire", () => {
  it("opens a table that says which game it is", async () => {
    const { port } = await startRoom(["Ada"]);
    const host = await client(port);
    const ack = await open_(host, "Ada");

    expect(ack.ok).toBe(true);
    const state = await stateWhere(host, (view) => view.seats.length === 1);
    expect((state as unknown as { game: string }).game).toBe("blackjack");
    expect(state.phase).toBe("betting");
    expect(state.minBet).toBeGreaterThan(0);
  });

  it("turns a guest away, because there is no friendly blackjack", async () => {
    const { port } = await startRoom([null]);
    const guest = await client(port);
    const ack = await open_(guest, "Nobody");

    expect(ack).toEqual({ ok: false, error: expect.stringMatching(/sign in/i) });
  });

  it("takes the stake as it is placed and gives it back when it is withdrawn", async () => {
    const { store, port, ids } = await startRoom(["Ada"]);
    const ada = ids[0] as string;
    const host = await client(port);
    await open_(host, "Ada");

    await act(host, { type: "bet", amount: 500 });
    await stateWhere(host, (view) => view.seats[0]?.bet === 500);
    expect((await store.get(ada))?.chips).toBe(STARTING_CHIPS - 500);

    await act(host, { type: "bet", amount: 0 });
    await stateWhere(host, (view) => view.seats[0]?.bet === 0);
    expect((await store.get(ada))?.chips).toBe(STARTING_CHIPS);
  });

  it("refuses a stake nobody can cover, and charges nothing for the refusal", async () => {
    const { store, port, ids } = await startRoom(["Ada"]);
    const ada = ids[0] as string;
    await store.adjustChips(ada, -(STARTING_CHIPS - 100));
    const host = await client(port);
    await open_(host, "Ada");

    const refused = new Promise<string>((resolve) => host.once("room:error", resolve));
    await act(host, { type: "bet", amount: 1000 });

    expect(await refused).toMatch(/cannot cover/i);
    expect((await store.get(ada))?.chips).toBe(100);
    expect(host.latest?.seats[0]?.bet).toBe(0);
  });

  it("keeps the hole card off the wire until the dealer plays", async () => {
    const { port } = await startRoom(["Ada", "Bo"]);
    const host = await client(port);
    await openWithCompany(port, host);

    const dealt = await dealLive(host);
    // Not "sent and hidden by the browser" — the second card is not in the
    // payload at all, which is the entire reason a view is built per seat.
    expect(dealt.dealer.cards).toHaveLength(1);
    expect(dealt.dealer.hidden).toBe(true);
    expect(dealt.seats[0]?.hands[0]?.cards).toHaveLength(2);
    expect(dealt.turnSeatId).toBe(dealt.seats[0]?.id);
  });

  it("settles the hand and pays what the outcome says it pays", async () => {
    const { store, port, ids } = await startRoom(["Ada", "Bo"]);
    const ada = ids[0] as string;
    const host = await client(port);
    await openWithCompany(port, host);

    await dealLive(host);
    // Both read after the deal, so whatever hands dealLive played out first
    // are already in them and this measures only the hand about to finish.
    const staked = (await store.get(ada))?.chips ?? 0;
    const played = (await store.get(ada))?.stats.rounds ?? 0;

    await act(host, { type: "stand" });
    const over = await stateWhere(host, (view) => view.phase === "settled");

    const seat = over.seats[0];
    // Across every hand, since a deal can end as more than one of them.
    const back = (seat?.hands ?? []).reduce((total, hand) => total + hand.returned, 0);
    expect((seat?.hands ?? []).every((hand) => hand.outcome !== null)).toBe(true);
    // The whole hand is now face up: nothing is being held back after it ends.
    expect(over.dealer.hidden).toBe(false);
    expect(over.dealer.cards.length).toBeGreaterThanOrEqual(2);

    // Settling is asynchronous, so wait for the chips rather than assume them.
    await expect.poll(async () => (await store.get(ada))?.chips).toBe(staked + back);

    const record = await store.get(ada);
    expect(record?.stats.rounds).toBe(played + 1);
  });

  it("tells you what you are worth as the chips move, without being asked", async () => {
    /*
     * The figure in the corner of every page. It moves for reasons the browser
     * never asked about — a stake taken as it is placed, a hand paying out on
     * the table's clock — so the server says so rather than waiting to be
     * asked at the next page load.
     */
    const { port } = await startRoom(["Ada"]);
    const host = await client(port);
    const said: number[] = [];
    host.on("me:chips", (chips) => said.push(chips));
    await open_(host, "Ada");

    await act(host, { type: "bet", amount: 500 });
    await expect.poll(() => said).toEqual([STARTING_CHIPS - 500]);

    await act(host, { type: "bet", amount: 0 });
    // Not a fresh figure of its own: the balance is whatever it now is.
    await expect.poll(() => said.at(-1)).toBe(STARTING_CHIPS);
  });

  it("keeps one player's balance to themselves", async () => {
    const { port } = await startRoom(["Ada", "Bo"]);
    const host = await client(port);
    const other = await client(port);
    await open_(host, "Ada");
    const code = (await stateWhere(host, (view) => view.seats.length === 1)).code;
    const heard: number[] = [];
    other.on("me:chips", (chips) => heard.push(chips));
    await new Promise<void>((resolve) =>
      other.emit("lobby:join", { name: "Bo", code }, () => resolve()),
    );
    await stateWhere(other, (view) => view.seats.length === 2);

    await act(host, { type: "bet", amount: 500 });
    await stateWhere(other, (view) => (view.seats[0]?.bet ?? 0) === 500);

    // Somebody else's stake is somebody else's business.
    expect(heard).toEqual([]);
  });

  it("clears a hand that was dealt early without waiting out the betting window", async () => {
    /*
     * Two waits, one table. Dealing early ends the betting window and starts
     * the one that clears the felt, and the server used to keep the first
     * timer because a table that is waiting is a table that is waiting — so a
     * hand dealt three seconds into a thirty-second window sat there face up
     * for the remaining twenty-seven.
     */
    const { port } = await startRoom(["Ada", "Bo"], { bettingMs: 30_000, settleMs: 120 });
    const host = await client(port);
    await openWithCompany(port, host);

    await dealLive(host);
    await act(host, { type: "stand" });
    await stateWhere(host, (view) => view.phase === "settled", 3000);

    // Well inside the betting window that dealing interrupted.
    const next = await stateWhere(host, (view) => view.phase === "betting", 3000);
    expect(next.seats[0]?.bet).toBe(0);
  });

  it("comes round on its own, with nobody dealing it", async () => {
    /*
     * The whole point of a continuous table: no host presses anything. A
     * window opens for bets, closes itself, the hand is played, and the felt
     * is cleared for the next one — all on the table's clock.
     */
    // No last call at this table: five seconds of one would shut a window
    // that is only open for a fraction of one, and this test is about the
    // loop coming round rather than about what the felt takes.
    const { port } = await startRoom(["Ada", "Bo"], { bettingMs: 150, settleMs: 120, lastCallMs: 0 });
    const host = await client(port);
    await openWithCompany(port, host);

    // A window that closes with nothing on the felt just opens another.
    const idle = await stateWhere(host, (view) => (view.deadline ?? 0) > 0, 3000);
    expect(idle.phase).toBe("betting");

    await act(host, { type: "bet", amount: 500 });
    // Nobody asked for this hand.
    const dealt = await stateWhere(host, (view) => view.phase !== "betting", 3000);
    expect(dealt.seats[0]?.hands[0]?.cards.length).toBeGreaterThanOrEqual(2);

    // A natural is already settled, and waiting for a second settled state
    // would be waiting for a hand nobody is going to deal.
    if (dealt.phase === "playing") {
      await act(host, { type: "stand" });
      await stateWhere(host, (view) => view.phase === "settled", 3000);
    }

    // And nobody asked for the next one either.
    const again = await stateWhere(host, (view) => view.phase === "betting", 3000);
    expect(again.seats[0]?.bet).toBe(0);
    expect(again.seats[0]?.hands[0]?.cards).toHaveLength(0);
    expect(again.dealer.cards).toHaveLength(0);
    expect(again.deadline).not.toBeNull();
  });

  it("plays a hand for somebody who has walked away", async () => {
    /*
     * A table that deals itself cannot wait forever on one person, and
     * everybody else at it is waiting on the same one. Standing rather than
     * folding: silence should cost a turn, not a stake.
     */
    const { port } = await startRoom(["Ada", "Bo"], { bettingMs: 30_000, turnMs: 150 });
    const host = await client(port);
    await openWithCompany(port, host);
    await dealLive(host);

    const over = await stateWhere(host, (view) => view.phase === "settled", 3000);
    expect(over.seats[0]?.hands.every((hand) => hand.done)).toBe(true);
  });

  it("seats a bot that bets, plays its own hand and costs nobody anything", async () => {
    const { store, port, ids } = await startRoom(["Ada"]);
    const ada = ids[0] as string;
    const host = await client(port);
    // Bots only ever sit at a table playing for nothing: chips are won
    // from real people, and a bot has no account to win them from.
    await open_(host, "Ada", true);

    host.emit("lobby:addBot", { skill: "hard" });
    // It stakes itself without being asked: a bot at a card table has to put
    // something on the felt before there is a hand for it to play.
    const betting = await stateWhere(
      host,
      (view) => view.seats.length === 2 && (view.seats[1]?.bet ?? 0) > 0,
    );
    expect(betting.seats[1]?.isBot).toBe(true);

    // Nothing was taken for it, because there is no account to take it from.
    expect((await store.get(ada))?.chips).toBe(STARTING_CHIPS);

    await act(host, { type: "bet", amount: 500 });
    await act(host, { type: "deal" });
    // The human stands at once, so everything after this is the bot playing
    // itself out — the seam where a bot that has stopped moving looks exactly
    // like a table that has frozen.
    const dealt = await stateWhere(host, (view) => view.phase !== "betting");
    if (dealt.phase === "playing" && dealt.turnSeatId === dealt.seats[0]?.id) {
      await act(host, { type: "stand" });
    }

    // Already settled when both hands were naturals, which happens often
    // enough at a table of two to be worth not waiting for a second time.
    const over =
      dealt.phase === "settled"
        ? dealt
        : await stateWhere(host, (view) => view.phase === "settled", 8000);
    // Every hand it played, because a hard bot may have split into two.
    const botHands = over.seats[1]?.hands ?? [];
    expect(botHands.length).toBeGreaterThanOrEqual(1);
    expect(botHands.every((hand) => hand.outcome !== null)).toBe(true);
    expect(botHands.every((hand) => hand.cards.length >= 2)).toBe(true);
    // A bot never bust while standing pat: it took its own decisions.
    expect(over.turnSeatId).toBeNull();
  });

  it("stops taking chips once last call has gone out", async () => {
    /*
     * A window that is last call from the moment it opens, which is the only
     * way to test the rule without a test that sits through twenty-five
     * seconds of a real one.
     */
    const { port } = await startRoom(["Ada"], { bettingMs: 30_000, lastCallMs: 30_000 });
    const host = await client(port);
    await open_(host, "Ada");
    await stateWhere(host, (view) => view.seats.length === 1);

    const told = host.seen.length;

    const refused = new Promise<string>((resolve) => host.once("room:error", resolve));
    await act(host, { type: "bet", amount: 500 });

    expect(await refused).toMatch(/last call/i);
    // Nothing on the felt, and nothing said about it: a refused bet is not an
    // event, so the table never told anybody anything happened.
    expect(host.seen).toHaveLength(told);
    expect(host.latest?.seats[0]?.bet).toBe(0);
  });

  it("will not take a verb from another game", async () => {
    const { port } = await startRoom(["Ada"]);
    const host = await client(port);
    await open_(host, "Ada");

    const refused = new Promise<string>((resolve) => host.once("room:error", resolve));
    await act(host, { type: "roll" });

    expect(await refused).toMatch(/not something you can do/i);
  });
});

describe("what a stake does when the hand is over", () => {
  it("does not put the same chips back on the felt for the next hand", async () => {
    /*
     * A table that deals itself must not also bet for you. Nobody pressed
     * anything between these two hands, so the second one should find the felt
     * empty — a stake that quietly repeats is chips leaving an account every
     * thirty seconds for a hand its owner never agreed to play.
     */
    const { port } = await startRoom(["Ada", "Bo"], {
      bettingMs: 200,
      settleMs: 80,
      turnMs: 200,
      lastCallMs: 0,
    });
    const host = await client(port);
    await openWithCompany(port, host);

    await act(host, { type: "bet", amount: 500 });
    // A natural settles the hand where it stands, so waiting for a settled
    // state after this one would be waiting for a second hand nobody deals.
    const dealt = await stateWhere(host, (view) => view.phase !== "betting", 3000);
    if (dealt.phase !== "settled") {
      await stateWhere(host, (view) => view.phase === "settled", 4000);
    }

    // The window after that one: nobody has bet in it.
    const next = await stateWhere(host, (view) => view.phase === "betting", 4000);

    expect(next.seats[0]?.bet).toBe(0);
    expect(next.seats[0]?.hands[0]?.cards).toHaveLength(0);
  });
});

describe("what a link can find out before anybody sits down", () => {
  /*
   * Enough to ask somebody to sign in, and no more. A table playing for chips
   * needs an account, and being told that when the link opens is the
   * difference between a link that works and one that drops a stranger on a
   * form for opening a table of their own.
   */
  async function peek(port: number, code: string) {
    const response = await fetch(`http://localhost:${port}/api/table/${code}`);
    return (await response.json()) as { code: string; game: string; forFun: boolean };
  }

  it("says a table plays for chips", async () => {
    const { port } = await startRoom(["Ada"]);
    const host = await client(port);
    await open_(host, "Ada");
    const view = await stateWhere(host, (state) => state.seats.length === 1);

    expect(await peek(port, view.code)).toEqual({
      code: view.code,
      game: "blackjack",
      forFun: false,
    });
  });

  it("says a table plays for nothing", async () => {
    const { port } = await startRoom(["Ada"]);
    const host = await client(port);
    await open_(host, "Ada", true);
    const view = await stateWhere(host, (state) => state.seats.length === 1);

    expect((await peek(port, view.code)).forFun).toBe(true);
  });

  it("tells nobody anything about a table that is not there", async () => {
    const { port } = await startRoom(["Ada"]);
    const response = await fetch(`http://localhost:${port}/api/table/ZZZZZ`);

    expect(response.status).toBe(404);
  });
});

describe("chips are only won from real people", () => {
  it("refuses a bot at a table playing for chips", async () => {
    /*
     * Enforced on the server, not merely left out of the browser. A client is
     * something a player can replace; this is not.
     */
    const { port } = await startRoom(["Ada"]);
    const host = await client(port);
    await open_(host, "Ada");
    await stateWhere(host, (view) => view.seats.length === 1);

    const refused = new Promise<string>((resolve) => host.once("room:error", resolve));
    host.emit("lobby:addBot", { skill: "hard" });

    expect(await refused).toMatch(/playing for fun/i);
    // And no seat was taken while it was being turned down.
    expect(host.latest?.seats).toHaveLength(1);
  });

  it("deals to one player, because the bank is the other side of the hand", async () => {
    /*
     * This table used to wait for company, and the rule it was waiting on has
     * not changed: chips are only won from real people. What changed is who
     * the other people are. The bank holds chips that real players staked, so
     * a lone hand against the dealer is a hand against everybody who played
     * here before — the same footing the machine stands on.
     */
    const { port } = await startRoom(["Ada"], { bettingMs: 150, lastCallMs: 0 });
    const host = await client(port);
    await open_(host, "Ada");
    await stateWhere(host, (view) => view.seats.length === 1);

    await act(host, { type: "bet", amount: 500 });

    const dealt = await stateWhere(host, (view) => view.phase !== "betting", 4000);
    expect(dealt.seats[0]?.hands[0]?.cards.length).toBeGreaterThanOrEqual(2);
    expect(dealt.waitingForPlayers).toBe(false);
  });
});

describe("a player who drops out without leaving", () => {
  it("gives up the seat of somebody who has gone", async () => {
    /*
     * The ordinary way people leave a table: a closed laptop, a tunnel, a
     * phone going to sleep. Nobody presses leave.
     *
     * It used to matter for a second reason — a ghost counted towards the two
     * real players a chips table needed, so a table that never released the
     * seat would deal one live player against nobody. The bank has taken that
     * job over: the house is now a real counterparty, so the table deals on
     * quite legitimately. What is left is the plain version of the rule, which
     * is still worth holding: a seat nobody is in is not a seat.
     */
    const { port } = await startRoom(["Ada", "Bo"], { reconnectGraceMs: 250 });
    const ada = await client(port);
    await open_(ada, "Ada");
    const code = (await stateWhere(ada, (view) => view.seats.length === 1)).code;

    const bo = await client(port);
    await new Promise<void>((resolve) =>
      bo.emit("lobby:join", { name: "Bo", code }, () => resolve()),
    );
    await stateWhere(ada, (view) => view.seats.length === 2);

    bo.close();

    // Marked gone at once, then released once they have not come back.
    const alone = await stateWhere(ada, (view) => view.seats.length === 1, 4000);
    expect(alone.seats[0]?.name).toBe("Ada");
    // And Ada plays on against the bank rather than against a ghost.
    expect(alone.waitingForPlayers).toBe(false);
  });
});

/*
 * The bank, and the property that makes a table against the dealer allowed.
 *
 * Blackjack used to take stakes off accounts and hand winnings back with
 * nothing in between: a player who beat the dealer was paid in chips that did
 * not exist, and one who lost had theirs deleted. It very nearly balanced,
 * which is not the same thing at all.
 */
describe("the bank behind the table", () => {
  it("mints nothing, ever", async () => {
    /*
     * The invariant, and the reason a table is allowed to deal to one player
     * in a building where chips only come from real people. Every chip the
     * player gained came out of the bank; every chip the bank gained came off
     * the player. The two must cancel exactly — not on average, and not by the
     * end of the run, but across every hand.
     */
    const { port, store, ids } = await startRoom(["Ada"], {
      bettingMs: 200,
      lastCallMs: 0,
      turnMs: 200,
    });
    const userId = ids[0] as string;
    const ada = await client(port);
    await open_(ada, "Ada");
    await stateWhere(ada, (view) => view.seats.length === 1);

    const chipsBefore = (await store.get(userId))?.chips ?? 0;
    const bankBefore = await store.bank("blackjack");

    for (let hand = 0; hand < 6; hand += 1) {
      await act(ada, { type: "bet", amount: 100 });
      await stateWhere(ada, (view) => view.phase !== "betting", 5000);
      await stateWhere(ada, (view) => view.phase === "betting", 8000);
    }

    const chipsAfter = (await store.get(userId))?.chips ?? 0;
    const bankAfter = await store.bank("blackjack");
    expect(chipsAfter - chipsBefore + (bankAfter - bankBefore)).toBe(0);
  });

  it("never lets the bank go negative", async () => {
    const { port, store } = await startRoom(["Ada"], {
      bettingMs: 200,
      lastCallMs: 0,
      turnMs: 200,
    });
    const ada = await client(port);
    await open_(ada, "Ada");
    await stateWhere(ada, (view) => view.seats.length === 1);

    for (let hand = 0; hand < 6; hand += 1) {
      await act(ada, { type: "bet", amount: 100 });
      await stateWhere(ada, (view) => view.phase !== "betting", 5000);
      await stateWhere(ada, (view) => view.phase === "betting", 8000);
      expect(await store.bank("blackjack")).toBeGreaterThanOrEqual(0);
    }
  });

  it("refuses a bet the bank could not pay out on", async () => {
    // A thin bank offers a small hand rather than closing the table: the same
    // choice the machine makes, for the same reason.
    const { port, store } = await startRoom(["Ada"], { bank: 4_000 });
    const ada = await client(port);
    await open_(ada, "Ada");
    await stateWhere(ada, (view) => view.seats.length === 1);

    const cap = blackjackMaxStake(await store.bank("blackjack"));
    expect(cap).toBeGreaterThan(0);

    // A refusal comes back as room:error rather than on the ack: the ack only
    // says the server has dealt with the message, refused or not.
    const said = refusal(ada);
    await act(ada, { type: "bet", amount: cap + 1 });
    expect(await said).toMatch(/bank/i);

    // And the felt is untouched by the refusal.
    expect(ada.latest?.seats[0]?.bet ?? 0).toBe(0);
  });

  it("says the table is shut rather than dealing out of an empty bank", async () => {
    const { port } = await startRoom(["Ada"], { bank: 0 });
    const ada = await client(port);
    await open_(ada, "Ada");
    await stateWhere(ada, (view) => view.seats.length === 1);

    const said = refusal(ada);
    await act(ada, { type: "bet", amount: 100 });
    expect(await said).toMatch(/empty|nothing to play for/i);
  });

  it("takes the stake into the bank before the cards are dealt", async () => {
    /*
     * The ordering that the whole payout argument rests on. By the time
     * anything is owed, the chips to pay it are already there.
     */
    const { port, store } = await startRoom(["Ada"], { bettingMs: 30_000 });
    const ada = await client(port);
    await open_(ada, "Ada");
    await stateWhere(ada, (view) => view.seats.length === 1);

    const before = await store.bank("blackjack");
    await act(ada, { type: "bet", amount: 500 });
    // Still betting — nothing has been dealt — and the stake is already in.
    expect((await stateWhere(ada, (view) => (view.seats[0]?.bet ?? 0) > 0)).phase).toBe("betting");
    expect(await store.bank("blackjack")).toBe(before + 500);
  });

  it("gives a withdrawn stake back to the player, not to the bank", async () => {
    const { port, store, ids } = await startRoom(["Ada"], { bettingMs: 30_000 });
    const userId = ids[0] as string;
    const ada = await client(port);
    await open_(ada, "Ada");
    await stateWhere(ada, (view) => view.seats.length === 1);

    const chips = (await store.get(userId))?.chips ?? 0;
    const bank = await store.bank("blackjack");

    await act(ada, { type: "bet", amount: 500 });
    await act(ada, { type: "bet", amount: 0 });

    expect((await store.get(userId))?.chips).toBe(chips);
    expect(await store.bank("blackjack")).toBe(bank);
  });

  it("keeps the machine's bank out of it", async () => {
    // Two banks, and a table that could reach the other one would be the
    // machine paying for the table.
    const { port, store } = await startRoom(["Ada"], {
      bettingMs: 200,
      lastCallMs: 0,
      turnMs: 200,
    });
    await store.bankAdd("slots", 500_000);
    const ada = await client(port);
    await open_(ada, "Ada");
    await stateWhere(ada, (view) => view.seats.length === 1);

    for (let hand = 0; hand < 4; hand += 1) {
      await act(ada, { type: "bet", amount: 100 });
      await stateWhere(ada, (view) => view.phase !== "betting", 5000);
      await stateWhere(ada, (view) => view.phase === "betting", 8000);
    }

    expect(await store.bank("slots")).toBe(500_000);
  });
});
