import type { TableView } from "@backroom/game-scribble";
import { useEffect, useState } from "react";
import { useSecondsLeft } from "./useSecondsLeft.js";

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
  const left = useSecondsLeft(state.deadline, state.now);
  useEffect(() => {
    if (error !== null) {
      setChosen(null);
    }
  }, [error]);

  const turn = state.turn;
  const pickerName = state.seats.find((one) => one.id === turn?.picker)?.name ?? "Somebody";
  const picking = turn?.picker === seatId;
  const choices = state.choices;

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
      <section className="housing sc-pick" role="dialog" aria-label="Pick a word">
        <header className="housing__head">
          <span className="label">
            {picking ? "Your pick" : `${pickerName} is picking`}
            {partner !== undefined ? ` · with ${picking ? partner : "you"}` : ""}
          </span>
          <span className="tag tag--live">0:{String(left ?? 0).padStart(2, "0")}</span>
        </header>
        <div className="housing__body">
          <div className="plates" role="radiogroup" aria-label="Words">
            {choices.map((word, index) => (
              <button
                key={word}
                type="button"
                role="radio"
                aria-checked={chosen === index}
                disabled={!picking}
                className="plate"
                onClick={() => {
                  if (chosen !== null) {
                    return;
                  }
                  setChosen(index);
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
