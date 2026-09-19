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
