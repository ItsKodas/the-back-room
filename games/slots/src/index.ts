/**
 * Slots: five reels, nine lines, and a bank that only holds what players put
 * in it.
 *
 * Every export here is a pure function over numbers. The machine has no table,
 * no seats and no turns, so there is nothing to stand up and nothing to mock:
 * the whole economy can be argued with in a test file.
 */
export { drawGrid, FACES, PAYING_FACES, STOPS, STRIP, WEIGHTS } from "./strip.js";
export type { Face, PayingFace } from "./strip.js";
export { BONUS_AWARDS, countScatters, freeSpinsFor, MIN_SCATTER } from "./scatter.js";
export { LINE_COUNT, PAYLINES, runOn } from "./paylines.js";
export { evaluate, PAYS } from "./paytable.js";
export type { WinningLine } from "./paytable.js";
export {
  bonusOdds,
  freeSpinsPerSpin,
  jackpotOdds,
  LINE_RTP,
  lineRtp,
  machineRtp,
  scatterOdds,
  scatterOddsOn,
} from "./rtp.js";
export {
  BET_KEYS,
  FUN_BANK,
  FUN_PURSE,
  HIGH_STAKES_KEYS,
  JACKPOT_SHARE,
  jackpotPay,
  MAX_LINE_PAY,
  maxStake,
  MIN_STAKE,
  FREE_STAKE_DIVISOR,
  maxFreeStake,
  STAKE_DIVISOR,
  worstCase,
} from "./bank.js";
export { SLOTS } from "./listing.js";
