import type { Outcome } from "@backroom/game-two-up";
import { useEffect, useRef } from "react";
import { play, tossCoins } from "../game/audio.js";

/**
 * The sound of a toss, tied to the toss itself.
 *
 * A hook rather than calls scattered through the felt, for the reason
 * `useSpinSound` is: the sound and the animation have to start from the same
 * event and run exactly as long as the coins are actually in the air, or the
 * two can only drift apart.
 */
export function useTossSound(
  flying: boolean,
  flightMs: number,
  /** `landings()` and `rattle()` (Task 10) — the felt's own numbers, passed
      through rather than recomputed here. */
  shape: { landings: readonly number[]; rattle: readonly number[] },
): void {
  const end = useRef<(() => void) | null>(null);
  /*
   * The shape is read through a ref so it is not a dependency. It is a fresh
   * object every render and would restart the sound on any re-render at all
   * — a chip going down mid-flight would cut the coins off and start them
   * again.
   */
  const held = useRef(shape);
  held.current = shape;

  useEffect(() => {
    if (!flying) {
      return;
    }
    end.current = tossCoins({ flightMs, ...held.current });
    return () => {
      end.current?.();
      end.current = null;
    };
  }, [flying, flightMs]);
}

/**
 * The boxer's call, once the coins are down.
 *
 * Separate from the toss because it is not part of it: the toss's sound is
 * scheduled when the coins leave the kip and cannot know how they will land,
 * and this fires on the outcome arriving. Which also means it fires once per
 * result rather than once per render, however often the felt redraws.
 */
export function useCalledSound(outcome: Outcome | null, flying: boolean): void {
  const said = useRef<Outcome | null>(null);

  useEffect(() => {
    if (flying || outcome === null) {
      // A new throw clears it, so the same call twice running still sounds.
      if (flying) {
        said.current = null;
      }
      return;
    }
    if (said.current === outcome) {
      return;
    }
    said.current = outcome;
    play(outcome === "heads" ? "headsUp" : outcome === "tails" ? "tailsUp" : "oddsUp");
  }, [outcome, flying]);
}
