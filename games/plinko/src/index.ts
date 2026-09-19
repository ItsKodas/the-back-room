/**
 * Plinko: twelve rows of pegs, one board for the whole floor, and a bank that
 * only holds what players put in it.
 *
 * Every export is a pure function over numbers, so the whole economy of the
 * board can be argued with in a test file.
 */
export { BUCKETS, PATHS, ROWS, bucketOf, drawPath, pathOf, waysInto } from "./board.js";
export { MULTS, RISKS, edgeOf, multOf, multText } from "./risk.js";
export type { Risk } from "./risk.js";
export { RTP_DENOMINATOR, RTP_NUMERATOR, returnOf } from "./rtp.js";
export {
  DIVISOR,
  FUN_BANK,
  FUN_PURSE,
  MIN_STAKE,
  STAKE_DIVISOR,
  STAKE_STEP,
  capsFor,
  isStake,
  maxStake,
  payout,
  worstCase,
} from "./bank.js";
export { BIG_HIT, COLOURS, FEED_LENGTH, MAX_OTHERS, MAX_WAITING, colourOf } from "./floor.js";
export { PLINKO } from "./listing.js";
