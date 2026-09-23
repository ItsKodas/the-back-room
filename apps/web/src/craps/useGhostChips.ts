import type { Placed } from "@backroom/game-craps";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Chips on the cloth before the server has heard of them.
 *
 * Every move here is a round trip, and a round trip is long enough for a
 * button to feel broken. The bargain has one rule — never invent a fact — and
 * a stake is the one thing on this table that is not a fact of the server's: a
 * player chose the number, so the chips can go down on the press.
 *
 * What cannot be guessed is what the dice did, which is why nothing in this
 * file touches them.
 *
 * A guess is given up on three ways: the table refuses it, the table speaks
 * and does not mention it, or nothing comes back at all. The last one is why
 * there is a timer here. Assume a bad connection: the person playing is not on
 * localhost, and a design that only works at zero latency is one that has not
 * been tested.
 */

/**
 * How long a guess is allowed to stand with nothing coming back.
 *
 * Long enough that a slow connection is not punished for being slow, short
 * enough that a chip which never landed does not sit on the felt into the next
 * betting window looking like money.
 */
export const GIVE_UP_MS = 8_000;

/** One press, still waiting to be confirmed or contradicted. */
interface Guess {
  /** Its own identity, so its timer can retire exactly this guess. */
  id: number;
  spotId: string;
  chips: number;
  /**
   * The figure the table has to reach for this guess to have arrived.
   *
   * What this seat already had on the spot, plus every guess pressed onto it
   * before this one. Counting the earlier guesses is what keeps a burst of
   * presses honest: three thirties in a second all read "the table said
   * nothing" at the moment they were pressed, and without this the first
   * acknowledgement would retire all three and the felt would drop from
   * ninety to thirty before climbing back.
   */
  needs: number;
}

export interface GhostChips {
  /** Everybody's chips, with this seat's un-landed guesses merged in. */
  cloth: readonly Placed[];
  /** A chip down now, on the strength of the player having chosen it. */
  press: (spotId: string, chips: number) => void;
  /** Give up on the guesses on one spot. */
  refused: (spotId: string) => void;
  /** Give up on all of them. */
  clear: () => void;
}

export function useGhostChips(placed: readonly Placed[], seatId: string | null): GhostChips {
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const next = useRef(0);
  const timers = useRef(new Map<number, number>());
  /*
   * Read at the moment of a press rather than watched, so `press` stays the
   * same function between renders. A cloth that changed the identity of the
   * felt's own press handler every time somebody else put a chip down would
   * re-render every box on the table for it.
   */
  const latest = useRef(placed);
  latest.current = placed;
  /** The same trick for the guesses themselves, so nothing retires a timer
      from inside a state updater React is free to run twice. */
  const standing = useRef<Guess[]>(guesses);
  standing.current = guesses;

  const drop = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) {
        window.clearTimeout(timer);
      }
      timers.current.clear();
    },
    [],
  );

  /** What the table says this seat has on one spot. */
  const onSpot = useCallback(
    (spotId: string) =>
      placed.find((one) => one.seatId === seatId && one.spotId === spotId)?.chips ?? 0,
    [placed, seatId],
  );

  /*
   * The guesses the table has not caught up with yet.
   *
   * Worked out while rendering rather than in an effect, so the frame that
   * first carries the server's own chips is the frame the guess stops being
   * drawn on top of them. Reconciled in an effect below as well, but only to
   * stop the list growing — never to decide what is on screen.
   */
  const live = useMemo(
    () => guesses.filter((one) => onSpot(one.spotId) < one.needs + one.chips),
    [guesses, onSpot],
  );

  useEffect(() => {
    if (live.length !== guesses.length) {
      for (const one of guesses) {
        if (!live.includes(one)) {
          drop(one.id);
        }
      }
      setGuesses(live);
    }
  }, [live, guesses, drop]);

  const press = useCallback(
    (spotId: string, chips: number) => {
      // Nobody's guess to make. A watcher has no seat for the chips to be on.
      if (seatId === null) {
        return;
      }
      const id = next.current;
      next.current += 1;
      const already =
        latest.current.find((one) => one.seatId === seatId && one.spotId === spotId)?.chips ?? 0;
      setGuesses((all) => [
        ...all,
        {
          id,
          spotId,
          chips,
          needs:
            already +
            all
              .filter((one) => one.spotId === spotId)
              .reduce((sum, one) => sum + one.chips, 0),
        },
      ]);
      timers.current.set(
        id,
        window.setTimeout(() => {
          timers.current.delete(id);
          setGuesses((all) => all.filter((one) => one.id !== id));
        }, GIVE_UP_MS),
      );
    },
    [seatId],
  );

  const refused = useCallback(
    (spotId: string) => {
      // Retired outside the updater, which React is free to run twice.
      for (const one of standing.current) {
        if (one.spotId === spotId) {
          drop(one.id);
        }
      }
      setGuesses((all) => all.filter((one) => one.spotId !== spotId));
    },
    [drop],
  );

  const clear = useCallback(() => {
    for (const timer of timers.current.values()) {
      window.clearTimeout(timer);
    }
    timers.current.clear();
    setGuesses([]);
  }, []);

  const cloth = useMemo(() => {
    if (live.length === 0 || seatId === null) {
      return placed;
    }
    const out = [...placed];
    for (const one of live) {
      const at = out.findIndex(
        (each) => each.seatId === seatId && each.spotId === one.spotId,
      );
      const already = at === -1 ? undefined : out[at];
      if (already === undefined) {
        out.push({ seatId, spotId: one.spotId, chips: one.chips, off: false });
      } else {
        out[at] = { ...already, chips: already.chips + one.chips };
      }
    }
    return out;
  }, [placed, live, seatId]);

  return { cloth, press, refused, clear };
}
