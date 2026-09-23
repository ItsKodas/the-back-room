import type { Coup } from "@backroom/game-baccarat";
import { schedule } from "@backroom/game-baccarat";
import { useEffect, useRef } from "react";
import { play, preload, unlock } from "../game/audio.js";

/**
 * Turns a coup's reveal into sound.
 *
 * Blackjack's `useCardSound` compares one state to the next, because a card
 * table's cards arrive whenever a person acts. Baccarat's do not: the whole
 * schedule is fixed the instant betting closes, so this fires straight off
 * `schedule(coup)` — one timer per `outAt` for the card sliding out, one per
 * `turnAt` for it turning over — rather than diffing anything.
 *
 * Scheduled once a coup, keyed on `deadline` rather than on `coup` itself. A
 * broadcast that changes nothing about the coup — another seat's chat, a
 * watcher joining — still hands this hook a brand-new `coup` object over the
 * wire, and re-arming every timer on each of those would replay the whole
 * deal's sound from wherever the clock happened to be. `deadline` is the one
 * primitive that actually identifies "which coup, dealt when" across however
 * many times it is retransmitted.
 */
export function useCoupSound(coup: Coup | null, deadline: number | null, dealMs: number): void {
  const armedFor = useRef<number | null>(null);

  // Fetching needs nothing from the browser; playing does. Pulled straight
  // away so the files are ready by the time a touch unlocks the context.
  useEffect(() => {
    void preload();
  }, []);

  useEffect(() => {
    const wake = () => unlock();
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  useEffect(() => {
    if (coup === null || deadline === null) {
      armedFor.current = null;
      return;
    }
    if (armedFor.current === deadline) {
      // Already scheduled for this exact deal — a re-broadcast of the same
      // coup, not a new one.
      return;
    }
    armedFor.current = deadline;

    const start = deadline - dealMs;
    const timers: number[] = [];
    for (const reveal of schedule(coup).cards) {
      /*
       * Negative here means the moment is already behind us — somebody
       * reconnecting mid-deal, or a clock a hair out of step with the
       * server's. A card that has already come out is not a card whose sound
       * this window gets to play late.
       */
      const outIn = start + reveal.outAt - Date.now();
      if (outIn > 0) {
        timers.push(window.setTimeout(() => play("card"), outIn));
      }
      const turnIn = start + reveal.turnAt - Date.now();
      if (turnIn > 0) {
        timers.push(window.setTimeout(() => play("reveal"), turnIn));
      }
    }
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [coup, deadline, dealMs]);
}
