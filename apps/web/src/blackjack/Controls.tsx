import type { TableView } from "@backroom/game-blackjack";
import { LAST_CALL_MS } from "@backroom/game-blackjack";
import type { ReactNode } from "react";
import { Chip, MINTED } from "../chips/Chip.js";
import type { Offer, SeatView } from "./hands.js";
import { availableTo, chipRefusal, clockText, doubleOffer, fmt, splitOffer } from "./hands.js";
import { DealIcon, UndoIcon } from "./Icons.js";
import type { Move } from "./useIntent.js";

/*
 * Denominations you can stack, smallest first because the tray reads left to
 * right. Taken from MINTED rather than listed again, so what a player may bet
 * with cannot drift from the chips that exist.
 */
const CHIPS = [...MINTED].reverse();

export interface ControlsProps {
  state: TableView;
  /** This player's seat, or null for somebody watching. */
  me: SeatView | null;
  /** The stake to show: this player's own last press until the table agrees. */
  mine: number;
  /** Readiness to show: this player's own last press until the table agrees. */
  ready: boolean;
  /** The account's balance, or null for a guest. */
  chips: number | null;
  /** A move sent and not yet answered. */
  move: Move | null;
  /** Seconds on the table's deadline: the betting window, or the next hand. */
  left: number | null;
  /** Seconds left on whoever's turn it is. */
  turnLeft: number | null;
  isHost: boolean;
  /** The taunt key, offered while somebody else is acting. */
  taunt: ReactNode;
  onStake: (amount: number) => void;
  onReady: (ready: boolean) => void;
  onDeal: () => void;
  onMove: (kind: Move) => void;
}

type Seated = Omit<ControlsProps, "me"> & { me: SeatView };

/**
 * The table's bottom row: secondary keys on the left, one lit slab on the
 * right, under the thumb. One slab per state, because two lit buttons have no
 * obvious one.
 */
export function Controls(props: ControlsProps) {
  const { state, me } = props;
  if (me === null) {
    // No seat, so no buttons: offering controls that cannot do anything is worse than saying what you are.
    return (
      <div className="bj__controls bj__controls--watch">
        <p className="bj__watching">You are stood behind the table. Take a seat between hands to play.</p>
      </div>
    );
  }
  if (state.phase === "betting") {
    return <Betting {...props} me={me} />;
  }
  if (state.phase === "playing" && state.turnSeatId === me.id) {
    return <Turn {...props} me={me} />;
  }
  return <Waiting {...props} />;
}

/**
 * Stacking a stake.
 *
 * Chips add rather than replace, the way they do on a real felt, and the whole
 * stack comes back off in one go: a stake you cannot take back before the cards
 * are out would make a misclick cost a hand.
 */
function Betting({ state, me, mine, ready, chips, left, isHost, onStake, onReady, onDeal }: Seated) {
  /*
   * One clock with two jobs: it is what the slab says and what locks the chips.
   * Read once, so a chip never refuses itself a tick before the words say so.
   */
  const lastCall = left !== null && left <= LAST_CALL_MS / 1000;
  const available = availableTo(state, me, chips, mine);
  const short = mine > 0 && mine < state.minBet;
  const under = ready
    ? "for the others"
    : short
      ? `at least ${fmt(state.minBet)}`
      : left === null
        ? ""
        : `${lastCall ? "last call" : "cards out"} ${clockText(left)}`;

  return (
    <div className="bj__controls bj__controls--bet">
      <div className="well bj__tray" role="group" aria-label="Add chips">
        {CHIPS.map((amount) => {
          const refused = chipRefusal(amount, mine, state.maxBet, available, lastCall);
          const said = refused ?? `Add ${fmt(amount)}`;
          return (
            <button
              key={amount}
              type="button"
              className="bj__chip"
              disabled={refused !== null}
              aria-label={said}
              title={said}
              onClick={() => onStake(mine + amount)}
            >
              <Chip amount={amount} />
            </button>
          );
        })}
      </div>
      <div className={`bj__row${isHost ? " bj__row--host" : ""}`}>
        <button
          type="button"
          className="key key--icon bj__back"
          aria-label="Take it back"
          disabled={mine === 0}
          onClick={() => onStake(0)}
        >
          <UndoIcon />
        </button>
        {isHost ? (
          // Not what starts a round, which the clock does: for a table done betting early.
          <button type="button" className="key bj__deal" onClick={onDeal}>
            <DealIcon />
            <span>Deal now</span>
          </button>
        ) : null}
        <button
          type="button"
          className="slab bj__main"
          aria-keyshortcuts="Space"
          aria-pressed={ready}
          disabled={short}
          onClick={() => onReady(!ready)}
        >
          <span>
            {ready ? "Waiting…" : "Ready"}
            <kbd>Space</kbd>
          </span>
          <small>{under}</small>
        </button>
      </div>
    </div>
  );
}

function Turn({ state, me, chips, move, onMove }: Seated) {
  // The hand actually being asked about, which after a split is one of two.
  const hand = me.hands[me.active] ?? me.hands[0];
  // Once a move has gone, the whole set goes quiet: a second move on the same cards is not a thing to allow.
  const busy = move !== null;
  const which = me.hands.length > 1 ? `hand ${me.active + 1}` : null;
  const available = availableTo(state, me, chips, me.bet);
  const none: Offer = { ok: false, reason: "no hand" };
  const double = hand === undefined ? none : doubleOffer(hand, available);
  const split = hand === undefined ? none : splitOffer(me, hand, available);
  const under = busy
    ? move === "hit" || move === "double"
      ? "a card is coming"
      : "waiting on the table"
    : (which ?? `on ${hand?.total ?? 0}`);

  return (
    <div className="bj__controls bj__controls--turn">
      <button
        type="button"
        className="key bj__stand"
        aria-keyshortcuts="S"
        disabled={busy}
        onClick={() => onMove("stand")}
      >
        <span>
          Stand
          <kbd>S</kbd>
        </span>
        {which !== null ? <small>{which}</small> : null}
      </button>
      <OfferKey name="Double" shortcut="D" offer={double} busy={busy} onPress={() => onMove("double")} />
      <OfferKey name="Split" shortcut="P" offer={split} busy={busy} onPress={() => onMove("split")} />
      <button
        type="button"
        className={`slab bj__main${busy ? " is-busy" : ""}`}
        aria-keyshortcuts="Space"
        disabled={busy}
        onClick={() => onMove("hit")}
      >
        <span>
          Hit
          <kbd>Space</kbd>
        </span>
        <small>{under}</small>
      </button>
    </div>
  );
}

/** A move that is an answer to a particular hand, with its price or the reason it is out on the key itself. */
function OfferKey({
  name,
  shortcut,
  offer,
  busy,
  onPress,
}: {
  name: "Double" | "Split";
  shortcut: "D" | "P";
  offer: Offer;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      className={`key bj__${name.toLowerCase()}`}
      aria-keyshortcuts={shortcut}
      disabled={busy || !offer.ok}
      onClick={onPress}
    >
      <span>
        {name}
        <kbd>{shortcut}</kbd>
      </span>
      {offer.ok ? <small className="bj__cost">+{fmt(offer.cost)}</small> : <small>{offer.reason}</small>}
    </button>
  );
}

/**
 * Nothing to press but a taunt.
 *
 * The slab stays, out, because a table that runs itself has to say what it is
 * waiting on, or it reads as a table that has stopped.
 */
function Waiting({ state, left, turnLeft, taunt }: ControlsProps) {
  const settled = state.phase === "settled";
  const turn = state.phase === "playing" ? (state.seats.find((seat) => seat.id === state.turnSeatId) ?? null) : null;
  return (
    <div className="bj__controls bj__controls--wait">
      <button type="button" className="slab bj__main" disabled>
        <span>{settled ? "Next hand" : turn !== null ? `${turn.name}'s turn` : "The dealer"}</span>
        <small>{settled ? (left === null ? "" : `in ${left}s`) : turnLeft === null ? "" : clockText(turnLeft)}</small>
      </button>
      {taunt}
    </div>
  );
}
