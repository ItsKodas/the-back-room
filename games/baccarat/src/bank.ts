import type { Outcome } from "./coup.js";
import { back, type SpotId } from "./spots.js";

/**
 * What the table can be asked to pay, and what the bank must hold to promise it.
 *
 * One coup settles everybody at the table, so the exposure is a single shared
 * number rather than a per-seat one. A cap worked out from one seat's bet would
 * be a promise about that player made in front of seven others — the same
 * argument roulette's bank makes over thirty-seven pockets, and it costs even
 * less here because there are three outcomes to check instead of thirty-seven.
 *
 * It also buys the same generosity. Equal chips on Player and Banker cannot
 * both come in, and a tie returns both, so between them they need no bank at
 * all — and a table that understands that takes bets all evening that a cruder
 * one would refuse.
 */

/** A pile of chips sitting on one spot. */
export interface Bet {
  readonly spot: SpotId;
  readonly chips: number;
}

/** The three things that can happen, which is the whole space to check. */
const OUTCOMES: readonly Outcome[] = ["player", "banker", "tie"];

/**
 * What the bank must hold per chip of a lone tie bet.
 *
 * Not used to cap anything — {@link headroom} does that exactly — but it is
 * the worst ratio the cloth can produce, and having it written down is what
 * makes the admin desk's "what could this bank take at all" a number a person
 * can check.
 */
export const STAKE_DIVISOR = 8;

/** Everything staked on the cloth this coup. */
export function staked(bets: readonly Bet[]): number {
  return bets.reduce((sum, one) => sum + one.chips, 0);
}

/** What one outcome would hand back across the whole cloth. */
function paidOn(bets: readonly Bet[], outcome: Outcome): number {
  return bets.reduce((sum, one) => sum + back(one.spot, one.chips, outcome), 0);
}

/**
 * The most this cloth could pay out on one coup.
 *
 * The worst outcome, not the sum of every bet: one coup happens, so chips on
 * Player and chips on Banker expose the table to the larger of them rather
 * than to both.
 */
export function owed(bets: readonly Bet[]): number {
  let worst = 0;
  for (const outcome of OUTCOMES) {
    const here = paidOn(bets, outcome);
    if (here > worst) {
      worst = here;
    }
  }
  return worst;
}

/**
 * What the bank has to be holding for this cloth to be safe.
 *
 * Every stake enters the bank before the coup is dealt, so the table pays out
 * of the bank *plus* what is on the cloth — which is why this is a difference
 * rather than the payout itself.
 */
export function needed(bets: readonly Bet[]): number {
  return Math.max(0, owed(bets) - staked(bets));
}

/**
 * The most that can still go on one spot, given what is already down.
 *
 * Solved by bisection rather than by division, which is the one place this
 * differs from the wheel's version of the same function. There, every payout
 * is a whole multiple of the stake and the inequality rearranges into a
 * division. Here the banker line is `2x - ceil(x/20)`: the commission steps
 * rather than sloping, so dividing through would either promise more than the
 * bank holds or quietly refuse a player up to five per cent of what it could
 * cover.
 *
 * The feasible set is not, in general, a prefix. For an outcome the spot
 * *loses* on, `back(spot, x, outcome)` is nought whatever x is, so growing x
 * only grows the bank-plus-stakes side of that outcome's inequality — the
 * constraint gets easier, not harder, as the stake rises. Left unchecked that
 * makes the feasible set an interval: at a bank of nought with a thousand
 * already on Player, asking for Banker is refused at x = 0, allowed from
 * x = 1000 (enough for Banker money to cover what Player is owed) up to
 * x = 1053 (where Banker's own commission-shaved line takes over as the
 * tight constraint), and refused again above that.
 *
 * What makes bisection exact anyway is `fits(0)`. It is true exactly when the
 * bank already covers the cloth as it stands — `owed(bets) <= bank +
 * staked(bets)` — which is the invariant every chip this adapter has ever
 * admitted was required to leave standing. So on any cloth this table could
 * actually be holding, the interval starts at nought, the feasible set really
 * is a prefix, and halving finds its end in about two dozen iterations.
 *
 * When `fits(0)` is false the cloth is already over-committed, and the
 * interior band above is real but not offered. Handing it out would mean
 * telling a player they must stake a minimum before the table will deal them
 * in — the price of covering a shortfall this cloth did not create. Refusing
 * everything and letting the cloth settle on its own is the honest answer.
 *
 * The bank goes in as it is, never clamped up to nought first. A clamp reads
 * like tidying and is the opposite: it hands the arithmetic a richer bank than
 * exists while the chips already on the cloth go on counting in full, and so
 * offers a chip the table cannot pay. Only the result is floored, which makes
 * an overdrawn bank offer nothing — the honest answer.
 *
 * And the bank can be below nought. Every baccarat table shares one, and a cap
 * measured at one table counts the chips another has put down, so that table's
 * payout can take the bank beneath this cloth's own stakes.
 *
 * The search is clamped to `Number.MAX_SAFE_INTEGER`. A table built without a
 * bank passes it as effectively infinite, and `(bank + already) * 2 + 1` at
 * that size is already past 2^53: integer arithmetic there stops being exact,
 * `Math.floor((low + high) / 2)` stops moving, and both the doubling loop and
 * the bisection spin forever instead of converging. Clamping the bound — not
 * the bank itself, which stays exactly as given everywhere above — keeps the
 * search inside the range where the arithmetic is trustworthy while changing
 * nothing about what a real, finite bank is offered.
 */
export function headroom(bank: number, bets: readonly Bet[], spot: SpotId): number {
  const already = staked(bets);
  const fits = (x: number): boolean => {
    for (const outcome of OUTCOMES) {
      const owes = paidOn(bets, outcome) + back(spot, x, outcome);
      if (owes > bank + already + x) {
        return false;
      }
    }
    return true;
  };

  if (!fits(0)) {
    // The cloth is already over-committed — by another table's payout, or by
    // an admin's hand on the bank. Nothing more goes on.
    return 0;
  }

  /*
   * An upper bound to halve inside. Every binding line grows by at least
   * 0.95x, so the bank plus the stakes, doubled, is comfortably past the
   * answer — and an upper bound that is merely generous costs one extra
   * iteration, while one that is too tight silently caps the table. Capped at
   * MAX_SAFE_INTEGER so a no-bank table's effectively-infinite bank cannot
   * push the bound past the range where doubling and bisection still make
   * progress.
   */
  let low = 0;
  const ceiling = Number.MAX_SAFE_INTEGER;
  let high = Math.min(ceiling, Math.max(1, (bank + already) * 2 + 1));
  while (high < ceiling && fits(high)) {
    high = Math.min(ceiling, high * 2);
  }
  if (fits(high)) {
    // The doubling ran into the ceiling before finding a line that refuses —
    // an effectively unlimited bank, which offers the ceiling itself. The
    // bisection below assumes fits(high) is false; without this, low and high
    // would both sit near MAX_SAFE_INTEGER and their sum would already be
    // past the range doubles represent exactly, so the same stall the clamp
    // exists to prevent would reappear one line down.
    return high;
  }
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return Math.max(0, low);
}

/**
 * What a table playing for nothing starts with.
 *
 * Its purse and its bank both live at the table and are gone when it closes,
 * which is the whole rule about play money: it never touches an account.
 *
 * Seeded well past eight times the largest chip, so the whole tray is playable
 * from the first coup instead of greying out until an imaginary bank has
 * filled.
 */
export const FUN_PURSE = 25_000;
export const FUN_BANK = 2_000_000;

/**
 * The chips this table takes, largest first.
 *
 * The same denominations the other tables mint, because they are the same
 * chips: somebody who has learned that purple is five hundred should not have
 * to learn it again across the room.
 */
export const CHIPS = [5000, 1000, 500, 250, 100, 50, 25] as const;

/** The smallest thing anybody can put on a spot. */
export const MIN_CHIP = CHIPS[CHIPS.length - 1];
