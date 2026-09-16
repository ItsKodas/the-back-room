/**
 * Blackjack: beat the dealer to twenty-one.
 *
 * The second game, and the one that put the shared parts to the test — it has
 * hidden information, a stake per hand and no score, none of which Greed has.
 */

export { blackjackAdapter } from "./adapter.js";
export type { Move } from "./bot.js";
export { betFor, decide, thinkingTime, upcardValue } from "./bot.js";
export type { Card, Rank, Suit } from "./cards.js";
export { DECKS, freshDeck, RANKS, Shoe, SUITS, shuffle } from "./cards.js";
export type { HandValue } from "./hand.js";
export { isBlackjack, value } from "./hand.js";
export { BLACKJACK } from "./listing.js";
export type { Outcome, Phase, Seat, SeatView, TableView } from "./table.js";
export { LAST_CALL_MS, SETTLE_MS, Table, WINDOWS } from "./table.js";
export {
  BLACKJACK_RETURN,
  DOUBLE,
  MAX_HANDS,
  maxStake,
  maxStakeAgainst,
  roundWorstCase,
  STAKE_DIVISOR,
  WIN_RETURN,
  worstCase,
} from "./bank.js";
