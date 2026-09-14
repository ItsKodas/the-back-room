import {
  Escrow,
  type Seat,
  type SeatIdentity,
  Seating,
  type TableStatus,
  TableError,
} from "@backroom/core";
import { FUN_BANK, FUN_PURSE, MIN_CHIP } from "./bank.js";
import { type Paid, type Placed, settle } from "./bets.js";
import { spotAt } from "./spots.js";
import { spin } from "./wheel.js";

/**
 * A roulette table.
 *
 * The shape that makes it different from the card tables: nobody has a turn.
 * Everybody puts chips down at once inside one window, one wheel answers all
 * of them, and the table has no idea whose decision it is waiting for because
 * it is not waiting for anybody's. That removes turns, the turn clock and the
 * skipped-and-folded machinery wholesale, and leaves a table that is really
 * three timed phases going round.
 */

export type Phase = "betting" | "spinning" | "settled";

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

/**
 * How long the ball is in the air.
 *
 * Long enough to be worth watching and short enough to sit through, which is a
 * narrower window than it sounds. Six seconds felt like a ball fighting its way
 * to a stop, but that turned out to be the deceleration curve rather than the
 * length — with a curve that coasts, eleven was simply a long wait between
 * bets. This is what is left after both: long enough that the wheel can wind
 * down on its own rather than being finished with by a deadline.
 */
export const SPIN_MS = 8_500;

/** How long a finished spin stays up to be read. */
export const SETTLE_MS = 6_000;

/** How many results the table remembers, for the board beside the wheel. */
export const HISTORY = 12;

/**
 * How many wins the table remembers, for the board beside that one.
 *
 * Shorter than the number board, and not for want of room. A number is two
 * characters and a win is a name and a figure, so a dozen of them is a wall of
 * text next to a strip of numbers — and the two boards answer different
 * questions. The numbers are what the wheel has been doing, which wants a run
 * long enough to look at; the wins are who has been getting paid, which wants
 * the last few and nothing older.
 */
export const WINNERS = 6;

/**
 * Somebody being paid, kept after the spin that paid them.
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
  /** Which spin this was, so two identical wins are still two entries. */
  spin: number;
  pocket: number;
  seatId: string;
  name: string;
  /** What they finished the spin up by, over and above their stake. */
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
  /** What this seat has on the cloth this spin. */
  staked: number;
  /** What the last spin handed them, or nothing if they were not in it. */
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
  /** Where the ball went, once it has been decided. */
  pocket: number | null;
  /** Recent pockets, newest last. */
  history: readonly number[];
  /** Every chip on the cloth, everybody's. */
  placed: readonly Placed[];
  /** What the last spin paid, by seat. */
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
  private readonly pick: (pockets: number) => number;

  phase: Phase = "betting";
  deadline: number | null = null;
  pocket: number | null = null;
  placed: Placed[] = [];
  paid: Map<string, Paid> | null = null;
  history: number[] = [];
  winners: Win[] = [];
  /**
   * How many spins this table has actually settled.
   *
   * Only ever counts up, and never restarts: it is what tells two identical
   * wins apart. The same player winning the same amount on the same number
   * twice is an ordinary evening, and without this the board would draw one of
   * them.
   */
  private spins = 0;
  /** Last spin's chips, by seat, so "same again" is one press. */
  private previous = new Map<string, Placed[]>();

  /** Every chip on the cloth by the account it came from, until the ball decides it. */
  readonly escrow = new Escrow();

  /**
   * The account behind each seat that has been at this spin, seated or not.
   *
   * A seat that stands up once the ball is in still has chips riding on it,
   * and what the wheel decides is theirs. Pruned when the cloth is swept, since
   * the spin that owes somebody is the spin they were in.
   */
  private readonly accounts = new Map<string, string | null>();

  accountOf(seatId: string): string | null {
    return this.accounts.get(seatId) ?? null;
  }

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
    options: { pick?: (pockets: number) => number; window?: number } = {},
  ) {
    this.code = code;
    this.seating = new Seating(maxSeats);
    this.pick = options.pick ?? ((pockets) => Math.floor(Math.random() * pockets));
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
   * Standing up mid-spin is honoured there and then.
   *
   * Nothing is kept from a seat that leaves, and the wheel does not need them
   * to finish: chips down while bets are open come back, and chips riding once
   * the window has shut are paid to their account whatever the ball does.
   * Holding the seat would be holding it for nothing.
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
    this.accounts.set(seat.id, identity?.userId ?? null);
    return seat;
  }
  removeSeat(seatId: string): void {
    const userId = this.accountOf(seatId);
    this.seating.remove(seatId);
    this.previous.delete(seatId);
    /*
     * While bets are open their chips are still theirs to take back, so they
     * go back. Once the window has shut the chips ride: the ball is in, and
     * what it decides is paid to their account whether they watch or not.
     */
    if (this.phase === "betting") {
      this.placed = this.placed.filter((one) => one.seatId !== seatId);
      if (userId !== null && !this.forFun) {
        this.escrow.refund(userId);
      }
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
   * What the bank can be measured against, not counting this spin's chips.
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

  /** Everything on the cloth this spin, everybody's. */
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

  /** What this seat had on the cloth last spin, so it can be put down again. */
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
      throw new TableError("The wheel is already turning.");
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
    const already =this.placed.find((one) => one.seatId === seatId && one.spotId === spotId);
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
   * at all: two people back red every spin, and a control that took "the chips
   * on red" would let either of them pocket the other's.
   *
   * Returns what actually came off, because that is the number the adapter has
   * to pay back — asking for more than the pile holds takes the pile rather
   * than opening a debt.
   */
  take(seatId: string, spotId: string, chips: number): number {
    if (this.phase !== "betting") {
      throw new TableError("The wheel is already turning.");
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
      throw new TableError("The wheel is already turning.");
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
      throw new TableError("The wheel is already turning.");
    }
    this.placed = this.placed.filter((one) => one.seatId !== seatId);
  }

  // ---------------------------------------------------------- the phases

  /**
   * The window shuts and the ball goes in.
   *
   * A cloth with nothing on it does not turn the wheel. A stream of results
   * nobody bet on is noise, and it would walk the history board along until
   * the last real spin had scrolled off it. The felt is left exactly as it is
   * and a fresh window opens — which is also what CLAUDE.md means by a table
   * that holds with the felt untouched.
   */
  closeBetting(): void {
    if (this.phase !== "betting") {
      return;
    }
    if (this.placed.length === 0) {
      this.deadline = Date.now() + this.window;
      return;
    }
    this.pocket = spin(this.pick);
    this.phase = "spinning";
    this.deadline = Date.now() + SPIN_MS;
    this.lastEvent = "No more bets.";
  }

  /** The ball drops, and the cloth is settled. */
  land(): void {
    if (this.phase !== "spinning" || this.pocket === null) {
      return;
    }
    // The ball has landed, so the cloth now belongs to its result, not to the
    // accounts that put it there — a void from here on has nothing to hand back.
    this.escrow.settle();
    this.paid = settle(this.placed, this.pocket);
    this.history = [...this.history, this.pocket].slice(-HISTORY);

    /*
     * Who came out ahead, and only them.
     *
     * A seat that got its stake back and nothing else is not on this board.
     * Every bet on the cloth pays the stake back with it, so "was handed
     * something" is true of half the table on most spins and means nothing —
     * finishing up is the thing a person would tell somebody about.
     */
    this.spins += 1;
    const spin = this.spins;
    const pocket = this.pocket;
    for (const [seatId, one] of this.paid) {
      const up = one.back - one.staked;
      if (up <= 0) {
        continue;
      }
      this.winners.push({
        spin,
        pocket,
        seatId,
        name: this.seats.find((seat) => seat.id === seatId)?.name ?? "",
        up,
      });
    }
    /*
     * A rolling log, and it may well cut a spin in half at the front. That is
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
    this.lastEvent = `${this.pocket}`;
  }

  /** The cloth is swept and the next window opens. */
  beginBetting(): void {
    this.placed = [];
    this.paid = null;
    this.pocket = null;
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
      pocket: this.pocket,
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
