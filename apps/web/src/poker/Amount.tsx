import type { SeatView, TableView } from "@backroom/game-poker";
import { useState } from "react";
import { fmt } from "./Felt.js";
import { clamp } from "./Controls.js";
import type { Move } from "./useIntent.js";

/**
 * The controls for a decision that is actually in front of you.
 *
 * Three buttons and, when there is a raise to make, a way to say how much. The
 * amount sits above the buttons rather than beside them: it is what the raise
 * button is going to do, and a figure placed after the control that spends it
 * reads as a footnote to a decision already taken.
 */
export function OnTurn({
  you,
  me,
  pot,
  blind,
  busy,
  onAct,
}: {
  you: NonNullable<TableView["you"]>;
  me: SeatView;
  pot: number;
  blind: number;
  busy: boolean;
  onAct: (kind: Move, to: number, action: Record<string, unknown>) => void;
}) {
  const [to, setTo] = useState(you.minRaiseTo);
  const at = clamp(to, you.minRaiseTo, you.maxRaiseTo);
  const all = at >= you.maxRaiseTo;
  const callAll = you.toCall >= me.stack;
  /* Opening the betting is a bet; putting it up over somebody else is a raise. */
  const opening = you.toCall === 0;

  /*
   * A slice of the pot, as a total to raise *to*.
   *
   * The pot a raise is measured against is the one that would exist after the
   * call — what is already in, plus what it costs you to stay. Measuring
   * against the pot as it stands is the usual way to get this wrong, and it
   * comes out short by exactly the call every time.
   */
  const sliceTo = (part: number) =>
    clamp(
      me.committed + you.toCall + Math.round(((pot + you.toCall) * part) / blind) * blind,
      you.minRaiseTo,
      you.maxRaiseTo,
    );

  const span = Math.max(1, you.maxRaiseTo - you.minRaiseTo);

  return (
    /*
     * Keyed on the decision by its caller, so arriving here is arriving at a
     * new turn — which is what makes the flash below run once rather than on
     * every broadcast while you sit thinking.
     */
    <div className="pk__controls pk__controls--yours">
      {you.canRaise ? (
        <div className="pk__amount">
          <div className="pk__dial">
            <button
              type="button"
              className="pk__step"
              aria-label="Less"
              disabled={at <= you.minRaiseTo}
              onClick={() => setTo(clamp(at - blind, you.minRaiseTo, you.maxRaiseTo))}
            >
              −
            </button>
            <span className="pk__figure">
              <span className="pk__figure-label">{opening ? "Bet" : "Raise to"}</span>
              <strong>{fmt(at)}</strong>
            </span>
            <button
              type="button"
              className="pk__step"
              aria-label="More"
              disabled={all}
              onClick={() => setTo(clamp(at + blind, you.minRaiseTo, you.maxRaiseTo))}
            >
              +
            </button>
          </div>

          <input
            type="range"
            className="pk__range"
            aria-label={opening ? "How much to bet" : "How much to raise to"}
            min={you.minRaiseTo}
            max={you.maxRaiseTo}
            step={blind}
            value={at}
            /* How far along the track is filled, which CSS cannot work out for
               itself — a range input has no selector for its own value. */
            style={{ "--at": `${((at - you.minRaiseTo) / span) * 100}%` } as React.CSSProperties}
            onChange={(event) => setTo(Number(event.target.value))}
          />

          <div className="pk__slices">
            <button type="button" className="pk__slice" onClick={() => setTo(you.minRaiseTo)}>
              Min
            </button>
            {(
              [
                [0.5, "½ pot"],
                [0.75, "¾ pot"],
                [1, "Pot"],
              ] as Array<[number, string]>
            ).map(([part, name]) => (
              <button
                key={name}
                type="button"
                className="pk__slice"
                onClick={() => setTo(sliceTo(part))}
              >
                {name}
              </button>
            ))}
            <button type="button" className="pk__slice" onClick={() => setTo(you.maxRaiseTo)}>
              All in
            </button>
          </div>
        </div>
      ) : null}

      <div className="pk__acts">
        <button
          type="button"
          className="pk__act pk__act--fold"
          disabled={busy}
          onClick={() => onAct("fold", 0, { type: "fold" })}
        >
          Fold
        </button>

        {opening ? (
          <button
            type="button"
            className="pk__act"
            disabled={busy}
            onClick={() => onAct("check", me.committed, { type: "check" })}
          >
            Check
          </button>
        ) : (
          <button
            type="button"
            className="pk__act"
            disabled={busy}
            aria-label={
              callAll ? `All in ${fmt(me.stack)}` : `Call ${fmt(you.toCall)}`
            }
            onClick={() =>
              onAct("call", me.committed + you.toCall, { type: callAll ? "allIn" : "call" })
            }
          >
            <span className="pk__act-name">{callAll ? "All in" : "Call"}</span>
            <span className="pk__act-figure">{fmt(callAll ? me.stack : you.toCall)}</span>
          </button>
        )}

        {you.canRaise ? (
          <button
            type="button"
            className="pk__act"
            disabled={busy}
            aria-label={`${all ? "All in" : opening ? "Bet" : "Raise to"} ${fmt(
              all ? me.committed + me.stack : at,
            )}`}
            onClick={() =>
              onAct(
                all ? "allIn" : "raise",
                at,
                all ? { type: "allIn" } : { type: "raise", amount: at },
              )
            }
          >
            <span className="pk__act-name">{all ? "All in" : opening ? "Bet" : "Raise to"}</span>
            <span className="pk__act-figure">{fmt(all ? me.committed + me.stack : at)}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
