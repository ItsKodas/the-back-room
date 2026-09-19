/**
 * The balance while balls are in the air.
 *
 * Three facts, kept apart because they arrive at different times: the balance
 * the first ball of a run was pressed from, the server's latest word on it,
 * and what is still in the air — stakes not yet answered, and wins answered
 * but not yet landed. What is shown is the latest fact less what is in the
 * air, so a stake goes on the press and a win arrives with its ball, never
 * before.
 */
export class Books {
  private base: number | null = null;
  private server: number | null = null;
  private readonly pending = new Map<string, number>();
  private readonly unlanded = new Map<string, number>();

  /** `balance` is what the player has now; only the first press of a run keeps it. */
  press(id: string, stake: number, balance: number): void {
    if (this.idle()) {
      this.base = balance;
      this.server = null;
    }
    this.pending.set(id, stake);
  }

  /**
   * The server paid. Its balance is a fact even for a ball this page had given
   * up waiting on: that ball was paid, and the figure has to say so.
   *
   * Assumes acks arrive in press order, which only holds because every paid
   * drop is serialized through one `BankLedger` on the server and socket.io
   * preserves per-connection message order — not because this class enforces
   * it itself.
   */
  answer(id: string, balance: number, won: number): void {
    const known = this.pending.delete(id);
    this.server = balance;
    if (known && won > 0) {
      this.unlanded.set(id, won);
    }
  }

  refuse(id: string): void {
    this.pending.delete(id);
  }

  /** No answer in time. The stake goes back on the screen; a late answer will correct it. */
  giveUp(id: string): void {
    this.pending.delete(id);
  }

  land(id: string): void {
    this.unlanded.delete(id);
  }

  /** The balance to show, or null when there is nothing in play to adjust it. */
  shown(): number | null {
    const from = this.server ?? this.base;
    if (from === null) {
      return null;
    }
    let out = from;
    for (const stake of this.pending.values()) {
      out -= stake;
    }
    for (const won of this.unlanded.values()) {
      out -= won;
    }
    return out;
  }

  /** Call after showing `shown()`: once nothing is in the air, the account's own figure is the truth again. */
  settle(): void {
    if (this.idle()) {
      this.base = null;
      this.server = null;
    }
  }

  idle(): boolean {
    return this.pending.size === 0 && this.unlanded.size === 0;
  }

  /** Balls this page is still waiting on the server for. */
  inAir(): number {
    return this.pending.size;
  }
}
