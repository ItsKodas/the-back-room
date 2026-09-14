import { TableError } from "@backroom/core";
import type { Passed, Rolled } from "./round.js";
import { Round } from "./round.js";

/**
 * One game of death roll: rounds until one player is left.
 *
 * Everybody dealt in antes once. Each round is a {@link Round} among whoever is
 * still in; rolling a 1 puts you out, and the next round starts at the reset
 * ceiling with fresh passes, opened by the next player still in after whoever
 * just went out. The last player standing takes the pot — every ante, and every
 * pass paid in any round.
 *
 * This is where the money is counted, and only counted. Nothing here moves a
 * chip: the adapter takes them and hands them over, and asks this what the
 * game came to.
 */
export class Game {
  /** Everybody dealt in, in seat order — which is also turn order. */
  readonly players: readonly string[];
  readonly ante: number;
  readonly opening: number;
  readonly passPrice: number;
  readonly resetCeiling: number;
  /** Who opened the first round. */
  readonly opener: string;
  round: Round;
  roundNumber = 1;
  /** Everybody who has gone out, in the order they went. */
  readonly out: string[] = [];

  private readonly spent = new Map<string, number>();
  private readonly passes = new Map<string, number>();

  constructor(
    players: readonly string[],
    opener: string,
    options: { ante: number; opening: number; passPrice: number; resetCeiling: number },
  ) {
    if (players.length < 2 || new Set(players).size !== players.length) {
      throw new TableError("A game needs at least two different players.");
    }
    this.players = [...players];
    this.ante = options.ante;
    this.opening = options.opening;
    this.passPrice = options.passPrice;
    this.resetCeiling = options.resetCeiling;
    this.opener = players.includes(opener) ? opener : (players[0] as string);
    this.round = new Round(this.players, this.opener, this.opening, this.passPrice);
  }

  /** How many rounds a game of this many players lasts: one fewer than there are players. */
  get rounds(): number {
    return this.players.length - 1;
  }

  /** Everybody still in, in seat order. */
  get alive(): readonly string[] {
    return this.players.filter((seatId) => !this.out.includes(seatId));
  }

  get winnerId(): string | null {
    const left = this.alive;
    return left.length === 1 ? (left[0] as string) : null;
  }

  get over(): boolean {
    return this.winnerId !== null;
  }

  /** A round has ended on a 1 and the next one has not begun. */
  get betweenRounds(): boolean {
    return this.round.over && !this.over;
  }

  /** Every ante, and every pass paid in any round. */
  get pot(): number {
    let pot = this.ante * this.players.length;
    for (const paid of this.spent.values()) {
      pot += paid;
    }
    return pot;
  }

  /** What this seat has put in beyond its ante, across every round. */
  spentBy(seatId: string): number {
    return this.spent.get(seatId) ?? 0;
  }

  /** How many passes this seat made, across every round. */
  passesBy(seatId: string): number {
    return this.passes.get(seatId) ?? 0;
  }

  /** How many rounds this seat got through: the winner got through all of them. */
  survivedBy(seatId: string): number {
    if (seatId === this.winnerId) {
      return this.rounds;
    }
    const at = this.out.indexOf(seatId);
    return at === -1 ? 0 : at;
  }

  /**
   * A pass, counted against the seat that made it.
   *
   * Called only once the chips for it are in. The round refuses a pass it will
   * not allow, before anything is counted, so a refused pass costs nothing.
   */
  pass(seatId: string): Passed {
    const passed = this.round.pass(seatId);
    this.spent.set(seatId, this.spentBy(seatId) + passed.paid);
    this.passes.set(seatId, this.passesBy(seatId) + 1);
    return passed;
  }

  roll(seatId: string, draw: (ceiling: number) => number): Rolled {
    const rolled = this.round.roll(seatId, draw);
    if (rolled.result === 1) {
      this.out.push(seatId);
    }
    return rolled;
  }

  /**
   * Starts the next round among whoever is still in.
   *
   * At the reset ceiling rather than the table's opening one, which is what
   * keeps a full table near thirty rolls rather than forty; with fresh passes,
   * so the last two play a real duel; and opened by the next player still in
   * after whoever just went out.
   */
  nextRound(): void {
    if (!this.betweenRounds) {
      throw new TableError("There is no round to start.");
    }
    const gone = this.round.outId as string;
    const from = this.players.indexOf(gone);
    let opener = this.alive[0] as string;
    for (let step = 1; step <= this.players.length; step += 1) {
      const seatId = this.players[(from + step) % this.players.length] as string;
      if (!this.out.includes(seatId)) {
        opener = seatId;
        break;
      }
    }
    this.round = new Round(this.alive, opener, this.resetCeiling, this.passPrice);
    this.roundNumber += 1;
  }

  /**
   * What the game came to, for one seat.
   *
   * The winner takes the pot back, less what they put into it; everybody else
   * is down their ante and every pass they paid. So the nets sum to zero, and a
   * pass the winner made cost them nothing. Zero for anyone until it is over,
   * and zero for a seat that was never dealt in.
   */
  netFor(seatId: string): number {
    if (!this.over || !this.players.includes(seatId)) {
      return 0;
    }
    const staked = this.ante + this.spentBy(seatId);
    return seatId === this.winnerId ? this.pot - staked : -staked;
  }
}
