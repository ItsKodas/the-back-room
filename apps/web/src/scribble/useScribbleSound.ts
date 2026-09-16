import type { TableView } from "@backroom/game-scribble";
import type { ChatMessage } from "@backroom/shared";
import { useEffect, useMemo, useRef } from "react";
import { play } from "../game/audio.js";
import type { TableSocketHook } from "../table/useTableSocket.js";

const TICK_FROM = 10;

/**
 * The napkin's own sound, synthesised throughout per the design spec's
 * amendment: there is nothing yet recorded of a marker or of paper.
 *
 * Derived from state the way the felt games' sound hooks are (`useCardSound`,
 * `useTableSound`) for the events a full view carries — a correct guess, the
 * turn ending — and from the relay stream directly for the two that a view
 * never carries at all: a stroke arriving and a clear, which are `onRelay`'s
 * business precisely because they are too frequent to belong to state.
 */
export function useScribbleSound({
  state,
  seatId,
  log,
  onRelay,
}: {
  state: TableView;
  seatId: string | null;
  log: ChatMessage[];
  onRelay: TableSocketHook<TableView>["onRelay"];
}): { scratch(): void; swipe(): void } {
  /*
   * Which messages have already sounded, by identity rather than by a count.
   * The chat this rides on is capped (`useTableSocket` keeps only the last
   * 60 lines), so once a table has talked that much the array's length stops
   * growing and a cursor kept as a plain count would compare against a
   * position the array can no longer reach — silencing every "got it" for
   * the rest of that table's life. `GuessLog` hit the same cap for the same
   * reason and fixed it the same way: identity survives a line being pushed
   * out the front, and survives a reconnect replacing the array wholesale,
   * in a way neither a count nor a timestamp does (two guesses can land in
   * the same millisecond). Seeded with whatever the log already holds, so
   * history already on screen when this mounts does not replay as new.
   */
  const seen = useRef<WeakSet<ChatMessage> | null>(null);
  seen.current ??= new WeakSet(log);
  useEffect(() => {
    const already = seen.current as WeakSet<ChatMessage>;
    for (const message of log) {
      if (already.has(message)) {
        continue;
      }
      already.add(message);
      if (message.kind === "got") {
        play(message.seatId === seatId ? "scribbleGot" : "scribbleGotOther");
      }
    }
  }, [log, seatId]);

  const phase = useRef(state.phase);
  useEffect(() => {
    if (state.phase === "reveal" && phase.current !== "reveal") {
      play("scribbleReveal");
    }
    phase.current = state.phase;
  }, [state.phase]);

  /*
   * Kept to the server's own `now` rather than read fresh from `Date.now()` on
   * every render, the same way `useSecondsLeft` holds it: this hook's effect
   * below depends on it, and a value that quietly drifted by however long
   * render took would change on renders that have nothing to do with the
   * clock — restarting the interval each time and, on a table busy enough to
   * re-render inside every 200ms window, never once letting it run long
   * enough to tick at all.
   */
  const offset = useMemo(() => state.now - Date.now(), [state.now]);
  /*
   * The last second announced, kept outside the interval's own closure.
   *
   * A legitimate resync (the table rebroadcasts its state, `now` moves on,
   * `offset` above recomputes) restarts the interval effect below — correctly,
   * since a stale offset would keep polling against the wrong clock. But a
   * `let last` declared inside that effect is reborn at -1 on every one of
   * those restarts, so the very next poll finds "not equal to -1" for
   * whichever second it is already sitting on and announces it a second time
   * — a repeat in exactly the stretch of a turn (the last ten seconds) busiest
   * with guesses landing and the table re-broadcasting because of them. A ref
   * survives the restart; only a new turn's own deadline is allowed to clear it.
   */
  const lastTick = useRef(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the deadline changing, which is the point — a new turn's own deadline is what may clear it, not the value itself
  useEffect(() => {
    lastTick.current = -1;
  }, [state.deadline]);
  useEffect(() => {
    if (state.phase !== "drawing" || state.deadline === null) {
      return;
    }
    const deadline = state.deadline;
    const timer = setInterval(() => {
      const left = Math.ceil((deadline - (Date.now() + offset)) / 1000);
      if (left <= TICK_FROM && left > 0 && left !== lastTick.current) {
        lastTick.current = left;
        play("scribbleTick");
      }
    }, 200);
    return () => clearInterval(timer);
  }, [state.phase, state.deadline, offset]);

  // A partner's line scratches when it starts, not on every batch of it.
  useEffect(
    () =>
      onRelay((relay) => {
        const payload = relay.payload as { kind?: string; seq?: number };
        if (payload.kind === "stroke" && payload.seq === 0) {
          play("scribbleScratch");
        } else if (payload.kind === "clear") {
          play("scribbleSwipe");
        }
      }),
    [onRelay],
  );

  return useMemo(
    () => ({
      scratch: () => play("scribbleScratch"),
      swipe: () => play("scribbleSwipe"),
    }),
    [],
  );
}
