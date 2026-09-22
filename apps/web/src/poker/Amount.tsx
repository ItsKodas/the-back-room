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
   * What is in the typed box while it is being typed into; null once it is
   * not being edited, so the box shows `at` — the one figure the dial, the
   * slider and the box all agree on — rather than a second copy of it.
   */
  const [typed, setTyped] = useState<string | null>(null);
  /* What the box last had to say about a figure it held to the cap. */
  const [held, setHeld] = useState<string | null>(null);

  /*
   * Enter and blur both land here (S2). A keystroke never does — the figure
   * is the player's until they say they are done with it.
   */
  const commitTyped = () => {
    if (typed === null) {
      return;
    }
    const digits = typed.replace(/\D/g, "");
    setTyped(null);
    // Nothing typed keeps what was there, rather than guessing at a figure.
    if (digits.length === 0) {
      setHeld(null);
      return;
    }
    const raw = Number(digits);
    setTo(raw);
    /*
     * The cap is a courtesy (S3): held here only so the box does not sit on
     * a number the table would refuse, never because the client is the one
     * deciding it is illegal. The table still gets the same `raise`/`allIn`
     * message it always would, at the figure this holds it to.
     */
    setHeld(
      raw > you.maxRaiseTo
        ? `Held to the most you can ${opening ? "bet" : "raise to"}, ${fmt(you.maxRaiseTo)}.`
        : raw < you.minRaiseTo
          ? `Held to the least you can ${opening ? "bet" : "raise to"}, ${fmt(you.minRaiseTo)}.`
          : null,
    );
  };

  /*
   * Every other way of setting the figure — the dial, the slider, a preset —
   * goes through here too, so the box never shows a draft that the rest of
   * the control just moved past. One figure, one place that sets it.
   */
  const move = (next: number) => {
    setTyped(null);
    setHeld(null);
    setTo(next);
  };

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
              className="key key--icon"
              aria-label="Less"
              disabled={at <= you.minRaiseTo}
              onClick={() => move(clamp(at - blind, you.minRaiseTo, you.maxRaiseTo))}
            >
              −
            </button>
            <span className="pk__figure">
              <span className="pk__figure-label">{opening ? "Bet" : "Raise to"}</span>
              <strong>{fmt(at)}</strong>
            </span>
            <button
              type="button"
              className="key key--icon"
              aria-label="More"
              disabled={all}
              onClick={() => move(clamp(at + blind, you.minRaiseTo, you.maxRaiseTo))}
            >
              +
            </button>
          </div>

          <input
            type="range"
            className="pk__range"
            /*
             * Not "How much …" — the typed box below carries that name now,
             * and a slider and a box both answering to it would be two
             * controls a screen reader could not tell apart (they would read
             * as the same one, twice). Dragging still moves the same figure;
             * it just answers to its own name.
             */
            aria-label={opening ? "Drag to bet" : "Drag to raise to"}
            min={you.minRaiseTo}
            max={you.maxRaiseTo}
            step={blind}
            value={at}
            /* How far along the track is filled, which CSS cannot work out for
               itself — a range input has no selector for its own value. */
            style={{ "--at": `${((at - you.minRaiseTo) / span) * 100}%` } as React.CSSProperties}
            onChange={(event) => move(Number(event.target.value))}
          />

          {/*
           * The figure you can type. A `.well` around the fitting `.input`,
           * the same recess a housing uses for anything sunk into the panel —
           * this is not a bespoke box, it is the one the building already has.
           */}
          <div className="well pk__typed">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="input pk__typed-input"
              aria-label={opening ? "How much to bet" : "How much to raise to"}
              placeholder={`${fmt(you.minRaiseTo)} – ${fmt(you.maxRaiseTo)}`}
              value={typed ?? fmt(at)}
              onFocus={() => {
                setTyped(String(at));
                setHeld(null);
              }}
              onChange={(event) => setTyped(event.target.value.replace(/\D/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitTyped();
                } else if (event.key === "Escape") {
                  setTyped(null);
                }
              }}
              onBlur={commitTyped}
            />
            {/* Said, not just shown: blur has usually already moved focus off the
                figure by the time it lands, so a screen reader needs this said
                rather than left to be noticed on a box nothing is focused on. */}
            <p className="hint" aria-live="polite">
              {held ?? ""}
            </p>
          </div>

          <div className="pk__slices">
            <button type="button" className="key key--small" onClick={() => move(you.minRaiseTo)}>
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
                className="key key--small"
                onClick={() => move(sliceTo(part))}
              >
                {name}
              </button>
            ))}
            <button type="button" className="key key--small" onClick={() => move(you.maxRaiseTo)}>
              All in
            </button>
          </div>
        </div>
      ) : null}

      {/*
       * Fold, then Check/Call, then Raise — the order a poker player reads
       * the row in, not K1's "lit action on the right". Moving the raise
       * ahead of the call to satisfy that literally would put the button
       * that can move a whole stack where a thumb expects "call" to be.
       * K1's actual intent — main actions under the thumb, at least 52px —
       * still holds; only the left-to-right position of the lit slab does not.
       */}
      <div className="pk__acts">
        {/* Never the lit one: raising is a second decision, not the one this row is for. */}
        <button
          type="button"
          className="key"
          disabled={busy}
          aria-keyshortcuts="F"
          onClick={() => onAct("fold", 0, { type: "fold" })}
        >
          Fold
        </button>

        {/*
         * Check or Call is the row's one lit slab — whichever is free to press.
         * It goes busy on the press rather than disabled: F4 says busy is not
         * dead, so a second press while the table has not yet answered is a
         * no-op here rather than a control that looks like it stopped working.
         * Space is declared on both — only one of the two is ever on screen —
         * so the key follows whichever is lit rather than a fixed button.
         */}
        {opening ? (
          <button
            type="button"
            className={`slab${busy ? " is-busy" : ""}`}
            aria-keyshortcuts="Space"
            onClick={() => {
              if (!busy) {
                onAct("check", me.committed, { type: "check" });
              }
            }}
          >
            Check
          </button>
        ) : (
          <button
            type="button"
            className={`slab${busy ? " is-busy" : ""}`}
            aria-label={callAll ? `All in ${fmt(me.stack)}` : `Call ${fmt(you.toCall)}`}
            aria-keyshortcuts="Space"
            onClick={() => {
              if (!busy) {
                onAct("call", me.committed + you.toCall, { type: callAll ? "allIn" : "call" });
              }
            }}
          >
            <span className="pk__act-name">{callAll ? "All in" : "Call"}</span>
            <span className="pk__act-figure">{fmt(callAll ? me.stack : you.toCall)}</span>
          </button>
        )}

        {you.canRaise ? (
          <button
            type="button"
            className="key"
            disabled={busy}
            aria-keyshortcuts="R"
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
