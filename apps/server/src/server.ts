import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameAdapter, GameDeps, PlayTable, SeatIdentity } from "@backroom/core";
import { Catalogue, COMING, Taunts } from "@backroom/core";
import type { BankName, Store } from "@backroom/economy";
import { BANKS, MemoryStore } from "@backroom/economy";
import {
  BLACKJACK,
  blackjackAdapter,
  maxStake as blackjackMaxStake,
} from "@backroom/game-blackjack";
import { DEATH_ROLL, deathRollAdapter } from "@backroom/game-death-roll";
import { GREED, greedAdapter, RoomError } from "@backroom/game-greed";
import { POKER, pokerAdapter } from "@backroom/game-poker";
import {
  ROULETTE,
  rouletteAdapter,
  STAKE_DIVISOR as ROULETTE_DIVISOR,
} from "@backroom/game-roulette";
import {
  countScatters,
  drawGrid,
  evaluate,
  freeSpinsFor,
  FUN_BANK,
  FUN_PURSE,
  jackpotPay,
  LINE_COUNT,
  maxFreeStake,
  maxStake,
  MIN_STAKE,
  SLOTS,
} from "@backroom/game-slots";
import type { Die } from "@backroom/rules";
import { TIPS } from "@backroom/game-tips";

import type {
  Ack,
  ClientToServer,
  ServerToClient,
  SpinNews,
  SpinResult,
  TableOnOffer,
  TauntPlay,
} from "@backroom/shared";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
// From the subpath, not the barrel: the client imports the barrel, and pulling
// zod in through it would ship a validation library to every browser.
import {
  actionSchema,
  addBotSchema,
  chatSchema,
  createSchema,
  handshakeSchema,
  joinSchema,
  mintCodeSchema,
  removeSeatSchema,
  resumeSchema,
  setBuyInSchema,
  setListedSchema,
  setRulesSchema,
  tauntSchema,
  watchSchema,
  spinSchema,
} from "@backroom/shared/schemas";
import express from "express";
import session from "express-session";
import type { DefaultEventsMap } from "socket.io";
import { Server } from "socket.io";
import { readAdmins } from "./admin.js";
import type { AuthConfig } from "./auth.js";
import { mountAuth, readAuthConfig } from "./auth.js";
import { friendlyRedirect } from "./domains.js";
import { EMOTE_UPLOAD_PATH, emoteUrls, mountEmotes } from "./emotes.js";
import { mountLeaderboard } from "./leaderboard.js";
import { mountTransfers } from "./transfers.js";
import { wireTips } from "./tips.js";
import { inject, pageFor } from "./meta.js";
import type { CardSpec } from "./og.js";
import { Avatars, Cards } from "./og.js";

/**
 * What the room offers.
 *
 * A game that exists lists itself: these are the same objects the adapters
 * carry, so a game cannot be advertised here with a name, a seat count or an
 * open sign that differs from the one it is actually played under.
 */
/*
 * Everything the room shows, in the order it shows it: what can be played
 * first, then what is coming. `playable()` filters on the same `open` flag the
 * room draws from, so a listing here is a sign on a door rather than a door.
 */
const CATALOGUE = COMING.reduce(
  (catalogue, game) => catalogue.add(game),
  new Catalogue()
    .add(GREED)
    .add(BLACKJACK)
    .add(SLOTS)
    .add(POKER)
    .add(TIPS)
    .add(ROULETTE)
    .add(DEATH_ROLL),
);


/**
 * Where the reels get their randomness.
 *
 * Not Math.random. V8 implements that as xorshift128+, whose internal state
 * can be recovered from a modest run of observed outputs — and this machine
 * hands the player the whole grid after every spin, which is precisely the
 * observation that attack needs. Predicting the reels here is worth real
 * money: the jackpot is 40% of the bank, and the stake cap rises as the bank
 * does, so somebody who knew when it was coming could bet the maximum into it.
 *
 * 2^32 divides the 32-stop strip exactly, so scaling a uniform 32-bit integer
 * down to [0, 1) introduces no modulo bias.
 */
function secureRandom(): number {
  return randomInt(0, 2 ** 32) / 2 ** 32;
}

export interface BackRoomServerOptions {
  /** Injected so tests can roll deterministically. */
  roll?: (count: number) => Die[];
  /**
   * Where the slot machine's reels come from. Injected for the same reason as
   * `roll`: a jackpot is one spin in fifteen thousand, and a payout that rare
   * cannot be tested against real randomness.
   */
  spinRandom?: () => number;
  /**
   * Where a death roll duel's number comes from. Injected for the same reason
   * as `roll`: a duel decided by real chance can take anywhere from one turn
   * to dozens, and a test that needed the real odds to land on the first roll
   * would be flaky by design rather than by accident.
   */
  deathRollRoll?: (ceiling: number) => number;
  /** How long the busting dice stay on screen before play moves on. */
  farklePauseMs?: number;
  /**
   * How long a blackjack table waits for bets, and how long a finished hand
   * stays up. Arguments so a test can hurry a table that otherwise takes half
   * a minute to come round; never reachable from a client.
   */
  bettingMs?: number;
  settleMs?: number;
  turnMs?: number;
  /**
   * How much of that window takes no more chips. Only meaningful shorter than
   * the window itself, so a test hurrying a table has to turn this down too.
   */
  lastCallMs?: number;
  /** How long a dropped player keeps their seat. */
  reconnectGraceMs?: number;
  /** How long an abandoned table survives. */
  emptyRoomTtlMs?: number;
  /** Where the browser client is served from, for CORS. */
  clientOrigin?: string;
  /** Off in tests: there is no built client to serve. */
  serveClient?: boolean;
  /**
   * Where that built client is.
   *
   * An option only so a test can hand over a directory it wrote itself. The
   * head this server injects is the whole of what a link unfurls into, and
   * checking that meant either depending on a real `vite build` having been
   * run — a test that passes or fails on whether somebody remembered — or
   * being able to point this somewhere.
   */
  clientDist?: string;
  /** Range of the bot's fake thinking time. Tests set this to nearly nothing. */
  botDelayMs?: number | null;
  /** Where profiles and chips live. Defaults to memory, which is a real mode. */
  store?: Store;
  /** Null disables sign-in; the game still runs and guests still play. */
  auth?: AuthConfig | null;
  sessionSecret?: string;
  /** Session store, when something better than memory is available. */
  sessionStore?: session.Store;
  /**
   * Who a socket belongs to. Defaults to the session cookie; tests override
   * it because a real identity would otherwise need a Discord round-trip.
   */
  identify?: (socket: { id: string; request: unknown }) => string | null;
  /**
   * Who a request belongs to. Defaults to the session cookie.
   *
   * The mirror of `identify` for the HTTP routes. Both exist so tests can say
   * who is asking without standing up a real sign-in, and neither is reachable
   * from a request — they are arguments to the constructor, so nothing a
   * client sends can choose one.
   */
  identifyRequest?: (request: { session?: { userId?: string } }) => string | null;
}

/**
 * What we hang off a socket: the display name its account owns, resolved once
 * at connection. Null for a guest, who has no account to be checked against.
 */
/*
 * Exported so tips.ts — the only other module that reads a socket's
 * identity — can type its handlers against the real thing rather than a
 * second copy of this shape that could drift from it.
 */
export interface SocketIdentity {
  /** Null for a guest, who has no account to be checked against. */
  identity: SeatIdentity | null;
  name: string | null;
  /**
   * Which account-and-game claim this socket holds, if it holds one. Kept so
   * `disconnect` can release exactly the claim this socket took and no other.
   */
  atGame: string | null;
}

/** A table, and the game being played at it. */
interface Seated {
  game: GameAdapter<PlayTable>;
  table: PlayTable;
  /**
   * Whether it appears on the public list.
   *
   * Kept here rather than on the table because it is not about play. A game
   * decides what a hand is worth; the building decides who can find the room
   * it is being played in, and no game has an opinion on that.
   */
  listed: boolean;
}

export interface BackRoomServer {
  http: HttpServer;
  store: Store;
  io: Server<ClientToServer, ServerToClient>;
  /** Tables currently in memory. Exposed for tests and the health check. */
  rooms: Map<string, Seated>;
  close: () => Promise<void>;
}

const BOT_NAMES = ["Skint Alice", "Pockets", "Old Ned", "Bess", "Cutter", "Tumble", "Ivy"];

/** A socket may send this many events in this window before being ignored. */
const RATE_EVENTS = 60;
/*
 * Guessing a code is the only attack in the product that pays, and ten
 * characters of a thirty-letter alphabet is roughly 5.9 x 10^14 of them — so
 * this is not the thing standing between an attacker and free chips. What it
 * does is make the attempt cost an account and a wait, which is enough when
 * the search space is that size.
 */
const REDEEM_TRIES = 10;
const REDEEM_WINDOW_MS = 60_000;
const RATE_WINDOW_MS = 2000;
/** Chat is throttled harder, because it is the only thing others must read. */
const CHAT_EVENTS = 5;
const CHAT_WINDOW_MS = 5000;
/**
 * Taunts are throttled harder still, and on their own budget.
 *
 * Harder because one costs chips and lands as a picture over somebody's cards
 * — a fast enough sender could bury the table under them and be out of pocket
 * for the privilege, which is not a defence. Its own budget because spending
 * chips should not use up the allowance for saying "nice hand".
 */
const TAUNT_EVENTS = 3;
const TAUNT_WINDOW_MS = 10_000;

interface Budget {
  count: number;
  resetAt: number;
}

/**
 * Every address the client owns, which is everything the server does not.
 *
 * Exported because it is a negative match and those fail quietly: get it wrong
 * and API requests are answered with the HTML page, which a browser will
 * cheerfully render and no test that talks to the socket will ever notice.
 */
export const CLIENT_ROUTE = /^(?!\/(?:healthz|auth|api|og|socket\.io)\b).*/;

export function createBackRoomServer(options: BackRoomServerOptions = {}): BackRoomServer {
  const {
    roll = defaultRoll,
    spinRandom = secureRandom,
    deathRollRoll,
    farklePauseMs = 2200,
    bettingMs,
    settleMs,
    turnMs,
    lastCallMs,
    reconnectGraceMs = 90_000,
    emptyRoomTtlMs = 5 * 60 * 1000,
    clientOrigin = "http://localhost:5173",
    serveClient = true,
    clientDist: clientDistOption,
    botDelayMs = null,
    store = new MemoryStore(),
    auth = readAuthConfig(process.env),
    sessionSecret = resolveSessionSecret(process.env["SESSION_SECRET"]),
    sessionStore,
    identify,
    identifyRequest,
  } = options;

  /**
   * Open tables, each with the game it is being played under.
   *
   * The pair rather than the table alone: the socket layer knows how to seat
   * people and pass messages, and has to ask the game for everything else.
   */
  const rooms = new Map<string, Seated>();
  const here = dirname(fileURLToPath(import.meta.url));
  const clientDist = clientDistOption ?? join(here, "../../web/dist");
  /** Draws the picture a link unfurls into, and keeps the last few. */
  const cards = new Cards(join(here, "../assets/fonts"));
  /** Players' faces, so a link to a table shows who is already at it. */
  const avatars = new Avatars();
  /**
   * Which table each socket is at, and as whom. A null seat is someone
   * watching: at the table, in the room, sent every state, holding nothing.
   */
  const sockets = new Map<string, { code: string; seatId: string | null }>();
  /**
   * A machine somebody is playing for nothing, one per socket.
   *
   * Its purse and its bank both live here and are gone when the socket is: no
   * account is touched, nothing is recorded, and the house bank never hears
   * about it. That is what "play money never touches an account" means for a
   * game with no table to keep it at.
   */
  interface FreeSpins {
    left: number;
    stake: number;
    lines: number;
  }

  const funMachines = new Map<
    string,
    { purse: number; bank: number; free: FreeSpins | null }
  >();

  /**
   * Free spins somebody is owed, and the bet they replay.
   *
   * The bet is stored rather than taken from the pull that claims it, because
   * a free spin is the triggering spin repeated — not a fresh one the player
   * gets to re-size. Otherwise the trick is to trigger the bonus on the
   * smallest stake the machine takes and then claim the eight at the largest,
   * which is a way to be paid at a stake nobody ever put up.
   *
   * Kept in memory and by account rather than by socket, so a reconnect does
   * not lose them and a second tab cannot play them twice. They do not survive
   * a restart, which is a real loss and the honest trade for not writing a
   * table nobody else needs.
   */
  const freeSpins = new Map<string, FreeSpins>();
  /**
   * Accounts with a pull already in flight.
   *
   * The handler above awaits the bank, the debit and the payout between
   * reading the free-spin count and writing it back, so two pulls that overlap
   * both read the same number. By account rather than by socket, because two
   * windows is only the easiest way to overlap them and not the only one.
   */
  const spinning = new Set<string>();
  /** Everybody standing at the slot machine, whether or not they are spinning. */
  const SLOTS_ROOM = "slots:floor";
  /*
   * The last few spins, so somebody who has just walked up sees a machine
   * that has been played rather than one that has never been touched. Kept in
   * memory and lost on restart, which is right: this is atmosphere, not a
   * record, and the history has its own home.
   */
  const recentSpins: SpinNews[] = [];
  const turnClocks = new Map<string, NodeJS.Timeout>();
  /** What each table is waiting on, and the timer that ends the wait. */
  const pauses = new Map<string, { key: string; timer: NodeJS.Timeout }>();
  const botMoves = new Map<string, NodeJS.Timeout>();
  const budgets = new Map<string, Budget>();
  /* Keyed by account, not by socket: a socket is free to make more of. */
  const redeemBudgets = new Map<string, Budget>();
  /** Tables already paid out, so a re-broadcast cannot pay twice. */
  const settled = new Set<string>();
  /**
   * Chips staked on people by whoever paid to mock them.
   *
   * Lives here rather than in a game, because no game knows what a taunt is
   * and every one of them gets taunts anyway — the same reasoning that keeps
   * `listed` out of the games and in the envelope around them.
   */
  const taunts = new Taunts();
  const chatBudgets = new Map<string, Budget>();
  const tauntBudgets = new Map<string, Budget>();
  /** Searching for somebody and paying them, budgeted by account. */
  const sendBudgets = new Map<string, Budget>();
  /** Asking who is ahead, budgeted by account. */
  const boardBudgets = new Map<string, Budget>();
  /**
   * The emotes this server has seen thrown, by id.
   *
   * A pool holds an emote's id and nothing else, but replaying one needs its
   * name and its files — and by then it may have been retired, so the
   * catalogue is no longer a place to look it up. Everything in a pool was
   * thrown while this process was running, so remembering it on the way past
   * is all the lookup a replay ever needs.
   */
  const emotesSeen = new Map<string, { name: string; image: string; sound: string | null }>();
  /** Every timer we own, so close() can leave no handle behind. */
  const pending = new Set<NodeJS.Timeout>();

  function later(run: () => void, ms: number): NodeJS.Timeout {
    const handle = setTimeout(() => {
      pending.delete(handle);
      run();
    }, ms);
    pending.add(handle);
    return handle;
  }

  const app = express();
  /*
   * Nothing posted here is large — a code, a stake, a note — so the limit is
   * small on purpose. Without this, request.body is undefined and every POST
   * silently behaves as though it were sent empty.
   */
  /*
   * Every path but one. An emote upload carries a picture, which is several
   * hundred times this limit — and a body refused at eight kilobytes cannot be
   * un-refused by a larger parser mounted further down, so the small one has
   * to decline to look at that route rather than reject it.
   */
  const smallJson = express.json({ limit: "8kb" });
  app.use((request, response, next) => {
    if (request.path === EMOTE_UPLOAD_PATH) {
      next();
      return;
    }
    smallJson(request, response, next);
  });

  const trustProxy = resolveTrustProxy(process.env["TRUST_PROXY"]);
  if (trustProxy !== null) {
    app.set("trust proxy", trustProxy);
  }

  /*
   * A game's own subdomain, sent on to the one real origin. Mounted here, above
   * everything: the point is that nobody spends a whole session on
   * greed.horizons.gg holding a cookie the canonical host cannot see.
   */
  const gameIds = CATALOGUE.all().map((game) => game.id);
  app.use((request, response, next) => {
    const target = friendlyRedirect(request.hostname, request.path, gameIds, clientOrigin);
    if (target === null) {
      next();
      return;
    }
    response.redirect(301, target);
  });
  const http = createHttpServer(app);
  const io = new Server<ClientToServer, ServerToClient, DefaultEventsMap, SocketIdentity>(http, {
    cors: { origin: clientOrigin, methods: ["GET", "POST"] },
  });

  const sessions = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction(),
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  });
  app.use(sessions);
  // The socket handshake carries the same cookie, so a connection knows who it
  // belongs to without the client asserting anything.
  io.engine.use(sessions);

  mountAuth(app, store, auth);

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true, rooms: rooms.size, store: store.kind, signin: auth !== null });
  });

  app.get("/api/me", (request, response) => {
    void (async () => {
      const id = userIdOfRequest(request);
      const profile = id === undefined ? null : await store.get(id);
      response.json(
        profile === null
          ? { signedIn: false, signinAvailable: auth !== null }
          : { signedIn: true, signinAvailable: auth !== null, profile },
      );
    })();
  });

  app.post("/auth/logout", (request, response) => {
    request.session.destroy(() => response.json({ ok: true }));
  });

  /**
   * What is on offer, and how busy it is.
   *
   * The room picker needs to show a table with people at it differently from
   * an empty one, and that is a question about tables rather than about any
   * game — so it is answered here rather than by each game separately.
   */
  app.get("/api/room", (_request, response) => {
    const live = [...rooms.values()];
    response.json({
      games: CATALOGUE.all().map((game) => {
        const mine = live.filter((room) => room.game.listing.id === game.id);
        return {
          ...game,
          tables: mine.length,
          seated: mine.reduce((total, room) => total + room.table.seats.length, 0),
          watching: mine.reduce((total, room) => total + seatsWatching(room.table), 0),
        };
      }),
    });
  });

  /**
   * The tables anybody may walk up to.
   *
   * Only what a stranger is allowed to know before they sit down: which game,
   * which code, who opened it and how full it is. Nothing about the play — a
   * hand in progress is not a thing to advertise, and a table's state is built
   * per seat precisely so that it is not handed out to people who have no
   * seat at it.
   */
  app.get("/api/tables", (request, response) => {
    const wanted = typeof request.query["game"] === "string" ? request.query["game"] : null;
    const tables: TableOnOffer[] = [];

    for (const seated of rooms.values()) {
      const id = seated.game.listing.id;
      if (!seated.listed || (wanted !== null && id !== wanted)) {
        continue;
      }
      /*
       * Never a table nobody is at.
       *
       * An abandoned table lives on for a few minutes so a refresh can get
       * back into it, which is right — but it should not be advertised while
       * it waits. Somebody scanning this list is looking for a game, and a row
       * offering a seat at an empty room with no host is worse than no row.
       */
      if (seated.table.isEmpty) {
        continue;
      }
      const seats = seated.table.seats;
      const host = seats.find((seat) => seat.id === seated.table.hostId);
      tables.push({
        code: seated.table.code,
        game: id,
        host: host?.name ?? "nobody",
        seats: seats.length,
        maxSeats: seated.table.maxSeats,
        watching: seatsWatching(seated.table),
        status: seated.table.status,
      });
    }

    // Emptiest first: somebody looking for a table wants one they can join,
    // and a table with room is more use than a full one however busy it looks.
    tables.sort((left, right) => left.seats - right.seats);
    response.json({ tables });
  });

  /**
   * Which game a table belongs to.
   *
   * Codes are unique across the whole room, so a shared link never has to name
   * a game — this is what turns one back into an address. Answers for any
   * table that exists, signed in or not, because the point of a code is that
   * you can follow it before you have decided anything.
   */
  app.get("/api/table/:code", (request, response) => {
    const code = String(request.params["code"] ?? "").toUpperCase();
    const seated = rooms.get(code);
    if (seated === undefined) {
      response.status(404).json({ error: "No table with that code." });
      return;
    }
    /*
     * Whether it plays for chips, so a link can ask somebody to sign in rather
     * than letting them try, be refused, and be left looking at a form for
     * opening a table of their own. Nothing else about the table: what is
     * being played is not a thing to hand out to people with no seat at it.
     */
    const forFun = "forFun" in seated.table && seated.table.forFun === true;
    response.json({ code, game: seated.game.listing.id, forFun });
  });

  // ------------------------------------------------- what a link looks like

  /**
   * The origin this request arrived on.
   *
   * Taken from the request rather than configured, because the server is the
   * thing being fetched: whatever host an unfurler used to reach here is the
   * host it can fetch the card from. Subdomains never get this far — they are
   * redirected to the canonical origin above — so this is that origin.
   */
  function origin(request: express.Request): string {
    return `${request.protocol}://${request.get("host") ?? "localhost"}`;
  }

  /** What the card for a table should say, or null if there is no such table. */
  function tableCard(code: string): CardSpec | null {
    const seated = rooms.get(code);
    if (seated === undefined || seated.table.isEmpty) {
      return null;
    }
    const listing = seated.game.listing;
    const host = seated.table.seats.find((seat) => seat.id === seated.table.hostId);
    return {
      game: { id: listing.id, name: listing.name, theme: listing.theme, mark: listing.mark },
      host: host?.name ?? null,
      code,
      // In seating order, so the faces on the card are the faces at the table.
      players: seated.table.seats.map((seat) => seat.avatar),
      maxSeats: seated.table.maxSeats,
      note: seated.table.status === "lobby" ? "Open — pull up a chair" : "Hand in play",
    };
  }

  /** The card for a whole game, which is a banner rather than a table. */
  function gameCard(id: string): CardSpec | null {
    const listing = CATALOGUE.get(id);
    if (listing === undefined) {
      return null;
    }
    return {
      game: { id: listing.id, name: listing.name, theme: listing.theme, mark: listing.mark },
      host: null,
      code: null,
      players: [],
      maxSeats: listing.maxSeats,
      note: listing.blurb,
    };
  }

  /** The room's own banner, for every address that is not about one game. */
  const SITE_CARD: CardSpec = {
    game: null,
    host: null,
    code: null,
    players: [],
    maxSeats: 0,
    note: "Played for chips and nothing else",
  };

  async function sendCard(response: express.Response, spec: CardSpec): Promise<void> {
    /*
     * The faces first. They come from Discord, which is a network round trip
     * this server makes on somebody else's behalf — so it is bounded, cached,
     * and allowed to fail: a seat whose picture did not arrive is drawn as a
     * chip, which is what every seat looked like a moment ago anyway.
     */
    const spread = { ...spec, players: await avatars.all(spec.players) };
    const png = cards.png(spread);
    response.type("image/png");
    /*
     * Long enough that a link pasted in a busy channel is drawn once, short
     * enough that a table filling up is not advertised as empty all evening.
     * Unfurlers cache these on their own machines regardless, which is the
     * real reason a card has to be able to go stale gracefully.
     */
    response.setHeader("Cache-Control", "public, max-age=60");
    response.send(png);
  }

  /** The card for one table, by its code. */
  app.get("/og/table/:code", (request, response) => {
    const code = String(request.params["code"] ?? "")
      .replace(/\.png$/i, "")
      .toUpperCase();
    // A table that has closed still gets a picture, because the link to it is
    // already out there — just the room's own rather than a table's.
    void sendCard(response, tableCard(code) ?? SITE_CARD);
  });

  /** The card for a game, or for the room. */
  app.get("/og/:name", (request, response) => {
    const name = String(request.params["name"] ?? "").replace(/\.png$/i, "");
    void sendCard(response, gameCard(name) ?? SITE_CARD);
  });

  app.get("/robots.txt", (request, response) => {
    response.type("text/plain").send(
      [
        "User-agent: *",
        "Allow: /",
        /*
         * Somebody's own pages, and the desk behind the bar. Nothing here is
         * secret — these are simply not results anybody wants to land on.
         *
         * Anchored with `$`, because a Disallow is a prefix match: bare
         * "/me" is also every address that merely starts with those two
         * letters, and the room hands out five-letter table codes at the root.
         * A code beginning "ME" is one shuffle away, and shutting a crawler
         * out of a shared table is the opposite of what this line is for.
         */
        "Disallow: /me$",
        "Disallow: /admin$",
        "Disallow: /style$",
        "Disallow: /api/",
        "",
        `Sitemap: ${origin(request)}/sitemap.xml`,
        "",
      ].join("\n"),
    );
  });

  /**
   * The addresses worth indexing, which is the games and the door.
   *
   * Not the tables. A table is a room that will not exist tomorrow, and a
   * search result leading to one is a dead end by the time anybody clicks it —
   * which is also why a table's own page asks not to be indexed.
   */
  app.get("/sitemap.xml", (request, response) => {
    const site = origin(request);
    const urls = ["/", ...CATALOGUE.playable().map((game) => `/${game.id}`)];
    response.type("application/xml").send(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map((path) => `  <url><loc>${site}${path}</loc></url>`),
        "</urlset>",
        "",
      ].join("\n"),
    );
  });

  /** Everything meta.ts has to ask the room about, and nothing more. */
  const lookups = {
    game(id: string) {
      const listing = CATALOGUE.get(id);
      return listing === undefined
        ? null
        : {
            name: listing.name,
            blurb: listing.blurb,
            minSeats: listing.minSeats,
            maxSeats: listing.maxSeats,
            shape: listing.shape,
            open: listing.open,
          };
    },
    table(code: string) {
      const card = tableCard(code);
      return card === null
        ? null
        : {
            game: card.game?.name ?? "table",
            host: card.host,
            seats: card.players.length,
            maxSeats: card.maxSeats,
          };
    },
  };

  /**
   * What a game is handed when it needs to move money.
   *
   * The only way a game touches a balance. It cannot reach the store, so it
   * cannot invent a way to pay somebody that the economy has not agreed to —
   * every route to a player's chips goes through these four.
   */
  /**
   * Tells every screen this account is signed in on what it is now worth.
   *
   * Chips move from three directions — a stake taken here, a hand paying out
   * on the table's clock, a jar tapped in another tab — and only the first
   * of those is something the browser asked for. Pushing the number is what
   * keeps the figure in the corner honest without it polling for one.
   *
   * `knownChips` lets a caller that just did the mutation — and so already
   * has the resulting balance in hand, e.g. from `applyJar`'s own return —
   * skip the `store.get` this would otherwise do to find out what it already
   * knows. Every other caller omits it and gets exactly the lookup this
   * always did.
   */
  async function tellChips(userId: string, knownChips?: number): Promise<void> {
    let chips = knownChips;
    if (chips === undefined) {
      const profile = await store.get(userId);
      if (profile === undefined || profile === null) {
        return;
      }
      chips = profile.chips;
    }
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.identity?.userId === userId) {
        socket.emit("me:chips", chips);
      }
    }
  }

  const deps: GameDeps = {
    take: async (userId, amount) => {
      if (amount <= 0) {
        return true;
      }
      const took = await store.adjustChips(userId, -amount);
      if (took) {
        await tellChips(userId);
      }
      return took;
    },
    give: async (userId, amount) => {
      if (amount > 0) {
        await store.adjustChips(userId, amount);
        await tellChips(userId);
      }
    },
    record: (userId, bump) => store.bumpStats(userId, bump),
    finished: (record) => store.recordGame(record),
  };

  /** Every game this server can host, by id. */
  const ADAPTERS = new Map<string, GameAdapter<PlayTable>>([
    [GREED.id, greedAdapter({ roll, pauseMs: farklePauseMs }) as GameAdapter<PlayTable>],
    [
      BLACKJACK.id,
      blackjackAdapter({
        ...(bettingMs === undefined ? {} : { bettingMs }),
        ...(settleMs === undefined ? {} : { settleMs }),
        ...(turnMs === undefined ? {} : { turnMs }),
        ...(lastCallMs === undefined ? {} : { lastCallMs }),
        /*
         * The shuffle, from the same source the reels come from. A table that
         * pays from a bank hands the player every card it deals, which over a
         * shoe is exactly the run of observations needed to recover
         * Math.random's state — and then the next card is not a question.
         */
        random: spinRandom,
        /*
         * The bank these tables play against, scoped to blackjack's own. The
         * game is handed the three things it can do with chips rather than the
         * store, so a table cannot reach the machine's bank however it is
         * asked to.
         */
        bank: {
          holds: () => store.bank("blackjack"),
          add: (amount: number) => store.bankAdd("blackjack", amount),
          take: (amount: number) => store.bankTake("blackjack", amount),
        },
      }) as GameAdapter<PlayTable>,
    ],
    [
      POKER.id,
      pokerAdapter({
        /*
         * The shuffle, from the same source the reels come from. A table hands
         * every player cards it will later hand somebody else, and a shuffle
         * anybody can predict is a game everybody else is losing on purpose.
         */
        random: spinRandom,
        ...(turnMs === undefined ? {} : { turnMs }),
      }) as GameAdapter<PlayTable>,
    ],
    [
      ROULETTE.id,
      rouletteAdapter({
        /*
         * The wheel, from the same source the reels come from. A table hands
         * every watcher its whole result every spin, which over an evening is
         * exactly the run of observations needed to recover Math.random's
         * state — and then the next pocket is not a question.
         */
        pick: (pockets: number) => Math.floor(spinRandom() * pockets),
        /* Its own bank, kept apart from the machine's and the felt's. */
        bank: {
          holds: () => store.bank("roulette"),
          add: (amount: number) => store.bankAdd("roulette", amount),
          take: (amount: number) => store.bankTake("roulette", amount),
        },
      }) as GameAdapter<PlayTable>,
    ],
    [
      DEATH_ROLL.id,
      deathRollAdapter({
        /*
         * The roll, from the same source the reels and the shoe come from.
         * This table hands the player its whole result every single turn,
         * which over a duel is exactly the run of observations needed to
         * recover Math.random's state — and somebody who knew the next roll
         * would know whether to spend their pass, which is the whole game.
         *
         * `randomInt` rather than scaling `spinRandom`, because it is
         * rejection-sampled and so uniform over any ceiling, which scaling a
         * float is not.
         */
        roll: deathRollRoll ?? ((ceiling: number) => randomInt(1, ceiling + 1)),
        ...(turnMs === undefined ? {} : { turnMs }),
      }) as GameAdapter<PlayTable>,
    ],
  ]);

  /**
   * The seat this person already holds at this table, if they hold one.
   *
   * Asked of the table's seats rather than of any game, because every game has
   * seats and none of them has an opinion about who is sitting in one.
   */
  function reclaimable(table: PlayTable, identity: SeatIdentity | null): string | null {
    if (identity === null) {
      return null;
    }
    const held = table.seats.find((seat) => seat.userId === identity.userId);
    return held?.id ?? null;
  }

  /** How many people are stood around a table, whatever the game calls it. */
  function seatsWatching(table: PlayTable): number {
    return (table.view(null) as { watching?: number }).watching ?? 0;
  }

  const admins = readAdmins(process.env);

  /** The id behind a request, however this server has been told to find it. */
  function userIdOfRequest(request: express.Request): string | undefined {
    if (identifyRequest !== undefined) {
      return identifyRequest(request) ?? undefined;
    }
    return request.session.userId;
  }

  /** The signed-in player, or null. Used by everything below. */
  async function whoIs(request: express.Request) {
    const id = userIdOfRequest(request);
    return id === undefined ? null : await store.get(id);
  }

  /**
   * Redeeming a code.
   *
   * The one endpoint in the product where guessing pays, so it is the one that
   * is rate limited by account rather than by socket: a socket is free to make
   * more of, and an account is not.
   */
  app.post("/api/redeem", (request, response) => {
    void (async () => {
      const profile = await whoIs(request);
      if (profile === null) {
        response.status(401).json({ ok: false, reason: "sign-in" });
        return;
      }
      if (!withinBudget(redeemBudgets, profile.id, REDEEM_TRIES, REDEEM_WINDOW_MS)) {
        response.status(429).json({ ok: false, reason: "too-many" });
        return;
      }
      const typed = String((request.body as { code?: unknown } | undefined)?.code ?? "");
      if (typed.trim().length === 0) {
        response.status(400).json({ ok: false, reason: "unknown-code" });
        return;
      }
      response.json(await store.redeem(typed, profile.id));
    })();
  });

  /** Everything below this needs to be on the list. */
  const requireAdmin: express.RequestHandler = (request, response, next) => {
    void (async () => {
      const profile = await whoIs(request);
      if (profile === null || !admins.has(profile.discordId)) {
        // Deliberately the same answer either way: whether a page exists is
        // not something an unauthorised visitor needs to learn.
        response.status(404).json({ error: "Not found." });
        return;
      }
      next();
    })();
  };

  mountEmotes(app, { store, requireAdmin, userIdOf: userIdOfRequest });
  mountTransfers(app, {
    store,
    whoIs: async (request) => {
      const profile = await whoIs(request as express.Request);
      return profile === null ? null : { id: profile.id, name: profile.name };
    },
    tellChips,
    withinBudget: (id, max, windowMs) => withinBudget(sendBudgets, id, max, windowMs),
  });
  mountLeaderboard(app, {
    store,
    whoIs: async (request) => {
      const profile = await whoIs(request as express.Request);
      return profile === null ? null : { id: profile.id };
    },
    withinBudget: (id, max, windowMs) => withinBudget(boardBudgets, id, max, windowMs),
  });

  app.get("/api/admin/codes", requireAdmin, (_request, response) => {
    void (async () => {
      response.json({ codes: await store.listCodes(50) });
    })();
  });

  app.post("/api/admin/codes", requireAdmin, (request, response) => {
    void (async () => {
      const parsed = mintCodeSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "That is not a code worth minting." });
        return;
      }
      const profile = await whoIs(request);
      const code = await store.mintCode({
        chips: parsed.data.chips,
        maxRedemptions: parsed.data.maxRedemptions ?? null,
        expiresAt: parsed.data.expiresAt ?? null,
        note: parsed.data.note ?? "",
        createdBy: profile?.id ?? "unknown",
      });
      response.json({ code });
    })();
  });

  app.post("/api/admin/codes/:code/revoke", requireAdmin, (request, response) => {
    void (async () => {
      const done = await store.revokeCode(String(request.params["code"] ?? ""));
      response.status(done ? 200 : 404).json({ revoked: done });
    })();
  });

  /**
   * What the machine is worth playing for.
   *
   * Public, and deliberately so: the bank is the whole appeal of this game and
   * a sign nobody can read until they have signed in advertises nothing. It
   * carries no one's balance and says nothing about who is playing.
   */
  app.get("/api/slots", (_request, response) => {
    void (async () => {
      const bank = await store.bank("slots");
      response.json({ bank, maxStake: maxStake(bank), jackpot: jackpotPay(bank) });
    })();
  });

  /**
   * Which bank a request means, or nothing if it named one that does not exist.
   *
   * Absent means the machine's. Every one of these routes predates there being
   * a second bank, and an admin who floats the building without saying which
   * bank means the one they have always meant.
   */
  function bankNamed(value: unknown): BankName | null {
    if (value === undefined) {
      return "slots";
    }
    return BANKS.find((one) => one === value) ?? null;
  }

  /** What a bank can offer, which each game works out its own way. */
  function capOf(which: BankName, bank: number): number {
    switch (which) {
      case "slots":
        return maxStake(bank);
      case "blackjack":
        return blackjackMaxStake(bank);
      /*
       * The worst the cloth can do to a lone chip: straight up, at 35 to 1.
       * A real table is capped far more finely than this — every chip is
       * measured against the whole cloth's exposure as it lands — but this
       * route answers "what could the bank take at all", and that is the
       * straight-up.
       */
      case "roulette":
        return Math.max(0, Math.floor(Math.max(0, bank) / ROULETTE_DIVISOR));
    }
  }

  /**
   * The one place chips enter a game's bank from outside play.
   *
   * Behind the same allowlist that mints redemption codes, because it is the
   * same power: this adds chips to the building that nobody won. It is a
   * deliberate act rather than something automatic because an empty bank
   * offers a stake of zero — somebody has to strike the match — and because a
   * named human doing it is auditable in a way a mechanism is not.
   */
  app.get("/api/admin/bank", requireAdmin, (request, response) => {
    void (async () => {
      const which = bankNamed((request.query as { game?: unknown })?.game);
      if (which === null) {
        response.status(400).json({ error: "No such bank." });
        return;
      }
      const bank = await store.bank(which);
      response.json({ bank, maxStake: capOf(which, bank) });
    })();
  });

  app.post("/api/admin/bank", requireAdmin, (request, response) => {
    void (async () => {
      const body = request.body as { amount?: unknown; game?: unknown };
      const which = bankNamed(body?.game);
      if (which === null) {
        response.status(400).json({ error: "No such bank." });
        return;
      }
      const amount = body?.amount;
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
        response.status(400).json({ error: "That is not an amount." });
        return;
      }
      await store.bankAdd(which, amount);
      const bank = await store.bank(which);
      response.json({ bank, maxStake: capOf(which, bank) });
    })();
  });

  /**
   * What the blackjack tables can cover, for anybody at all.
   *
   * The same reasoning as the machine's sign: the bank is what makes a table
   * against the dealer possible, so a table that will not deal has to be able
   * to say why without asking who is asking.
   *
   * The top of the range rather than a promise about any particular felt. A
   * round is settled all at once, so the cap is a budget the whole table draws
   * on and what is left falls as people bet — this is what the first of them
   * can have. The felt itself says the rest, which is where it belongs: a
   * number on a sign cannot know who has sat down since it was read, and the
   * table refusing the message is the rule whatever the sign said.
   */
  app.get("/api/blackjack", (_request, response) => {
    void (async () => {
      const bank = await store.bank("blackjack");
      response.json({ bank, maxStake: blackjackMaxStake(bank) });
    })();
  });

  app.get("/api/games", (request, response) => {
    void (async () => {
      const id = userIdOfRequest(request);
      if (id === undefined) {
        response.status(401).json({ error: "Sign in first." });
        return;
      }
      // Deliberately more than the page shows. Hands at one table collapse into
      // a single line, so twenty records can be two lines of history.
      response.json({ games: await store.recentGames(id, 80) });
    })();
  });

  if (serveClient) {
    /*
     * Files only. Never the index.
     *
     * `express.static` answers a directory with its index.html by default, and
     * the site's own front door is a directory — so "/" was served the built
     * file straight off the disk and never reached the handler below that
     * writes the head. Which is the one address that gets pasted more than any
     * table's: it unfurled with the defaults baked into index.html, whose
     * og:image is a *relative* path, and a relative one reaches nobody. Every
     * other address was fine, so nothing looked wrong anywhere.
     */
    app.use(express.static(clientDist, { index: false }));

    /**
     * The built page, read once.
     *
     * A build changes when the server restarts and at no other time, so
     * re-reading it per request would be a disk hit on the busiest path in the
     * room, for a file that cannot have changed since the last one.
     */
    let shell: string | null = null;
    const pageShell = (): string | null => {
      if (shell === null) {
        try {
          shell = readFileSync(join(clientDist, "index.html"), "utf8");
        } catch {
          return null;
        }
      }
      return shell;
    };

    /**
     * Anything that is not a file and not an API path is a client route — a
     * table code, say — so hand back the app and let the router sort it out.
     * Without this a shared link like /6PMKG would 404 in production, even
     * though it works in dev where Vite does the same thing for us.
     *
     * The head is written on the way past. A crawler and a link unfurler both
     * read it, and neither runs the script that would otherwise have filled it
     * in, so this is the only chance a page gets to say what it is.
     */
    app.get(CLIENT_ROUTE, (request, response) => {
      const html = pageShell();
      if (html === null) {
        response.status(404).end();
        return;
      }
      response.type("html");
      // The file is the same for everybody; the head is not, and a table's
      // goes stale as its seats fill.
      response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      response.send(inject(html, pageFor(request.path, origin(request), lookups)));
    });
  }

  function makeCode(): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let code = "";
      for (let index = 0; index < CODE_LENGTH; index += 1) {
        code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
      }
      if (!rooms.has(code)) {
        return code;
      }
    }
    throw new Error("could not find a free room code");
  }

  function botName(table: PlayTable): string {
    const taken = new Set(table.seats.map((seat) => seat.name));
    return BOT_NAMES.find((name) => !taken.has(name)) ?? `Bot ${table.seats.length + 1}`;
  }

  /** True while this socket is inside its allowance. */
  function withinBudget(store: Map<string, Budget>, id: string, max: number, window: number): boolean {
    const now = Date.now();
    const budget = store.get(id);
    if (budget === undefined || now > budget.resetAt) {
      store.set(id, { count: 1, resetAt: now + window });
      return true;
    }
    budget.count += 1;
    return budget.count <= max;
  }

  /**
   * Starts or clears the countdown on whoever is to act.
   *
   * The server does not know what a turn is; it asks the game whether one is
   * running out and when. A game with no clock simply never answers.
   */
  function armClock(code: string, seated: Seated): void {
    const existing = turnClocks.get(code);
    if (existing !== undefined) {
      clearTimeout(existing);
      turnClocks.delete(code);
    }

    const clock = seated.game.clock?.(seated.table) ?? null;
    // No clock while nobody is watching, or on a bot: a bot moves in a second
    // and cannot stall the table.
    const seat = clock === null ? undefined : seated.table.seats.find((s) => s.id === clock.seatId);
    if (clock === null || seated.table.isEmpty || seat?.isBot === true) {
      return;
    }

    turnClocks.set(
      code,
      later(() => {
        turnClocks.delete(code);
        const still = rooms.get(code);
        if (still === undefined) {
          return;
        }
        still.game.timeout?.(still.table, clock.seatId);
        broadcast(code);
      }, Math.max(0, clock.endsAt - Date.now())),
    );
  }


  /**
   * Sends the table to everyone at it, one at a time.
   *
   * Deliberately not `io.to(code).emit(...)`. That sends one description of the
   * table to every socket in the room, which is only safe while there is
   * nothing at the table that one seat may see and another may not. The moment
   * a card is face down, a single shared payload is not a rendering choice, it
   * is dealing everybody else your hand — and by then every game would be
   * written against the assumption that it cannot happen.
   *
   * Greed's view is the same for everyone, so today this sends identical
   * payloads and costs one small object per seat at a table of at most eight.
   */
  function sendState(code: string, seated: Seated): void {
    const members = io.sockets.adapter.rooms.get(code);
    if (members === undefined) {
      return;
    }
    for (const socketId of members) {
      // Null while a socket is in the room but between seats — mid-resume, or
      // after its seat was taken away. It still gets the table, as nobody.
      const seat = sockets.get(socketId)?.seatId ?? null;
      io.to(socketId).emit("room:state", {
        // Tagged, so a client can tell what it is looking at without being
        // told separately — and so a stale socket cannot render one game's
        // state through another's components. `listed` rides along for the
        // same reason: it is the room's fact about the table, not the game's.
        game: seated.game.listing.id,
        listed: seated.listed,
        taunts: seated.table.seats
          .map((one) => ({ seatId: one.id, chips: taunts.held(code, one.id) }))
          .filter((stake) => stake.chips > 0),
        ...(seated.table.view(seat) as Record<string, unknown>),
      });
    }
  }

  /**
   * Settles the taunts staked at a table that has just finished a hand.
   *
   * Everything staked on somebody who won goes to them, and each taunt they
   * collected on is thrown back at whoever sent it. Everything staked on
   * anybody else is burned — those chips left an account when the taunt was
   * thrown and no account receives them, which is the cost of a taunt being
   * real. Nothing here can mint: a pool is a sum of deposits and pays at most
   * what it holds, which `Taunts.resolve` guarantees and its tests pin.
   *
   * A game that does not say who won gets no settlement at all rather than a
   * guess, and its pools stay staked until the table closes.
   */
  async function payTaunts(
    code: string,
    seated: Seated,
    /**
     * The seats that won, read off the table *before* it was settled.
     *
     * Passed in rather than asked for here, and that is the whole of a bug
     * this had in production. Settling talks to the economy, so it yields; a
     * table that deals itself does not stand still while it does, and by the
     * time the last write came back the felt had been cleared for the next
     * hand. Asking then got "nobody won", so every pool was burned — no chips
     * to the person who had been mocked, and no emote thrown back at whoever
     * mocked them.
     *
     * Null for a game that does not say who won; its pools wait for the table
     * to close rather than being guessed at.
     */
    winners: readonly string[] | null,
  ): Promise<void> {
    if (winners === null) {
      return;
    }
    const { paid } = taunts.resolve(code, winners);
    if (paid.length === 0) {
      // Still worth re-sending: a burned pool has to stop showing on the felt.
      sendState(code, seated);
      return;
    }
    for (const payout of paid) {
      await deps.give(payout.userId, payout.chips);
      for (const one of payout.revenge) {
        const emote = emotesSeen.get(one.emoteId);
        if (emote === undefined) {
          continue;
        }
        io.to(code).emit("taunt:play", {
          // A fresh id: this is a second appearance of the same emote, and a
          // client keying an animation on it must not take it for a repeat of
          // the first.
          id: `${one.id}-back`,
          emoteId: one.emoteId,
          name: emote.name,
          image: emote.image,
          sound: emote.sound,
          // Turned around, which is the whole point of it.
          fromSeatId: one.atSeatId,
          fromName: one.atName,
          atSeatId: one.fromSeatId,
          atName: one.fromName,
          chips: one.chips,
          revenge: true,
        } satisfies TauntPlay);
      }
    }
    sendState(code, seated);
  }

  function broadcast(code: string): void {
    const seated = rooms.get(code);
    if (seated === undefined) {
      return;
    }
    armClock(code, seated);
    sendState(code, seated);
    schedulePause(code, seated);
    scheduleBot(code, seated);
    /*
     * Settling is once per finished hand, and a table may finish many.
     *
     * The flag is both set and cleared here, beside the thing it guards,
     * because a round can begin from a timer as easily as from somebody
     * pressing something — and a flag cleared only in a socket handler would
     * leave a table that deals itself unable to pay anybody after its first
     * hand.
     */
    if (!seated.game.isSettled(seated.table)) {
      settled.delete(code);
    } else if (!settled.has(code)) {
      settled.add(code);
      /*
       * Read before settling, never after. `settle` in the games themselves
       * carries the same warning about the same hazard: the moment it awaits,
       * the table is free to move on, and a continuous table clears its felt
       * on a timer. What the hand came to is a fact now, not somewhere to go
       * looking once the money has finished moving.
       */
      const won = seated.game.winners?.(seated.table) ?? null;
      void seated.game
        .settle(seated.table, deps)
        /*
         * After the game has paid, not alongside it. A taunt pays out of chips
         * that left an account when it was thrown, so the order is not a money
         * question — but a player watching their balance should see the hand
         * settle and then the pool come in, rather than the two arriving
         * interleaved and neither explaining the other.
         */
        .then(() => payTaunts(code, seated, won))
        .catch((error) => console.error("settling failed", error));
    }
    /*
     * And separately, anything owed to somebody who has already left.
     *
     * Deliberately outside the flag above. That guards a state — a hand stays
     * settled for as long as its result is up, and without the flag it would
     * pay every time anybody was sent anything. What this drains is a queue,
     * so the guard against paying twice is that the game empties it before its
     * first await, and the guard against never paying is that this is asked
     * every time rather than once.
     */
    if (seated.game.payOut !== undefined) {
      void seated.game
        .payOut(seated.table, deps)
        /*
         * Sent again only if the game says it moved something. Death roll
         * takes its antes here — the one place in the building where the money
         * moving *is* the state changing — and without this the duel it starts
         * would sit unseen until something unrelated woke the table up.
         *
         * The recursion is bounded by the game rather than by a counter here,
         * which is the honest place for it: only the game knows whether it did
         * anything, and one that answered yes every time would be asking for a
         * broadcast loop it could stop and this could not.
         */
        .then((changed) => {
          if (changed === true) {
            broadcast(code);
          }
        })
        .catch((error) => console.error("paying out failed", error));
    }
  }


  /**
   * Leaves the busting dice on screen for a beat, then moves play on.
   *
   * This lives here rather than in the roll handler because a bot never goes
   * through a socket handler — it calls the room directly. Scheduling it there
   * meant a bot that farkled froze the table for good.
   */
  function schedulePause(code: string, seated: Seated): void {
    const pause = seated.game.pause?.(seated.table) ?? null;
    const waiting = pauses.get(code);
    if (waiting !== undefined) {
      /*
       * Only left alone while it is still the same wait. A table can stop
       * waiting on one thing and start waiting on another before the first is
       * up — the host deals early, and a thirty-second betting window becomes
       * six seconds of reading the result — and a timer kept for the wait that
       * is over would both hold the new one up and, when it did fire, do the
       * old wait's work to a table that had moved on.
       */
      if (pause !== null && waiting.key === pause.key) {
        return;
      }
      clearTimeout(waiting.timer);
      pauses.delete(code);
    }
    if (pause === null) {
      return;
    }

    pauses.set(code, {
      key: pause.key,
      /*
       * However long the game said, rather than however long a farkle takes.
       * This used to be one constant for the whole building, which was
       * invisible while one game wanted one pause — and no use at all to a
       * table that wants thirty seconds of betting and six of reading the
       * result.
       */
      timer: later(() => {
        pauses.delete(code);
        const still = rooms.get(code);
        if (still === undefined) {
          return;
        }
        // Asked again on the way out, and only run if the table is still
        // waiting on the same thing: whatever wanted this may have been
        // resolved by somebody else while the timer was running.
        const now = still.game.pause?.(still.table) ?? null;
        if (now === null || now.key !== pause.key) {
          return;
        }
        now.run();
        broadcast(code);
      }, Math.max(0, pause.ms)),
    });
  }


  /**
   * Books the active bot's next move.
   *
   * The bot goes through the very same Room methods a socket handler calls, so
   * there is no privileged path for it to cheat down and nothing to keep in
   * sync with the human rules.
   */
  function scheduleBot(code: string, seated: Seated): void {
    const pending = botMoves.get(code);
    if (pending !== undefined) {
      clearTimeout(pending);
      botMoves.delete(code);
    }

    /*
     * Nobody left to play for.
     *
     * The table is on its way out — the sweep books its removal the moment the
     * last person goes — but that takes minutes, and there is no reason to
     * spend them dealing hands nobody will ever see.
     */
    if (seated.table.isEmpty) {
      return;
    }

    const move = seated.game.botMove?.(seated.table) ?? null;
    if (move === null) {
      return;
    }

    botMoves.set(
      code,
      later(() => {
        botMoves.delete(code);
        const still = rooms.get(code);
        if (still === undefined) {
          return;
        }
        // Asked again rather than trusting the one booked earlier: the table
        // may have moved on while the bot was thinking.
        const now = still.game.botMove?.(still.table) ?? null;
        if (now === null || now.seatId !== move.seatId) {
          return;
        }
        try {
          now.play();
        } catch (error) {
          console.error("a bot could not move", error);
        }
        broadcast(code);
      }, botDelayMs ?? move.delayMs),
    );
  }


  /** Clears a table once nobody has been sitting at it for a while. */
  function reapWhenEmpty(code: string): void {
    const room = rooms.get(code);
    if (room === undefined || !room.table.isEmpty) {
      return;
    }
    later(() => {
      const still = rooms.get(code);
      if (still?.table.isEmpty === true) {
        turnClocks.delete(code);
        pauses.delete(code);
        botMoves.delete(code);
        /*
         * Whatever was staked here is burned. The table never reached a
         * result, so nobody won one — which is the same answer the rules give
         * for a taunt whose target simply lost.
         */
        taunts.forget(code);
        rooms.delete(code);
      }
    }, emptyRoomTtlMs);
  }

  /** Runs a seated action, turning a RoomError into a message not a crash. */
  /**
   * Runs something on a table on behalf of a socket, or explains why not.
   *
   * Everything a player can do goes through here: the rate limit, the check
   * that they hold a seat, the refusal, and the broadcast afterwards. A game
   * that wanted its own path around it would be a game that could not be
   * trusted with the same rules as the others.
   */
  function guard(
    socketId: string,
    run: (seated: Seated, seatId: string) => void | Promise<void>,
  ): void {
    const seat = sockets.get(socketId);
    const socket = io.sockets.sockets.get(socketId);
    if (seat === undefined || socket === undefined) {
      return;
    }
    if (!withinBudget(budgets, socketId, RATE_EVENTS, RATE_WINDOW_MS)) {
      socket.emit("room:error", "Slow down.");
      return;
    }
    const seated = rooms.get(seat.code);
    if (seated === undefined) {
      socket.emit("room:error", "That table is gone.");
      return;
    }
    if (seat.seatId === null) {
      socket.emit("room:error", "You are watching this table, not playing at it.");
      return;
    }
    void (async () => {
      try {
        await run(seated, seat.seatId as string);
        broadcast(seat.code);
      } catch (error) {
        /*
         * Only a refusal is shown to the player. Anything else is a bug, and a
         * bug reported as though it were a rule leaves nothing in the log to
         * find it by — which is exactly how it hides.
         */
        if (error instanceof RoomError) {
          socket.emit("room:error", error.message);
          return;
        }
        console.error("unexpected error handling an action", error);
        socket.emit("room:error", "Something went wrong.");
      }
    })();
  }


  /** The signed-in profile behind a socket, or null for a guest. */
  function userIdOf(socket: { id: string; request: unknown }): string | null {
    if (identify !== undefined) {
      return identify(socket);
    }
    const request = socket.request as { session?: { userId?: string } };
    return request.session?.userId ?? null;
  }

  /**
   * The name a socket sits under.
   *
   * A signed-in player gets the name on their profile, whatever they sent —
   * their seat, the chat and the game history all have to agree with the
   * account the chips come out of, and the client is in no position to promise
   * that. Guests have no profile to check against, so their own name stands.
   */
  function seatNameFor(socket: { data: SocketIdentity }, sent: string): string {
    return socket.data.name ?? sent;
  }



  // Middleware, not the connection handler, because it settles before the
  // client's first message is delivered. Resolving the name inside `connection`
  // would leave a window where an early lobby:create still used a typed one.
  io.use((socket, next) => {
    const userId = userIdOf(socket);
    if (userId === null) {
      socket.data.identity = null;
      socket.data.name = null;
      next();
      return;
    }
    void store
      .get(userId)
      .then((profile) => {
        socket.data.name = profile?.name ?? null;
        socket.data.identity = {
          userId,
          avatar: profile?.avatar ?? null,
          accentColor: profile?.accentColor ?? null,
        };
        next();
      })
      .catch(() => {
        // A store that will not answer should not keep someone out. They sit
        // down under the name they sent, as a guest would — but still as
        // themselves, so a game they finish still pays the right account.
        socket.data.name = null;
        socket.data.identity = { userId, avatar: null, accentColor: null };
        next();
      });
  });

  /**
   * Who has which game open, and from which window.
   *
   * Keyed by account and game, so one person may have Slots on the desk and
   * Blackjack on the phone — that is two games, not two of one.
   */
  const openGames = new Map<string, { window: string; socket: string }>();

  // Joined on a character no id can contain, so no pair of them can be made to
  // spell another pair's key.
  const openKey = (userId: string, game: string) => `${userId}\u0000${game}`;

  /**
   * One window per game, per account.
   *
   * A middleware for the same reason the one above it is: it settles before the
   * client's first message is delivered, so a socket refused here never reaches
   * a room, a lobby or a lever, and there is no second place to remember to
   * check.
   *
   * A window id rather than a socket id, because first-wins is only humane if a
   * refresh can be told from a rival. A page that reloads is a new socket, and a
   * socket that died on a train is an old one that has not been noticed yet —
   * socket.io leaves that one in `io.sockets.sockets` for the best part of a
   * minute, which is a long time to be locked out of your own machine.
   *
   * Not an anti-cheat: the id is the client's own and a script may send any it
   * likes. It is a rule about windows, enforced honestly for browsers, and
   * nothing in the economy rests on it.
   */
  io.use((socket, next) => {
    socket.data.atGame = null;
    /*
     * Read apart rather than through one `safeParse` on the whole object: a
     * `window` that fails its own schema (empty, or absurdly long) must not
     * take a valid `game` down with it. A bad window degrades to the same
     * socket-id fallback below as a private window that sent none at all; it
     * must not exempt the socket from the rule entirely.
     */
    const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    const declaredGame = handshakeSchema.shape.game.safeParse(auth.game);
    const declaredWindow = handshakeSchema.shape.window.safeParse(auth.window);
    const userId = socket.data.identity?.userId ?? null;
    const game = declaredGame.success ? (declaredGame.data ?? null) : null;
    const listing = game === null ? undefined : CATALOGUE.get(game);
    // A guest has no account to key on, and a socket naming no game — or one the
    // building does not have — is not at a game to be turned away from.
    if (userId === null || game === null || listing === undefined) {
      next();
      return;
    }
    /*
     * A window that cannot name itself gets its socket id, which matches
     * nothing. That is the private-window case: it still claims, it just cannot
     * prove itself across a refresh.
     */
    const windowId =
      declaredWindow.success && declaredWindow.data !== undefined
        ? declaredWindow.data
        : socket.id;
    const key = openKey(userId, game);
    const held = openGames.get(key);
    const mine =
      held === undefined ||
      held.window === windowId ||
      /*
       * Belt-and-braces, and not what saves anybody from the ping timeout:
       * socket.io drops a socket from this map as it fires the disconnect that
       * already releases the claim. It is here so a claim cannot outlive its
       * socket if a release is ever missed — the map heals rather than holding a
       * game shut for the life of the process.
       */
      !io.sockets.sockets.has(held.socket);
    if (!mine) {
      next(new Error(`You already have ${listing.name} open in another window.`));
      return;
    }
    openGames.set(key, { window: windowId, socket: socket.id });
    socket.data.atGame = key;
    next();
  });

  /**
   * A pull on a machine playing for nothing.
   *
   * Deliberately the same arithmetic as the real one — same strip, same
   * paytable, same cap, same share of the bank — run against a purse and a
   * bank that were never anybody's. Sharing the arithmetic is the point: a
   * for-fun machine that played differently would teach the wrong game.
   *
   * Nothing here touches the store, the house bank, or anybody's record. A
   * player who runs dry is topped back up rather than shown the door, the way
   * a for-fun table already does it: there is nothing to protect at a machine
   * playing for nothing.
   */
  function spinForFun(
    socketId: string,
    asked: number,
    askedLines: number,
    ack: (result: SpinResult) => void,
  ): void {
    const machine = funMachines.get(socketId) ?? {
      purse: FUN_PURSE,
      bank: FUN_BANK,
      free: null,
    };
    funMachines.set(socketId, machine);

    /*
     * A free spin replays the bet that won it, and the client's numbers are
     * ignored while one is owed. Same rule as the real machine, for the same
     * reason: this mode exists to teach the game, and one that let you re-size
     * a free spin would be teaching a different one.
     */
    const owed = machine.free;
    const wasFree = owed !== null && owed.left > 0;
    const stake = wasFree && owed !== null ? owed.stake : asked;
    const lines = wasFree && owed !== null ? owed.lines : askedLines;

    const cap = wasFree ? maxFreeStake(machine.bank) : maxStake(machine.bank);
    if (stake > cap) {
      if (wasFree) {
        // The bank cannot cover what is left. Ending them is the only honest
        // answer: a free spin at a stake the bank cannot pay is not free, it
        // is a promise this machine does not keep.
        machine.free = null;
        ack({ ok: false, error: "The bank cannot cover the rest of the free spins." });
        return;
      }
      ack({ ok: false, error: `The bank covers ${cap} a spin at the moment.` });
      return;
    }
    if (!wasFree && stake > machine.purse) {
      ack({ ok: false, error: "Not enough play money." });
      return;
    }

    if (!wasFree) {
      machine.purse -= stake;
      machine.bank += stake;
    }

    const grid = drawGrid(spinRandom);
    const { lines: paid, fixed, jackpot } = evaluate(grid, stake, lines);
    const won = fixed + (jackpot ? jackpotPay(machine.bank) : 0);
    machine.bank -= won;
    machine.purse += won;

    const scatters = countScatters(grid);
    // Free spins do not retrigger, here or on the real machine.
    const awarded = wasFree ? 0 : freeSpinsFor(scatters);
    const left = (wasFree && owed !== null ? owed.left - 1 : 0) + awarded;
    machine.free = left > 0 ? { left, stake, lines } : null;

    // Topped back up rather than shown the door: losing play money costs
    // nothing, so running out should end a spin, not the evening.
    if (machine.purse < MIN_STAKE) {
      machine.purse = FUN_PURSE;
    }

    ack({
      ok: true,
      grid,
      lines: paid,
      won,
      stake,
      linesPlayed: lines,
      jackpot,
      bank: machine.bank,
      balance: machine.purse,
      scatters,
      awarded,
      freeLeft: left,
      wasFree,
    });
  }

  io.on("connection", (socket) => {
    wireTips(socket, { store, tellChips });

    socket.on("lobby:create", (payload, ack) => {
      const parsed = createSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: "Pick a name first." });
        return;
      }
      try {
        const game = ADAPTERS.get(parsed.data.game ?? GREED.id);
        if (game === undefined) {
          ack({ ok: false, error: "No such game." });
          return;
        }
        const code = makeCode();
        // Handed along without being read: what a game does with these, or
        // whether it does anything at all, is the game's own business.
        const table = game.create(code, {
          ruleset: parsed.data.ruleset,
          forFun: parsed.data.forFun,
          maxSeats: parsed.data.maxSeats,
          buyIn: parsed.data.buyIn,
          window: parsed.data.window,
          ceiling: parsed.data.ceiling,
        });
        rooms.set(code, { game, table, listed: parsed.data.listed ?? true });
        table.join(socket.id, seatNameFor(socket, parsed.data.name), socket.data.identity);
        sockets.set(socket.id, { code, seatId: socket.id });
        void socket.join(code);
        ack({ ok: true, code, seatId: socket.id });
        /*
         * What the bank holds, read before the first state rather than after it.
         *
         * A view is built synchronously and what the bank holds is a question
         * for the store, so the figure reaches the table through `payOut`,
         * which runs on every broadcast and therefore leaves it one broadcast
         * behind. Everywhere else that costs nothing: the broadcast before
         * this one already read it. A table's first has no broadcast before
         * it, so the figure is still the nought it was built with — and a felt
         * told the bank is empty greys out every spot on itself and stays that
         * way until something unrelated sends another state, which at a table
         * nobody has bet at yet can be a long time coming.
         *
         * The ack has already gone, so this delays the first state by one read
         * of the store and nothing else.
         */
        if (game.payOut === undefined) {
          broadcast(code);
        } else {
          void game
            .payOut(table, deps)
            .catch((error) => console.error("reading the bank failed", error))
            .finally(() => broadcast(code));
        }
      } catch (error) {
        ack(fail(error, "Could not open a table."));
      }
    });

    socket.on("lobby:join", (payload, ack) => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: "That is not a table code." });
        return;
      }
      const room = rooms.get(parsed.data.code);
      if (room === undefined) {
        ack({ ok: false, error: "No table with that code." });
        return;
      }
      try {
        /*
         * A seat belongs to a person, not to a socket.
         *
         * Leaving a game in progress does not give the seat up — it cannot,
         * because seats are held by index and removing one mid-game would
         * shift the turn order out from under everybody else, so the seat is
         * only marked as gone. Coming back then asked for a new seat and got
         * one, and the player was at the table twice: a ghost holding their
         * old place and a stranger wearing their name.
         *
         * So a join by somebody who already holds a seat here is a return to
         * it. Guests cannot be recognised this way and never could be — there
         * is nothing about a second visit from a nameless browser that says it
         * is the same browser — which is one more thing signing in buys.
         */
        const mine = reclaimable(room.table, socket.data.identity);
        if (mine !== null) {
          room.table.reconnect(mine);
          sockets.set(socket.id, { code: parsed.data.code, seatId: mine });
          void socket.join(parsed.data.code);
          ack({ ok: true, code: parsed.data.code, seatId: mine });
          broadcast(parsed.data.code);
          return;
        }

        room.table.join(socket.id, seatNameFor(socket, parsed.data.name), socket.data.identity);
        sockets.set(socket.id, { code: parsed.data.code, seatId: socket.id });
        void socket.join(parsed.data.code);
        ack({ ok: true, code: parsed.data.code, seatId: socket.id });
        broadcast(parsed.data.code);
      } catch (error) {
        ack(fail(error, "Could not sit down."));
      }
    });

    socket.on("lobby:resume", (payload, ack) => {
      const parsed = resumeSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: "That table is gone." });
        return;
      }
      const room = rooms.get(parsed.data.code);
      if (room === undefined) {
        ack({ ok: false, error: "That table is gone." });
        return;
      }
      try {
        room.table.reconnect(parsed.data.seatId);
        sockets.set(socket.id, { code: room.table.code, seatId: parsed.data.seatId });
        void socket.join(room.table.code);
        ack({ ok: true, code: room.table.code, seatId: parsed.data.seatId });
        broadcast(room.table.code);
      } catch (error) {
        ack(fail(error, "Could not rejoin."));
      }
    });

    socket.on("lobby:watch", (payload, ack) => {
      const parsed = watchSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: "That is not a table code." });
        return;
      }
      const room = rooms.get(parsed.data.code);
      if (room === undefined) {
        ack({ ok: false, error: "No table with that code." });
        return;
      }
      room.table.watch(socket.id);
      sockets.set(socket.id, { code: parsed.data.code, seatId: null });
      void socket.join(parsed.data.code);
      ack({ ok: true, code: parsed.data.code, seatId: "" });
      broadcast(parsed.data.code);
    });

    socket.on("lobby:leave", () => {
      const seat = sockets.get(socket.id);
      if (seat === undefined) {
        return;
      }
      sockets.delete(socket.id);
      void socket.leave(seat.code);
      const room = rooms.get(seat.code);
      if (room === undefined) {
        return;
      }
      if (seat.seatId === null) {
        room.table.unwatch(socket.id);
        broadcast(seat.code);
        reapWhenEmpty(seat.code);
        return;
      }
      /*
       * Deliberate, so the seat goes now rather than being held for a
       * reconnection that is not coming.
       *
       * Mid-hand it usually cannot: a blackjack stake is on the felt and the
       * hand has to play out before anybody can be paid, so the seat is held
       * and the player is treated as dropped. A game that says it can be left
       * mid-hand has somewhere for the chips to go, and holding the seat there
       * would strand them — nothing schedules the grace reaper on this path,
       * because nothing here is waiting for a reconnection.
       */
      if (room.table.status === "lobby" || room.table.leavesMidHand === true) {
        room.table.removeSeat(seat.seatId);
      } else {
        room.table.disconnect(seat.seatId);
      }
      broadcast(seat.code);
      reapWhenEmpty(seat.code);
    });

    socket.on("lobby:addBot", (payload) => {
      const parsed = addBotSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      guard(socket.id, (seated, seatId) => {
        requireHost(seated.table, seatId, "add players");
        const table = seated.table as { addBot?: (id: string, name: string, skill: string) => void };
        if (table.addBot === undefined) {
          throw new RoomError("This game has no bots.");
        }
        table.addBot(`bot:${randomInt(1, 1_000_000)}`, botName(seated.table), parsed.data.skill);
      });
    });

    socket.on("lobby:removeSeat", (payload) => {
      const parsed = removeSeatSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      guard(socket.id, (seated, seatId) => {
        requireHost(seated.table, seatId, "remove players");
        seated.table.removeSeat(parsed.data.seatId);
      });
    });

    socket.on("lobby:setRules", (payload) => {
      const parsed = setRulesSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      guard(socket.id, (seated, seatId) => {
        requireHost(seated.table, seatId, "change the rules");
        // A lobby option belongs to whichever game defines it; a game without
        // one simply does not answer to this.
        const table = seated.table as { updateRules?: (changes: unknown) => void };
        if (table.updateRules === undefined) {
          throw new RoomError("This game has no rules to change.");
        }
        table.updateRules(parsed.data);
      });
    });

    socket.on("lobby:setListed", (payload) => {
      const parsed = setListedSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      guard(socket.id, (seated, seatId) => {
        requireHost(seated.table, seatId, "change who can find this table");
        seated.listed = parsed.data.listed;
      });
    });

    socket.on("lobby:setBuyIn", (payload) => {
      const parsed = setBuyInSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      guard(socket.id, (seated, seatId) => {
        requireHost(seated.table, seatId, "set the stake");
        const table = seated.table as { setBuyIn?: (amount: number) => void };
        if (table.setBuyIn === undefined) {
          throw new RoomError("This game does not have a table stake.");
        }
        table.setBuyIn(parsed.data.amount);
      });
    });

    /**
     * Everything a player does at a table, whatever the game.
     *
     * One event rather than a verb each. The server does not know what "hit"
     * or "bank" mean and has no business knowing — it checks that somebody may
     * act, hands the action to the game, and reports the refusal if there is
     * one. Adding a game adds no events here.
     */
    socket.on("game:action", (payload, ack) => {
      const parsed = actionSchema.safeParse(payload);
      if (!parsed.success) {
        ack?.();
        return;
      }
      guard(socket.id, async (seated, seatId) => {
        await seated.game.act(seated.table, seatId, parsed.data, deps);
      });
      // Always acknowledged, refused or not: a client counting these needs to
      // know when its own optimistic picture can be dropped.
      ack?.();
    });

    socket.on("chat:send", (payload) => {
      const parsed = chatSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const seat = sockets.get(socket.id);
      if (seat === undefined) {
        return;
      }
      if (!withinBudget(chatBudgets, socket.id, CHAT_EVENTS, CHAT_WINDOW_MS)) {
        socket.emit("room:error", "Easy on the chat.");
        return;
      }
      const seated = rooms.get(seat.code);
      const who = seated?.table.seats.find((candidate) => candidate.id === seat.seatId);
      if (seated === undefined || who === undefined) {
        return;
      }
      // Plain text only, and never rendered as markup on the other side.
      io.to(seat.code).emit("chat:message", {
        seatId: who.id,
        name: who.name,
        text: parsed.data.text,
        at: Date.now(),
      });
    });

    /**
     * Paying to mock somebody.
     *
     * The order below is the safety argument and must not be rearranged. The
     * chips are taken from the sender *before* anything is staked or shown, so
     * a taunt that appears on the felt is one that has already been paid for.
     * Taking last would let a player with an empty account throw as many as
     * they liked and have every one of them land.
     *
     * The cost is read off the emote rather than out of the payload, because a
     * price a client sends is a price the client chose.
     */
    socket.on("taunt:send", (payload, ack) => {
      void (async () => {
        const parsed = tauntSchema.safeParse(payload);
        if (!parsed.success) {
          ack({ ok: false, error: "That is not a taunt." });
          return;
        }
        const seat = sockets.get(socket.id);
        if (seat === undefined) {
          ack({ ok: false, error: "Take a seat first." });
          return;
        }
        if (!withinBudget(tauntBudgets, socket.id, TAUNT_EVENTS, TAUNT_WINDOW_MS)) {
          ack({ ok: false, error: "Give them a moment." });
          return;
        }
        const seated = rooms.get(seat.code);
        if (seated === undefined) {
          ack({ ok: false, error: "That table is gone." });
          return;
        }
        const from = seated.table.seats.find((one) => one.id === seat.seatId);
        const at = seated.table.seats.find((one) => one.id === parsed.data.seatId);
        if (from === undefined || at === undefined) {
          ack({ ok: false, error: "Nobody is sitting there." });
          return;
        }
        if (from.id === at.id) {
          ack({ ok: false, error: "Taunt somebody else." });
          return;
        }
        /*
         * Both ends must be a real person with an account, and this is the
         * building's central rule rather than a convenience. A pool is chips
         * won from whoever filled it: a bot cannot fill one because it is not
         * a real person, and a guest can be at neither end because there is no
         * account for the chips to leave or land in.
         */
        if (from.isBot || from.userId === null) {
          ack({ ok: false, error: "Sign in to throw one of those." });
          return;
        }
        if (at.isBot || at.userId === null) {
          ack({ ok: false, error: "You can only taunt a signed-in player." });
          return;
        }

        const emote = (await store.listEmotes(false)).find(
          (one) => one.id === parsed.data.emoteId,
        );
        if (emote === undefined) {
          ack({ ok: false, error: "No such emote." });
          return;
        }

        // Taken first. Everything after this point is spending chips that are
        // already gone from the sender's account.
        if (!(await deps.take(from.userId, emote.cost))) {
          ack({ ok: false, error: "Not enough chips." });
          return;
        }

        const urls = emoteUrls(emote.id, emote.soundMime !== null);
        emotesSeen.set(emote.id, { name: emote.name, image: urls.image, sound: urls.sound });

        const id = randomUUID();
        taunts.add(seat.code, {
          id,
          emoteId: emote.id,
          chips: emote.cost,
          fromSeatId: from.id,
          fromUserId: from.userId,
          fromName: from.name,
          atSeatId: at.id,
          atUserId: at.userId,
          atName: at.name,
          at: Date.now(),
        });

        io.to(seat.code).emit("taunt:play", {
          id,
          emoteId: emote.id,
          name: emote.name,
          image: urls.image,
          sound: urls.sound,
          fromSeatId: from.id,
          fromName: from.name,
          atSeatId: at.id,
          atName: at.name,
          chips: emote.cost,
          revenge: false,
        } satisfies TauntPlay);

        // The felt has to show what is now riding on that seat.
        sendState(seat.code, seated);

        const after = await store.get(from.userId);
        ack({ ok: true, chips: after?.chips ?? 0 });
      })();
    });

    /**
     * One pull of the lever.
     *
     * Not a game:action, because there is no table for one to act on: a
     * machine has no seats, no turns and no opponents, and catalogue.ts
     * already says that forcing one through a table would bend both out of
     * shape.
     *
     * The order below is the entire safety argument and must not be
     * rearranged. The stake is taken from the player and put into the bank
     * *before* the reels are drawn, so by the time anything is owed, the money
     * to pay it is already there — including the jackpot's share, which is a
     * share of the bank as it stands with the stake in it.
     */
    socket.on("slots:watch", (_payload, ack) => {
      void socket.join(SLOTS_ROOM);
      // The backlog goes back with the ack rather than as a second event, so
      // a machine that has just been opened is never briefly blank.
      ack(recentSpins.slice(0, 12));
    });

    socket.on("slots:away", () => {
      void socket.leave(SLOTS_ROOM);
    });

    socket.on("slots:spin", (payload, ack) => {
      void (async () => {
        const parsed = spinSchema.safeParse(payload);
        if (!parsed.success) {
          ack({ ok: false, error: "That is not a stake." });
          return;
        }
        const asked = parsed.data.stake;
        const askedLines = parsed.data.lines ?? LINE_COUNT;

        /*
         * Before the sign-in check, not after: nobody signs in to play for
         * nothing. This mode touches no account, so requiring one would be
         * asking for a name to write on a receipt that is never issued.
         */
        if (parsed.data.forFun === true) {
          spinForFun(socket.id, asked, askedLines, ack);
          return;
        }

        const userId = socket.data.identity?.userId ?? null;
        if (userId === null) {
          ack({ ok: false, error: "Sign in to play for chips." });
          return;
        }

        if (spinning.has(userId)) {
          ack({ ok: false, error: "One spin at a time." });
          return;
        }
        spinning.add(userId);
        try {
          /*
           * A free spin replays the bet that won it. The stake and the line
           * count come off the server's own record of the trigger, never off
           * this message — otherwise the play is to trigger the bonus on the
           * smallest stake the machine takes and claim the eight on the largest.
           */
          const owed = freeSpins.get(userId);
          const wasFree = owed !== undefined && owed.left > 0;
          const stake = wasFree && owed !== undefined ? owed.stake : asked;
          const lines = wasFree && owed !== undefined ? owed.lines : askedLines;

          /*
           * Two caps, and the free one is the stricter. A paid spin's stake is
           * in the bank by the time anything is owed; a free spin's never was,
           * so the same worst case has to come out of a bank one stake shallower.
           */
          const cap = wasFree ? maxFreeStake(await store.bank("slots")) : maxStake(await store.bank("slots"));
          if (stake > cap) {
            if (wasFree) {
              /*
               * The bank has been walked down by the run itself and can no
               * longer cover what is left. The rest are forfeit, which is the
               * only honest answer: a free spin the bank cannot pay out on is
               * not a free spin, it is a promise this machine does not keep.
               */
              freeSpins.delete(userId);
              ack({ ok: false, error: "The bank cannot cover the rest of the free spins." });
              return;
            }
            ack({
              ok: false,
              error:
                cap < 1
                  ? "The bank is empty. Nothing to play for yet."
                  : `The bank covers ${cap} a spin at the moment.`,
            });
            return;
          }

          /*
           * Nothing is taken for a free spin and nothing enters the bank — which
           * is exactly why the free cap above is the stricter one. Every other
           * step below is identical, deliberately: a free spin is the same spin,
           * paid for earlier.
           */
          if (!wasFree) {
            if (!(await deps.take(userId, stake))) {
              ack({ ok: false, error: "Not enough chips." });
              return;
            }
            await store.bankAdd("slots", stake);
          }

          const grid = drawGrid(spinRandom);
          const { lines: paid, fixed, jackpot } = evaluate(grid, stake, lines);
          const won = fixed + (jackpot ? jackpotPay(await store.bank("slots")) : 0);

          /*
           * Paid out of the bank, and only if the bank actually has it. The
           * stake cap means this cannot refuse, which is exactly why it is
           * checked: the alternative to checking is a bank that goes negative in
           * silence and a machine that has quietly started minting chips.
           */
          if (won > 0 && !(await store.bankTake("slots", won))) {
            if (!wasFree) {
              await store.bankAdd("slots", -stake);
              await deps.give(userId, stake);
            }
            ack({ ok: false, error: "The bank is short. Nothing was staked." });
            return;
          }
          if (won > 0) {
            await deps.give(userId, won);
          }

          /*
           * The bonus. Counted after the lines are paid because it changes
           * nothing about them — three bonuses anywhere is a run of spins, not a
           * multiplier — and awarded only on a spin somebody paid for, so a run
           * of free spins is a run of known length rather than a series.
           */
          const scatters = countScatters(grid);
          const awarded = wasFree ? 0 : freeSpinsFor(scatters);
          const left = (wasFree && owed !== undefined ? owed.left - 1 : 0) + awarded;
          if (left > 0) {
            freeSpins.set(userId, { left, stake, lines });
          } else {
            freeSpins.delete(userId);
          }

          /*
           * Told to everybody at the machine, spinner included. Only chips
           * spins: a for-fun purse was never anybody's, and putting its wins on
           * the wall would advertise a room busier than it is.
           *
           * A free spin goes up with a stake of nothing, because that is what it
           * cost. Reporting the replayed bet would put chips on the wall that
           * nobody put down.
           */
          const news: SpinNews = {
            id: `${socket.id}-${Date.now()}-${recentSpins.length}`,
            name: socket.data.name ?? "Someone",
            avatar: socket.data.identity?.avatar ?? null,
            stake: wasFree ? 0 : stake,
            won,
            jackpot,
            at: Date.now(),
          };
          recentSpins.unshift(news);
          recentSpins.length = Math.min(recentSpins.length, 24);
          io.to(SLOTS_ROOM).emit("slots:spun", news);

          const cost = wasFree ? 0 : stake;
          await deps.record(userId, {
            shared: { games: 1, wins: won > cost ? 1 : 0, chipsWon: won - cost, chipsStaked: cost },
            game: SLOTS.id,
            add: { spins: 1, staked: cost, jackpots: jackpot ? 1 : 0 },
            // A best spin is a maximum, and only the machine knows that.
            max: { bestSpin: won },
          });

          ack({
            ok: true,
            grid,
            lines: paid,
            won,
            stake,
            linesPlayed: lines,
            jackpot,
            scatters,
            awarded,
            freeLeft: left,
            wasFree,
            bank: await store.bank("slots"),
            balance: (await store.get(userId))?.chips ?? 0,
          });
        } finally {
          // In a finally so a throw cannot wedge an account out of its own
          // machine for the life of the process.
          spinning.delete(userId);
        }
      })();
    });

    socket.on("disconnect", () => {
      /*
       * Only if the claim still names this socket. A window that was refused,
       * or one already replaced by its own refresh, must not be able to
       * release somebody else's game on its way out.
       */
      const claimed = socket.data.atGame;
      if (claimed !== null && openGames.get(claimed)?.socket === socket.id) {
        openGames.delete(claimed);
      }

      const seat = sockets.get(socket.id);
      sockets.delete(socket.id);
      // Play money lives at the machine and goes when they do.
      funMachines.delete(socket.id);
      budgets.delete(socket.id);
      chatBudgets.delete(socket.id);
      if (seat === undefined) {
        return;
      }
      const room = rooms.get(seat.code);
      if (room === undefined) {
        return;
      }
      if (seat.seatId === null) {
        room.table.unwatch(socket.id);
        broadcast(seat.code);
        reapWhenEmpty(seat.code);
        return;
      }
      // Captured, so the timer below is not re-reading a field that has since
      // been narrowed away by the watcher check above.
      const seatId = seat.seatId;

      /*
       * Only if this socket still holds the seat.
       *
       * A browser that drops and comes straight back reclaims its seat on the
       * new connection, and the old connection's disconnect can arrive long
       * afterwards — socket.io does not give up on a socket until it has timed
       * out pinging it. Unconditionally, that late event marked the seat gone
       * out from under the connection that now owned it: the player showed as
       * dropped out for the rest of the session, every hand of theirs was
       * marked done so the table skipped them, and nothing ever set it back,
       * while betting carried on taking their chips because a bet never asked
       * whether they were connected.
       *
       * This socket's own entry has already been deleted above, so anything
       * still pointing at the seat is somebody else's live connection.
       */
      const heldByAnother = [...sockets.values()].some(
        (other) => other.code === seat.code && other.seatId === seatId,
      );
      if (heldByAnother) {
        broadcast(seat.code);
        return;
      }

      room.table.disconnect(seatId);
      broadcast(seat.code);

      // Hold the seat long enough for a page refresh to reclaim it.
      later(() => {
        const still = rooms.get(seat.code);
        if (still === undefined) {
          return;
        }
        // Asked of the table rather than the view: every game has seats, and
        // not every game's view is shaped the same.
        const held = still.table.seats.find((candidate) => candidate.id === seatId);
        if (held?.connected === true) {
          return; // they came back
        }
        // Or came back on a connection this timer has never heard of.
        if ([...sockets.values()].some((o) => o.code === seat.code && o.seatId === seatId)) {
          return;
        }
        still.table.removeSeat(seatId);
        broadcast(seat.code);
      }, reconnectGraceMs);

      reapWhenEmpty(seat.code);
    });
  });

  async function close(): Promise<void> {
    for (const handle of pending) {
      clearTimeout(handle);
    }
    pending.clear();
    for (const store of [turnClocks, botMoves]) {
      for (const handle of store.values()) {
        clearTimeout(handle);
      }
      store.clear();
    }
    for (const waiting of pauses.values()) {
      clearTimeout(waiting.timer);
    }
    pauses.clear();
    await io.close();
    await store.close();
    await new Promise<void>((resolve) => {
      http.close(() => resolve());
    });
  }

  return { http, io, rooms, store, close };
}

/**
 * How much of X-Forwarded-Proto to believe.
 *
 * Behind a proxy that terminates TLS — Cloudflare, nginx, a tunnel — Express
 * sees a plain http connection and only learns otherwise from that header.
 * Until it is told to trust the header it treats every request as insecure,
 * and express-session then declines to send a cookie marked `secure` at all:
 * no cookie, no session, and signing in silently does nothing.
 *
 * An empty string counts as unset. Compose writes `${VAR:-}` for anything
 * absent from .env, so in a container "not configured" arrives as "" rather
 * than as undefined, and a `??` here would look right and never fire.
 */
export function resolveTrustProxy(
  configured: string | undefined,
): number | boolean | string | null {
  const value = configured?.trim() ?? "";
  if (value.length === 0) {
    // One proxy in front is the ordinary deployment; nothing in development.
    return isProduction() ? 1 : null;
  }
  if (value === "true" || value === "false") {
    return value === "true";
  }
  const hops = Number(value);
  // Anything else is Express's own syntax: an address, a subnet, "loopback".
  return Number.isNaN(hops) ? value : hops;
}

/** Whether this is a real deployment rather than someone's laptop. */
function isProduction(): boolean {
  return process.env["NODE_ENV"] === "production";
}

/**
 * The key that signs session cookies, and therefore the thing standing between
 * a stranger and someone else's chips.
 *
 * There is a fixed development default so a local restart does not sign
 * everyone out mid-game, but that value is in a public repository, so anyone
 * could forge a cookie with it. In production a real secret is required and the
 * server refuses to start without one — failing loudly beats running with a
 * key the whole internet can read.
 */
export function resolveSessionSecret(provided: string | undefined): string {
  if (provided !== undefined && provided.length > 0) {
    return provided;
  }
  if (isProduction()) {
    throw new Error(
      "SESSION_SECRET must be set in production. Generate one with " +
        "`node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\"` " +
        "and put it in .env — without it, session cookies would be signed with a " +
        "key published in this repository.",
    );
  }
  return "back-room-development-secret";
}

function requireHost(table: PlayTable, seatId: string, what: string): void {
  if (seatId !== table.hostId) {
    throw new RoomError(`Only the host can ${what}.`);
  }
}

function fail(error: unknown, fallback: string): Ack {
  return { ok: false, error: error instanceof RoomError ? error.message : fallback };
}

/** The dice. Server-side, always — a client never generates a face. */
function defaultRoll(count: number): Die[] {
  const dice: Die[] = [];
  for (let index = 0; index < count; index += 1) {
    dice.push(randomInt(1, 7) as Die);
  }
  return dice;
}
