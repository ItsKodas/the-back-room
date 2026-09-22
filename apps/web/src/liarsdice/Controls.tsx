import type { Bid, Call, Face, TableView } from "@backroom/game-liars-dice";
import { FACES, leastCount, minRaise, says } from "@backroom/game-liars-dice";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { whoseTurn } from "./lines.js";

const FACE_NAMES: Record<Face, string> = {
  1: "Ones",
  2: "Twos",
  3: "Threes",
  4: "Fours",
  5: "Fives",
  6: "Sixes",
};

/**
 * What the picker offers for an opening bid.
 *
 * A third of the dice on the table, at twos. Neutral on purpose: with ones wild
 * a third is the expected count of any face, so this default says nothing about
 * the hand of whoever is looking at it. A default that preselected your own real
 * count would be a tell, and a learnable one — anybody who noticed it would
 * read the opener's hand off how much they changed it.
 */
export function opening(total: number): Bid {
  return { count: Math.max(1, Math.min(total, Math.round(total / 3))), face: 2 };
}

/**
 * The bottom row of the table: what there is to do, and the one lit thing to do
 * it with.
 *
 * All three states of the controls live here — ready between games, the bid
 * builder on your turn, a taunt and a line while it is somebody else's —
 * because they are one row on screen and splitting them would put the decision
 * about which is showing somewhere other than where they are drawn.
 *
 * Nothing here enforces a rule. The lamps and the stepper are held inside what
 * is legal as a courtesy so a player is not refused for a press the table could
 * have dimmed; the server still refuses the message.
 */
export function Controls({
  state,
  seatId,
  busy,
  ready,
  onBid,
  onCall,
  onReady,
  taunt,
  help,
  bot,
}: {
  state: TableView;
  seatId: string | null;
  /** A move sent and not yet answered: the slab is held down. */
  busy: boolean;
  /** Readiness to show — this player's own last press until the table agrees. */
  ready: boolean;
  onBid: (bid: Bid) => void;
  onCall: (call: Call) => void;
  onReady: (ready: boolean) => void;
  taunt: ReactNode;
  help: ReactNode;
  /** The host's key for seating a bot, or null for anybody else. */
  bot?: ReactNode;
}) {
  const standing = state.bid;
  const total = state.total;
  const floor = standing === null ? opening(total) : minRaise(standing, total);
  const [pick, setPick] = useState<Bid | null>(null);
  /*
   * The board moving throws away whatever was being built. Compared as a string
   * rather than watched in an effect: an effect would render the old bid once
   * before clearing it, and for one frame the slab would offer a bid the table
   * has already passed.
   */
  const stamp = `${state.round}:${standing === null ? "-" : `${standing.count}.${standing.face}`}`;
  const seen = useRef(stamp);
  if (seen.current !== stamp) {
    seen.current = stamp;
    setPick(null);
  }
  const bid = pick ?? floor;

  if (state.phase === "waiting") {
    return (
      <div className="ld__controls">
        <p className="ld__waiting">{whoseTurn(state, seatId)}</p>
        <div className="ld__keys">
          {help}
          {bot}
          {taunt}
          <button
            type="button"
            className={`slab ld__go${busy ? " is-busy" : ""}`}
            aria-keyshortcuts="Space"
            disabled={seatId === null}
            onClick={() => onReady(!ready)}
          >
            {ready ? "Waiting…" : "I'm in"}
          </button>
        </div>
      </div>
    );
  }

  const myTurn = state.toAct !== null && state.toAct === seatId;
  if (!myTurn) {
    return (
      <div className="ld__controls">
        <p className="ld__waiting">{whoseTurn(state, seatId)}</p>
        <div className="ld__keys">
          {help}
          {bot}
          {taunt}
        </div>
      </div>
    );
  }

  /*
   * Your turn always has something to press, but not always the same thing:
   * near the ceiling ones become the only raise, and past that there is none
   * at all — thirty dice with "thirty sixes" standing is call-or-call. `bid`
   * is null exactly there, and that is a real state the game produces, not a
   * fallback to bail out of into the waiting line.
   */
  const raise = bid === null ? null : { current: bid, least: leastCount(bid.face, standing, total) ?? 1 };
  const step = (by: number) => {
    if (raise === null) {
      return;
    }
    setPick({
      face: raise.current.face,
      count: Math.min(total, Math.max(raise.least, raise.current.count + by)),
    });
  };
  const chooseFace = (face: Face) => {
    const lowest = leastCount(face, standing, total);
    if (lowest === null) {
      return;
    }
    // Keep the count if it is still legal at the new face, lift it if not.
    setPick({ face, count: Math.max(raise?.current.count ?? lowest, lowest) });
  };

  return (
    <div className="ld__controls">
      {raise === null ? null : (
        <div className="well ld__builder">
          <div className="lamps ld__faces" role="radiogroup" aria-label="Which face">
            {FACES.map((face) => {
              const reachable = leastCount(face, standing, total) !== null;
              return (
                <button
                  key={face}
                  type="button"
                  role="radio"
                  aria-checked={raise.current.face === face}
                  aria-label={FACE_NAMES[face]}
                  disabled={!reachable}
                  className="lamp ld__face-lamp"
                  onClick={() => chooseFace(face)}
                >
                  {face}
                </button>
              );
            })}
          </div>
          <div className="ld__stepper" role="group" aria-label="How many">
            <button
              type="button"
              className="key key--icon"
              aria-label="One fewer"
              disabled={raise.current.count <= raise.least}
              onClick={() => step(-1)}
            >
              −
            </button>
            <output className="ld__amount">{raise.current.count}</output>
            <button
              type="button"
              className="key key--icon"
              aria-label="One more"
              disabled={raise.current.count >= total}
              onClick={() => step(1)}
            >
              +
            </button>
          </div>
        </div>
      )}
      <div className="ld__keys">
        {help}
        {bot}
        <button
          type="button"
          className="key ld__liar"
          aria-keyshortcuts="L"
          disabled={standing === null}
          onClick={() => onCall("liar")}
        >
          Liar
        </button>
        <button
          type="button"
          className="key ld__exact"
          aria-keyshortcuts="E"
          disabled={standing === null}
          onClick={() => onCall("exact")}
        >
          Exact
        </button>
        {raise === null ? null : (
          <button
            type="button"
            className={`slab ld__go${busy ? " is-busy" : ""}`}
            aria-keyshortcuts="Space"
            onClick={() => onBid(raise.current)}
          >
            Bid {says(raise.current)}
          </button>
        )}
      </div>
    </div>
  );
}
