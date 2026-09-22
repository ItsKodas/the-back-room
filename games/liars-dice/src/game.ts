import { TableError } from "@backroom/core";
import type { Bid, Face } from "./bid.js";
import type { Call, Resolution } from "./round.js";
import { Round } from "./round.js";

/** One finished round, for the table's own board of results. */
export interface BoardRow {
  round: number;
  bid: Bid;
  call: Call;
  caller: string;
  count: number;
  right: boolean;
  losers: readonly string[];
}

/** How many of the last rounds the board keeps. Enough to read, not a history. */
const BOARD = 6;

/**
 * One game of Liar's Dice: dice coming off people until one of them is left.
 *
 * The pot is fixed the moment the game is dealt — one ante each, and nothing is
 * staked after that — which is why there is no money code in here at all. The
 * adapter takes the antes and pays the winner; this only ever answers who won.
 */
export class Game {
  readonly players: readonly string[];
  readonly ante: number;
  readonly startingDice: number;

  round: Round;
  roundNumber = 1;
  /** The last few rounds, oldest first. */
  readonly board: BoardRow[] = [];

  private readonly dice = new Map<string, number>();
  private readonly survived = new Map<string, number>();
  private readonly bids = new Map<string, number>();
  private readonly calls = new Map<string, number>();
  private readonly exacts = new Map<string, number>();
  private readonly hits = new Map<string, number>();
  private readonly roll: () => Face;
  /** Who the next round is owed to: whoever lost a die, or the caller who did not. */
  private opener: string;

  constructor(
    players: readonly string[],
    opener: string,
    options: { ante: number; dice: number; roll: () => Face },
  ) {
    if (players.length < 2) {
      throw new TableError("A game needs two people.");
    }
    this.players = [...players];
    this.ante = options.ante;
    this.startingDice = options.dice;
    this.roll = options.roll;
    for (const seatId of players) {
      this.dice.set(seatId, options.dice);
    }
    this.opener = players.includes(opener) ? opener : (players[0] as string);
    this.round = this.deal();
  }

  // ------------------------------------------------------------- the state

  get out(): readonly string[] {
    return this.players.filter((seatId) => this.diceFor(seatId) === 0);
  }

  get live(): readonly string[] {
    return this.players.filter((seatId) => this.diceFor(seatId) > 0);
  }

  get total(): number {
    return this.live.reduce((sum, seatId) => sum + this.diceFor(seatId), 0);
  }

  get over(): boolean {
    return this.live.length <= 1;
  }

  get winnerId(): string | null {
    return this.over ? (this.live[0] ?? null) : null;
  }

  /** A round decided, with the game still going: the reveal is on the felt. */
  get betweenRounds(): boolean {
    return this.round.over && !this.over;
  }

  get pot(): number {
    return this.ante * this.players.length;
  }

  diceFor(seatId: string): number {
    return this.dice.get(seatId) ?? 0;
  }

  survivedBy(seatId: string): number {
    return this.survived.get(seatId) ?? 0;
  }

  bidsBy(seatId: string): number {
    return this.bids.get(seatId) ?? 0;
  }

  callsBy(seatId: string): number {
    return this.calls.get(seatId) ?? 0;
  }

  exactsBy(seatId: string): number {
    return this.exacts.get(seatId) ?? 0;
  }

  hitsBy(seatId: string): number {
    return this.hits.get(seatId) ?? 0;
  }

  /**
   * What this player's chips did over the whole game.
   *
   * Recorded rather than worked out later, because a pot paid whole and a hand
   * settled seat by seat are not the same arithmetic and a page reading the
   * history cannot tell which game it is looking at.
   */
  netFor(seatId: string): number {
    return seatId === this.winnerId ? this.pot - this.ante : -this.ante;
  }

  // -------------------------------------------------------------- the play

  raise(seatId: string, bid: Bid): void {
    this.round.raise(seatId, bid);
    this.bids.set(seatId, this.bidsBy(seatId) + 1);
  }

  /**
   * A call, the dice it costs, and whether that ended the game.
   *
   * The counters move before the losses are applied only because it reads
   * better; nothing depends on the order, since a call is the last thing that
   * happens in a round.
   */
  call(seatId: string, call: Call): Resolution {
    const out = this.round.call(seatId, call);
    this.calls.set(seatId, this.callsBy(seatId) + 1);
    if (call === "exact") {
      this.exacts.set(seatId, this.exactsBy(seatId) + 1);
      if (out.right) {
        this.hits.set(seatId, this.hitsBy(seatId) + 1);
      }
    }
    for (const loser of out.losers) {
      this.dice.set(loser, Math.max(0, this.diceFor(loser) - 1));
    }
    /*
     * Who opens next. Whoever lost the die, which is the player with the most
     * to prove — and when a correct exact cost everybody *but* the caller one,
     * the caller opens, for the same reason from the other end.
     */
    this.opener = out.losers.length === 1 ? (out.losers[0] as string) : out.caller;
    this.board.push({
      round: this.roundNumber,
      bid: out.bid,
      call: out.call,
      caller: out.caller,
      count: out.count,
      right: out.right,
      losers: out.losers,
    });
    if (this.board.length > BOARD) {
      this.board.shift();
    }
    return out;
  }

  /** The next round, once the reveal has had its time on the felt. */
  nextRound(): void {
    if (!this.betweenRounds) {
      return;
    }
    this.roundNumber += 1;
    this.round = this.deal();
  }

  /**
   * Fresh dice for everybody still in, and the turn to whoever is owed it.
   *
   * Rolled every round from the injected source, so nothing is carried between
   * rounds and nothing about the next deal follows from the last one.
   *
   * `order` is always table seat order restricted to who is left — never
   * rotated to start at the opener — because `Round.toAct` is a plain mutable
   * field and setting it directly is enough to make the turn start wherever it
   * needs to; the round's own `next()` walks `order` as a circular list, so it
   * rotates correctly whichever seat it starts from.
   */
  private deal(): Round {
    const live = this.live;
    const hands = new Map<string, readonly Face[]>();
    for (const seatId of live) {
      const hand: Face[] = [];
      for (let die = 0; die < this.diceFor(seatId); die += 1) {
        hand.push(this.roll());
      }
      hands.set(seatId, hand);
      this.survived.set(seatId, this.survivedBy(seatId) + 1);
    }
    const round = new Round([...live], hands);
    round.toAct = this.nextLive(this.opener, live);
    return round;
  }

  /**
   * The next live seat at or after a given one, in table order.
   *
   * Table order, not the round's order, because a named opener who has since
   * gone out is not in the round at all — this is what makes "whoever lost the
   * die opens" still mean something when the die was their last.
   */
  private nextLive(from: string, live: readonly string[]): string {
    const seated = this.players;
    const at = Math.max(0, seated.indexOf(from));
    for (let step = 0; step < seated.length; step += 1) {
      const seatId = seated[(at + step) % seated.length] as string;
      if (live.includes(seatId)) {
        return seatId;
      }
    }
    // Unreachable: deal() only ever runs with at least one live seat.
    return live[0] as string;
  }
}
