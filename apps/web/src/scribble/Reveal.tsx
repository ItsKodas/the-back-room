import type { TableView } from "@backroom/game-scribble";
import { TEAM_NAMES } from "@backroom/game-scribble";
import type { CSSProperties } from "react";

export function Reveal({ state, seatId }: { state: TableView; seatId: string | null }) {
  const reveal = state.reveal;
  if (reveal === null) {
    return null;
  }
  const name = (id: string) =>
    id === seatId ? "You" : (state.seats.find((one) => one.id === id)?.name ?? "Somebody who left");
  const teamOf = (id: string) => state.seats.find((one) => one.id === id)?.team ?? null;
  const scored = [...reveal.scored].sort((a, b) => b.points - a.points);

  let result: string | null = null;
  if (state.phase === "over") {
    if (state.mode === "teams") {
      const top = Math.max(...state.teams.map((team) => team.score));
      const winners = state.teams.filter((team) => team.score === top).map((team) => team.name);
      result = winners.length === 1 ? `${winners[0]} win` : `${winners.join(" & ")} tie`;
    } else {
      const names = state.winners.map(name);
      result = names.length === 1 ? `${names[0]} ${names[0] === "You" ? "win" : "wins"}` : `${names.join(" & ")} tie`;
    }
  }

  return (
    <div className="sc-over">
      <section className="housing sc-reveal" aria-label={result ?? "The word was"}>
        {result !== null ? (
          <header className="housing__head">
            <span className="label">Game over</span>
            <span className="sc-reveal__result">{result}</span>
          </header>
        ) : null}
        <div className="housing__body">
          <div className="lcd" role="img" aria-label={`The word was ${reveal.word}`}>
            <div className="lcd__cells">
              {[...reveal.word.toUpperCase()].map((letter, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: a letter's place in the word is its identity
                  key={index}
                  className="lcd__cell sc-reveal__cell"
                  style={{ "--at": index } as CSSProperties}
                >
                  {letter === " " ? " " : letter}
                </span>
              ))}
            </div>
          </div>
          {reveal.abandoned ? <p className="notice">Nobody left drawing, so nobody scored this turn.</p> : null}
          {state.mode === "teams" ? (
            <div className="sc-reveal__teams">
              {state.teams.map((team) => {
                const delta = reveal.scored
                  .filter((one) => teamOf(one.seatId) === team.index)
                  .reduce((sum, one) => sum + one.points, 0);
                return (
                  <div key={team.index} className={`readout sc-team sc-team--${team.index}`}>
                    <span className="readout__note">
                      {TEAM_NAMES[team.index]} · +{delta}
                    </span>
                    <span className="readout__figure">{team.score.toLocaleString("en-GB")}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
          <ul className="rows">
            {scored.map((one) => (
              <li key={`${one.seatId}-${one.drew}`} className={`row sc-row${one.seatId === seatId ? " row--you" : ""}`}>
                <span className="row__who">
                  <span className="row__name">{name(one.seatId)}</span>
                  <span className="row__meta">{one.drew ? "drew it" : "guessed it"}</span>
                </span>
                <span />
                <span className="sc-pts sc-pts--got">+{one.points}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
