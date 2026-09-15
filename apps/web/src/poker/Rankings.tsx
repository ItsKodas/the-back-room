import type { Card as CardData } from "@backroom/game-blackjack";
import { useEffect, useRef } from "react";
import { Card } from "../blackjack/Cards.js";
import { play } from "../game/audio.js";

/**
 * What beats what, as the chart on the wall beside a table.
 *
 * Drawn with the same cards the felt deals rather than described in words. A
 * flush is a thing you recognise by looking at it, and somebody who needs this
 * chart is somebody who has not learned to yet — a row of five real cards
 * teaches that in a way "five cards of the same suit" does not.
 *
 * Strongest first, because that is the question being asked. Anybody opening
 * this is looking at their own hand and wants to know what is above it.
 */

const suits = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" } as const;

/** How the deck writes a card; this file names a few dozen by hand. */
const card = (text: string): CardData => ({
  rank: text.slice(0, -1) as CardData["rank"],
  suit: suits[text.slice(-1) as keyof typeof suits],
});

const hand = (...cards: string[]) => cards.map(card);

const RANKINGS: Array<{ title: string; note: string; cards: CardData[] }> = [
  {
    title: "Royal flush",
    note: "Ten to ace, all one suit. The one hand nothing beats.",
    cards: hand("As", "Ks", "Qs", "Js", "10s"),
  },
  {
    title: "Straight flush",
    note: "Five in a row, all one suit.",
    cards: hand("9h", "8h", "7h", "6h", "5h"),
  },
  {
    title: "Four of a kind",
    note: "All four of one rank.",
    cards: hand("Qs", "Qh", "Qd", "Qc", "7s"),
  },
  {
    title: "Full house",
    note: "Three of one rank and two of another.",
    cards: hand("8s", "8h", "8d", "3c", "3s"),
  },
  {
    title: "Flush",
    note: "Five of one suit, in any order.",
    cards: hand("Ad", "Jd", "9d", "6d", "3d"),
  },
  {
    title: "Straight",
    note: "Five in a row, suits mixed. An ace can start one as well as end it.",
    cards: hand("9c", "8d", "7s", "6h", "5c"),
  },
  {
    title: "Three of a kind",
    note: "Three of one rank.",
    cards: hand("5s", "5h", "5d", "Kc", "9s"),
  },
  {
    title: "Two pair",
    note: "Two of one rank and two of another.",
    cards: hand("Js", "Jh", "4d", "4c", "As"),
  },
  {
    title: "One pair",
    note: "Two of the same rank.",
    cards: hand("10s", "10h", "Kd", "7c", "2s"),
  },
  {
    title: "High card",
    note: "None of the above. The highest card plays.",
    cards: hand("Ah", "Jc", "8d", "5s", "3h"),
  },
];

export function Rankings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const box = useRef<HTMLDialogElement | null>(null);

  /*
   * A real dialog element, opened the way one is meant to be. It brings most of
   * what a hand-rolled overlay has to be reminded of: the page behind stops
   * taking the keyboard, focus goes in and comes back, and the backdrop is the
   * browser's own. Escape it does not bring — see below.
   */
  useEffect(() => {
    const dialog = box.current;
    if (dialog === null) {
      return;
    }
    // Sounded here rather than on the buttons: every way in and out ends as
    // this effect, so there is one place for it and no way to miss one.
    if (open && !dialog.open) {
      dialog.showModal();
      play("open");
    } else if (!open && dialog.open) {
      dialog.close();
      play("close");
    }
  }, [open]);

  return (
    <dialog
      className="pk__help"
      ref={box}
      aria-label="What beats what"
      /* Every way out goes through the same door as the button. */
      onClose={onClose}
      /*
       * Escape, said out loud rather than left to the element.
       *
       * A modal dialog is supposed to close itself on Escape and this one does
       * not — the key reaches the page and the dialog stays up. Whatever the
       * reason, a way out that works is worth five lines: this is the only
       * thing on the screen while it is open, and somebody who cannot get out
       * of it cannot play.
       */
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      /* Clicking the backdrop, which is the dialog itself either side of the
         box. The keyboard's way out is the line above, and the Close button. */
      onClick={(event) => {
        if (event.target === box.current) {
          onClose();
        }
      }}
    >
      <div className="pk__help-inner">
        <div className="pk__help-head">
          <h2 className="pk__help-title">What beats what</h2>
          <button type="button" className="pk__help-shut" data-quiet onClick={onClose}>
            Close
          </button>
        </div>

        <ol className="pk__ranks">
          {RANKINGS.map((rank, at) => (
            <li className="pk__rank" key={rank.title}>
              <span className="pk__rank-no">{at + 1}</span>
              <div className="pk__rank-said">
                <strong>{rank.title}</strong>
                <span>{rank.note}</span>
              </div>
              <div className="pk__rank-cards">
                {rank.cards.map((one) => (
                  <Card key={`${one.rank}${one.suit}`} card={one} />
                ))}
              </div>
            </li>
          ))}
        </ol>

        <p className="pk__help-note">
          Every hand is the best five cards you can make from your two and the five on the table.
          Where two people have the same hand, the higher cards in it win; where those are the same
          too, the pot is split.
        </p>
      </div>
    </dialog>
  );
}
