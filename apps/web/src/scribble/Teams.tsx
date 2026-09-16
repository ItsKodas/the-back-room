import type { SeatView, TableView } from "@backroom/game-scribble";
import { useState } from "react";

function Roster({ seats, seatId }: { seats: SeatView[]; seatId: string | null }) {
  return (
    <ul className="sc-roster">
      {seats.map((one) => (
        <li key={one.id} className={one.id === seatId ? "is-you" : undefined}>
          <span className={`sc-roster__name${one.drawing ? " sc-pen" : ""}${one.guessed ? " sc-got" : ""}`}>
            {one.drawing ? "✎ " : one.guessed ? "✓ " : ""}
            {one.id === seatId ? "You" : one.name}
          </span>
          <span className="sc-pts">{one.score.toLocaleString("en-GB")}</span>
        </li>
      ))}
    </ul>
  );
}

/** Scores: wells down the side on a desk, and four pills that open them on a phone. */
export function Teams({ state, seatId }: { state: TableView; seatId: string | null }) {
  // Which team's well is tapped open on a phone — one at a time, and each pill only speaks for itself.
  const [open, setOpen] = useState<number | null>(null);

  if (state.mode === "solo") {
    const ranked = [...state.seats].sort((a, b) => b.score - a.score);
    return (
      <aside className="sc-teams" aria-label="Scores">
        <div className="well sc-team">
          <Roster seats={ranked} seatId={seatId} />
        </div>
      </aside>
    );
  }

  const drawingTeam = state.turn?.team ?? null;
  return (
    <aside className="sc-teams" aria-label="Team scores">
      <div className="sc-pills">
        {state.teams.map((team) => (
          <button
            key={team.index}
            type="button"
            className={`sc-pill sc-team sc-team--${team.index}${drawingTeam === team.index ? " sc-team--drawing" : ""}`}
            aria-expanded={open === team.index}
            aria-label={`${team.name}, ${team.score.toLocaleString("en-GB")}${drawingTeam === team.index ? ", drawing" : ""}`}
            onClick={() => setOpen((was) => (was === team.index ? null : team.index))}
          >
            {team.score.toLocaleString("en-GB")}
          </button>
        ))}
      </div>
      <div className="sc-teams__wells">
        {state.teams.map((team) => (
          <div
            key={team.index}
            className={`well sc-team sc-team--${team.index}${drawingTeam === team.index ? " sc-team--drawing" : ""}${open === team.index ? " is-open" : ""}`}
          >
            <div className="sc-team__head">
              <span className="sc-team__name">{team.name}</span>
              <span className="sc-team__score">{team.score.toLocaleString("en-GB")}</span>
            </div>
            <Roster seats={state.seats.filter((one) => team.members.includes(one.id))} seatId={seatId} />
          </div>
        ))}
      </div>
    </aside>
  );
}
