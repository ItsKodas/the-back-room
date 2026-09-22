import {
  Escrow,
  type Seat,
  type SeatIdentity,
  Seating,
  type TableStatus,
  TableError,
} from "@backroom/core";
import { FUN_BANK, FUN_PURSE, HORN_STEP, MIN_CHIP, working } from "./bank.js";
import { type Paid, type Placed, settle, toBets } from "./bets.js";
import { type Roll, roll as throwDice, total } from "./dice.js";
import { after, decided, type Hand, maxOdds, nextPoint, sleeps } from "./resolve.js";
import { type Spot, spotAt } from "./spots.js";

/**
 * A craps table.
 *
 * Every seat has chips riding on the same roll, the same as roulette's wheel
 * — but a craps hand is not one spin. One seat holds the dice and a point,
 * once it is set, stays up over as many rolls as it takes to make it or seven
 * out. That is why the cloth is never swept between rolls the way roulette's
 * is, and it is why betting ends by *sealing* rather than by the wheel simply
 * turning: the off rule is the table's whole guarantee and it has to be
 * checked inside the bank's own queue, where nothing can move the bank
 * between reading it and the dice deciding. Joining that queue is
 * asynchronous and this class deliberately is not, so sealing and releasing
 * are two separate steps for the adapter to drive.
 */

/**
 * `sealed` and `releasing` are both "the window has shut and the dice have
 * not gone yet", and they are two states rather than one because `payOut`
 * runs on every broadcast: the first thing it does is move a sealed table to
 * `releasing`, before its first await, and that is what makes calling it often
 * exactly-once rather than two throws for one seal.
 */
export type Phase = "betting" | "sealed" | "releasing" | "rolling" | "settling";

/** How long the felt may be open for bets. The host picks one when they open. */
export const WINDOWS = [15_000, 30_000, 60_000] as const;

/** A ceiling, not a constant — see {@link Table.lastCallMs}. */
export const LAST_CALL_MS = 5_000;

/**
 * How long the dice are in the air.
 *
 * Shorter than the wheel's eight and a half seconds, and deliberately: a spin
 * is a thing you watch, and a throw is a thing that has already happened by
 * the time you have looked up. Long enough to read as dice crossing felt and
 * short enough to sit through twenty times in a point cycle.
 */
export const ROLL_MS = 2_400;

/** How long a finished roll stays up to be read. */
export const SETTLE_MS = 4_000;

/** How many rolls the board beside the felt remembers. */
export const HISTORY = 12;

/** How many wins the board beside that one remembers. */
export const WINNERS = 6;

/** One throw, kept for the board. */
export interface Throw {
  dice: Roll;
  /** The point when they were thrown, which is what makes the result readable. */
  point: number | null;
  what: "set" | "made" | "sevenOut" | null;
}

/**
 * Somebody being paid, kept after the roll that paid them.
 *
 * The profit rather than what came back, because the stake was already theirs.
 * The name is copied rather than looked up: a seat that won and then left
 * still won, and a log that forgets people when they stand up is a log of who
 * is here rather than of what happened.
 */
export interface Win {
  /** Which roll this was, so two identical wins are still two entries. */
  roll: number;
  dice: Roll;
  seatId: string;
  name: string;
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
  /** What this seat has on the cloth right now. */
  staked: number;
  /** What the last roll handed them, or nothing if they were not in it. */
  paid: number | null;
  /** Play money left, at a for-fun table. Null anywhere else. */
  purse: number | null;
  /** Whose dice they are. */
  shooter: boolean;
  /** Whether this seat's numbers act through a come-out. */
  works: boolean;
}

export interface TableView {
  code: string;
  phase: Phase;
  /** When the current phase runs out, absolute. Null when nothing is timing. */
  deadline: number | null;
  lastCall: boolean;
  /** What the table is trying to make. Null on a come-out. */
  point: number | null;
  /** Where the dice came to rest, or null before they have been thrown. */
  dice: Roll | null;
  /** Recent throws, newest last. */
  history: readonly Throw[];
  /** What the bank could not carry this roll, so the felt can say which. */
  offByBank: readonly string[];
  /** Every chip on the cloth, everybody's. */
  placed: readonly Placed[];
  /** What the last roll paid, by seat. */
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
  shooterId: string | null;
  /** Whether you may throw the dice right now. */
  canRoll: boolean;
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
  private readonly pick: (faces: number) => number;

  phase: Phase = "betting";
  deadline: number | null = null;
  point: number | null = null;
  /** Where the dice came to rest, or null before they have been thrown. */
  dice: Roll | null = null;
  placed: Placed[] = [];
  paid: Map<string, Paid> | null = null;
  history: Throw[] = [];
  winners: Win[] = [];
  /** Whose dice they are. */
  shooterId: string | null = null;
  /** Which spots the bank could not carry this roll, for the felt to say so. */
  offByBank: string[] = [];
  /** Seats whose numbers work through a come-out. Off is the table's default. */
  private readonly works = new Map<string, boolean>();
  /**
   * How many rolls this table has actually settled.
   *
   * Only ever counts up, and never restarts: it is what tells two identical
   * wins apart. The same player winning the same amount on the same number
   * twice in a hand is an ordinary evening, and without this the board would
   * draw one of them.
   */
  private rolls = 0;
  /** What ended last roll, by seat, so "same again" is one press. */
  private previous = new Map<string, Placed[]>();

  /** Every chip on the cloth by the account it came from, until the dice decide it. */
  readonly escrow = new Escrow();

  /**
   * The account behind each seat that has been in this hand, seated or not.
   *
   * A seat that stands up mid-hand still has chips riding on it, and whatever
   * the dice decide is theirs. The name is kept with it so the winners board
   * can still say who won after the seat has gone. Pruned when the *hand*
   * ends rather than on every roll — a hand outlives a round, and pruning a
   * roll at a time would forget somebody halfway through their own point and
   * quietly keep their winnings.
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
    options: { pick?: (faces: number) => number; window?: number } = {},
  ) {
    this.code = code;
    this.seating = new Seating(maxSeats);
    this.pick = options.pick ?? ((faces) => Math.floor(Math.random() * faces));
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
   * Standing up mid-hand is honoured there and then.
   *
   * Nothing is kept from a seat that leaves: chips down while bets are open
   * come back unless another bet is leaning on them, and chips that ride —
   * a point already on for that seat's own bets — are paid to their account
   * whatever the dice do. Holding the seat would be holding it for nothing.
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
    // The first person to sit is dealt the dice; nobody else can be.
    if (this.shooterId === null) {
      this.passDice();
    }
    return seat;
  }

  /**
   * Somebody stands up, and their chips stay behind for the adapter.
   *
   * Filtering them off the cloth was the table keeping them. Every chip went
   * into the bank as it landed, so a seat that left mid-window lost its whole
   * stake for a roll it never saw, and a refresh that outlasted the grace
   * period did the same.
   */
  removeSeat(seatId: string): void {
    const hadDice = seatId === this.shooterId;
    this.seating.remove(seatId);
    this.previous.delete(seatId);
    // The dice do not wait for a shooter who has gone.
    if (hadDice) {
      this.passDice();
    }
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

  // ------------------------------------------------------------ the hand

  /** What the table is trying to make, in the shape the rulebook wants it. */
  get hand(): Hand {
    return { point: this.point };
  }

  worksFor(seatId: string): boolean {
    return this.works.get(seatId) ?? false;
  }

  /**
   * Whether this seat's numbers act through a come-out.
   *
   * Off by default, which is the real table's default and also the kinder one:
   * a place bet that slept through a come-out seven is a place bet that did
   * not lose.
   */
  setWorking(seatId: string, on: boolean): void {
    this.seatOf(seatId);
    this.works.set(seatId, on);
  }

  /**
   * The dice move on.
   *
   * To the next seat round, wrapping, and to the first seat when nobody has
   * them yet — which is what `findIndex` returning -1 does for free here.
   */
  private passDice(): void {
    const seats = this.seats;
    if (seats.length === 0) {
      this.shooterId = null;
      return;
    }
    const at = seats.findIndex((one) => one.id === this.shooterId);
    this.shooterId = seats[(at + 1) % seats.length]?.id ?? null;
  }

  /**
   * The shooter throws, which ends the window early.
   *
   * Their press, and only theirs. The table's own clock does the same thing
   * when it runs out, which is the whole of "a table that deals itself": a
   * ready button one idle player can hold shut is a table that has stopped
   * dealing.
   */
  shoot(seatId: string): void {
    if (this.phase !== "betting") {
      throw new TableError("The dice are already out.");
    }
    if (seatId !== this.shooterId) {
      throw new TableError("They are not your dice.");
    }
    this.seal();
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
   * What the bank can be measured against, not counting this roll's chips.
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

  /** Everything on the cloth right now, everybody's. */
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

  /** What this seat had on the cloth last roll, so it can be put down again. */
  lastRound(seatId: string): readonly Placed[] {
    return this.previous.get(seatId) ?? [];
  }

  /**
   * What is behind this odds bet, if anything is.
   *
   * Behind the line it is the table's point and the seat's line bet; behind a
   * come bet it is that bet's own number. Which is why odds spots carry a
   * number at all — a player may have four come bets working and each wants
   * its own price and its own cap.
   */
  private behind(seatId: string, spot: Spot): { point: number; chips: number } | null {
    if (spot.id === "odds:pass" || spot.id === "odds:dontpass") {
      const chips = this.onSpot(seatId, spot.dark ? "dontpass" : "pass");
      return this.point === null || chips === 0 ? null : { point: this.point, chips };
    }
    if (spot.number === null) {
      return null;
    }
    const chips = this.onSpot(seatId, `${spot.dark ? "dontcome" : "come"}:${spot.number}`);
    return chips === 0 ? null : { point: spot.number, chips };
  }

  /**
   * Whether these chips are a contract that cannot come down.
   *
   * The pass line and a travelled come bet, once they have a number: that is
   * the trade for the price. The dark side can always come down, because
   * taking it down is against the player's own interest and a table that
   * forbade it would be protecting nobody.
   */
  private contract(spot: Spot): boolean {
    if (spot.dark) return false;
    if (spot.id === "pass") return this.point !== null;
    return spot.kind === "travelled";
  }

  /**
   * Everything this table would refuse a chip for, without moving anything.
   *
   * Separate from {@link place} so the adapter can find out whether a bet is
   * allowed *before* it takes anybody's money. Placing first and unwinding
   * afterwards looks equivalent and is not: a chip landing on a spot the seat
   * already has chips on merges into that pile, so undoing it takes the whole
   * pile back rather than the chip just added.
   *
   * The bank is not consulted here — what it holds is a question for the store
   * and this class is deliberately synchronous. What is checked is everything
   * true of the table alone.
   */
  check(seatId: string, spotId: string, chips: number): void {
    if (this.phase !== "betting") {
      throw new TableError("The dice are already out.");
    }
    if (this.lastCall) {
      throw new TableError("No more bets.");
    }
    this.seatOf(seatId);
    const spot = spotAt(spotId);
    // A derived spot is where the table puts chips, never where a player does.
    if (spot === null || spot.derived) {
      throw new TableError("There is no such bet on this table.");
    }
    const step = spot.id === "horn" ? HORN_STEP : MIN_CHIP;
    if (!Number.isInteger(chips) || chips < step || chips % step !== 0) {
      throw new TableError(`The ${spot.label.toLowerCase()} takes multiples of ${step}.`);
    }
    if (spot.kind === "line") {
      const box = spot.id === "pass" || spot.id === "dontpass";
      if (box && this.point !== null) {
        throw new TableError("The point is on. Come in through the come box.");
      }
      if (!box && this.point === null) {
        throw new TableError("Wait for the point before coming in.");
      }
    }
    if (spot.kind === "odds") {
      const behind = this.behind(seatId, spot);
      if (behind === null) {
        throw new TableError("There is nothing to back with odds yet.");
      }
      const most = maxOdds(behind.point, behind.chips, spot.dark);
      if (this.onSpot(seatId, spot.id) + chips > most) {
        throw new TableError(`The most you may put behind that is ${most.toLocaleString("en-US")}.`);
      }
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
      this.placed.push({ seatId, spotId, chips, off: false });
    } else {
      this.placed = this.placed.map((one) =>
        one === already ? { ...one, chips: one.chips + chips } : one,
      );
    }
  }

  /**
   * Chips off one spot, back to the seat that put them there.
   *
   * Per seat and not per spot, which is the whole reason this takes a seat id:
   * two people back the pass line every hand, and a control that took "the
   * chips on the pass line" would let either of them pocket the other's.
   */
  take(seatId: string, spotId: string, chips: number): number {
    if (this.phase !== "betting") {
      throw new TableError("The dice are already out.");
    }
    const spot = spotAt(spotId);
    if (spot !== null && this.contract(spot)) {
      throw new TableError("That one stays for the hand. It is a contract.");
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

  /**
   * The last chip this seat put down, taken back.
   *
   * Skips over a contract exactly as {@link take} refuses one: the pass line
   * with a point on it is not the "last chip" in any sense a player pressing
   * undo means, and taking it down would be taking down a bet the point had
   * already been set on.
   */
  undo(seatId: string): void {
    if (this.phase !== "betting") {
      throw new TableError("The dice are already out.");
    }
    for (let at = this.placed.length - 1; at >= 0; at -= 1) {
      const one = this.placed[at];
      if (one === undefined || one.seatId !== seatId) {
        continue;
      }
      const spot = spotAt(one.spotId);
      if (spot !== null && this.contract(spot)) {
        continue;
      }
      this.placed.splice(at, 1);
      return;
    }
  }

  /**
   * Every chip this seat has down, taken back — except a contract, which
   * stays for the hand. Otherwise clearing the cloth would be a second way to
   * do what {@link take} already refuses.
   */
  clear(seatId: string): void {
    if (this.phase !== "betting") {
      throw new TableError("The dice are already out.");
    }
    this.placed = this.placed.filter((one) => {
      if (one.seatId !== seatId) {
        return true;
      }
      const spot = spotAt(one.spotId);
      return spot !== null && this.contract(spot);
    });
  }

  // ---------------------------------------------------------- the phases

  /**
   * No more bets.
   *
   * A cloth with nothing on it and no point does not roll. A stream of results
   * nobody bet on is noise, and it would walk the board along until the last
   * real roll had scrolled off it. The felt is left exactly as it is and a
   * fresh window opens — which is also what CLAUDE.md means by a table that
   * holds with the felt untouched.
   *
   * Once a point is on the table always rolls, whatever is down. The hand has
   * to finish.
   */
  seal(): void {
    if (this.phase !== "betting") {
      return;
    }
    if (this.placed.length === 0 && this.point === null) {
      this.deadline = Date.now() + this.window;
      return;
    }
    // Anybody who left and has not had their chips back yet is too late: they ride.
    this.leaving.clear();
    if (this.shooterId === null) {
      this.passDice();
    }
    this.phase = "sealed";
    this.deadline = null;
    this.lastEvent = "No more bets.";
  }

  /**
   * The bank answers, and the dice go.
   *
   * Handed the bank rather than reading it, because reading it is a round trip
   * to the store and this class is deliberately synchronous — and because the
   * figure has to be the one the adapter read inside the bank's own queue, or
   * the guarantee is made against a number that may already be stale.
   *
   * Two passes over the cloth, in this order: what its owner put to sleep, and
   * then what the bank cannot carry. The order matters — `working` never turns
   * a bet back on, so a sleeping bet stays asleep however rich the bank is.
   */
  release(bank: number): Roll {
    const hand = this.hand;
    const known = this.placed.filter((one) => spotAt(one.spotId) !== null);
    const asleep = known.map((one) => ({
      ...one,
      off: sleeps(spotAt(one.spotId) as Spot, hand, this.worksFor(one.seatId)),
    }));
    const decided = working(bank, toBets(asleep), hand);
    this.placed = asleep.map((one, at) => ({ ...one, off: decided[at]?.off ?? one.off }));
    this.offByBank = this.placed
      .filter((one, at) => one.off && asleep[at]?.off === false)
      .map((one) => one.spotId);
    this.dice = throwDice(this.pick);
    this.phase = "rolling";
    this.deadline = Date.now() + ROLL_MS;
    return this.dice;
  }

  /** The dice come to rest, and the cloth is settled. */
  land(): void {
    if (this.phase !== "rolling" || this.dice === null) {
      return;
    }
    /*
     * The dice have landed, so the cloth now belongs to its result rather than
     * to the accounts that put it there — a void from here has nothing to hand
     * back for this roll.
     */
    this.escrow.settle();
    const hand = this.hand;
    const dice = this.dice;
    const result = settle(this.placed, dice, hand);

    /*
     * What ended, so "same again" can put it down again. Only what ended: a
     * place bet still on the cloth would otherwise be laid a second time on
     * top of itself.
     */
    this.previous = new Map();
    for (const one of this.placed) {
      const spot = spotAt(one.spotId);
      if (spot === null || one.off || after(spot, dice, hand) !== null) continue;
      if (spot.derived) continue;
      this.previous.set(one.seatId, [...(this.previous.get(one.seatId) ?? []), { ...one }]);
    }

    this.paid = result.paid;
    this.placed = result.cloth;
    const what = decided(hand, dice);
    this.point = nextPoint(hand, dice);
    this.rolls += 1;
    this.history = [...this.history, { dice, point: hand.point, what }].slice(-HISTORY);

    /*
     * Who came out ahead, and only them. A seat handed its stake back is not
     * on this board: every bet that comes in pays the stake with it, so "was
     * handed something" is true of half the table most rolls and means
     * nothing. Finishing up is the thing a person would tell somebody about.
     */
    for (const [seatId, one] of result.paid) {
      const up = one.back - one.staked;
      if (up <= 0) continue;
      this.winners.push({
        roll: this.rolls,
        dice,
        seatId,
        name: this.accounts.get(seatId)?.name ?? "",
        up,
      });
    }
    this.winners = this.winners.slice(-WINNERS);

    if (what === "sevenOut") {
      this.passDice();
    }
    this.phase = "settling";
    this.deadline = Date.now() + SETTLE_MS;
    this.lastEvent = `${total(dice)}`;
  }

  /**
   * The next window opens — and the cloth stays exactly where it is.
   *
   * The one line that makes this a craps table and not a wheel. Everything
   * still down is still down, and `settle` has already taken away what ended.
   */
  beginBetting(): void {
    this.paid = null;
    this.dice = null;
    this.offByBank = [];
    this.leaving.clear();
    this.phase = "betting";
    this.deadline = Date.now() + this.window;
    for (const seat of this.seating.seats) {
      seat.waiting = false;
    }
    /*
     * Accounts are pruned when the *hand* ends, not when a roll does. A craps
     * hand outlives a round, and pruning per roll would forget somebody halfway
     * through their own point and quietly keep their winnings.
     */
    if (this.point === null) {
      const here = new Set(this.seats.map((seat) => seat.id));
      for (const seatId of [...this.accounts.keys()]) {
        if (!here.has(seatId)) this.accounts.delete(seatId);
      }
      this.works.clear();
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
      shooter: seat.id === this.shooterId,
      works: this.worksFor(seat.id),
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
      point: this.point,
      dice: this.dice,
      history: this.history,
      offByBank: this.offByBank,
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
      shooterId: this.shooterId,
      canRoll: forSeatId === this.shooterId && this.phase === "betting",
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
