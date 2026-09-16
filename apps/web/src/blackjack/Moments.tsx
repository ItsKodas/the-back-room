import { useEffect, useState } from "react";
import type { SeatView } from "./hands.js";
import { isNatural } from "./hands.js";

/** Long enough to read the word, short enough that it is a moment and not a sign. */
export const MOMENT_MS = 1600;

/**
 * True for a moment each time a count goes up.
 *
 * A count rather than a flag, so a second hand busting after a split is a
 * second stamp. Worked out during render rather than in an effect, so React's
 * development double-run of effects cannot swallow the moment it is for.
 */
export function useMoment(count: number, ms = MOMENT_MS): boolean {
  const [seen, setSeen] = useState(count);
  const [shown, setShown] = useState(false);
  if (count !== seen) {
    setSeen(count);
    // Up is news; down is the felt clearing, and a stamp outliving its hand would be a lie.
    setShown(count > seen);
  }

  useEffect(() => {
    if (!shown) {
      return;
    }
    const id = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(id);
  }, [shown, ms]);

  return shown;
}

/**
 * The two big moments at a blackjack table, each once and never looped: a
 * banner for a hand dealt twenty-one, a stamp for a hand gone past it.
 */
export function Moments({ me }: { me: SeatView | null }) {
  const only = me !== null && me.hands.length === 1 ? me.hands[0] : undefined;
  const natural = useMoment(only !== undefined && isNatural(only) ? 1 : 0);
  const bust = useMoment(me?.hands.filter((hand) => hand.bust).length ?? 0);
  return (
    <>
      {natural ? (
        <p className="bj__banner" aria-hidden="true">
          Blackjack
        </p>
      ) : null}
      {bust ? (
        <p className="bj__stamp" aria-hidden="true">
          Bust
        </p>
      ) : null}
    </>
  );
}
