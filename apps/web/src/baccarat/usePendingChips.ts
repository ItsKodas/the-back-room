import type { Placed, SpotId } from "@backroom/game-baccarat";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * A chip on the cloth before the table has said so.
 *
 * Every press here is a round trip, and a round trip is long enough to feel
 * like the table ignored it — the same bargain blackjack's `useIntent` makes
 * with a stake, adapted for a cloth that takes many chips, on three spots, in
 * one round rather than one bet a hand.
 *
 * `useIntent`'s own shape, carried over on purpose: this player's own last
 * figure for a spot *replaces* the table's while it is still waiting on an
 * answer, rather than adding to it. A first version of this file tracked an
 * "extra to add" instead, and a render existed — watched live, and caught by
 * a test built to look for exactly this — where the table's own confirmed
 * figure had already arrived and the extra hadn't yet been retired, so the
 * felt briefly showed both counted: fifty on a spot a player had put twenty-
 * five on. Substituting rather than adding is what makes that render
 * harmless even when it happens: showing this player's own number and
 * showing the table's agree once the table has caught up, so which one wins
 * a given render no longer matters.
 *
 * That substitution only ever *stands in* for the table, so it has to be
 * given up the moment the table speaks — including when what the table says
 * is that a chip came off. A pressed figure is a claim that this seat's total
 * on a spot is about to rise to it, and a take-back, an Undo or a Clear is
 * this player withdrawing that claim; left standing, it put the chip the
 * player had just taken back straight onto the cloth again for the rest of
 * the patience window. Hence `retire`, called on the same press as the
 * message, rather than waiting for a timer to notice.
 */

/** How long an unanswered chip is trusted before it is taken back off. */
const PATIENCE_MS = 1600;

export interface PendingChips {
  /**
   * This player's own total for a spot, in place of the table's own figure,
   * for exactly as long as the table's own figure has not yet reached it.
   * Once it has, the spot is not here at all — the table's word is the only
   * one left to show, the same as `useIntent`'s `bet` going back to `null`.
   */
  pending: Readonly<Record<string, number>>;
  /** Records a chip as sent. Call it as the message goes, not after. */
  add: (spotId: SpotId, chips: number) => void;
  /**
   * Gives up on a spot's pending figure — or on every spot, given nothing.
   *
   * For a chip coming back off. Call it as the message goes, the same as
   * `add`: a take-back is this player answering their own press, and what
   * was shown early has nothing left to stand in for.
   */
  retire: (spotId?: SpotId) => void;
}

export function usePendingChips(
  placed: readonly Placed[],
  seatId: string | null,
  error: string | null,
  /** Moves on for every refusal, including one in the same words as the last. */
  errorKey = 0,
): PendingChips {
  // What this player has actually pressed for, per spot — an absolute total
  // each time (worked out against the table's own figure at the moment of
  // the press), not a running "extra" on top of whatever the table says now.
  const [pressed, setPressed] = useState<Record<string, number>>({});
  const timers = useRef<Record<string, number>>({});

  /** This player's own confirmed total, per spot — never anybody else's chips. */
  const confirmed = useMemo(() => {
    const out: Record<string, number> = {};
    if (seatId !== null) {
      for (const one of placed) {
        if (one.seatId === seatId) {
          out[one.spotId] = (out[one.spotId] ?? 0) + one.chips;
        }
      }
    }
    return out;
  }, [placed, seatId]);

  /*
   * The table caught up: worked out fresh on every render, from `pressed`
   * and `confirmed` as they stand *this* render, rather than by an effect a
   * render behind reacting to the last one. A spot whose confirmed figure
   * already covers what was pressed for it is not "pending" for even one
   * commit — there is no render in between where the old figure could still
   * be read alongside the new one.
   */
  const pending = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [spotId, amount] of Object.entries(pressed)) {
      if ((confirmed[spotId] ?? 0) < amount) {
        out[spotId] = amount;
      }
    }
    return out;
  }, [pressed, confirmed]);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const id of Object.values(held)) {
        window.clearTimeout(id);
      }
    };
  }, []);

  // A refusal is a chip that was never going to land — every pressed figure
  // comes back off, the same as a hand that is told no.
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (error !== null) {
      setPressed({});
    }
  }, [error, errorKey]);

  const add = useCallback(
    (spotId: SpotId, chips: number) => {
      setPressed((prev) => ({
        ...prev,
        // Against the higher of what was already pressed and what the table
        // has actually confirmed — either can be ahead, and the new total
        // this player expects to see is built on top of whichever is.
        [spotId]: Math.max(prev[spotId] ?? 0, confirmed[spotId] ?? 0) + chips,
      }));
      window.clearTimeout(timers.current[spotId]);
      timers.current[spotId] = window.setTimeout(() => {
        setPressed((prev) => {
          if (!(spotId in prev)) {
            return prev;
          }
          const next = { ...prev };
          delete next[spotId];
          return next;
        });
      }, PATIENCE_MS);
    },
    [confirmed],
  );

  const retire = useCallback((spotId?: SpotId) => {
    for (const [id, timer] of Object.entries(timers.current)) {
      if (spotId === undefined || id === spotId) {
        window.clearTimeout(timer);
        delete timers.current[id];
      }
    }
    setPressed((prev) => {
      if (spotId === undefined) {
        return Object.keys(prev).length === 0 ? prev : {};
      }
      if (!(spotId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[spotId];
      return next;
    });
  }, []);

  return { pending, add, retire };
}
