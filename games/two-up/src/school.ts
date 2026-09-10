import { ODDS_LIMIT, type Outcome } from "./coins.js";

/**
 * The traditional school: a spinner, a kip, and the ring covering the centre.
 *
 * No bank, and there must not be one — the chips only ever move between the
 * people standing round the ring, which is why this school needs no argument
 * about minting and does need a second player.
 *
 * A round is a run of throws rather than one, which is the shape a real school
 * plays: the spinner has to make three heads before a tails turns up. That is
 * where the drama is, and it is also why odds is more than a nuisance here — a
 * spinner who cannot come in and cannot go out is a spinner holding the ring
 * up, so five odds in a row takes the kip off them.
 */

/** How many heads a spinner has to make to take the centre. */
export const HEADS_TO_WIN = 3;

/** Who took the round, or that nobody did. */
export type Decided = "spinner" | "ring" | "oddedOut";

/**
 * What this run of throws has decided, or null if the spinner is still going.
 *
 * The odds run is *consecutive*, and that is the one difference from the casino
 * school worth being careful about. There, the round is over the moment the
 * coins agree, so leading odds are the only odds there can be. Here a head
 * keeps the round alive, so it also resets the run — and a version that counted
 * odds in total would odd out a spinner who was two-thirds of the way in.
 */
export function readSchool(throws: readonly Outcome[]): Decided | null {
  let heads = 0;
  let odds = 0;
  for (const one of throws) {
    if (one === "tails") {
      return "ring";
    }
    if (one === "heads") {
      odds = 0;
      heads += 1;
      if (heads >= HEADS_TO_WIN) {
        return "spinner";
      }
      continue;
    }
    odds += 1;
    if (odds >= ODDS_LIMIT) {
      return "oddedOut";
    }
  }
  return null;
}
