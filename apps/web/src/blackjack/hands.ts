import type { TableView } from "@backroom/game-blackjack";
import { value } from "@backroom/game-blackjack";

/*
 * What the felt works out from the table's view before drawing anything.
 *
 * One module, so the readout, the seats, the controls, the keys and the rules
 * card ask the same questions of the same functions. A Double key and a lit
 * Double row that disagreed about whether you can double would be the table
 * contradicting itself.
 */

export type SeatView = TableView["seats"][number];
export type HandView = SeatView["hands"][number];

export const fmt = (n: number) => n.toLocaleString("en-US");

/** A clock the way a table reads one out: minutes, then two digits. */
export const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Everything a seat got back, across however many hands it played. */
export function paidOut(seat: SeatView): number {
  return seat.hands.reduce((total, hand) => total + hand.returned, 0);
}

/** Dealt twenty-one. A split hand that makes it is twenty-one and not a blackjack. */
export function isNatural(hand: HandView): boolean {
  return !hand.fromSplit && hand.cards.length === 2 && hand.total === 21;
}

/**
 * What this player could still put on the felt, or null when the browser does
 * not know.
 *
 * The purse at a for-fun table, the account's balance otherwise. Both have had
 * the table's stake taken already, so a stake shown ahead of the table's answer
 * is taken off here as well, or a chip would offer money already on the felt.
 */
export function availableTo(state: TableView, me: SeatView, chips: number | null, shownStake: number): number | null {
  const base = state.forFun ? me.purse : chips;
  return base === null ? null : base - (shownStake - me.bet);
}

/** A move on offer and what it costs, or the reason it is not on offer. */
export type Offer = { ok: true; cost: number } | { ok: false; reason: string };

export function doubleOffer(hand: HandView, available: number | null): Offer {
  // First two cards only: the rule, and the only moment doubling is a decision.
  if (hand.cards.length !== 2) {
    return { ok: false, reason: `${hand.cards.length} cards` };
  }
  if (available !== null && available < hand.bet) {
    return { ok: false, reason: "not enough" };
  }
  return { ok: true, cost: hand.bet };
}

export function splitOffer(seat: SeatView, hand: HandView, available: number | null): Offer {
  // Checked first because it is the answer that stays true for the rest of the hand.
  if (seat.hands.length > 1 || hand.fromSplit) {
    return { ok: false, reason: "once a seat" };
  }
  if (hand.cards.length !== 2) {
    return { ok: false, reason: `${hand.cards.length} cards` };
  }
  const [first, second] = hand.cards;
  // By value, not rank: a king and a queen are a pair, which is how the table counts.
  if (first === undefined || second === undefined || value([first]).total !== value([second]).total) {
    return { ok: false, reason: "no pair" };
  }
  if (available !== null && available < hand.bet) {
    return { ok: false, reason: "not enough" };
  }
  return { ok: true, cost: hand.bet };
}

/**
 * Why a chip cannot be added, or null when it can.
 *
 * Said on the chip before the press, because each of these is something the
 * browser can already see. The server still refuses every one of them.
 */
export function chipRefusal(
  amount: number,
  shownStake: number,
  max: number,
  available: number | null,
  lastCall: boolean,
): string | null {
  if (lastCall) {
    return "Last call: chips can only come off now";
  }
  if (shownStake + amount > max) {
    return `${fmt(amount)} more is past the ${fmt(max)} limit`;
  }
  if (available !== null && amount > available) {
    return `You do not have ${fmt(amount)} more to bet`;
  }
  return null;
}

/** The seat the turn goes to after the one acting, or null. */
export function nextSeatId(state: TableView): string | null {
  // The table's own order: everybody dealt in, which is everybody not waiting with a stake down.
  const inHand = state.seats.filter((seat) => !seat.waiting && seat.bet > 0);
  const at = inHand.findIndex((seat) => seat.id === state.turnSeatId);
  if (at === -1) {
    return null;
  }
  return inHand.slice(at + 1).find((seat) => seat.connected && seat.hands.some((hand) => !hand.done))?.id ?? null;
}

/** A small state on a seat or a hand, and the colour it is allowed. */
export interface Tag {
  text: string;
  tone: "quiet" | "live" | "good" | "bad" | "chips";
}

/** What became of one hand, or null while there is nothing to say. */
export function handTag(hand: HandView): Tag | null {
  switch (hand.outcome) {
    case "blackjack":
      // Gold, because what is being said is a payout, and a payout is chips.
      return { text: `Paid ${fmt(hand.returned - hand.bet)}`, tone: "chips" };
    case "won":
      return { text: `Won ${fmt(hand.returned - hand.bet)}`, tone: "good" };
    case "push":
      return { text: "Push", tone: "quiet" };
    case "lost":
      return { text: "Lost", tone: "bad" };
    case "bust":
      return { text: "Bust", tone: "bad" };
    default:
      if (!hand.done) {
        return null;
      }
      return { text: isNatural(hand) ? "Blackjack" : "Stood", tone: "quiet" };
  }
}

/** What a seat's plate says about it, or null when the plate already says it. */
export function seatTag(state: TableView, seat: SeatView): Tag | null {
  // A dimmed seat says why, or a dim plate reads as a broken one.
  if (seat.waiting) {
    return { text: "Next hand", tone: "quiet" };
  }
  if (!seat.connected) {
    return { text: "Dropped", tone: "quiet" };
  }
  if (state.phase === "betting") {
    if (seat.ready) {
      return { text: "Ready", tone: "live" };
    }
    return { text: seat.bet > 0 ? "Not ready" : "Yet to bet", tone: "quiet" };
  }
  if (seat.bet === 0) {
    return { text: "Sat out", tone: "quiet" };
  }
  // A lit seat is already saying it is acting, and a split seat's boxes each speak for themselves.
  if (seat.hands.length > 1 || state.turnSeatId === seat.id) {
    return null;
  }
  const hand = seat.hands[0];
  if (hand === undefined) {
    return null;
  }
  const said = handTag(hand);
  if (said !== null) {
    return said;
  }
  return nextSeatId(state) === seat.id ? { text: "Next", tone: "quiet" } : null;
}
