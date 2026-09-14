/** Chips that left one account for this round, and have not come back or been decided. */
export interface Stake {
  userId: string;
  chips: number;
}

/**
 * What a table is holding for the people at it.
 *
 * Every chip here has already left an account, and until the round is decided
 * it still belongs to that account. That is the whole of why this exists: a
 * table that is called off, or a seat that goes while bets can still be
 * changed, has to be able to say whose chips are on the felt — and by then the
 * seat that put them there may be gone, which is why it is keyed by account.
 *
 * Nothing here is asynchronous, on purpose. A table can empty it before its
 * first await, which is what makes draining it on every broadcast exactly-once
 * rather than a way to pay somebody twice.
 *
 * Play money never comes here. A for-fun table's chips are the table's own and
 * die with it; putting them in an escrow would be one step from paying them
 * into an account.
 */
export class Escrow {
  private readonly held = new Map<string, number>();
  private queued: Stake[] = [];
  private shut = false;

  /** Whether the table has been called off, after which nothing more is held. */
  get closed(): boolean {
    return this.shut;
  }

  /** Everything held across every account. */
  get total(): number {
    let total = 0;
    for (const chips of this.held.values()) {
      total += chips;
    }
    return total;
  }

  /** What is waiting to be handed back, without taking it. */
  get due(): readonly Stake[] {
    return this.queued;
  }

  heldBy(userId: string): number {
    return this.held.get(userId) ?? 0;
  }

  /**
   * Records chips that have just been taken.
   *
   * False once the table is closed. The caller then gives back what it took:
   * the void has already paid out everything it knew about, and this stake
   * arrived too late to be part of it.
   */
  hold(userId: string, chips: number): boolean {
    if (this.shut) {
      return false;
    }
    if (chips > 0) {
      this.held.set(userId, this.heldBy(userId) + chips);
    }
    return true;
  }

  /**
   * Chips that went back by an ordinary route: a lowered bet, a take-back, a refund.
   *
   * Returns the chips it actually removed (never more than the account held; 0 if it held nothing),
   * so nothing is handed back twice.
   */
  release(userId: string, chips: number): number {
    const had = this.heldBy(userId);
    const removed = Math.min(had, chips);
    const left = had - removed;
    if (left > 0) {
      this.held.set(userId, left);
    } else {
      this.held.delete(userId);
    }
    return removed;
  }

  /**
   * Queues an account's chips to be handed back.
   *
   * A queue because the moment somebody leaves is a synchronous one — a seat
   * is removed without anybody to await the economy — so the chips are owed
   * here and paid on the table's next broadcast.
   */
  refund(userId: string, chips?: number): void {
    const has = this.heldBy(userId);
    const moving = Math.min(has, chips ?? has);
    if (moving <= 0) {
      return;
    }
    this.release(userId, moving);
    this.queued.push({ userId, chips: moving });
  }

  /** Empties the queue. Call before the first await. */
  takeDue(): Stake[] {
    return this.queued.splice(0);
  }

  /**
   * The round is decided, so its stakes now belong to the result.
   *
   * The queue is left alone: chips owed to a leaver are owed whatever the
   * round came to.
   */
  settle(): Stake[] {
    const stakes = [...this.held].map(([userId, chips]) => ({ userId, chips }));
    this.held.clear();
    return stakes;
  }

  /** Calls the table off: everything owed, queued or held, and nothing held again. */
  close(): Stake[] {
    this.shut = true;
    return [...this.takeDue(), ...this.settle()];
  }
}
