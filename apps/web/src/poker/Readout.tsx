import type { TableView } from "@backroom/game-poker";
import type { CSSProperties } from "react";
import { useCountdown } from "../game/useCountdown.js";
import { fmt } from "./Felt.js";

export interface ReadoutModel {
  label: string;
  figure: string;
  tone: "chips" | "plain";
  /** Chips 1,840 · 4,120 left — the pot and what backs the figure, as one block. */
  note: string;
  /** The turn clock along the top edge, null when nobody is on the clock. */
  endsAt: number | null;
  turnMs: number;
}

/**
 * The one figure this player is deciding about.
 *
 * Worked out here rather than in the component so every state the table can
 * be in — yours to answer, somebody else's turn, or nobody dealt in yet — has
 * a test that says what the screen says in it, without rendering a table.
 */
export function readoutFor({
  state,
  seatId,
}: {
  state: TableView;
  seatId: string | null;
}): ReadoutModel {
  const me = state.seats.find((seat) => seat.id === seatId) ?? null;
  // Nobody's turn, nobody's clock — a readout cannot drain against a deadline
  // that stopped meaning anything the moment `toAct` went to null.
  const clock = state.toAct === null ? null : state.turnEndsAt;

  if (state.street === "waiting") {
    const enough = state.seats.filter((seat) => seat.stack > 0).length >= 2;
    return {
      label: "Waiting",
      figure: fmt(state.pot),
      tone: "plain",
      // A table that cannot find a second real player does not deal, and says so.
      note: enough ? "Next hand shortly." : "Waiting for another player.",
      endsAt: null,
      turnMs: state.turnMs,
    };
  }

  if (me !== null && state.toAct === me.id && state.you !== null) {
    const free = state.you.toCall === 0;
    return {
      label: free ? "To check" : "To call",
      // Nought is a number, and a number reads as a price. Checking has none.
      figure: free ? "Free" : fmt(state.you.toCall),
      tone: free ? "plain" : "chips",
      note: `Pot ${fmt(state.pot)} · ${fmt(me.stack)} left`,
      endsAt: clock,
      turnMs: state.turnMs,
    };
  }

  return {
    label: "Pot",
    figure: fmt(state.pot),
    tone: "chips",
    note: state.lastEvent ?? "Waiting for the others.",
    endsAt: clock,
    turnMs: state.turnMs,
  };
}

/**
 * The readout, as a fitting in the felt's own "read" grid area.
 *
 * The clock is a bar draining along the top edge rather than `TurnRing`'s
 * ring — a different shape for the same deadline — so it reuses `TurnRing`'s
 * arithmetic (seconds left, over how long a turn is, is how much is left)
 * rather than a second copy of it. `useCountdown` is the same hook the ring
 * itself is built on.
 */
export function Readout({ model }: { model: ReadoutModel }) {
  const secondsLeft = useCountdown(model.endsAt);
  const part =
    secondsLeft === null || model.endsAt === null
      ? null
      : Math.max(0, Math.min(1, (secondsLeft * 1000) / Math.max(1, model.turnMs)));

  return (
    <section className="readout pk__read" aria-label="This turn">
      {part !== null ? (
        <span
          className="pk__read-clock"
          style={{ "--t": `${Math.round(part * 100)}%` } as CSSProperties}
          aria-hidden="true"
        />
      ) : null}
      <div className="pk__read-big">
        <span className="pk__read-label">{model.label}</span>
        <span className={`pk__read-figure pk__read-figure--${model.tone}`}>{model.figure}</span>
      </div>
      <p className="pk__read-note">{model.note}</p>
    </section>
  );
}
