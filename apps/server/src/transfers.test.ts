import type { AddressInfo } from "node:net";
import { DAILY_SEND_CAP, MemoryStore, STARTING_CHIPS } from "@backroom/economy";
import { afterEach, describe, expect, it } from "vitest";
import { createBackRoomServer } from "./server.js";
import type { BackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * Paying another player, over real HTTP.
 *
 * The rules themselves are tested in `@backroom/economy`, against the store
 * where they can be pushed at without a server in the way. What is only
 * reachable here is everything the building wraps around them: that none of it
 * is open to somebody signed out, that a search says who people are and never
 * what they hold, and that an amount is decided by the server rather than
 * offered by the client.
 */

let server: BackRoomServer | null = null;

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
});

/** A room where the signed-in player is whoever we say. */
async function start(store: MemoryStore, as: string | null): Promise<string> {
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify: () => as,
    identifyRequest: () => as,
  });
  await listenForFetch(server.http);
  return `http://localhost:${(server.http.address() as AddressInfo).port}`;
}

async function player(store: MemoryStore, discordId: string, name: string) {
  return store.upsertDiscordUser({ discordId, name, avatar: null, accentColor: null });
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

async function get(url: string) {
  const response = await fetch(url);
  const text = await response.text();
  return {
    status: response.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

const chipsOf = async (store: MemoryStore, id: string) => (await store.get(id))?.chips ?? -1;

describe("sending chips", () => {
  it("moves them, and says what is left of the day", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const bo = await player(store, "d2", "Bo");
    const base = await start(store, ada.id);

    const sent = await post(`${base}/api/send`, { toId: bo.id, amount: 750 });

    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({
      ok: true,
      amount: 750,
      balance: STARTING_CHIPS - 750,
      leftToday: DAILY_SEND_CAP - 750,
    });
    expect(await chipsOf(store, ada.id)).toBe(STARTING_CHIPS - 750);
    expect(await chipsOf(store, bo.id)).toBe(STARTING_CHIPS + 750);
  });

  /* Nothing here may mint. The pair holds what it held. */
  it("conserves what the two of them hold between them", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const bo = await player(store, "d2", "Bo");
    const base = await start(store, ada.id);
    const before = (await chipsOf(store, ada.id)) + (await chipsOf(store, bo.id));

    await post(`${base}/api/send`, { toId: bo.id, amount: 400 });

    expect((await chipsOf(store, ada.id)) + (await chipsOf(store, bo.id))).toBe(before);
  });

  it("refuses somebody who is not signed in, and moves nothing", async () => {
    const store = new MemoryStore();
    const bo = await player(store, "d2", "Bo");
    const base = await start(store, null);

    const sent = await post(`${base}/api/send`, { toId: bo.id, amount: 100 });

    expect(sent.status).toBe(401);
    expect(await chipsOf(store, bo.id)).toBe(STARTING_CHIPS);
  });

  it("refuses more than the sender holds", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const bo = await player(store, "d2", "Bo");
    const base = await start(store, ada.id);

    const sent = await post(`${base}/api/send`, { toId: bo.id, amount: STARTING_CHIPS + 1 });

    expect(sent.status).toBe(400);
    expect(sent.body["error"]).toMatch(/do not have/i);
    expect(await chipsOf(store, ada.id)).toBe(STARTING_CHIPS);
  });

  it("refuses paying yourself", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const base = await start(store, ada.id);

    const sent = await post(`${base}/api/send`, { toId: ada.id, amount: 10 });

    expect(sent.status).toBe(400);
    expect(await chipsOf(store, ada.id)).toBe(STARTING_CHIPS);
  });

  it("refuses a recipient who does not exist", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const base = await start(store, ada.id);

    expect((await post(`${base}/api/send`, { toId: "nobody", amount: 10 })).status).toBe(400);
    expect((await post(`${base}/api/send`, { amount: 10 })).status).toBe(400);
    expect(await chipsOf(store, ada.id)).toBe(STARTING_CHIPS);
  });

  it("refuses an amount that is not a whole number of chips", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const bo = await player(store, "d2", "Bo");
    const base = await start(store, ada.id);

    for (const amount of [0, -100, 2.5, "500", null]) {
      expect((await post(`${base}/api/send`, { toId: bo.id, amount })).status).toBe(400);
    }
    expect(await chipsOf(store, bo.id)).toBe(STARTING_CHIPS);
  });

  /*
   * The daily top-up is a faucet per account, so without this a pile of alt
   * accounts is a chip printer pointed at one profile. It does not stop that;
   * it decides how fast it can run.
   */
  it("stops once the day's allowance is spent", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const bo = await player(store, "d2", "Bo");
    await store.adjustChips(ada.id, DAILY_SEND_CAP * 2);
    const base = await start(store, ada.id);

    const first = await post(`${base}/api/send`, { toId: bo.id, amount: DAILY_SEND_CAP });
    const over = await post(`${base}/api/send`, { toId: bo.id, amount: 1 });

    expect(first.status).toBe(200);
    expect(over.status).toBe(400);
    expect(over.body).toMatchObject({ leftToday: 0 });
    expect(over.body["error"]).toMatch(/today/i);
  });

  it("writes every transfer down for both ends", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const bo = await player(store, "d2", "Bo");
    const base = await start(store, ada.id);
    await post(`${base}/api/send`, { toId: bo.id, amount: 300 });

    const mine = await get(`${base}/api/transfers`);

    expect(mine.body["leftToday"]).toBe(DAILY_SEND_CAP - 300);
    expect(mine.body["transfers"]).toMatchObject([
      { fromName: "Ada", toName: "Bo", amount: 300 },
    ]);
  });

  it("keeps a ledger private to the person whose it is", async () => {
    const store = new MemoryStore();
    await player(store, "d1", "Ada");
    const base = await start(store, null);

    expect((await get(`${base}/api/transfers`)).status).toBe(401);
  });
});

describe("finding somebody to pay", () => {
  it("matches on the start of a name", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    await player(store, "d2", "Adam");
    await player(store, "d3", "Bo");
    const base = await start(store, ada.id);

    const found = await get(`${base}/api/players?q=ad`);

    expect((found.body["players"] as Array<{ name: string }>).map((one) => one.name)).toEqual([
      "Adam",
    ]);
  });

  /* You are not somebody you can pay, so you are not somebody it offers. */
  it("never offers you yourself", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const base = await start(store, ada.id);

    const found = await get(`${base}/api/players?q=ada`);

    expect(found.body["players"]).toEqual([]);
  });

  /*
   * The one route here that answers questions about people who are not asking,
   * so what it declines to answer is as much the point as what it does.
   */
  it("will not answer a search too short to be one", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    await player(store, "d2", "Adam");
    const base = await start(store, ada.id);

    expect((await get(`${base}/api/players?q=a`)).body["players"]).toEqual([]);
    expect((await get(`${base}/api/players`)).body["players"]).toEqual([]);
  });

  it("is closed to somebody signed out", async () => {
    const store = new MemoryStore();
    await player(store, "d1", "Ada");
    const base = await start(store, null);

    expect((await get(`${base}/api/players?q=ad`)).status).toBe(401);
  });

  it("says who somebody is and never what they hold", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const bo = await player(store, "d2", "Bogdan");
    await store.adjustChips(bo.id, 999_999);
    const base = await start(store, ada.id);

    const found = await get(`${base}/api/players?q=bo`);
    const [one] = found.body["players"] as Array<Record<string, unknown>>;

    expect(Object.keys(one ?? {}).sort()).toEqual(["accentColor", "avatar", "id", "name"]);
  });

  it("hands back a handful rather than the playerbase", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    for (let index = 0; index < 30; index += 1) {
      await player(store, `x${index}`, `Bob${index}`);
    }
    const base = await start(store, ada.id);

    const found = await get(`${base}/api/players?q=bob`);

    expect((found.body["players"] as unknown[]).length).toBeLessThanOrEqual(8);
  });

  it("treats a name full of regex punctuation as a name", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    await player(store, "d2", "C++(.*)");
    const base = await start(store, ada.id);

    // Matches itself, and the punctuation is not run as a pattern.
    const exact = await get(`${base}/api/players?q=${encodeURIComponent("C++(")}`);
    const notAPattern = await get(`${base}/api/players?q=${encodeURIComponent(".*")}`);

    expect((exact.body["players"] as unknown[]).length).toBe(1);
    expect(notAPattern.body["players"]).toEqual([]);
  });
});
