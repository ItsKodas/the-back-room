/**
 * Scribble: one draws, everybody else guesses — or two teammates draw one
 * word together. Played for nothing.
 */

export { SCRIBBLE } from "./listing.js";
export { containsWord, editDistance, isClose, isCorrect, normalise } from "./guess.js";
export type { PackId } from "./words/index.js";
export { PACK_IDS, PACKS } from "./words/index.js";
export { MAX_CUSTOM, parseCustomWords, wordProblem } from "./words/rules.js";
export type { HintLevel, Mode, ScribbleOptions } from "./options.js";
export {
  DEFAULT_PACKS,
  DRAW_SECONDS,
  HINT_LEVELS,
  MIN_CUSTOM_ALONE,
  minimumPlayers,
  ROUNDS,
  SEAT_CHOICES,
  snapOptions,
  TEAM_COUNTS,
  TEAM_NAMES,
} from "./options.js";
export type { Turn } from "./rotation.js";
export { mayJoin, smallestTeam, soloTurn, teamTurn } from "./rotation.js";
export type { Hint } from "./hints.js";
export { hintMs, hintsDue, mask, planHints } from "./hints.js";
export { drawerPoints, guesserPoints } from "./scoring.js";
export type { FillMark, FillRequest, Ink, InkRelay, Mark, StrokeBatch, StrokeMark } from "./ink.js";
export { GRID_HEIGHT, GRID_WIDTH, INKS, InkLog, MAX_BATCH, MAX_POINTS, readBatch, readFill, SIZES } from "./ink.js";
export type { Phase, TableDeps, Timings, TurnResult } from "./table.js";
export { COUNTDOWN_MS, PICK_MS, RESULT_MS, REVEAL_MS, ScribbleTable } from "./table.js";
export type { ChatKind, Said, SeatView, TableView, TeamView } from "./table.js";
export type { ScribbleAdapterOptions } from "./adapter.js";
export { scribbleAdapter } from "./adapter.js";
