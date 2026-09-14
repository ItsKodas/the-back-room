import { randomBytes, randomUUID } from "node:crypto";
import { judgeCode, mintCodeText, normaliseCode } from "./codes.js";
import type { CodeRecord, RedeemResult } from "./codes.js";
import { judgeEmote } from "./emotes.js";
import { judgeSend, leftToSend, SEND_WINDOW_MS } from "./transfers.js";
import type { SendResult, Transfer } from "./transfers.js";
import type { EmoteAsset, EmoteRecord, NewEmote } from "./emotes.js";
/**
 * Where profiles, chips and finished games live.
 *
 * Behind an interface with two implementations, because the game has to work
 * with no database at all — that is how it has run all along, and losing that
 * would mean you could not try it without standing a Mongo up first. The
 * memory store is both the no-database mode and the test double.
 */

export interface Profile {
  id: string;
  discordId: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  lastDailyClaim: number | null;
  stats: ProfileStats;
  /**
   * Per-game figures, under the id of the game that keeps them.
   *
   * Deliberately untyped beyond "numbers by name". `bestTurn`, `farkles` and
   * `hotDice` used to sit in the shared profile, where they were three of the
   * six things a player was — and blackjack has no answer for any of them. A
   * game names its own figures; nothing here knows what they mean.
   */
  byGame: Record<string, Record<string, number>>;
  /**
   * The tip jar this account is filling.
   *
   * Here rather than at the game because it is chips: it has to survive a
   * restart, and a jar held only in a server's memory would be a jar that
   * refills itself every deploy.
   */
  jar: JarRecord;
}

/**
 * A player as somebody else may see them.
 *
 * What is not here is the point of it: no balance, no Discord id, no stats.
 * Enough to recognise a person you meant to pay and no more.
 */
export interface PublicPlayer {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
}

/**
 * The columns a board may be ordered by.
 *
 * A win rate is not among them, and will not be. It is a ratio of two stored
 * numbers, so there is no index for it — and a player with one lucky hand sits
 * at a hundred percent forever, which makes a board of people who have played
 * once. Every row prints its rate; no column sorts by it.
 */
export const LEADER_SORTS = ["chips", "net", "staked", "games", "wins"] as const;
export type LeaderSort = (typeof LEADER_SORTS)[number];

/**
 * A player as the board prints them.
 *
 * Deliberately not `PublicPlayer`. That type exists to carry no balance and
 * this one exists to carry one, so they are two types rather than one with a
 * flag — nothing that asks who somebody is should ever start being told what
 * they hold because a field was added in the wrong place.
 */
export interface LeaderRow {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  stats: ProfileStats;
}

export interface LeaderBoard {
  rows: LeaderRow[];
  /** The viewer's own standing, wherever they finished. Null if nobody asked. */
  you: { row: LeaderRow; rank: number } | null;
  total: number;
}

/** The figure a sort orders by, read off one row. */
export function leaderValue(row: { chips: number; stats: ProfileStats }, sort: LeaderSort): number {
  switch (sort) {
    case "chips":
      return row.chips;
    case "net":
      return row.stats.chipsWon;
    case "staked":
      return row.stats.chipsStaked;
    case "games":
      return row.stats.games;
    case "wins":
      return row.stats.wins;
  }
}

export function toLeaderRow(profile: {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  stats: ProfileStats;
}): LeaderRow {
  return {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    accentColor: profile.accentColor,
    chips: profile.chips,
    // Copied rather than handed out, for the same reason `toProfile` copies it.
    stats: { ...profile.stats },
  };
}

/** What every game can answer about a player, whatever the game is. */
export interface ProfileStats {
  games: number;
  wins: number;
  chipsWon: number;
  /**
   * Chips put on the felt, win or lose.
   *
   * Not the opposite of `chipsWon`, which is a net: somebody who turns over a
   * million chips and finishes level has done something, and the net says they
   * did nothing. A free round stakes nothing, because nothing was staked.
   */
  chipsStaked: number;
}

/**
 * One update to a player's figures.
 *
 * The caller says which of its own figures are running totals and which are
 * high-water marks, because only the game knows: a best turn is a maximum, a
 * count of farkles is a sum, and the store cannot tell them apart by name
 * without knowing the game — which is exactly what it must not know.
 */
export interface StatBump {
  /** Totals every game shares. */
  shared?: Partial<ProfileStats>;
  /** The game these figures belong to. Required if either map is given. */
  game?: string;
  /** Added to whatever is there. */
  add?: Record<string, number>;
  /** Kept only if larger than what is there. */
  max?: Record<string, number>;
}

export interface GameRecord {
  code: string;
  rulesetName: string;
  buyIn: number;
  pot: number;
  players: Array<{
    userId: string | null;
    name: string;
    score: number;
    isBot: boolean;
    /**
     * What this player's chips did. Optional because records written before
     * it existed do not have one, and a history that hid those would be worse
     * than one that shows them with the figure it can still work out.
     */
    net?: number;
  }>;
  winnerIds: string[];
  endedAt: number;
}

/**
 * The banks in the building, one per game that pays from one.
 *
 * Separate on purpose. A shared bank would be whichever game holds back the
 * most quietly paying for the one that holds back the least — the machine
 * keeps a tenth of what goes through it, a blackjack table about a
 * two-hundredth and a single-zero wheel about a thirty-seventh, so one pot
 * would be the machine funding the felt.
 *
 * A list rather than only a type, because a type cannot be counted. Every
 * bank needs a float before its game will take a stake at all, so the admin
 * room has to have a panel for each one — and a bank added here and forgotten
 * there is a game that silently will not deal, which is exactly what happened
 * to the wheel. The name is still a closed set: the type is read off the list,
 * so a typo is a build error rather than a bank nobody can find that quietly
 * holds somebody's chips.
 */
export const BANKS = ["slots", "blackjack", "roulette"] as const;

export type BankName = (typeof BANKS)[number];

/**
 * A player's tip jar, structurally identical to `Jar` in
 * `games/tips/src/jar.ts`.
 *
 * Written out here rather than imported, for the same reason `BankName` is:
 * no package under `packages/` may depend on anything under `games/` — a
 * jar is chips, and chips belong on the profile whichever game is filling
 * it. Task 9 adds a compile-time assertion in `apps/server`, where both this
 * type and `Jar` are visible, that the two stay mutually assignable; that
 * check cannot live here, because this package cannot see `Jar` at all.
 */
export interface JarRecord {
  level: number;
  levelAt: number;
  favours: number;
  bought: string[];
  nightStartedAt: number;
  paidThisNight: number;
  token: string;
  rhythm: number[];
  lastTapAt: number | null;
}

/**
 * The zero jar: never touched. A blank token is that state's marker — the
 * server mints a real one on first contact by swapping against `""`.
 */
export function emptyJarRecord(): JarRecord {
  return {
    level: 0,
    levelAt: 0,
    favours: 0,
    bought: [],
    nightStartedAt: 0,
    paidThisNight: 0,
    token: "",
    rhythm: [],
    lastTapAt: null,
  };
}

export interface Store {
  readonly kind: "memory" | "mongo";
  upsertDiscordUser(input: {
    discordId: string;
    name: string;
    avatar: string | null;
    accentColor: number | null;
  }): Promise<Profile>;
  get(id: string): Promise<Profile | null>;
  /**
   * Moves a balance. Returns false rather than overdrawing, so a debit is safe
   * to call concurrently — the Mongo implementation does it as one conditional
   * update rather than a read followed by a write.
   */
  adjustChips(id: string, delta: number): Promise<boolean>;

  /** This account's jar and balance, for somebody who has just walked up to it. */
  jar(id: string): Promise<{ jar: JarRecord; chips: number } | null>;

  /**
   * Swaps a jar for its successor, and moves chips in the same operation.
   *
   * Conditional on `expectedToken` still being the jar's token. The caller
   * decided what the next jar should be by reading the current one; if
   * another tap has landed in between, the token has moved, this write does
   * not match, and the caller is told so rather than paying a second time
   * from a jar it can no longer see.
   *
   * On a failed swap, `ok` is false and the returned `jar`/`chips` are the
   * current values re-read from the store, so the caller can resync.
   * `chipDelta` may be zero (a buy) or positive (a tap); this game only ever
   * credits, and there is no floor on the balance here — a caller that ever
   * needed to debit would have to add one, the way `adjustChips` does.
   */
  applyJar(
    id: string,
    expectedToken: string,
    next: JarRecord,
    chipDelta: number,
  ): Promise<{ ok: boolean; chips: number; jar: JarRecord }>;

  bumpStats(id: string, bump: StatBump): Promise<void>;
  recordGame(record: GameRecord): Promise<void>;

  /**
   * A game's bank: chips players have staked at it and not yet won back.
   *
   * It lives here rather than at the game because it is real money and has to
   * survive a restart. Nothing in the building may add to one except play at
   * that game and an admin's deliberate float — a bank that could be topped up
   * from anywhere is a house that mints chips, which is the one thing this
   * casino must not contain.
   *
   * One per game rather than one for the building, and the name is required
   * rather than defaulted. The two games fill their banks at very different
   * rates — a machine keeps a tenth of what goes through it, a blackjack table
   * about a two-hundredth — so a shared bank would be the machine quietly
   * paying for the table. A missing argument would be exactly that bug,
   * silently, so there is no argument to miss.
   */
  bank(which: BankName): Promise<number>;
  bankAdd(which: BankName, delta: number): Promise<void>;
  /** Pays out, or returns false rather than overdrawing. */
  bankTake(which: BankName, amount: number): Promise<boolean>;

  /** Puts a new code into circulation. */
  mintCode(input: {
    chips: number;
    maxRedemptions: number | null;
    expiresAt: number | null;
    note: string;
    createdBy: string;
  }): Promise<CodeRecord>;
  /** Newest first, for the person who has to decide what to revoke. */
  listCodes(limit: number): Promise<CodeRecord[]>;
  /** Stops a code without deleting it, so the ledger still explains itself. */
  revokeCode(code: string): Promise<boolean>;
  /**
   * Pays a code out, once per player.
   *
   * Every implementation must make "once each" a thing that cannot be raced:
   * two clicks a millisecond apart are the ordinary case, not the exotic one.
   */
  redeem(code: string, userId: string): Promise<RedeemResult>;
  recentGames(userId: string, limit: number): Promise<GameRecord[]>;

  /**
   * Players whose name begins with this, for somebody looking for one to pay.
   *
   * A prefix rather than anything cleverer, and capped, because this is the
   * one route in the building that answers questions about people who are not
   * asking. It is behind a sign-in, it never returns a balance, and a caller
   * gets a handful of matches rather than the playerbase.
   */
  findPlayers(prefix: string, limit: number): Promise<PublicPlayer[]>;

  /**
   * Who is ahead.
   *
   * The one route in the building that publishes balances, which is the exact
   * opposite of what `PublicPlayer` above exists to refuse — see the design
   * doc for why that exception is allowed and how it is kept narrow.
   *
   * Rows and the viewer's own standing come back together because a rank is a
   * position in the whole collection rather than a property of a row: a caller
   * that asked for a page and then went looking for itself would be answering
   * a different question from the one the page answered.
   */
  leaderboard(input: { sort: LeaderSort; limit: number; you: string | null }): Promise<LeaderBoard>;

  /**
   * Moves chips from one account to another, and writes it down.
   *
   * One method rather than two `adjustChips` calls, because a debit that
   * lands and a credit that does not is chips destroyed, and neither caller
   * nor store would know. Everything the rule depends on — what the sender
   * holds, what they have already sent today — is read here rather than passed
   * in, so no caller can decide it is allowed.
   */
  send(fromId: string, toId: string, amount: number): Promise<SendResult>;

  /** What this account has sent inside the window ending now. */
  sentSince(userId: string, since: number): Promise<number>;

  /** This account's transfers, in and out, newest first. */
  transfers(userId: string, limit: number): Promise<Transfer[]>;

  /**
   * The emotes players may throw at each other, and the files behind them.
   *
   * Uploaded by an admin, which puts them behind the same allowlist as minting
   * a code — not because an emote is chips, but because it is the one thing in
   * this building that a person supplies and every other person's browser then
   * loads. What may be uploaded is decided in `emotes.ts`, off the bytes.
   *
   * Note that a store which keeps nothing keeps no emotes either, so a room
   * with no database has none to offer. That is the same bargain profiles,
   * chips and codes already make, and the alternative — a picture that lives
   * until the next restart — is worse than not offering one.
   */
  addEmote(input: NewEmote): Promise<EmoteRecord>;
  /** Newest first. `all` includes retired ones, for the admin's list. */
  listEmotes(all: boolean): Promise<EmoteRecord[]>;
  /**
   * One emote's picture or sound, or null when there is none.
   *
   * Answers for a retired emote too: it may still be waiting in a bonus pool
   * to be replayed at whoever threw it, and a replay that renders as a broken
   * image is worse than one that should not have been offered.
   */
  emoteAsset(id: string, which: "image" | "sound"): Promise<EmoteAsset | null>;
  /** Stops an emote being offered, without deleting what it was. */
  retireEmote(id: string): Promise<boolean>;

  close(): Promise<void>;
}

/** What a new profile starts with. */
export const STARTING_CHIPS = 10_000;

export function emptyStats(): ProfileStats {
  return { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 };
}

export class MemoryStore implements Store {
  private readonly codes = new Map<string, CodeRecord>();
  /** "code:player", which is the whole of the one-each rule in memory. */
  private readonly redeemed = new Set<string>();
  readonly kind = "memory" as const;
  private readonly people = new Map<string, Profile>();
  private readonly games: GameRecord[] = [];
  /** Each game's bank. Numbers, because that is all they ever are. */
  private readonly house = new Map<BankName, number>();
  private readonly emotes = new Map<string, EmoteRecord>();
  /**
   * The files, apart from the records that describe them.
   *
   * Two maps rather than one, for the same reason the record carries no bytes:
   * listing the emotes is a common thing to do and copying a couple of
   * megabytes each time to answer it is not.
   */
  /** Every transfer ever made here, oldest first. Appended to, never edited. */
  private readonly ledger: Transfer[] = [];
  private readonly emoteFiles = new Map<
    string,
    { image: EmoteAsset; sound: EmoteAsset | null }
  >();

  async bank(which: BankName): Promise<number> {
    return this.house.get(which) ?? 0;
  }

  async bankAdd(which: BankName, delta: number): Promise<void> {
    this.house.set(which, (this.house.get(which) ?? 0) + delta);
  }

  async bankTake(which: BankName, amount: number): Promise<boolean> {
    const held = this.house.get(which) ?? 0;
    if (amount > held) {
      return false;
    }
    this.house.set(which, held - amount);
    return true;
  }

  async upsertDiscordUser(input: {
    discordId: string;
    name: string;
    avatar: string | null;
    accentColor: number | null;
  }): Promise<Profile> {
    const existing = [...this.people.values()].find(
      (person) => person.discordId === input.discordId,
    );
    if (existing !== undefined) {
      existing.name = input.name;
      existing.avatar = input.avatar;
      existing.accentColor = input.accentColor;
      return existing;
    }
    const profile: Profile = {
      id: `u_${input.discordId}`,
      discordId: input.discordId,
      name: input.name,
      avatar: input.avatar,
      accentColor: input.accentColor,
      chips: STARTING_CHIPS,
      lastDailyClaim: null,
      stats: emptyStats(),
      byGame: {},
      jar: emptyJarRecord(),
    };
    this.people.set(profile.id, profile);
    return profile;
  }

  async get(id: string): Promise<Profile | null> {
    return this.people.get(id) ?? null;
  }

  async adjustChips(id: string, delta: number): Promise<boolean> {
    const profile = this.people.get(id);
    if (profile === undefined) {
      return false;
    }
    if (delta < 0 && profile.chips + delta < 0) {
      return false;
    }
    profile.chips += delta;
    return true;
  }

  async jar(id: string): Promise<{ jar: JarRecord; chips: number } | null> {
    const profile = this.people.get(id);
    return profile === undefined ? null : { jar: profile.jar, chips: profile.chips };
  }

  /*
   * No `await` between the compare and the write. That is the whole
   * atomicity argument for this store: node runs this to completion before
   * any other caller gets a turn, so a hundred concurrent swaps queue
   * rather than race.
   */
  async applyJar(
    id: string,
    expectedToken: string,
    next: JarRecord,
    chipDelta: number,
  ): Promise<{ ok: boolean; chips: number; jar: JarRecord }> {
    const profile = this.people.get(id);
    if (profile === undefined) {
      return { ok: false, chips: 0, jar: emptyJarRecord() };
    }
    if (profile.jar.token !== expectedToken) {
      return { ok: false, chips: profile.chips, jar: profile.jar };
    }
    profile.jar = next;
    profile.chips += chipDelta;
    return { ok: true, chips: profile.chips, jar: profile.jar };
  }

  async bumpStats(id: string, bump: StatBump): Promise<void> {
    const profile = this.people.get(id);
    if (profile === undefined) {
      return;
    }
    for (const [key, value] of Object.entries(bump.shared ?? {})) {
      profile.stats[key as keyof ProfileStats] += value;
    }
    if (bump.game === undefined) {
      return;
    }
    profile.byGame[bump.game] ??= {};
    const figures = profile.byGame[bump.game];
    for (const [key, value] of Object.entries(bump.add ?? {})) {
      figures[key] = (figures[key] ?? 0) + value;
    }
    for (const [key, value] of Object.entries(bump.max ?? {})) {
      figures[key] = Math.max(figures[key] ?? 0, value);
    }
  }

  async recordGame(record: GameRecord): Promise<void> {
    this.games.unshift(record);
    this.games.splice(200);
  }

  async recentGames(userId: string, limit: number): Promise<GameRecord[]> {
    return this.games
      .filter((game) => game.players.some((player) => player.userId === userId))
      .slice(0, limit);
  }

  async mintCode(input: {
    chips: number;
    maxRedemptions: number | null;
    expiresAt: number | null;
    note: string;
    createdBy: string;
  }): Promise<CodeRecord> {
    const record: CodeRecord = {
      code: mintCodeText((bytes) => randomBytes(bytes)),
      chips: input.chips,
      maxRedemptions: input.maxRedemptions,
      redemptions: 0,
      expiresAt: input.expiresAt,
      note: input.note,
      createdBy: input.createdBy,
      createdAt: Date.now(),
      revoked: false,
    };
    this.codes.set(normaliseCode(record.code), record);
    return record;
  }

  async listCodes(limit: number): Promise<CodeRecord[]> {
    return [...this.codes.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async revokeCode(code: string): Promise<boolean> {
    const record = this.codes.get(normaliseCode(code));
    if (record === undefined) {
      return false;
    }
    record.revoked = true;
    return true;
  }

  async redeem(code: string, userId: string): Promise<RedeemResult> {
    const key = normaliseCode(code);
    const record = this.codes.get(key);
    if (record === undefined) {
      return { ok: false, reason: "unknown-code" };
    }
    if (this.redeemed.has(`${key}:${userId}`)) {
      return { ok: false, reason: "already-redeemed" };
    }
    const refusal = judgeCode(record, Date.now());
    if (refusal !== null) {
      return { ok: false, reason: refusal };
    }
    const profile = this.people.get(userId);
    if (profile === undefined) {
      return { ok: false, reason: "unknown-code" };
    }
    this.redeemed.add(`${key}:${userId}`);
    record.redemptions += 1;
    profile.chips += record.chips;
    return { ok: true, chips: record.chips, balance: profile.chips };
  }

  async findPlayers(prefix: string, limit: number): Promise<PublicPlayer[]> {
    const wanted = prefix.trim().toLowerCase();
    if (wanted.length === 0) {
      return [];
    }
    return [...this.people.values()]
      .filter((person) => person.name.toLowerCase().startsWith(wanted))
      .slice(0, limit)
      .map((person) => ({
        id: person.id,
        name: person.name,
        avatar: person.avatar,
        accentColor: person.accentColor,
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
    const everyone = [...this.people.values()].map(toLeaderRow).sort((a, b) => {
      const apart = leaderValue(b, sort) - leaderValue(a, sort);
      // Id as the tiebreak, so two players on the same figure do not swap
      // places between one poll and the next and make the board animate a
      // reorder that never happened. This only has to be stable within this
      // store, not match Mongo's `_id: 1` tiebreak row for row — the design's
      // Stability clause is about the rank number the two stores agree on,
      // and a rank is shared by everyone tied on it, so which of them sits
      // first inside a tie is not a fact either store promises the other.
      return apart !== 0 ? apart : a.id.localeCompare(b.id);
    });
    const mine = you === null ? null : (everyone.find((row) => row.id === you) ?? null);
    return {
      rows: everyone.slice(0, limit),
      you:
        mine === null
          ? null
          : {
              row: mine,
              // One more than however many are strictly ahead, so everybody on
              // the same figure shares a rank and the next one down skips.
              rank:
                everyone.filter((row) => leaderValue(row, sort) > leaderValue(mine, sort)).length + 1,
            },
      total: everyone.length,
    };
  }

  async sentSince(userId: string, since: number): Promise<number> {
    return this.ledger
      .filter((one) => one.fromId === userId && one.at >= since)
      .reduce((total, one) => total + one.amount, 0);
  }

  async transfers(userId: string, limit: number): Promise<Transfer[]> {
    return this.ledger
      .filter((one) => one.fromId === userId || one.toId === userId)
      .sort((left, right) => right.at - left.at)
      .slice(0, limit);
  }

  async send(fromId: string, toId: string, amount: number): Promise<SendResult> {
    const from = this.people.get(fromId);
    const to = this.people.get(toId);
    const sentToday = await this.sentSince(fromId, Date.now() - SEND_WINDOW_MS);
    const left = leftToSend(sentToday);
    if (from === undefined) {
      return { ok: false, reason: "no-recipient", leftToday: left };
    }
    if (to === undefined) {
      return { ok: false, reason: "no-recipient", leftToday: left };
    }
    if (fromId === toId) {
      return { ok: false, reason: "to-yourself", leftToday: left };
    }
    const judged = judgeSend({ amount, balance: from.chips, sentToday });
    if (!judged.ok) {
      return { ok: false, reason: judged.reason, leftToday: left };
    }

    from.chips -= amount;
    to.chips += amount;
    this.ledger.push({
      id: randomUUID(),
      fromId,
      fromName: from.name,
      toId,
      toName: to.name,
      amount,
      at: Date.now(),
    });
    return {
      ok: true,
      balance: from.chips,
      amount,
      leftToday: left - amount,
      to: { id: to.id, name: to.name },
    };
  }

  async addEmote(input: NewEmote): Promise<EmoteRecord> {
    /*
     * Judged here as well as at the route, and not as a belt-and-braces
     * gesture: this is the last point before bytes become something every
     * player's browser will load, and a caller that forgot to check is the
     * exact way an unchecked file gets in. Throwing is right — a store handed
     * a file it must not keep has been asked to do something impossible.
     */
    const judged = judgeEmote(input);
    if (!judged.ok) {
      throw new Error(judged.reason);
    }
    const record: EmoteRecord = {
      id: randomUUID(),
      name: judged.emote.name,
      cost: judged.emote.cost,
      imageMime: judged.emote.imageMime,
      soundMime: judged.emote.soundMime,
      imageBytes: input.image.length,
      soundBytes: judged.emote.soundMime === null ? null : (input.sound?.length ?? null),
      createdBy: input.createdBy,
      createdAt: Date.now(),
      retired: false,
    };
    this.emotes.set(record.id, record);
    /*
     * Copied rather than kept by reference. The caller owns the buffer it
     * decoded and is free to reuse it; a store that held on to it would serve
     * whatever that buffer happened to contain later.
     */
    this.emoteFiles.set(record.id, {
      image: { mime: judged.emote.imageMime, bytes: Uint8Array.from(input.image) },
      sound:
        judged.emote.soundMime === null || input.sound === null
          ? null
          : { mime: judged.emote.soundMime, bytes: Uint8Array.from(input.sound) },
    });
    return record;
  }

  async listEmotes(all: boolean): Promise<EmoteRecord[]> {
    return [...this.emotes.values()]
      .filter((emote) => all || !emote.retired)
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  async emoteAsset(id: string, which: "image" | "sound"): Promise<EmoteAsset | null> {
    const files = this.emoteFiles.get(id);
    if (files === undefined) {
      return null;
    }
    return which === "image" ? files.image : files.sound;
  }

  async retireEmote(id: string): Promise<boolean> {
    const emote = this.emotes.get(id);
    if (emote === undefined || emote.retired) {
      return false;
    }
    emote.retired = true;
    return true;
  }

  async close(): Promise<void> {
    // nothing to release
  }
}
