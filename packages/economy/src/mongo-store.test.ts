import { afterAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { MongoStore } from "./mongo-store.js";
import { STARTING_CHIPS, emptyJarRecord } from "./store.js";
import type { JarRecord } from "./store.js";
import { DAILY_SEND_CAP } from "./transfers.js";

/**
 * These need a real mongod, so they are skipped unless one is pointed at:
 *
 *   docker run -d --name greed-test-mongo -p 27018:27017 mongo:7
 *   MONGO_TEST_URL=mongodb://localhost:27018/greed-test npm test
 *
 * What they are for is the handful of promises MemoryStore cannot keep on its
 * behalf. MemoryStore is single-threaded, so a read-then-write there is atomic
 * by accident; the Mongo implementation deliberately expresses each of these
 * as one conditional update, and the only way to show that it worked is to run
 * concurrent callers against a real database.
 */
const url = process.env["MONGO_TEST_URL"];

describe.skipIf(url === undefined || url.length === 0)("MongoStore against a real database", () => {
  let store: MongoStore;
  let seq = 0;

  afterAll(async () => {
    await store?.close();
  });

  /** A fresh player per test, so tests cannot bleed into one another. */
  async function newPlayer() {
    seq += 1;
    store ??= await MongoStore.connect(url as string);
    return store.upsertDiscordUser({
      discordId: `test-${Date.now()}-${seq}`,
      name: "Ada",
      avatar: null,
      accentColor: null,
    });
  }

  beforeEach(async () => {
    store ??= await MongoStore.connect(url as string);
  });

  it("opens a new profile with the starting stack", async () => {
    expect((await newPlayer()).chips).toBe(STARTING_CHIPS);
  });

  it("keeps a balance across sign-ins and takes the newer name", async () => {
    const first = await newPlayer();
    await store.adjustChips(first.id, -4000);
    const again = await store.upsertDiscordUser({
      discordId: first.discordId,
      name: "Ada Renamed",
      avatar: null,
      accentColor: null,
    });
    expect(again.chips).toBe(STARTING_CHIPS - 4000);
    expect(again.name).toBe("Ada Renamed");
  });

  it("never overdraws, however many debits race", async () => {
    const player = await newPlayer();
    // Twenty concurrent 1,000-chip debits against a 10,000 stack. A
    // read-then-write would let more than ten through and end up negative.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.adjustChips(player.id, -1000)),
    );
    expect(results.filter(Boolean)).toHaveLength(STARTING_CHIPS / 1000);
    expect((await store.get(player.id))?.chips).toBe(0);
  });

  it("holds the best turn as a high-water mark under racing writes", async () => {
    const player = await newPlayer();
    await Promise.all(
      [400, 1200, 800].map((bestTurn) =>
        store.bumpStats(player.id, { game: "greed", max: { bestTurn } }),
      ),
    );
    expect((await store.get(player.id))?.byGame["greed"]?.["bestTurn"]).toBe(1200);
  });

  it("adds up the counting stats rather than overwriting them", async () => {
    const player = await newPlayer();
    await Promise.all(
      Array.from({ length: 6 }, () =>
        store.bumpStats(player.id, { game: "greed", add: { farkles: 1 } }),
      ),
    );
    expect((await store.get(player.id))?.byGame["greed"]?.["farkles"]).toBe(6);
  });

  it("returns games newest first, no more than asked for", async () => {
    const player = await newPlayer();
    const at = Date.now();
    for (const [index, endedAt] of [at - 3000, at - 1000, at - 2000].entries()) {
      await store.recordGame({
        code: `GAME${index}`,
        rulesetName: "Classic",
        buyIn: 500,
        pot: 1000,
        players: [{ userId: player.id, name: "Ada", score: 10_000, isBot: false }],
        winnerIds: [player.id],
        endedAt,
      });
    }
    const recent = await store.recentGames(player.id, 2);
    expect(recent.map((game) => game.endedAt)).toEqual([at - 1000, at - 2000]);
  });

  it("does not hand a player someone else's history", async () => {
    const mine = await newPlayer();
    const theirs = await newPlayer();
    await store.recordGame({
      code: "OTHER",
      rulesetName: "Classic",
      buyIn: 0,
      pot: 0,
      players: [{ userId: theirs.id, name: "Bob", score: 5000, isBot: false }],
      winnerIds: [theirs.id],
      endedAt: Date.now(),
    });
    expect(await store.recentGames(mine.id, 10)).toHaveLength(0);
  });

  it("reads an account written before staking was counted as having staked nothing", async () => {
    const player = await newPlayer();
    // An account exactly as it was before this field existed. `$unset` is the
    // only honest way to make one: a document that has never held the field.
    // A direct connection, not the store's own: mongoose never casts an
    // `$unset` away, but the store's connection is private to `MongoStore`
    // and the default `mongoose.connection` singleton is never opened here.
    const direct = await mongoose.createConnection(url as string).asPromise();
    await direct
      .collection("users")
      .updateOne({ _id: new mongoose.Types.ObjectId(player.id) }, { $unset: { "stats.chipsStaked": "" } });
    await direct.close();

    const before = await store.get(player.id);
    expect(before?.stats.chipsStaked).toBe(0);

    await store.bumpStats(player.id, { shared: { chipsStaked: 40 } });

    const after = await store.get(player.id);
    expect(after?.stats.chipsStaked).toBe(40);
  });

  it("lifts dice figures out of a profile written before the split", async () => {
    /*
     * A profile from when there was one game: bestTurn, farkles and hotDice
     * sat in the shared stats, because everything was Greed. Connecting moves
     * them under the game's own name, once, and leaves the shared totals be.
     */
    const legacy = {
      discordId: `legacy-${Date.now()}`,
      name: "Ada",
      avatar: null,
      accentColor: null,
      chips: 7000,
      lastDailyClaim: null,
      stats: { games: 9, wins: 4, chipsWon: 1200, bestTurn: 3050, farkles: 62, hotDice: 11 },
    };
    const direct = await mongoose.createConnection(url as string).asPromise();
    const inserted = await direct.collection("users").insertOne(legacy);
    await direct.close();

    // Connecting is what runs the migration.
    const migrated = await MongoStore.connect(url as string);
    const person = await migrated.get(inserted.insertedId.toString());
    await migrated.close();

    expect(person?.byGame["greed"]).toEqual({ bestTurn: 3050, farkles: 62, hotDice: 11 });
    expect(person?.stats).toEqual({ games: 9, wins: 4, chipsWon: 1200, chipsStaked: 0 });
    expect(person?.chips).toBe(7000);
  });

  it("will not let two concurrent payouts both take the last of the bank", async () => {
    /*
     * The reason bankTake is a conditional update rather than a read and a
     * write. Both callers see 100 in the bank; exactly one of them may have
     * it. MemoryStore keeps this promise by accident, being single-threaded —
     * only a real database can show that the Mongo implementation keeps it on
     * purpose.
     */
    store ??= await MongoStore.connect(url as string);
    // Whatever previous tests left behind; the bank is one shared row.
    await store.bankTake("slots", await store.bank("slots"));
    await store.bankAdd("slots", 100);

    const [first, second] = await Promise.all([store.bankTake("slots", 100), store.bankTake("slots", 100)]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await store.bank("slots")).toBe(0);
  });

  /**
   * The jar's token as a compare-and-swap key, against a real database.
   *
   * MemoryStore keeps this promise by accident, being single-threaded — the
   * atomicity argument there is "no await between the read and the write".
   * Mongo's is a different argument, a conditional `findOneAndUpdate`, and
   * only a real database run concurrently can show it actually holds.
   */
  describe("a jar on the profile", () => {
    it("pays exactly one of a hundred concurrent swaps carrying the same token", async () => {
      const player = await newPlayer();
      const before = (await store.get(player.id))?.chips ?? 0;
      const held = await store.jar(player.id);
      const token = held?.jar.token ?? "";
      const next: JarRecord = { ...emptyJarRecord(), level: 1, token: "after-swap" };

      const results = await Promise.all(
        Array.from({ length: 100 }, () => store.applyJar(player.id, token, next, 25)),
      );

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect((await store.get(player.id))?.chips).toBe(before + 25);
    });

    /*
     * A profile from before the jar existed: no `jar` field at all, the way
     * every account written before this feature looks. `jar()` reads through
     * mongoose, which hydrates the schema default and hands back a blank
     * token — but `applyJar`'s filter is a raw query that a missing path
     * never matches on its own. Without the `$exists: false` branch this
     * swap fails forever, and the client resyncs into a token that can never
     * be spent.
     */
    it("lets a profile with no jar field swap against the blank token", async () => {
      const player = await newPlayer();
      store ??= await MongoStore.connect(url as string);
      const direct = await mongoose.createConnection(url as string).asPromise();
      await direct.collection("users").updateOne(
        { _id: new mongoose.Types.ObjectId(player.id) },
        { $unset: { jar: "" } },
      );
      const raw = await direct.collection("users").findOne({
        _id: new mongoose.Types.ObjectId(player.id),
      });
      await direct.close();
      // Asserts the fixture is actually jar-less, so this test cannot pass
      // by silently exercising the ordinary path instead.
      expect(raw).not.toHaveProperty("jar");

      const held = await store.jar(player.id);
      expect(held?.jar.token).toBe("");

      const before = held?.chips ?? 0;
      const next: JarRecord = { ...emptyJarRecord(), level: 1, token: "first-token" };
      const applied = await store.applyJar(player.id, "", next, 25);

      expect(applied.ok).toBe(true);
      expect(applied.chips).toBe(before + 25);
      expect(applied.jar.token).toBe("first-token");
    });
  });

  /**
   * Chips moving between two accounts, against a real database.
   *
   * Here for the reason the emote round trip below is: the last thing added to
   * this store was tested only against MemoryStore, where nothing is encoded
   * and nothing is queried, and it was broken in production the whole time.
   * The Mongo half of a transfer is a conditional debit, an aggregate over a
   * ledger and an anchored regex, none of which the memory store exercises at
   * all.
   */
  describe("sending chips", () => {
    it("moves them and writes the transfer down", async () => {
      const ada = await newPlayer();
      const bo = await newPlayer();

      const sent = await store.send(ada.id, bo.id, 700);

      expect(sent).toMatchObject({ ok: true, amount: 700 });
      expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS - 700);
      expect((await store.get(bo.id))?.chips).toBe(STARTING_CHIPS + 700);
      expect(await store.transfers(bo.id, 5)).toMatchObject([
        { fromId: ada.id, toId: bo.id, amount: 700 },
      ]);
    });

    it("conserves what the pair holds between them", async () => {
      const ada = await newPlayer();
      const bo = await newPlayer();
      const before = STARTING_CHIPS * 2;

      await store.send(ada.id, bo.id, 900);
      await store.send(bo.id, ada.id, 250);

      const after = ((await store.get(ada.id))?.chips ?? 0) + ((await store.get(bo.id))?.chips ?? 0);
      expect(after).toBe(before);
    });

    it("adds up what one account has sent, and only what it sent", async () => {
      const ada = await newPlayer();
      const bo = await newPlayer();

      await store.send(ada.id, bo.id, 300);
      await store.send(ada.id, bo.id, 200);
      await store.send(bo.id, ada.id, 50);

      expect(await store.sentSince(ada.id, 0)).toBe(500);
      expect(await store.sentSince(bo.id, 0)).toBe(50);
    });

    it("counts only what falls inside the window", async () => {
      const ada = await newPlayer();
      const bo = await newPlayer();
      await store.send(ada.id, bo.id, 400);

      expect(await store.sentSince(ada.id, Date.now() + 1000)).toBe(0);
    });

    /*
     * Never overdrawn, however many go at once. The debit is a conditional
     * update for the same reason every other debit here is one: a read
     * followed by a write is a race by construction.
     */
    it("never overdraws, however many transfers race", async () => {
      const ada = await newPlayer();
      const bo = await newPlayer();

      const results = await Promise.all(
        Array.from({ length: 20 }, () => store.send(ada.id, bo.id, 1000)),
      );

      const went = results.filter((one) => one.ok).length;
      expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS - went * 1000);
      expect((await store.get(bo.id))?.chips).toBe(STARTING_CHIPS + went * 1000);
      expect((await store.get(ada.id))?.chips).toBeGreaterThanOrEqual(0);
    });

    it("refuses more than the sender holds, and moves nothing", async () => {
      const ada = await newPlayer();
      const bo = await newPlayer();

      expect(await store.send(ada.id, bo.id, STARTING_CHIPS + 1)).toMatchObject({
        ok: false,
        reason: "not-enough",
      });
      expect((await store.get(ada.id))?.chips).toBe(STARTING_CHIPS);
      expect((await store.get(bo.id))?.chips).toBe(STARTING_CHIPS);
    });

    it("stops at the daily cap", async () => {
      const ada = await newPlayer();
      const bo = await newPlayer();
      await store.adjustChips(ada.id, DAILY_SEND_CAP * 2);

      await store.send(ada.id, bo.id, DAILY_SEND_CAP);

      expect(await store.send(ada.id, bo.id, 1)).toMatchObject({
        ok: false,
        reason: "over-cap",
      });
    });
  });

  describe("finding somebody to pay", () => {
    it("matches the start of a name, whatever the case", async () => {
      const person = await store.upsertDiscordUser({
        discordId: `find-${Date.now()}`,
        name: "Zaphod",
        avatar: null,
        accentColor: null,
      });

      const found = await store.findPlayers("zaph", 5);

      expect(found.some((one) => one.id === person.id)).toBe(true);
      expect(await store.findPlayers("aphod", 5)).toEqual([]);
    });

    /*
     * A name is whatever somebody typed into Discord. One full of regex
     * punctuation has to be a name to look for rather than a pattern to run,
     * which is a promise only the Mongo implementation has to keep.
     */
    it("treats punctuation in a search as punctuation", async () => {
      const odd = await store.upsertDiscordUser({
        discordId: `odd-${Date.now()}`,
        name: "C++(.*)",
        avatar: null,
        accentColor: null,
      });

      expect((await store.findPlayers("C++(", 5)).some((one) => one.id === odd.id)).toBe(true);
      expect((await store.findPlayers(".*", 5)).some((one) => one.id === odd.id)).toBe(false);
    });

    it("never says what anybody holds", async () => {
      await store.upsertDiscordUser({
        discordId: `plain-${Date.now()}`,
        name: "Trillian",
        avatar: null,
        accentColor: null,
      });

      const [found] = await store.findPlayers("trill", 5);

      expect(Object.keys(found ?? {}).sort()).toEqual(["accentColor", "avatar", "id", "name"]);
    });
  });

  describe("the leaderboard", () => {
    it("orders by chips and answers a rank from outside the page", async () => {
      const rich = await newPlayer();
      const middle = await newPlayer();
      const poor = await newPlayer();
      await store.adjustChips(rich.id, 5_000);
      await store.adjustChips(poor.id, -5_000);

      const board = await store.leaderboard({ sort: "chips", limit: 1, you: poor.id });
      expect(board.rows).toHaveLength(1);
      expect(board.rows[0]?.id).toBe(rich.id);
      expect(board.you?.row.id).toBe(poor.id);
      // Two players hold more than this one, whatever else is in the database.
      expect(board.you?.rank).toBeGreaterThanOrEqual(3);
      expect(middle.id).not.toBe(rich.id);
    });
  });

  /**
   * An emote's files, all the way out and back.
   *
   * The other promise MemoryStore cannot keep on Mongo's behalf, and the gap
   * that let an emote be served as an empty file in production: every test of
   * the upload path ran against the memory store, where the bytes never leave
   * the process. Only a real database exercises the encode-and-read that was
   * actually broken.
   */
  describe("an emote's files", () => {
    /** Not a real JPEG beyond its opening bytes, which is all that is sniffed. */
    const picture = Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xe0,
      ...Array.from({ length: 2000 }, (_, index) => index % 256),
    ]);
    const noise = Uint8Array.from([
      0x49,
      0x44,
      0x33,
      ...Array.from({ length: 900 }, (_, index) => (index * 7) % 256),
    ]);

    it("hands back exactly the bytes that went in", async () => {
      store ??= await MongoStore.connect(url as string);
      const made = await store.addEmote({
        name: "Smug",
        cost: 250,
        image: picture,
        sound: noise,
        createdBy: "admin",
      });

      const image = await store.emoteAsset(made.id, "image");
      const sound = await store.emoteAsset(made.id, "sound");

      /*
       * Length first and separately. The failure this covers was an empty
       * file, and "0 bytes" is a far clearer thing to read at the top of a
       * failure than a diff of two thousand numbers.
       */
      expect(image?.bytes.length).toBe(picture.length);
      expect(sound?.bytes.length).toBe(noise.length);
      expect(image?.bytes).toEqual(picture);
      expect(sound?.bytes).toEqual(noise);
      expect(image?.mime).toBe("image/jpeg");
      expect(sound?.mime).toBe("audio/mpeg");
    });

    it("says an emote with no sound has none", async () => {
      store ??= await MongoStore.connect(url as string);
      const made = await store.addEmote({
        name: "Quiet",
        cost: 10,
        image: picture,
        sound: null,
        createdBy: "admin",
      });

      expect(await store.emoteAsset(made.id, "sound")).toBeNull();
      expect((await store.emoteAsset(made.id, "image"))?.bytes.length).toBe(picture.length);
    });

    it("keeps serving a retired emote's picture, for the replays still owed", async () => {
      store ??= await MongoStore.connect(url as string);
      const made = await store.addEmote({
        name: "Gone",
        cost: 10,
        image: picture,
        sound: null,
        createdBy: "admin",
      });

      expect(await store.retireEmote(made.id)).toBe(true);

      expect((await store.emoteAsset(made.id, "image"))?.bytes).toEqual(picture);
      expect((await store.listEmotes(false)).some((one) => one.id === made.id)).toBe(false);
      expect((await store.listEmotes(true)).some((one) => one.id === made.id)).toBe(true);
    });
  });
});
