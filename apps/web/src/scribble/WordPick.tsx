import type { TableView } from "@backroom/game-scribble";
import { useEffect, useRef, useState } from "react";
import { clock } from "./Strip.js";
import { useSecondsLeft } from "./useSecondsLeft.js";

/*
 * Long enough that a refusal arriving over a slow connection still lands
 * before this fires, short enough that a press the table never answered
 * doesn't leave a plate lit for the rest of the pick window.
 */
const GIVE_UP_MS = 6_000;

export function WordPick({
  state,
  seatId,
  act,
  error,
}: {
  state: TableView;
  seatId: string | null;
  act: (action: Record<string, unknown>) => void;
  error: string | null;
}) {
  // Which plate you pressed. A word you chose is yours to light at once.
  const [chosen, setChosen] = useState<number | null>(null);
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const left = useSecondsLeft(state.deadline, state.now);
  const dialogRef = useRef<HTMLElement | null>(null);
  const firstPlateRef = useRef<HTMLButtonElement | null>(null);

  const settle = () => {
    if (giveUp.current !== null) {
      clearTimeout(giveUp.current);
      giveUp.current = null;
    }
    setChosen(null);
  };

  /*
   * The fast path: a refusal changes `error`, so this fires the moment it
   * arrives. It is not the only path — see the timer armed on press below —
   * because a *second* refusal carrying the same string leaves `error`
   * unchanged, and this effect only re-runs when it changes.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: settle only closes over refs and setChosen, both stable across renders
  useEffect(() => {
    if (error !== null) {
      settle();
    }
  }, [error]);

  useEffect(
    () => () => {
      if (giveUp.current !== null) {
        clearTimeout(giveUp.current);
      }
    },
    [],
  );

  const turn = state.turn;
  const pickerName = state.seats.find((one) => one.id === turn?.picker)?.name ?? "Somebody";
  const picking = turn?.picker === seatId;
  const choices = state.choices;

  // The dialog steals focus once, when it appears — not on every tick of its own clock.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only whether choices exist (not their contents) should refocus
  useEffect(() => {
    if (choices === null) {
      return;
    }
    if (picking) {
      firstPlateRef.current?.focus();
    } else {
      dialogRef.current?.focus();
    }
  }, [choices !== null]);

  if (choices === null) {
    return (
      <div className="sc-over">
        <p className="notice sc-over__note">{pickerName} is choosing a word…</p>
      </div>
    );
  }

  const partner = state.seats.find((one) => one.drawing && one.id !== seatId)?.name;
  return (
    <div className="sc-over">
      <section
        className="housing sc-pick"
        role="dialog"
        aria-modal="true"
        aria-label="Pick a word"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="housing__head">
          <span className="label">
            {picking ? "Your pick" : `${pickerName} is picking`}
            {partner !== undefined ? ` · with ${picking ? partner : "you"}` : ""}
          </span>
          <span className="tag tag--live">{clock(left ?? 0)}</span>
        </header>
        <div className="housing__body">
          <div className="plates" role="radiogroup" aria-label="Words">
            {choices.map((word, index) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: a choice's position is its identity — "pick" acts on the index, not the word
                key={index}
                type="button"
                role="radio"
                aria-checked={chosen === index}
                disabled={!picking}
                className="plate"
                ref={index === 0 ? firstPlateRef : undefined}
                onClick={() => {
                  if (chosen !== null) {
                    return;
                  }
                  setChosen(index);
                  giveUp.current = setTimeout(() => {
                    giveUp.current = null;
                    setChosen(null);
                  }, GIVE_UP_MS);
                  act({ type: "pick", index });
                }}
              >
                <span className="plate__name">{`${word.charAt(0).toUpperCase()}${word.slice(1)}`}</span>
                <span className="plate__note">{word.replace(/[^\p{L}]/gu, "").length} letters</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
