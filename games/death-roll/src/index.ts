/**
 * Death rolling: two people, and a number that only goes down.
 *
 * The whole game in one package — its arithmetic, its duel, its table and its
 * bot. It borrows seating and the shape of a table from @backroom/core and
 * brings everything that makes it this game rather than another one.
 */
export { edge, lossOdds, passCost, passGain, worthPassing } from "./odds.js";
export type { Passed, Rolled } from "./duel.js";
export { Duel } from "./duel.js";
export type { Phase, SeatView, TableView } from "./table.js";
export { Table } from "./table.js";
export type { Choice } from "./bot.js";
export { decide, thinkingTime } from "./bot.js";
export {
  ANTE,
  CEILINGS,
  DEAL_MS,
  DEATH_ROLL,
  FUN_PURSE,
  OPENING,
  PASS_DIVISOR,
  RESULT_MS,
  SHORT_RETRY_MS,
  STAKES,
  TURN_MS,
  anteFor,
  openingFor,
  passPrice,
} from "./listing.js";
export { deathRollAdapter } from "./adapter.js";
