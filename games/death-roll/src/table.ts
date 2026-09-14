import type { BotSkill, PlayTable, Seat, SeatIdentity, TableStatus } from "@backroom/core";
import { Seating, TableError } from "@backroom/core";
import { Game } from "./game.js";
import { COUNTDOWN_MS, FUN_PURSE, passPrice, RESET_CEILING, TURN_MS } from "./listing.js";
import { Readiness } from "./ready.js";
import type { Passed, Rolled } from "./round.js";

/**
 * A death roll table.
 *
 * Two to six seats, a ready button, and one game at a time. What makes it
 * unlike every other table in the building is still that its state change is
 * the money: a game cannot start until the antes are in, and nothing starts one
 * but the table's own clock — so the table asks for a game and the adapter
 * answers, on the next broadcast, once it has taken them.
 */

export type Phase = "waiting" | "playing" | "over";

export interface SeatView {
  id: string;
  name: string;
  connected: boolean;
  /** Sat down while a game was running, and waiting for the next one. */
  waiting: boolean;
  isBot: boolean;
  avatar: string | null;
  accentColor: number | null;
  /** In for the next game. Only meaningful between games. */
  ready: boolean;
  /** Dealt into the game on the felt. */
  inGame: boolean;
  /** Gone out of the game on the felt. */
  out: boolean;
  /** Has spent their pass in the round on the felt. */
  passed: boolean;
  /** Could not cover the ante at the last deal, and sat the game out. */
  short: boolean;
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
  ante: number;
  opening: number;
  passPrice: number;
  /** The number being rolled against; the opening figure between games. */
  ceiling: number;
  pot: number;
  toRoll: string | null;
  turnEndsAt: number | null;
  /** The seat a roll was passed to, while it is still theirs to roll. */
  passedTo: string | null;
  /** Everybody dealt into this game in turn order; between games, everybody seated. */
  order: readonly string[];
  /** Everybody still in, in the round on the felt's turn order. Empty between games. */
  alive: readonly string[];
  /** Which round this is, from one. Zero between games. */
  round: number;
  /** How many rounds this game lasts. Zero between games. */
  rounds: number;
  lastRoll: Rolled | null;
  lastPass: Passed | null;
  /** Every roll of the round on the felt, oldest first. */
  history: readonly Rolled[];
  /** Who went out at the end of the round on the felt, while that is still up. */
  lastOut: string | null;
  winnerIds: readonly string[];
  /** When the countdown deals, between games, if one is running. */
  countdownEndsAt: number | null;
  /** How many seated players are ready, between games. */
  readyCount: number;
  /** Why the table cannot deal at all: fewer than two people sitting at it. */
  waitingFor: "players" | null;
  lastEvent: string | null;
  /** This seat, or null for somebody only watching. */
  you: SeatView | null;
}

export class Table implements PlayTable {
  readonly code: string;
  readonly opening: number;
  readonly ante: number;
  readonly passPrice: number;
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
   * and a deal armed in that window would take a second set of antes. This is
   * how the table says the work has been handed over but is not finished.
   */
  draining = false;

  private readonly seating: Seating;
  private readonly turnMs: number;
  private readonly purses = new Map<string, number>();
  private readonly shorts = new Set<string>();
  /** Players in the game who asked to go while it was running, dropped when it clears. */
  private readonly leaving = new Set<string>();
  /** Seats the table wants dealt, waiting on somebody to take their antes. */
  private wanted: string[] | null = null;
  /** Who opened the last game's first round, so the next game's opener moves on. */
  private lastOpener: string | null = null;

  constructor(
    code: string,
    maxSeats: number,
    options: { opening: number; ante: number; turnMs?: number; countdownMs?: number },
  ) {
    this.code = code;
    this.seating = new Seating(maxSeats);
    this.opening = options.opening;
    this.ante = options.ante;
    this.passPrice = passPrice(options.ante);
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
   * to nobody. So the seat is held, their turns roll on the clock, and it goes
   * when the felt clears.
   */
  readonly leavesMidHand = false;

  private seatIds(): string[] {
    return this.seats.map((seat) => seat.id);
  }

  /**
   * A seat at the table.
   *
   * A chips table insists on knowing who you are; a for-fun one does not. And
   * somebody who sits down while a game is running waits for the next one:
   * dealing them into a game already under way would be dealing them a stake in
   * rounds they never played.
   */
  join(id: string, name: string, identity: SeatIdentity | null): Seat {
    const seat = this.seating.join(id, name, this.status, identity, !this.forFun);
    seat.waiting = this.game !== null;
    this.readiness.sync(this.seatIds(), Date.now());
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
    this.readiness.set(id, true, this.seatIds(), Date.now());
    return seat;
  }

  /**
   * Standing somebody up, or promising to.
   *
   * The room reaps a seat once its player has been gone a minute and a half,
   * whatever the table is doing. A player in the game on the felt is held until
   * it clears, for the reason `leavesMidHand` gives. Anybody else — a player
   * waiting for the next game — has nothing on the felt and goes at once.
   */
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
    this.readiness.drop(seatId, this.seatIds(), Date.now());
  }

  disconnect(seatId: string): void {
    this.seating.disconnect(seatId);
    /*
     * Stood down only between games: mid-game readiness is irrelevant, and
     * `finish()` resets it anyway. A ready button must not keep charging
     * somebody who has gone — left ready, they would still be dealt in and
     * anted by the very next countdown or all-ready deal.
     */
    if (this.game === null) {
      this.readiness.set(seatId, false, this.seatIds(), Date.now());
    }
  }

  reconnect(seatId: string): Seat {
    // Coming back cancels a held removal: a player on a bad line should not be
    // stood up at the end of a game they are still playing.
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
    if (this.game === null) {
      return "waiting";
    }
    return this.game.over ? "over" : "playing";
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
    this.readiness.set(seatId, ready, this.seatIds(), now);
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
    const ready = this.readiness.dealable(this.seatIds(), now);
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
      this.readiness.set(seatId, false, this.seatIds(), Date.now());
    }
    if (seatIds.length > 0) {
      const names = seatIds.map((seatId) => this.seating.find(seatId)?.name ?? "Somebody");
      this.lastEvent = `${names.join(", ")} could not cover the ante.`;
    }
  }

  /**
   * A deal that fell through: everybody's ready is stood down and the felt says
   * why.
   *
   * The table does not try again on its own. There is nothing to spin: the next
   * attempt happens when people press ready again.
   */
  failDeal(reason: string): void {
    this.readiness.clear();
    this.readyBots();
    this.lastEvent = reason;
  }

  private readyBots(): void {
    const seated = this.seatIds();
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
      opening: this.opening,
      passPrice: this.passPrice,
      resetCeiling: RESET_CEILING,
    });
    this.lastOpener = this.game.opener;
    this.readiness.clear();
    this.touchClock();
  }

  /**
   * Who opens the first round: the next player dealt in after whoever opened
   * the last game.
   *
   * The player to act is the underdog, so who opens is worth something, and
   * moving it round the table is the only version of that which is even over an
   * evening.
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

  /** Starts the next round, once the felt has shown who went out. */
  nextRound(): void {
    if (this.game === null || !this.game.betweenRounds) {
      return;
    }
    this.game.nextRound();
    this.lastEvent = null;
    this.touchClock();
  }

  /** Clears the felt and puts the table back to waiting for the next game. */
  finish(): void {
    if (this.game === null) {
      return;
    }
    this.game = null;
    this.turnEndsAt = null;
    this.lastEvent = null;
    this.shorts.clear();
    for (const seat of this.seats) {
      seat.waiting = false;
    }
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

  private seatView(seat: Seat): SeatView {
    const game = this.game;
    const round = game?.round ?? null;
    return {
      id: seat.id,
      name: seat.name,
      connected: seat.connected,
      waiting: seat.waiting,
      isBot: seat.isBot,
      avatar: seat.avatar,
      accentColor: seat.accentColor,
      ready: this.readiness.isReady(seat.id),
      inGame: game?.players.includes(seat.id) ?? false,
      out: game?.out.includes(seat.id) ?? false,
      passed: (round?.order.includes(seat.id) ?? false) && !(round?.holdsPass(seat.id) ?? true),
      short: this.shorts.has(seat.id),
      purse: this.forFun ? this.purseFor(seat.id) : null,
    };
  }

  view(forSeatId: string | null): TableView {
    const seats = this.seats.map((seat) => this.seatView(seat));
    const game = this.game;
    const round = game?.round ?? null;
    const seated = this.seatIds();
    const winner = game?.winnerId ?? null;
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
      ceiling: round?.ceiling ?? this.opening,
      pot: game?.pot ?? 0,
      toRoll: round !== null && !round.over ? round.toRoll : null,
      turnEndsAt: this.turnEndsAt,
      passedTo: round?.passedTo ?? null,
      order: game?.players ?? seated,
      alive: round?.order ?? [],
      round: game?.roundNumber ?? 0,
      rounds: game?.rounds ?? 0,
      lastRoll: round?.lastRoll ?? null,
      lastPass: round?.lastPass ?? null,
      history: round?.history ?? [],
      lastOut: round?.outId ?? null,
      winnerIds: winner === null ? [] : [winner],
      countdownEndsAt: game === null ? this.readiness.countdownEndsAt : null,
      readyCount: game === null ? this.readiness.count(seated) : 0,
      waitingFor: game === null && seated.length < 2 ? "players" : null,
      lastEvent: this.lastEvent,
      you: seats.find((seat) => seat.id === forSeatId) ?? null,
    };
  }
}
