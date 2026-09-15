import { LINE_COUNT } from "./paylines.js";
import { PAYS } from "./paytable.js";

/** What a jackpot takes out of the bank. */
export const JACKPOT_SHARE = 0.4;

/** The largest fixed win on one line: five diamonds. */
export const MAX_LINE_PAY = PAYS.diamond[5] as number;

/**
 * What the bank has to hold per chip staked.
 *
 * Derived rather than chosen, and derived *here* rather than in a comment:
 * MAX_LINE_PAY comes out of the paytable, and a retune that raises the top
 * line has to raise this with it or the guarantee quietly stops holding.
 *
 * There are two candidate worst spins, and it is the second that binds:
 *
 *   nine top lines          9 * MAX * stake/9  =  MAX * stake
 *                           needs bank >= (MAX - 1) * stake
 *
 *   one jackpot, eight top  J*(bank + stake) + 8*MAX*stake/9  <=  bank + stake
 *                           bank >= stake * ( (8*MAX/9)/(1-J) - 1 )
 *
 * Rounded up, because a cap a fraction of a chip too generous is a cap that
 * does not hold.
 *
 * The stake appears on both sides of that second line, and getting it onto
 * only one is how this was wrong the first time. The stake enters the bank
 * before the reels resolve, so it is part of the room a payout has — and it is
 * also part of the bank the jackpot takes its share of. Taking the share of
 * the bank as it stood before the pull makes the divisor one smaller, and that
 * is not sufficient: at a stake of 1000 that machine owes chips it has not
 * got.
 *
 * This is deliberately the true worst case rather than a percentile. All
 * fifteen cells landing on diamonds has a probability of about one in 10^15,
 * and capping against it is absurdly conservative in exactly the way a chip
 * economy should be.
 */
const TOP_EIGHT = ((LINE_COUNT - 1) * MAX_LINE_PAY) / LINE_COUNT / (1 - JACKPOT_SHARE);

export const STAKE_DIVISOR = Math.ceil(TOP_EIGHT - 1);

/**
 * The same, for a spin nobody paid for.
 *
 * A free spin can pay everything a paid one can, but no stake enters the bank
 * on the way in — so the stake is missing from both sides of that second line
 * and the bank has to be one stake deeper to cover the same worst case. One
 * chip in thirteen hundred, and worth having as its own number rather than
 * reusing the paid one and being nearly right.
 */
export const FREE_STAKE_DIVISOR = Math.ceil(TOP_EIGHT);

/**
 * The largest stake this bank can certainly pay out on.
 *
 * A cap rather than a refusal, deliberately. A machine that will not spin
 * until its bank is fat is dark exactly when it is newest, and every quiet
 * week would close it again. A machine that offers smaller stakes instead is
 * always playable, and playing it is what fills the bank back up.
 */
export function maxStake(bank: number): number {
  return Math.max(0, Math.floor(Math.max(0, bank) / STAKE_DIVISOR));
}

/**
 * The largest stake this bank can certainly pay a *free* spin out on.
 *
 * Free spins take nothing and can give everything, so a run of them walks the
 * bank down with nothing walking it back up. Checked before each one rather
 * than once when they were awarded: the bank at the eighth free spin is not
 * the bank that awarded it, and the promise this machine makes is about the
 * bank it is actually paying from.
 */
export function maxFreeStake(bank: number): number {
  return Math.max(0, Math.floor(Math.max(0, bank) / FREE_STAKE_DIVISOR));
}

/** What a jackpot pays out of this bank: whole chips, never more than it holds. */
export function jackpotPay(bank: number): number {
  return Math.floor(Math.max(0, bank) * JACKPOT_SHARE);
}

/**
 * The most this bank could possibly owe on one spin at this stake.
 *
 * Both cases, whichever is worse. It exists so the guarantee can be tested as
 * a property across many banks rather than asserted about one, and so that the
 * reasoning behind STAKE_DIVISOR is executable instead of a comment somebody
 * has to trust.
 */
export function worstCase(bank: number, stake: number): number {
  const topLine = Math.floor((MAX_LINE_PAY * stake) / LINE_COUNT);
  const allFixed = LINE_COUNT * topLine;
  /*
   * The jackpot's share is of the bank the payout is actually made from, which
   * is the bank plus the stake that has just gone into it. Modelling it as a
   * share of the bank beforehand is what made 1295 look like enough.
   */
  const withJackpot = jackpotPay(bank + stake) + (LINE_COUNT - 1) * topLine;
  return Math.max(allFixed, withJackpot);
}

/**
 * What a machine playing for nothing starts with.
 *
 * A for-fun machine keeps its own purse *and* its own bank, both living at the
 * machine and gone when the player walks away. That is what lets every other
 * number in this package stay exactly as it is: the same paytable, the same
 * cap, the same share of the bank — run against figures that were never
 * anybody's.
 *
 * The bank is seeded deep enough that the machine opens with a real range of
 * bets on it, rather than greying keys out until an imaginary bank has filled.
 */
export const FUN_PURSE = 25_000;
export const FUN_BANK = 8_000_000;

/**
 * The smallest bet a line takes: one chip.
 *
 * Its own number rather than the smallest key, because the keys are only what
 * one press offers — any whole number of chips a line is a bet, and a single
 * chip is still a spin the bank has to be able to cover. The paytable stays
 * whole at one: `evaluate` divides a spin by the lines it was spread across,
 * and a spin the machine sends is always a whole bet on each of them.
 */
export const MIN_STAKE = 1;

/**
 * The bets on the keys, smallest first.
 *
 * What one press sets the bet a line to. None of these is a limit: whether the
 * bank can cover a bet is the cap's to say at spin time, key or not.
 */
export const BET_KEYS: readonly number[] = [10, 50, 100, 250, 500, 1000];

/**
 * The keys once high stakes is switched on.
 *
 * Starting where the ordinary row stops, so a thousand held on one row is still
 * held on the other and flipping the switch does not take somebody's bet away.
 */
export const HIGH_STAKES_KEYS: readonly number[] = [1000, 2500, 5000, 10000];
