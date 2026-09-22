/**
 * Craps: two dice, a point to make, and a rail of people shouting.
 *
 * The sixth game in the building to pay from a bank, and the first whose bets
 * outlive the roll that failed to resolve them — which is the one thing here
 * the wheel had no need of, and the reason this package has a `resolve.ts` at
 * all.
 */

export type { Roll } from "./dice.js";
export { FACES, isHard, OUTCOMES, roll, total } from "./dice.js";
export { CRAPS } from "./listing.js";
export type { Kind, Spot } from "./spots.js";
export { oddsFor, POINTS, SPOTS, spotAt } from "./spots.js";
export { CHIPS, HORN_STEP, MIN_CHIP } from "./bank.js";
export type { Hand, Ratio } from "./resolve.js";
export { after, back, decided, maxOdds, multiplier, nextPoint, ratioOf, sleeps } from "./resolve.js";
export type { Bet } from "./bank.js";
export {
  FUN_BANK,
  FUN_PURSE,
  headroom,
  needed,
  OFF_ORDER,
  owed,
  staked,
  STAKE_DIVISOR,
  working,
} from "./bank.js";
