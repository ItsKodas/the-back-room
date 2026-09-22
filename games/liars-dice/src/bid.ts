/**
 * What may be said at this table, and which of two things said is the bigger.
 *
 * Everything here is pure. The rules of Liar's Dice are almost entirely in
 * this file, which is deliberate: the arithmetic that prices a bid on ones is
 * the one part of the game a player has to be told rather than shown, and it
 * is the one part a bug could hide in for a whole evening.
 */

export type Face = 1 | 2 | 3 | 4 | 5 | 6;

export const FACES: readonly Face[] = [1, 2, 3, 4, 5, 6];

/** A claim about the whole table: this many dice showing this face. */
export interface Bid {
  count: number;
  face: Face;
}

/** A face as it arrives from a client, which is to say not to be trusted. */
export function isFace(value: unknown): value is Face {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}

/**
 * A bid's place in the order, as three numbers compared in turn.
 *
 * The whole of Dudo's bidding arithmetic is this one key. A bid on ones is
 * worth double, because with ones wild only actual ones can fill it — so half
 * the count of a plain face buys a switch to ones, and twice the count plus
 * one buys a switch back.
 *
 * The middle element is load-bearing: at equal doubled count a bid on ones
 * outranks a bid on a plain face, which is the halving rule when the count is
 * even. Ones carry face 1, the lowest, so comparing faces alone would order
 * that pair backwards.
 */
export function key(bid: Bid): readonly [number, number, number] {
  return bid.face === 1 ? [bid.count * 2, 1, 1] : [bid.count, 0, bid.face];
}

/**
 * Whether one bid may be said over another. `null` means nothing has been
 * said yet, and anything may open.
 *
 * The ceiling — never more dice than are on the table — is not here on
 * purpose: it is not a fact about two bids, and a round is the thing that
 * knows how many dice there are. See {@link leastCount}.
 */
export function beats(next: Bid, standing: Bid | null): boolean {
  if (!Number.isInteger(next.count) || next.count < 1 || !isFace(next.face)) {
    return false;
  }
  if (standing === null) {
    return true;
  }
  const a = key(next);
  const b = key(standing);
  for (let at = 0; at < 3; at += 1) {
    if (a[at] !== b[at]) {
      return (a[at] as number) > (b[at] as number);
    }
  }
  return false;
}

/**
 * The cheapest count that may be bid at this face, or null if none can.
 *
 * Walked upwards rather than solved, and it can be: at a fixed face the key's
 * first element rises with the count, so once a count is legal every higher
 * one is too. That monotonicity is also what lets the loop stop at the first
 * hit.
 */
export function leastCount(face: Face, standing: Bid | null, total: number): number | null {
  for (let count = 1; count <= total; count += 1) {
    if (beats({ count, face }, standing)) {
      return count;
    }
  }
  return null;
}

/**
 * The lowest thing that may be said next, or null when nothing can be.
 *
 * Null is a real state of the game rather than an error: with every die in
 * play claimed as a one, there is no raise left and the turn is call-or-call.
 * It is also what the clock falls back from — see the adapter's `timeout`.
 */
export function minRaise(standing: Bid | null, total: number): Bid | null {
  let best: Bid | null = null;
  for (const face of FACES) {
    const count = leastCount(face, standing, total);
    if (count === null) {
      continue;
    }
    const candidate: Bid = { count, face };
    if (best === null || beats(best, candidate)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * How many dice on the table answer to a face, with ones wild.
 *
 * A one counts as whatever was bid, unless ones were bid — which is the whole
 * reason the order above prices them double.
 */
export function countOf(hands: Iterable<readonly Face[]>, face: Face): number {
  let total = 0;
  for (const hand of hands) {
    for (const die of hand) {
      if (die === face || (face !== 1 && die === 1)) {
        total += 1;
      }
    }
  }
  return total;
}

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
] as const;

const TENS = ["", "", "twenty", "thirty", "forty", "fifty"] as const;

/**
 * A count in words, up to fifty — ten players holding five dice each.
 *
 * In words because this is read out loud at the table: "four fives" is a bid
 * and "4 5" is a pair of numbers. Exported on its own — not just through
 * {@link says} — because a bare count in words ("five") is a thing other
 * parts of the game need to say too.
 */
export function countWords(count: number): string {
  if (count < 20) {
    return ONES[count] ?? String(count);
  }
  const tens = TENS[Math.floor(count / 10)] ?? "";
  const ones = count % 10;
  if (tens === "") {
    return String(count);
  }
  return ones === 0 ? tens : `${tens}-${ONES[ones]}`;
}

const FACE_NAMES: Record<Face, string> = {
  1: "ones",
  2: "twos",
  3: "threes",
  4: "fours",
  5: "fives",
  6: "sixes",
};

// A table rather than a suffix trim: "sixes" sheds "es" but "ones" sheds only
// "s" ("on" is not a word), so no single regex singularises every face.
const FACE_SINGULAR: Record<Face, string> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
};

/** A bid as somebody would say it: "four fives", "one one". */
export function says(bid: Bid): string {
  const face = bid.count === 1 ? FACE_SINGULAR[bid.face] : FACE_NAMES[bid.face];
  return `${countWords(bid.count)} ${face}`;
}
