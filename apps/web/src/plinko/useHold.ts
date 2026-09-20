import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A key held down, repeating.
 *
 * Its own file because the interesting part is entirely timing: the press has
 * to land at once, the repeat has to be paced, and a tap must never cost two.
 * All three are invisible by eye and exact on a clock.
 */

/**
 * How long a press has to be held before it starts repeating.
 *
 * Not for pacing — for telling a tap from a hold. Without it a slightly slow
 * click costs a second stake nobody meant to put up.
 */
export const HOLD_DELAY_MS = 300;

/** Five a second, held. Fast enough to read as a stream, slow enough to follow. */
export const HOLD_EVERY_MS = 200;

export interface Hold {
  /** Press the key: drops once now, and keeps dropping if it is not let go. */
  start(): void;
  /** Let go: the repeat ends, and nothing further is owed. */
  stop(): void;
}

export function useHold(fire: () => void): Hold {
  /*
   * The page rebuilds `fire` on every render — it closes over the stake, the
   * risk and whether the board has room. A repeat has to call the one the
   * page is holding now, not the one it was holding when the finger landed.
   */
  const latest = useRef(fire);
  latest.current = fire;
  const grace = useRef<number | null>(null);
  const every = useRef<number | null>(null);
  const [held, setHeld] = useState(false);

  const stop = useCallback(() => {
    if (grace.current !== null) window.clearTimeout(grace.current);
    if (every.current !== null) window.clearInterval(every.current);
    grace.current = null;
    every.current = null;
    setHeld(false);
  }, []);

  const start = useCallback(() => {
    // A press arriving while one is already running is a press that was never
    // released — a second run would double the rate for the rest of the hold.
    if (grace.current !== null || every.current !== null) return;
    setHeld(true);
    // On the way down. Waiting even for the grace would make the key feel dead.
    latest.current();
    grace.current = window.setTimeout(() => {
      grace.current = null;
      every.current = window.setInterval(() => latest.current(), HOLD_EVERY_MS);
    }, HOLD_DELAY_MS);
  }, []);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!held) {
      return;
    }
    /*
     * The key's own pointerup is not enough to rely on. It goes `disabled` the
     * moment the board is full, and a disabled button reports no pointer
     * events at all — including the release that should end the hold. Left to
     * itself that is a key that keeps dropping after the finger has gone.
     *
     * `blur` covers the other way out: an alt-tab mid-hold never sends a
     * pointerup anywhere.
     */
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, [held, stop]);

  return { start, stop };
}
