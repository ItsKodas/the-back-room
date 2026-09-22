import type { SeatView, TableView } from "@backroom/game-poker";
import { useEffect, useRef, useState } from "react";
import type { Account } from "../game/useAccount.js";
import { compact } from "../game/money.js";
import { fmt } from "./Felt.js";
import type { Table } from "./Felt.js";
import { OnTurn } from "./Amount.js";
import { TauntPicker } from "../taunt/TauntPicker.js";
import type { Move } from "./useIntent.js";
import type { useIntent } from "./useIntent.js";

/* ----------------------------------------------------------- the controls */

/**
 * What a pre-selected move means when the turn actually arrives.
 *
 * Armed while somebody else is deciding and spent the moment it is your go.
 * Every one of them can be made impossible by what happens in between — you
 * arm a check and somebody bets — and where that is so the arming is dropped
 * and the decision handed back, rather than turned into the nearest thing that
 * is still legal. Guessing at a move somebody did not make is how a player
 * loses a stack to a button they pressed a minute ago.
 */
export type Pre = "fold" | "checkFold" | "check" | "callAny" | "betPot";

export const PRE_CHOICES: Array<{ pre: Pre; label: string; hint: string }> = [
  { pre: "fold", label: "Fold", hint: "Fold as soon as it is your turn" },
  { pre: "checkFold", label: "Check / Fold", hint: "Check if it is free, fold if it is not" },
  { pre: "check", label: "Check", hint: "Check — dropped if somebody bets" },
  { pre: "callAny", label: "Call any", hint: "Call whatever it has come to" },
  { pre: "betPot", label: "Bet pot", hint: "Bet or raise the size of the pot" },
];

export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function Actions({
  table,
  state,
  me,
  intent,
  account,
}: {
  table: Table;
  state: TableView;
  me: SeatView | null;
  intent: ReturnType<typeof useIntent>;
  /**
   * The one account the corner balance already reads from.
   *
   * Threaded in rather than read again here with its own `useAccount()` —
   * two calls would be two numbers that can disagree the moment a taunt's
   * optimistic cost leaves one of them and not the other.
   */
  account: Account;
}) {
  const you = state.you;
  const mine = me !== null && state.toAct === me.id;

  /*
   * What has been armed, and which betting round it was armed in.
   *
   * The round is carried along with it rather than cleared by an effect
   * watching the street. A pre-selection is about the decision in front of you,
   * and once the next card is out that is a different decision — so it lapses
   * by simply no longer matching, which needs nothing to remember to clear it.
   */
  const [armed, setArmed] = useState<{ pre: Pre; street: string } | null>(null);
  const live = armed !== null && armed.street === state.street ? armed.pre : null;

  const send = (kind: Move, to: number, action: Record<string, unknown>) => {
    intent.send(kind, to);
    table.act(action);
  };

  /*
   * Held in a ref because the effect below has to fire on the turn arriving and
   * on nothing else. Everything this reads changes on every broadcast, and an
   * effect that listed all of it would run constantly.
   */
  const spend = useRef<() => void>(() => undefined);
  spend.current = () => {
    if (me === null || you === null || live === null) {
      return;
    }
    const callAll = you.toCall >= me.stack;
    const potTo = clamp(
      me.committed + you.toCall + (state.pot + you.toCall),
      you.minRaiseTo,
      you.maxRaiseTo,
    );
    if (live === "fold") {
      send("fold", 0, { type: "fold" });
      return;
    }
    if (live === "checkFold") {
      if (you.toCall === 0) {
        send("check", me.committed, { type: "check" });
      } else {
        send("fold", 0, { type: "fold" });
      }
      return;
    }
    if (live === "check") {
      /*
       * Somebody bet after this was armed, so checking is not a move any more.
       * Handed back rather than turned into a call: a call is a different
       * decision and nobody made it.
       */
      if (you.toCall === 0) {
        send("check", me.committed, { type: "check" });
      }
      return;
    }
    if (live === "callAny") {
      if (you.toCall === 0) {
        send("check", me.committed, { type: "check" });
      } else {
        send("call", me.committed + you.toCall, { type: callAll ? "allIn" : "call" });
      }
      return;
    }
    if (you.canRaise) {
      send(
        potTo >= you.maxRaiseTo ? "allIn" : "raise",
        potTo,
        potTo >= you.maxRaiseTo ? { type: "allIn" } : { type: "raise", amount: potTo },
      );
    }
  };

  /* The turn arriving is the whole trigger, so it is the whole dependency. */
  const ready = mine && live !== null && you !== null;
  useEffect(() => {
    if (ready) {
      setArmed(null);
      spend.current();
    }
  }, [ready]);

  if (me === null) {
    return <p className="pk__note">You are watching this table.</p>;
  }

  /*
   * Nothing in front of you is the one thing to fix before anything else can
   * happen, so it is the only control offered.
   */
  if (me.stack === 0 && me.committed === 0 && !me.folded) {
    return (
      <div className="pk__controls">
        <div className="pk__acts">
          {/*
           * The only thing to press, so it is the row's one lit slab — and
           * F4 applies to it the same as it does to Check/Call: busy on the
           * press, never disabled, so a second tap while the table has not
           * yet answered is a no-op rather than a button that looks dead.
           */}
          <button
            type="button"
            className={`slab${table.busy ? " is-busy" : ""}`}
            aria-label={`Sit down with ${compact(state.entry)}`}
            onClick={() => {
              if (!table.busy) {
                table.act({ type: "buyIn" });
              }
            }}
          >
            <span className="pk__act-name">Sit down with</span>
            <span className="pk__act-figure">{compact(state.entry)}</span>
          </button>
        </div>
        <p className="pk__note">
          {state.forFun
            ? "Play money. It lives at this table and is gone when it closes."
            : "Chips come off your balance and go in front of you. Stand up and whatever is still there comes back."}
        </p>
      </div>
    );
  }

  /*
   * A hand nobody could make you turn over.
   *
   * Offered before the waiting notes below, because for the few seconds it is
   * there it is the only thing on this screen worth pressing — and it is the
   * one decision in the game that is purely yours, with nothing riding on it
   * either way.
   */
  if (state.canShow) {
    return (
      <div className="pk__controls">
        <div className="pk__acts">
          {/* The only thing to press, so it is the row's one lit slab — busy, not disabled (F4). */}
          <button
            type="button"
            className={`slab${table.busy ? " is-busy" : ""}`}
            onClick={() => {
              if (!table.busy) {
                table.act({ type: "show" });
              }
            }}
          >
            Show cards
          </button>
        </div>
        <p className="pk__note">
          Nobody can make you. Turn them over if the hand was worth seeing.
        </p>
      </div>
    );
  }

  if (!mine || you === null) {
    /*
     * Somebody else is deciding. A hand you are still in gets the choices you
     * could make in advance; one you are out of gets a line of text, because
     * arming a move for a hand you have folded is arming nothing.
     */
    const inHand = state.street !== "waiting" && !me.folded && me.hole.length > 0;
    if (!inHand) {
      return (
        <div className="pk__controls">
          {/*
            * Between hands your stack is simply yours, so here is the door.
            * Offered only when it is true — mid-hand the table refuses it, and
            * a button that is refused when pressed is worse than no button.
            */}
          {state.canTakeOff ? (
            <div className="pk__acts">
              {/* The only thing to press, so it is the row's one lit slab — busy, not disabled (F4). */}
              <button
                type="button"
                className={`slab${table.busy ? " is-busy" : ""}`}
                aria-label={`Take ${fmt(me.stack)} off the table`}
                onClick={() => {
                  if (!table.busy) {
                    table.act({ type: "cashOut" });
                  }
                }}
              >
                <span className="pk__act-name">Cash out</span>
                <span className="pk__act-figure">{fmt(me.stack)}</span>
              </button>
            </div>
          ) : null}
          <p className="pk__note">
            {state.street === "waiting" ? "Waiting for the next hand." : "Waiting for the others."}
            {state.canTakeOff && !state.forFun
              ? " Your chips go back to your balance, and the seat stays yours."
              : ""}
          </p>
        </div>
      );
    }
    return (
      <div className="pk__controls">
        {/*
          * The lamps do not fill the row's own width, which is what leaves
          * room on the right for the taunt key — offered here and nowhere
          * else, because it is only while somebody else is deciding that
          * there is nothing else for your hands to be doing.
          */}
        <div className="pk__pre-row">
          <div className="pk__pre lamps" role="group" aria-label="Decide in advance">
            {PRE_CHOICES.map(({ pre, label, hint }) => (
              <button
                key={pre}
                type="button"
                className="lamp lamp--word lamp--fit"
                aria-pressed={live === pre}
                title={hint}
                onClick={() => setArmed(live === pre ? null : { pre, street: state.street })}
              >
                {label}
              </button>
            ))}
          </div>
          <TauntPicker
            seats={state.seats}
            seatId={me.id}
            chips={account.profile?.chips ?? null}
            stakes={table.stakes}
            openClassName="key"
            onThrow={(emote, at) => {
              // The cost is this player's own number, so it leaves the corner on the press.
              if (account.profile !== null) {
                account.setChips(account.profile.chips - emote.cost);
              }
              table.taunt(emote.id, at, (result) => {
                if (result.ok) {
                  account.setChips(result.chips);
                } else {
                  // Refused, so give the early decrement back.
                  account.refresh();
                }
              });
            }}
          />
        </div>
        <p className="pk__note">
          {live === null
            ? "Waiting for the others — or decide now, and it plays itself."
            : "Armed. It goes the moment the turn reaches you, and lapses at the next card."}
        </p>
      </div>
    );
  }

  return (
    <OnTurn
      /*
       * Keyed on the decision, so a new one arrives with the amount sitting at
       * the smallest legal raise. A `key` rather than an effect that resets it:
       * React already has one way to say "this is a different one of these",
       * and reaching for a second means two things deciding when it goes back.
       */
      key={`${state.street}:${state.toAct ?? "none"}`}
      you={you}
      me={me}
      pot={state.pot}
      blind={state.bigBlind}
      busy={table.busy}
      onAct={send}
    />
  );
}
