import { TableError } from "@backroom/core";

/**
 * One duel, as rules over numbers.
 *
 * Nothing in here touches an account, a socket or a seat beyond its id. What
 * it owns is the number coming down, whose turn it is, which of the two passes
 * have been spent and what is in the pot — and that is the entire game.
 *
 * Kept apart from the table because the table is about people arriving and
 * leaving and the duel is not, and because these rules are worth reading on
 * their own.
 */

/** A roll that happened: what it was rolled against, and what came up. */
export interface Rolled {
  seatId: string;
  /** The ceiling at the moment of rolling, which the felt shows beside it. */
  from: number;
  result: number;
}

/** A pass that happened, and what it cost. */
export interface Passed {
  seatId: string;
  paid: number;
}

export class Duel {
  ceiling: number;
  toRoll: string;
  pot: number;
  loserId: string | null = null;
  lastRoll: Rolled | null = null;
  lastPass: Passed | null = null;
  readonly history: Rolled[] = [];

  /** Who has spent their one pass. Never more than two entries. */
  private readonly passes = new Set<string>();
  /** What each seat has put in beyond their ante. */
  private readonly spent = new Map<string, number>();

  constructor(
    readonly a: string,
    readonly b: string,
    first: string,
    readonly opening: number,
    readonly ante: number,
    readonly passPrice: number,
  ) {
    this.ceiling = opening;
    this.toRoll = first === b ? b : a;
    this.pot = ante * 2;
  }

  get over(): boolean {
    return this.loserId !== null;
  }

  get winnerId(): string | null {
    return this.loserId === null ? null : this.other(this.loserId);
  }

  other(seatId: string): string {
    return seatId === this.a ? this.b : this.a;
  }

  hasPassed(seatId: string): boolean {
    return this.passes.has(seatId);
  }

  /** What this seat has put in beyond their ante, which is passes and nothing else. */
  spentBy(seatId: string): number {
    return this.spent.get(seatId) ?? 0;
  }

  /**
   * What this duel came to, for one seat.
   *
   * Both nets are the same figure with opposite signs, and the figure is
   * decided entirely by what the *loser* spent: the winner takes back their
   * own passes inside the pot and takes the loser's on top. Zero either way
   * until somebody has actually lost.
   */
  netFor(seatId: string): number {
    if (this.loserId === null) {
      return 0;
    }
    const stake = this.ante + this.spentBy(this.loserId);
    return seatId === this.loserId ? -stake : stake;
  }

  /**
   * Whether this seat may pass, and what it would cost.
   *
   * Asked before the chips are taken and answered without spending anything,
   * so that a player who cannot afford the price is refused with their pass
   * still in hand.
   */
  checkPass(seatId: string): number {
    this.checkTurn(seatId);
    if (this.passes.has(seatId)) {
      throw new TableError("You have already used your pass this duel.");
    }
    return this.passPrice;
  }

  pass(seatId: string): Passed {
    const paid = this.checkPass(seatId);
    this.passes.add(seatId);
    this.spent.set(seatId, this.spentBy(seatId) + paid);
    this.pot += paid;
    this.toRoll = this.other(seatId);
    const passed: Passed = { seatId, paid };
    this.lastPass = passed;
    /*
     * Cleared so the felt has one thing to show rather than two. A pass is a
     * different event from a roll and they never both describe the moment the
     * table is currently in.
     */
    this.lastRoll = null;
    return passed;
  }

  /**
   * @param draw Where the number comes from. Injected rather than taken from
   * `Math.random` because this game hands the player its whole result every
   * turn, which is exactly the run of observations that predicts the next one.
   */
  roll(seatId: string, draw: (ceiling: number) => number): Rolled {
    this.checkTurn(seatId);
    const from = this.ceiling;
    const result = draw(from);
    /*
     * Checked rather than trusted. The roller is injected, so a bad one is the
     * only way a duel could reach a state its own rules forbid — a ceiling
     * that went up, or a zero that never ends the game.
     */
    if (!Number.isInteger(result) || result < 1 || result > from) {
      throw new TableError("That roll is not possible.");
    }
    const rolled: Rolled = { seatId, from, result };
    this.lastRoll = rolled;
    this.lastPass = null;
    this.history.push(rolled);
    if (result === 1) {
      /*
       * The ceiling is left where it was rather than set to 1. A duel ends on
       * the 1 rather than continuing at it, so there is no next roll to have a
       * ceiling — and the felt wants the number that was being rolled against
       * shown beside the one that ended it.
       */
      this.loserId = seatId;
      return rolled;
    }
    this.ceiling = result;
    this.toRoll = this.other(seatId);
    return rolled;
  }

  private checkTurn(seatId: string): void {
    if (seatId !== this.a && seatId !== this.b) {
      throw new TableError("You are not in this duel.");
    }
    if (this.over) {
      throw new TableError("That duel is over.");
    }
    if (seatId !== this.toRoll) {
      throw new TableError("It is not your turn.");
    }
  }
}
