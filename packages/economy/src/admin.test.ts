import { describe, expect, it } from "vitest";
import { MemoryStore, STARTING_CHIPS, emptyJarRecord } from "./store.js";

/*
 * Everything an admin can do to players, against the store that doubles as
 * the no-database mode. The Mongo versions are held to the same cases in
 * mongo-store.test.ts; this file is the one that always runs.
 */

async function people(store: MemoryStore, names: string[]) {
  const out = [];
  for (const [index, name] of names.entries()) {
    out.push(
      await store.upsertDiscordUser({ discordId: `d${index}`, name, avatar: null, accentColor: null }),
    );
  }
  return out;
}

const ascii = (text: string): number[] => [...text].map((letter) => letter.charCodeAt(0));

function gif(): Uint8Array {
  const out = new Uint8Array(64);
  out.set(ascii("GIF89a"));
  return out;
}

describe("listing players for the admin", () => {
  it("lists everybody richest first, and pages", async () => {
    const store = new MemoryStore();
    const [ada, bo, cy] = await people(store, ["Ada", "Bo", "Cy"]);
    await store.adjustChips(bo.id, 500);
    await store.adjustChips(cy.id, -500);

    const first = await store.listUsers({ query: "", offset: 0, limit: 2 });
    expect(first.total).toBe(3);
    expect(first.rows.map((row) => row.id)).toEqual([bo.id, ada.id]);
    const second = await store.listUsers({ query: "", offset: 2, limit: 2 });
    expect(second.rows.map((row) => row.id)).toEqual([cy.id]);
  });

  it("finds by the start of a name, in any case, and counts only the matches", async () => {
    const store = new MemoryStore();
    await people(store, ["Ada", "Adam", "Bo"]);
    const found = await store.listUsers({ query: "AD", offset: 0, limit: 50 });
    expect(found.rows.map((row) => row.name).sort()).toEqual(["Ada", "Adam"]);
    expect(found.total).toBe(2);
  });

  it("carries rounds played and when they joined", async () => {
    const store = new MemoryStore();
    const [ada] = await people(store, ["Ada"]);
    await store.bumpStats(ada.id, { shared: { rounds: 3 } });
    const [row] = (await store.listUsers({ query: "", offset: 0, limit: 50 })).rows;
    expect(row.rounds).toBe(3);
    expect(row.createdAt).toBeGreaterThan(0);
  });
});

describe("moving balances", () => {
  it("adds to the players named and nobody else", async () => {
    const store = new MemoryStore();
    const [ada, bo] = await people(store, ["Ada", "Bo"]);
    const result = await store.adjustBalances({ target: { ids: [ada.id] }, op: "add", amount: 5000 });
    expect(result).toEqual({ affected: 1, moved: 5000 });
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS + 5000);
    expect((await store.get(bo.id))?.chips).toBe(STARTING_CHIPS);
  });

  it("takes away no further than zero, and says what it actually took", async () => {
    const store = new MemoryStore();
    const [ada, bo] = await people(store, ["Ada", "Bo"]);
    await store.adjustChips(bo.id, -9000);
    const result = await store.adjustBalances({
      target: { ids: [ada.id, bo.id] },
      op: "remove",
      amount: 5000,
    });
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS - 5000);
    expect((await store.get(bo.id))?.chips).toBe(0);
    expect(result).toEqual({ affected: 2, moved: -6000 });
  });

  it("sets a balance outright", async () => {
    const store = new MemoryStore();
    const [ada] = await people(store, ["Ada"]);
    const result = await store.adjustBalances({ target: { ids: [ada.id] }, op: "set", amount: 250 });
    expect((await store.get(ada.id))?.chips).toBe(250);
    expect(result).toEqual({ affected: 1, moved: 250 - STARTING_CHIPS });
  });

  it("reaches everybody", async () => {
    const store = new MemoryStore();
    const everyone = await people(store, ["Ada", "Bo", "Cy"]);
    const result = await store.adjustBalances({ target: { all: true }, op: "add", amount: 1 });
    expect(result).toEqual({ affected: 3, moved: 3 });
    for (const one of everyone) {
      expect((await store.get(one.id))?.chips).toBe(STARTING_CHIPS + 1);
    }
  });

  it("ignores an id nobody has", async () => {
    const store = new MemoryStore();
    const result = await store.adjustBalances({ target: { ids: ["nobody"] }, op: "add", amount: 1 });
    expect(result).toEqual({ affected: 0, moved: 0 });
  });
});

describe("resetting players", () => {
  it("resets only the parts asked for", async () => {
    const store = new MemoryStore();
    const [ada] = await people(store, ["Ada"]);
    await store.adjustChips(ada.id, 777);
    await store.bumpStats(ada.id, { shared: { rounds: 4, roundsWon: 2 }, game: "greed", add: { farkles: 3 } });

    await store.resetUsers({ target: { ids: [ada.id] }, parts: ["stats"] });
    const after = await store.get(ada.id);
    expect(after?.chips).toBe(STARTING_CHIPS + 777);
    expect(after?.stats).toEqual({ rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 });
    expect(after?.byGame).toEqual({});

    await store.resetUsers({ target: { ids: [ada.id] }, parts: ["balance"] });
    expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS);
  });

  it("keeps who they are", async () => {
    const store = new MemoryStore();
    const [ada] = await people(store, ["Ada"]);
    await store.resetUsers({ target: { all: true }, parts: ["balance", "stats", "jar", "history"] });
    const after = await store.get(ada.id);
    expect(after?.id).toBe(ada.id);
    expect(after?.discordId).toBe(ada.discordId);
    expect(after?.name).toBe("Ada");
  });

  it("empties the tip jar", async () => {
    const store = new MemoryStore();
    const [ada] = await people(store, ["Ada"]);
    await store.applyJar(ada.id, "", { ...emptyJarRecord(), level: 5, token: "t1" }, 0);
    await store.resetUsers({ target: { ids: [ada.id] }, parts: ["jar"] });
    expect((await store.get(ada.id))?.jar).toEqual(emptyJarRecord());
  });

  it("forgets redemptions, so a used code can be used again", async () => {
    const store = new MemoryStore();
    const [ada] = await people(store, ["Ada"]);
    const code = await store.mintCode({
      chips: 100, maxRedemptions: null, expiresAt: null, note: "", createdBy: "admin",
    });
    expect((await store.redeem(code.code, ada.id)).ok).toBe(true);
    expect((await store.redeem(code.code, ada.id)).ok).toBe(false);

    await store.resetUsers({ target: { ids: [ada.id] }, parts: ["history"] });
    expect((await store.listCodes(1))[0]?.redemptions).toBe(0);
    expect((await store.redeem(code.code, ada.id)).ok).toBe(true);
  });

  it("forgets transfers either way round", async () => {
    const store = new MemoryStore();
    const [ada, bo] = await people(store, ["Ada", "Bo"]);
    expect((await store.send(ada.id, bo.id, 100)).ok).toBe(true);
    await store.resetUsers({ target: { ids: [bo.id] }, parts: ["history"] });
    expect(await store.transfers(ada.id, 10)).toEqual([]);
    expect(await store.sentSince(ada.id, 0)).toBe(0);
  });

  it("takes them out of a shared game without taking the game from anybody else", async () => {
    const store = new MemoryStore();
    const [ada, bo] = await people(store, ["Ada", "Bo"]);
    await store.recordGame({
      code: "ABCD", rulesetName: "greed", buyIn: 0, pot: 0, winnerIds: [], endedAt: 1,
      players: [
        { userId: ada.id, name: "Ada", score: 1, isBot: false },
        { userId: bo.id, name: "Bo", score: 2, isBot: false },
      ],
    });
    await store.recordGame({
      code: "EFGH", rulesetName: "greed", buyIn: 0, pot: 0, winnerIds: [], endedAt: 2,
      players: [
        { userId: ada.id, name: "Ada", score: 1, isBot: false },
        { userId: null, name: "Bot", score: 2, isBot: true },
      ],
    });

    await store.resetUsers({ target: { ids: [ada.id] }, parts: ["history"] });
    expect(await store.recentGames(ada.id, 10)).toEqual([]);
    const bos = await store.recentGames(bo.id, 10);
    expect(bos).toHaveLength(1);
    expect(bos[0]?.players.map((player) => player.name)).toEqual(["Bo"]);
  });

  it("counts only players who exist", async () => {
    const store = new MemoryStore();
    await people(store, ["Ada", "Bo"]);
    expect(await store.resetUsers({ target: { all: true }, parts: ["balance"] })).toEqual({ affected: 2 });
    expect(await store.resetUsers({ target: { ids: ["nobody"] }, parts: ["balance"] })).toEqual({
      affected: 0,
    });
  });
});

describe("emptying a bank", () => {
  it("leaves it at zero and says what was in it", async () => {
    const store = new MemoryStore();
    await store.bankAdd("roulette", 1234);
    expect(await store.bankEmpty("roulette")).toBe(1234);
    expect(await store.bank("roulette")).toBe(0);
    expect(await store.bankEmpty("roulette")).toBe(0);
  });
});

describe("deleting an emote", () => {
  it("removes it and its files for good", async () => {
    const store = new MemoryStore();
    const made = await store.addEmote({ name: "Smug", cost: 250, image: gif(), sound: null, createdBy: "a" });
    expect(await store.deleteEmote(made.id)).toBe(true);
    expect(await store.listEmotes(true)).toEqual([]);
    expect(await store.emoteAsset(made.id, "image")).toBeNull();
    expect(await store.deleteEmote(made.id)).toBe(false);
  });
});

describe("the admin log", () => {
  it("hands entries back newest first, and pages by time", async () => {
    const store = new MemoryStore();
    const base = {
      by: "u1", byName: "Koda", amount: 5, affected: 1, target: "all" as const,
      parts: null, subject: null, note: "",
    };
    const first = await store.logAdmin({ ...base, kind: "add" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await store.logAdmin({ ...base, kind: "remove" });

    const all = await store.adminLog({ limit: 50, before: null });
    expect(all.map((entry) => entry.id)).toEqual([second.id, first.id]);
    const older = await store.adminLog({ limit: 50, before: second.at });
    expect(older.map((entry) => entry.id)).toEqual([first.id]);
  });
});
