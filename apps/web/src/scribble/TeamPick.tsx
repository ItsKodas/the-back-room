import type { TableView } from "@backroom/game-scribble";
import { mayJoin } from "@backroom/game-scribble";
import { useEffect, useState } from "react";
import { useSecondsLeft } from "./useSecondsLeft.js";

export function TeamPick({
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
  // Where you pressed to go. Your own seat is a choice you made, so you move on the press.
  const [moved, setMoved] = useState<number | null>(null);
  const left = useSecondsLeft(state.deadline, state.now);
  const serverTeam = state.you?.team ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the server answering either way is the trigger
  useEffect(() => {
    setMoved(null);
  }, [serverTeam, error]);

  const mine = moved ?? serverTeam;
  const others = state.teams.map((team) => team.members.filter((id) => id !== seatId));
  const name = (id: string) => (id === seatId ? "You" : (state.seats.find((one) => one.id === id)?.name ?? ""));
  const short = Math.max(0, state.minimum - state.seats.length);

  return (
    <section className="housing sc-teampick" aria-label="Pick a team">
      <header className="housing__head">
        <span className="label">Next game · Teams</span>
        <span className={`tag${left !== null ? " tag--live" : ""}`}>
          {left !== null ? `Starts in 0:${String(left).padStart(2, "0")}` : `Waiting for ${short} more`}
        </span>
      </header>
      <div className="housing__body">
        <div className="plates" role="radiogroup" aria-label="Your team">
          {state.teams.map((team) => {
            const members = [...(others[team.index] ?? []), ...(mine === team.index && seatId !== null ? [seatId] : [])];
            const open = mine === team.index || mayJoin(others.map((one) => one.length), team.index);
            return (
              <button
                key={team.index}
                type="button"
                role="radio"
                aria-checked={mine === team.index}
                aria-label={`${team.name}, ${members.length} ${members.length === 1 ? "player" : "players"}`}
                disabled={!open}
                className={`plate sc-team sc-team--${team.index}`}
                onClick={() => {
                  if (mine === team.index) {
                    return;
                  }
                  setMoved(team.index);
                  act({ type: "pickTeam", team: team.index });
                }}
              >
                <span className="plate__name">
                  <span>{team.name}</span>
                  <span className="sc-pts">{members.length}</span>
                </span>
                <span className="plate__note">
                  {members.length === 0 ? "Nobody yet" : members.map(name).join(", ")}
                  {open ? "" : " · full for now"}
                </span>
              </button>
            );
          })}
        </div>
        <p className="hint">No team can be more than one bigger than another. Anyone who hasn't picked is placed when it deals.</p>
      </div>
    </section>
  );
}
