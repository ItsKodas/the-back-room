import { FUN_PURSE, type Risk } from "@backroom/game-plinko";
import type { PlinkoCaps, PlinkoResult } from "@backroom/shared";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { play } from "../game/audio.js";
import type { Account } from "../game/useAccount.js";
import type { Ball } from "./Board.js";
import { Books } from "./books.js";

/**
 * Press → ball → answer → landing, and giving up.
 *
 * Pulled out of Plinko.tsx so the bargain in CLAUDE.md — a stake gone at the
 * press, a win held back until the ball lands, a refusal or a silence handing
 * both back — can be driven on a clock and an injected `emit` rather than a
 * real socket and a real frame loop.
 */

/** How long a ball waits on the top peg for its answer before giving up. */
export const PATIENCE_MS = 10_000;

export const NO_ANSWER =
  "No answer from the board. If that ball went through, your balance will catch up.";

export type DropEmit = (
  payload: { stake: number; risk: Risk; forFun?: boolean },
  ack: (result: PlinkoResult) => void,
) => void;

export interface DropSign {
  bank: number;
  caps: PlinkoCaps;
}

export interface UseDropsResult {
  /** The play purse, which lives here and never sees an account. */
  funPurse: number;
  /** Either book still has a stake out, or a win not yet landed. */
  busy: boolean;
  chipsInAir: number;
  funInAir: number;
  notice: string | null;
  /** Press a stake and put a ball on the board. Null if there is nobody to press it for. */
  drop(args: { fun: boolean; stake: number; risk: Risk }): string | null;
  /** The player's own ball has finished landing: releases its win from the shown balance. */
  land(id: string, fun: boolean): void;
}

export function useDrops(
  emit: DropEmit,
  account: Account,
  balls: MutableRefObject<Map<string, Ball>>,
  /** A drop's ack said the bank moved, timely or not: keep the sign true to it. */
  onSign: (fun: boolean, sign: DropSign) => void,
): UseDropsResult {
  const books = useRef({ chips: new Books(), fun: new Books() });
  const timers = useRef(new Map<string, number>());
  const seq = useRef(0);
  /**
   * Chips drops given up on, with no late ack yet.
   *
   * `giveUp` empties `pending`, so the chips book can go idle while a real
   * answer is still somewhere on the wire — idle is not the same question as
   * "is anything still able to arrive late and change the truth". Only chips
   * need this: a fun purse has nothing an unmount could strand, since it dies
   * with the page whether its last drop was answered or not.
   */
  const strandedChips = useRef(new Set<string>());
  const [funPurse, setFunPurse] = useState(FUN_PURSE);
  const [notice, setNotice] = useState<string | null>(null);
  // Read at the moment of a press and in the unmount cleanup, so neither has
  // to sit in a dependency list this hook would otherwise have to rebuild
  // `drop` over every time the account object changes identity.
  const accountRef = useRef(account);
  accountRef.current = account;
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  /** Put what the books say on the screen, then let them forget if nothing is in play. */
  const push = useCallback((fun: boolean) => {
    const book = fun ? books.current.fun : books.current.chips;
    const shown = book.shown();
    if (shown !== null) {
      if (fun) setFunPurse(shown);
      else accountRef.current.setChips(shown);
    }
    book.settle();
    redraw();
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      /*
       * A press this window sent is still waiting on an answer, or gave up
       * waiting but has not heard back either way, and the socket that would
       * have carried it is about to close: the shown balance already has
       * that stake taken out, or a win held back, and no ack is ever going to
       * arrive to put it right. Reading the account's own figure again is the
       * only way to leave without stranding it.
       *
       * The fun book needs nothing here — its purse dies with the page
       * regardless, same as it would have if the drop had landed.
       */
      if (!books.current.chips.idle() || strandedChips.current.size > 0) {
        accountRef.current.refresh();
      }
    };
  }, []);

  const refuseBall = useCallback(
    (id: string) => {
      const ball = balls.current.get(id);
      if (ball !== undefined) ball.refusedAt = performance.now();
    },
    [balls],
  );

  const drop = useCallback(
    ({ fun, stake, risk }: { fun: boolean; stake: number; risk: Risk }): string | null => {
      const balance = fun ? funPurse : (accountRef.current.profile?.chips ?? null);
      if (balance === null) {
        return null;
      }
      seq.current += 1;
      const id = `me-${seq.current}`;
      const mine = fun ? books.current.fun : books.current.chips;
      setNotice(null);
      // The stake is the player's own number, so it goes on the press.
      mine.press(id, stake, balance);
      push(fun);
      play("bet");
      balls.current.set(id, {
        id,
        mine: true,
        colour: 0,
        name: null,
        risk,
        droppedAt: performance.now(),
        path: null,
        answeredAt: null,
        refusedAt: null,
        bucket: null,
        mult: null,
        stake,
        won: 0,
        fun,
      });
      const timer = window.setTimeout(() => {
        timers.current.delete(id);
        mine.giveUp(id);
        if (!fun) strandedChips.current.add(id);
        refuseBall(id);
        setNotice(NO_ANSWER);
        push(fun);
      }, PATIENCE_MS);
      timers.current.set(id, timer);

      emit({ stake, risk, ...(fun ? { forFun: true } : {}) }, (result) => {
        const waiting = timers.current.get(id);
        if (waiting === undefined) {
          // Too late to animate, not too late to be true: the balance and the
          // sign are still what the server just said, even for a ball this
          // page already gave up on and lifted back into the chute. `won` is
          // never held back here — that ball will never call `land`, so
          // anything parked in `unlanded` for it would never come back out.
          // Either way, the uncertainty a give-up leaves behind is resolved
          // now, whether the answer was yes or no.
          if (!fun) strandedChips.current.delete(id);
          if (result.ok) {
            mine.answer(id, result.balance, 0);
            push(fun);
            onSign(fun, { bank: result.bank, caps: result.caps });
          }
          return;
        }
        window.clearTimeout(waiting);
        timers.current.delete(id);
        if (!result.ok) {
          mine.refuse(id);
          refuseBall(id);
          setNotice(result.error);
          play("refused");
          push(fun);
          return;
        }
        mine.answer(id, result.balance, result.won);
        push(fun);
        onSign(fun, { bank: result.bank, caps: result.caps });
        const ball = balls.current.get(id);
        if (ball !== undefined) {
          ball.path = result.path;
          ball.bucket = result.bucket;
          ball.mult = result.mult;
          ball.won = result.won;
          ball.answeredAt = performance.now();
        }
      });
      return id;
    },
    [funPurse, push, emit, onSign, balls, refuseBall],
  );

  const land = useCallback(
    (id: string, fun: boolean) => {
      const mine = fun ? books.current.fun : books.current.chips;
      mine.land(id);
      push(fun);
    },
    [push],
  );

  return {
    funPurse,
    busy: !books.current.chips.idle() || !books.current.fun.idle(),
    chipsInAir: books.current.chips.inAir(),
    funInAir: books.current.fun.inAir(),
    notice,
    drop,
    land,
  };
}
