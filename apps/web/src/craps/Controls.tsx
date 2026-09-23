import type { TableView } from "@backroom/game-craps";
import { CHIPS, LAST_CALL_MS, MIN_CHIP, maxOdds } from "@backroom/game-craps";
import { Chip } from "../chips/Chip.js";
import { useCountdown } from "../game/useCountdown.js";
import type { TableSocketHook } from "../table/useTableSocket.js";

/**
 * Everything you press that is not the cloth itself.
 *
 * The tray, the two toggles that change what a press on the cloth *means*,
 * the three ways to take a round back, and the dice. Kept together and kept
 * last on the page, because every one of them is used during a hand and a
 * control you have to scroll to during a betting window is a control that
 * shuts the window on you.
 */

type Table = TableSocketHook<TableView>;

const fmt = (n: number) => n.toLocaleString("en-US");

export function Controls({
  table,
  state,
  seatId,
  chip,
  onChip,
  odds,
  onOdds,
  room,
  down,
  onGiveUp,
}: {
  table: Table;
  state: TableView;
  seatId: string | null;
  chip: number;
  onChip: (value: number) => void;
  /** Whether a press on the cloth lays odds behind rather than a bet on. */
  odds: boolean;
  onOdds: (on: boolean) => void;
  /**
   * What the bank can still take on one spot, the felt's own copy of the
   * server's arithmetic. Shown, never enforced — but a cap quoted without it
   * is a cap the very next press disproves.
   */
  room: (spotId: string) => number;
  /** What this seat has on the cloth, chips it has not been acknowledged for included. */
  down: number;
  /**
   * Called before anything that takes chips off.
   *
   * A guess about chips going *down* is void the moment the player asks for
   * chips to come back up: the server will only hand back what it actually
   * holds, so a guess left standing through an undo would be a chip on the
   * felt with nothing behind it anywhere.
   */
  onGiveUp: () => void;
}) {
  const left = useCountdown(state.deadline);
  const open = state.phase === "betting" && !state.lastCall;
  const purse = state.you?.purse ?? null;
  const works = state.you?.works ?? false;

  /*
   * The come-out is the only window the working toggle means anything in. The
   * table reverts every seat's numbers to off at each fresh come-out, so a
   * preference set with a point already on is one the table throws away
   * exactly when it would have mattered — and the server refuses the message
   * outside a betting window anyway. Hiding a control is a courtesy and
   * refusing the message is the rule, but the two should agree.
   */
  const canWork = state.phase === "betting" && state.point === null;

  /*
   * How long the window has been open, against the same floor `Table.shoot`
   * measures the shooter by: the dice are theirs but the window is
   * everybody's, so a shooter cannot bet and seal in the same tick. Derived
   * here from the two figures the view already carries rather than sent, and
   * it only greys the button — the table refuses in words either way.
   */
  const grace = Math.min(LAST_CALL_MS, Math.floor(state.window / 3));
  const openFor = left === null ? 0 : state.window - left * 1000;
  const canRoll = state.canRoll && openFor >= grace;

  return (
    <div className="cr__controls">
      <div className="cr__tray" role="radiogroup" aria-label="What to bet with">
        {CHIPS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={chip === value}
            aria-label={`Bet with ${fmt(value)}`}
            className={`cr__chip${chip === value ? " cr__chip--picked" : ""}`}
            disabled={purse !== null && value > purse}
            onClick={() => onChip(value)}
          >
            <Chip amount={value} />
          </button>
        ))}
      </div>

      {/*
        The two switches. Neither does anything on its own — one changes what
        the next press on the cloth buys, the other says whether chips already
        down are in the next come-out roll — so both are switches rather than
        buttons, and both say what they are currently set to.
      */}
      <div className="cr__switches">
        <button
          type="button"
          role="switch"
          aria-checked={odds}
          aria-label="Lay odds behind a bet instead of putting a new one on"
          className={`cr__switch${odds ? " cr__switch--on" : ""}`}
          onClick={() => onOdds(!odds)}
        >
          <span className="cr__act-name">Odds</span>
          <span className="cr__act-note">{oddsNote(state, seatId, odds, room)}</span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={works}
          aria-label="Work your numbers through the come-out roll"
          className={`cr__switch${works ? " cr__switch--on" : ""}`}
          disabled={!canWork || table.busy}
          onClick={() => table.act({ type: "working", on: !works })}
        >
          <span className="cr__act-name">Working</span>
          <span className="cr__act-note">
            {canWork
              ? works
                ? "Numbers are on"
                : "Numbers are off"
              : "Come-out only"}
          </span>
        </button>
      </div>

      {/*
        Three buttons, all the same weight.

        One of them spends money — "same again" puts a whole round back down —
        and lighting it up the way a primary action is usually lit would be the
        felt leaning on the player. The same reason poker's raise stopped being
        the bright one.
      */}
      <div className="cr__acts">
        <button
          type="button"
          className="cr__act"
          /* Written out, not left to how the two spans happen to sit: a name
             and a note with nothing between them read as one run-on word. */
          aria-label="Put last round's chips down again"
          disabled={!open || !state.canRepeat || table.busy}
          onClick={() => table.act({ type: "repeat" })}
        >
          <span className="cr__act-name">Same again</span>
          <span className="cr__act-note">Last round's chips</span>
        </button>
        <button
          type="button"
          className="cr__act"
          aria-label="Undo the last chip you put down"
          disabled={!open || down === 0 || table.busy}
          onClick={() => {
            onGiveUp();
            table.act({ type: "undo" });
          }}
        >
          <span className="cr__act-name">Undo</span>
          <span className="cr__act-note">The last chip down</span>
        </button>
        <button
          type="button"
          className="cr__act"
          aria-label="Take back everything you have on the cloth"
          disabled={!open || down === 0 || table.busy}
          onClick={() => {
            onGiveUp();
            table.act({ type: "clear" });
          }}
        >
          <span className="cr__act-name">Clear</span>
          <span className="cr__act-note">All but your contracts</span>
        </button>
      </div>

      {/*
        The dice, offered to the shooter alone. Not hidden from everybody else
        so much as never theirs to begin with — and the countdown is on the
        button, so it is obvious the table will throw on its own whether or not
        the shooter ever presses it.
      */}
      {state.you?.shooter === true ? (
        <button
          type="button"
          className="cr__throw"
          aria-label="Throw the dice"
          disabled={!canRoll || table.busy}
          onClick={() => table.act({ type: "roll" })}
        >
          <span className="cr__act-name">Roll</span>
          <span className="cr__act-note">
            {state.phase !== "betting"
              ? "They are out"
              : !canRoll
                ? "Give the table a moment"
                : left === null
                  ? "Your dice"
                  : `Or the table throws in ${left}s`}
          </span>
        </button>
      ) : null}

      <p className="cr__note">
        {down > 0 ? (
          <>
            <strong className="cr__note-figure">{fmt(down)}</strong> on the cloth.{" "}
          </>
        ) : null}
        {purse === null ? null : (
          <>
            <strong className="cr__note-figure">{fmt(purse)}</strong> in play money left.{" "}
          </>
        )}
        Right-click a chip, or press and hold, to take it back off.
      </p>
    </div>
  );
}

/**
 * What the odds switch has to say for itself.
 *
 * The line's own cap when there is one, because that is the odds bet nearly
 * everybody at a craps table lays and the figure is otherwise something you
 * find out by being refused.
 *
 * Two caps, and the smaller wins. `maxOdds` is the table's three-four-five
 * rule and knows nothing about money; the bank's own headroom is the other,
 * and a felt quoting only the first would offer a hundred and fifty behind a
 * bank that can cover sixty — and be contradicted by the refusal one press
 * later. `maxOdds`'s own doc says the felt offers the smaller of the two.
 *
 * Floored to a whole chip, which is where the dark side matters: `maxOdds(6,
 * 30, true)` is 216 against a tray whose smallest plate is 30, so a felt that
 * offered 216 and then refused it would be a felt that lied. The light side is
 * always a whole multiple of the line and so never needs the floor — which is
 * exactly why the dark line is read here too rather than the pass line alone.
 * `Table.check` floors it the same way in its own refusal.
 */
function oddsNote(
  state: TableView,
  seatId: string | null,
  odds: boolean,
  room: (spotId: string) => number,
): string {
  if (!odds) {
    return "Off — presses bet";
  }
  const mine = (spotId: string) =>
    state.placed.find((one) => one.seatId === seatId && one.spotId === spotId)?.chips ?? 0;
  // Whichever line this seat is actually on, and the light one when it is on
  // both — the same choice `oddsSpotFor` makes, for the reason written there.
  const dark = mine("pass") === 0 && mine("dontpass") > 0;
  const line = dark ? mine("dontpass") : mine("pass");
  if (state.point === null || line === 0) {
    return "Press what you are backing";
  }
  const behind = dark ? "odds:dontpass" : "odds:pass";
  const rule = Math.floor(maxOdds(state.point, line, dark) / MIN_CHIP) * MIN_CHIP;
  const left = Math.min(Math.max(0, rule - mine(behind)), room(behind));
  return left < MIN_CHIP
    ? "The line is fully backed"
    : `Up to ${fmt(left)} behind the line`;
}
