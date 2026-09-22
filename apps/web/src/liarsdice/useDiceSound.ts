import type { TableView } from "@backroom/game-liars-dice";
import { useEffect, useRef } from "react";
import { play } from "../game/audio.js";

/**
 * Turns changes at the table into sound.
 *
 * Every cue here answers a CHANGE between two views, never a view's mere
 * presence — the table resends the same state for all sorts of reasons that
 * have nothing to do with a new event (somebody sitting down, a taunt
 * landing), and a felt that re-announced the standing bid on every one of
 * those would be unbearable. The same rule is what keeps a player who
 * arrives mid-round from hearing the round they walked in on: the first view
 * this hook ever sees is a baseline to compare against, never itself a
 * change worth a sound.
 */
export function useDiceSound(state: TableView, seatId: string | null): void {
  const previous = useRef<TableView | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (before === null) {
      return;
    }

    /*
     * A new round dealt, never the round clearing back to nothing between
     * games — that reset happens on the way to "waiting" and is not a deal
     * at all, just the table letting go of the last one.
     */
    if (state.phase === "playing" && state.round !== before.round) {
      play("shake");
    }

    /*
     * The standing bid taking a new value, opening or raising alike — but
     * never the bid clearing at a fresh deal, which is the round change
     * above's business, and never a resend of the same value.
     */
    const bidChanged =
      state.bid !== null &&
      (before.bid === null ||
        state.bid.count !== before.bid.count ||
        state.bid.face !== before.bid.face);
    if (bidChanged) {
      play("sayRaise");
    }

    // A resolution arriving is the cups going up: which call it was decides
    // the voice, and the reveal always follows it.
    if (state.resolution !== null && before.resolution === null) {
      play(state.resolution.call === "exact" ? "sayExact" : "sayCall");
      play("reveal");
    }

    if (seatId !== null && state.toAct === seatId && before.toAct !== seatId) {
      play("yourTurn");
    }

    if (state.phase === "over" && before.phase !== "over") {
      play("potPush");
      // Only for the seat that actually won — a win cue for the seat that
      // just lost the last of its dice would be the table cheering at the
      // wrong person.
      if (seatId !== null && state.winnerIds.includes(seatId)) {
        play("win");
      }
    }
  }, [state, seatId]);
}
