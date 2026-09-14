import type { BetOn, TableView } from "@backroom/game-two-up";
import { FIVE_ODDS_PAYS } from "@backroom/game-two-up";
import { ChipStack } from "../chips/ChipStack.js";
import { exact } from "../game/money.js";

/**
 * The ring: the chalked circle, the kip, and both schools' controls.
 *
 * One component rather than two, because a table only ever plays one school
 * at a time — there is no page that needs both sets of controls at once, and
 * a felt that drew both would be drawing a game that does not exist.
 *
 * Every control here is a courtesy. `TwoUp.tsx` works out what would be
 * refused — the headroom on a side, what is left of a centre — the same way
 * it is worked out on the server, and greys accordingly; the refusal itself
 * is the server's, whatever this draws.
 */

const CASINO_LABEL: Record<BetOn, string> = { heads: "Heads", tails: "Tails", fiveOdds: "5 odds" };
const CASINO_PAYS: Record<BetOn, string> = {
  heads: "Evens",
  tails: "Evens",
  fiveOdds: `${FIVE_ODDS_PAYS} to 1`,
};

export interface RingProps {
  state: TableView;
  seatId: string | null;

  /** Casino school: what you have down on each side, server plus optimistic. */
  mineOn: Record<BetOn, number>;
  /** Casino school: whether a side would be refused right now. */
  spotDisabled: (on: BetOn) => boolean;
  onPlace: (on: BetOn) => void;
  /** One chip back off a side, right-click or long-press — the same gesture
      the wheel's cloth uses for the same reason: the pointer is already over
      the pile you mean. */
  onTake: (on: BetOn) => void;

  /** Traditional school: your own centre and cover, server plus optimistic. */
  myCentre: number;
  myCover: number;
  canSetCentre: boolean;
  canCover: boolean;
  onCentre: () => void;
  onCover: () => void;

  /** The kip. */
  canThrow: boolean;
  swung: boolean;
  /** Whether `Coins` (drawn by `TwoUp.tsx`, over this same spot) has
      anything on screen right now — in the air or freshly landed. The kip's
      own label hides while that is true, or the two read as one smudge of
      text sitting under the coins rather than as two things. */
  coinsShowing: boolean;
  onThrow: () => void;
}

export function Ring({
  state,
  seatId,
  mineOn,
  spotDisabled,
  onPlace,
  onTake,
  myCentre,
  myCover,
  canSetCentre,
  canCover,
  onCentre,
  onCover,
  canThrow,
  swung,
  coinsShowing,
  onThrow,
}: RingProps) {
  /*
   * Nothing interactive is offered here.
   *
   * A ring holds with the felt untouched — nobody is refunded and nothing is
   * taken while it waits — and a control drawn but disabled would invite a
   * press that means nothing, which is a worse way to say "wait" than simply
   * not drawing the press at all.
   */
  if (state.holding) {
    return (
      <div className="tu__ring tu__ring--holding">
        <p className="tu__holding" role="status">
          Waiting for another player.
        </p>
      </div>
    );
  }

  return (
    <div className="tu__ring">
      <Kip
        spinner={state.spinnerId === seatId}
        flying={state.phase === "spinning"}
        pressable={canThrow}
        swung={swung}
        coinsShowing={coinsShowing}
        onPress={onThrow}
      />
      {state.school === "casino" ? (
        <CasinoSpots mineOn={mineOn} disabledFor={spotDisabled} onPlace={onPlace} onTake={onTake} />
      ) : (
        <SchoolSpots
          state={state}
          seatId={seatId}
          myCentre={myCentre}
          myCover={myCover}
          canSetCentre={canSetCentre}
          canCover={canCover}
          onCentre={onCentre}
          onCover={onCover}
        />
      )}
    </div>
  );
}

/**
 * The kip: the paddle the coins leave from, and the one piece of this felt
 * that answers a press before the table has said anything.
 *
 * Three states, drawn as one class so a test can watch it swing and reverse
 * without reading a pixel: `idle` (nothing pressed, lit if you are the
 * spinner), `swung` (pressed, nothing airborne yet — this player's own fact,
 * shown at once) and `thrown` (the coins have left; the paddle is back at
 * rest because there is nothing left on it to show).
 */
function Kip({
  spinner,
  flying,
  pressable,
  swung,
  coinsShowing,
  onPress,
}: {
  spinner: boolean;
  flying: boolean;
  pressable: boolean;
  swung: boolean;
  coinsShowing: boolean;
  onPress: () => void;
}) {
  const state = flying ? "thrown" : swung ? "swung" : "idle";
  /*
   * "Throw" survives into the disabled label — as "...to throw." — rather
   * than being swapped for a different verb, so the control announces the
   * same action whether or not this player may take it right now.
   */
  const label = flying
    ? "The coins are up."
    : pressable
      ? "Throw"
      : "Waiting on the spinner to throw.";

  return (
    <button
      type="button"
      className={`tu__kip tu__kip--${state}${spinner && state === "idle" ? " tu__kip--lit" : ""}`}
      disabled={!pressable}
      aria-label={label}
      onClick={onPress}
    >
      <svg viewBox="0 0 120 60" aria-hidden="true" focusable="false" className="tu__kip-art">
        {/* The board, side-on: a plank with a lip at either end to keep the
            coins from rolling off before they are thrown. */}
        <path
          className="tu__kip-board"
          d="M6,42 L114,42 L114,48 C114,51 111,53 108,53 L12,53 C9,53 6,51 6,48 Z"
        />
        <rect className="tu__kip-lip" x="8" y="34" width="6" height="10" rx="2" />
        <rect className="tu__kip-lip" x="106" y="34" width="6" height="10" rx="2" />
        {/* The two coins, resting flat on the board — edge-on once thrown, so
            this pair is only ever drawn while nothing is in the air. */}
        <circle className="tu__kip-coin" cx="46" cy="36" r="9" />
        <circle className="tu__kip-coin" cx="70" cy="36" r="9" />
      </svg>
      {/* Hidden once there is a coin sitting where this text is — the
          button's own `aria-label` above still carries it for anyone not
          looking at the felt. */}
      {coinsShowing ? null : <span className="tu__kip-label">{label}</span>}
    </button>
  );
}

function CasinoSpots({
  mineOn,
  disabledFor,
  onPlace,
  onTake,
}: {
  mineOn: Record<BetOn, number>;
  disabledFor: (on: BetOn) => boolean;
  onPlace: (on: BetOn) => void;
  onTake: (on: BetOn) => void;
}) {
  const sides: BetOn[] = ["heads", "tails", "fiveOdds"];
  return (
    <div className="tu__spots" role="group" aria-label="What to back">
      {sides.map((on) => (
        <button
          key={on}
          type="button"
          className="tu__spot"
          aria-label={CASINO_LABEL[on]}
          disabled={disabledFor(on)}
          onClick={() => onPlace(on)}
          onContextMenu={(event) => {
            event.preventDefault();
            onTake(on);
          }}
        >
          <span className="tu__spot-name">{CASINO_LABEL[on]}</span>
          <span className="tu__spot-pays">{CASINO_PAYS[on]}</span>
          {mineOn[on] > 0 ? <span className="tu__spot-mine">{exact(mineOn[on])}</span> : null}
        </button>
      ))}
    </div>
  );
}

function SchoolSpots({
  state,
  seatId,
  myCentre,
  myCover,
  canSetCentre,
  canCover,
  onCentre,
  onCover,
}: {
  state: TableView;
  seatId: string | null;
  myCentre: number;
  myCover: number;
  canSetCentre: boolean;
  canCover: boolean;
  onCentre: () => void;
  onCover: () => void;
}) {
  const spinning = state.spinnerId === seatId;
  return (
    <div className="tu__spots" role="group" aria-label="The centre">
      <div className="tu__centre">
        <span className="tu__centre-label">Centre</span>
        {state.centre !== null ? (
          <ChipStack amount={state.centre.chips} width={22} most={4} tallest={3} />
        ) : (
          <span className="tu__centre-empty">Nothing up yet.</span>
        )}
        {canSetCentre ? (
          <button type="button" className="tu__act" aria-label="Set the centre" onClick={onCentre}>
            Set the centre
          </button>
        ) : null}
        {myCentre > 0 ? <span className="tu__spot-mine">{exact(myCentre)}</span> : null}
      </div>

      {state.centre === null ? null : (
        <button
          type="button"
          className="tu__act"
          aria-label="Cover the centre"
          disabled={!canCover}
          onClick={onCover}
        >
          <span>Cover{myCover > 0 ? ` (${exact(myCover)} down)` : ""}</span>
          <span className="tu__act-note">
            {spinning ? "The spinner cannot cover their own centre." : `${exact(state.uncovered)} left`}
          </span>
        </button>
      )}
    </div>
  );
}
