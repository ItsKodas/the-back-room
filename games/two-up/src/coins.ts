/**
 * Two coins, and the only place in this game that touches randomness.
 *
 * Both schools read what this says and neither may ask it anything else, which
 * is the seam that keeps two schools from becoming two games. It is also the
 * whole of the fairness argument: there is one function to check.
 *
 * The source is injected rather than reached for. The server hands in its
 * cryptographic one for the reason CLAUDE.md gives — a table hands every
 * watcher its whole result every throw, and a run of those is exactly what is
 * needed to recover `Math.random`'s state and predict the next one.
 */

/** One coin. */
export type Face = "head" | "tail";

/**
 * Two coins, read.
 *
 * `odds` is not a result. It is the throw that did not answer the question,
 * and both schools throw again on it.
 */
export type Outcome = "heads" | "tails" | "odds";

/**
 * How many odds in a row a round will tolerate.
 *
 * The casino school's entire house edge lives in this number: five is a
 * one-in-thirty-two chance that heads and tails both lose. The traditional
 * school uses the same figure to odd a spinner out, which is what a real
 * school does with a spinner who cannot make a decision.
 */
export const ODDS_LIMIT = 5;

/** What a pair of faces says. */
export function readFaces(faces: readonly [Face, Face]): Outcome {
  if (faces[0] !== faces[1]) {
    return "odds";
  }
  return faces[0] === "head" ? "heads" : "tails";
}

/**
 * A throw.
 *
 * The faces come back as well as the reading, because the felt has to land two
 * coins on two particular faces and "heads" does not tell it which coin did
 * what. Half of a satisfying toss is that the thing on screen is the thing
 * that decided.
 */
export function toss(random: () => number): { faces: [Face, Face]; outcome: Outcome } {
  const flip = (): Face => (random() < 0.5 ? "head" : "tail");
  const faces: [Face, Face] = [flip(), flip()];
  return { faces, outcome: readFaces(faces) };
}
