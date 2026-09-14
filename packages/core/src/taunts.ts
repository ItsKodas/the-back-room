/**
 * What happens to the chips somebody spends being rude.
 *
 * A taunt is not a purchase. The chips do not vanish into the house and they
 * do not go straight to the person taunted — they are staked on them. The pool
 * sits beside the player who was mocked, and if that player goes on to win the
 * hand they collect every chip of it, and each taunt is thrown back at
 * whoever paid to send it.
 *
 * That shape is what keeps this inside the building's rules. Read it against
 * CLAUDE.md:
 *
 * - **Nothing mints.** A pool only ever holds chips already taken off a real
 *   account, and it can only ever pay out what it holds. There is no rate, no
 *   multiplier and no house contribution — the arithmetic is a sum of deposits.
 * - **Chips are only won from real people.** Whoever collects a pool is paid
 *   by the people who taunted them, every one of whom is a signed-in player
 *   who chose to spend it. That is why a bot and a guest can be neither end of
 *   a taunt: a bot is not a real person, and a guest has no account for the
 *   chips to come from or land in.
 * - **A taunt whose target loses is burned.** If the target loses, the pool is
 *   dropped and those chips leave circulation for good. That is the cost being
 *   real: you paid to mock somebody and it stayed paid. A taunt at a table
 *   called off before the hand finished goes back to whoever threw it, because
 *   nobody lost.
 *
 * Nothing here touches the economy or knows what game is being played. It is
 * given taunts and, when a table settles, the seats that won; it answers with
 * who should be paid what and what should be replayed at whom. The server does
 * the moving, because the server is the only authority.
 */

/** One taunt, as it sits in a pool waiting to find out if it was a mistake. */
export interface Taunt {
  /** Unique, so a client can key an animation without an index. */
  id: string;
  emoteId: string;
  /** What it cost, and so what it adds to the pool. */
  chips: number;
  /** Who threw it. Never a bot, never a guest — see the note above. */
  fromSeatId: string;
  fromUserId: string;
  fromName: string;
  /** Who it landed on, on the same terms. */
  atSeatId: string;
  atUserId: string;
  atName: string;
  at: number;
}

/** A pool that came good: its target won, so they are owed all of it. */
export interface TauntPayout {
  seatId: string;
  userId: string;
  /** The whole pool, which is the sum of what was thrown at them. */
  chips: number;
  /**
   * Every taunt they just collected on.
   *
   * Carried rather than counted because each one has to go back at the
   * particular person who sent it, with the particular picture they chose.
   */
  revenge: readonly Taunt[];
}

/** What a settled table owes, and what it swallowed. */
export interface Resolution {
  paid: readonly TauntPayout[];
  /** Thrown at somebody who did not win. These chips are gone. */
  burned: readonly Taunt[];
}

/**
 * Every unresolved taunt in the building, by the table it was thrown at.
 *
 * In memory rather than in the store, and deliberately: a pool lives for one
 * hand. The chips in it have already left their accounts, so a restart burns
 * them, which is the same thing that happens to a pool whose target loses —
 * the outcome a restart produces is one the rules already allow. Persisting it
 * would buy a guarantee nothing needs and add a write to the hottest path at
 * the table.
 */
export class Taunts {
  private readonly pools = new Map<string, Taunt[]>();

  /** Puts a paid-for taunt into the pool of whoever it was aimed at. */
  add(code: string, taunt: Taunt): void {
    const pool = this.pools.get(code);
    if (pool === undefined) {
      this.pools.set(code, [taunt]);
      return;
    }
    pool.push(taunt);
  }

  /** Everything currently staked at this table, oldest first. */
  at(code: string): readonly Taunt[] {
    return this.pools.get(code) ?? [];
  }

  /** What one seat stands to collect if they win. Zero when nobody bothered. */
  held(code: string, seatId: string): number {
    return this.at(code)
      .filter((taunt) => taunt.atSeatId === seatId)
      .reduce((total, taunt) => total + taunt.chips, 0);
  }

  /**
   * Settles every taunt at a table against the seats that won it.
   *
   * Clears the table's pool as it goes: a taunt is staked on one result, and
   * once that result is in it has either paid or burned. Leaving resolved
   * taunts behind would pay them again at the end of the next hand.
   *
   * Winners arrive as seat ids rather than accounts because that is what a
   * table deals in, and because the same person can be a different seat at a
   * different table.
   */
  resolve(code: string, winners: readonly string[]): Resolution {
    const pool = this.pools.get(code);
    if (pool === undefined || pool.length === 0) {
      return { paid: [], burned: [] };
    }
    this.pools.delete(code);

    const won = new Set(winners);
    const burned: Taunt[] = [];
    /*
     * Keyed by seat rather than by account. One person cannot hold two seats
     * at a table, and a seat is what the winners list is written in — going
     * via the account would need a second lookup to say the same thing.
     */
    const owed = new Map<string, { seatId: string; userId: string; taunts: Taunt[] }>();

    for (const taunt of pool) {
      if (!won.has(taunt.atSeatId)) {
        burned.push(taunt);
        continue;
      }
      const already = owed.get(taunt.atSeatId);
      if (already === undefined) {
        owed.set(taunt.atSeatId, {
          seatId: taunt.atSeatId,
          userId: taunt.atUserId,
          taunts: [taunt],
        });
        continue;
      }
      already.taunts.push(taunt);
    }

    const paid = [...owed.values()].map((entry) => ({
      seatId: entry.seatId,
      userId: entry.userId,
      chips: entry.taunts.reduce((total, taunt) => total + taunt.chips, 0),
      revenge: entry.taunts,
    }));

    return { paid, burned };
  }

  /**
   * Drops a table's pool without paying any of it.
   *
   * The old burn-on-close path, kept for callers that want it. When a table is
   * called off, those chips are burned, which is the same answer the rules give
   * for a taunt whose target lost — the game did not reach a result, so nobody
   * won one.
   */
  forget(code: string): void {
    this.pools.delete(code);
  }

  /**
   * Takes a table's pool away to be handed back to whoever threw each taunt.
   *
   * For a table called off before its hand reached a result. Nobody lost, so
   * nothing is burned: the taunt was staked on an outcome that never came.
   */
  refund(code: string): Taunt[] {
    const pool = this.pools.get(code) ?? [];
    this.pools.delete(code);
    return pool;
  }
}
