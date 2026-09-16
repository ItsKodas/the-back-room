import type { TableView } from "@backroom/game-scribble";
import { COUNTDOWN_MS, PICK_MS, RESULT_MS, REVEAL_MS, TEAM_NAMES } from "@backroom/game-scribble";
import type { CSSProperties } from "react";
import { useSecondsLeft } from "./useSecondsLeft.js";

const clock = (seconds: number | null) =>
  seconds === null ? "" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function Word({ state }: { state: TableView }) {
  if (state.word !== null) {
    return <span className="sc-word sc-word--shown">{state.word.toUpperCase()}</span>;
  }
  if (state.mask === null) {
    return null;
  }
  const letters = state.mask.filter((one) => one === null || /\p{L}/u.test(one)).length;
  return (
    // A guesser's masked word is a picture of blanks and letters, read out as its count.
    <span className="sc-word" role="img" aria-label={`${letters} letters`}>
      {state.mask.map((one, index) =>
        one === " " ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a letter's place in the word is its identity
          <b key={index} className="sc-word__gap" />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a letter's place in the word is its identity
          <i key={index} className={one === null ? undefined : "is-open"}>
            {one?.toUpperCase() ?? ""}
          </i>
        ),
      )}
      <span className="sc-word__len">{letters}</span>
    </span>
  );
}

export function Strip({ state }: { state: TableView }) {
  const left = useSecondsLeft(state.deadline, state.now);
  const total = { waiting: COUNTDOWN_MS, picking: PICK_MS, drawing: state.drawMs, reveal: REVEAL_MS, over: RESULT_MS }[
    state.phase
  ];
  const drawers = state.seats.filter((one) => one.drawing).map((one) => (one.id === state.you?.id ? "You" : one.name));
  const turn = state.turn;
  const who =
    turn !== null && turn.team !== null
      ? `${TEAM_NAMES[turn.team]} draws`
      : drawers.length > 0
        ? `${drawers.join(" & ")} ${drawers[0] === "You" ? "draw" : "draws"}`
        : "";
  const fuse = left === null ? 0 : Math.min(1, (left * 1000) / total);
  return (
    <div className="sc-strip" style={{ "--left": `${fuse * 100}%` } as CSSProperties}>
      <div className="sc-strip__turn">
        <span>{state.round > 0 ? `Round ${state.round} of ${state.rounds}` : "Waiting"}</span>
        <b>{who}</b>
      </div>
      <Word state={state} />
      <span className="sc-clock" role="timer" aria-label={left === null ? undefined : `${left} seconds left`}>
        {clock(left)}
      </span>
    </div>
  );
}
