import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Seconds until `deadline`, by the server's clock.
 *
 * Every view carries the server's time, because a phone whose clock is twenty
 * seconds out would otherwise count a turn down that is already over.
 */
export function useSecondsLeft(deadline: number | null, serverNow: number): number | null {
  const offset = useMemo(() => serverNow - Date.now(), [serverNow]);
  const compute = useCallback(
    () => (deadline === null ? null : Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000))),
    [deadline, offset],
  );
  const [left, setLeft] = useState(compute);
  useEffect(() => {
    // A changed deadline (a new turn) or a corrected offset both mean whatever
    // was showing is stale, so this recomputes at once rather than waiting a tick.
    setLeft(compute());
    if (deadline === null) {
      return;
    }
    const timer = setInterval(() => {
      /*
       * A quarter-second tick is fine granularity for catching the second
       * boundary, but the displayed number changes at most once a second —
       * writing state four times for one visible change would re-render the
       * whole strip for nothing an onlooker can see.
       */
      setLeft((previous) => {
        const next = compute();
        return next === previous ? previous : next;
      });
    }, 250);
    return () => clearInterval(timer);
  }, [deadline, compute]);
  return left;
}
