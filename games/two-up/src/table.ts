import {
  Escrow,
  type Seat,
  type SeatIdentity,
  Seating,
  type TableStatus,
  TableError,
} from "@backroom/core";
import { type BetOn, FUN_BANK, FUN_PURSE, MIN_CHIP } from "./bank.js";
import { type Paid, type Placed, settle } from "./bets.js";
import { type Called, readCasino } from "./casino.js";
import { type Centre, type Cover, payouts, uncovered } from "./centre.js";
import { type Face, type Outcome, readFaces, toss } from "./coins.js";
import { type Decided, readSchool } from "./school.js";

/**
 * A two-up table, in either of the two games two-up is.
 *
 * Its shape is the wheel's: nobody has a turn, everybody stakes inside one
 * window, and one result answers all of them. What it adds is a spinner and a
 * run of throws — a round here can be five throws long, and the beat between
 * them is where the ring groans at an odds.
 *
 * The rules themselves are not here. `casino.ts` and `school.ts` read a run of
 * throws and say what it decided; this file times the throws, holds the chips
 * and draws the view. Keeping the reading out of the table is what lets one
 * table be two games without being twice as long.
 */

export type School = "casino" | "school";

export type Phase = "betting" | "centre" | "covering" | "kip" | "spinning" | "reading" | "settled";

/** How long the felt may be open. The host picks one when they open the table. */
export const WINDOWS = [15_000, 30_000, 60_000] as const;

/** How much of the window takes no more chips, so a late chip is never a race. */
export const LAST_CALL_MS = 5_000;

/**
 * How long the spinner has to press the kip before the boxer throws for them.
 *
 * Short. This is a ceremony in the casino school, and a ceremony that can stall
 * a table for a quarter of a minute is not a ceremony, it is a hostage.
 */
export const KIP_MS = 6_000;

/** How long the coins are in the air. */
export const FLIGHT_MS = 2_600;

/** How long a landed throw sits there being read, before the next one. */
export const READ_MS = 1_400;

/** How long a finished round stays up to be read. */
export const SETTLE_MS = 5_000;

/** How many throws the board remembers. */
export const HISTORY = 14;

/** A ring needs somebody to play against. */
export const MIN_FOR_RING = 2;

export interface SeatView {
  id: string;
  name: string;
  connected: boolean;
  waiting: boolean;
  isBot: boolean;
  avatar: string | null;
  accentColor: number | null;
  /** What this seat has on the cloth this round. */
  staked: number;
  /** What the last round handed them, or nothing if they were not in it. */
  paid: number | null;
  /** Play money left, at a for-fun table. Null anywhere else. */
  purse: number | null;
}

export interface TableView {
  code: string;
  school: School;
  phase: Phase;
  /** When the current phase runs out, absolute. Null when nothing is timing. */
  deadline: number | null;
  lastCall: boolean;
  /**
   * Whether the table is waiting for company rather than for a clock.
   *
   * Its own flag rather than a phase, because the felt does not change when a
   * ring holds — that is the whole rule. The centre stays where it is, nobody
   * is refunded, and this is what lets the felt say why.
   */
  holding: boolean;
  /** Who is holding the kip. */
  spinnerId: string | null;
  /**
   * The faces the coins are showing, or null before they have been thrown.
   *
   * Sent while they are still in the air, exactly as the wheel is sent its
   * pocket the moment betting closes: the felt has to roll two coins onto two
   * particular faces, and it cannot do that without knowing them. It is not a
   * leak — the client draws them edge-on until they land — and there is no
   * version of an honest animation that does not need this.
   */
  faces: readonly [Face, Face] | null;
  /** Every throw of this round, in order. */
  throws: readonly Outcome[];
  /** What the round was called, once it is over. */
  called: Called | null;
  /** Who took a traditional round, once it is over. */
  decided: Decided | null;
  /** Recent throws, newest last. */
  history: readonly Outcome[];
  /** Every chip on the cloth, everybody's. Casino school only. */
  placed: readonly Placed[];
  /** The centre, and what the ring has covered of it. Traditional school only. */
  centre: Centre | null;
  covers: readonly Cover[];
  uncovered: number;
  /** What the last round paid, by seat. */
  paid: readonly { seatId: string; name: string; back: number; staked: number }[];
  /**
   * What the bank holds. For showing only — so a felt can grey out a side it
   * cannot cover. Every bet is checked again on the way in, because a number a
   * browser has been told is a number a browser can change.
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

/** What a ring says while it is waiting rather than playing. */
const WAITING = "Waiting for another player.";

export class Table {
  readonly code: string;
  readonly school: School;
  private readonly seating: Seating;

  phase: Phase;
  deadline: number | null = null;
  placed: Placed[] = [];
  centre: Centre | null = null;
  covers: Cover[] = [];
  throws: Outcome[] = [];
  faces: readonly [Face, Face] | null = null;
  called: Called | null = null;
  decided: Decided | null = null;
  paid: Map<string, Paid> | null = null;
  /** What a traditional round owes, by seat. Settled by the adapter. */
  owing: Map<string, number> | null = null;
  history: Outcome[] = [];
  spinnerId: string | null = null;
  private previous = new Map<string, Placed[]>();

  /**
   * Every chip staked into this round by the account it came from, until the
   * coins decide it: a casino cloth, or a ring's centre and covers.
   */
  readonly escrow = new Escrow();

  /**
   * Casino seats that stood up while bets were open, their chips still on the
   * cloth until the adapter has asked whether they can come off.
   *
   * Asked there rather than here because the question is the bank's: a chip
   * another bet leans on for cover stays, exactly as a take-back would, and
   * this class cannot read the bank. Emptied when the window shuts, since from
   * then on whatever is still down rides.
   */
  readonly leaving = new Set<string>();

  /**
   * Which account each seat belonged to, kept for the length of a round.
   *
   * A seat can leave in the middle of a round — `leavesMidHand` is true here —
   * and what it is owed does not leave with it. Once `Seating.remove` has run,
   * the seat was the only record of whose account it was, so settlement would
   * have nobody to pay and the chips would simply cease to exist. In a ring
   * that is the economy losing chips outright, which is the mirror image of
   * minting them and no better.
   *
   * Pruned when the next round opens rather than when a seat leaves, because
   * the round that owes somebody is the round they were in.
   */
  private accounts = new Map<string, string | null>();

  /** The account behind a seat, whether or not the seat is still occupied. */
  accountOf(seatId: string): string | null {
    return this.accounts.get(seatId) ?? null;
  }

  housed = 0;
  forFun = false;
  private readonly purses = new Map<string, number>();
  funBank = FUN_BANK;
  window: number = WINDOWS[1];
  lastEvent: string | null = null;

  constructor(
    code: string,
    maxSeats: number,
    options: { school?: School; window?: number; forFun?: boolean } = {},
  ) {
    this.code = code;
    this.school = options.school ?? "casino";
    this.seating = new Seating(maxSeats);
    this.forFun = options.forFun === true;
    if (options.window !== undefined) {
      this.window = options.window;
    }
    this.phase = this.school === "casino" ? "betting" : "centre";
    this.restartClock();
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
   * Standing up mid-round is honoured there and then.
   *
   * Nothing is kept from a seat that leaves and nothing waits for it: casino
   * chips down while bets are open come back, and chips that are riding — a
   * closed casino cloth, a ring's centre or covers — are paid to their account
   * whatever the coins do. Holding the seat would be holding it for nothing.
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
    // Back before their chips were asked about, so those chips are theirs to manage again.
    this.leaving.delete(seat.id);
    /*
     * Whoever sits down first has the kip until it passes.
     *
     * The casino school names its spinner when the window shuts, but a ring
     * opens *waiting* for a centre, so it needs somebody to be waiting for
     * from the moment there is anybody at all. Without this a fresh ring would
     * refuse its own first centre for want of a spinner.
     */
    if (this.spinnerId === null) {
      this.spinnerId = seat.id;
    }
    this.roomChanged();
    return seat;
  }
  removeSeat(seatId: string): void {
    this.seating.remove(seatId);
    /*
     * Nothing comes off the felt here. Casino chips down while bets are open
     * go back to a leaver unless another bet leans on them for cover, and that
     * is the bank's question, so the seat is noted in `leaving` for the
     * adapter to answer. Chips still down when the window shuts ride, and what
     * the coins decide is paid to their account whether they watch or not.
     *
     * A ring's centre and covers always stay: they are contested by the people
     * still standing there, and a cover pulled out from under a centre halfway
     * through a run would refund a bet that had already been matched.
     */
    if (this.school === "casino" && this.phase === "betting" && this.staked(seatId) > 0) {
      this.leaving.add(seatId);
    }
    this.previous.delete(seatId);
    this.roomChanged();
  }
  disconnect(seatId: string): void {
    this.seating.disconnect(seatId);
    this.roomChanged();
  }
  reconnect(seatId: string): Seat {
    const seat = this.seating.reconnect(seatId);
    this.roomChanged();
    return seat;
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

  // ---------------------------------------------------------- the waiting

  /**
   * Whether this table is waiting for company rather than for a clock.
   *
   * Only a ring can hold. The casino school has a bank behind it, which is the
   * exception CLAUDE.md names — one player against the house is a game between
   * people who are simply not in the room at the same time — and a for-fun
   * table's purse was never anybody's.
   *
   * Note what this does *not* do: it does not touch the felt. The centre stays
   * where it is and nobody is refunded, because the chips were taken when they
   * were staked and clearing them to wait would be the table keeping the money.
   */
  get holding(): boolean {
    if (this.school !== "school" || this.forFun) {
      return false;
    }
    return this.seats.filter((seat) => !seat.isBot && seat.connected).length < MIN_FOR_RING;
  }

  /** How long the phase the table is in gets, before something has to happen. */
  private get phaseMs(): number {
    if (this.phase === "kip") {
      return KIP_MS;
    }
    if (this.phase === "spinning") {
      return FLIGHT_MS;
    }
    if (this.phase === "reading") {
      return READ_MS;
    }
    if (this.phase === "settled") {
      return SETTLE_MS;
    }
    return this.window;
  }

  /**
   * The clock for whatever the table is doing now.
   *
   * A holding ring gets no clock at all rather than a long one. A deadline is
   * a promise that something will happen when it runs out, and there is
   * nothing that could happen here — so the honest thing is to be timing
   * nothing and to say why.
   */
  private restartClock(): void {
    if (this.holding) {
      this.deadline = null;
      this.lastEvent = WAITING;
      return;
    }
    this.deadline = Date.now() + this.phaseMs;
  }

  /**
   * The room changed, so the table may have just lost or found its game.
   *
   * Only ever touches a clock that is stopped or that ought to be. Somebody
   * arriving mid-flight must not extend the flight — a table already timing
   * something is timing it for everybody still here.
   */
  private roomChanged(): void {
    this.keepTheKip();
    if (this.holding) {
      this.restartClock();
      return;
    }
    if (this.deadline === null) {
      this.lastEvent = null;
      this.restartClock();
    }
  }

  /**
   * The kip cannot be held by somebody who is not here.
   *
   * Only while a ring is waiting for a centre, and that narrowness is the
   * point. It is the one phase that would otherwise stall for good: nobody but
   * the spinner may set a centre, so a spinner who walks out takes the round
   * with them and the window reopens on an empty middle forever.
   *
   * Every other phase is already safe and must be left alone. The casino
   * school names its spinner afresh when the window shuts; and once a centre
   * is up the run belongs to whoever put it there whether or not they are
   * still standing at the table, with the boxer throwing for them if they are
   * not. Passing the kip then would hand a stranger somebody else's centre.
   */
  private keepTheKip(): void {
    if (this.phase !== "centre") {
      return;
    }
    this.spinnerId = this.holdsTheKip();
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

  /**
   * Whether the window is close enough to shutting to stop taking chips.
   *
   * All three staking windows, not just the casino one. The ring's are exactly
   * as much of a race — a cover landing as the covering window shuts is a chip
   * that may or may not be in the round — and this is on the view, so a felt
   * greys out its controls by it. A last call the client draws and the server
   * does not refuse would be a rule living in a browser.
   */
  get lastCall(): boolean {
    const open = this.phase === "betting" || this.phase === "centre" || this.phase === "covering";
    if (!open || this.deadline === null) {
      return false;
    }
    return this.deadline - Date.now() <= this.lastCallMs;
  }

  /**
   * What the bank can be measured against, not counting this round's chips.
   *
   * A getter rather than a number somebody remembers to set. A for-fun table's
   * bank lives here and is exact the instant the table exists; a chips table's
   * is whatever the adapter last read from the store. Both then have the
   * cloth's own chips taken back off, because chips go into the bank as they
   * land and a cloth that counted them would be vouching for itself.
   *
   * For showing only. It lets a felt grey out a side the bank cannot cover
   * rather than letting somebody find the cap by being refused — and every bet
   * is checked again on the way in, because a number a browser has been told
   * is a number a browser can change.
   */
  get bank(): number {
    const held = this.forFun ? this.funBank : this.housed;
    return Math.max(0, held - this.onCloth);
  }

  /** Everything on the cloth this round, everybody's. Casino school only. */
  get onCloth(): number {
    return this.placed.reduce((sum, one) => sum + one.chips, 0);
  }

  /** What one seat has on the cloth altogether. */
  staked(seatId: string): number {
    return this.placed
      .filter((one) => one.seatId === seatId)
      .reduce((sum, one) => sum + one.chips, 0);
  }

  /**
   * What this seat put into this round, whichever school is playing.
   *
   * Their chips on the cloth, or their centre, or their covers. The adapter
   * needs one number to record a win by, and having to know which of two games
   * it was looking at to work out how much somebody staked is exactly the
   * branch that gets written once and then forgotten in the second place.
   */
  stakedIn(seatId: string): number {
    if (this.school === "casino") {
      return this.staked(seatId);
    }
    const mine = this.centre?.seatId === seatId ? this.centre.chips : 0;
    return this.covers.reduce((sum, one) => (one.seatId === seatId ? sum + one.chips : sum), mine);
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

  /** What this seat had on the cloth last round, so it can be put down again. */
  lastRound(seatId: string): readonly Placed[] {
    return this.previous.get(seatId) ?? [];
  }

  /**
   * Everything this table would refuse a chip for, without moving anything.
   *
   * Separate from {@link place} so the adapter can find out whether a bet is
   * allowed *before* it takes anybody's money. Placing first and unwinding
   * afterwards looks equivalent and is not: a chip landing on a side the seat
   * already has chips on merges into that pile, so undoing it takes the whole
   * pile back rather than the chip that was just added.
   *
   * The bank is not consulted here — the adapter does that, because what the
   * bank holds is a question for the store and this class is deliberately
   * synchronous. What is checked here is everything true of the table alone.
   *
   * The side is taken and not read, which is the one place this is simpler
   * than the wheel's. A roulette spot is an id, so looking it up *is* the
   * safety property; `BetOn` is a union of three, so a message naming a fourth
   * cannot be built at all and there is nothing left to resolve. It stays in
   * the signature because a caller that has to remember which of two nearly
   * identical calls takes the side is a caller that will get it wrong.
   */
  check(seatId: string, _on: BetOn, chips: number): void {
    if (this.phase !== "betting") {
      throw new TableError("The coins are already up.");
    }
    this.takingChips(seatId, chips);
  }

  /**
   * Everything true before this table takes a chip off anybody, either school.
   *
   * In one place because the three ways onto this felt — a bet, a centre, a
   * cover — differ in what they mean and not at all in what they refuse, and
   * three copies of a rule is two copies waiting to fall behind. Only the
   * phase is left to the caller, because that is the part that genuinely
   * differs: each window is open for something else.
   *
   * A holding ring is in here rather than only in the clock. It is the other
   * half of leaving the felt alone — a table that is not playing must neither
   * hand money back nor take any, or waiting starts costing somebody a stake
   * after all.
   */
  private takingChips(seatId: string, chips: number): void {
    if (this.holding) {
      throw new TableError(WAITING);
    }
    if (this.lastCall) {
      throw new TableError("No more bets.");
    }
    this.seatOf(seatId);
    if (!Number.isInteger(chips) || chips < MIN_CHIP) {
      throw new TableError(`The smallest chip here is ${MIN_CHIP}.`);
    }
  }

  /** A chip down. Refuses exactly what {@link check} refuses. */
  place(seatId: string, on: BetOn, chips: number): void {
    this.check(seatId, on, chips);
    // Bots only place at for-fun tables, so they never reach the hold.
    this.hold(seatId, chips);
    const already = this.placed.find((one) => one.seatId === seatId && one.on === on);
    if (already === undefined) {
      this.placed.push({ seatId, on, chips });
    } else {
      this.placed = this.placed.map((one) =>
        one === already ? { ...one, chips: one.chips + chips } : one,
      );
    }
  }

  /**
   * Records a stake against the account that paid it.
   *
   * The last thing before the felt changes, after every check, so a refusal
   * from this table always means nothing was held — and whoever paid for the
   * chip can give back all of it without asking the escrow.
   */
  private hold(seatId: string, chips: number): void {
    const userId = this.seats.find((seat) => seat.id === seatId)?.userId ?? null;
    if (!this.forFun && userId !== null && !this.escrow.hold(userId, chips)) {
      throw new TableError("This table is closing.");
    }
  }

  /**
   * Chips off one side, back to the seat that put them there.
   *
   * Per seat and not per side, which is the whole reason this takes a seat id
   * at all: everybody backs heads sooner or later, and a control that took
   * "the chips on heads" would let any of them pocket the others'.
   *
   * Returns what actually came off, because that is the number the adapter has
   * to pay back — asking for more than the pile holds takes the pile rather
   * than opening a debt.
   */
  take(seatId: string, on: BetOn, chips: number): number {
    if (this.phase !== "betting") {
      throw new TableError("The coins are already up.");
    }
    const pile = this.placed.find((one) => one.seatId === seatId && one.on === on);
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
      throw new TableError("The coins are already up.");
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
      throw new TableError("The coins are already up.");
    }
    this.placed = this.placed.filter((one) => one.seatId !== seatId);
  }

  // ---------------------------------------------------------- the centre

  /**
   * The spinner puts something up, and the ring is asked to cover it.
   *
   * Setting the centre moves the table on by itself rather than waiting for
   * the window to run out. The window exists to give the spinner time to
   * decide; once they have decided, holding the ring on a dead clock is time
   * nobody in the room is using.
   */
  setCentre(seatId: string, chips: number): void {
    if (this.phase !== "centre") {
      throw new TableError("The centre is already set.");
    }
    this.takingChips(seatId, chips);
    if (seatId !== this.spinnerId) {
      throw new TableError("Only the spinner may set the centre.");
    }
    this.hold(seatId, chips);
    this.centre = { seatId, chips };
    this.phase = "covering";
    this.restartClock();
    this.lastEvent = "The centre is up.";
  }

  /**
   * One of the ring covers part of what the spinner put up.
   *
   * The overshoot is refused here, and this is the first of the two locks on
   * that door. `payouts` returns rather than doubles a cover past the centre,
   * so the chips would balance either way — but a cover that quietly turned
   * into a partial refund at settlement is a bet nobody agreed to. The table
   * is where somebody gets told no.
   */
  cover(seatId: string, chips: number): void {
    if (this.phase !== "covering" || this.centre === null) {
      throw new TableError("There is nothing to cover.");
    }
    this.takingChips(seatId, chips);
    if (seatId === this.centre.seatId) {
      throw new TableError("The spinner cannot cover their own centre.");
    }
    const left = uncovered(this.centre, this.covers);
    if (chips > left) {
      throw new TableError(`Only ${left} of the centre is left to cover.`);
    }
    this.hold(seatId, chips);
    const already = this.covers.find((one) => one.seatId === seatId);
    if (already === undefined) {
      this.covers.push({ seatId, chips });
    } else {
      this.covers = this.covers.map((one) =>
        one === already ? { ...one, chips: one.chips + chips } : one,
      );
    }
  }

  // ---------------------------------------------------------- the phases

  /**
   * The centre window ran out with nothing in the middle.
   *
   * Only ever the timeout: a centre that *was* set has already moved the table
   * on. So this reopens the window with the felt exactly as it was, which is
   * the same answer the casino school gives an empty cloth — a table with
   * nothing staked on it has no reason to throw and every reason to wait.
   */
  closeCentre(): void {
    if (this.phase !== "centre") {
      return;
    }
    this.restartClock();
  }

  /**
   * The covering window shuts, and the spinner takes the kip.
   *
   * A centre the ring only half covered is still thrown for. The spinner
   * contests what was covered and the rest comes back to them at settlement,
   * which is what `payouts` already works out — refusing to throw would punish
   * the spinner for the ring's caution.
   */
  closeCovering(): void {
    if (this.phase !== "covering" || this.centre === null) {
      return;
    }
    this.phase = "kip";
    this.restartClock();
    this.lastEvent = "Come in spinner.";
  }

  /**
   * The betting window shuts, and somebody is handed the kip.
   *
   * A cloth with nothing on it does not throw. A stream of results nobody bet
   * on is noise, and it would walk the history board along until the last real
   * throw had scrolled off it — so the felt is left exactly as it is and a
   * fresh window opens.
   *
   * The spinner is read from the kip's current position and the kip is *not*
   * advanced here. {@link beginRound} advances it; doing it in both is how the
   * kip comes to skip every other player.
   */
  closeBetting(): void {
    if (this.phase !== "betting") {
      return;
    }
    // Whatever a leaver still has down is riding now, not waiting to be handed back.
    this.leaving.clear();
    if (this.placed.length === 0) {
      this.restartClock();
      return;
    }
    this.spinnerId = this.holdsTheKip();
    this.phase = "kip";
    this.restartClock();
    this.lastEvent = "No more bets.";
  }

  /**
   * The coins go up.
   *
   * The result is decided here, the moment they leave the kip, because that is
   * when it is honest to decide it — the faces are then a fact the server is
   * holding rather than one it is about to invent when the animation happens
   * to finish. Nothing is recorded until they land.
   */
  private release(random: () => number): void {
    this.faces = toss(random).faces;
    this.phase = "spinning";
    this.restartClock();
  }

  /** The spinner's own throw. Nobody else's, and not before the kip. */
  throwCoins(seatId: string, random: () => number): void {
    if (this.phase !== "kip") {
      throw new TableError("It is not time to throw.");
    }
    if (seatId !== this.spinnerId) {
      throw new TableError("Only the spinner may throw.");
    }
    this.release(random);
  }

  /**
   * The boxer throws, because the spinner did not.
   *
   * Refuses nothing, and that is deliberate: the boxer is the table itself
   * rather than somebody at it, so there is no seat to check and no rule they
   * could be breaking. The clock decides when this happens.
   */
  boxerThrows(random: () => number): void {
    this.release(random);
  }

  /**
   * The coins come down, and the throw goes on the board.
   *
   * This is where a throw becomes a throw. It was decided in the air, but a
   * run recorded before it landed would let a round be read out from under an
   * animation still playing — and both schools read the run.
   */
  land(): void {
    if (this.phase !== "spinning" || this.faces === null) {
      return;
    }
    const outcome = readFaces(this.faces);
    this.throws = [...this.throws, outcome];
    this.history = [...this.history, outcome].slice(-HISTORY);
    this.phase = "reading";
    this.restartClock();
    this.lastEvent = outcome;
  }

  /**
   * The coins have been read, and the round either goes on or is over.
   *
   * The one place the two schools' spinners differ mechanically. An unresolved
   * casino round goes straight back to the air: its spinner is ceremonial, they
   * pressed once for the round, and the boxer simply throws again. An
   * unresolved ring goes back to the kip, because there throwing again is the
   * spinner's own move and taking it off them would be taking the game off
   * them.
   */
  read(random: () => number): void {
    if (this.phase !== "reading") {
      return;
    }
    if (this.school === "casino") {
      const called = readCasino(this.throws);
      if (called === null) {
        /*
         * Straight back into the air, and this is why `read` needs a source at
         * all. "Spinning" means coins are actually up, so returning to it
         * without throwing would leave the table announcing a flight that
         * never left the kip — and the boxer is the one throwing, because the
         * ceremonial spinner already pressed once for this round.
         */
        this.release(random);
        return;
      }
      this.called = called;
      this.paid = settle(this.placed, called);
      this.previous = new Map();
      for (const one of this.placed) {
        this.previous.set(one.seatId, [...(this.previous.get(one.seatId) ?? []), { ...one }]);
      }
    } else {
      const decided = readSchool(this.throws);
      if (decided === null) {
        this.phase = "kip";
        this.deadline = Date.now() + KIP_MS;
        return;
      }
      this.decided = decided;
      this.owing = this.centre === null ? new Map() : payouts(this.centre, this.covers, decided);
    }
    // The coins have called it, so the stakes now belong to the result rather
    // than to the accounts that put them down: a void from here hands back nothing.
    this.escrow.settle();
    this.phase = "settled";
    this.deadline = Date.now() + SETTLE_MS;
    this.lastEvent = this.throws[this.throws.length - 1] ?? null;
  }

  /**
   * The felt is swept, the kip passes, and the next round opens.
   *
   * The kip moves whatever happened, which is not what a real school does — a
   * spinner who comes in keeps throwing there. It is what this table does
   * because the alternative is a lucky spinner holding the kip all evening
   * while everybody else watches, and a table where most people never throw is
   * a table with one player and an audience.
   */
  beginRound(): void {
    this.placed = [];
    this.centre = null;
    this.covers = [];
    this.throws = [];
    this.faces = null;
    this.called = null;
    this.decided = null;
    this.paid = null;
    this.owing = null;
    this.leaving.clear();
    for (const seat of this.seats) {
      seat.waiting = false;
    }
    const here = new Set(this.seats.map((seat) => seat.id));
    for (const seatId of [...this.accounts.keys()]) {
      if (!here.has(seatId)) {
        this.accounts.delete(seatId);
      }
    }
    this.spinnerId = this.nextSpinner();
    this.phase = this.school === "casino" ? "betting" : "centre";
    this.restartClock();
  }

  /**
   * Who takes the kip after whoever has it, found by identity.
   *
   * By identity and never by index, which is the whole of this method. An
   * index into the seats is a number that means somebody different the moment
   * anybody leaves, and `Seating.remove` says so in as many words: removing a
   * seat shifts every later seat's index out from under whatever the game is
   * using to track turn order. Counting positions here put the spinner who
   * had just thrown straight back on the kip and skipped the seat behind them
   * — which is not cosmetic, because going round is the only thing the kip is
   * for.
   *
   * A spinner who has already gone leaves no position to advance from, so the
   * kip starts again at the top rather than guessing where they would have
   * been standing.
   */
  private nextSpinner(): string | null {
    const playing = this.seats.filter((seat) => seat.connected);
    if (playing.length === 0) {
      return null;
    }
    const at = playing.findIndex((seat) => seat.id === this.spinnerId);
    return playing[(at + 1) % playing.length]?.id ?? null;
  }

  /**
   * Whoever holds the kip now, without passing it on.
   *
   * The counterpart to {@link nextSpinner}, and the reason both exist: a
   * window shutting names the seat that already has the kip, and only a
   * finished round passes it. Doing either job with the other is how the kip
   * comes to skip every second player.
   */
  private holdsTheKip(): string | null {
    const playing = this.seats.filter((seat) => seat.connected);
    if (playing.length === 0) {
      return null;
    }
    if (playing.some((seat) => seat.id === this.spinnerId)) {
      return this.spinnerId;
    }
    return playing[0]?.id ?? null;
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
      staked: this.stakedIn(seat.id),
      paid: this.paidTo(seat.id),
      purse: this.forFun ? this.purseFor(seat.id) : null,
    };
  }

  /**
   * What the last round handed one seat, from whichever book recorded it.
   *
   * The casino school settles into `paid` and the ring into `owing`, because
   * the two are different shapes — one has winning bets in it and the other is
   * a bare figure per person. The felt only ever wants the figure.
   */
  private paidTo(seatId: string): number | null {
    if (this.school === "casino") {
      return this.paid?.get(seatId)?.back ?? null;
    }
    return this.owing?.get(seatId) ?? null;
  }

  view(forSeatId: string | null): TableView {
    const seats = this.seats.map((seat) => this.seatView(seat));
    const nameOf = (seatId: string) => this.seats.find((seat) => seat.id === seatId)?.name ?? "";
    const paid =
      this.school === "casino"
        ? [...(this.paid ?? new Map<string, Paid>()).entries()].map(([seatId, one]) => ({
            seatId,
            name: nameOf(seatId),
            back: one.back,
            staked: one.staked,
          }))
        : [...(this.owing ?? new Map<string, number>()).entries()].map(([seatId, back]) => ({
            seatId,
            name: nameOf(seatId),
            back,
            staked: this.stakedIn(seatId),
          }));
    return {
      code: this.code,
      school: this.school,
      phase: this.phase,
      deadline: this.deadline,
      lastCall: this.lastCall,
      holding: this.holding,
      spinnerId: this.spinnerId,
      faces: this.faces,
      throws: this.throws,
      called: this.called,
      decided: this.decided,
      history: this.history,
      placed: this.placed,
      centre: this.centre,
      covers: this.covers,
      uncovered: this.centre === null ? 0 : uncovered(this.centre, this.covers),
      paid,
      bank: this.bank,
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
