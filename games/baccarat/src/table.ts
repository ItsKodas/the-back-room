import {
  Escrow,
  type Seat,
  type SeatIdentity,
  Seating,
  type TableStatus,
  TableError,
  type BotSkill,
} from "@backroom/core";
import { FUN_BANK, FUN_PURSE, MIN_CHIP } from "./bank.js";
import { type Paid, type Placed, settle } from "./bets.js";
import { type Coup, deal, type Outcome } from "./coup.js";
import { schedule } from "./schedule.js";
import { spotAt } from "./spots.js";

/**
 * A baccarat table.
 *
 * The shape that makes it different from the card tables that have turns:
 * nobody has one. Baccarat's own two hands are played out entirely by the
 * fixed rules in `coup.ts` — there is no decision anywhere in the game itself
 * — so once the window shuts, the coup deals itself and there is nothing left
 * to wait on but the reveal. Everybody bets into one window, one shoe answers
 * all of them, and the table has no idea whose turn it is because there is no
 * such thing here. That is the same shape roulette's wheel makes, and this
 * class is that one with a shoe standing in for the wheel: three timed phases
 * going round, betting, dealing, settled.
 */

export type Phase = "betting" | "dealing" | "settled";

/** How long the felt may be open for bets. The host picks one when they open. */
export const WINDOWS = [15_000, 30_000, 60_000] as const;

/**
 * How much of the window takes no more chips, so a late chip is never a race.
 *
 * A ceiling rather than a flat figure — see {@link Table.lastCallMs}. Held to
 * a third of the window, because a last call longer than the window is a table
 * that refuses every bet ever offered to it.
 */
export const LAST_CALL_MS = 5_000;

/** How long a settled coup stays up to be read before the next window opens. */
export const SETTLE_MS = 6_000;

/**
 * How many outcomes the table remembers, for the board beside the shoe.
 *
 * Three times roulette's dozen. A baccarat outcome is one of three letters
 * rather than one of thirty-seven numbers, so a run long enough to read as a
 * pattern takes three times as many of them to fill the same strip.
 */
export const HISTORY = 36;

/**
 * How many wins the table remembers, for the board beside that one.
 *
 * See roulette's own version of this constant for the reasoning: the two
 * boards answer different questions, and a win is a name and a figure rather
 * than two characters, so it wants the last few and nothing older.
 */
export const WINNERS = 6;

/**
 * Somebody being paid, kept after the coup that paid them.
 *
 * The profit rather than what came back, because the stake was already theirs.
 * A hundred returned on a hundred staked is a bet that came in and paid
 * nothing, and a board that called it a win would be a board that lies about
 * the evening.
 *
 * The name is copied rather than looked up when the board is drawn: a seat
 * that won and then left the table still won, and a log that forgets people
 * the moment they stand up is a log of who is here rather than of what
 * happened.
 */
export interface Win {
  /** Which coup this was, so two identical wins are still two entries. */
  coup: number;
  outcome: Outcome;
  seatId: string;
  name: string;
  /** What they finished the coup up by, over and above their stake. */
  up: number;
}

export interface SeatView {
  id: string;
  name: string;
  connected: boolean;
  waiting: boolean;
  isBot: boolean;
  avatar: string | null;
  accentColor: number | null;
  /** What this seat has on the cloth this coup. */
  staked: number;
  /** What the last coup handed them, or nothing if they were not in it. */
  paid: number | null;
  /** Play money left, at a for-fun table. Null anywhere else. */
  purse: number | null;
}

export interface TableView {
  code: string;
  phase: Phase;
  /** When the current phase runs out, absolute. Null when nothing is timing. */
  deadline: number | null;
  lastCall: boolean;
  /** The tableau, once the shoe has answered. */
  coup: Coup | null;
  /**
   * How long the whole reveal takes, from the schedule the coup itself sets.
   *
   * Read by both ends off the one function: the server times the dealing
   * phase from it and a client reconnecting mid-coup subtracts it from
   * `deadline` to find where in the reveal it already is.
   */
  dealMs: number;
  /** Recent outcomes, newest last. */
  history: readonly Outcome[];
  /** Every chip on the cloth, everybody's. */
  placed: readonly Placed[];
  /** What the last coup paid, by seat. */
  paid: readonly { seatId: string; name: string; back: number; staked: number }[];
  /** Who has been paid lately, newest last. */
  winners: readonly Win[];
  /**
   * Whether this seat has a last round to put down again.
   *
   * On the view because only the table knows it, and a button offering to
   * repeat nothing is a button that lies about what it will do.
   */
  canRepeat: boolean;
  /**
   * What the bank holds.
   *
   * For showing only — so a felt can grey out a spot it cannot cover. Every
   * bet is checked again on the way in, because a number a browser has been
   * told is a number a browser can change.
   */
  bank: number;
  seats: readonly SeatView[];
  you: SeatView | null;
  forFun: boolean;
  hostId: string | null;
  watching: number;
  lastEvent: string | null;
  window: number;
}

export class Table {
  readonly code: string;
  private readonly seating: Seating;
  private readonly random: () => number;

  phase: Phase = "betting";
  deadline: number | null = null;
  coup: Coup | null = null;
  placed: Placed[] = [];
  paid: Map<string, Paid> | null = null;
  history: Outcome[] = [];
  winners: Win[] = [];
  /**
   * How many coups this table has actually settled.
   *
   * Only ever counts up, and never restarts: it is what tells two identical
   * wins apart. The same player winning the same amount on the same outcome
   * twice is an ordinary evening, and without this the board would draw one of
   * them.
   */
  private coups = 0;
  /** Last coup's chips, by seat, so "same again" is one press. */
  private previous = new Map<string, Placed[]>();

  /** Every chip on the cloth by the account it came from, until the coup decides it. */
  readonly escrow = new Escrow();

  /**
   * The account behind each seat that has been at this coup, seated or not.
   *
   * A seat that stands up once the coup is being dealt still has chips riding
   * on it, and what the shoe decides is theirs. The name is kept with it so
   * the winners board can still say who won after the seat has gone. Pruned
   * when the cloth is swept, since the coup that owes somebody is the coup
   * they were in.
   */
  private readonly accounts = new Map<string, { userId: string | null; name: string }>();

  /** The account behind a seat, whether or not the seat is still occupied. */
  accountOf(seatId: string): string | null {
    return this.accounts.get(seatId)?.userId ?? null;
  }

  /**
   * Seats that stood up while bets were open, with their chips still down.
   *
   * Whether those chips can come back is the bank's question, not this
   * class's — they may be what covers somebody else's bet — so the adapter
   * answers it on the next broadcast. Cleared once the window shuts, because
   * whatever is still on the cloth by then rides.
   */
  readonly leaving = new Set<string>();

  /**
   * What the store's bank holds, for a table playing for chips.
   *
   * Kept by the adapter, because it is a question for the store and building a
   * view is synchronous. Only ever a display figure — see {@link bank}.
   */
  housed = 0;
  forFun = false;

  /**
   * Play money, for a table playing for nothing.
   *
   * Both of these live here and are gone when the table closes, which is the
   * whole rule about play money: it never touches an account. A signed-in
   * player at a for-fun table is spending these and not their chips, and the
   * adapter reads `forFun` to decide which — getting that branch wrong is how
   * a test table quietly spends somebody's real balance.
   */
  private readonly purses = new Map<string, number>();
  funBank = FUN_BANK;
  window: number = WINDOWS[1];
  lastEvent: string | null = null;

  constructor(
    code: string,
    maxSeats: number,
    options: { random?: () => number; window?: number } = {},
  ) {
    this.code = code;
    this.seating = new Seating(maxSeats);
    this.random = options.random ?? Math.random;
    if (options.window !== undefined) {
      this.window = options.window;
    }
    this.deadline = Date.now() + this.window;
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
   * Standing up mid-coup is honoured there and then.
   *
   * Nothing is kept from a seat that leaves, and the shoe does not need them
   * to finish: chips down while bets are open come back unless another bet is
   * leaning on them, and chips that ride are paid to their account whatever
   * the coup does. Holding the seat would be holding it for nothing.
   */
  readonly leavesMidHand = true;

  /**
   * A seat at the table.
   *
   * A chips table insists on knowing who you are; a for-fun one does not, for
   * the same reason the machine's practice mode does not — nobody signs in to
   * play for nothing.
   */
  join(id: string, name: string, identity: SeatIdentity | null): Seat {
    const seat = this.seating.join(id, name, this.status, identity, !this.forFun);
    this.accounts.set(seat.id, { userId: identity?.userId ?? null, name: seat.name });
    // Back before their chips were handed back, so those chips are theirs to play again.
    this.leaving.delete(seat.id);
    return seat;
  }

  /**
   * A bot, for a table playing for nothing.
   *
   * Chips are only ever won from real people. A bot has no account to charge
   * and none to pay, so a coup won against one at a table paying real chips is
   * chips out of thin air — which is the same reason blackjack's bots refuse a
   * table with real stakes on it.
   */
  addBot(id: string, name: string, skill: BotSkill): Seat {
    if (!this.forFun) {
      throw new TableError("Bots only sit at tables playing for fun.");
    }
    return this.seating.addBot(id, name, skill);
  }

  /**
   * Somebody stands up, and their chips stay behind for the adapter.
   *
   * Filtering them off the cloth was the table keeping them. Every chip went
   * into the bank as it landed, so a seat that left mid-window lost its whole
   * stake for a coup it never saw, and a refresh that outlasted the grace
   * period did the same.
   */
  removeSeat(seatId: string): void {
    this.seating.remove(seatId);
    this.previous.delete(seatId);
    /*
     * Nothing comes off the cloth here, even while bets are open. Handing the
     * chips back is the same movement as a take-back and has to pass the same
     * cover check, which needs the bank, and leaving is synchronous — so the
     * seat is noted and the adapter settles it on the next broadcast. Once the
     * window has shut, whatever is still down rides and is paid to the account.
     */
    if (this.phase === "betting") {
      this.leaving.add(seatId);
    }
  }
  disconnect(seatId: string): void {
    this.seating.disconnect(seatId);
  }
  reconnect(seatId: string): Seat {
    return this.seating.reconnect(seatId);
  }
  watch(socketId: string): void {
    this.seating.watch(socketId);
  }
  unwatch(socketId: string): void {
    this.seating.unwatch(socketId);
  }

  private seatOf(seatId: string): Seat {
    const seat = this.seats.find((one) => one.id === seatId);
    if (seat === undefined) {
      throw new TableError("You are not at this table.");
    }
    return seat;
  }

  // ----------------------------------------------------------- the chips

  /**
   * How long before the window shuts that the table stops taking chips.
   *
   * Never more than a third of the window. Five seconds is right for the
   * windows a host can actually pick, but as a flat figure it silently
   * inverted on any window shorter than itself: the table opened already in
   * last call and refused every bet for the whole of it.
   */
  get lastCallMs(): number {
    return Math.min(LAST_CALL_MS, Math.floor(this.window / 3));
  }

  /** Whether the window is close enough to shutting to stop taking chips. */
  get lastCall(): boolean {
    if (this.phase !== "betting" || this.deadline === null) {
      return false;
    }
    return this.deadline - Date.now() <= this.lastCallMs;
  }

  /** What one seat has on one spot. */
  onSpot(seatId: string, spotId: string): number {
    return this.placed.find((one) => one.seatId === seatId && one.spotId === spotId)?.chips ?? 0;
  }

  /**
   * What the bank can be measured against, not counting this coup's chips.
   *
   * A getter rather than a number somebody remembers to set. A for-fun table's
   * bank lives here and is exact the instant the table exists; a chips table's
   * is whatever the adapter last read from the store. Both then have the
   * cloth's own chips taken back off, because chips go into the bank as they
   * land and a cloth that counted them would be vouching for itself.
   *
   * For showing only. It lets a felt grey out a spot the bank cannot cover
   * rather than letting somebody find the cap by being refused — and every bet
   * is checked again on the way in, because a number a browser has been told
   * is a number a browser can change.
   */
  get bank(): number {
    const held = this.forFun ? this.funBank : this.housed;
    return Math.max(0, held - this.onCloth);
  }

  /** Everything on the cloth this coup, everybody's. */
  get onCloth(): number {
    return this.placed.reduce((sum, one) => sum + one.chips, 0);
  }

  /** What one seat has on the cloth altogether. */
  staked(seatId: string): number {
    return this.placed
      .filter((one) => one.seatId === seatId)
      .reduce((sum, one) => sum + one.chips, 0);
  }

  /** How many separate piles this seat has down, which is what paces the bots. */
  pilesFor(seatId: string): number {
    return this.placed.filter((one) => one.seatId === seatId).length;
  }

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

  /** What this seat had on the cloth last coup, so it can be put down again. */
  lastRound(seatId: string): readonly Placed[] {
    return this.previous.get(seatId) ?? [];
  }

  /**
   * Everything this table would refuse a chip for, without moving anything.
   *
   * Separate from {@link place} so the adapter can find out whether a bet is
   * allowed *before* it takes anybody's money. Placing first and unwinding
   * afterwards looks equivalent and is not: a chip landing on a spot the seat
   * already has chips on merges into that pile, so undoing it takes the whole
   * pile back rather than the chip that was just added.
   *
   * The bank is not consulted here — the adapter does that, because what the
   * bank holds is a question for the store and this class is deliberately
   * synchronous. What is checked here is everything true of the table alone.
   */
  check(seatId: string, spotId: string, chips: number): void {
    if (this.phase !== "betting") {
      throw new TableError("The coup is already being dealt.");
    }
    if (this.lastCall) {
      throw new TableError("No more bets.");
    }
    this.seatOf(seatId);
    if (spotAt(spotId) === null) {
      throw new TableError("There is no such bet on this table.");
    }
    if (!Number.isInteger(chips) || chips < MIN_CHIP) {
      throw new TableError(`The smallest chip here is ${MIN_CHIP}.`);
    }
  }

  /** A chip down. Refuses exactly what {@link check} refuses. */
  place(seatId: string, spotId: string, chips: number): void {
    this.check(seatId, spotId, chips);
    // Bots only place at for-fun tables, so they never reach the hold.
    const userId = this.seats.find((seat) => seat.id === seatId)?.userId ?? null;
    if (!this.forFun && userId !== null && !this.escrow.hold(userId, chips)) {
      throw new TableError("This table is closing.");
    }
    const already = this.placed.find((one) => one.seatId === seatId && one.spotId === spotId);
    if (already === undefined) {
      this.placed.push({ seatId, spotId, chips });
    } else {
      this.placed = this.placed.map((one) =>
        one === already ? { ...one, chips: one.chips + chips } : one,
      );
    }
  }

  /**
   * Chips off one spot, back to the seat that put them there.
   *
   * Per seat and not per spot, which is the whole reason this takes a seat id
   * at all: two people back the player every coup, and a control that took
   * "the chips on player" would let either of them pocket the other's.
   *
   * Returns what actually came off, because that is the number the adapter has
   * to pay back — asking for more than the pile holds takes the pile rather
   * than opening a debt.
   */
  take(seatId: string, spotId: string, chips: number): number {
    if (this.phase !== "betting") {
      throw new TableError("The coup is already being dealt.");
    }
    const pile = this.placed.find((one) => one.seatId === seatId && one.spotId === spotId);
    if (pile === undefined) {
      return 0;
    }
    const off = Math.min(pile.chips, Math.max(0, Math.floor(chips)));
    if (off === 0) {
      return 0;
    }
    this.placed =
      pile.chips === off
        ? this.placed.filter((one) => one !== pile)
        : this.placed.map((one) => (one === pile ? { ...one, chips: one.chips - off } : one));
    return off;
  }

  /** The last chip this seat put down, taken back. */
  undo(seatId: string): void {
    if (this.phase !== "betting") {
      throw new TableError("The coup is already being dealt.");
    }
    for (let at = this.placed.length - 1; at >= 0; at -= 1) {
      if (this.placed[at]?.seatId === seatId) {
        this.placed.splice(at, 1);
        return;
      }
    }
  }

  /** Every chip this seat has down, taken back. */
  clear(seatId: string): void {
    if (this.phase !== "betting") {
      throw new TableError("The coup is already being dealt.");
    }
    this.placed = this.placed.filter((one) => one.seatId !== seatId);
  }

  // ---------------------------------------------------------- the phases

  /**
   * The window shuts and the shoe answers.
   *
   * A cloth with nothing on it does not deal. A stream of results nobody bet
   * on is noise, and it would walk the history board along until the last
   * real coup had scrolled off it. The felt is left exactly as it is and a
   * fresh window opens — which is also what CLAUDE.md means by a table that
   * holds with the felt untouched.
   */
  closeBetting(): void {
    if (this.phase !== "betting") {
      return;
    }
    // Anybody who left and has not been handed their chips yet is too late: they ride.
    this.leaving.clear();
    if (this.placed.length === 0) {
      this.deadline = Date.now() + this.window;
      return;
    }
    this.coup = deal(this.random);
    this.phase = "dealing";
    // The reveal sets its own length; the table is only along for it.
    this.deadline = Date.now() + schedule(this.coup).total;
    this.lastEvent = "No more bets.";
  }

  /** The shoe is read, and the cloth is settled. */
  land(): void {
    if (this.phase !== "dealing" || this.coup === null) {
      return;
    }
    // The coup has landed, so the cloth now belongs to its result, not to the
    // accounts that put it there — a void from here on has nothing to hand back.
    this.escrow.settle();
    const outcome = this.coup.outcome;
    this.paid = settle(this.placed, outcome);
    this.history = [...this.history, outcome].slice(-HISTORY);

    /*
     * Who came out ahead, and only them.
     *
     * A seat that got its stake back and nothing else is not on this board.
     * Every bet on the cloth pays the stake back with it, so "was handed
     * something" is true of half the table on most coups and means nothing —
     * finishing up is the thing a person would tell somebody about.
     */
    this.coups += 1;
    const coupNumber = this.coups;
    for (const [seatId, one] of this.paid) {
      const up = one.back - one.staked;
      if (up <= 0) {
        continue;
      }
      this.winners.push({
        coup: coupNumber,
        outcome,
        seatId,
        name: this.accounts.get(seatId)?.name ?? "",
        up,
      });
    }
    /*
     * A rolling log, and it may well cut a coup in half at the front. That is
     * what a board of the last few is: the alternative is a board whose length
     * is however many people a full table happened to pay, which is a board
     * that jumps about.
     */
    this.winners = this.winners.slice(-WINNERS);

    this.previous = new Map();
    for (const one of this.placed) {
      this.previous.set(one.seatId, [...(this.previous.get(one.seatId) ?? []), { ...one }]);
    }

    this.phase = "settled";
    this.deadline = Date.now() + SETTLE_MS;
    this.lastEvent = outcome;
  }

  /** The cloth is swept and the next window opens. */
  beginBetting(): void {
    this.placed = [];
    this.leaving.clear();
    this.paid = null;
    this.coup = null;
    this.phase = "betting";
    this.deadline = Date.now() + this.window;
    for (const seat of this.seating.seats) {
      seat.waiting = false;
    }
    const here = new Set(this.seats.map((seat) => seat.id));
    for (const seatId of [...this.accounts.keys()]) {
      if (!here.has(seatId)) {
        this.accounts.delete(seatId);
      }
    }
  }

  // ------------------------------------------------------------ the view

  private seatView(seat: Seat): SeatView {
    return {
      id: seat.id,
      name: seat.name,
      connected: seat.connected,
      waiting: seat.waiting,
      isBot: seat.isBot,
      avatar: seat.avatar,
      accentColor: seat.accentColor,
      staked: this.staked(seat.id),
      paid: this.paid?.get(seat.id)?.back ?? null,
      purse: this.forFun ? this.purseFor(seat.id) : null,
    };
  }

  view(forSeatId: string | null): TableView {
    const seats = this.seats.map((seat) => this.seatView(seat));
    const paid = this.paid ?? new Map<string, Paid>();
    return {
      code: this.code,
      phase: this.phase,
      deadline: this.deadline,
      lastCall: this.lastCall,
      coup: this.coup,
      dealMs: this.coup === null ? 0 : schedule(this.coup).total,
      history: this.history,
      winners: this.winners,
      placed: this.placed,
      paid: [...paid.entries()].map(([seatId, one]) => ({
        seatId,
        name: this.seats.find((seat) => seat.id === seatId)?.name ?? "",
        back: one.back,
        staked: one.staked,
      })),
      bank: this.bank,
      canRepeat: forSeatId !== null && this.lastRound(forSeatId).length > 0,
      seats,
      you: seats.find((seat) => seat.id === forSeatId) ?? null,
      forFun: this.forFun,
      hostId: this.hostId,
      watching: this.watching,
      lastEvent: this.lastEvent,
      window: this.window,
    };
  }
}
