/**
 * Who at a table is in for the next game, and when it gets dealt.
 *
 * A table deals when the people at it say they are in: everybody ready deals
 * at once; two or more ready starts a countdown, and when it ends whoever is
 * ready is dealt. The countdown is what keeps a ready button honest — without
 * it, one player who never presses it holds everybody else's evening shut.
 *
 * Pure bookkeeping over seat ids and a clock that is passed in, so the rules
 * can be tested without a table or a timer.
 */
export class Readiness {
  /** When the countdown deals, or null when none is running. */
  countdownEndsAt: number | null = null;

  private readonly ready = new Set<string>();
  private readonly countdownMs: number;

  constructor(countdownMs: number) {
    this.countdownMs = countdownMs;
  }

  isReady(seatId: string): boolean {
    return this.ready.has(seatId);
  }

  /** How many of these seats are ready. */
  count(seated: readonly string[]): number {
    return seated.filter((seatId) => this.ready.has(seatId)).length;
  }

  set(seatId: string, ready: boolean, seated: readonly string[], now: number): void {
    if (ready) {
      this.ready.add(seatId);
    } else {
      this.ready.delete(seatId);
    }
    this.sync(seated, now);
  }

  /** Somebody stood up. */
  drop(seatId: string, seated: readonly string[], now: number): void {
    this.ready.delete(seatId);
    this.sync(seated, now);
  }

  /**
   * Starts or abandons the countdown to match who is ready.
   *
   * Never restarts one already running: if sitting down pushed the deal back,
   * sitting down and standing up again would be a way to keep a table from ever
   * dealing. And abandons it the moment fewer than two are ready, since there
   * would be nobody to deal.
   */
  sync(seated: readonly string[], now: number): void {
    const ready = this.count(seated);
    if (ready < 2) {
      this.countdownEndsAt = null;
      return;
    }
    if (ready === seated.length) {
      return;
    }
    if (this.countdownEndsAt === null) {
      this.countdownEndsAt = now + this.countdownMs;
    }
  }

  /**
   * The seats to deal now, or null if the table should not deal yet.
   *
   * Everybody ready deals at once, however much countdown is left; otherwise
   * the ready ones are dealt once the countdown has run out.
   */
  dealable(seated: readonly string[], now: number): string[] | null {
    const ready = seated.filter((seatId) => this.ready.has(seatId));
    if (ready.length < 2) {
      return null;
    }
    if (ready.length === seated.length) {
      return ready;
    }
    if (this.countdownEndsAt !== null && now >= this.countdownEndsAt) {
      return ready;
    }
    return null;
  }

  /** Everybody back to not ready: a game has ended, or a deal fell through. */
  clear(): void {
    this.ready.clear();
    this.countdownEndsAt = null;
  }
}
