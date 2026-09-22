import type { SeatView, TableView } from "@backroom/game-liars-dice";
import { Avatar } from "../game/Avatar.js";

/**
 * What a plate says about a seat, and how it is dressed.
 *
 * Pulled out of the component so every state a seat can be in has a test that
 * says what the plate says in it — there are eight of them and they interact.
 */
export function seatState(
  seat: SeatView,
  state: TableView,
): { word: string | null; classes: string } {
  const classes = ["ld__seat"];
  if (state.toAct === seat.id) {
    classes.push("is-turn");
  }
  if (state.you !== null && state.you.id === seat.id) {
    classes.push("is-you");
  }
  let word: string | null = null;
  /*
   * In the order somebody reads them: gone beats everything, because a seat
   * nobody is behind is not waiting or short or ready. Out beats the rest
   * because it is the end of that player's game.
   */
  if (!seat.connected) {
    classes.push("is-gone");
    word = "Gone";
  } else if (seat.out) {
    classes.push("is-out");
    word = "Out";
  } else if (seat.waiting) {
    classes.push("is-waiting");
    word = "Next game";
  } else if (seat.short) {
    classes.push("is-short");
    word = "Short";
  } else if (state.phase === "waiting" && seat.ready) {
    classes.push("is-ready");
    word = "Ready";
  }
  if (seat.isBot) {
    classes.push("is-bot");
  }
  return { word, classes: classes.join(" ") };
}

/**
 * The rail of seats across the top of the felt.
 *
 * A compact plate each, because ten of them have to fit a phone: an avatar, the
 * dice still in front of them as pips, and a name only where a name is worth
 * the width — the seat to act and your own. At a desk every name shows, which
 * the stylesheet does rather than this.
 *
 * The pips are decoration and are marked so; the count is said in words beside
 * them, which is the version a screen reader reads.
 *
 * Pips are drawn from `dice`, never `hand`: in the window between a call and
 * the next deal, whoever just lost a die already has the lower `dice` count
 * while `hand` still shows the hand they were judged on, and the two can
 * disagree in length. The rail answers "how many are left", which is `dice`.
 *
 * The row is `state.startingDice` pips long, not a fixed five: at a
 * three-dice table five would draw two pips nobody was ever dealt, and every
 * seat would read as already down two dice from the moment the game opens.
 */
export function Seats({ state, seatId }: { state: TableView; seatId: string | null }) {
  return (
    <ol className="ld__rail" aria-label="The table">
      {state.seats.map((seat) => {
        const { word, classes } = seatState(seat, state);
        const named = state.toAct === seat.id || seat.id === seatId;
        return (
          <li className={classes} key={seat.id}>
            <Avatar
              name={seat.name}
              avatar={seat.avatar}
              accentColor={seat.accentColor}
              className="ld__face"
            />
            <span className="pips ld__dice" aria-hidden="true">
              {Array.from({ length: state.startingDice }, (_, at) => (
                // A pip has no identity beyond its position in the row — the
                // row's length never changes, so the index is stable.
                // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
                <span className={`pip${at < seat.dice ? " pip--on" : ""}`} key={at} />
              ))}
            </span>
            {/* The name is hidden on a phone for everybody but these two, by
                the stylesheet — it stays in the markup so it is always read. */}
            <span className={`ld__name${named ? "" : " ld__name--quiet"}`}>{seat.name}</span>
            <span className="ld__count">{seat.dice} dice</span>
            {word === null ? null : <span className="tag ld__state">{word}</span>}
          </li>
        );
      })}
    </ol>
  );
}
