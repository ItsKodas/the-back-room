import { TableError } from "@backroom/core";

/**
 * One round, as rules over numbers.
 *
 * A round is the duel death roll always was, played among however many are
 * still in: turns go round in seat order, each roll sets the next ceiling, and
 * the first 1 ends it. What a round knows is its turn order, the ceiling, whose
 * turn it is, which passes have been spent, and whether the roll in hand
 * arrived by a pass. It knows nothing about chips — the game counts those — and
 * nothing about seats beyond their ids.
 */

/** A roll that happened: what it was rolled against, and what came up. */
export interface Rolled {
  seatId: string;
  /** The ceiling at the moment of rolling, which the felt shows beside it. */
  from: number;
  result: number;
}

/** A pass that happened: who made it, what it cost, and who it landed on. */
export interface Passed {
  seatId: string;
  paid: number;
  to: string;
}

export class Round {
  /** Everybody in this round, in the order the roll travels. */
  readonly order: readonly string[];
  /** The ceiling this round began at. */
  readonly start: number;
  readonly passPrice: number;
  ceiling: number;
  toRoll: string;
  /**
   * The seat the roll in hand was passed to, while it is still in their hand.
   * That seat has to roll it: a pass cannot be handed on.
   */
  passedTo: string | null = null;
  /** Who rolled the 1, once somebody has. */
  outId: string | null = null;
  lastRoll: Rolled | null = null;
  lastPass: Passed | null = null;
  readonly history: Rolled[] = [];

  /** Who has spent their pass this round. A fresh round starts with none spent. */
  private readonly spent = new Set<string>();

  constructor(order: readonly string[], opener: string, start: number, passPrice: number) {
    if (order.length < 2 || new Set(order).size !== order.length) {
      throw new TableError("A round needs at least two different players.");
    }
    if (!Number.isInteger(start) || start < 2) {
      throw new TableError("A round has to start above one.");
    }
    this.order = [...order];
    this.start = start;
    this.passPrice = passPrice;
    this.ceiling = start;
    this.toRoll = order.includes(opener) ? opener : (order[0] as string);
  }

  get over(): boolean {
    return this.outId !== null;
  }

  /** Where a seat sits in the turn order, or -1 if it is not in this round. */
  position(seatId: string): number {
    return this.order.indexOf(seatId);
  }

  /** Who the roll goes to after this seat. */
  next(seatId: string): string {
    return this.order[(this.position(seatId) + 1) % this.order.length] as string;
  }

  holdsPass(seatId: string): boolean {
    return this.order.includes(seatId) && !this.spent.has(seatId);
  }

  /** Who still holds a pass, as a bitmask over positions — the solver's language. */
  holders(): number {
    let bits = 0;
    this.order.forEach((seatId, at) => {
      if (!this.spent.has(seatId)) {
        bits |= 1 << at;
      }
    });
    return bits;
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
    if (this.passedTo === seatId) {
      /*
       * The rule that keeps the pass worth anything. A pass that could be handed
       * straight back always would be, by a player it helps exactly as much as
       * it helped the passer — so nobody who had worked that out would ever pass
       * first, and the pass would be a button only a beginner presses.
       */
      throw new TableError("That roll was passed to you, so you have to roll it.");
    }
    if (this.spent.has(seatId)) {
      throw new TableError("You have already used your pass this round.");
    }
    return this.passPrice;
  }

  pass(seatId: string): Passed {
    const paid = this.checkPass(seatId);
    this.spent.add(seatId);
    const to = this.next(seatId);
    this.toRoll = to;
    this.passedTo = to;
    const passed: Passed = { seatId, paid, to };
    this.lastPass = passed;
    /*
     * Cleared so the felt has one thing to show rather than two. A pass is a
     * different event from a roll and they never both describe the moment the
     * table is in.
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
     * only way a round could reach a state its own rules forbid — a ceiling
     * that went up, or a zero that never ends it.
     */
    if (!Number.isInteger(result) || result < 1 || result > from) {
      throw new TableError("That roll is not possible.");
    }
    const rolled: Rolled = { seatId, from, result };
    this.lastRoll = rolled;
    this.lastPass = null;
    this.passedTo = null;
    this.history.push(rolled);
    if (result === 1) {
      /*
       * The ceiling is left where it was rather than set to 1. A round ends on
       * the 1 rather than continuing at it, and the felt wants the number that
       * was being rolled against shown beside the one that ended it.
       */
      this.outId = seatId;
      return rolled;
    }
    this.ceiling = result;
    this.toRoll = this.next(seatId);
    return rolled;
  }

  private checkTurn(seatId: string): void {
    if (!this.order.includes(seatId)) {
      throw new TableError("You are not in this round.");
    }
    if (this.over) {
      throw new TableError("That round is over.");
    }
    if (seatId !== this.toRoll) {
      throw new TableError("It is not your turn.");
    }
  }
}
