import type { TableView } from "@backroom/game-poker";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What this player has asked for and not yet been told about.
 *
 * Every move at this table is a round trip, and a round trip is long enough
 * for a button to feel broken. So a press changes what is on screen at once
 * and the table's answer replaces it a moment later — the same bargain the
 * other two games make.
 *
 * Nothing here invents a fact. What a raise costs is a number this player
 * chose, so their chips can go onto the felt on the press; whose turn it is
 * next, and what the next card is, are the table's to say and are not guessed
 * at. What shows in the meantime is this seat having done what it was told to
 * do, which is true from the moment the message leaves.
 */

export type Move = "fold" | "check" | "call" | "raise" | "allIn";

/** How long an unanswered ask is trusted before the table's word wins. */
const PATIENCE_MS = 1600;

interface Sent {
  kind: Move;
  /** What this seat would be committed to, if the table takes it. */
  to: number;
  /** Whose turn it was when it went, so we can tell when the answer lands. */
  turn: string | null;
}

export interface Intent {
  /** A move gone and not yet answered, or null when the table is up to date. */
  move: Move | null;
  /** What to draw in front of this seat until the table says otherwise. */
  committed: number | null;
  /** Records a move as sent. Call it as the message goes, not after. */
  send: (kind: Move, to: number) => void;
}

export function useIntent(
  view: TableView | null,
  seatId: string | null,
  error: string | null,
  /** Moves on for every refusal, including one in the same words as the last. */
  errorKey = 0,
): Intent {
  const turn = view?.toAct ?? null;
  const [sent, setSent] = useState<Sent | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const id of held) {
        window.clearTimeout(id);
      }
    };
  }, []);

  const send = useCallback((kind: Move, to: number) => {
    setSent({ kind, to, turn: seatId });
    /*
     * Nothing asked for outlives its patience, however the answer goes. A
     * table that never replies leaves a seat looking like it folded, which is
     * a worse lie than a button that did nothing.
     */
    const id = window.setTimeout(() => setSent(null), PATIENCE_MS);
    timers.current.push(id);
  }, [seatId]);

  /*
   * The answer has landed when the turn has moved off this seat. That is the
   * one signal that means it for every move here: fold, check, call and raise
   * all end this seat's turn, so none of them can be confused with the table
   * simply sending the same state again.
   */
  useEffect(() => {
    if (sent !== null && turn !== seatId) {
      setSent(null);
    }
  }, [turn, seatId, sent]);

  /** A refusal takes it back at once rather than waiting out the patience. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (error !== null) {
      setSent(null);
    }
  }, [error, errorKey]);

  return {
    move: sent?.kind ?? null,
    committed: sent === null ? null : sent.to,
    send,
  };
}
