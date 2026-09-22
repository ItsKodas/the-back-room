import type { Bid, Call, TableView } from "@backroom/game-liars-dice";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What this player has asked for and not yet been told about.
 *
 * Every move at this table is a round trip, and a round trip is long enough to
 * feel like the button did not work. So a press changes what is on screen
 * immediately and the table's answer replaces it a moment later.
 *
 * Nothing here invents a fact, and the line between the two is sharp at this
 * table. A bid is a number this player chose, so it goes up on the felt on the
 * press. A call's answer is thirty dice and a count that only the server knows
 * — so a call shows as a button going down and nothing else. Guessing the
 * count, even for a frame, would be telling somebody they had won.
 */

/** How long an unanswered ask is trusted before the table's word wins. */
const PATIENCE_MS = 1_600;

interface Sent {
  /** The bid, for a raise; null for a call. */
  bid: Bid | null;
  /** Which call is in flight, for a call; null for a raise. */
  call: Call | null;
  /** What the board looked like when it went, so we can tell when it lands. */
  round: number;
  standing: string;
  revealed: boolean;
}

export interface Intent {
  /** The bid to show: this player's own last press until the table agrees. */
  bid: Bid | null;
  /**
   * The call in flight, so the key that was actually pressed is the one that
   * holds itself down — a call has no number to show, but it does have a
   * button, and it is not always the same button as a raise's.
   */
  call: Call | null;
  /** Readiness to show: the same, for the ready key. */
  ready: boolean | null;
  /** A move gone and not yet answered, so the main action stays held down. */
  busy: boolean;
  sendBid: (bid: Bid) => void;
  sendCall: (call: Call) => void;
  setReady: (ready: boolean) => void;
}

/** The standing bid as one comparable string, so a change is one comparison. */
const stampOf = (view: TableView | null): string =>
  view === null || view.bid === null ? "-" : `${view.bid.count}.${view.bid.face}`;

export function useIntent(
  view: TableView | null,
  seatId: string | null,
  error: string | null,
  /** Moves on for every refusal, including one in the same words as the last. */
  errorKey = 0,
): Intent {
  const me = view?.seats.find((seat) => seat.id === seatId) ?? null;
  const round = view?.round ?? 0;
  const standing = stampOf(view);
  const bidder = view?.bidder ?? null;
  const revealed = view?.resolution !== null && view?.resolution !== undefined;

  const [ready, setReadyState] = useState<boolean | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const timers = useRef<number[]>([]);
  /**
   * Which press, of each kind, is the current one. A timer armed for an
   * earlier press checks its own number against this before it is allowed to
   * clear anything — a bid changed mid-flight must outlive the patience of
   * the bid it replaced, and a ready press has no business cancelling a bid's
   * patience at all, so the two are counted separately.
   */
  const latest = useRef({ sent: 0, ready: 0 });

  /** Nothing asked for outlives its patience — but only its own press's patience. */
  const forget = useCallback((of: "sent" | "ready", token: number, drop: () => void) => {
    const id = window.setTimeout(() => {
      // A newer press has since superseded this one; its own timer owns the state now.
      if (latest.current[of] === token) {
        drop();
      }
    }, PATIENCE_MS);
    timers.current.push(id);
  }, []);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const id of held) {
        window.clearTimeout(id);
      }
    };
  }, []);

  const sendBid = useCallback(
    (bid: Bid) => {
      const token = ++latest.current.sent;
      setSent({ bid, call: null, round, standing, revealed });
      forget("sent", token, () => setSent(null));
    },
    [round, standing, revealed, forget],
  );

  const sendCall = useCallback(
    (call: Call) => {
      // The count is not kept: there is nothing about the answer to show early.
      // Which call it was is kept, so the key that was pressed can hold itself
      // down instead of the bid slab it sits beside.
      const token = ++latest.current.sent;
      setSent({ bid: null, call, round, standing, revealed });
      forget("sent", token, () => setSent(null));
    },
    [round, standing, revealed, forget],
  );

  const setReady = useCallback(
    (value: boolean) => {
      const token = ++latest.current.ready;
      setReadyState(value);
      forget("ready", token, () => setReadyState(null));
    },
    [forget],
  );

  // The table holding the answer this player pressed is what says it landed.
  useEffect(() => {
    if (ready !== null && me !== null && me.ready === ready) {
      setReadyState(null);
    }
  }, [ready, me]);

  /*
   * The table caught up. A bid lands as the standing bid becoming this
   * player's; a call lands as a reveal appearing. Either way the board moving
   * at all is enough — whatever happened, what is on screen is now the table's
   * version and not this player's guess.
   */
  useEffect(() => {
    if (sent === null) {
      return;
    }
    const landed =
      round !== sent.round ||
      standing !== sent.standing ||
      revealed !== sent.revealed ||
      (sent.bid !== null && bidder === seatId && standing !== "-");
    if (landed) {
      setSent(null);
    }
  }, [sent, round, standing, revealed, bidder, seatId]);

  // Keyed on the count as well as the words: a second refusal in the same
  // words is still a refusal, and would otherwise leave a move hanging.
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (error !== null) {
      setSent(null);
      setReadyState(null);
    }
  }, [error, errorKey]);

  // A round that has been dealt is no longer one anybody is readying up on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the round changing, which is the point
  useEffect(() => {
    setReadyState(null);
  }, [round]);

  return {
    bid: sent?.bid ?? null,
    call: sent?.call ?? null,
    ready,
    busy: sent !== null,
    sendBid,
    sendCall,
    setReady,
  };
}
