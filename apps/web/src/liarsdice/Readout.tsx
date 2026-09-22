import type { TableView } from "@backroom/game-liars-dice";
import { says } from "@backroom/game-liars-dice";

export interface Stat {
  term: string;
  value: string;
  /** True for a figure that is chips, which is the only thing allowed gold. */
  chips: boolean;
}

export interface ReadoutModel {
  label: string;
  figure: string;
  tone: "plain" | "chips" | "good" | "bad";
  note: string | null;
  stats: Stat[];
  /** How much of the turn is left, 0 to 1, or null when no clock is running. */
  clock: number | null;
}

const fmt = (n: number) => n.toLocaleString("en-US");

const nameOf = (state: TableView, seatId: string | null): string =>
  state.seats.find((seat) => seat.id === seatId)?.name ?? "Somebody";

/**
 * The one figure this player is deciding about, and what backs it up.
 *
 * Worked out here rather than in the component so every state the table can be
 * in has a test that says what the screen says in it.
 */
export function readoutFor({
  state,
  seatId,
  turnLeft,
}: {
  state: TableView;
  seatId: string | null;
  /** Seconds left on whoever's turn it is. */
  turnLeft: number | null;
}): ReadoutModel {
  const stats: Stat[] = [
    { term: "Pot", value: fmt(state.pot), chips: true },
    { term: "Dice", value: fmt(state.total), chips: false },
  ];
  const clock =
    turnLeft === null
      ? null
      : Math.max(0, Math.min(1, (turnLeft * 1000) / Math.max(1, state.turnMs)));

  if (state.phase === "over") {
    const winner = nameOf(state, state.winnerIds[0] ?? null);
    const mine = state.winnerIds[0] === seatId;
    /*
     * The figure names the winner rather than saying "You won": this is the
     * one line the whole table reads off the same screen, and a spectator's
     * copy has to say the same thing a winner's does.
     */
    return {
      label: "The last one holding dice",
      figure: `${winner} won`,
      tone: mine ? "good" : "plain",
      note: mine ? `You take ${fmt(state.pot)}.` : `${winner} takes ${fmt(state.pot)}.`,
      stats,
      clock: null,
    };
  }

  const shown = state.resolution;
  if (shown !== null) {
    /*
     * A revealed round. The one figure is the count, because it is the only
     * thing at the table nobody could have worked out for themselves — and the
     * label says what it is a count of, so the number means something.
     */
    const cost = shown.losers.map((one) => nameOf(state, one)).join(", ");
    return {
      label: `${says(shown.bid)} on the table`,
      figure: fmt(shown.count),
      tone: shown.right ? "good" : "bad",
      note:
        shown.call === "exact"
          ? shown.right
            ? `${nameOf(state, shown.caller)} called it exactly. ${cost} each lose a die.`
            : `${nameOf(state, shown.caller)} called it exactly and was wrong.`
          : `${nameOf(state, shown.caller)} called liar. ${cost} loses a die.`,
      stats,
      clock: null,
    };
  }

  if (state.bid === null) {
    return {
      label: state.phase === "waiting" ? "Waiting on the table" : `Round ${state.round}`,
      figure: state.phase === "waiting" ? "No game yet" : "No bid yet",
      tone: "plain",
      note:
        state.phase === "waiting"
          ? `${fmt(state.ante)} each, ${state.startingDice} dice each.`
          : `${nameOf(state, state.toAct)} opens.`,
      stats,
      clock,
    };
  }

  const yours = state.toAct === seatId;
  return {
    label: "The bid",
    figure: says(state.bid),
    tone: "plain",
    note: `${nameOf(state, state.bidder)} said it. ${yours ? "Your call." : `${nameOf(state, state.toAct)} to act.`}`,
    stats,
    clock,
  };
}

/**
 * The one figure, big, with what backs it up beside it as one block, and the
 * turn clock draining along the top edge.
 *
 * `aria-live="polite"` is the only announcement a screen-reader user gets that
 * the turn has moved — the seat rail marks the turn with a class alone — so it
 * stays regardless of what else changes here.
 */
export function Readout({ model }: { model: ReadoutModel }) {
  return (
    <div className="readout ld__readout" aria-live="polite">
      {model.clock === null ? null : (
        <span
          className="ld__clock"
          aria-hidden="true"
          style={{ transform: `scaleX(${model.clock})` }}
        />
      )}
      <p className="label">{model.label}</p>
      <p className={`readout__figure ld__figure ld__figure--${model.tone}`}>{model.figure}</p>
      {model.note === null ? null : <p className="readout__note">{model.note}</p>}
      <dl className="ld__stats">
        {model.stats.map((stat) => (
          <div className="ld__stat" key={stat.term}>
            <dt className="label">{stat.term}</dt>
            <dd className={stat.chips ? "tag tag--chips" : "tag"}>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
