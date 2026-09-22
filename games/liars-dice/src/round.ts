import { TableError } from "@backroom/core";
import type { Bid, Face } from "./bid.js";
import { beats, countOf, isFace, says } from "./bid.js";

/** The two ways a round can end. Both of them turn every cup over. */
export type Call = "liar" | "exact";

/** One player's dice, once there is no longer any reason to hide them. */
export interface RevealedHand {
  seatId: string;
  dice: readonly Face[];
}

/** How a round ended, and what it cost whom. */
export interface Resolution {
  call: Call;
  caller: string;
  /** The bid that was called. */
  bid: Bid;
  bidder: string;
  /** What was actually on the table, ones counted as the face bid. */
  count: number;
  /** Liar: the bid was good. Exact: the count was precisely the bid. */
  right: boolean;
  /** Who lost a die for it. */
  losers: readonly string[];
  /** Every hand in the round, face up. */
  hands: readonly RevealedHand[];
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/**
 * One round of bidding, from the deal to the call that ends it.
 *
 * The hands are handed in rather than rolled here: where the dice come from is
 * the table's business and has to be injectable, because a game that hands
 * every player its whole result at a reveal is a game whose generator must not
 * be `Math.random`.
 */
export class Round {
  /** Everybody still in, in turn order. */
  readonly order: readonly string[];
  /** How many dice are on the table, which is the ceiling on any bid. */
  readonly total: number;

  bid: Bid | null = null;
  bidder: string | null = null;
  toAct: string;
  resolution: Resolution | null = null;

  private readonly hands: ReadonlyMap<string, readonly Face[]>;

  constructor(
    order: readonly string[],
    hands: ReadonlyMap<string, readonly Face[]>,
    opener?: string,
  ) {
    if (order.length < 2) {
      throw new TableError("A round needs two people.");
    }
    if (opener !== undefined && !order.includes(opener)) {
      throw new TableError("The opener is not in this round.");
    }
    this.order = [...order];
    this.hands = hands;
    this.toAct = opener ?? (order[0] as string);
    let total = 0;
    for (const seatId of order) {
      total += hands.get(seatId)?.length ?? 0;
    }
    this.total = total;
  }

  get over(): boolean {
    return this.resolution !== null;
  }

  handFor(seatId: string): readonly Face[] | null {
    return this.hands.get(seatId) ?? null;
  }

  position(seatId: string): number {
    return this.order.indexOf(seatId);
  }

  private next(from: string): string {
    const at = this.order.indexOf(from);
    return this.order[(at + 1) % this.order.length] as string;
  }

  /**
   * Whoever's turn it is, refusing anything that is not theirs to do.
   *
   * Every refusal is a `TableError`, because every one of them is shown to the
   * player who tried it.
   */
  private mine(seatId: string): void {
    if (this.over) {
      throw new TableError("This round is over.");
    }
    if (seatId !== this.toAct) {
      throw new TableError("It is not your turn.");
    }
  }

  /** A bigger claim, and the turn moves on. */
  raise(seatId: string, bid: Bid): void {
    this.mine(seatId);
    if (!isFace(bid.face)) {
      throw new TableError("That is not a face on a die.");
    }
    if (!Number.isInteger(bid.count) || bid.count < 1) {
      throw new TableError("A bid names a whole number of dice.");
    }
    if (bid.count > this.total) {
      const many = WORDS[this.total] ?? String(this.total);
      throw new TableError(`There are only ${many} dice on the table.`);
    }
    if (!beats(bid, this.bid)) {
      const standing = this.bid;
      throw new TableError(
        standing === null
          ? "That is not a bid."
          : `${says(bid)} is not higher than the bid of ${says(standing)}.`,
      );
    }
    this.bid = bid;
    this.bidder = seatId;
    this.toAct = this.next(seatId);
  }

  /**
   * Every cup up, and the arithmetic settles it.
   *
   * Liar takes a die from exactly one of the two people in the call, which is
   * what makes it impossible for a round to leave nobody holding dice. A
   * correct exact takes one from everybody *except* the caller, for the same
   * reason from the other end.
   */
  call(seatId: string, call: Call): Resolution {
    this.mine(seatId);
    const bid = this.bid;
    const bidder = this.bidder;
    if (bid === null || bidder === null) {
      throw new TableError("There is nothing to call yet.");
    }
    const count = countOf(this.order.map((id) => this.hands.get(id) ?? []), bid.face);
    const right = call === "liar" ? count >= bid.count : count === bid.count;
    const losers =
      call === "liar"
        ? [right ? seatId : bidder]
        : right
          ? this.order.filter((id) => id !== seatId)
          : [seatId];
    this.resolution = {
      call,
      caller: seatId,
      bid,
      bidder,
      count,
      right,
      losers,
      hands: this.order.map((id) => ({ seatId: id, dice: this.hands.get(id) ?? [] })),
    };
    return this.resolution;
  }
}
