import type { BetOn, TableView } from "@backroom/game-two-up";
import { FIVE_ODDS_PAYS } from "@backroom/game-two-up";
import { useEffect, useRef } from "react";
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

/**
 * What is on a spot: the weight of it, and the number.
 *
 * The stack is drawn `aria-hidden` because it carries the amount in its own
 * accessible name, and the figure beside it is that same amount again — two
 * ways of saying one thing to somebody looking at the felt, but simply twice
 * to somebody listening to it. The figure is the copy that stays, because it
 * is the one that reads at eighteen pixels.
 */
function Pile({ chips }: { chips: number }) {
  return (
    <span className="tu__spot-stack">
      <span aria-hidden="true">
        <ChipStack amount={chips} width={18} most={4} tallest={3} />
      </span>
      <span className="tu__spot-mine">{exact(chips)}</span>
    </span>
  );
}

/** How long a side has to be held before a chip comes back off it. */
export const HOLD_MS = 450;

/**
 * Press and hold to take a chip back off, which the rail has promised since
 * this felt was built.
 *
 * Only right-click was ever wired, and a thumb has no right button — so on the
 * device this table is most often played on, the instruction printed on the
 * rail was simply false.
 *
 * The side that fired is remembered rather than a bare flag, because the same
 * gesture goes on to send two more events that would each undo it: the click
 * the pointer sends on the way up, and — on a touch screen — the browser's own
 * `contextmenu`, which takes a chip back by the older route. Both are ignored
 * for the side that was held, and only for that side, so a hold on heads
 * cannot swallow a press on tails.
 */
function useHoldToTake(onTake: (on: BetOn) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const took = useRef<BetOn | null>(null);

  const stop = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  /*
   * A felt that unmounts mid-hold — the round ends, the seat stands up —
   * would otherwise take a chip off a table nobody is looking at.
   *
   * Written against the ref rather than returning `stop`, which is rebuilt
   * every render: a cleanup that depended on it would tear down and set up
   * again on each one, and one that ignored the dependency would be closing
   * over a stale copy. The ref is the same object throughout, so neither
   * applies.
   */
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  return {
    start(on: BetOn) {
      stop();
      // Cleared on every fresh press, so nothing a previous hold swallowed
      // can reach across to the next one.
      took.current = null;
      timer.current = setTimeout(() => {
        took.current = on;
        onTake(on);
      }, HOLD_MS);
    },
    stop,
    /** Whether this side's chip already came off in the gesture still running. */
    handled(on: BetOn) {
      return took.current === on;
    },
  };
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
  const hold = useHoldToTake(onTake);
  /*
   * Heads and tails are the even-money pair and five odds is the long shot,
   * so the felt draws them that way — the pair side by side, the long shot
   * spanning underneath. One shape at every width, rather than three equal
   * boxes that wrapped into two rows on a phone and orphaned five odds onto
   * its own line looking like the main event.
   */
  const sides: BetOn[] = ["heads", "tails", "fiveOdds"];
  return (
    <div className="tu__spots" role="group" aria-label="What to back">
      {sides.map((on) => (
        <button
          key={on}
          type="button"
          className={`tu__spot tu__spot--${on}`}
          /*
           * What the side is, and what you have on it. An `aria-label`
           * replaces everything inside the button, so a pile named only by
           * the figure drawn in it is a pile nobody listening to this page
           * ever hears about.
           */
          aria-label={
            mineOn[on] > 0
              ? `${CASINO_LABEL[on]}, ${exact(mineOn[on])} down`
              : CASINO_LABEL[on]
          }
          disabled={disabledFor(on)}
          onPointerDown={(event) => {
            // Only the primary button holds. The right one is already the
            // other way of taking a chip off, and would otherwise do both.
            if (event.button === 0) {
              hold.start(on);
            }
          }}
          onPointerUp={hold.stop}
          onPointerCancel={hold.stop}
          // Sliding a thumb off is how you get out of a hold without lifting
          // it, the same escape the board's drop key gives.
          onPointerLeave={hold.stop}
          onClick={() => {
            if (!hold.handled(on)) {
              onPlace(on);
            }
          }}
          onContextMenu={(event) => {
            // The browser's own menu is never what somebody wants over a pile.
            event.preventDefault();
            if (!hold.handled(on)) {
              onTake(on);
            }
          }}
        >
          <span className="tu__spot-name">{CASINO_LABEL[on]}</span>
          <span className="tu__spot-pays">{CASINO_PAYS[on]}</span>
          {mineOn[on] > 0 ? <Pile chips={mineOn[on]} /> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * The ring: what is up, what has been covered of it, and the one thing you
 * may do about it.
 *
 * The same two-and-one shape the casino felt draws, so the page does not
 * change silhouette when a table is opened under the other ruleset — a felt
 * that rearranges itself between schools makes two games out of one table.
 */
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
  /*
   * The optimistic centre shows through here. Before the table has spoken
   * `state.centre` is still null and the spinner's own pending figure is all
   * there is — a stake is their own number, so it goes up on the press.
   */
  const up = state.centre?.chips ?? myCentre;
  /*
   * What the second box is for depends on which side of the centre you are.
   * The spinner is watching the ring come in; the ring is watching its own
   * stake go down.
   */
  const covered = state.centre === null ? 0 : state.centre.chips - state.uncovered;
  const mine = spinning ? covered : myCover;

  return (
    <div className="tu__spots tu__spots--ring" role="group" aria-label="The centre">
      <div className="tu__spot tu__spot--flat">
        <span className="tu__spot-name">The centre</span>
        {up > 0 ? <Pile chips={up} /> : <span className="tu__spot-pays">Nothing up yet</span>}
      </div>

      <div className="tu__spot tu__spot--flat">
        <span className="tu__spot-name">{spinning ? "Covered" : "Your cover"}</span>
        {mine > 0 ? (
          <Pile chips={mine} />
        ) : (
          <span className="tu__spot-pays">{spinning ? "Nobody in yet" : "Nothing on"}</span>
        )}
      </div>

      {canSetCentre ? (
        <button
          type="button"
          className="tu__spot tu__spot--wide"
          aria-label="Set the centre"
          onClick={onCentre}
        >
          <span className="tu__spot-name">Set the centre</span>
          <span className="tu__spot-pays">What the ring has to match</span>
        </button>
      ) : state.centre === null ? null : (
        <button
          type="button"
          className="tu__spot tu__spot--wide"
          aria-label={`Cover the centre, ${exact(state.uncovered)} left`}
          disabled={!canCover}
          onClick={onCover}
        >
          <span className="tu__spot-name">Cover</span>
          <span className="tu__spot-pays">
            {spinning
              ? "The spinner cannot cover their own centre"
              : `${exact(state.uncovered)} left`}
          </span>
        </button>
      )}
    </div>
  );
}
