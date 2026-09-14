import type { TableView } from "@backroom/game-death-roll";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What this seat has asked for and not yet been told about.
 *
 * The bargain in CLAUDE.md: a press changes what is on screen at once, and the
 * table's own answer replaces it a moment later. A pass costs a number this
 * seat already knows, so its chips can go down on the press; a roll asks for
 * a fact only the table has, so nothing is shown for it but the die visibly
 * still turning — never a guessed number, and never one that changes once it
 * has already landed.
 *
 * Modelled on poker's and blackjack's own `useIntent`, which both watch the
 * turn moving to know an answer landed, and both take the table's own
 * `error` rather than guess a refusal from a timer — a refusal is an event,
 * not a duration, and the one thing that can be said about how long an
 * accepted move takes to answer is that it varies: `roll` settles inside a
 * microtask, but `pass` does a real economy write first, and a write is not
 * bounded by how fast a socket round trip usually is. A duel's turn moves on
 * every real roll or pass — except the one roll that ends the duel on a 1,
 * which leaves the ceiling exactly where it was. So the ceiling is watched
 * too, for that one case where the turn is the only thing a roll actually
 * moves.
 */

/**
 * How long an unanswered ask is trusted before the table's own word wins,
 * timed from the moment it was sent. The last resort for a reply that never
 * arrives at all — a dropped connection, not a refusal, which is caught the
 * instant it happens via `error` instead of by waiting this out.
 */
export const PATIENCE_MS = 1600;

type Sent =
  | { kind: "roll"; toRoll: string | null; ceiling: number }
  | { kind: "pass"; toRoll: string | null; price: number };

export interface Intent {
  /** Whether the die is tumbling: this seat asked to roll and nothing has answered. */
  rolling: boolean;
  /** Chips this seat's own pass has put on the pot, ahead of the table's word. */
  pending: number;
  roll: () => void;
  pass: () => void;
}

export function useIntent(
  state: TableView | null,
  seatId: string | null,
  act: (action: Record<string, unknown>) => void,
  error: string | null,
): Intent {
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

  /** Gives up on whatever is outstanding after `ms`, however the answer goes. */
  const wind = useCallback((ms: number) => {
    const id = window.setTimeout(() => setSent(null), ms);
    timers.current.push(id);
  }, []);

  const send = useCallback(
    (next: Sent, action: Record<string, unknown>) => {
      setSent(next);
      wind(PATIENCE_MS);
      act(action);
    },
    [act, wind],
  );

  const myTurn = state !== null && seatId !== null && state.toRoll === seatId;

  const roll = useCallback(() => {
    if (!myTurn || state === null) {
      return;
    }
    send({ kind: "roll", toRoll: state.toRoll, ceiling: state.ceiling }, { type: "roll" });
  }, [myTurn, state, send]);

  const pass = useCallback(() => {
    if (!myTurn || state === null || state.you?.passed === true) {
      return;
    }
    send({ kind: "pass", toRoll: state.toRoll, price: state.passPrice }, { type: "pass" });
  }, [myTurn, state, send]);

  /*
   * The table has spoken once the turn has moved off what it was when this
   * seat asked — true of every real roll and every real pass — or, for a roll
   * only, once the ceiling has: the one move that can leave the turn looking
   * exactly like it did before.
   */
  useEffect(() => {
    if (sent === null || state === null) {
      return;
    }
    const answered =
      state.toRoll !== sent.toRoll || (sent.kind === "roll" && state.ceiling !== sent.ceiling);
    if (answered) {
      setSent(null);
    }
  }, [state, sent]);

  /*
   * A refusal never sends a state of its own, so it cannot be caught by the
   * effect above — it is caught here instead, the instant the table says so,
   * rather than inferred from a timer that cannot tell "refused" from
   * "still writing". This is what lets `pass`'s economy write take however
   * long it takes without the pot dropping back and then jumping up again.
   */
  useEffect(() => {
    if (error !== null) {
      setSent(null);
    }
  }, [error]);

  return {
    rolling: sent?.kind === "roll",
    pending: sent?.kind === "pass" ? sent.price : 0,
    roll,
    pass,
  };
}
