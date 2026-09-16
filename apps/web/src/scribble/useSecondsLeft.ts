import { useEffect, useMemo, useState } from "react";

/**
 * Seconds until `deadline`, by the server's clock.
 *
 * Every view carries the server's time, because a phone whose clock is twenty
 * seconds out would otherwise count a turn down that is already over.
 */
export function useSecondsLeft(deadline: number | null, serverNow: number): number | null {
  const offset = useMemo(() => serverNow - Date.now(), [serverNow]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (deadline === null) {
      return;
    }
    const timer = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, [deadline]);
  if (deadline === null) {
    return null;
  }
  return Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000));
}
