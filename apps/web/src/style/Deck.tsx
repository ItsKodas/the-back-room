import { Card, FaceDown } from "../cards/Cards.js";
import type { Card as CardData, Rank, Suit } from "../cards/deck.js";
import { RANKS, SUITS } from "../cards/deck.js";
/*
 * Only for `.bj-hand` — the hand itself is blackjack's own layout, and its
 * cards below are the same shared deck Cards.tsx already draws and styles.
 */
import "../blackjack/blackjack.css";

/**
 * The deck, all of it.
 *
 * Fifty-two cards drawn from one geometry, which is only worth anything if
 * every one of them lines up — so here they all are, in suit order, at the
 * size they are dealt at and again large enough to argue about. A layout that
 * is wrong on the seven of clubs and right everywhere else is exactly the kind
 * of thing nobody finds in a game.
 */

const at = (rank: Rank, suit: Suit): CardData => ({ rank, suit });

export function Deck() {
  return (
    <section className="section" aria-label="Playing cards">
      <h2 className="section__title">Playing cards</h2>
      <p className="section__note">
        Traditional faces: the index in two opposite corners, the pips in the arrangement a real
        deck uses. Drawn in a 100×140 box, so one card is one shape at any size.
      </p>

      {SUITS.map((suit) => (
        <div key={suit} className="deck__row">
          <span className="deck__suit">{suit}</span>
          <div className="deck__cards">
            {RANKS.map((rank) => (
              <Card key={`${rank}${suit}`} card={at(rank, suit)} />
            ))}
          </div>
        </div>
      ))}

      <p className="section__note">Large enough to check the alignment, and the back.</p>
      <div className="deck__big">
        <Card card={at("A", "spades")} />
        <Card card={at("7", "hearts")} />
        <Card card={at("10", "diamonds")} />
        <Card card={at("Q", "clubs")} />
        <Card card={at("K", "hearts")} />
        <FaceDown />
      </div>

      <p className="section__note">
        As they sit on a felt: three flat, then a hand that has outgrown its row.
      </p>
      <div className="deck__hands">
        <span className="bj-hand">
          <Card card={at("K", "hearts")} />
          <Card card={at("9", "clubs")} />
          <Card card={at("A", "spades")} />
        </span>
        <span className="bj-hand bj-hand--tight">
          <Card card={at("4", "spades")} />
          <Card card={at("9", "clubs")} />
          <Card card={at("A", "hearts")} />
          <Card card={at("4", "hearts")} />
          <Card card={at("5", "spades")} />
        </span>
        <span className="bj-hand">
          <Card card={at("3", "diamonds")} />
          <FaceDown />
        </span>
      </div>
    </section>
  );
}
