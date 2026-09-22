import type { Placed, SpotId } from "@backroom/game-baccarat";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * A chip on the cloth before the table has said so.
 *
 * Every press here is a round trip, and a round trip is long enough to feel
 * like the table ignored it — the same bargain blackjack's `useIntent` makes
 * with a stake, adapted for a cloth that takes many chips, on three spots, in
 * one round rather than one bet a hand. Nothing here invents a fact: the
 * amount is this player's own last click, and the table's own figure always
 * wins once it catches up.
 *
 * A spot's own pile never actually removes what this player put on it once
 * the table agrees, so "the table caught up" is exactly this player's own
 * confirmed total on that spot going up. A refusal, or nothing coming back
 * inside `PATIENCE_MS`, gives the chip up — CLAUDE.md's own two ways out.
 */

/** How long an unanswered chip is trusted before it is taken back off. */
const PATIENCE_MS = 1600;

export interface PendingChips {
  /** Chips this player has pressed for on a spot, not yet in the table's own figure. */
  pending: Readonly<Record<string, number>>;
  /** Records a chip as sent. Call it as the message goes, not after. */
  add: (spotId: SpotId, chips: number) => void;
}

export function usePendingChips(
  placed: readonly Placed[],
  seatId: string | null,
  error: string | null,
  /** Moves on for every refusal, including one in the same words as the last. */
  errorKey = 0,
): PendingChips {
  const [pending, setPending] = useState<Record<string, number>>({});
  const timers = useRef<Record<string, number>>({});
  const confirmedRef = useRef<Record<string, number>>({});

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

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const id of Object.values(held)) {
        window.clearTimeout(id);
      }
    };
  }, []);

  /*
   * The table caught up: however much this player's own confirmed figure on a
   * spot just grew is exactly the pending chip that press was for, so it
   * retires that much of the pile rather than waiting out its patience.
   */
  useEffect(() => {
    setPending((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const spotId of Object.keys(next)) {
        const before = confirmedRef.current[spotId] ?? 0;
        const now = confirmed[spotId] ?? 0;
        const gained = now - before;
        if (gained > 0) {
          const left = Math.max(0, next[spotId] - gained);
          if (left === 0) {
            delete next[spotId];
          } else {
            next[spotId] = left;
          }
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    confirmedRef.current = confirmed;
  }, [confirmed]);

  // A refusal is a chip that was never going to land — every pending pile
  // comes back off, the same as a hand that is told no.
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (error !== null) {
      setPending({});
    }
  }, [error, errorKey]);

  const add = useCallback((spotId: SpotId, chips: number) => {
    setPending((prev) => ({ ...prev, [spotId]: (prev[spotId] ?? 0) + chips }));
    window.clearTimeout(timers.current[spotId]);
    timers.current[spotId] = window.setTimeout(() => {
      setPending((prev) => {
        if (!(spotId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[spotId];
        return next;
      });
    }, PATIENCE_MS);
  }, []);

  return { pending, add };
}
