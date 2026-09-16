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
 *
 * The lit state is an id, not a boolean: a second rise while the first is
 * still showing must still buy its own full `ms`, and a plain `shown` flag
 * cannot say that — it is already `true`, so setting it `true` again is a
 * no-op React discards, and the moment already running keeps its own
 * shorter deadline. A fresh id both changes (so the effect below restarts
 * the timer) and lets that timer tell a stale firing apart from a current
 * one.
 */
export function useMoment(count: number, ms = MOMENT_MS): boolean {
  const [seen, setSeen] = useState(count);
  const [moment, setMoment] = useState(0);
  if (count !== seen) {
    setSeen(count);
    if (count > seen) {
      // Up is news: a new id, even if one is already lit.
      setMoment((current) => current + 1);
    } else {
      // Down is the felt clearing, and a stamp outliving its hand would be a lie.
      setMoment(0);
    }
  }

  useEffect(() => {
    if (moment === 0) {
      return;
    }
    const id = window.setTimeout(() => {
      // Only this moment's own timer may turn it off — a stale one left over
      // from a moment already superseded must not clear the one after it.
      setMoment((current) => (current === moment ? 0 : current));
    }, ms);
    return () => window.clearTimeout(id);
  }, [moment, ms]);

  return moment !== 0;
}

/**
 * The two big moments at a blackjack table, each once and never looped: a
 * banner for a hand dealt twenty-one, a stamp for a hand gone past it.
 */
export function Moments({ me }: { me: SeatView | null }) {
  const only = me !== null && me.hands.length === 1 ? me.hands[0] : undefined;
  const natural = useMoment(only !== undefined && isNatural(only) ? 1 : 0);
  const bustCount = me?.hands.filter((hand) => hand.bust).length ?? 0;
  const bust = useMoment(bustCount);
  return (
    <>
      {natural ? (
        <p className="bj__banner" aria-hidden="true">
          Blackjack
        </p>
      ) : null}
      {bust ? (
        // Keyed on the count so a second bust remounts the stamp rather than
        // reusing the first's node — a CSS entrance animation needs a fresh
        // element to have something to retrigger on.
        <p key={bustCount} className="bj__stamp" aria-hidden="true">
          Bust
        </p>
      ) : null}
    </>
  );
}
