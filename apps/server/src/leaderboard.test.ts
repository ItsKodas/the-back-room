import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import { afterEach, describe, expect, it } from "vitest";
import { createBackRoomServer } from "./server.js";
import type { BackRoomServer } from "./server.js";

/**
 * The one route in the building that publishes balances.
 *
 * Which is why most of what is tested here is refusal: that it is shut to
 * somebody signed out, that it hands back the board's columns and nothing
 * else, and that how many rows it gives out is the server's decision.
 */

let server: BackRoomServer | null = null;

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
});

async function start(store: MemoryStore, as: string | null): Promise<string> {
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify: () => as,
    identifyRequest: () => as,
  });
  await new Promise<void>((resolve) => server?.http.listen(0, () => resolve()));
  return `http://localhost:${(server.http.address() as AddressInfo).port}`;
}

async function get(url: string) {
  const response = await fetch(url);
  const text = await response.text();
  return { status: response.status, body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown> };
}

async function player(store: MemoryStore, discordId: string, name: string) {
  return store.upsertDiscordUser({ discordId, name, avatar: null, accentColor: null });
}

describe("the leaderboard route", () => {
  it("is shut to somebody signed out", async () => {
    const store = new MemoryStore();
    const url = await start(store, null);
    const answer = await get(`${url}/api/leaderboard`);
    expect(answer.status).toBe(401);
  });

  it("gives the board, your own standing, and nothing about anybody's account", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    await player(store, "d2", "Bram");
    const url = await start(store, ada.id);

    const answer = await get(`${url}/api/leaderboard`);
    expect(answer.status).toBe(200);
    const rows = answer.body["rows"] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0] as object).sort()).toEqual(
      ["accentColor", "avatar", "chips", "id", "name", "stats"].sort(),
    );
    expect(JSON.stringify(answer.body)).not.toContain("discordId");
    expect((answer.body["you"] as { rank: number }).rank).toBeGreaterThan(0);
    expect(answer.body["sort"]).toBe("chips");
  });

  it("falls back to chips when asked to sort by something that is not a column", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const url = await start(store, ada.id);
    const answer = await get(`${url}/api/leaderboard?sort=winRate`);
    expect(answer.status).toBe(200);
    expect(answer.body["sort"]).toBe("chips");
  });

  it("sorts by a column it does know", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    const bram = await player(store, "d2", "Bram");
    await store.bumpStats(bram.id, { shared: { games: 1, wins: 0, chipsWon: -900, chipsStaked: 900 } });
    const url = await start(store, ada.id);
    const answer = await get(`${url}/api/leaderboard?sort=staked`);
    const rows = answer.body["rows"] as Array<{ id: string }>;
    expect(rows[0]?.id).toBe(bram.id);
  });

  it("hands out its own number of rows, whatever the caller asks for", async () => {
    const store = new MemoryStore();
    const ada = await player(store, "d1", "Ada");
    await player(store, "d2", "Bram");
    const url = await start(store, ada.id);
    const answer = await get(`${url}/api/leaderboard?limit=1`);
    expect((answer.body["rows"] as unknown[]).length).toBe(2);
  });
});
