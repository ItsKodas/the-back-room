/**
 * Two-up: two coins, three outcomes, two schools.
 *
 * The fourth game to pay from a bank and the first to be two games at once —
 * a casino school played against that bank, and a traditional school played
 * against the other people in the ring, sharing one toss and one table.
 */

export type { Face, Outcome } from "./coins.js";
export { ODDS_LIMIT, readFaces, toss } from "./coins.js";
export type { Bet, BetOn } from "./bank.js";
export {
  CHIPS,
  FIVE_ODDS_PAYS,
  FUN_BANK,
  FUN_PURSE,
  headroom,
  MIN_CHIP,
  needed,
  on,
  owed,
  STAKE_DIVISOR,
  staked,
} from "./bank.js";
export type { Called } from "./casino.js";
export { readCasino } from "./casino.js";
export type { Decided } from "./school.js";
export { HEADS_TO_WIN, readSchool } from "./school.js";
export type { Centre, Cover } from "./centre.js";
export { covered, payouts, uncovered } from "./centre.js";
export type { Paid, Placed } from "./bets.js";
export { settle, toBets } from "./bets.js";
export { TWO_UP } from "./listing.js";
export type { Phase, School, SeatView, TableView } from "./table.js";
export {
  FLIGHT_MS,
  HISTORY,
  KIP_MS,
  LAST_CALL_MS,
  MIN_FOR_RING,
  READ_MS,
  SETTLE_MS,
  Table,
  WINDOWS,
} from "./table.js";
export type { Bank } from "./adapter.js";
export { twoUpAdapter } from "./adapter.js";
