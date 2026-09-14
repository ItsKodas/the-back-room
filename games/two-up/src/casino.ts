import { ODDS_LIMIT, type Outcome } from "./coins.js";

/**
 * The casino school: bet on the coins, and let the house keep the split.
 *
 * A round here is over at the first throw where the coins agree, and odds is
 * simply thrown again — which on its own would be a coin flip against a bank,
 * and a coin flip against a bank is a button that mints. The limit is what
 * makes it a game the house can offer: five odds in a row and heads and tails
 * both lose, once in thirty-two, which is the entire edge.
 *
 * A re-throw is not a free round under CLAUDE.md's clause. No new stake enters,
 * the same bet is still live, no additional payout becomes possible, and the
 * exposure at the fifth throw is the exposure that was covered before the
 * first. There is nothing to re-derive mid-round.
 */

/** What a finished round is called. */
export type Called = "heads" | "tails" | "fiveOdds";

/**
 * What this run of throws has decided, or null if it is still deciding.
 *
 * Reads the whole run every time rather than being stepped, so it is a pure
 * function of what the table has recorded. A stepper would hold the count in a
 * second place, and the count is the only thing in this game the house's edge
 * depends on.
 */
export function readCasino(throws: readonly Outcome[]): Called | null {
  let odds = 0;
  for (const one of throws) {
    if (one !== "odds") {
      return one;
    }
    odds += 1;
    if (odds >= ODDS_LIMIT) {
      return "fiveOdds";
    }
  }
  return null;
}
