/**
 * The cards, and the shoe they come out of.
 *
 * Nothing here knows the rules of any game — a card is a rank and a suit, and
 * what nine makes of that is the tableau's business.
 *
 * There is no Shoe class, which is the one way this differs from blackjack's
 * file of the same name. CLAUDE.md requires a table dealt from a deck to
 * reshuffle every hand, so there is nothing to carry between coups and nothing
 * to keep: a coup is dealt off the front of a shoe that has just been made.
 */

export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export type Suit = (typeof SUITS)[number];

/** Ace is one, two through nine are themselves, ten and the court are nothing. */
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

/**
 * How many decks go into the shoe.
 *
 * Eight, because that is what the real game's odds are quoted against, and the
 * tableau below is only worth its documented edge on the distribution it was
 * worked out on. It is shuffled every coup regardless, so this is a
 * distribution rather than a shoe anybody could track.
 */
export const DECKS = 8;

export function freshDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ rank, suit });
    }
  }
  return cards;
}

/**
 * Fisher-Yates, taking its randomness from outside.
 *
 * Injected rather than reached for, so a test can deal a known coup — a game
 * whose shuffle cannot be pinned down is a game whose rules cannot be tested.
 */
export function shuffle(cards: readonly Card[], random: () => number): Card[] {
  const out = [...cards];
  for (let at = out.length - 1; at > 0; at -= 1) {
    const swap = Math.floor(random() * (at + 1));
    [out[at], out[swap]] = [out[swap] as Card, out[at] as Card];
  }
  return out;
}

/** Eight decks, shuffled. Made afresh for every coup, never kept. */
export function freshShoe(random: () => number): Card[] {
  const all: Card[] = [];
  for (let deck = 0; deck < DECKS; deck += 1) {
    all.push(...freshDeck());
  }
  return shuffle(all, random);
}
