/**
 * What a bank has promised, across every table that is paid from it.
 *
 * A banked table caps its stakes against the worst its own cloth can do, and
 * that is exact for one table and wrong for two. Every roulette table in the
 * building is paid from the same bank, and every chip on every one of those
 * cloths is already in it — so a table that measured the bank minus only its
 * own chips was reading another table's stakes as headroom. Those are the very
 * chips that other table's winners are owed. The second table promised them
 * again, and whichever settled last found the bank empty.
 *
 * So the bank keeps a book. Each table says what it could be asked to pay —
 * a function rather than a figure, because a cloth changes under removeSeat
 * and land without the adapter being asked — and a cap is worked out against
 * the bank less everything every *other* table could owe.
 *
 * The other half is order. Reading the bank is a round trip, and a cap is
 * only a fact if nothing moves between reading the bank and the chip landing
 * on the cloth: two tables asking at once would each count the other's chip
 * in neither place. Everything that moves this bank's chips runs through
 * `serially`, one at a time, which costs a queue a few milliseconds long and
 * buys a guarantee that is arithmetic rather than timing.
 *
 * In-process, deliberately. Every table lives in one server's memory, so the
 * book is exactly as wide as the tables are. A second process serving the
 * same bank would need this in the store instead, and the refusal a table
 * reports when the bank will not pay is what would say so.
 */
export class BankLedger {
  private readonly promises = new Map<object, () => number>();
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Runs `work` with nothing else moving this bank's chips.
   *
   * A refusal inside is the caller's to hear, and must not wedge the queue for
   * everybody behind it.
   */
  serially<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Tells the book what a table could be asked to pay, stakes back included.
   *
   * Asked again every time anybody wants a cap, so it has to answer from the
   * table as it stands rather than from what was true when this was called.
   */
  owes(table: object, owed: () => number): void {
    this.promises.set(table, owed);
  }

  /**
   * The most every table but this one could still be asked to pay.
   *
   * A table that owes nothing is dropped from the book on the way past, which
   * is what keeps a closed table from holding the bank's chips forever: its
   * cloth empties as its seats leave, and the next adapter call about a live
   * table puts it back.
   */
  owedElsewhere(table: object): number {
    return this.owedBy(table);
  }

  /**
   * The most every table on this bank could still be asked to pay.
   *
   * For taking chips out of the bank from outside any table — an admin's
   * empty — which has to leave behind what every cloth is owed, a cloth
   * nobody is sitting at included.
   */
  owedTotal(): number {
    return this.owedBy(null);
  }

  private owedBy(skip: object | null): number {
    let total = 0;
    for (const [other, owed] of this.promises) {
      if (other === skip) {
        continue;
      }
      const now = owed();
      if (now <= 0) {
        this.promises.delete(other);
        continue;
      }
      total += now;
    }
    return total;
  }

  /**
   * Takes a table out of the book for good.
   *
   * For a table that has been called off. Its cloth may still hold chips when
   * it goes — they have just been handed back, and the objects are not cleared
   * — and a promise read off that cloth would hold the bank's chips for a table
   * nobody will ever sit at again.
   */
  release(table: object): void {
    this.promises.delete(table);
  }
}

const ledgers = new WeakMap<object, BankLedger>();

/**
 * The book for this bank, shared by everything that was handed the same one.
 *
 * Keyed by the bank object rather than by adapter, because the thing two
 * tables have to agree about is the chips, not the code that deals: two
 * adapters handed one bank are one bank.
 */
export function ledgerOf(bank: object): BankLedger {
  let ledger = ledgers.get(bank);
  if (ledger === undefined) {
    ledger = new BankLedger();
    ledgers.set(bank, ledger);
  }
  return ledger;
}
