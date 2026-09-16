import type { TableView } from "@backroom/game-blackjack";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What this player has asked for and not yet been told about.
 *
 * Every move at this table is a round trip, and a round trip is long enough to
 * feel like the button did not work. So a press changes what is on screen
 * immediately and the table's answer replaces it a moment later — the same
 * bargain Greed makes with its dice.
 *
 * Nothing here invents a fact. A stake is a number this player chose, so it
 * can be shown before the table confirms it; a card is not, so what shows for
 * a card is a card arriving face down, which is the truth until it lands.
 */

/** A move that has been sent and is waiting on the table. */
export type Move = "hit" | "stand" | "double" | "split";

/** How long an unanswered ask is trusted before the table's word wins. */
const PATIENCE_MS = 1600;

interface Sent {
  kind: Move;
  /** What the hand looked like when it went, so we can tell when it lands. */
  cards: number;
  hands: number;
  turn: string | null;
}

export interface Intent {
  /** The stake to show: this player's own last click until the table agrees. */
  bet: number | null;
  /** Readiness to show: this player's own last press until the table agrees. */
  ready: boolean | null;
  /** A move gone and not yet answered, or null when the table is up to date. */
  move: Move | null;
  /** Records a stake as placed. Call it as the message goes, not after. */
  place: (amount: number) => void;
  /** Records a readiness press. Call it as the message goes, not after. */
  setReady: (ready: boolean) => void;
  /** Records a move as sent. */
  send: (kind: Move) => void;
}

export function useIntent(
  view: TableView | null,
  seatId: string | null,
  error: string | null,
  /** Moves on for every refusal, including one in the same words as the last. */
  errorKey = 0,
): Intent {
  const me = view?.seats.find((seat) => seat.id === seatId) ?? null;
  const cards = me?.hands.reduce((total, hand) => total + hand.cards.length, 0) ?? 0;
  const hands = me?.hands.length ?? 0;
  const turn = view?.turnSeatId ?? null;
  const phase = view?.phase ?? null;

  const [bet, setBet] = useState<number | null>(null);
  const [ready, setReadyState] = useState<boolean | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const timers = useRef<number[]>([]);

  /** Nothing asked for outlives its patience, however the answer goes. */
  const forget = useCallback((drop: () => void) => {
    const id = window.setTimeout(drop, PATIENCE_MS);
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

  const place = useCallback(
    (amount: number) => {
      setBet(amount);
      forget(() => setBet(null));
    },
    [forget],
  );

  const setReady = useCallback(
    (value: boolean) => {
      setReadyState(value);
      forget(() => setReadyState(null));
    },
    [forget],
  );

  const send = useCallback(
    (kind: Move) => {
      setSent({ kind, cards, hands, turn });
      forget(() => setSent(null));
    },
    [cards, hands, turn, forget],
  );

  /*
   * The table caught up.
   *
   * For a stake that means it is holding the number this player asked for. A
   * refusal never gets here — the table's stake does not move — which is what
   * the patience above is for, and why an error clears it outright.
   */
  useEffect(() => {
    if (bet !== null && me !== null && me.bet === bet) {
      setBet(null);
    }
  }, [bet, me]);

  // The same catching-up, for readiness: the table holding the answer this
  // player pressed is what says the press landed.
  useEffect(() => {
    if (ready !== null && me !== null && me.ready === ready) {
      setReadyState(null);
    }
  }, [ready, me]);

  // Keyed on the count as well as the words: a second refusal in the same
  // words is still a refusal, and would otherwise leave the move hanging.
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (error !== null) {
      setBet(null);
      setReadyState(null);
      setSent(null);
    }
  }, [error, errorKey]);

  // A hand that has been dealt is no longer one anybody is betting or
  // readying up on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the phase changing, which is the point
  useEffect(() => {
    setBet(null);
    setReadyState(null);
  }, [phase]);

  /*
   * A move lands as a change to the hand it was made on: a card arrives, a
   * pair becomes two hands, or the turn moves off this seat. Any of the three
   * means the table has answered and its version is the one to show.
   */
  useEffect(() => {
    if (sent === null) {
      return;
    }
    if (cards !== sent.cards || hands !== sent.hands || turn !== sent.turn) {
      setSent(null);
    }
  }, [sent, cards, hands, turn]);

  return { bet, ready, move: sent?.kind ?? null, place, setReady, send };
}

/**
 * True for a moment each time the value changes.
 *
 * For the things that should react rather than merely differ — a total ticking
 * up, a stake growing. A class that goes on and comes off again is the only
 * way to run a CSS animation twice on an element that never unmounts.
 */
export function useBumped(value: number | string, ms = 420): boolean {
  const [bumped, setBumped] = useState(false);
  const first = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the value changing, which is the whole hook
  useEffect(() => {
    // Not on the way in. Arriving is the mount animation's job, and running
    // both makes everything on screen twitch when the page opens.
    if (first.current) {
      first.current = false;
      return;
    }
    setBumped(true);
    const id = window.setTimeout(() => setBumped(false), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);

  return bumped;
}
