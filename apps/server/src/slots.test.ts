import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import {
  FUN_PURSE,
  MAX_LINE_PAY,
  maxStake,
  STOPS,
  STRIP,
  type Face,
} from "@backroom/game-slots";
import type { ClientToServer, ServerToClient, SpinNews, SpinResult } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";

/**
 * The machine, tested where the money actually moves.
 *
 * The arithmetic is proven in games/slots and needs no server. What is only
 * reachable here is whether this end wires it up the right way round: that a
 * stake goes into the bank before the reels are drawn, that a win comes out of
 * the bank rather than from nowhere, and that the two always cancel.
 *
 * That last one is the whole reason this game is allowed to exist, so it is
 * asserted on every spin of a long run rather than at the end of one.
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

beforeEach(() => {
  delete process.env["ADMIN_DISCORD_IDS"];
});

interface Machine {
  base: string;
  store: MemoryStore;
  userId: string;
  client: Client;
}

/**
 * A machine with a known bank and a known player at it.
 *
 * `as` is who the server thinks is asking, on the socket and over HTTP alike,
 * which is how a test says "nobody is signed in" without standing up a real
 * sign-in.
 */
async function openMachine(
  options: {
    bank?: number;
    chips?: number;
    signedIn?: boolean;
    discordId?: string;
    spinRandom?: () => number;
  } = {},
): Promise<Machine> {
  const store = new MemoryStore();
  const player = await store.upsertDiscordUser({
    discordId: options.discordId ?? "d1",
    name: "Ada",
    avatar: null,
    accentColor: null,
  });
  if (options.chips !== undefined) {
    const current = (await store.get(player.id))?.chips ?? 0;
    await store.adjustChips(player.id, options.chips - current);
  }
  if (options.bank !== undefined && options.bank > 0) {
    await store.bankAdd("slots", options.bank);
  }

  const as = options.signedIn === false ? null : player.id;
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify: () => as,
    identifyRequest: () => as,
    ...(options.spinRandom === undefined ? {} : { spinRandom: options.spinRandom }),
  });
  await new Promise<void>((resolve) => server?.http.listen(0, () => resolve()));
  const port = (server.http.address() as AddressInfo).port;

  const client: Client = connect(`http://localhost:${port}`, {
    transports: ["websocket"],
    forceNew: true,
  });
  open.push(client);
  await new Promise<void>((resolve) => client.on("connect", () => resolve()));

  return { base: `http://localhost:${port}`, store, userId: player.id, client };
}

/** A second player at the same server, for anything about two of them. */
async function another(base: string): Promise<Client> {
  const socket: Client = connect(base, { transports: ["websocket"], forceNew: true });
  open.push(socket);
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
  return socket;
}

/*
 * Reels that cannot pay and cannot trigger the bonus.
 *
 * Alternating stops on two faces that never meet, so no payline reads a run of
 * two, let alone three — and neither window touches the bonus stop, which sits
 * alone at the end of the strip. Both of those matter: a "losing" reel that
 * quietly scattered three bonuses would hand out free spins, and a test
 * counting what a purse paid for would then be counting spins nobody paid for.
 */
function losing(): () => number {
  let call = 0;
  return () => {
    call += 1;
    return call % 2 === 1 ? TUMBLERS : DICE;
  };
}

/*
 * Windows onto the strip, named rather than written as fractions at the call
 * site. FACES runs commonest first and WEIGHTS says how many stops each holds,
 * so these are where each face's run begins — and a reel shows three
 * consecutive stops from wherever it lands.
 */
const TUMBLERS = 0;
const DICE = 15 / 32;
const SEVENS = 28 / 32;

function spin(client: Client, stake: number): Promise<SpinResult> {
  return new Promise((resolve) => client.emit("slots:spin", { stake }, resolve));
}

function play(client: Client, stake: number): Promise<SpinResult> {
  return new Promise((resolve) => client.emit("slots:spin", { stake, forFun: true }, resolve));
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("a spin", () => {
  it("takes the stake and settles inside what the paytable can owe", async () => {
    const { client, store, userId } = await openMachine({ bank: 50_000 });
    const before = (await store.get(userId))?.chips ?? 0;

    const result = await spin(client, 10);

    expect(result.ok).toBe(true);
    const after = (await store.get(userId))?.chips ?? 0;
    // Whatever the reels did: ten chips left, and anything won came back.
    expect(after).toBeGreaterThanOrEqual(before - 10);
    expect(after).toBeLessThanOrEqual(before - 10 + MAX_LINE_PAY * 10);
  });

  it("mints nothing, ever", async () => {
    /*
     * The invariant, and the reason a machine is allowed in a building where
     * chips only come from real people. Every chip the player gained came out
     * of the bank; every chip the bank gained came off the player. The two
     * deltas must cancel exactly — not on average, and not by the end of the
     * run, but on every single spin.
     */
    const { client, store, userId } = await openMachine({ bank: 500_000, chips: 100_000 });
    for (let n = 0; n < 200; n += 1) {
      const chipsBefore = (await store.get(userId))?.chips ?? 0;
      const bankBefore = await store.bank("slots");

      await spin(client, 5);

      const chipsAfter = (await store.get(userId))?.chips ?? 0;
      const bankAfter = await store.bank("slots");
      expect(chipsAfter - chipsBefore + (bankAfter - bankBefore)).toBe(0);
    }
  });

  it("never lets the bank go negative", async () => {
    const { client, store } = await openMachine({ bank: 500_000, chips: 100_000 });
    for (let n = 0; n < 200; n += 1) {
      await spin(client, 5);
      expect(await store.bank("slots")).toBeGreaterThanOrEqual(0);
    }
  });

  it("says what it paid, and pays exactly that", async () => {
    const { client, store, userId } = await openMachine({ bank: 500_000, chips: 100_000 });
    for (let n = 0; n < 50; n += 1) {
      const before = (await store.get(userId))?.chips ?? 0;
      const result = await spin(client, 5);
      const after = (await store.get(userId))?.chips ?? 0;
      if (result.ok) {
        /*
         * The number on the glass is the number in the account. A free spin
         * cost nothing, so what it moved is the whole of what it won — and
         * fifty spins is long enough that the bonus turns up often enough for
         * assuming otherwise to be a test that fails one run in three.
         */
        const cost = result.wasFree ? 0 : 5;
        expect(after - before).toBe(result.won - cost);
        expect(result.balance).toBe(after);
        expect(result.bank).toBe(await store.bank("slots"));
      }
    }
  });

  it("refuses a stake above what the bank can cover", async () => {
    const { client } = await openMachine({ bank: 50_000 });
    const result = await spin(client, maxStake(50_000) + 1);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/bank/i);
  });

  it("puts nothing on the felt when it refuses", async () => {
    const { client, store, userId } = await openMachine({ bank: 50_000 });
    const before = (await store.get(userId))?.chips ?? 0;
    const bank = await store.bank("slots");

    await spin(client, maxStake(50_000) + 1);

    expect((await store.get(userId))?.chips).toBe(before);
    expect(await store.bank("slots")).toBe(bank);
  });

  it("refuses a stake the player cannot cover", async () => {
    const { client, store } = await openMachine({ bank: 5_000_000, chips: 3 });
    const bank = await store.bank("slots");
    const result = await spin(client, 10);
    expect(result.ok).toBe(false);
    // And the bank did not quietly keep a stake that was never paid.
    expect(await store.bank("slots")).toBe(bank);
  });

  it("refuses a stake that is not a positive whole number", async () => {
    const { client } = await openMachine({ bank: 500_000 });
    for (const stake of [0, -5, 1.5, Number.NaN]) {
      expect((await spin(client, stake)).ok).toBe(false);
    }
  });

  it("will not spin at all on an empty bank", async () => {
    // maxStake(0) is 0, so there is no stake the machine can offer.
    const { client } = await openMachine({ bank: 0 });
    const result = await spin(client, 1);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/empty/i);
  });

  it("refuses somebody who is not signed in", async () => {
    const { client } = await openMachine({ bank: 500_000, signedIn: false });
    const result = await spin(client, 5);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/sign in/i);
  });

  it("sends back a grid the client can actually draw", async () => {
    const { client } = await openMachine({ bank: 500_000 });
    const result = await spin(client, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.grid).toHaveLength(5);
    for (const column of result.grid) {
      expect(column).toHaveLength(3);
      for (const face of column) {
        expect(typeof face).toBe("string");
        expect(face.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps a count of what the player has done at it", async () => {
    const { client, store, userId } = await openMachine({ bank: 500_000, chips: 100_000 });
    await spin(client, 5);
    await spin(client, 5);
    const profile = await store.get(userId);
    expect(profile?.byGame["slots"]?.["spins"]).toBe(2);
    expect(profile?.byGame["slots"]?.["staked"]).toBe(10);
  });
});

describe("stocking the bank", () => {
  it("lets an admin float it", async () => {
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    const { base, store } = await openMachine({ bank: 0, discordId: "d-admin" });

    const response = await post(`${base}/api/admin/bank`, { amount: 50_000 });

    expect(response.status).toBe(200);
    expect(response.body["bank"]).toBe(50_000);
    // What the machine may then offer, derived from the paytable's top line.
    expect(response.body["maxStake"]).toBe(maxStake(50_000));
    expect(response.body["maxStake"]).toBeGreaterThan(0);
    expect(await store.bank("slots")).toBe(50_000);
  });

  it("refuses anybody who is not an admin", async () => {
    /*
     * This is the only way chips enter the bank from outside play, which makes
     * it one of the ways to make chips exist. It is guarded exactly as minting
     * a redemption code is, and for the same reason.
     */
    process.env["ADMIN_DISCORD_IDS"] = "d-somebody-else";
    const { base, store } = await openMachine({ bank: 0, discordId: "d1" });

    const response = await post(`${base}/api/admin/bank`, { amount: 50_000 });

    // 404 rather than 403, in step with every other admin route: whether this
    // endpoint exists is not something an unauthorised visitor needs to learn.
    expect(response.status).toBe(404);
    expect(await store.bank("slots")).toBe(0);
  });

  it("refuses everybody when the admin list is unset", async () => {
    // admin.ts fails closed, and so does this.
    const { base, store } = await openMachine({ bank: 0, discordId: "d-admin" });
    expect((await post(`${base}/api/admin/bank`, { amount: 500 })).status).toBe(404);
    expect(await store.bank("slots")).toBe(0);
  });

  it("refuses an amount that is not a positive whole number", async () => {
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    const { base, store } = await openMachine({ bank: 0, discordId: "d-admin" });
    for (const amount of [0, -1, 2.5, "lots", null]) {
      expect((await post(`${base}/api/admin/bank`, { amount })).status).toBe(400);
    }
    expect(await store.bank("slots")).toBe(0);
  });

  it("reports what the bank holds and what it can therefore offer", async () => {
    process.env["ADMIN_DISCORD_IDS"] = "d-admin";
    const { base } = await openMachine({ bank: 1_000_000, discordId: "d-admin" });
    const response = await fetch(`${base}/api/admin/bank`);
    expect(await response.json()).toEqual({
      bank: 1_000_000,
      maxStake: maxStake(1_000_000),
    });
  });
});

describe("where the reels come from", () => {
  it("does not take its randomness from Math.random", async () => {
    /*
     * V8 implements Math.random as xorshift128+, and this machine hands the
     * player the whole grid after every spin — which is exactly the run of
     * observations needed to recover that generator's state and predict what
     * is coming. With the jackpot at 40% of the bank and the stake cap rising
     * alongside it, knowing when it lands is worth real money.
     *
     * Pinning Math.random to a constant would freeze every reel if the machine
     * were using it. The grids have to keep moving.
     */
    const real = Math.random;
    Math.random = () => 0.5;
    try {
      const { client } = await openMachine({ bank: 500_000, chips: 100_000 });
      const grids = new Set<string>();
      for (let n = 0; n < 12; n += 1) {
        const result = await spin(client, 1);
        if (result.ok) {
          grids.add(JSON.stringify(result.grid));
        }
      }
      expect(grids.size).toBeGreaterThan(1);
    } finally {
      Math.random = real;
    }
  });
});

describe("the jackpot", () => {
  /*
   * Stops 29, 30 and 31 of the strip are the three sevens, so a reel that
   * lands on 29 shows nothing else. Every reel landing there fills the grid
   * with sevens and lights all nine paylines at once — one spin in 10^15,
   * and the only arrangement that could make this machine mint chips.
   */
  const allSevens = () => SEVENS;

  it("pays a share of the bank the stake has just gone into", async () => {
    const { client, store, userId } = await openMachine({
      bank: 500_000,
      chips: 100_000,
      spinRandom: allSevens,
    });
    const chipsBefore = (await store.get(userId))?.chips ?? 0;

    const result = await spin(client, 10);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.jackpot).toBe(true);
    // 40% of 500,010 — the bank with the stake already in it.
    expect(result.won).toBe(200_004);
    expect((await store.get(userId))?.chips).toBe(chipsBefore - 10 + 200_004);
    expect(await store.bank("slots")).toBe(500_000 + 10 - 200_004);
  });

  it("pays once, not once per line", async () => {
    /*
     * Nine lines all read five sevens here. Paid per line this would be 360%
     * of the bank, and the machine would owe chips that were never staked.
     */
    const { client, store } = await openMachine({
      bank: 500_000,
      chips: 100_000,
      spinRandom: allSevens,
    });
    const result = await spin(client, 10);
    expect(result.ok && result.won).toBe(200_004);
    expect(await store.bank("slots")).toBeGreaterThan(0);
  });

  it("still leaves the bank solvent at the largest stake the cap allows", async () => {
    // The worst spin the machine can be asked for, actually played.
    const bank = 500_000;
    const { client, store } = await openMachine({
      bank,
      chips: 10_000_000,
      spinRandom: allSevens,
    });
    // The most this bank can certainly cover.
    const result = await spin(client, maxStake(bank));
    expect(result.ok).toBe(true);
    expect(await store.bank("slots")).toBeGreaterThanOrEqual(0);
  });
});

describe("the sign on the machine", () => {
  it("says what the bank holds without anybody signing in", async () => {
    // The bank is the whole appeal of this game; a sign only members can read
    // advertises nothing.
    const { base } = await openMachine({ bank: 250_000, signedIn: false });
    const body = await (await fetch(`${base}/api/slots`)).json();
    expect(body).toEqual({ bank: 250_000, maxStake: maxStake(250_000), jackpot: 100_000 });
  });

  it("says nothing about who is playing", async () => {
    const { base } = await openMachine({ bank: 250_000 });
    const body = (await (await fetch(`${base}/api/slots`)).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["bank", "jackpot", "maxStake"]);
  });
});

describe("the machine played for nothing", () => {
  it("never touches the account or the house bank", async () => {
    /*
     * The whole point of the mode, and the rule it has to keep: play money
     * never touches an account. A hundred spins of it must leave the player's
     * chips and the house bank exactly where they were — win, lose or jackpot.
     */
    const { client, store, userId } = await openMachine({ bank: 500_000, chips: 10_000 });
    const chipsBefore = (await store.get(userId))?.chips ?? 0;
    const bankBefore = await store.bank("slots");

    for (let n = 0; n < 100; n += 1) {
      expect((await play(client, 250)).ok).toBe(true);
    }

    expect((await store.get(userId))?.chips).toBe(chipsBefore);
    expect(await store.bank("slots")).toBe(bankBefore);
  });

  it("plays without an account at all", async () => {
    // Nobody signs in to play for nothing.
    const { client } = await openMachine({ bank: 0, signedIn: false });
    expect((await play(client, 100)).ok).toBe(true);
  });

  it("takes the whole tray from the first pull", async () => {
    // Its bank is seeded past 1296 x the largest chip, so nothing on the tray
    // is greyed out waiting for an imaginary bank to fill.
    const { client } = await openMachine({ bank: 0, signedIn: false });
    for (const stake of [100, 250, 500, 1000, 5000]) {
      expect((await play(client, stake)).ok, `${stake} was refused`).toBe(true);
    }
  });

  it("moves play money between its own purse and its own bank", async () => {
    const { client } = await openMachine({ bank: 0, signedIn: false });
    let purse: number | null = null;
    let bank: number | null = null;
    for (let n = 0; n < 60; n += 1) {
      const result = await play(client, 100);
      if (!result.ok) {
        throw new Error(result.error);
      }
      if (purse !== null && bank !== null) {
        // Same closed loop as the real machine: nothing appears, nothing goes.
        expect(result.balance - purse + (result.bank - bank)).toBe(0);
      }
      purse = result.balance;
      bank = result.bank;
    }
  });

  it("refuses a stake the purse cannot cover rather than inventing it", async () => {
    // Play money still has to add up. Running low means smaller spins, the
    // same as anywhere else — it is only running *out* that is forgiven.
    const { client } = await openMachine({ bank: 0, signedIn: false, spinRandom: losing() });
    // 25,000 in the purse, so the fifth of these is the last it can cover.
    for (let n = 0; n < 4; n += 1) {
      expect((await play(client, 5000)).ok).toBe(true);
    }
    const broke = await play(client, 5000);
    expect(broke.ok).toBe(true);
    // That last one emptied it, so it was topped back up.
    expect(broke.ok && broke.balance).toBe(FUN_PURSE);
  });

  it("tops a dry purse back up rather than ending the evening", async () => {
    /*
     * There is nothing to protect at a machine playing for nothing, so running
     * out ends a spin rather than the session — the same way a for-fun table
     * already refills a seat that cannot cover the minimum.
     *
     * Driven dry on a scripted reel rather than hoped for: at 90% return a
     * purse wanders down slowly, and a test that waited for luck would be a
     * test that failed one run in twenty.
     */
    const { client } = await openMachine({ bank: 0, signedIn: false, spinRandom: losing() });
    let sawItRefill = false;
    let previous = FUN_PURSE;
    for (let n = 0; n < 20; n += 1) {
      const result = await play(client, 5000);
      if (!result.ok) {
        throw new Error(result.error);
      }
      expect(result.won).toBe(0); // the scripted reels never pay
      if (result.balance > previous) {
        sawItRefill = true;
      }
      previous = result.balance;
      expect(result.balance).toBeGreaterThan(0);
    }
    expect(sawItRefill).toBe(true);
  });

  it("keeps one player's play money away from another's", async () => {
    const first = await openMachine({ bank: 0, signedIn: false });
    const second = await another(first.base);

    const a = await play(first.client, 5000);
    const b = await play(second, 100);

    // Two machines, two purses. The second player has just arrived.
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.balance).not.toBe(b.balance);
    }
  });

  it("records nothing, because nothing happened", async () => {
    const { client, store, userId } = await openMachine({ bank: 500_000, chips: 10_000 });
    await play(client, 250);
    const profile = await store.get(userId);
    expect(profile?.byGame["slots"]).toBeUndefined();
    expect(profile?.stats.games).toBe(0);
  });
});

function watch(client: Client): Promise<SpinNews[]> {
  return new Promise((resolve) => client.emit("slots:watch", {}, resolve));
}

describe("the wall at the machine", () => {
  it("tells everybody standing there what somebody just won", async () => {
    const { client, base } = await openMachine({ bank: 500_000, chips: 100_000 });
    const bystander = await another(base);
    await watch(bystander);

    const heard = new Promise<SpinNews>((resolve) =>
      bystander.on("slots:spun", (spun) => resolve(spun)),
    );
    await spin(client, 100);
    const spun = await heard;

    expect(spun.stake).toBe(100);
    expect(spun.name).toBe("Ada");
    expect(typeof spun.id).toBe("string");
  });

  it("says nothing to somebody who is not at the machine", async () => {
    /*
     * A room they never walked into. Broadcasting to every socket on the
     * server would put the slot machine's noise on the blackjack felt.
     */
    const { client, base } = await openMachine({ bank: 500_000, chips: 100_000 });
    const elsewhere = await another(base);

    let heard = 0;
    elsewhere.on("slots:spun", () => {
      heard += 1;
    });
    await spin(client, 100);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(heard).toBe(0);
  });

  it("keeps quiet about play money", async () => {
    /*
     * A for-fun purse was never anybody's. Putting its wins on the wall would
     * advertise a machine busier than it is, which is the one thing a wall
     * like this must not do.
     */
    const { client, base } = await openMachine({ bank: 500_000, chips: 100_000 });
    const bystander = await another(base);
    await watch(bystander);

    let heard = 0;
    bystander.on("slots:spun", () => {
      heard += 1;
    });
    await play(client, 500);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(heard).toBe(0);
  });

  it("hands somebody who has just walked up what they missed", async () => {
    /*
     * So a machine that has been played does not look untouched.
     *
     * On scripted reels, because this asserts what each spin cost. On real
     * ones the first spin can trigger the bonus, which makes the second a free
     * one — it replays the first bet and goes up the wall at nothing, because
     * that is what it cost. About one run in seventy, which is exactly often
     * enough to look like a flake and not often enough to be found.
     */
    const { client, base } = await openMachine({
      bank: 500_000,
      chips: 100_000,
      spinRandom: losing(),
    });
    await spin(client, 100);
    await spin(client, 250);

    const latecomer = await another(base);
    const backlog = await watch(latecomer);

    expect(backlog).toHaveLength(2);
    // Newest first, so the top of the wall is the thing that just happened.
    expect(backlog[0]?.stake).toBe(250);
    expect(backlog[1]?.stake).toBe(100);
  });

  it("stops telling somebody who has walked away", async () => {
    const { client, base } = await openMachine({ bank: 500_000, chips: 100_000 });
    const leaver = await another(base);
    await watch(leaver);
    leaver.emit("slots:away");
    await new Promise((resolve) => setTimeout(resolve, 80));

    let heard = 0;
    leaver.on("slots:spun", () => {
      heard += 1;
    });
    await spin(client, 100);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(heard).toBe(0);
  });
});

function spinLines(client: Client, stake: number, lines: number): Promise<SpinResult> {
  return new Promise((resolve) => client.emit("slots:spin", { stake, lines }, resolve));
}

describe("buying fewer lines", () => {
  it("takes the stake and says how it was spread", async () => {
    const { client } = await openMachine({ bank: 5_000_000, chips: 1_000_000 });
    const result = await spinLines(client, 300, 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stake).toBe(300);
      expect(result.linesPlayed).toBe(3);
      // Nothing can pay on a line nobody bought.
      for (const line of result.lines) {
        expect(line.line).toBeLessThan(3);
      }
    }
  });

  it("mints nothing however the stake is spread", async () => {
    /*
     * The invariant again, because line betting is exactly the sort of change
     * that could quietly break it: a stake split one way and paid out another
     * is chips appearing from the gap.
     */
    const { client, store, userId } = await openMachine({ bank: 5_000_000, chips: 1_000_000 });
    for (const lines of [1, 2, 3, 5, 9]) {
      for (let n = 0; n < 20; n += 1) {
        const chipsBefore = (await store.get(userId))?.chips ?? 0;
        const bankBefore = await store.bank("slots");
        await spinLines(client, 90 * lines, lines);
        const chipsAfter = (await store.get(userId))?.chips ?? 0;
        expect(chipsAfter - chipsBefore + ((await store.bank("slots")) - bankBefore)).toBe(0);
      }
    }
  });

  it("refuses a line count the machine does not have", async () => {
    const { client } = await openMachine({ bank: 5_000_000, chips: 1_000_000 });
    for (const lines of [0, -1, 10, 2.5]) {
      expect((await spinLines(client, 900, lines)).ok, `${lines} was allowed`).toBe(false);
    }
  });

  it("plays all nine when a client says nothing about lines", async () => {
    // An older client, and the machine as it was before anybody could choose.
    const { client } = await openMachine({ bank: 5_000_000, chips: 1_000_000 });
    const result = await spin(client, 900);
    expect(result.ok && result.linesPlayed).toBe(9);
  });
});

/*
 * The windows the scripted reels above point at, checked against the strip
 * itself.
 *
 * These tests script the reels by handing the machine a number and relying on
 * where that lands. That is the strip's layout, and the strip is a table
 * somebody may retune — when the bonus went in, one stop came out of the
 * tumbler's nine and every window after it moved by one, which silently turned
 * "all sevens" into two sevens and a bonus and "losing" into a bonus trigger
 * every other spin. Both tests still passed something; neither tested what it
 * said. This is what makes that fail loudly instead.
 */
describe("the scripted reels", () => {
  const windowAt = (value: number): Face[] => {
    const at = Math.floor(value * STOPS) % STOPS;
    return [0, 1, 2].map((offset) => STRIP[(at + offset) % STOPS] as Face);
  };

  it("lands three sevens where the tests say it does", () => {
    expect(windowAt(SEVENS)).toEqual(["seven", "seven", "seven"]);
  });

  it("lands the losing reels on two faces that never meet, and never on a bonus", () => {
    expect(windowAt(TUMBLERS)).toEqual(["tumbler", "tumbler", "tumbler"]);
    expect(windowAt(DICE)).toEqual(["dice", "dice", "dice"]);
    for (const window of [windowAt(TUMBLERS), windowAt(DICE), windowAt(SEVENS)]) {
      expect(window).not.toContain("bonus");
    }
  });
});

/*
 * The bonus.
 *
 * Three of them anywhere on the glass and the machine owes a run of spins
 * nobody paid for. Which makes this the one feature here that can pay out
 * without anything coming in, so what it must never do is more interesting
 * than what it does.
 */
describe("the free spins", () => {
  /** A reel that lands the bonus on the first three reels and nothing after. */
  function scatters(count: number): () => number {
    let reel = 0;
    return () => {
      const at = reel < count ? 31 / 32 : TUMBLERS;
      reel = (reel + 1) % 5;
      return at;
    };
  }

  it("awards a run of spins for three bonuses anywhere", async () => {
    const { client } = await openMachine({
      bank: 5_000_000,
      chips: 100_000,
      spinRandom: scatters(3),
    });
    const result = await spin(client, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scatters).toBe(3);
    expect(result.awarded).toBeGreaterThan(0);
    expect(result.freeLeft).toBe(result.awarded);
    expect(result.wasFree).toBe(false);
  });

  it("takes nothing from the player for the spins it owes them", async () => {
    const { client, store, userId } = await openMachine({
      bank: 5_000_000,
      chips: 100_000,
      spinRandom: scatters(3),
    });
    await spin(client, 10);
    const after = (await store.get(userId))?.chips ?? 0;
    const bankAfter = await store.bank("slots");

    const free = await spin(client, 10);

    expect(free.ok).toBe(true);
    if (!free.ok) {
      return;
    }
    expect(free.wasFree).toBe(true);
    // The player is no poorer and the bank is no richer: nothing was staked.
    expect((await store.get(userId))?.chips).toBe(after + free.won);
    expect(await store.bank("slots")).toBe(bankAfter - free.won);
  });

  it("stakes what the spin cost, and a free spin costs nothing", async () => {
    const stake = 10;
    const { client, store, userId } = await openMachine({
      bank: 5_000_000,
      chips: 100_000,
      spinRandom: scatters(3),
    });
    await spin(client, stake);
    const free = await spin(client, stake);
    expect(free.ok).toBe(true);
    if (!free.ok) {
      return;
    }
    expect(free.wasFree).toBe(true);

    // The triggering spin staked once; the free spin it paid for staked nothing.
    const profile = await store.get(userId);
    expect(profile?.stats.chipsStaked).toBe(stake);
  });

  it("counts them down and stops", async () => {
    const { client } = await openMachine({
      bank: 5_000_000,
      chips: 100_000,
      spinRandom: scatters(3),
    });
    const trigger = await spin(client, 10);
    expect(trigger.ok).toBe(true);
    if (!trigger.ok) {
      return;
    }

    let left = trigger.freeLeft;
    while (left > 0) {
      const free = await spin(client, 10);
      expect(free.ok).toBe(true);
      if (!free.ok) {
        return;
      }
      expect(free.wasFree).toBe(true);
      expect(free.freeLeft).toBe(left - 1);
      left = free.freeLeft;
    }

    // And the next one is a spin the player pays for again.
    const paid = await spin(client, 10);
    expect(paid.ok && paid.wasFree).toBe(false);
  });

  it("does not let free spins award more free spins", async () => {
    /*
     * Every reel scattering on every spin. If a free spin could retrigger,
     * this would never end and the return would be a series rather than a
     * sum — so the count has to come down even when the reels are handing out
     * five bonuses a spin.
     */
    const { client } = await openMachine({
      bank: 5_000_000,
      chips: 100_000,
      spinRandom: () => 31 / 32,
    });
    const trigger = await spin(client, 10);
    expect(trigger.ok).toBe(true);
    if (!trigger.ok) {
      return;
    }
    expect(trigger.scatters).toBe(5);

    let left = trigger.freeLeft;
    for (let n = 0; n < trigger.freeLeft; n += 1) {
      const free = await spin(client, 10);
      expect(free.ok).toBe(true);
      if (!free.ok) {
        return;
      }
      expect(free.scatters).toBe(5);
      expect(free.awarded).toBe(0);
      expect(free.freeLeft).toBeLessThan(left);
      left = free.freeLeft;
    }
    expect(left).toBe(0);
  });

  it("replays the bet that won them rather than one chosen afterwards", async () => {
    /*
     * Otherwise the play is to trigger the bonus on the smallest stake the
     * machine takes and claim the eight on the largest — being paid at a stake
     * nobody ever put up, which is the one thing this whole game is built not
     * to allow.
     */
    const { client, store, userId } = await openMachine({
      bank: 5_000_000,
      chips: 10_000_000,
      spinRandom: scatters(3),
    });
    await spin(client, 10);
    const before = (await store.get(userId))?.chips ?? 0;

    const free = await spin(client, 3000);

    expect(free.ok).toBe(true);
    if (!free.ok) {
      return;
    }
    // The stake it actually played, not the one that was asked for.
    expect(free.stake).toBe(10);
    // And nothing was taken for it either way.
    expect((await store.get(userId))?.chips).toBe(before + free.won);
  });

  it("never pays out more than the bank holds, however long the run", async () => {
    /*
     * The property the whole machine rests on, asked of the one thing that can
     * pay without anything coming in. Every reel sevens, so every free spin
     * takes the jackpot's share of a bank nothing is refilling.
     */
    const { client, store } = await openMachine({
      bank: 500_000,
      chips: 10_000_000,
      spinRandom: () => SEVENS,
    });
    for (let n = 0; n < 12; n += 1) {
      const result = await spin(client, maxStake(await store.bank("slots")));
      if (!result.ok) {
        break;
      }
      expect(await store.bank("slots")).toBeGreaterThanOrEqual(0);
    }
    expect(await store.bank("slots")).toBeGreaterThanOrEqual(0);
  });

  it("does not let two pulls at once stretch the run", async () => {
    /*
     * `freeSpins` is keyed by account so there is one run rather than two —
     * which is what its comment claims and is true. What keying by account
     * does not do is decide who is pulling: the handler reads `owed.left`,
     * then awaits the bank, the debit, the payout and the record before
     * writing the decremented count back. Two pulls in flight both read the
     * same number and both write the same one, and the run outlives its award.
     *
     * Two windows is the easy way to arrange that. One window and two presses
     * is the same arrangement, which is why closing it is a lock rather than a
     * rule about windows.
     */
    const { client } = await openMachine({
      bank: 5_000_000,
      chips: 100_000,
      spinRandom: scatters(3),
    });
    const trigger = await spin(client, 10);
    expect(trigger.ok).toBe(true);
    if (!trigger.ok) {
      return;
    }
    const owed = trigger.freeLeft;
    expect(owed).toBeGreaterThan(1);

    // Both emitted before either is answered, which is the whole point.
    const [a, b] = await Promise.all([spin(client, 10), spin(client, 10)]);

    /*
     * One of them is a spin and the other is refused, or they are answered in
     * turn — either is fine. What is not fine is two free spins that between
     * them cost the run one.
     */
    const counts = [a, b]
      .filter((result) => result.ok && result.wasFree)
      .map((result) => (result.ok ? result.freeLeft : -1))
      .sort((one, two) => one - two);
    if (counts.length === 2) {
      expect(counts).toEqual([owed - 2, owed - 1]);
    } else {
      expect(counts).toEqual([owed - 1]);
    }
  });
});
