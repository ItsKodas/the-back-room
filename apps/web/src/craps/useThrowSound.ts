import { ROLL_MS, type Phase, type Roll } from "@backroom/game-craps";
import { useEffect } from "react";
import { play } from "../game/audio.js";

/**
 * The sound of a throw, tied to the throw itself.
 *
 * `apps/web/src/game/audio.ts` already carries dice on wood as the `"shake"`
 * and `"land"` cues — Greed plays the same two around its own roll — so this
 * composes those rather than adding a third recording nobody has to record.
 *
 * Keyed on the phase turning to `"rolling"` rather than on `dice` arriving,
 * because the dice are already the table's fact the instant it does (see
 * `throw.ts`'s own note on this) — the transition a listener actually hears
 * is the felt picking the dice up, not the result resolving behind the
 * scenes. `play("land")` is scheduled against `ROLL_MS`, the same duration
 * `Dice.tsx` animates the throw over, so the clack lands with the dice a
 * player is watching rather than a beat early or late.
 *
 * Follows `roulette/useSpinSound.ts`'s shape: an effect on a derived boolean
 * so a chip going down mid-throw, or anything else that re-renders the felt,
 * never restarts the sound.
 */
export function useThrowSound(phase: Phase, dice: Roll | null): void {
  const rolling = phase === "rolling" && dice !== null;

  useEffect(() => {
    if (!rolling) {
      return;
    }
    play("shake");
    const settle = window.setTimeout(() => play("land"), ROLL_MS);
    return () => window.clearTimeout(settle);
  }, [rolling]);
}
