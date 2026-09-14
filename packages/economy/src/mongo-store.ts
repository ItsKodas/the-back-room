import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { judgeCode, mintCodeText, normaliseCode } from "./codes.js";
import type { CodeRecord, RedeemResult } from "./codes.js";
import { judgeEmote } from "./emotes.js";
import type {
  EmoteAsset,
  EmoteRecord,
  ImageMime,
  NewEmote,
  SoundMime,
} from "./emotes.js";
import { judgeSend, leftToSend, SEND_WINDOW_MS } from "./transfers.js";
import type { SendResult, Transfer } from "./transfers.js";
import type { BankName, PublicPlayer } from "./store.js";
import type { Model } from "mongoose";
import { STARTING_CHIPS, emptyJarRecord, emptyStats, leaderValue, toLeaderRow } from "./store.js";
import type {
  GameRecord,
  JarRecord,
  LeaderBoard,
  LeaderSort,
  Profile,
  ProfileStats,
  StatBump,
  Store,
} from "./store.js";

interface UserDoc {
  _id: mongoose.Types.ObjectId;
  discordId: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  lastDailyClaim: Date | null;
  stats: ProfileStats;
  byGame: Record<string, Record<string, number>>;
  jar: JarRecord;
}

const statsSchema = new mongoose.Schema<ProfileStats>(
  {
    games: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    chipsWon: { type: Number, default: 0 },
    chipsStaked: { type: Number, default: 0 },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema<UserDoc>(
  {
    discordId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    avatar: { type: String, default: null },
    accentColor: { type: Number, default: null },
    chips: { type: Number, default: STARTING_CHIPS },
    lastDailyClaim: { type: Date, default: null },
    stats: { type: statsSchema, default: () => emptyStats() },
    // Free-form on purpose: each game names its own figures and the store has
    // no business knowing what they are called.
    byGame: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    jar: {
      type: {
        level: { type: Number, default: 0 },
        levelAt: { type: Number, default: 0 },
        favours: { type: Number, default: 0 },
        bought: { type: [String], default: () => [] },
        nightStartedAt: { type: Number, default: 0 },
        paidThisNight: { type: Number, default: 0 },
        token: { type: String, default: "" },
        rhythm: { type: [Number], default: () => [] },
        lastTapAt: { type: Number, default: null },
      },
      default: () => emptyJarRecord(),
      _id: false,
    },
  },
  { timestamps: true },
);

/*
 * One index per column the board can be ordered by. The board reads the whole
 * collection sorted; without these that is a scan on every poll, and the page
 * polls every ten seconds for everybody looking at it.
 */
userSchema.index({ chips: -1 });
userSchema.index({ "stats.chipsWon": -1 });
userSchema.index({ "stats.chipsStaked": -1 });
userSchema.index({ "stats.games": -1 });
userSchema.index({ "stats.wins": -1 });

/** Where each of the board's columns actually lives on a user document. */
const LEADER_FIELDS: Record<LeaderSort, string> = {
  chips: "chips",
  net: "stats.chipsWon",
  staked: "stats.chipsStaked",
  games: "stats.games",
  wins: "stats.wins",
};

const gameSchema = new mongoose.Schema<GameRecord>(
  {
    code: String,
    rulesetName: String,
    buyIn: Number,
    pot: Number,
    players: [
      {
        _id: false,
        userId: { type: String, default: null },
        name: String,
        score: Number,
        isBot: Boolean,
        // Absent on anything written before this field existed, which the
        // profile handles rather than the schema papering over with a zero.
        net: { type: Number, required: false },
      },
    ],
    winnerIds: [String],
    endedAt: Number,
  },
  { timestamps: true },
);
gameSchema.index({ "players.userId": 1, endedAt: -1 });

const codeSchema = new mongoose.Schema<CodeRecord>(
  {
    /* Stored without dashes and upper-cased, so how somebody types it is
       their business and not the database's. */
    code: { type: String, required: true, unique: true, index: true },
    chips: { type: Number, required: true },
    maxRedemptions: { type: Number, default: null },
    redemptions: { type: Number, default: 0 },
    expiresAt: { type: Number, default: null },
    note: { type: String, default: "" },
    createdBy: { type: String, required: true },
    createdAt: { type: Number, required: true },
    revoked: { type: Boolean, default: false },
  },
  { timestamps: false },
);

interface RedemptionDoc {
  code: string;
  userId: string;
  chips: number;
  at: number;
}

const redemptionSchema = new mongoose.Schema<RedemptionDoc>({
  code: { type: String, required: true },
  userId: { type: String, required: true },
  chips: { type: Number, required: true },
  at: { type: Number, required: true },
});
/*
 * The one-each rule, enforced by the database rather than checked by the
 * server. A check followed by a write is a race by construction, and two
 * clicks a millisecond apart is the ordinary case here, not an exotic one.
 */
redemptionSchema.index({ code: 1, userId: 1 }, { unique: true });

interface HouseDoc {
  _id: string;
  amount: number;
}

/*
 * One document per bank.
 *
 * A collection holding a couple of rows looks odd until you want the update to
 * be atomic: $inc on one document is, and a read followed by a write is not.
 * Two spins finishing a millisecond apart is the ordinary case here, not an
 * exotic one.
 */
const houseSchema = new mongoose.Schema<HouseDoc>({
  _id: { type: String, required: true },
  amount: { type: Number, required: true, default: 0 },
});

/**
 * The document id a bank is stored under.
 *
 * The machine's stays "bank" rather than becoming "slots". It is the id the
 * chips are already sitting under in every deployed database, and renaming it
 * would not move them — it would leave them somewhere nothing looks and open a
 * fresh bank at zero, which reads as the machine having been robbed.
 */
function bankId(which: BankName): string {
  return which === "slots" ? "bank" : which;
}

/**
 * An emote, files and all, in one document.
 *
 * The bytes live in the document rather than in GridFS because they are
 * capped at two megabytes and one, well inside Mongo's sixteen — and GridFS
 * would be a second collection, a chunking scheme and a cleanup problem in
 * exchange for a limit nothing is near.
 *
 * The sizes are stored beside the files rather than measured off them, so the
 * list can be answered without reading a single byte of picture.
 */
interface EmoteDoc {
  _id: string;
  name: string;
  cost: number;
  imageMime: ImageMime;
  soundMime: SoundMime | null;
  image: Buffer;
  sound: Buffer | null;
  imageBytes: number;
  soundBytes: number | null;
  createdBy: string;
  createdAt: number;
  retired: boolean;
}

const emoteSchema = new mongoose.Schema<EmoteDoc>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    cost: { type: Number, required: true },
    imageMime: { type: String, required: true },
    soundMime: { type: String, default: null },
    image: { type: Buffer, required: true },
    sound: { type: Buffer, default: null },
    imageBytes: { type: Number, required: true },
    soundBytes: { type: Number, default: null },
    createdBy: { type: String, required: true },
    createdAt: { type: Number, required: true },
    retired: { type: Boolean, default: false },
  },
  { timestamps: false },
);

/** Newest first is how both the picker and the admin list read them. */
emoteSchema.index({ createdAt: -1 });

/** The record without the files, which is all anything but the two asset routes wants. */
const EMOTE_FIELDS = "-image -sound";

/**
 * The bytes out of a BSON binary field, whatever shape they arrive in.
 *
 * This exists because of a bug that served every emote as an empty file while
 * answering 200 with the right content type — a broken image and a silent
 * sound, and nothing anywhere saying why.
 *
 * `.lean()` hands back what the driver produced rather than what Mongoose
 * would have cast it to, and for a binary field that is a `Binary`, not a
 * `Buffer`. The trap is that `Binary` has a `length` *method*. `Uint8Array.from`
 * reads `.length` as a number, gets `NaN` from a function, and quietly returns
 * an empty array — no throw, no warning, nothing to notice in a log.
 *
 * So every shape is handled explicitly rather than trusted to be array-like,
 * and anything unrecognised throws instead of becoming a silent empty file.
 * A loud failure here is worth far more than a quiet one: the quiet one
 * reached production.
 */
export function bytesOf(value: unknown): Uint8Array {
  // A Buffer already is a Uint8Array, so this covers both.
  if (value instanceof Uint8Array) {
    return Uint8Array.from(value);
  }
  const held = (value as { buffer?: unknown } | null)?.buffer;
  // What the driver actually returns: a BSON Binary wrapping the bytes.
  if (held instanceof Uint8Array) {
    return Uint8Array.from(held);
  }
  // A document that has been through JSON, where a Buffer becomes this.
  const data = (value as { type?: string; data?: unknown } | null)?.data;
  if (Array.isArray(data)) {
    return Uint8Array.from(data as number[]);
  }
  throw new TypeError(
    `emote bytes came back as ${Object.prototype.toString.call(value)}, which this does not know how to read`,
  );
}

/** One transfer, written down and never edited. */
interface TransferDoc {
  _id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
  at: number;
}

const transferSchema = new mongoose.Schema<TransferDoc>(
  {
    _id: { type: String, required: true },
    fromId: { type: String, required: true },
    fromName: { type: String, required: true },
    toId: { type: String, required: true },
    toName: { type: String, required: true },
    amount: { type: Number, required: true },
    at: { type: Number, required: true },
  },
  { timestamps: false },
);
/* The two questions ever asked of it: what one account has sent lately, and
   everything either end of an account's transfers. */
transferSchema.index({ fromId: 1, at: -1 });
transferSchema.index({ toId: 1, at: -1 });

function toEmote(doc: EmoteDoc): EmoteRecord {
  return {
    id: doc._id,
    name: doc.name,
    cost: doc.cost,
    imageMime: doc.imageMime,
    soundMime: doc.soundMime,
    imageBytes: doc.imageBytes,
    soundBytes: doc.soundBytes,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    retired: doc.retired,
  };
}

function toProfile(doc: UserDoc): Profile {
  return {
    id: doc._id.toString(),
    discordId: doc.discordId,
    name: doc.name,
    avatar: doc.avatar,
    accentColor: doc.accentColor,
    chips: doc.chips,
    lastDailyClaim: doc.lastDailyClaim === null ? null : doc.lastDailyClaim.getTime(),
    /*
     * Copied field by field rather than handed straight out. What Mongoose
     * stores on the document is a live subdocument, not the plain object the
     * Profile type promises — it carries a prototype and its own machinery, so
     * it compares unequal to an identical-looking object and lets callers write
     * back through it by accident.
     */
    stats: {
      games: doc.stats?.games ?? 0,
      wins: doc.stats?.wins ?? 0,
      chipsWon: doc.stats?.chipsWon ?? 0,
      chipsStaked: doc.stats?.chipsStaked ?? 0,
    },
    byGame: structuredClone(doc.byGame ?? {}),
    // Copied field by field, for the same reason stats is: a live Mongoose
    // subdocument compares unequal to a plain object and lets a caller write
    // back through it by accident.
    jar: {
      level: doc.jar?.level ?? 0,
      levelAt: doc.jar?.levelAt ?? 0,
      favours: doc.jar?.favours ?? 0,
      bought: [...(doc.jar?.bought ?? [])],
      nightStartedAt: doc.jar?.nightStartedAt ?? 0,
      paidThisNight: doc.jar?.paidThisNight ?? 0,
      token: doc.jar?.token ?? "",
      rhythm: [...(doc.jar?.rhythm ?? [])],
      lastTapAt: doc.jar?.lastTapAt ?? null,
    },
  };
}

export class MongoStore implements Store {
  readonly kind = "mongo" as const;
  private readonly users: Model<UserDoc>;
  private readonly games: Model<GameRecord>;
  private readonly codes: Model<CodeRecord>;
  private readonly redemptions: Model<RedemptionDoc>;
  private readonly house: Model<HouseDoc>;
  private readonly emotes: Model<EmoteDoc>;
  private readonly ledger: Model<TransferDoc>;

  private constructor(private readonly connection: mongoose.Connection) {
    this.users = connection.model<UserDoc>("User", userSchema);
    this.games = connection.model<GameRecord>("Game", gameSchema);
    this.codes = connection.model<CodeRecord>("Code", codeSchema);
    this.redemptions = connection.model<RedemptionDoc>("Redemption", redemptionSchema);
    this.house = connection.model<HouseDoc>("House", houseSchema);
    this.emotes = connection.model<EmoteDoc>("Emote", emoteSchema);
    this.ledger = connection.model<TransferDoc>("Transfer", transferSchema);
  }

  /**
   * Moves Greed's figures out of the shared profile and under its own name.
   *
   * `bestTurn`, `farkles` and `hotDice` were three of the six things a player
   * was, back when there was one game. Every profile written before that
   * changed still has them there, so they are lifted across once. Runs on
   * connect, touches only documents that still carry them, and is safe to run
   * again — after the first pass the filter matches nothing.
   */
  private static async liftGreedFigures(connection: mongoose.Connection): Promise<void> {
    const users = connection.collection("users");
    const stale = { "stats.bestTurn": { $exists: true } };
    if ((await users.countDocuments(stale, { limit: 1 })) === 0) {
      return;
    }
    const result = await users.updateMany(stale, [
      {
        $set: {
          "byGame.greed": {
            bestTurn: { $ifNull: ["$stats.bestTurn", 0] },
            farkles: { $ifNull: ["$stats.farkles", 0] },
            hotDice: { $ifNull: ["$stats.hotDice", 0] },
          },
        },
      },
      { $unset: ["stats.bestTurn", "stats.farkles", "stats.hotDice"] },
    ]);
    console.log(`greed: moved dice figures on ${result.modifiedCount} profile(s)`);
  }

  static async connect(url: string): Promise<MongoStore> {
    const connection = await mongoose
      .createConnection(url, {
        // Mongoose waits thirty seconds by default before admitting it cannot
        // find a server. The caller treats an unreachable database as a reason
        // to run in memory rather than to stop, and a server that will not
        // answer for half a minute is not available either way — so give up
        // quickly and get on with dealing the cards.
        serverSelectionTimeoutMS: 5_000,
      })
      .asPromise();
    await MongoStore.liftGreedFigures(connection);
    return new MongoStore(connection);
  }

  async upsertDiscordUser(input: {
    discordId: string;
    name: string;
    avatar: string | null;
    accentColor: number | null;
  }): Promise<Profile> {
    const doc = await this.users.findOneAndUpdate(
      { discordId: input.discordId },
      {
        $set: { name: input.name, avatar: input.avatar, accentColor: input.accentColor },
        // Only on insert, so signing in again never resets a balance.
        $setOnInsert: {
          chips: STARTING_CHIPS,
          lastDailyClaim: null,
          stats: emptyStats(),
          byGame: {},
          jar: emptyJarRecord(),
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    return toProfile(doc);
  }

  async get(id: string): Promise<Profile | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null;
    }
    const doc = await this.users.findById(id);
    return doc === null ? null : toProfile(doc);
  }

  /**
   * One conditional update rather than a read then a write, so two games
   * settling at once cannot overdraw the same balance. No transaction, and so
   * no replica set needed to run this locally.
   */
  async adjustChips(id: string, delta: number): Promise<boolean> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return false;
    }
    const filter =
      delta < 0 ? { _id: id, chips: { $gte: Math.abs(delta) } } : { _id: id };
    const result = await this.users.updateOne(filter, { $inc: { chips: delta } });
    return result.modifiedCount === 1;
  }

  async jar(id: string): Promise<{ jar: JarRecord; chips: number } | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null;
    }
    const doc = await this.users.findById(id);
    return doc === null ? null : { jar: toProfile(doc).jar, chips: doc.chips };
  }

  /*
   * One conditional update rather than a read then a write: the whole
   * compare-and-swap is the filter, so two swaps racing on the same token
   * cannot both land.
   *
   * The filter runs as a raw query, which mongoose does not hydrate — a
   * profile written before the jar existed has no `jar` field at all, and
   * `"jar.token": ""` never matches an absent path. `jar()` reads through
   * `findById`, which mongoose does hydrate, so it hands such a caller the
   * schema default of `token: ""` — a blank token that this filter alone
   * would then refuse forever. A blank token is exactly the never-touched
   * case this exists for, so when the caller is swapping against blank the
   * filter has to accept both shapes of "never touched": a stored blank
   * token, or no jar at all.
   */
  async applyJar(
    id: string,
    expectedToken: string,
    next: JarRecord,
    chipDelta: number,
  ): Promise<{ ok: boolean; chips: number; jar: JarRecord }> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return { ok: false, chips: 0, jar: emptyJarRecord() };
    }
    const filter =
      expectedToken === ""
        ? { _id: id, $or: [{ "jar.token": "" }, { jar: { $exists: false } }] }
        : { _id: id, "jar.token": expectedToken };
    const doc = await this.users.findOneAndUpdate(
      filter,
      { $set: { jar: next }, ...(chipDelta !== 0 ? { $inc: { chips: chipDelta } } : {}) },
      { returnDocument: "after" },
    );
    if (doc !== null) {
      return { ok: true, chips: doc.chips, jar: toProfile(doc).jar };
    }
    // Somebody else's swap moved the token between the read and this write.
    const current = await this.users.findById(id);
    return current === null
      ? { ok: false, chips: 0, jar: emptyJarRecord() }
      : { ok: false, chips: current.chips, jar: toProfile(current).jar };
  }

  async bumpStats(id: string, bump: StatBump): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return;
    }
    const inc: Record<string, number> = {};
    const max: Record<string, number> = {};

    for (const [key, value] of Object.entries(bump.shared ?? {})) {
      if (typeof value === "number") {
        inc[`stats.${key}`] = value;
      }
    }
    if (bump.game !== undefined) {
      // The game's own figures, filed under its name. Mongo creates the path
      // on the way in, so a game's first figure needs no setup.
      for (const [key, value] of Object.entries(bump.add ?? {})) {
        inc[`byGame.${bump.game}.${key}`] = value;
      }
      for (const [key, value] of Object.entries(bump.max ?? {})) {
        max[`byGame.${bump.game}.${key}`] = value;
      }
    }

    const update: Record<string, unknown> = {};
    if (Object.keys(inc).length > 0) {
      update["$inc"] = inc;
    }
    if (Object.keys(max).length > 0) {
      update["$max"] = max;
    }
    if (Object.keys(update).length > 0) {
      await this.users.updateOne({ _id: id }, update);
    }
  }


  async recordGame(record: GameRecord): Promise<void> {
    await this.games.create(record);
  }

  async recentGames(userId: string, limit: number): Promise<GameRecord[]> {
    const docs = await this.games
      .find({ "players.userId": userId })
      .sort({ endedAt: -1 })
      .limit(limit)
      .lean();
    return docs as unknown as GameRecord[];
  }

  async bank(which: BankName): Promise<number> {
    const doc = await this.house.findById(bankId(which));
    return doc?.amount ?? 0;
  }

  async bankAdd(which: BankName, delta: number): Promise<void> {
    await this.house.updateOne(
      { _id: bankId(which) },
      { $inc: { amount: delta } },
      { upsert: true },
    );
  }

  async bankTake(which: BankName, amount: number): Promise<boolean> {
    /*
     * The whole rule expressed as the filter, in the manner of adjustChips. A
     * payout that would overdraw matches nothing and changes nothing, so two
     * concurrent wins cannot both take the last of it.
     */
    const result = await this.house.updateOne(
      { _id: bankId(which), amount: { $gte: amount } },
      { $inc: { amount: -amount } },
    );
    return result.modifiedCount === 1;
  }

  async mintCode(input: {
    chips: number;
    maxRedemptions: number | null;
    expiresAt: number | null;
    note: string;
    createdBy: string;
  }): Promise<CodeRecord> {
    const text = mintCodeText((bytes) => randomBytes(bytes));
    const record = {
      code: normaliseCode(text),
      chips: input.chips,
      maxRedemptions: input.maxRedemptions,
      redemptions: 0,
      expiresAt: input.expiresAt,
      note: input.note,
      createdBy: input.createdBy,
      createdAt: Date.now(),
      revoked: false,
    };
    await this.codes.create(record);
    // Returned with its dashes, because that is the form a person is given.
    return { ...record, code: text };
  }

  async listCodes(limit: number): Promise<CodeRecord[]> {
    const docs = await this.codes.find().sort({ createdAt: -1 }).limit(limit).lean();
    return docs as unknown as CodeRecord[];
  }

  async revokeCode(code: string): Promise<boolean> {
    const result = await this.codes.updateOne(
      { code: normaliseCode(code) },
      { $set: { revoked: true } },
    );
    return result.matchedCount === 1;
  }

  /**
   * Pays a code out, once per player.
   *
   * Three steps, in this order for a reason. The claim comes first, because
   * the unique index is what makes "once each" true and a claim that loses
   * that race must cost nothing. The slot on the code comes second, so a code
   * that has run out is refused before any chips move. The chips come last,
   * and only once both have held.
   *
   * A crash between the second step and the third loses that redemption for
   * that player. For play chips that is an acceptable failure and a cheaper
   * one than a transaction, which would need a replica set to run at all.
   */
  async redeem(code: string, userId: string): Promise<RedeemResult> {
    const key = normaliseCode(code);
    const record = await this.codes.findOne({ code: key }).lean();
    if (record === null) {
      return { ok: false, reason: "unknown-code" };
    }

    const refusal = judgeCode(record as unknown as CodeRecord, Date.now());
    if (refusal !== null) {
      return { ok: false, reason: refusal };
    }

    try {
      await this.redemptions.create({ code: key, userId, chips: record.chips, at: Date.now() });
    } catch {
      // The only way this fails is the unique index, which is the answer.
      return { ok: false, reason: "already-redeemed" };
    }

    const taken = await this.codes.updateOne(
      {
        code: key,
        revoked: false,
        $and: [
          { $or: [{ expiresAt: null }, { expiresAt: { $gt: Date.now() } }] },
          {
            $or: [
              { maxRedemptions: null },
              { $expr: { $lt: ["$redemptions", "$maxRedemptions"] } },
            ],
          },
        ],
      },
      { $inc: { redemptions: 1 } },
    );
    if (taken.modifiedCount !== 1) {
      // Somebody else took the last one between the check and here. Give the
      // claim back, so they can use a different code.
      await this.redemptions.deleteOne({ code: key, userId });
      return { ok: false, reason: "used-up" };
    }

    await this.adjustChips(userId, record.chips);
    const after = await this.get(userId);
    return { ok: true, chips: record.chips, balance: after?.chips ?? record.chips };
  }

  async findPlayers(prefix: string, limit: number): Promise<PublicPlayer[]> {
    const wanted = prefix.trim();
    if (wanted.length === 0) {
      return [];
    }
    /*
     * Anchored, and the input escaped before it is ever a pattern. A name is
     * whatever somebody typed into Discord, and a name containing regex
     * punctuation must be a name to search for rather than a pattern to run.
     */
    const safe = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const docs = await this.users
      .find({ name: new RegExp(`^${safe}`, "i") })
      .select("name avatar accentColor")
      .limit(limit)
      .lean<Array<UserDoc & { _id: mongoose.Types.ObjectId }>>();
    return docs.map((doc) => ({
      id: doc._id.toString(),
      name: doc.name,
      avatar: doc.avatar,
      accentColor: doc.accentColor,
    }));
  }

  async leaderboard({
    sort,
    limit,
    you,
  }: {
    sort: LeaderSort;
    limit: number;
    you: string | null;
  }): Promise<LeaderBoard> {
    const field = LEADER_FIELDS[sort];
    const docs = await this.users
      .find({})
      // `_id` as the tiebreak, so equal figures come back in the same order on
      // every poll and the page does not animate a reorder that never happened.
      .sort({ [field]: -1, _id: 1 })
      .limit(limit)
      .lean<Array<UserDoc & { _id: mongoose.Types.ObjectId }>>();
    const rows = docs.map((doc) => toLeaderRow(toProfile(doc)));
    const total = await this.users.estimatedDocumentCount();

    if (you === null || !mongoose.Types.ObjectId.isValid(you)) {
      return { rows, you: null, total };
    }
    const mine = await this.users.findById(you).lean<UserDoc & { _id: mongoose.Types.ObjectId }>();
    if (mine === null) {
      return { rows, you: null, total };
    }
    const row = toLeaderRow(toProfile(mine));
    /*
     * A count of who is strictly ahead, so everybody on the same figure shares
     * a rank. A document written before `chipsStaked` existed has no such
     * field and so matches no `$gt` — which is the right answer, because a
     * missing figure is a zero and nothing here is ever staked less than none.
     */
    const ahead = await this.users.countDocuments({ [field]: { $gt: leaderValue(row, sort) } });
    return { rows, you: { row, rank: ahead + 1 }, total };
  }

  async sentSince(userId: string, since: number): Promise<number> {
    const [summed] = await this.ledger.aggregate<{ total: number }>([
      { $match: { fromId: userId, at: { $gte: since } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return summed?.total ?? 0;
  }

  async transfers(userId: string, limit: number): Promise<Transfer[]> {
    const docs = await this.ledger
      .find({ $or: [{ fromId: userId }, { toId: userId }] })
      .sort({ at: -1 })
      .limit(limit)
      .lean<TransferDoc[]>();
    return docs.map((doc) => ({
      id: doc._id,
      fromId: doc.fromId,
      fromName: doc.fromName,
      toId: doc.toId,
      toName: doc.toName,
      amount: doc.amount,
      at: doc.at,
    }));
  }

  /**
   * The order here is the whole safety argument and must not be rearranged.
   *
   * The debit goes first and is conditional — `adjustChips` refuses rather
   * than overdrawing — so by the time anything is owed to the recipient the
   * chips have already left the sender. Crediting first would mean a failed
   * debit had handed out chips nobody paid for, which is the one thing this
   * building must not contain.
   *
   * If the credit then fails, the debit is put back. That leaves the pair
   * either wholly done or wholly undone, which is the most that can be
   * promised without a transaction — and a refund that itself failed would be
   * chips destroyed rather than created, which is the safer direction to fail
   * in.
   */
  async send(fromId: string, toId: string, amount: number): Promise<SendResult> {
    const [from, to] = await Promise.all([this.get(fromId), this.get(toId)]);
    const sentToday = await this.sentSince(fromId, Date.now() - SEND_WINDOW_MS);
    const left = leftToSend(sentToday);
    if (from === null || to === null) {
      return { ok: false, reason: "no-recipient", leftToday: left };
    }
    if (fromId === toId) {
      return { ok: false, reason: "to-yourself", leftToday: left };
    }
    const judged = judgeSend({ amount, balance: from.chips, sentToday });
    if (!judged.ok) {
      return { ok: false, reason: judged.reason, leftToday: left };
    }

    if (!(await this.adjustChips(fromId, -amount))) {
      // Somebody else spent it between the read above and here.
      return { ok: false, reason: "not-enough", leftToday: left };
    }
    try {
      await this.adjustChips(toId, amount);
    } catch (error) {
      await this.adjustChips(fromId, amount);
      throw error;
    }

    await this.ledger.create({
      _id: randomUUID(),
      fromId,
      fromName: from.name,
      toId,
      toName: to.name,
      amount,
      at: Date.now(),
    });
    const after = await this.get(fromId);
    return {
      ok: true,
      balance: after?.chips ?? from.chips - amount,
      amount,
      leftToday: left - amount,
      to: { id: to.id, name: to.name },
    };
  }

  async addEmote(input: NewEmote): Promise<EmoteRecord> {
    // Judged here for the same reason the memory store does it: this is the
    // last point before the bytes become something every browser will load.
    const judged = judgeEmote(input);
    if (!judged.ok) {
      throw new Error(judged.reason);
    }
    const doc: EmoteDoc = {
      _id: randomUUID(),
      name: judged.emote.name,
      cost: judged.emote.cost,
      imageMime: judged.emote.imageMime,
      soundMime: judged.emote.soundMime,
      image: Buffer.from(input.image),
      sound:
        judged.emote.soundMime === null || input.sound === null
          ? null
          : Buffer.from(input.sound),
      imageBytes: input.image.length,
      soundBytes: judged.emote.soundMime === null ? null : (input.sound?.length ?? null),
      createdBy: input.createdBy,
      createdAt: Date.now(),
      retired: false,
    };
    await this.emotes.create(doc);
    return toEmote(doc);
  }

  async listEmotes(all: boolean): Promise<EmoteRecord[]> {
    const docs = await this.emotes
      .find(all ? {} : { retired: false })
      // Without this every entry drags its picture across the wire, which is
      // the difference between a list and a download.
      .select(EMOTE_FIELDS)
      .sort({ createdAt: -1 })
      .lean<EmoteDoc[]>();
    return docs.map(toEmote);
  }

  async emoteAsset(id: string, which: "image" | "sound"): Promise<EmoteAsset | null> {
    const doc = await this.emotes
      .findById(id)
      .select(which === "image" ? "image imageMime" : "sound soundMime")
      .lean<EmoteDoc | null>();
    if (doc === null) {
      return null;
    }
    if (which === "image") {
      return { mime: doc.imageMime, bytes: bytesOf(doc.image) };
    }
    if (doc.sound === null || doc.sound === undefined || doc.soundMime === null) {
      return null;
    }
    return { mime: doc.soundMime, bytes: bytesOf(doc.sound) };
  }

  async retireEmote(id: string): Promise<boolean> {
    // Conditional on it not already being retired, so the answer distinguishes
    // "just withdrawn" from "was withdrawn last week" without a second read.
    const result = await this.emotes.updateOne(
      { _id: id, retired: false },
      { $set: { retired: true } },
    );
    return result.modifiedCount > 0;
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}
