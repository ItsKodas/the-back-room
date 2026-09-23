import type { Coup, Side } from "./coup.js";

/**
 * When each card appears, and when it turns over.
 *
 * One function, read by both ends. The server sets the dealing phase's length
 * from it; the client animates to it. Two constants, one on each side, would
 * agree right up until somebody changed one of them — and the failure would be
 * a table that sweeps its cloth while a card is still turning over.
 *
 * It also answers the reconnect. The phase carries a deadline, so a client
 * arriving mid-coup works out where in the reveal it is:
 *
 *     elapsed = now - (deadline - schedule.total)
 *
 * and shows the cards already past their moment, rather than replaying a deal
 * that everybody else watched a moment ago.
 */

/** Between each of the opening four, sliding out face down. */
export const DEAL_GAP = 320;
/** When the player's pair turns over — as a pair, not one at a time. */
export const TURN_PLAYER = 1_500;
/** And the banker's, a beat later. */
export const TURN_BANKER = 2_150;
/** When a third card slides out, if one is drawn. */
export const THIRD_OUT = 2_900;
/** How long after the player's third the banker's follows, when both draw. */
export const THIRD_GAP = 800;
/** How long a third card lies face down before it turns. */
export const TURN_DELAY = 420;
/** How long the finished coup is held before the table settles it. */
export const HOLD = 1_000;

export interface Reveal {
  readonly side: Side;
  /** Which card of that side's hand, from nought. */
  readonly index: number;
  /** When it slides out of the shoe, face down. */
  readonly outAt: number;
  /** When it turns over. */
  readonly turnAt: number;
}

export interface Schedule {
  readonly cards: readonly Reveal[];
  /** How long the whole dealing phase runs for. */
  readonly total: number;
}

export function schedule(coup: Coup): Schedule {
  const cards: Reveal[] = [
    { side: "player", index: 0, outAt: 0, turnAt: TURN_PLAYER },
    { side: "banker", index: 0, outAt: DEAL_GAP, turnAt: TURN_BANKER },
    { side: "player", index: 1, outAt: DEAL_GAP * 2, turnAt: TURN_PLAYER },
    { side: "banker", index: 1, outAt: DEAL_GAP * 3, turnAt: TURN_BANKER },
  ];

  const playerDrew = coup.player.length > 2;
  if (playerDrew) {
    cards.push({
      side: "player",
      index: 2,
      outAt: THIRD_OUT,
      turnAt: THIRD_OUT + TURN_DELAY,
    });
  }
  if (coup.banker.length > 2) {
    /*
     * Straight after the opening pairs when the player stood, rather than
     * waiting out a gap left for a card that was never dealt. A table that
     * pauses for something that is not happening reads as a table that has
     * frozen.
     */
    const out = playerDrew ? THIRD_OUT + THIRD_GAP : THIRD_OUT;
    cards.push({ side: "banker", index: 2, outAt: out, turnAt: out + TURN_DELAY });
  }

  const last = cards.reduce((latest, one) => Math.max(latest, one.turnAt), 0);
  return { cards, total: last + HOLD };
}
