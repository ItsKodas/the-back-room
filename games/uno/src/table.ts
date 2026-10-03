import type { BotSkill, PlayTable, Seat, SeatIdentity, TableStatus } from "@backroom/core";
import { Escrow, Readiness, Seating, TableError } from "@backroom/core";
import type { Card, Color } from "./cards.js";
import { compare } from "./cards.js";
import type { Effect, EnginePhase, RoundResult } from "./engine.js";
import { Game } from "./engine.js";
import { COUNTDOWN_MS, FUN_PURSE, TURN_MS } from "./listing.js";
import type { Badge, Input, Rules } from "./rules.js";
import { rulesetName } from "./rules.js";

/**
 * An Uno table.
 *
 * Liar's Dice's table with a deck instead of cups, on purpose: the awkward
 * parts — a game that cannot start until the antes are in, a seat that cannot
 * be given up mid-game, a ready button that one idle player cannot hold shut —
 * were got right there and are not worth getting wrong again here.
 *
 * What it keeps secret is every hand but yours. The view is built per seat,
 * and an opponent's hand leaves this class as a number and nothing else — not
 * even card ids, which are dealt in deck order and would say what a card is.
 */

export type Phase = "waiting" | "playing" | "between" | "over";

/** How long the clock gives somebody who has gone, so a ghost cannot hold a table. */
export const GONE_MS = 4_000;

export interface SeatView {
  id: string;
  name: string;
  connected: boolean;
  /** Sat down while a game was running, and waiting for the next one. */
  waiting: boolean;
  isBot: boolean;
  signedIn: boolean;
  avatar: string | null;
  accentColor: number | null;
  /** In for the next game. Only meaningful between games. */
  ready: boolean;
  /** Dealt into the game on the felt. */
  inGame: boolean;
  /** Could not cover the ante at the last deal, and sat the game out. */
  short: boolean;
  /** Play money left, at a for-fun table. Null anywhere else. */
  purse: number | null;
  /** Cards in hand, or null while a rule hides the count from you. */
  cards: number | null;
  /** Points so far this game. */
  score: number;
  /** Called UNO and still on one card. */
  uno: boolean;
  /**
   * Their hand face up, once a round is over and only then. Empty otherwise —
   * a hand nobody has finished is a hand nobody sees.
   */
  shown: readonly Card[];
}

export interface YourHand {
  cards: readonly Card[];
  /** Ids you may play now, on your turn. */
  playable: readonly number[];
  /** Ids you may jump in with, out of turn. */
  jumpable: readonly number[];
  /** What each playable card needs chosen before it goes: a colour, a target. */
  needs: Readonly<Record<number, readonly Input[]>>;
  /** The card you just drew, while you may play it or keep it. */
  drawn: number | null;
  canDraw: boolean;
  canPass: boolean;
  canUno: boolean;
}

export interface PeekView {
  seq: number;
  target: string;
  cards: readonly Card[];
}

export interface RoundView {
  round: number;
  winner: string;
  /** By seat id: what was left in each hand, and what it scored. */
  handPoints: Readonly<Record<string, number>>;
  gained: Readonly<Record<string, number>>;
  gameOver: boolean;
  champion: string | null;
}

export interface EffectView {
  seq: number;
  kind: string;
  text: string;
  seat: string | null;
}

export interface TableView {
  code: string;
  phase: Phase;
  /** The engine's own phase while a game is on, for the controls. */
  step: EnginePhase | null;
  seats: readonly SeatView[];
  watching: number;
  forFun: boolean;
  maxSeats: number;
  ante: number;
  pot: number;
  /** The rules the host opened the table with. Fixed for its whole life. */
  rules: Rules;
  /** The preset they match, or "House rules". */
  ruleset: string;
  round: number;
  top: Card | null;
  /** The colour in play, which a Wild sets apart from its own. */
  color: Color | null;
  direction: 1 | -1;
  drawPile: number;
  discardPile: number;
  /** Cards owed by whoever is to act: a Draw Four, or a stack. */
  pending: number;
  toAct: string | null;
  /** Who played the Draw Four being challenged, while it can be. */
  challenger: string | null;
  /** Who can be caught for not calling UNO, if anybody. */
  catchable: string | null;
  badges: readonly Badge[];
  turnEndsAt: number | null;
  /** How long this turn is, so the felt can draw the clock as a fraction. */
  turnMs: number;
  /** Everybody dealt into this game in seat order; between games, everybody seated. */
  order: readonly string[];
  effects: readonly EffectView[];
  lastRound: RoundView | null;
  winnerIds: readonly string[];
  countdownEndsAt: number | null;
  readyCount: number;
  waitingFor: "players" | null;
  lastEvent: string | null;
  eventSeq: number;
  hostId: string | null;
  you: SeatView | null;
  hand: YourHand | null;
  /** What Escape showed you, while this round lasts. */
  peek: PeekView | null;
}

/** A bot's plan for a UNO window, decided once so it is one roll and not one per broadcast. */
interface CatchPlan {
  window: number;
  declare: boolean;
  catcher: number | null;
}

/** A bot's plan for a top card it could jump in on, decided once per card. */
interface JumpPlan {
  topId: number;
  player: number | null;
}

export class Table implements PlayTable {
  readonly code: string;
  readonly ante: number;
  readonly rules: Rules;
  readonly readiness: Readiness;

  forFun = false;
  lastEvent: string | null = null;
  game: Game | null = null;
  /** The seats in the game, by the engine's player index. */
  players: readonly string[] = [];
  turnEndsAt: number | null = null;
  /** Which engine turn the clock is running for. */
  private clockTurn = -1;
  private clockMs: number;
  draining = false;
  readonly escrow = new Escrow();
  catchPlan: CatchPlan | null = null;
  jumpPlan: JumpPlan | null = null;

  private readonly seating: Seating;
  private readonly turnMs: number;
  readonly rng: () => number;
  private readonly purses = new Map<string, number>();
  private readonly shorts = new Set<string>();
  private readonly leaving = new Set<string>();
  private wanted: string[] | null = null;
  private lastDealer: string | null = null;
  private seq = 0;

  constructor(
    code: string,
    maxSeats: number,
    options: {
      ante: number;
      rules: Rules;
      rng: () => number;
      turnMs?: number;
      countdownMs?: number;
    },
  ) {
    this.code = code;
    this.seating = new Seating(maxSeats);
    this.ante = options.ante;
    this.rules = options.rules;
    this.rng = options.rng;
    this.turnMs = options.turnMs ?? TURN_MS;
    this.clockMs = this.turnMs;
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
   * Standing up mid-game is held until the game ends: the ante is in the pot,
   * and a champion whose seat had gone would be a pot paid to nobody. The
   * clock plays the held seat's turns in the meantime, quickly.
   */
  readonly leavesMidHand = false;

  /** Connected seats, which is what readiness is counted against. */
  present(): string[] {
    return this.seats.filter((seat) => seat.connected).map((seat) => seat.id);
  }

  join(id: string, name: string, identity: SeatIdentity | null): Seat {
    const seat = this.seating.join(id, name, this.status, identity, !this.forFun);
    // Arriving mid-game waits for the next one rather than paying a full ante
    // for the end of somebody else's.
    seat.waiting = this.game !== null;
    this.readiness.sync(this.present(), Date.now());
    return seat;
  }

  /**
   * Sits a bot down. Only at a table playing for nothing: a bot has no account
   * to take chips from or pay them to.
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
    if (this.game !== null && this.players.includes(seatId)) {
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
    // Between games only: a ready button must not keep charging somebody who has gone.
    if (this.game === null) {
      this.readiness.set(seatId, false, this.present(), Date.now());
    }
  }

  reconnect(seatId: string): Seat {
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
    const game = this.game;
    if (game === null) {
      return "waiting";
    }
    if (game.over) {
      return "over";
    }
    return game.betweenRounds ? "between" : "playing";
  }

  say(text: string): void {
    this.lastEvent = text;
    this.seq += 1;
  }

  /** The engine's index for a seat in the game, or -1. */
  indexOf(seatId: string): number {
    return this.players.indexOf(seatId);
  }

  seatAt(index: number): string | null {
    return this.players[index] ?? null;
  }

  nameOf(seatId: string | null): string {
    return this.seats.find((seat) => seat.id === seatId)?.name ?? "Somebody";
  }

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

  askForGame(now: number): void {
    if (this.wanted !== null || this.draining || this.game !== null) {
      return;
    }
    const ready = this.readiness.dealable(this.present(), now);
    if (ready !== null) {
      this.wanted = ready;
    }
  }

  takePending(): string[] | null {
    const wanted = this.wanted;
    this.wanted = null;
    if (wanted !== null) {
      this.draining = true;
    }
    return wanted;
  }

  noteShorts(seatIds: readonly string[]): void {
    this.shorts.clear();
    for (const seatId of seatIds) {
      this.shorts.add(seatId);
      this.readiness.set(seatId, false, this.present(), Date.now());
    }
    if (seatIds.length > 0) {
      this.say(`${seatIds.map((seatId) => this.nameOf(seatId)).join(", ")} could not cover the ante.`);
    }
  }

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
   * @param players The seats the antes came off, in seat order. Passed in
   * because whoever took the antes has already answered "who is in this game".
   */
  begin(players: readonly string[]): void {
    if (this.game !== null) {
      throw new TableError("A game is already running.");
    }
    if (players.length < 2) {
      throw new TableError("A game needs two people.");
    }
    this.players = [...players];
    this.game = new Game({
      players: players.map((seatId) => this.nameOf(seatId)),
      rules: this.rules,
      rng: this.rng,
      dealer: this.nextDealer(players),
    });
    this.lastDealer = this.players[this.game.dealer] ?? null;
    this.catchPlan = null;
    this.jumpPlan = null;
    this.readiness.clear();
    this.game.startRound();
    this.say("The cards are dealt.");
    this.touchClock();
  }

  /** The deal moves round the table from game to game, as it does from round to round. */
  private nextDealer(players: readonly string[]): number {
    const seated = this.seats.map((seat) => seat.id);
    const from = this.lastDealer === null ? -1 : seated.indexOf(this.lastDealer);
    if (from !== -1) {
      for (let step = 1; step <= seated.length; step += 1) {
        const at = players.indexOf(seated[(from + step) % seated.length] as string);
        if (at !== -1) {
          return at;
        }
      }
    }
    return Math.floor(this.rng() * players.length);
  }

  /** Deals the next round, once the last one's hands have been read. */
  nextRound(): void {
    if (this.game === null || !this.game.betweenRounds) {
      return;
    }
    this.game.startRound();
    this.catchPlan = null;
    this.jumpPlan = null;
    this.say(`Round ${this.game.round} is dealt.`);
    this.touchClock();
  }

  finish(): void {
    if (this.game === null) {
      return;
    }
    // A backstop: `settle` drains the escrow the moment a game is decided.
    this.escrow.settle();
    this.game = null;
    this.players = [];
    this.turnEndsAt = null;
    this.clockTurn = -1;
    this.lastEvent = null;
    this.shorts.clear();
    this.seating.dealInWaiting();
    this.readiness.clear();
    this.readyBots();
    for (const seatId of [...this.leaving]) {
      this.drop(seatId);
    }
  }

  /** Whether somebody in the game has gone, for now or for good. */
  isGone(seatId: string): boolean {
    if (this.leaving.has(seatId)) {
      return true;
    }
    const seat = this.seats.find((one) => one.id === seatId);
    return seat === undefined || !seat.connected;
  }

  /**
   * Puts the clock on whoever is to act, once per turn.
   *
   * Only a new turn restarts it. Out-of-turn moves — somebody calling UNO, a
   * catch — change the table without changing whose turn it is, and must not
   * hand the player on the clock a fresh twenty seconds.
   */
  touchClock(): void {
    const game = this.game;
    if (game === null || !game.active) {
      this.turnEndsAt = null;
      this.clockTurn = -1;
      return;
    }
    if (game.turn === this.clockTurn && this.turnEndsAt !== null) {
      return;
    }
    this.clockTurn = game.turn;
    const seatId = this.seatAt(game.current);
    this.clockMs =
      game.turnTimeLimit !== null
        ? game.turnTimeLimit * 1000
        : seatId !== null && this.isGone(seatId)
          ? Math.min(GONE_MS, this.turnMs)
          : this.turnMs;
    this.turnEndsAt = Date.now() + this.clockMs;
  }

  // ------------------------------------------------------------ play money

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

  movePurse(seatId: string, by: number): void {
    this.purses.set(seatId, this.purseFor(seatId) + by);
  }

  topUp(seatId: string): boolean {
    if (!this.forFun || this.purseFor(seatId) >= this.ante) {
      return false;
    }
    this.purses.set(seatId, FUN_PURSE);
    return true;
  }

  // ------------------------------------------------------------ the money

  get pot(): number {
    return this.game === null ? 0 : this.ante * this.players.length;
  }

  get championId(): string | null {
    const game = this.game;
    return game === null || !game.over || game.champion === null ? null : this.seatAt(game.champion);
  }

  /** What a seat's chips did this game: the pot less their ante for the champion, the ante for the rest. */
  netFor(seatId: string): number {
    if (!this.players.includes(seatId)) {
      return 0;
    }
    return seatId === this.championId ? this.pot - this.ante : -this.ante;
  }

  get rulesetName(): string {
    return rulesetName(this.rules);
  }

  // ----------------------------------------------------------- the picture

  private seatView(seat: Seat, forSeatId: string | null): SeatView {
    const game = this.game;
    const index = this.indexOf(seat.id);
    const player = (index === -1 ? null : game?.players[index]) ?? null;
    const finished = game?.betweenRounds === true || game?.over === true;
    const hidden = player !== null && seat.id !== forSeatId && game?.isCountHidden(index) === true;
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
      inGame: player !== null,
      short: this.shorts.has(seat.id),
      purse: this.forFun ? this.purseFor(seat.id) : null,
      cards: player === null ? 0 : hidden ? null : player.hand.length,
      score: player?.score ?? 0,
      uno: player?.unoDeclared === true && player.hand.length === 1,
      shown: player !== null && finished ? [...player.hand].sort(compare) : [],
    };
  }

  private handFor(seatId: string | null): YourHand | null {
    const game = this.game;
    const index = seatId === null ? -1 : this.indexOf(seatId);
    if (game === null || index === -1) {
      return null;
    }
    const player = game.players[index];
    if (player === undefined) {
      return null;
    }
    const cards = [...player.hand].sort(compare);
    const mine = game.current === index;
    const playable = mine ? cards.filter((card) => game.canPlay(index, card)) : [];
    const needs: Record<number, readonly Input[]> = {};
    for (const card of playable) {
      needs[card.id] = game.requiredInputs(index, card);
    }
    const jumpable = mine ? [] : cards.filter((card) => game.canJumpIn(index, card));
    for (const card of jumpable) {
      needs[card.id] = game.requiredInputs(index, card);
    }
    return {
      cards,
      playable: playable.map((card) => card.id),
      jumpable: jumpable.map((card) => card.id),
      needs,
      drawn: mine && game.phase === "postDraw" ? game.drawnCardId : null,
      canDraw: game.canDraw(index),
      canPass: game.canPass(index),
      canUno: game.canDeclareUno(index),
    };
  }

  private roundView(result: RoundResult | null): RoundView | null {
    if (result === null) {
      return null;
    }
    const bySeat = (values: number[]) =>
      Object.fromEntries(this.players.map((seatId, i) => [seatId, values[i] ?? 0]));
    return {
      round: result.round,
      winner: this.seatAt(result.winner) ?? "",
      handPoints: bySeat(result.handPoints),
      gained: bySeat(result.gained),
      gameOver: result.gameOver,
      champion: result.champion === null ? null : this.seatAt(result.champion),
    };
  }

  private effectView(effect: Effect): EffectView {
    return {
      seq: effect.seq,
      kind: effect.kind,
      text: effect.text,
      seat: effect.player === null ? null : this.seatAt(effect.player),
    };
  }

  view(forSeatId: string | null): TableView {
    const seats = this.seats.map((seat) => this.seatView(seat, forSeatId));
    const game = this.game;
    const mine = forSeatId === null ? -1 : this.indexOf(forSeatId);
    const peek = game?.peek ?? null;
    const champion = this.championId;
    return {
      code: this.code,
      phase: this.phase,
      step: game?.phase ?? null,
      seats,
      watching: this.watching,
      forFun: this.forFun,
      maxSeats: this.maxSeats,
      ante: this.ante,
      pot: this.pot,
      rules: this.rules,
      ruleset: this.rulesetName,
      round: game?.round ?? 0,
      top: game?.top() ?? null,
      color: game?.currentColor ?? null,
      direction: game?.direction ?? 1,
      drawPile: game?.drawPile.length ?? 0,
      discardPile: game?.discardPile.length ?? 0,
      pending: game?.pendingDraw ?? 0,
      toAct: game?.active ? this.seatAt(game.current) : null,
      challenger: game?.phase === "challenge" && game.wd4 !== null ? this.seatAt(game.wd4.by) : null,
      catchable: game?.unoVulnerable == null ? null : this.seatAt(game.unoVulnerable),
      badges: game?.badges() ?? [],
      turnEndsAt: this.turnEndsAt,
      turnMs: this.clockMs,
      order: game === null ? this.seats.map((seat) => seat.id) : this.players,
      effects: (game?.effects ?? []).map((effect) => this.effectView(effect)),
      lastRound: this.roundView(game?.lastRound ?? null),
      winnerIds: champion === null ? [] : [champion],
      countdownEndsAt: game === null ? this.readiness.countdownEndsAt : null,
      readyCount: game === null ? this.readiness.count(this.present()) : 0,
      waitingFor: game === null && this.present().length < 2 ? "players" : null,
      lastEvent: this.lastEvent,
      eventSeq: this.seq,
      hostId: this.hostId,
      you: seats.find((seat) => seat.id === forSeatId) ?? null,
      hand: this.handFor(forSeatId),
      peek:
        peek !== null && peek.to === mine && game?.active === true
          ? { seq: peek.seq, target: this.seatAt(peek.target) ?? "", cards: [...peek.cards].sort(compare) }
          : null,
    };
  }
}
