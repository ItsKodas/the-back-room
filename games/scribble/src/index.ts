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
