import type { TableView } from "@backroom/game-scribble";
import { mayJoin } from "@backroom/game-scribble";
import { useEffect, useRef, useState } from "react";
import { clock } from "./Strip.js";
import { useSecondsLeft } from "./useSecondsLeft.js";

/*
 * `waiting` has no deadline of its own while the table is short of players,
 * so unlike WordPick this timer is the *only* thing that ever un-sticks a
 * lost or twice-refused move — there is no phase change to fall back on.
 */
const GIVE_UP_MS = 6_000;

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
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const left = useSecondsLeft(state.deadline, state.now);
  const serverTeam = state.you?.team ?? null;

  const settle = () => {
    if (giveUp.current !== null) {
      clearTimeout(giveUp.current);
      giveUp.current = null;
    }
    setMoved(null);
  };

  /*
   * The fast path: the server answering either way — a new team on `you`, or
   * a refusal — is the trigger. It is not the only path: a *second* refusal
   * carrying the same string leaves `error`'s identity unchanged, so the
   * timer armed on press (below) is what un-sticks that case, and the case
   * where no answer ever comes at all.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: settle only closes over refs and setMoved, both stable across renders
  useEffect(() => {
    settle();
  }, [serverTeam, error]);

  useEffect(
    () => () => {
      if (giveUp.current !== null) {
        clearTimeout(giveUp.current);
      }
    },
    [],
  );

  const mine = moved ?? serverTeam;
  const others = state.teams.map((team) => team.members.filter((id) => id !== seatId));
  const name = (id: string) => (id === seatId ? "You" : (state.seats.find((one) => one.id === id)?.name ?? ""));
  const short = Math.max(0, state.minimum - state.seats.length);

  return (
    <section className="housing sc-teampick" aria-label="Pick a team">
      <header className="housing__head">
        <span className="label">Next game · Teams</span>
        <span className={`tag${left !== null ? " tag--live" : ""}`}>
          {left !== null ? `Starts in ${clock(left)}` : `Waiting for ${short} more`}
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
                  // Changing your mind before the server has answered is legitimate — unlike
                  // WordPick's one-shot word, a team switch just replaces the outstanding one,
                  // so the timer it's replacing has to go with it or its own expiry later
                  // reverts a pick nobody refused.
                  if (giveUp.current !== null) {
                    clearTimeout(giveUp.current);
                  }
                  setMoved(team.index);
                  giveUp.current = setTimeout(() => {
                    giveUp.current = null;
                    setMoved(null);
                  }, GIVE_UP_MS);
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
