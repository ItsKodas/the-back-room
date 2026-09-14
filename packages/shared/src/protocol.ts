import type { Die, Ruleset } from "@backroom/rules";

/** Where a turn is in its cycle. */
export type Phase = "awaiting_roll" | "selecting" | "farkled" | "over";

export type RoomStatus = "lobby" | "playing" | "over";

/** How hard a bot plays. */
export type BotSkill = "easy" | "normal" | "hard";

export interface SeatView {
  id: string;
  name: string;
  /** Banked game score. */
  score: number;
  /** Whether they have met the entry threshold at least once. */
  onBoard: boolean;
  connected: boolean;
  isHost: boolean;
  isBot: boolean;
  /** Playing from a profile rather than as a guest. */
  signedIn: boolean;
  /** At the table, but sitting out the game currently being played. */
  waiting: boolean;
  /** Their picture, when they have one. Guests and bots never do. */
  avatar: string | null;
  /** Their colour, as a 24-bit number, when they have set one. */
  accentColor: number | null;
}

export interface TurnView {
  seatId: string;
  /**
   * Increments on every roll. The client keys its dice animation and its sound
   * off this rather than off the dice themselves, because rolling the same
   * faces twice running is a real roll and must still register.
   */
  rollSeq: number;
  /** The dice currently on the table. Set-aside dice are folded into `kept`. */
  dice: Die[];
  /** Parallel to `dice`: which are currently picked up. */
  held: boolean[];
  /** Parallel to `dice`: which can never be part of a scoring selection. */
  dead: boolean[];
  /** Points already set aside this turn, before the current selection. */
  kept: number;
  /** What the current selection is worth, or 0 when it is not legal. */
  selection: number;
  /** Whether the current selection could be banked or rolled on. */
  selectionValid: boolean;
  /** Dice that would be rolled next, accounting for hot dice. */
  nextRollCount: number;
  /** Chance the next roll scores nothing, 0..1. */
  bustChance: number;
  phase: Phase;
  /**
   * Epoch milliseconds at which the active player forfeits, or null when no
   * clock is running. Absolute rather than a countdown so the client cannot
   * drift away from the server.
   */
  endsAt: number | null;
}

/**
 * What the server adds to every table state, whatever the game.
 *
 * Both of these are the building's business rather than any game's: which
 * game is being played, and whether the table is on the public list. A game
 * knows neither, which is why they are added around its view instead of asked
 * of it.
 */
export interface TableEnvelope {
  game: string;
  listed: boolean;
  /**
   * What is riding on each seat, from taunts thrown at them this hand.
   *
   * Here beside `listed` rather than inside a game's view for the same reason:
   * it is the room's fact about the table, not the game's. A game does not
   * know taunts exist, and every game gets them anyway.
   */
  taunts: TauntStake[];
}

/** Chips staked on one seat winning, by the people who mocked them. */
export interface TauntStake {
  seatId: string;
  chips: number;
}

/** Any game's view of a table, wrapped in what the room knows about it. */
export type TableState = TableEnvelope & Record<string, unknown>;

export interface RoomView {
  code: string;
  status: RoomStatus;
  seats: SeatView[];
  /** How many people are watching without a seat. */
  watching: number;
  turn: TurnView | null;
  ruleset: Ruleset;
  /** Chips each seat stakes. Zero for a friendly game. */
  buyIn: number;
  pot: number;
  /** Set when status is "over". */
  winnerIds: string[];
  /** A short line describing what just happened, for the activity strip. */
  lastEvent: string | null;
}

export type Ack =
  | { ok: true; code: string; seatId: string }
  | { ok: false; error: string };

/** A public table, as the room advertises it to somebody looking for one. */
export interface TableOnOffer {
  code: string;
  game: string;
  /** Who opened it. */
  host: string;
  seats: number;
  maxSeats: number;
  /** How many are stood watching. */
  watching: number;
  status: RoomStatus;
}

export interface ClientToServer {
  "lobby:create": (
    /**
     * `game` names which table to open; left out, it is Greed, as it always
     * was. `listed` puts it on the public list, and is the default — a table
     * nobody can find is a table you have to organise before you can play at.
     */
    payload: {
      name: string;
      game?: string;
      ruleset?: string;
      listed?: boolean;
      /** How many seats the host wants. Absent means as many as the game allows. */
      maxSeats?: number;
      /** Play money, so anybody may sit down. The game decides what it means. */
      forFun?: boolean;
      /**
       * What the host wants it to cost to sit down.
       *
       * Snapped to a level the game allows rather than taken at its word: this
       * decides how much of somebody's balance is at risk at a table they sat
       * down at, and it is not a number a client gets to invent.
       */
      buyIn?: number;
      /**
       * How long the table takes bets for, in milliseconds.
       *
       * The same kind of decision as the seat count: a wheel that comes round
       * every fifteen seconds and one that comes round every minute are
       * different games to sit at, so it is the host's rather than anybody's.
       * Snapped to a level the game offers.
       */
      window?: number;
      /**
       * Where a duel at this table starts, for a game that counts down.
       *
       * Part of the shape of the table rather than of any one duel, so it is
       * the host's. Snapped to a level the game offers.
       */
      ceiling?: number;
    },
    ack: (result: Ack) => void,
  ) => void;
  "lobby:join": (payload: { name: string; code: string }, ack: (result: Ack) => void) => void;
  "lobby:resume": (payload: { seatId: string; code: string }, ack: (result: Ack) => void) => void;
  /** Watch a table without taking a seat at it. */
  "lobby:watch": (payload: { code: string }, ack: (result: Ack) => void) => void;
  "lobby:leave": () => void;
  "lobby:addBot": (payload: { skill: BotSkill }) => void;
  "lobby:setRules": (payload: Partial<HouseRules>) => void;
  "lobby:setBuyIn": (payload: { amount: number }) => void;
  /** Whether the table appears on the public list. The host's call. */
  "lobby:setListed": (payload: { listed: boolean }) => void;
  "lobby:removeSeat": (payload: { seatId: string }) => void;
  /**
   * Anything a player does at a table, whatever the game.
   *
   * One event rather than a verb each. What is in the payload is the game's
   * business — "roll", "hit", "double" — and the server does not read it, so a
   * new game adds no events here. The ack carries nothing; it only says the
   * server has dealt with it, which is what a client showing a move before the
   * reply needs in order to know when to stop.
   */
  "game:action": (payload: { type: string; [key: string]: unknown }, ack?: () => void) => void;
  "chat:send": (payload: { text: string }) => void;
  /**
   * Throw a paid-for emote at somebody at this table.
   *
   * Not a `game:action`, and the distinction is the same one the slot machine
   * draws: a game validates its own actions and this is not one. No game knows
   * what a taunt is, none of them should have to, and a taunt at a card table
   * means exactly what it means at a dice table.
   *
   * The ack carries the sender's balance so the picker can settle to the
   * truth, rather than trusting the number it optimistically decremented.
   */
  "taunt:send": (
    payload: { emoteId: string; seatId: string },
    ack: (result: TauntAck) => void,
  ) => void;
  /**
   * One pull of the lever at the slot machine.
   *
   * An event of its own rather than a game:action, because there is no table
   * for one to act on: a machine has no seats, no turns and no opponents, and
   * catalogue.ts already says that forcing one through a table would bend both
   * out of shape.
   */
  /**
   * Stand at the machine, so you are sent what other people are winning.
   *
   * Separate from spinning, because most of the people who should see the
   * feed are not spinning at that moment — that is rather the point of it.
   */
  "slots:watch": (payload: Record<string, never>, ack: (recent: SpinNews[]) => void) => void;
  "slots:away": () => void;
  "slots:spin": (
    /**
     * `forFun` plays the machine for nothing: a purse and a bank that live at
     * the machine, touch no account and are gone when you walk away.
     */
    payload: { stake: number; lines?: number; forFun?: boolean },
    ack: (result: SpinResult) => void,
  ) => void;
  /**
   * Stand at the jar and be told what is in it.
   *
   * Its own events rather than game:action, for the same reason the machine
   * has its own: there is no table for one to act on.
   */
  "tips:open": (payload: Record<string, never>, ack: (jar: JarView) => void) => void;
  "tips:tap": (payload: { token: string }, ack: (result: TapResult) => void) => void;
  "tips:buy": (
    payload: { upgrade: string; token: string },
    ack: (result: TapResult) => void,
  ) => void;
}

/**
 * The faces on the reels, as they travel over the wire.
 *
 * Written out here as well as in games/slots because shared sits beneath the
 * games and cannot import from one. They have to agree, and a test in
 * games/slots fails if they stop agreeing — a face this end does not know
 * renders as a blank reel, which reads as a broken machine rather than a
 * broken build.
 */
export const SPIN_FACES = [
  "tumbler",
  "cigar",
  "dice",
  "spade",
  "diamond",
  "seven",
  "bonus",
] as const;

export type SpinFace = (typeof SPIN_FACES)[number];

/**
 * One payline that paid, and what it paid.
 *
 * Never the bonus. It pays for turning up anywhere rather than for landing in
 * a row, so it is counted as a scatter and reported separately.
 */
export interface SpinLine {
  /** Which of the nine lines, so the glass can light the right one. */
  line: number;
  face: Exclude<SpinFace, "bonus">;
  length: number;
  pay: number;
}

/**
 * One spin, as everybody else at the machine sees it.
 *
 * Only spins played for chips. A for-fun machine's purse was never anybody's,
 * so putting its wins on the wall would advertise a room busier than it is.
 */
export interface SpinNews {
  /** Unique per spin, so the client can key a list without an index. */
  id: string;
  name: string;
  avatar: string | null;
  stake: number;
  won: number;
  jackpot: boolean;
  at: number;
}

/** What the machine did with a pull of the lever. */
export type SpinResult =
  | {
      ok: true;
      /** Five columns of three, top row first. */
      grid: SpinFace[][];
      lines: SpinLine[];
      /** Everything won, jackpot included. */
      won: number;
      /** What was staked, and across how many lines, so the glass can say so. */
      stake: number;
      linesPlayed: number;
      jackpot: boolean;
      /** What the bank holds now, so the sign can be right without a refetch. */
      bank: number;
      /** The player's balance now, for the same reason. */
      balance: number;
      /** How many reels showed a bonus, so the glass can make a noise about it. */
      scatters: number;
      /**
       * Free spins this pull awarded, and how many are left after it.
       *
       * `awarded` is only ever non-zero on the spin that triggered them, so
       * the client can tell "you have just won eight" from "you have seven
       * left" without keeping a tally the server would then have to agree
       * with. `freeLeft` is the server's count, and the only one that decides
       * whether the next pull costs anything.
       */
      awarded: number;
      freeLeft: number;
      /** Whether this spin was itself a free one, and so cost nothing. */
      wasFree: boolean;
    }
  | { ok: false; error: string };

/**
 * The jar, as the player standing at it may see it.
 *
 * `level`, `at` and `trickle` travel together rather than a bare level so the
 * client can draw the jar filling between taps without asking. That is
 * deriving, not inventing: same arithmetic, same inputs, and every ack
 * replaces it with the server's answer.
 */
export interface JarView {
  level: number;
  /** When `level` was true, by the server's clock. */
  at: number;
  brim: number;
  /** Chips per minute. */
  trickle: number;
  scoop: number;
  favours: number;
  bought: string[];
  chipsTonight: number;
  /** When this night's upgrades and favours expire. */
  nightEndsAt: number;
  /** What the next tap or buy must carry. */
  token: string;
}

/**
 * What the jar did with a tap.
 *
 * The refusal carries a jar too, and that is what makes a refused tap
 * recoverable rather than terminal: the token in it is fresh, so the client
 * resyncs instead of wedging.
 */
export type TapResult =
  | { ok: true; paid: number; balance: number; jar: JarView }
  | { ok: false; error: string; jar: JarView };

export interface ServerToClient {
  /** Somebody at the machine just pulled the lever. */
  "slots:spun": (news: SpinNews) => void;
  /**
   * The table, as this seat may see it.
   *
   * Shaped by whichever game is being played, so it carries the game's id and
   * nothing more is promised here. A client knows which game it opened and
   * reads the rest accordingly; the alternative is a union that every game has
   * to be added to, which is the coupling this whole layer just shed.
   */
  "room:state": (state: TableState) => void;
  "room:error": (message: string) => void;
  "chat:message": (message: ChatMessage) => void;
  /**
   * What this account is now worth, pushed as it changes.
   *
   * Chips move while you are looking at them — a stake is taken as it is
   * placed and a hand pays out on its own clock — and a balance that only
   * catches up on a page load is a balance nobody trusts. Sent only to the
   * sockets signed in as that account, so it is never anybody else's business.
   */
  "me:chips": (chips: number) => void;
  /**
   * Somebody was taunted, and everybody at the table sees it.
   *
   * Sent to the room rather than to the two people involved. A taunt is a
   * public act — that is what makes it a taunt rather than a private message —
   * and the chips riding on it are about to change what the table is playing
   * for.
   */
  "taunt:play": (taunt: TauntPlay) => void;
}

/** What the server says about a throw. */
export type TauntAck =
  | { ok: true; chips: number }
  | { ok: false; error: string };

/**
 * An emote as the room offers it, with no bytes in it.
 *
 * The URLs are absolute paths on this same server rather than data the client
 * assembles, so where the files are served from can move without every client
 * having to agree about it.
 */
export interface EmoteView {
  id: string;
  name: string;
  cost: number;
  image: string;
  /** Null for an emote that is seen and not heard. */
  sound: string | null;
}

/** One taunt landing, as everybody at the table sees it. */
export interface TauntPlay {
  /** Unique per throw, so the client can key an animation without an index. */
  id: string;
  emoteId: string;
  /** The emote's own name and files, so a client that has never fetched the
      catalogue can still show what landed. */
  name: string;
  image: string;
  sound: string | null;
  fromSeatId: string;
  fromName: string;
  atSeatId: string;
  atName: string;
  /** What it cost, which is what went into the pool. */
  chips: number;
  /**
   * True when this is the pool coming back.
   *
   * The same emote, played at the person who originally threw it, because the
   * person they aimed it at went on to win. The client shows it differently:
   * it is not a new taunt and nobody paid for it a second time.
   */
  revenge: boolean;
}

export interface ChatMessage {
  seatId: string;
  name: string;
  text: string;
  at: number;
}

/** The subset of a ruleset a host may move from the lobby. */
export interface HouseRules {
  targetScore: number;
  entryThreshold: number;
  finalRound: boolean;
  turnTimerSeconds: number | null;
  straight: number | null;
  threePairs: number | null;
  twoTriplets: number | null;
  fourPlusPair: number | null;
}

/** Unambiguous when read aloud: no O/0, I/1, S/5, Z/2. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRTUVWXY346789";
export const CODE_LENGTH = 5;

export const MAX_SEATS = 8;
/** One is allowed: a solo table is practice against the target score. */
export const MIN_SEATS = 1;
