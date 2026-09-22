/**
 * Baccarat: player or banker, and which gets closer to nine.
 *
 * The sixth game to pay from a bank and the third dealt from a deck, which is
 * what makes it the one table in the building with no decisions in it: both
 * hands are played out by a fixed tableau, so once the bets are in the coup is
 * already decided. Everything below is about the chips and the clock.
 */

export type { Bank } from "./adapter.js";
export { baccaratAdapter } from "./adapter.js";
export {
  type Bet,
  CHIPS,
  FUN_BANK,
  FUN_PURSE,
  headroom,
  MIN_CHIP,
  needed,
  owed,
  STAKE_DIVISOR,
  staked,
} from "./bank.js";
export type { Paid, Placed } from "./bets.js";
export { settle, toBets } from "./bets.js";
export { botBet, thinkingTime } from "./bot.js";
export type { Card, Rank, Suit } from "./cards.js";
export { DECKS, freshDeck, freshShoe, RANKS, shuffle, SUITS } from "./cards.js";
export type { Coup, Outcome, Side } from "./coup.js";
export { bankerDraws, coupFrom, deal, playerDraws, pointsOf, totalOf } from "./coup.js";
export { BACCARAT } from "./listing.js";
export type { Reveal, Schedule } from "./schedule.js";
export { HOLD, schedule, TURN_DELAY } from "./schedule.js";
export type { Spot, SpotId } from "./spots.js";
export { back, commission, SPOT_IDS, SPOTS, spotAt } from "./spots.js";
export type { Phase, SeatView, TableView, Win } from "./table.js";
export { HISTORY, LAST_CALL_MS, SETTLE_MS, Table, WINDOWS, WINNERS } from "./table.js";
