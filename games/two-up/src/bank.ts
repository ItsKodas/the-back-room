/**
 * What the table can be asked to pay, and what the bank must hold to promise it.
 *
 * Two-up is the cheapest of the banked games to reason about and the argument
 * is worth writing down, because the cheapness is the feature. The wheel has to
 * loop thirty-seven pockets to find its worst case; here there are three
 * outcomes and they are mutually exclusive, so the worst case is a `max` of
 * three products and every cap below is solved in closed form.
 *
 * The exposure is worked out across the whole cloth rather than per seat, for
 * the same reason the wheel's is: one throw settles everybody, so a cap derived
 * from one player would be a promise made in front of the others. Doing it
 * exactly is also what makes the table generous — equal money on heads and
 * tails can never both come in, so between them they need no bank at all.
 */

/** The three things a chip can go on. */
export type BetOn = "heads" | "tails" | "fiveOdds";

/** A chip, or a pile of them, on one of them. */
export interface Bet {
  readonly on: BetOn;
  readonly chips: number;
}

/**
 * What five odds pays, and why it is not what a real casino pays.
 *
 * Five odds is a one-in-thirty-two chance, so the fair price is 31 to 1. A real
 * house pays 25 and keeps 18.75% of everything on it — which would make it far
 * and away the worst bet in this building, sat on a table whose main bet keeps
 * 3.125%.
 *
 * At 30 to 1 the side bet keeps `1 - 31/32`, which is 3.125% exactly: the same
 * edge as heads and tails. The number is therefore derived from the game rather
 * than chosen, and a punter cannot find a worse bet on this table by accident.
 */
export const FIVE_ODDS_PAYS = 30;

/**
 * What the bank must hold per chip of a lone five-odds bet.
 *
 * Not used to cap anything — {@link headroom} does that exactly — but it is the
 * worst ratio this table can produce, and the admin bank route asks for it to
 * answer "what could this bank take at all".
 */
export const STAKE_DIVISOR = FIVE_ODDS_PAYS;

/** What is on one side. */
export function on(bets: readonly Bet[], which: BetOn): number {
  return bets.reduce((sum, one) => (one.on === which ? sum + one.chips : sum), 0);
}

/** Everything staked on the cloth this round. */
export function staked(bets: readonly Bet[]): number {
  return bets.reduce((sum, one) => sum + one.chips, 0);
}

/**
 * The most this cloth could pay out on one round.
 *
 * Three worlds, one of which happens. Heads coming in pays the heads money
 * double and takes everything else; tails likewise; and five odds is precisely
 * the throw where heads and tails have both lost, so it is exposed to the
 * side bet alone. The table faces the largest of the three, never their sum.
 */
export function owed(bets: readonly Bet[]): number {
  return Math.max(
    2 * on(bets, "heads"),
    2 * on(bets, "tails"),
    (FIVE_ODDS_PAYS + 1) * on(bets, "fiveOdds"),
  );
}

/**
 * What the bank has to be holding for this cloth to be safe.
 *
 * Every stake enters the bank before the coins go up, so the table pays out of
 * the bank *plus* what is on the cloth — which is why this is a difference
 * rather than the payout itself.
 */
export function needed(bets: readonly Bet[]): number {
  return Math.max(0, owed(bets) - staked(bets));
}

/**
 * The most that can still go on one side, given what is already down.
 *
 * Solved rather than searched, because it can be. Writing `b` for the bank not
 * counting the cloth and `h`, `t`, `f` for what is on each side, safety is
 * `owed <= b + h + t + f`. Adding `x` to heads:
 *
 *     2(h + x)  <=  b + h + t + f + x     =>   x  <=  b + t + f - h
 *
 * and the tails and five-odds worlds only get *easier* as `x` grows, because
 * the stakes rise and their payouts do not. Five odds is the same move with a
 * different multiplier:
 *
 *     31(f + x) <=  b + h + t + f + x     =>   x  <=  (b + h + t - 30f) / 30
 *
 * Floored, because half a chip of headroom is no headroom.
 */
export function headroom(bank: number, bets: readonly Bet[], which: BetOn): number {
  const room = Math.max(0, bank);
  const heads = on(bets, "heads");
  const tails = on(bets, "tails");
  const odds = on(bets, "fiveOdds");
  if (which === "fiveOdds") {
    return Math.max(
      0,
      Math.floor((room + heads + tails - FIVE_ODDS_PAYS * odds) / FIVE_ODDS_PAYS),
    );
  }
  const mine = which === "heads" ? heads : tails;
  const other = which === "heads" ? tails : heads;
  return Math.max(0, Math.floor(room + other + odds - mine));
}

/**
 * What a table playing for nothing starts with.
 *
 * Its purse and its bank both live at the table and are gone when it closes,
 * which is what lets every number above stay exactly as it is: the same cloth,
 * the same exact exposure, run against figures that were never anybody's.
 */
export const FUN_PURSE = 25_000;
export const FUN_BANK = 2_000_000;

/**
 * The chips this table takes, largest first.
 *
 * The same denominations the card tables and the wheel mint, because they are
 * the same chips: somebody who has learned that purple is five hundred should
 * not have to learn it again across the room.
 */
export const CHIPS = [5000, 1000, 500, 250, 100, 50, 25] as const;

/** The smallest thing anybody can put down. */
export const MIN_CHIP = CHIPS[CHIPS.length - 1];
