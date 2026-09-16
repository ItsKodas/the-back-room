import type { TableView } from "@backroom/game-scribble";
import { COUNTDOWN_MS, PICK_MS, RESULT_MS, REVEAL_MS, TEAM_NAMES } from "@backroom/game-scribble";
import type { CSSProperties } from "react";
import { useSecondsLeft } from "./useSecondsLeft.js";

// Shared with WordPick and TeamPick, so "0:07" is spelled the same way everywhere it's shown.
export const clock = (seconds: number | null) =>
  seconds === null ? "" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/*
 * What a screen reader says for the mask, in the order the letters sit.
 * `role="img"` replaces the DOM content with this string, so a hint that
 * opens has to be spoken here or a blind player never learns which letter
 * the server just revealed — a letter count alone never changes when a hint
 * does.
 */
const speak = (mask: (string | null)[]) =>
  mask.map((one) => (one === null ? "blank" : one === " " ? "space" : one.toUpperCase())).join(", ");

/**
 * The fuse's shape for a single CSS animation: how much of the bar is still
 * unburned right now, and how long it has left to burn — both read from the
 * server's own `now` rather than the browser's clock, so a turn that starts
 * mid-render (a phone that just woke up, a client that just reconnected)
 * still gets a burn that lines up with everyone else's, and this is provable
 * against a fake clock instead of only by eye.
 */
function fuseAt(deadline: number | null, now: number, totalMs: number): { from: number; ms: number } {
  if (deadline === null || totalMs <= 0) {
    return { from: 0, ms: 0 };
  }
  const ms = Math.max(0, deadline - now);
  return { from: Math.min(1, ms / totalMs), ms };
}

function Word({ state }: { state: TableView }) {
  if (state.word !== null) {
    return <span className="sc-word sc-word--shown">{state.word.toUpperCase()}</span>;
  }
  if (state.mask === null) {
    return null;
  }
  const letters = state.mask.filter((one) => one === null || /\p{L}/u.test(one)).length;
  return (
    <span className="sc-word" role="img" aria-label={`${letters} letters: ${speak(state.mask)}`}>
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
  // Third person singular takes the "-s"; everything else — "you", or two names joined — doesn't.
  const verb = drawers.length === 1 && drawers[0] !== "You" ? "draws" : "draw";
  const turn = state.turn;
  const who =
    turn !== null && turn.team !== null
      ? `${TEAM_NAMES[turn.team]} draws`
      : drawers.length > 0
        ? `${drawers.join(" & ")} ${verb}`
        : "";
  const fuse = left === null ? 0 : Math.min(1, (left * 1000) / total);
  const { from, ms } = fuseAt(state.deadline, state.now, total);
  return (
    <div
      className="sc-strip"
      /*
       * Every timed phase (waiting, picking, drawing, reveal, over) hands out
       * its own `deadline`, so keying on phase and deadline together gives a
       * fresh key exactly when a new burn should start — a React key change
       * is what replays a CSS animation, the same trick Napkin.tsx uses for
       * the wipe. Without it the fuse would keep animating from wherever the
       * last turn's burn left off.
       */
      key={`${state.phase}:${state.deadline ?? "none"}`}
      style={
        {
          "--left": `${fuse * 100}%`,
          "--fuse-from": `${from * 100}%`,
          "--fuse-ms": `${ms}ms`,
        } as CSSProperties
      }
    >
      <div className="sc-strip__turn">
        <span>{state.round > 0 ? `Round ${state.round} of ${state.rounds}` : "Waiting"}</span>
        <b>{who}</b>
      </div>
      <Word state={state} />
      {/* A static name, so the region has one even the instant `left` is null; the count itself is its content. */}
      <span className="sc-clock" role="timer" aria-label="Time left">
        {clock(left)}
      </span>
    </div>
  );
}
