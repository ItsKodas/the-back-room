/**
 * Death rolling: two to six people, and a number that only goes down.
 *
 * The whole game in one package — the solved round, a round, a game, who is
 * ready, the table and its bot. It borrows seating and the shape of a table
 * from @backroom/core and brings everything that makes it this game.
 */
export type { RoundSolution, SolveOptions } from "./odds.js";
export { EXACT_CEILING, edge, lossOdds, passMargin, roundFor, solveRound } from "./odds.js";
export type { Passed, Rolled } from "./round.js";
export { Round } from "./round.js";
export { Game } from "./game.js";
// Moved to @backroom/core when Liar's Dice needed the same ready button.
// Re-exported rather than dropped: this package's exports are somebody's imports.
export { Readiness } from "@backroom/core";
export type { Phase, SeatView, TableView } from "./table.js";
export { Table } from "./table.js";
export type { Choice } from "./bot.js";
export { choose, thinkingTime, WARINESS } from "./bot.js";
export {
  ANTE,
  CEILINGS,
  COUNTDOWN_MS,
  DEATH_ROLL,
  FUN_PURSE,
  OPENING,
  PASS_DIVISOR,
  RESET_CEILING,
  RESULT_MS,
  ROUND_MS,
  STAKES,
  TURN_MS,
  anteFor,
  openingFor,
  passPrice,
} from "./listing.js";
export { deathRollAdapter } from "./adapter.js";
