import { type Card, freshShoe } from "./cards.js";

/**
 * The tableau.
 *
 * Baccarat has no decisions in it. Both hands are played out by a fixed set of
 * rules that neither player nor dealer may depart from, which is why the table
 * this game is dealt at has no turns, no turn clock and nothing to time out —
 * once the bets are in, the coup is already decided.
 *
 * The rules below are the standard punto banco ones. They look arbitrary
 * because they are: they are the rules of the game, not a derivation, and the
 * banker's third-card table in particular is a table rather than a formula.
 * Its test is written out as the printed grid for exactly that reason.
 */

export type Side = "player" | "banker";
export type Outcome = "player" | "banker" | "tie";

/** Ace is one, two through nine are themselves, ten and the court are nothing. */
export function pointsOf(card: Card): number {
  if (card.rank === "A") {
    return 1;
  }
  const pip = Number(card.rank);
  // Ten, jack, queen and king: Number("J") is NaN, and a ten is worth nothing.
  return Number.isNaN(pip) || pip === 10 ? 0 : pip;
}

/** A hand's total, which never goes above nine. */
export function totalOf(cards: readonly Card[]): number {
  return cards.reduce((sum, card) => sum + pointsOf(card), 0) % 10;
}

/** The player draws on nought to five and stands on six and seven. */
export function playerDraws(total: number): boolean {
  return total <= 5;
}

/**
 * Whether the banker takes a third card.
 *
 * `playerThird` is the value of the card the player drew, or null if they
 * stood — and the two cases are genuinely different rules rather than one rule
 * with a special case. A player who stood leaves the banker playing the
 * player's own rule; a player who drew puts the banker on the table below.
 */
export function bankerDraws(total: number, playerThird: number | null): boolean {
  if (playerThird === null) {
    return total <= 5;
  }
  switch (total) {
    case 0:
    case 1:
    case 2:
      return true;
    case 3:
      return playerThird !== 8;
    case 4:
      return playerThird >= 2 && playerThird <= 7;
    case 5:
      return playerThird >= 4 && playerThird <= 7;
    case 6:
      return playerThird === 6 || playerThird === 7;
    default:
      // Seven stands, and eight or nine never gets here — that is a natural.
      return false;
  }
}

export interface Coup {
  readonly player: readonly Card[];
  readonly banker: readonly Card[];
  readonly playerTotal: number;
  readonly bankerTotal: number;
  readonly outcome: Outcome;
  /** Either side held eight or nine on two cards, so neither drew. */
  readonly natural: boolean;
}

/**
 * A coup dealt off the front of a given shoe.
 *
 * Separate from {@link deal} so a test can lay out a known hand. Six cards at
 * most are ever taken, and the shoe handed in is never mutated.
 */
export function coupFrom(cards: readonly Card[]): Coup {
  let at = 0;
  const next = () => cards[at++] as Card;

  /*
   * Player, banker, player, banker — the order the cards actually come out of
   * the shoe in, which is the order the reveal schedule later animates. Taken
   * one at a time rather than sliced, so the third cards below carry on from
   * wherever the opening four left off.
   */
  const playerCards: Card[] = [];
  const bankerCards: Card[] = [];
  playerCards.push(next());
  bankerCards.push(next());
  playerCards.push(next());
  bankerCards.push(next());

  const natural = totalOf(playerCards) >= 8 || totalOf(bankerCards) >= 8;

  let playerThird: number | null = null;
  if (!natural && playerDraws(totalOf(playerCards))) {
    const drawn = next();
    playerCards.push(drawn);
    playerThird = pointsOf(drawn);
  }
  if (!natural && bankerDraws(totalOf(bankerCards), playerThird)) {
    bankerCards.push(next());
  }

  const playerTotal = totalOf(playerCards);
  const bankerTotal = totalOf(bankerCards);
  const outcome: Outcome =
    playerTotal === bankerTotal ? "tie" : playerTotal > bankerTotal ? "player" : "banker";

  return { player: playerCards, banker: bankerCards, playerTotal, bankerTotal, outcome, natural };
}

/** A coup off a shoe made fresh for it, which is every coup at a real table. */
export function deal(random: () => number): Coup {
  return coupFrom(freshShoe(random));
}
