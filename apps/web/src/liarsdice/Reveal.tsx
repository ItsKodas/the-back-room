import type { TableView } from "@backroom/game-liars-dice";
import { says } from "@backroom/game-liars-dice";
import { Hand } from "./Dice.js";

/**
 * Every cup up, the count, and who it cost.
 *
 * Over the play area rather than in it, because this is the one moment the felt
 * stops being a thing you act on and becomes a thing you read. The dice that
 * answered to the bid are lit — including the wild ones, which is the rule this
 * moment has to make obvious.
 */
export function Reveal({ state }: { state: TableView }) {
  const shown = state.resolution;
  if (shown === null) {
    return null;
  }
  // hand.length, never dice: a seat that just lost a die already shows the
  // lower count, but the hand here is the one that was judged, and the two
  // numbers answer different questions. Works between games too, when hand
  // is empty for everybody and there is nothing to reveal.
  const inRound = state.seats.filter((seat) => seat.hand.length > 0);

  return (
    <div className="ld__reveal" role="status">
      <p className="ld__tally">
        <span className="label">{says(shown.bid)}, and on the table</span>
        <span className={`ld__tally-count ld__tally-count--${shown.right ? "good" : "bad"}`}>
          {shown.count}
        </span>
      </p>
      <ol className="ld__shows">
        {inRound.map((seat) => (
          <li
            className={`ld__shown${shown.losers.includes(seat.id) ? " is-loser" : ""}`}
            key={seat.id}
          >
            <span className="ld__shown-name">{seat.name}</span>
            <Hand dice={seat.hand} matched={shown.bid.face} label={`${seat.name}'s dice`} />
            {shown.losers.includes(seat.id) ? (
              <span className="tag ld__lost">−1 die</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
