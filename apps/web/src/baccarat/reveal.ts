import type { Card as CardData, Coup } from "@backroom/game-baccarat";
import { schedule } from "@backroom/game-baccarat";
import { useEffect, useState } from "react";

/**
 * Where in a coup's reveal a given moment falls.
 *
 * The payload carries the whole coup — every card, and the outcome — the
 * instant betting closes, because the shoe has already answered by then. That
 * is what a client reconnecting mid-deal needs, and it is also exactly the
 * fact "never invent a fact" says this file may not show early: a card not
 * yet turned is a card this browser knows and the player does not, so it is
 * drawn face down regardless of what the payload holds, and a hand's total is
 * held back until the hand behind it actually is turned over.
 */

/** One place in a hand: nothing yet, a back, or a face. */
type Slot = { card: CardData; turned: boolean } | null;

export interface Shown {
  readonly player: readonly Slot[];
  readonly banker: readonly Slot[];
  readonly playerTotal: number | null;
  readonly bankerTotal: number | null;
}

/**
 * What the felt shows at `elapsed` milliseconds into a coup's dealing phase.
 *
 * Walks the shared schedule rather than a clock of its own, which is the
 * whole reason two browsers watching the same coup — or one that only opened
 * partway through it — agree on what is showing: the schedule is a pure
 * function of the coup, so anybody can ask it what has happened by any given
 * moment instead of replaying the deal from the start.
 */
export function shownAt(coup: Coup, elapsed: number): Shown {
  const made = schedule(coup);

  // One slot per card the coup actually holds, starting empty. A slot stays
  // null until its own reveal's outAt has passed — the deck is not this
  // browser's to guess at before the table deals it.
  const player: Slot[] = coup.player.map(() => null);
  const banker: Slot[] = coup.banker.map(() => null);

  for (const reveal of made.cards) {
    if (elapsed < reveal.outAt) {
      continue;
    }
    const hand = reveal.side === "player" ? coup.player : coup.banker;
    const slots = reveal.side === "player" ? player : banker;
    const card = hand[reveal.index];
    if (card === undefined) {
      continue;
    }
    slots[reveal.index] = { card, turned: elapsed >= reveal.turnAt };
  }

  /*
   * A total only once the whole hand is turned — every slot, including one
   * that has not come out yet.
   *
   * `every` over an array that still holds a null is what makes this hold for
   * a hand with a third card on the way: the pair's own turn happens well
   * before the third is even dealt, and showing the coup's total then would
   * be showing a number a card still to arrive has already decided, with only
   * two cards on the felt to account for it.
   */
  const total = (slots: readonly Slot[], value: number): number | null =>
    slots.length > 0 && slots.every((slot) => slot?.turned === true) ? value : null;

  return {
    player,
    banker,
    playerTotal: total(player, coup.playerTotal),
    bankerTotal: total(banker, coup.bankerTotal),
  };
}

/**
 * The reveal, live.
 *
 * Position comes from `deadline` and `dealMs` rather than from a timer this
 * hook starts, so somebody reconnecting mid-coup lands on the card everybody
 * else is already looking at instead of replaying the deal from card one —
 * `deadline` is the moment dealing ends, so counting back by `dealMs` finds
 * when it began.
 */
export function useReveal(coup: Coup | null, deadline: number | null, dealMs: number): Shown | null {
  // A tick to force a re-render; the actual position is always read fresh
  // from Date.now() below, not stored, so it can never drift from the clock.
  const [, tick] = useState(0);

  useEffect(() => {
    if (coup === null || deadline === null) {
      return;
    }
    const total = schedule(coup).total;
    let frame: number;
    const step = () => {
      tick((n) => n + 1);
      // Stops the loop once the reveal has run its course, rather than
      // ticking forever at a coup that is only sitting on the felt now.
      if (Date.now() - (deadline - dealMs) < total) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [coup, deadline, dealMs]);

  if (coup === null || deadline === null) {
    return null;
  }
  return shownAt(coup, Date.now() - (deadline - dealMs));
}
