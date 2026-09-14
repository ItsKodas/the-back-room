import type {
  BotSkill,
  PlayTable,
  Seat,
  SeatIdentity,
  TableStatus,
} from "@backroom/core";
import { Seating, TableError } from "@backroom/core";
import type { Passed, Rolled } from "./duel.js";
import { Duel } from "./duel.js";
import { FUN_PURSE, passPrice, TURN_MS } from "./listing.js";

/**
 * A death roll table.
 *
 * What makes it different from every other table in the building: its state
 * change *is* the money. A duel cannot start until both antes are in, and
 * nothing starts one but a clock — so the table cannot simply begin and let
 * `settle` catch the chips up the way a card table does. It asks instead, and
 * the adapter answers on the next broadcast. See `askForDuel` below.
 */

export type Phase = "waiting" | "dueling" | "over";

export interface SeatView {
  id: string;
  name: string;
  connected: boolean;
  waiting: boolean;
  isBot: boolean;
  avatar: string | null;
  accentColor: number | null;
  /** Whether this seat has spent its one pass this duel. */
  passed: boolean;
  /** Play money left, at a for-fun table. Null anywhere else. */
  purse: number | null;
}

export interface TableView {
  code: string;
  phase: Phase;
  seats: readonly SeatView[];
  watching: number;
  forFun: boolean;
  maxSeats: number;
  /** What a duel here is played for. The same figure for fun or for chips. */
  ante: number;
  /** Where a duel here starts. */
  opening: number;
  passPrice: number;
  /** The number being rolled against. The opening figure between duels. */
  ceiling: number;
  pot: number;
  toRoll: string | null;
  turnEndsAt: number | null;
  lastRoll: Rolled | null;
  lastPass: Passed | null;
  /** Every roll of the duel on the felt, oldest first. */
  history: readonly Rolled[];
  loserId: string | null;
  winnerIds: readonly string[];
  /** Why the table is not dealing, when it is not. */
  waitingFor: "opponent" | "funds" | null;
  /** Whose ante was refused, when that is why it is waiting. */
  shortId: string | null;
  lastEvent: string | null;
  /** This seat, or null for somebody only watching. */
  you: SeatView | null;
}

export class Table implements PlayTable {
  readonly code: string;
  readonly opening: number;
  readonly ante: number;
  readonly passPrice: number;

  forFun = false;
  lastEvent: string | null = null;
  duel: Duel | null = null;
  turnEndsAt: number | null = null;
  shortId: string | null = null;

  private readonly seating: Seating;
  private readonly turnMs: number;
  private readonly purses = new Map<string, number>();
  /** Who rolls first next duel, so the disadvantage alternates. */
  private nextFirst: string | null = null;
  /** Who rolled first this duel, so the next one can hand it to the other. */
  private startedWith: string | null = null;
  /** A duel the table wants started, waiting on somebody to take the antes. */
  private wanted: string[] | null = null;
  /** Seats that asked to go while a duel was running, dropped when it clears. */
  private readonly leaving = new Set<string>();

  constructor(
    code: string,
    maxSeats: number,
    options: { opening: number; ante: number; turnMs?: number },
  ) {
    this.code = code;
    this.seating = new Seating(maxSeats);
    this.opening = options.opening;
    this.ante = options.ante;
    this.passPrice = passPrice(options.ante);
    this.turnMs = options.turnMs ?? TURN_MS;
  }

  // ------------------------------------------------------------- the room

  get seats(): readonly Seat[] {
    return this.seating.seats;
  }
  get hostId(): string | null {
    return this.seating.hostId;
  }
  get isEmpty(): boolean {
    return this.seating.isEmpty;
  }
  get maxSeats(): number {
    return this.seating.limit;
  }
  get watching(): number {
    return this.seating.watching;
  }
  get status(): TableStatus {
    return this.isEmpty ? "over" : "playing";
  }

  /**
   * Standing up mid-duel cannot be honoured there and then.
   *
   * There are chips on the felt and the duel has to play out and settle before
   * anybody can be paid, so the seat is held and the player is treated as
   * dropped — blackjack's answer, for blackjack's reason. Their turns roll on
   * the clock, and the seat goes once the duel is cleared away.
   */
  readonly leavesMidHand = false;

  /**
   * A seat at the table.
   *
   * A chips table insists on knowing who you are; a for-fun one does not,
   * because nobody signs in to play for nothing.
   */
  join(id: string, name: string, identity: SeatIdentity | null): Seat {
    const seat = this.seating.join(id, name, this.status, identity, !this.forFun);
    /*
     * Dealt in immediately rather than made to wait for the next duel. Every
     * other game seats a latecomer as a spectator because a table mid-hand has
     * a game in progress they cannot join; here the table has exactly two
     * seats and a second player arriving is the thing the table is waiting
     * for, so making them wait would mean it never deals at all.
     */
    seat.waiting = false;
    return seat;
  }

  /**
   * Sits a bot down opposite you.
   *
   * Only ever at a table playing for nothing. Chips are only won from real
   * people: a bot has no account to take them from and none to pay them to, so
   * a duel won against one at a table paying real chips would be chips out of
   * thin air. The same reason every other game in the building refuses one.
   */
  addBot(id: string, name: string, skill: BotSkill): Seat {
    if (!this.forFun) {
      throw new TableError("Bots only sit at tables playing for fun.");
    }
    const seat = this.seating.addBot(id, name, skill);
    // Dealt in at once, for the reason `join` gives.
    seat.waiting = false;
    return seat;
  }

  /**
   * Standing somebody up, or promising to.
   *
   * The room reaps a seat once its player has been gone for a minute and a
   * half, whatever the table happens to be doing — and an absent player burns
   * a full turn clock every turn, so a duel outlives that grace routinely.
   * Honouring it there and then would break what `leavesMidHand: false`
   * promises: there are chips on the felt, the duel has to play out and settle
   * before anybody can be paid, and a winner whose seat had already gone would
   * be both antes paid to nobody. So it is held and carried out by `finish`.
   *
   * Not blackjack's outright refusal, which it can afford because its seats
   * are only given up in its lobby. This table has no lobby and exactly two
   * seats, so a refusal would leak them and leave nobody able to sit down.
   */
  removeSeat(seatId: string): void {
    if (this.duel !== null) {
      this.leaving.add(seatId);
      return;
    }
    this.drop(seatId);
  }

  private drop(seatId: string): void {
    this.leaving.delete(seatId);
    this.seating.remove(seatId);
    this.purses.delete(seatId);
    if (this.nextFirst === seatId) {
      this.nextFirst = null;
    }
    if (this.shortId === seatId) {
      this.shortId = null;
    }
  }
  disconnect(seatId: string): void {
    this.seating.disconnect(seatId);
  }
  reconnect(seatId: string): Seat {
    /*
     * Coming back cancels a held removal. The room reaps on a timer that has
     * already fired by the time somebody on a bad line gets their socket back,
     * and a player sitting in a duel they are playing should not be stood up
     * the moment it ends for having once been slow.
     */
    this.leaving.delete(seatId);
    return this.seating.reconnect(seatId);
  }
  watch(socketId: string): void {
    this.seating.watch(socketId);
  }
  unwatch(socketId: string): void {
    this.seating.unwatch(socketId);
  }

  // ------------------------------------------------------------- the game

  get phase(): Phase {
    if (this.duel === null) {
      return "waiting";
    }
    return this.duel.over ? "over" : "dueling";
  }

  /** Two people at the table, both of them in the game. */
  get ready(): boolean {
    const playing = this.seats.filter((seat) => !seat.waiting);
    return playing.length === 2;
  }

  /**
   * Asks for a duel, without starting one.
   *
   * Taking an ante is asynchronous and this is called from a timer, which is
   * synchronous — so the table records that it wants a duel and the adapter
   * takes the antes on the next broadcast. Separating the two is what lets the
   * money be moved before any of the game state is.
   */
  askForDuel(): void {
    if (this.wanted !== null || !this.ready || this.duel !== null) {
      return;
    }
    this.wanted = this.seats.filter((seat) => !seat.waiting).map((seat) => seat.id);
  }

  get pending(): boolean {
    return this.wanted !== null;
  }

  /**
   * Whether somebody is taking the antes right now.
   *
   * Draining the queue is what stops one request being answered twice, but it
   * leaves a window it cannot cover on its own: for the whole of the taking —
   * two real writes to a real store, on somebody else's connection — the table
   * looks exactly like one with nothing pending and two people sat at it, so
   * the deal clock arms again and a second attempt takes two more antes for a
   * duel that only ever holds one pair of them. This is how the table says the
   * work has been handed over but is not finished.
   */
  draining = false;

  /**
   * Takes the request off the queue.
   *
   * Called before the adapter's first await, so that asking often is
   * exactly-once rather than a way to charge somebody twice.
   */
  takePending(): string[] | null {
    const wanted = this.wanted;
    this.wanted = null;
    if (wanted !== null) {
      this.draining = true;
    }
    return wanted;
  }

  /**
   * Notes that somebody could not cover their ante, for the felt to say so.
   *
   * Returns whether this is news. A table retries a refused ante on a timer,
   * and a player who is still short is not a new fact — telling everybody
   * again on each retry would be a table talking to itself.
   */
  noteShort(seatId: string | null): boolean {
    if (this.shortId === seatId) {
      return false;
    }
    this.shortId = seatId;
    this.lastEvent =
      seatId === null
        ? null
        : `${this.seating.find(seatId)?.name ?? "Somebody"} is short of the ante.`;
    return true;
  }

  /**
   * Notes a duel abandoned because one of its two seats went while the antes
   * were being taken.
   *
   * Not a short ante, so it clears that note rather than adding to it: both
   * players covered their stake and both have it back. What the table is
   * waiting for now is the player itself, which `waitingFor` works out on its
   * own — this only says why the felt went quiet.
   */
  noteLeft(name: string): void {
    this.shortId = null;
    this.lastEvent = `${name} left before the duel began.`;
  }

  /**
   * Deals a duel, with the pot already paid for.
   *
   * Never called before the antes are in. The pot it opens with is the two
   * antes, and if that is not true the table has minted chips.
   *
   * @param players The two seats the antes actually came off. Passed in rather
   * than worked out here, because whoever took the antes has already answered
   * "who is in this duel" and asking it twice is two sources of truth for the
   * one question the money rests on — taking an ante is an await, and the
   * table is free to move while it runs.
   */
  begin(first?: string, players?: readonly string[]): void {
    const playing =
      players ?? this.seats.filter((seat) => !seat.waiting).map((seat) => seat.id);
    const [a, b] = playing;
    if (a === undefined || b === undefined) {
      throw new TableError("A duel needs two people.");
    }
    const rolls = first ?? this.nextFirst ?? a;
    this.duel = new Duel(a, b, rolls, this.opening, this.ante, this.passPrice);
    this.startedWith = this.duel.toRoll;
    this.shortId = null;
    this.lastEvent = null;
    this.touchClock();
  }

  /** Clears the felt and puts the table back to waiting for the next duel. */
  finish(): void {
    const done = this.duel;
    if (done !== null && this.startedWith !== null) {
      /*
       * The other one starts the next duel. Taken from who *began* this duel
       * rather than from who lost it: the roller is the underdog, so the turn
       * is worth something, and handing it to the winner would mean a player
       * who keeps winning keeps taking the disadvantage while a first roller
       * who wins simply rolls first again. Alternating is the only version of
       * this that is even over an evening.
       */
      this.nextFirst = done.other(this.startedWith);
    }
    this.startedWith = null;
    this.duel = null;
    this.turnEndsAt = null;
    /*
     * And now anybody who asked to go while it was running. Last, after the
     * felt is clear: the room settles a duel the moment it ends and only
     * clears it some seconds later, so by here the pot has been paid to a seat
     * that was still at the table to be paid.
     */
    for (const seatId of [...this.leaving]) {
      this.drop(seatId);
    }
  }

  /** Puts the clock on whoever is to act now, or takes it away. */
  touchClock(): void {
    this.turnEndsAt =
      this.duel === null || this.duel.over ? null : Date.now() + this.turnMs;
  }

  // ------------------------------------------------------------ play money

  /**
   * This seat's play money.
   *
   * Only meaningful at a for-fun table. Everywhere else a seat's limit is
   * their account, which this class cannot see and has no business seeing.
   */
  purseFor(seatId: string): number {
    if (!this.forFun) {
      return Number.MAX_SAFE_INTEGER;
    }
    const purse = this.purses.get(seatId);
    if (purse === undefined) {
      this.purses.set(seatId, FUN_PURSE);
      return FUN_PURSE;
    }
    return purse;
  }

  /** Moves play money. Positive puts chips back, negative takes them. */
  movePurse(seatId: string, by: number): void {
    this.purses.set(seatId, this.purseFor(seatId) + by);
  }

  /**
   * Fills a purse that cannot cover the next ante.
   *
   * Play money, so running dry should cost somebody a moment rather than their
   * evening — and a for-fun table that stops dealing is one nobody sits at
   * twice. Returns whether it actually had to.
   */
  topUp(seatId: string): boolean {
    if (!this.forFun || this.purseFor(seatId) >= this.ante) {
      return false;
    }
    this.purses.set(seatId, FUN_PURSE);
    return true;
  }

  // ----------------------------------------------------------- the picture

  private seatView(seat: Seat): SeatView {
    return {
      id: seat.id,
      name: seat.name,
      connected: seat.connected,
      waiting: seat.waiting,
      isBot: seat.isBot,
      avatar: seat.avatar,
      accentColor: seat.accentColor,
      passed: this.duel?.hasPassed(seat.id) ?? false,
      purse: this.forFun ? this.purseFor(seat.id) : null,
    };
  }

  view(forSeatId: string | null): TableView {
    const seats = this.seats.map((seat) => this.seatView(seat));
    const duel = this.duel;
    const winner = duel?.winnerId ?? null;
    return {
      code: this.code,
      phase: this.phase,
      seats,
      watching: this.watching,
      forFun: this.forFun,
      maxSeats: this.maxSeats,
      ante: this.ante,
      opening: this.opening,
      passPrice: this.passPrice,
      /*
       * The opening figure between duels rather than nothing, because that is
       * what the next duel will be rolled against and the felt should show the
       * number it is about to come down from.
       */
      ceiling: duel?.ceiling ?? this.opening,
      pot: duel?.pot ?? 0,
      toRoll: duel === null || duel.over ? null : duel.toRoll,
      turnEndsAt: this.turnEndsAt,
      lastRoll: duel?.lastRoll ?? null,
      lastPass: duel?.lastPass ?? null,
      history: duel?.history ?? [],
      loserId: duel?.loserId ?? null,
      winnerIds: winner === null ? [] : [winner],
      waitingFor: this.waitingFor(),
      shortId: this.shortId,
      lastEvent: this.lastEvent,
      you: seats.find((seat) => seat.id === forSeatId) ?? null,
    };
  }

  private waitingFor(): "opponent" | "funds" | null {
    if (this.duel !== null) {
      return null;
    }
    if (this.shortId !== null) {
      return "funds";
    }
    return this.ready ? null : "opponent";
  }
}
