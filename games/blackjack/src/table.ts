import type { BotSkill, Seat as TableSeat, SeatIdentity, TableStatus } from "@backroom/core";
import { Escrow, MAX_SEATS, MIN_SEATS, Seating, TableError } from "@backroom/core";
import type { Card } from "./cards.js";
import { Shoe } from "./cards.js";
import { isBlackjack, value } from "./hand.js";

/**
 * One hand: a stake, some cards, and how it ended.
 *
 * A seat usually has exactly one. Splitting gives it two, each with its own
 * stake and its own fate, which is the whole reason this is a thing of its own
 * rather than fields on the seat.
 */
export interface PlayerHand {
  /** Chips staked on this hand. Zero until they bet. */
  bet: number;
  cards: Card[];
  /** Set once they can take no more cards. */
  done: boolean;
  outcome: Outcome | null;
  /** Chips handed back when the hand settled — stake included. */
  returned: number;
  /**
   * Made by splitting a pair.
   *
   * Two rules hang off this. Such a hand cannot be split again, which keeps a
   * seat to at most two hands and the felt to a width somebody can read. And
   * twenty-one on it is twenty-one rather than a blackjack, which is the rule
   * everywhere: a blackjack is dealt, not assembled.
   */
  fromSplit: boolean;
}

/** What a seat is at a blackjack table: a purse, and the hands it is playing. */
export interface Seat extends TableSeat {
  /** One, or two after a split. Never empty. */
  hands: PlayerHand[];
  /** Which of them is being played, while it is this seat's turn. */
  active: number;
  /**
   * Play money, at a table playing for none.
   *
   * Only ever touched at a for-fun table, where it is the whole economy: it
   * is made up when the seat sits down, it never reaches an account, and it
   * dies with the table. At a table playing for real chips it stays at zero
   * and the economy is asked instead.
   */
  purse: number;
  /**
   * Whether this seat has said it is done betting.
   *
   * The betting window is a clock everybody waits out, and most of the time
   * everybody has decided long before it runs down. Saying so lets the table
   * get on with it — and a table that deals when the players are ready rather
   * than when a timer says so is the difference between a game and a queue.
   *
   * Cleared whenever the stake changes, because changing your mind about the
   * bet is changing your mind about being ready.
   */
  ready: boolean;
}

export type Outcome = "blackjack" | "won" | "push" | "lost" | "bust";

export type Phase = "betting" | "playing" | "dealer" | "settled";

/** One of a seat's hands, as anybody at the table may see it. */
export interface HandView {
  bet: number;
  cards: Card[];
  total: number;
  soft: boolean;
  bust: boolean;
  done: boolean;
  outcome: Outcome | null;
  returned: number;
  fromSplit: boolean;
}

/** What one seat may see of another. */
export interface SeatView {
  /** Whether this seat has said it is finished betting. */
  ready: boolean;
  id: string;
  name: string;
  connected: boolean;
  waiting: boolean;
  isBot: boolean;
  /**
   * Playing from a profile rather than as a guest.
   *
   * Here because things outside the hand turn on it — a taunt is staked in
   * real chips, so it can only be thrown at somebody with an account for them
   * to reach. Greed's seat view has said this since it had one.
   */
  signedIn: boolean;
  avatar: string | null;
  accentColor: number | null;
  hands: HandView[];
  /** Which hand is in play, for whoever's turn it is. */
  active: number;
  /** Everything staked across every hand, which is what the seat has at risk. */
  bet: number;
  /** Play money at a for-fun table, and zero everywhere else. */
  purse: number;
}

export interface TableView {
  code: string;
  status: TableStatus;
  phase: Phase;
  seats: SeatView[];
  /** Whose turn it is, or null between hands. */
  turnSeatId: string | null;
  /**
   * When their turn runs out, and how long a turn is.
   *
   * Both, because a deadline alone cannot say how much of a turn is left as a
   * fraction — and a player who arrived mid-turn needs that to be told the
   * truth rather than that they have a whole one.
   */
  turnEndsAt: number | null;
  turnMs: number;
  hostId: string | null;
  watching: number;
  lastEvent: string | null;
  dealer: {
    cards: Card[];
    /** Of the cards shown. While one is face down, that is all it counts. */
    total: number;
    /** True while a card is still face down. */
    hidden: boolean;
  };
  minBet: number;
  maxBet: number;
  /** True when nothing at this table is played for real chips. */
  forFun: boolean;
  /**
   * How long the felt is open for bets, which the host may change.
   *
   * In the view because the control that changes it has to show which one is
   * on — and the clock a player is watching is only half the story if they
   * cannot see how long it started at.
   */
  bettingMs: number;
  /** How many may sit here, which the host chose when the table opened. */
  maxSeats: number;
  /**
   * True while the table is holding because there is nobody to play against.
   *
   * A stake already placed stays on the felt through this: the table is
   * waiting, not refusing, and the chips were taken when they were put down.
   */
  waitingForPlayers: boolean;
  /**
   * When whatever the table is waiting on runs out, or null while a hand is
   * being played — the betting window closing, or a finished hand clearing.
   *
   * Absolute, so a browser cannot drift away from the table by being slow.
   */
  deadline: number | null;
}

const MIN_BET = 100;
const MAX_BET = 10_000;
/**
 * What a seat is handed at a for-fun table, and topped back up to when it runs
 * dry. There is nothing to protect here — the point of play money is that
 * losing it costs nothing — so running out ends the fun rather than teaching
 * anybody a lesson.
 */
const FUN_PURSE = 5_000;
/**
 * How many have to be at a table before it will deal for chips.
 *
 * Chips are only won from real people, so a table paying them out waits until
 * there are real people at it. A for-fun table has no such rule: there is
 * nothing to win there, which is the entire point of it.
 */
export const MIN_FOR_CHIPS = 2;

/** The dealer takes cards to here and stops, soft or hard. */
const DEALER_STANDS = 17;

/**
 * How long the felt is open for bets before the cards come out.
 *
 * The table runs itself. Nobody deals it and nobody starts it: a round comes
 * round, anybody who has staked something is in it, and anybody who has not is
 * watching this one. That is what lets people arrive and leave in the middle of
 * an evening without the table needing a host to keep it going.
 */
export const BETTING_MS = 30_000;
/**
 * How long the host may leave the felt open for.
 *
 * Three, because a betting window is a matter of taste rather than a dial:
 * fifteen for a table that knows what it is doing, sixty for one that is
 * talking. Anything outside this is not offered — a window of two seconds is a
 * table nobody can bet at, and one of ten minutes is not a table at all.
 */
export const WINDOWS = [15_000, 30_000, 60_000] as const;
/**
 * How long before the deal the felt stops taking chips.
 *
 * Only additions stop. A stake can come off right up to the last second,
 * because a misclick you cannot undo is worse than a hand you sat out.
 *
 * The rule is for the players first — a stake that lands as the cards come out
 * is one nobody at the table had a chance to see — and it also drains the
 * moment where a bet and the deal race each other: chips are taken after the
 * table has accepted a bet, and a deal landing in between would put a seat in
 * a hand it had not paid for.
 */
export const LAST_CALL_MS = 5_000;
/** Long enough to read what happened before the felt is cleared. */
export const SETTLE_MS = 6_000;
/** How long one player may think before the table plays their hand for them. */
export const TURN_MS = 20_000;

function emptyHand(fromSplit = false): PlayerHand {
  return { bet: 0, cards: [], done: false, outcome: null, returned: 0, fromSplit };
}

/** Everything a seat has on the felt, across however many hands it is playing. */
function staked(seat: Seat): number {
  return seat.hands.reduce((total, hand) => total + hand.bet, 0);
}

/**
 * What a single card is worth for the purposes of pairing.
 *
 * Value rather than rank, which is the ordinary rule: a king and a queen are a
 * pair to split because they are both ten, even though they are not the same
 * card.
 */
function pips(card: Card): number {
  return value([card]).total;
}

/**
 * A blackjack table.
 *
 * Everybody plays the dealer rather than each other, which is what makes this
 * a useful second game: hidden information, a stake per hand, and no score to
 * be won. Three things Greed does not have, and so three places where the
 * shared parts either generalise or turn out not to.
 */
export class Table {
  readonly code: string;
  /**
   * Whether this table plays for play money.
   *
   * Fixed when the table is opened. It cannot be changed afterwards, because
   * the two are not the same game with a different label on it: one can be
   * sat at by anybody and pays nothing, and the other takes chips out of a
   * real account.
   */
  readonly forFun: boolean;
  status: TableStatus = "lobby";
  phase: Phase = "betting";
  lastEvent: string | null = null;
  dealer: Card[] = [];
  /**
   * Every stake on the felt right now, by account: bets, doubles and splits,
   * until the dealer settles them.
   */
  readonly escrow = new Escrow();
  /**
   * When the current phase runs out, as an absolute time.
   *
   * Absolute rather than a countdown, and stored rather than recomputed: every
   * bet placed is a change everybody hears about, and a deadline worked out
   * afresh each time anybody was told anything would be a window that never
   * closed.
   */
  deadline: number | null = null;
  /**
   * How long the felt stays open, and how long a result stays up.
   *
   * Fields rather than constants so a test can hurry a table that otherwise
   * takes half a minute to come round. Set once when the table is made; not
   * anything a client can reach.
   */
  bettingMs = BETTING_MS;
  /**
   * How long a seat gets to act.
   *
   * On the table beside the betting window, and for the same reason: the felt
   * has to draw it. A clock the player cannot see is a clock that folds their
   * hand without warning.
   */
  turnMs = TURN_MS;
  settleMs = SETTLE_MS;
  /**
   * How much of the betting window takes no more chips.
   *
   * A field for the same reason as the other two, and with one rule the others
   * do not have: it has to be shorter than the window it closes, or the felt
   * is shut from the moment it opens. Zero is a table with no last call at
   * all, which is what a test hurrying the window round wants.
   */
  lastCallMs = LAST_CALL_MS;
  private at = -1;

  /**
   * When the seat now to act was first asked.
   *
   * Stamped by the setter below rather than at each of the places that hand
   * the turn on, because there are several and one of them forgetting would
   * leave a player on somebody else's clock. Without it the deadline had to be
   * worked out fresh every time it was asked for — and the room asks on every
   * broadcast, so a turn's clock restarted whenever anything happened at the
   * table and the turn it was meant to end never ended.
   */
  turnSince: number | null = null;

  private get turnIndex(): number {
    return this.at;
  }

  private set turnIndex(index: number) {
    if (index !== this.at) {
      this.turnSince = index < 0 ? null : Date.now();
    }
    this.at = index;
  }

  /** When this turn runs out, or null when nobody is being waited on. */
  get turnEndsAt(): number | null {
    return this.turnSince === null ? null : this.turnSince + this.turnMs;
  }
  private readonly seating: Seating;
  private readonly shoe: Shoe;

  constructor(
    code: string,
    random: () => number = Math.random,
    forFun = false,
    /** How many may sit here. The host's choice, made when the table opened. */
    maxSeats: number = MAX_SEATS,
  ) {
    this.code = code;
    this.forFun = forFun;
    this.seating = new Seating(maxSeats);
    this.shoe = new Shoe(random);
    // Open for business from the moment it exists. There is nobody to press
    // start, because there is no start.
    this.deadline = Date.now() + this.bettingMs;
  }

  get seats(): Seat[] {
    return this.seating.seats as Seat[];
  }

  /** How many may sit here, which the host chose when this table opened. */
  get maxSeats(): number {
    return this.seating.limit;
  }

  get hostId(): string | null {
    return this.seating.hostId;
  }

  get isEmpty(): boolean {
    return this.seating.isEmpty;
  }

  /**
   * Whether the felt has stopped taking chips.
   *
   * False outside the betting phase, where there is nothing to add to anyway.
   * Worked out from the clock rather than stored, because nothing happens at
   * the table when last call arrives — no deal, no event, nothing to hang a
   * flag off. It is simply true from then on.
   */
  get lastCall(): boolean {
    if (this.phase !== "betting" || this.deadline === null) {
      return false;
    }
    return this.deadline - Date.now() <= this.lastCallMs;
  }

  /**
   * Sets how long the felt stays open, from the next round.
   *
   * Not this one. The window that is running has a deal already scheduled
   * against its deadline, and moving that deadline out from under it is how a
   * table ends up dealing a hand nobody had finished betting on — or waiting
   * on a moment that has already passed.
   */
  setWindow(ms: number): void {
    if (!WINDOWS.includes(ms as (typeof WINDOWS)[number])) {
      throw new TableError("That is not one of the windows.");
    }
    this.bettingMs = ms;
  }

  /**
   * Whether there is a bank behind this table.
   *
   * Set by whatever built it, because the table has no business knowing where
   * chips are kept. What it changes is who the counterparty is: against a bank
   * the house is real — it holds chips that real people staked — so one player
   * against the dealer is a game between people who are simply not in the room
   * at the same time.
   */
  housed = false;

  /**
   * Whether this table is allowed to deal at all.
   *
   * A table playing for chips needs company, unless it has a bank behind it.
   * It does not refuse the bet — the felt stays exactly as it is and the
   * window opens again — because the chips were taken when they were placed,
   * and clearing the felt to wait would be the table keeping them.
   */
  get canDeal(): boolean {
    return this.forFun || this.housed || this.seats.length >= MIN_FOR_CHIPS;
  }

  /** Everyone actually in the hand being played. */
  private get playing(): Seat[] {
    return this.seats.filter((seat) => !seat.waiting && staked(seat) > 0);
  }

  // ------------------------------------------------------------- the table

  join(id: string, name: string, identity: SeatIdentity | null = null): Seat {
    /*
     * A hand with nothing staked has nothing to decide, so a blackjack table
     * always plays for something — but it need not be somebody's real chips.
     * At a for-fun table the stake is play money the table invents, which is
     * a stake for the purposes of the game and no reason to ask who anybody
     * is.
     */
    const seat = this.seating.join(id, name, this.status, identity, !this.forFun) as Seat;
    this.clear(seat);
    seat.purse = this.forFun ? FUN_PURSE : 0;
    this.lastEvent = `${seat.name} sat down`;
    return seat;
  }

  addBot(id: string, name: string, skill: BotSkill): Seat {
    /*
     * Bots play for nothing, and only for nothing.
     *
     * Chips are only ever won from real people. A bot has no account to charge
     * and none to pay, so a hand won against one at a table paying real chips
     * is chips out of thin air — which is the same reason Greed refuses a bot
     * once there is a buy-in on its table.
     */
    if (!this.forFun) {
      throw new TableError("Bots only sit at tables playing for fun.");
    }
    const seat = this.seating.addBot(id, name, skill) as Seat;
    this.clear(seat);
    // A bot has no account either way, so its money is always made up.
    seat.purse = FUN_PURSE;
    return seat;
  }

  watch(socketId: string): void {
    this.seating.watch(socketId);
  }

  unwatch(socketId: string): void {
    this.seating.unwatch(socketId);
  }

  disconnect(seatId: string): void {
    const seat = this.seating.disconnect(seatId);
    if (seat === null) {
      return;
    }
    this.lastEvent = `${seat.name} dropped out`;
    // A hand does not wait for somebody who has gone.
    if (this.phase === "playing" && this.currentSeat()?.id === seatId) {
      const going = this.currentSeat() as Seat;
      // Every hand of theirs, not only the one in front of them: a table does
      // not wait on somebody who has gone, and it does not wait twice either.
      for (const hand of going.hands) {
        hand.done = true;
      }
      this.advance();
    }
  }

  reconnect(seatId: string): Seat {
    return this.seating.reconnect(seatId) as Seat;
  }

  removeSeat(seatId: string): void {
    if (this.status !== "lobby") {
      return;
    }
    /*
     * Bets are still open, so the chips on this seat are still theirs to take
     * back — they could have pressed zero a moment ago. Queued, because this
     * cannot await the bank; the adapter pays it on the next broadcast.
     */
    const leaving = this.seating.find(seatId);
    if (leaving?.userId != null && !this.forFun) {
      this.escrow.refund(leaving.userId);
    }
    this.seating.remove(seatId);
  }

  /**
   * Back to one empty hand.
   *
   * Never the purse: that outlives every hand at the table. And always exactly
   * one hand, so a seat is never without one — a split lasts a hand, not a
   * night.
   */
  private clear(seat: Seat): void {
    seat.hands = [emptyHand()];
    seat.active = 0;
  }

  // -------------------------------------------------------------- the hand

  /**
   * Places a stake.
   *
   * The chips are taken by the caller rather than here. The table knows what
   * was staked; whose chips they were is the economy's business, and a table
   * that could move a balance would be a second place money is decided.
   */
  bet(seatId: string, amount: number): void {
    if (this.phase !== "betting") {
      // This also covers somebody who arrived mid-hand: a seat is only ever
      // waiting while a hand is running, and a hand that is running is not in
      // its betting phase. There is deliberately no second check for it — a
      // branch that cannot fire is worse than no branch, because it reads as
      // though the case were handled somewhere it is not.
      throw new TableError("The hand has already been dealt.");
    }
    const seat = this.seating.find(seatId) as Seat | undefined;
    if (seat === undefined) {
      throw new TableError("You are not at this table.");
    }
    /*
     * Zero is a bet: it is taking your chips back off the felt before the
     * cards come out. Without it a misclick would stand for the whole hand,
     * because every other amount here replaces the last one and there would be
     * no amount that meant none.
     */
    const withdrawn = amount === 0;
    if (!Number.isInteger(amount) || (!withdrawn && (amount < MIN_BET || amount > MAX_BET))) {
      throw new TableError(`Bets are between ${MIN_BET} and ${MAX_BET}.`);
    }
    /*
     * At a for-fun table the purse is the only thing stopping a bet, because
     * there is no account to ask. Whatever is already staked counts as
     * available: changing a bet is not spending twice.
     */
    // Betting happens before any split, so there is exactly one hand to stake.
    const hand = seat.hands[0] as PlayerHand;
    // Last call: chips may still come off the felt, but nothing more goes on.
    if (amount > hand.bet && this.lastCall) {
      throw new TableError("Last call — you can only take chips back now.");
    }
    if (this.forFun) {
      const available = seat.purse + hand.bet;
      if (amount > available) {
        throw new TableError("You do not have that many chips.");
      }
      seat.purse = available - amount;
    }

    hand.bet = amount;
    // Changing your mind about the bet is changing your mind about being ready.
    seat.ready = false;
    this.lastEvent = withdrawn
      ? `${seat.name} took their chips back`
      : `${seat.name} bet ${amount.toLocaleString("en-US")}`;
  }

  /**
   * Deals the hand.
   *
   * No longer anybody's call. The clock deals, and the host may only hurry it
   * along — which is why there is no seat argument any more: a round belongs
   * to the table rather than to whoever happens to be sitting first.
   */
  deal(): void {
    if (this.phase !== "betting") {
      throw new TableError("That hand is already going.");
    }
    if (!this.canDeal) {
      throw new TableError("A table playing for chips needs somebody to play it with.");
    }
    if (this.seats.length < MIN_SEATS) {
      throw new TableError("Somebody has to be at the table.");
    }
    const inHand = this.playing;
    if (inHand.length === 0) {
      throw new TableError("Nobody has bet yet.");
    }

    this.shoe.refresh(this.housed);
    this.status = "playing";
    this.dealer = [];
    for (const seat of inHand) {
      // The stake survives the reset; everything about the last hand does not.
      const stake = staked(seat);
      seat.hands = [{ ...emptyHand(), bet: stake }];
      seat.active = 0;
    }

    // Two rounds, the way a dealer deals: everybody one, then everybody a second.
    for (let round = 0; round < 2; round += 1) {
      for (const seat of inHand) {
        (seat.hands[0] as PlayerHand).cards.push(this.shoe.draw());
      }
      this.dealer.push(this.shoe.draw());
    }

    // A blackjack is over before it begins.
    for (const seat of inHand) {
      const hand = seat.hands[0] as PlayerHand;
      if (isBlackjack(hand.cards)) {
        hand.done = true;
      }
    }

    this.phase = "playing";
    this.lastEvent = "Cards out";
    // Nothing to count down to while a hand is being played: the clock on a
    // turn belongs to whoever is taking it, not to the table.
    this.deadline = null;
    this.turnIndex = -1;
    this.advance();
  }

  /**
   * What happens when the betting window closes.
   *
   * Somebody staked something, so there is a hand to deal; nobody did, so the
   * felt opens again. A table with nobody betting at it simply keeps offering,
   * which is what an empty table in a real room does too.
   */
  /**
   * Says this seat has finished betting, or has changed its mind.
   *
   * A seat with nothing on the felt may still be ready: that is how somebody
   * sits a hand out without holding the table up behind them.
   */
  setReady(seatId: string, ready: boolean): void {
    if (this.phase !== "betting") {
      throw new TableError("There is nothing to be ready for.");
    }
    const seat = this.seating.find(seatId) as Seat | undefined;
    if (seat === undefined) {
      throw new TableError("You are not at this table.");
    }
    seat.ready = ready;
    this.lastEvent = ready ? `${seat.name} is ready` : `${seat.name} is thinking again`;
  }

  /**
   * Whether the table can stop waiting for the clock.
   *
   * Everybody who is actually here has to have said so, and somebody has to
   * have bet — otherwise the first person to click ready at an empty felt
   * would deal a hand nobody is in. Somebody who has dropped out is not asked:
   * a table held up by an empty chair is a table that never deals again.
   */
  get everyoneReady(): boolean {
    if (this.phase !== "betting" || !this.canDeal) {
      return false;
    }
    /*
     * Everybody who could actually press it. A bot never will — it has no
     * opinion about when to deal — and somebody who has dropped out never will
     * either, so waiting on either is waiting for ever. Both are dealt in;
     * neither gets a say in when.
     */
    const here = this.seats.filter(
      (seat) => !seat.waiting && seat.connected && !seat.isBot,
    );
    if (here.length === 0) {
      return false;
    }
    if (!here.some((seat) => staked(seat) > 0)) {
      return false;
    }
    return here.every((seat) => seat.ready);
  }

  closeBetting(): void {
    if (this.phase !== "betting") {
      return;
    }
    /*
     * Nobody to play against, so the clock goes round again with everything
     * left where it is. Deliberately not beginBetting: that clears the felt,
     * and a stake was taken from an account when it was placed — clearing it
     * here would be the table quietly pocketing it.
     */
    if (!this.canDeal) {
      this.deadline = Date.now() + this.bettingMs;
      this.lastEvent = "Waiting for another player";
      return;
    }
    if (this.playing.length === 0) {
      this.beginBetting();
      return;
    }
    this.deal();
  }

  currentSeat(): Seat | null {
    if (this.phase !== "playing" || this.turnIndex < 0) {
      return null;
    }
    return this.playing[this.turnIndex] ?? null;
  }

  /** The hand actually being played, which after a split is one of two. */
  currentHand(): PlayerHand | null {
    const seat = this.currentSeat();
    return seat?.hands[seat.active] ?? null;
  }

  hit(seatId: string): void {
    const { seat, hand } = this.requireTurn(seatId);
    hand.cards.push(this.shoe.draw());
    const worth = value(hand.cards);
    if (worth.bust) {
      hand.done = true;
      hand.outcome = "bust";
      this.lastEvent = `${seat.name} bust on ${worth.total}`;
      this.advance();
      return;
    }
    if (worth.total === 21) {
      // Nothing left to decide at twenty-one.
      hand.done = true;
      this.advance();
    }
  }

  stand(seatId: string): void {
    const { hand } = this.requireTurn(seatId);
    hand.done = true;
    this.advance();
  }

  /**
   * Splits a pair into two hands, each with its own stake.
   *
   * The house rules this settles on, all of them ordinary: a pair is two cards
   * of the same *value*, so a king and a queen count; a hand made this way
   * cannot be split again, which holds a seat to two hands and the felt to a
   * width somebody can read; and split aces get one card each and are then
   * done, because two live ace hands is the one thing every house forbids.
   *
   * Returns the extra chips owed, for the caller to take — the same shape as
   * doubling, and for the same reason: the table knows what was staked, and
   * whose chips they were is the economy's business.
   */
  split(seatId: string): number {
    const { seat, hand } = this.requireTurn(seatId);
    if (hand.cards.length !== 2) {
      throw new TableError("You can only split your first two cards.");
    }
    if (hand.fromSplit) {
      throw new TableError("A split hand cannot be split again.");
    }
    const [first, second] = hand.cards as [Card, Card];
    if (pips(first) !== pips(second)) {
      throw new TableError("Those two do not make a pair.");
    }

    const extra = hand.bet;
    if (this.forFun) {
      if (seat.purse < extra) {
        throw new TableError("You cannot cover a split.");
      }
      seat.purse -= extra;
    }

    const made: PlayerHand = { ...emptyHand(true), bet: extra, cards: [second] };
    hand.cards = [first];
    hand.fromSplit = true;
    hand.cards.push(this.shoe.draw());
    made.cards.push(this.shoe.draw());
    seat.hands.splice(seat.active + 1, 0, made);

    if (pips(first) === 11) {
      // One card each and no more: the rule that stops a split pair of aces
      // from being the best hand in the game.
      hand.done = true;
      made.done = true;
    }

    this.lastEvent = `${seat.name} split`;
    // The first of the two may already be finished — a split ace, or a
    // twenty-one — so ask rather than assume there is still a decision here.
    if (hand.done) {
      this.advance();
    }
    return extra;
  }

  /**
   * Doubles the stake for exactly one more card.
   *
   * First two cards only, which is the rule everywhere and also the only point
   * at which doubling is a decision rather than a mistake. Returns the extra
   * chips owed, for the caller to take.
   */
  double(seatId: string): number {
    const { seat, hand } = this.requireTurn(seatId);
    if (hand.cards.length !== 2) {
      throw new TableError("You can only double on your first two cards.");
    }
    const extra = hand.bet;
    if (this.forFun) {
      if (seat.purse < extra) {
        throw new TableError("You cannot cover a double.");
      }
      seat.purse -= extra;
    }
    hand.bet += extra;
    hand.cards.push(this.shoe.draw());
    hand.done = true;
    if (value(hand.cards).bust) {
      hand.outcome = "bust";
    }
    this.lastEvent = `${seat.name} doubled`;
    this.advance();
    return extra;
  }

  /**
   * The clock ran out on somebody's decision, so the table takes it for them.
   *
   * Standing rather than folding: it is the choice that costs them least, and
   * a table that keeps moving is the whole point of a clock. Silence is not a
   * reason to lose a stake.
   */
  timeout(seatId: string): void {
    if (this.phase !== "playing" || this.currentSeat()?.id !== seatId) {
      return;
    }
    const seat = this.currentSeat() as Seat;
    this.lastEvent = `${seat.name} ran out of time`;
    // Every hand of theirs: a split leaves two, and taking only the first
    // would hand the clock straight back to somebody who is not there.
    for (const hand of seat.hands) {
      hand.done = true;
    }
    this.advance();
  }

  private requireTurn(seatId: string): { seat: Seat; hand: PlayerHand } {
    const seat = this.currentSeat();
    if (seat === null || seat.id !== seatId) {
      throw new TableError("It is not your turn.");
    }
    const hand = seat.hands[seat.active];
    if (hand === undefined || hand.done) {
      throw new TableError("You are done for this hand.");
    }
    return { seat, hand };
  }

  /**
   * On to the next hand with a decision left, or to the dealer.
   *
   * A seat's own hands first. A split is played out before the table moves on,
   * which is both how it is dealt at a real table and the only order that lets
   * somebody think about their second hand while the first is still in view.
   */
  private advance(): void {
    const inHand = this.playing;
    const seat = inHand[this.turnIndex];
    if (seat?.connected) {
      const next = seat.hands.findIndex((hand, index) => index > seat.active && !hand.done);
      if (next !== -1) {
        seat.active = next;
        return;
      }
    }

    for (let index = this.turnIndex + 1; index < inHand.length; index += 1) {
      const other = inHand[index] as Seat;
      const waiting = other.hands.findIndex((hand) => !hand.done);
      if (other.connected && waiting !== -1) {
        this.turnIndex = index;
        other.active = waiting;
        return;
      }
    }

    this.turnIndex = -1;
    this.playDealer();
  }

  /**
   * The dealer's turn, which is not a decision — the rules play it.
   *
   * Skipped entirely when everybody has bust: there is nothing left to beat,
   * and dealing the house cards it does not need only invites an argument
   * about what it drew.
   */
  private playDealer(): void {
    this.phase = "dealer";
    const contenders = this.playing.flatMap((seat) =>
      seat.hands.filter((hand) => hand.outcome !== "bust"),
    );
    if (contenders.length > 0) {
      while (value(this.dealer).total < DEALER_STANDS) {
        this.dealer.push(this.shoe.draw());
      }
    }
    this.settle();
  }

  private settle(): void {
    const dealer = value(this.dealer);
    const dealerBlackjack = isBlackjack(this.dealer);

    // Every hand on its own account: after a split one can win while the other
    // loses, which is the entire point of splitting.
    for (const hand of this.playing.flatMap((seat) => seat.hands)) {
      const mine = value(hand.cards);

      if (hand.outcome === "bust") {
        // Already lost, and lost before the dealer drew: the house keeps it
        // whatever happens next, which is the whole edge.
        hand.returned = 0;
        continue;
      }

      // A blackjack is dealt, not assembled, so twenty-one on a split hand is
      // twenty-one and pays like it.
      if (!hand.fromSplit && isBlackjack(hand.cards)) {
        if (dealerBlackjack) {
          hand.outcome = "push";
          hand.returned = hand.bet;
        } else {
          // Three to two, with the stake back alongside it.
          hand.outcome = "blackjack";
          hand.returned = hand.bet + Math.floor(hand.bet * 1.5);
        }
        continue;
      }

      if (dealerBlackjack || (!dealer.bust && dealer.total > mine.total)) {
        hand.outcome = "lost";
        hand.returned = 0;
        continue;
      }

      if (!dealer.bust && dealer.total === mine.total) {
        hand.outcome = "push";
        hand.returned = hand.bet;
        continue;
      }

      hand.outcome = "won";
      hand.returned = hand.bet * 2;
    }

    /*
     * Play money is paid here rather than by the adapter, because there is
     * nobody to ask: the economy never hears about a for-fun table, so the
     * table is the only thing that can hand anything back.
     */
    if (this.forFun) {
      for (const seat of this.playing) {
        seat.purse += seat.hands.reduce((total, hand) => total + hand.returned, 0);
      }
    }

    // The dealer has played, so every stake on the felt now belongs to its
    // result rather than to whichever account it came from.
    this.escrow.settle();
    this.phase = "settled";
    this.status = "over";
    /*
     * How long the hand stays up. It is a deadline rather than a duration so
     * that somebody opening the table halfway through the wait sees the same
     * few seconds everybody else is looking at, rather than a fresh count.
     */
    this.deadline = Date.now() + this.settleMs;
    this.lastEvent = dealer.bust ? `Dealer bust on ${dealer.total}` : `Dealer has ${dealer.total}`;
  }

  /**
   * Opens the felt for the next round.
   *
   * Everyone at the table is dealt in, whenever they arrived — somebody who
   * sat down in the middle of the last hand has been waiting for exactly this
   * moment, and there is no host to notice them.
   */
  beginBetting(): void {
    for (const seat of this.seats) {
      this.clear(seat);
      // A new hand is a new decision: nobody carries "ready" into it.
      seat.ready = false;
      /*
       * Topped back up rather than shown the door. There is nothing to protect
       * at a table playing for nothing — the point of play money is that
       * losing it costs nothing — so running out should end a hand, not the
       * evening.
       */
      if (this.forFun && seat.purse < MIN_BET) {
        seat.purse = FUN_PURSE;
      }
    }
    this.seating.dealInWaiting();
    this.dealer = [];
    this.phase = "betting";
    this.status = "lobby";
    this.turnIndex = -1;
    this.deadline = Date.now() + this.bettingMs;
    this.lastEvent = "Place your bets";
  }

  // -------------------------------------------------------------- the view

  /**
   * The table as one seat may see it.
   *
   * The dealer's second card is not in this until the dealer plays. It is left
   * out here rather than hidden in the browser, because a card that reaches
   * the client has been dealt to everybody whatever the markup says — which is
   * the entire reason the server learned to describe a table per seat.
   */
  view(_forSeatId: string | null = null): TableView {
    const hidden = this.phase === "betting" || this.phase === "playing";
    const shown = hidden ? this.dealer.slice(0, 1) : this.dealer;
    const current = this.currentSeat();

    return {
      code: this.code,
      status: this.status,
      phase: this.phase,
      hostId: this.hostId,
      watching: this.seating.watching,
      lastEvent: this.lastEvent,
      turnSeatId: current?.id ?? null,
      turnEndsAt: this.turnEndsAt,
      turnMs: this.turnMs,
      minBet: MIN_BET,
      maxBet: MAX_BET,
      forFun: this.forFun,
      deadline: this.deadline,
      bettingMs: this.bettingMs,
      maxSeats: this.seating.limit,
      waitingForPlayers: !this.canDeal,
      dealer: {
        cards: shown,
        total: value(shown).total,
        hidden: hidden && this.dealer.length > 1,
      },
      seats: this.seats.map((seat) => ({
        id: seat.id,
        name: seat.name,
        ready: seat.ready,
        connected: seat.connected,
        waiting: seat.waiting,
        isBot: seat.isBot,
        signedIn: seat.userId !== null,
        avatar: seat.avatar,
        accentColor: seat.accentColor,
        active: seat.active,
        bet: staked(seat),
        purse: seat.purse,
        hands: seat.hands.map((hand) => {
          const worth = value(hand.cards);
          return {
            bet: hand.bet,
            cards: hand.cards,
            total: worth.total,
            soft: worth.soft,
            bust: worth.bust,
            done: hand.done,
            outcome: hand.outcome,
            returned: hand.returned,
            fromSplit: hand.fromSplit,
          };
        }),
      })),
    };
  }
}
