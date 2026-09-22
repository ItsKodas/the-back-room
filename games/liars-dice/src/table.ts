import type { BotSkill, PlayTable, Seat, SeatIdentity, TableStatus } from "@backroom/core";
import { Escrow, Readiness, Seating, TableError } from "@backroom/core";
import type { Bid, Face } from "./bid.js";
import type { BoardRow } from "./game.js";
import { Game } from "./game.js";
import { COUNTDOWN_MS, FUN_PURSE, TURN_MS } from "./listing.js";
import type { Resolution } from "./round.js";

/**
 * A Liar's Dice table.
 *
 * Two to ten seats, a ready button, and one game at a time. It is Death Roll's
 * table with dice instead of a ceiling, on purpose: the awkward parts — a game
 * that cannot start until the antes are in, a seat that cannot be given up
 * mid-game, a ready that must stand down when somebody drops — were got right
 * there and are not worth getting wrong again here.
 *
 * What is new is that this table keeps a secret. Every other table in the
 * building can be described once and sent to everybody; this one is built per
 * seat, because your dice are yours.
 */

export type Phase = "waiting" | "playing" | "over";

/**
 * A resolution as the felt sees it.
 *
 * Without the hands: they are already on the seats, where the client draws
 * them, and sending them twice would be two places for them to disagree.
 */
export type ResolutionView = Omit<Resolution, "hands">;

export interface SeatView {
  id: string;
  name: string;
  connected: boolean;
  /** Sat down while a game was running, and waiting for the next one. */
  waiting: boolean;
  isBot: boolean;
  /**
   * Playing from a profile rather than as a guest.
   *
   * A taunt is staked in real chips, so it can only be thrown at somebody
   * with an account for them to reach — Greed's seat view has said this
   * since it had one, and blackjack's after it.
   */
  signedIn: boolean;
  avatar: string | null;
  accentColor: number | null;
  /** In for the next game. Only meaningful between games. */
  ready: boolean;
  /** Dealt into the game on the felt. */
  inGame: boolean;
  /** Dealt in, and now on no dice at all. */
  out: boolean;
  /** Could not cover the ante at the last deal, and sat the game out. */
  short: boolean;
  /** Play money left, at a for-fun table. Null anywhere else. */
  purse: number | null;
  /** How many dice are still in front of them. */
  dice: number;
  /**
   * Their faces — but only ever yours, or everybody's once a round is revealed.
   *
   * A face-down die is `null` rather than a missing entry, so the felt can draw
   * the right number of cups without being told what is under them. Empty
   * between games, when nothing has been dealt at all; between rounds, mid-game,
   * it is the opposite — the just-revealed hand, real faces, for everybody to
   * read until the next deal. In that window it can hold more dice than `dice`
   * says: whoever just lost one already shows the lower count, but the hand is
   * still the one they were judged on, and the two numbers answer different
   * questions.
   */
  hand: readonly (Face | null)[];
}

export interface TableView {
  code: string;
  phase: Phase;
  seats: readonly SeatView[];
  watching: number;
  forFun: boolean;
  maxSeats: number;
  ante: number;
  /** How many dice the table deals each, which the host chose. */
  startingDice: number;
  pot: number;
  /** Dice on the table, which is the ceiling on any bid. Zero between games. */
  total: number;
  bid: Bid | null;
  bidder: string | null;
  toAct: string | null;
  turnEndsAt: number | null;
  /** How long a turn is, so the felt can draw the clock as a fraction. */
  turnMs: number;
  /** Everybody dealt into this game in seat order; between games, everybody seated. */
  order: readonly string[];
  /** Everybody still holding dice, in the round's turn order. Empty between games. */
  live: readonly string[];
  /** Which round this is, from one. Zero between games. */
  round: number;
  /** The round just decided, while its reveal is still on the felt. */
  resolution: ResolutionView | null;
  /** The last few rounds, oldest first. The table's own record of results. */
  board: readonly BoardRow[];
  winnerIds: readonly string[];
  /** When the countdown deals, between games, if one is running. */
  countdownEndsAt: number | null;
  /** How many seated players are ready, between games. */
  readyCount: number;
  /** Why the table cannot deal at all: fewer than two people sitting at it. */
  waitingFor: "players" | null;
  lastEvent: string | null;
  /**
   * Moves on with every action the table reports.
   *
   * Nothing else in this view counts turns, and the activity log needs
   * something to tell the same sentence twice running apart from one broadcast
   * sent twice.
   */
  eventSeq: number;
  /** Whose table it is, so the controls that are theirs are offered to them. */
  hostId: string | null;
  /** This seat, or null for somebody only watching. */
  you: SeatView | null;
}

export class Table implements PlayTable {
  readonly code: string;
  readonly ante: number;
  readonly startingDice: number;
  readonly readiness: Readiness;

  forFun = false;
  lastEvent: string | null = null;
  game: Game | null = null;
  turnEndsAt: number | null = null;
  /**
   * Whether somebody is taking the antes right now.
   *
   * Draining the queue stops one request being answered twice, but for the
   * whole of the taking — real writes to a real store — the table looks idle,
   * and a deal armed in that window would take a second set of antes.
   */
  draining = false;
  /** The antes of the game on the felt, by account. Play money never comes here. */
  readonly escrow = new Escrow();

  private readonly seating: Seating;
  private readonly turnMs: number;
  private readonly roll: () => Face;
  private readonly purses = new Map<string, number>();
  private readonly shorts = new Set<string>();
  /** Players in the game who asked to go while it was running, dropped when it clears. */
  private readonly leaving = new Set<string>();
  /** Seats the table wants dealt, waiting on somebody to take their antes. */
  private wanted: string[] | null = null;
  /** Who opened the last game, so the next game's opener moves on. */
  private lastOpener: string | null = null;
  private seq = 0;

  constructor(
    code: string,
    maxSeats: number,
    options: {
      ante: number;
      dice: number;
      roll: () => Face;
      turnMs?: number;
      countdownMs?: number;
    },
  ) {
    this.code = code;
    this.seating = new Seating(maxSeats);
    this.ante = options.ante;
    this.startingDice = options.dice;
    this.roll = options.roll;
    this.turnMs = options.turnMs ?? TURN_MS;
    this.readiness = new Readiness(options.countdownMs ?? COUNTDOWN_MS);
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
   * Standing up mid-game cannot be honoured there and then, for a player in it.
   *
   * Their ante is in the pot and the game has to play out and settle before
   * anybody can be paid — and a winner whose seat had gone would be a pot paid
   * to nobody. So the seat is held, the clock bids for their turns, and it goes
   * when the felt clears.
   */
  readonly leavesMidHand = false;

  private seatIds(): string[] {
    return this.seats.map((seat) => seat.id);
  }

  /**
   * The seats readiness is counted against: everybody seated who is still
   * connected. Leave only disconnects here, and a held seat that still counted
   * would keep "everybody ready" from ever being true.
   */
  present(): string[] {
    return this.seats.filter((seat) => seat.connected).map((seat) => seat.id);
  }

  join(id: string, name: string, identity: SeatIdentity | null): Seat {
    const seat = this.seating.join(id, name, this.status, identity, !this.forFun);
    // Somebody who arrives mid-game waits for the next one: dealing them in
    // would be a full ante for a fraction of a game.
    seat.waiting = this.game !== null;
    this.readiness.sync(this.present(), Date.now());
    return seat;
  }

  /**
   * Sits a bot down.
   *
   * Only at a table playing for nothing: a bot has no account to take chips
   * from or pay them to, so a game won against one at a chips table would be
   * chips out of thin air. And always ready — nobody is going to press the
   * button for it.
   */
  addBot(id: string, name: string, skill: BotSkill): Seat {
    if (!this.forFun) {
      throw new TableError("Bots only sit at tables playing for fun.");
    }
    const seat = this.seating.addBot(id, name, skill);
    seat.waiting = this.game !== null;
    this.readiness.set(id, true, this.present(), Date.now());
    return seat;
  }

  removeSeat(seatId: string): void {
    if (this.game?.players.includes(seatId)) {
      this.leaving.add(seatId);
      return;
    }
    this.drop(seatId);
  }

  private drop(seatId: string): void {
    this.leaving.delete(seatId);
    this.seating.remove(seatId);
    this.purses.delete(seatId);
    this.shorts.delete(seatId);
    this.readiness.drop(seatId, this.present(), Date.now());
  }

  disconnect(seatId: string): void {
    this.seating.disconnect(seatId);
    /*
     * Stood down only between games. A ready button must not keep charging
     * somebody who has gone — left ready, they would still be dealt in and
     * anted by the very next countdown.
     */
    if (this.game === null) {
      this.readiness.set(seatId, false, this.present(), Date.now());
    }
  }

  reconnect(seatId: string): Seat {
    // Coming back cancels a held removal: a player on a bad line should not be
    // stood up at the end of a game they are still playing.
    this.leaving.delete(seatId);
    const seat = this.seating.reconnect(seatId);
    if (this.game === null) {
      this.readiness.sync(this.present(), Date.now());
    }
    return seat;
  }

  watch(socketId: string): void {
    this.seating.watch(socketId);
  }

  unwatch(socketId: string): void {
    this.seating.unwatch(socketId);
  }

  // ------------------------------------------------------------- the game

  get phase(): Phase {
    if (this.game === null) {
      return "waiting";
    }
    return this.game.over ? "over" : "playing";
  }

  /** Something the table did, for the activity log. Counted as well as said. */
  say(text: string): void {
    this.lastEvent = text;
    this.seq += 1;
  }

  /**
   * A player saying they are in for the next game, or no longer.
   *
   * Only between games. Pressing it moves no chips: antes go on at the deal and
   * at no other moment, so a table waiting with people ready is still a table
   * holding nobody's stake.
   */
  setReady(seatId: string, ready: boolean, now: number): void {
    const seat = this.seating.find(seatId);
    if (seat === undefined) {
      throw new TableError("You are not at this table.");
    }
    if (this.game !== null) {
      throw new TableError("You can get ready once this game is over.");
    }
    if (seat.isBot) {
      return;
    }
    this.readiness.set(seatId, ready, this.present(), now);
  }

  get pending(): boolean {
    return this.wanted !== null;
  }

  /**
   * Asks for a game, without starting one.
   *
   * Taking an ante is asynchronous and this is called from a timer, which is
   * not — so the table records who it wants dealt and the adapter takes their
   * antes on the next broadcast.
   */
  askForGame(now: number): void {
    if (this.wanted !== null || this.draining || this.game !== null) {
      return;
    }
    const ready = this.readiness.dealable(this.present(), now);
    if (ready !== null) {
      this.wanted = ready;
    }
  }

  /** Takes the request off the queue, before the adapter's first await. */
  takePending(): string[] | null {
    const wanted = this.wanted;
    this.wanted = null;
    if (wanted !== null) {
      this.draining = true;
    }
    return wanted;
  }

  /**
   * Notes who could not cover the ante, and stands their ready down.
   *
   * They sit this game out, and they are the only ones who do: a player who
   * cannot pay no longer stops a table full of people who can.
   */
  noteShorts(seatIds: readonly string[]): void {
    this.shorts.clear();
    for (const seatId of seatIds) {
      this.shorts.add(seatId);
      this.readiness.set(seatId, false, this.present(), Date.now());
    }
    if (seatIds.length > 0) {
      const names = seatIds.map((seatId) => this.seating.find(seatId)?.name ?? "Somebody");
      this.say(`${names.join(", ")} could not cover the ante.`);
    }
  }

  /**
   * A deal that fell through: everybody's ready is stood down and the felt says
   * why. The table does not try again on its own — the next attempt happens
   * when people press ready again.
   */
  failDeal(reason: string): void {
    this.readiness.clear();
    this.readyBots();
    this.say(reason);
  }

  private readyBots(): void {
    const seated = this.present();
    for (const seat of this.seats) {
      if (seat.isBot) {
        this.readiness.set(seat.id, true, seated, Date.now());
      }
    }
  }

  /**
   * Deals a game, with every ante already in.
   *
   * @param players The seats the antes actually came off, in seat order. Passed
   * in rather than worked out here, because whoever took the antes has already
   * answered "who is in this game" and the money rests on that one answer.
   */
  begin(players: readonly string[]): void {
    if (this.game !== null) {
      throw new TableError("A game is already running.");
    }
    if (players.length < 2) {
      throw new TableError("A game needs two people.");
    }
    this.game = new Game(players, this.nextOpener(players), {
      ante: this.ante,
      dice: this.startingDice,
      roll: this.roll,
    });
    this.lastOpener = this.game.round.toAct;
    this.readiness.clear();
    this.say("The cups are down.");
    this.touchClock();
  }

  /**
   * Who opens the first round: the next player dealt in after whoever opened
   * the last game.
   *
   * The player to act first has the least to go on, so who opens is worth
   * something, and moving it round the table is the only version of that which
   * is even over an evening.
   */
  private nextOpener(players: readonly string[]): string {
    const seated = this.seatIds();
    const from = this.lastOpener === null ? -1 : seated.indexOf(this.lastOpener);
    if (from !== -1) {
      for (let step = 1; step <= seated.length; step += 1) {
        const seatId = seated[(from + step) % seated.length] as string;
        if (players.includes(seatId)) {
          return seatId;
        }
      }
    }
    return players[0] as string;
  }

  /** Starts the next round, once the reveal has had its time on the felt. */
  nextRound(): void {
    if (this.game === null || !this.game.betweenRounds) {
      return;
    }
    this.game.nextRound();
    this.say("The cups are down.");
    this.touchClock();
  }

  /** Clears the felt and puts the table back to waiting for the next game. */
  finish(): void {
    if (this.game === null) {
      return;
    }
    /*
     * A backstop, not the usual route: `settle` drains the escrow the moment a
     * game is decided. A game cleared without being settled — a winner whose
     * seat had gone — has lost its pot, so this hands back nothing rather than
     * refunding chips a result already decided.
     */
    this.escrow.settle();
    this.game = null;
    this.turnEndsAt = null;
    this.lastEvent = null;
    this.shorts.clear();
    this.seating.dealInWaiting();
    this.readiness.clear();
    this.readyBots();
    /*
     * Anybody who asked to go during the game, last: the room settles a game
     * the moment it ends and only clears it some seconds later, so by here the
     * pot has been paid to a seat that was still there to be paid.
     */
    for (const seatId of [...this.leaving]) {
      this.drop(seatId);
    }
  }

  /** Puts the clock on whoever is to act, or takes it away. */
  touchClock(): void {
    const game = this.game;
    this.turnEndsAt =
      game === null || game.over || game.round.over ? null : Date.now() + this.turnMs;
  }

  // ------------------------------------------------------------ play money

  /**
   * This seat's play money. Only meaningful at a for-fun table; everywhere else
   * a seat's limit is their account, which this class has no business seeing.
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

  /** Fills a play purse that cannot cover the next ante. Returns whether it had to. */
  topUp(seatId: string): boolean {
    if (!this.forFun || this.purseFor(seatId) >= this.ante) {
      return false;
    }
    this.purses.set(seatId, FUN_PURSE);
    return true;
  }

  // ----------------------------------------------------------- the picture

  private seatView(seat: Seat, forSeatId: string | null): SeatView {
    const game = this.game;
    const round = game?.round ?? null;
    const hand = round?.handFor(seat.id) ?? null;
    /*
     * The whole reason a view is per-seat. Your own dice, and anybody else's
     * only once the round has been called — a hand nobody paid to see is a hand
     * nobody sees, watchers included.
     */
    const revealed = round?.over ?? false;
    const shown: readonly (Face | null)[] =
      hand === null ? [] : seat.id === forSeatId || revealed ? hand : hand.map(() => null);
    return {
      id: seat.id,
      name: seat.name,
      connected: seat.connected,
      waiting: seat.waiting,
      isBot: seat.isBot,
      signedIn: seat.userId !== null,
      avatar: seat.avatar,
      accentColor: seat.accentColor,
      ready: this.readiness.isReady(seat.id),
      inGame: game?.players.includes(seat.id) ?? false,
      out: game?.out.includes(seat.id) ?? false,
      short: this.shorts.has(seat.id),
      purse: this.forFun ? this.purseFor(seat.id) : null,
      dice: game?.diceFor(seat.id) ?? 0,
      hand: shown,
    };
  }

  view(forSeatId: string | null): TableView {
    const seats = this.seats.map((seat) => this.seatView(seat, forSeatId));
    const game = this.game;
    const round = game?.round ?? null;
    const winner = game?.winnerId ?? null;
    const resolution = round?.resolution ?? null;
    return {
      code: this.code,
      phase: this.phase,
      seats,
      watching: this.watching,
      forFun: this.forFun,
      maxSeats: this.maxSeats,
      ante: this.ante,
      startingDice: this.startingDice,
      pot: game?.pot ?? 0,
      total: round?.total ?? 0,
      bid: round?.bid ?? null,
      bidder: round?.bidder ?? null,
      toAct: round !== null && !round.over ? round.toAct : null,
      turnEndsAt: this.turnEndsAt,
      turnMs: this.turnMs,
      order: game?.players ?? this.seatIds(),
      live: round?.order ?? [],
      round: game?.roundNumber ?? 0,
      resolution:
        resolution === null
          ? null
          : {
              call: resolution.call,
              caller: resolution.caller,
              bid: resolution.bid,
              bidder: resolution.bidder,
              count: resolution.count,
              right: resolution.right,
              losers: resolution.losers,
            },
      board: game?.board ?? [],
      winnerIds: winner === null ? [] : [winner],
      countdownEndsAt: game === null ? this.readiness.countdownEndsAt : null,
      readyCount: game === null ? this.readiness.count(this.present()) : 0,
      // Counted the way ready is: a held leaver cannot be dealt, so a table
      // down to one connected player is waiting, not "1 of 1 ready".
      waitingFor: game === null && this.present().length < 2 ? "players" : null,
      lastEvent: this.lastEvent,
      eventSeq: this.seq,
      hostId: this.hostId,
      you: seats.find((seat) => seat.id === forSeatId) ?? null,
    };
  }
}
