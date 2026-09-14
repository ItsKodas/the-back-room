import type { TauntPlay } from "@backroom/shared";
import { useEffect, useRef, useState } from "react";
import { playEmoteSound } from "../game/audio.js";

/**
 * A taunt landing.
 *
 * One at a time, in the order they were thrown. Two people mocking the same
 * seat in the same second is an ordinary thing at a table, and playing both at
 * once would be two animations fighting over one screen — which the house
 * style calls the bug rather than the effect. So they queue, and each gets its
 * moment.
 *
 * The animation says what happened without a word: the picture arrives from
 * the direction of whoever threw it, overshoots, and settles on the person it
 * was aimed at. A revenge throw comes back the other way and is marked, so it
 * reads as the pool coming home rather than as somebody paying twice.
 */

/** How long one stays on screen, including its way in and out. */
export const TAUNT_MS = 2600;

export interface TauntStageProps {
  /** Every taunt thrown at this table, oldest first. */
  landed: readonly TauntPlay[];
}

export function TauntStage({ landed }: TauntStageProps) {
  const [showing, setShowing] = useState<TauntPlay | null>(null);
  /*
   * How far down the log this stage has got.
   *
   * A cursor rather than a queue that gets spliced, because the log is owned
   * by the socket and is appended to while this is animating. Remembering the
   * position means a taunt that arrived mid-animation is picked up next rather
   * than missed or replayed.
   */
  const read = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (showing !== null) {
      return;
    }
    const next = landed[read.current];
    if (next === undefined) {
      return;
    }
    read.current += 1;
    setShowing(next);

    if (next.sound !== null) {
      /*
       * Through the building's own mixer rather than an <audio> element, so
       * this is under the player's volume and mute like everything else. A
       * sound is optional, and one that fails to load is not worth a word.
       */
      void playEmoteSound(next.sound);
    }

    timer.current = setTimeout(() => {
      setShowing(null);
      timer.current = null;
    }, TAUNT_MS);
  }, [landed, showing]);

  // A table left mid-animation should not fire a timer into a dead component.
  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  if (showing === null) {
    return null;
  }

  return (
    <div
      className={`taunt-stage${showing.revenge ? " taunt-stage--revenge" : ""}`}
      /*
       * Announced rather than merely shown. Something that appears, makes a
       * noise and leaves is exactly what a screen reader is otherwise never
       * told about — and being taunted is not a decorative detail.
       */
      role="status"
      aria-live="polite"
      key={showing.id}
    >
      {/*
        * An emote can be deleted while a pool still owes its replay. The line
        * below says everything that matters, so a picture that no longer
        * exists steps aside rather than drawing a broken image. The section
        * is keyed by play, so the next one starts visible again.
        */}
      <img
        className="taunt-stage__art"
        src={showing.image}
        alt=""
        onError={(event) => {
          event.currentTarget.hidden = true;
        }}
      />
      <p className="taunt-stage__line">
        {showing.revenge ? (
          <>
            <strong>{showing.fromName}</strong> won, and takes{" "}
            <span className="taunt-stage__chips">{showing.chips.toLocaleString("en-US")}</span>{" "}
            off <strong>{showing.atName}</strong>
          </>
        ) : (
          <>
            <strong>{showing.fromName}</strong> taunts <strong>{showing.atName}</strong> —{" "}
            <span className="taunt-stage__chips">{showing.chips.toLocaleString("en-US")}</span>{" "}
            riding on them
          </>
        )}
      </p>
    </div>
  );
}
