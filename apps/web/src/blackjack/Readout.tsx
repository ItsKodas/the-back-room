import type { TableView } from "@backroom/game-blackjack";
import { LAST_CALL_MS, SETTLE_MS } from "@backroom/game-blackjack";
import type { CSSProperties } from "react";
import type { SeatView } from "./hands.js";
import { clockText, fmt, paidOut } from "./hands.js";
import type { Move } from "./useIntent.js";

export interface ReadoutInput {
  state: TableView;
  seatId: string | null;
  /** The stake to show: this player's own last press until the table agrees. */
  mine: number;
  /** The account's balance, or null for a guest. */
  chips: number | null;
  /** A move sent and not yet answered. */
  move: Move | null;
  /** Seconds left on the table's deadline: the betting window, or the next hand. */
  left: number | null;
  /** Seconds left on whoever's turn it is. */
  turnLeft: number | null;
}

export interface Stat {
  term: string;
  value: string;
  /** True for a figure that is chips, which is the only thing allowed gold. */
  chips: boolean;
}

export interface ReadoutModel {
  label: string;
  figure: string;
  tone: "plain" | "chips" | "good" | "bad";
  note: string | null;
  stats: Stat[];
  /** How much of the clock is left, 0 to 1, and whether it is counting down on chips. */
  clock: { part: number; chips: boolean } | null;
}

/** A fraction of a clock, from the seconds left and how long it started at. */
function part(seconds: number | null, of: number): number | null {
  return seconds === null ? null : Math.max(0, Math.min(1, (seconds * 1000) / Math.max(1, of)));
}

/**
 * The one figure this player is deciding about, and what backs it up.
 *
 * Worked out here rather than in the component so every state the table can be
 * in has a test that says what the screen says in it.
 */
export function readoutFor({ state, seatId, mine, chips, move, left, turnLeft }: ReadoutInput): ReadoutModel {
  const me = state.seats.find((seat) => seat.id === seatId) ?? null;
  if (state.phase === "betting") {
    return betting(state, me, mine, chips, left);
  }
  if (state.phase === "playing") {
    return playing(state, seatId, move, turnLeft);
  }
  // The dealer's own turn is played in the same update that settles the hand.
  return settled(state, me, left);
}

function betting(
  state: TableView,
  me: SeatView | null,
  mine: number,
  chips: number | null,
  left: number | null,
): ReadoutModel {
  const lastCall = left !== null && left <= LAST_CALL_MS / 1000;
  const stats: Stat[] = [];
  if (me !== null && state.forFun) {
    stats.push({ term: "Purse", value: fmt(me.purse), chips: true });
  } else if (me !== null && chips !== null) {
    // Beside the stake, because deciding how much to put down is when it matters.
    stats.push({ term: "Balance", value: fmt(chips), chips: true });
  }
  stats.push({ term: "Table", value: `${fmt(state.minBet)}–${fmt(state.maxBet)}`, chips: false });
  if (left !== null) {
    stats.push({ term: lastCall ? "Last call" : "Cards out", value: clockText(left), chips: false });
  }
  const clock = part(left, state.bettingMs);
  return {
    label: me === null ? "On the felt" : "Your stake",
    figure: fmt(me === null ? state.seats.reduce((total, seat) => total + seat.bet, 0) : mine),
    tone: "chips",
    // A table for chips holds rather than deals for one player, and says so.
    note: state.waitingForPlayers ? "waiting for a player" : null,
    stats,
    clock: clock === null ? null : { part: clock, chips: true },
  };
}

function playing(state: TableView, seatId: string | null, move: Move | null, turnLeft: number | null): ReadoutModel {
  const seat = state.seats.find((one) => one.id === state.turnSeatId) ?? null;
  if (seat === null) {
    return { label: "Dealer", figure: String(state.dealer.total), tone: "plain", note: null, stats: [], clock: null };
  }
  const hand = seat.hands[seat.active] ?? seat.hands[0];
  const yours = seat.id === seatId;
  const split = seat.hands.length > 1;
  const which = `${seat.active + 1} of ${seat.hands.length}`;
  const label = yours
    ? split
      ? `Hand ${which}`
      : "Your hand"
    : split
      ? `${seat.name}, hand ${which}`
      : `${seat.name}'s hand`;
  const stats: Stat[] = [
    { term: split ? "On this hand" : "On it", value: fmt(hand?.bet ?? 0), chips: true },
    { term: "Dealer shows", value: String(state.dealer.total), chips: false },
  ];
  if (turnLeft !== null) {
    stats.push({ term: yours ? "You have" : `${seat.name} has`, value: clockText(turnLeft), chips: false });
  }
  const clock = part(turnLeft, state.turnMs);
  const coming = yours && (move === "hit" || move === "double");
  return {
    label,
    figure: String(hand?.total ?? 0),
    tone: "plain",
    // Said while a card is in the air, so the total is not read as the last word.
    note: coming ? "a card is coming" : hand?.soft === true && !hand.bust ? "soft" : null,
    stats,
    clock: clock === null ? null : { part: clock, chips: false },
  };
}

function settled(state: TableView, me: SeatView | null, left: number | null): ReadoutModel {
  const clock = part(left, SETTLE_MS);
  const next: Stat[] = left === null ? [] : [{ term: "Next hand", value: clockText(left), chips: false }];
  const dealer: Stat = { term: "Dealer", value: String(state.dealer.total), chips: false };
  const drain = clock === null ? null : { part: clock, chips: false };
  if (me === null) {
    return {
      label: "Dealer has",
      figure: String(state.dealer.total),
      tone: "plain",
      note: null,
      stats: next,
      clock: drain,
    };
  }
  if (me.bet === 0 || me.waiting) {
    return { label: "This hand", figure: "Sat out", tone: "plain", note: null, stats: [dealer, ...next], clock: drain };
  }
  const back = paidOut(me);
  // One deal, one answer: a split that wins one hand and loses the other is its net.
  const net = back - me.bet;
  return {
    label: "This hand",
    figure: net > 0 ? `+${fmt(net)}` : net < 0 ? `−${fmt(-net)}` : "Push",
    tone: net > 0 ? "good" : net < 0 ? "bad" : "plain",
    note: me.hands.length > 1 ? `across ${me.hands.length} hands` : me.hands[0]?.outcome === "blackjack" ? "3 to 2" : null,
    stats: [{ term: "Back", value: fmt(back), chips: true }, dealer, ...next],
    clock: drain,
  };
}

export function Readout({ model }: { model: ReadoutModel }) {
  return (
    <section className="readout bj__read" aria-label="This hand">
      {model.clock !== null ? (
        <span
          className={`bj__clock${model.clock.chips ? " bj__clock--chips" : ""}`}
          style={{ "--t": `${Math.round(model.clock.part * 100)}%` } as CSSProperties}
          aria-hidden="true"
        />
      ) : null}
      <div className="bj__big">
        <span className="bj__label">{model.label}</span>
        <span className="bj__figure-row">
          <span className={`bj__figure bj__figure--${model.tone}`}>{model.figure}</span>
          {model.note !== null ? <small className="bj__note">{model.note}</small> : null}
        </span>
      </div>
      <dl className="bj__stats">
        {model.stats.map((stat) => (
          <div key={stat.term}>
            <dt>{stat.term}</dt>
            <dd className={stat.chips ? "bj__gold" : undefined}>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
