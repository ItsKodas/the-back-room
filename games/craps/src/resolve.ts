import { isHard, type Roll, total } from "./dice.js";
import { POINTS, type Spot } from "./spots.js";

/**
 * The rulebook: what one roll does to one bet.
 *
 * Pure, and a function of three things only — the spot, the dice and the hand.
 * No table, no seats, no bank. That is what lets every bet on the cloth be
 * asserted against all thirty-six ordered outcomes on a come-out and on each
 * of the six points, which is a table of several thousand answers that either
 * is the game of craps or is not.
 *
 * The distinction the whole package rests on: `multiplier` is what the table
 * **hands over**, not what the bet is worth. A place six paying seven to six
 * hands over seven chips for every six and keeps the six on the cloth, so its
 * multiplier is 7/6 and not 13/6. A pass line bet that wins hands over stake
 * and winnings both, so its multiplier is 2. Wrong in the generous direction
 * and the bank pays standing bets out twice; wrong the other way and the cap
 * refuses bets the bank could carry easily.
 */

/** What the table is trying to make. Null is a come-out. */
export interface Hand {
  readonly point: number | null;
}

/**
 * A price, as a fraction.
 *
 * Not a number, and that is the whole of why money in this package is exact.
 * `30 * (7 / 6)` is 35.000000000000004 in IEEE754, so a float here would make
 * the tray's central claim — that every denomination pays every bet in whole
 * chips — false in fact while looking true on paper. `back` multiplies first
 * and divides second, where the numerator is an exact integer and the
 * denominator divides it, so the answer is exactly right rather than nearly.
 */
export type Ratio = readonly [num: number, den: number];

/** What these chips hand over at this price. Exact, for the reason above. */
export function back(chips: number, [num, den]: Ratio): number {
  return (chips * num) / den;
}

/**
 * The price as a plain number, for comparing against one.
 *
 * "Does this outcome cost the bank more than the stake it brought in" is the
 * only question this answers, and the answer is never multiplied by chips —
 * that is `back`'s job, and mixing the two is how the fractions get back in.
 */
export const ratioOf = ([num, den]: Ratio): number => num / den;

/** Nothing handed over: the bet lost, or this roll was not its business. */
const NOTHING: Ratio = [0, 1];

/**
 * One chip per chip.
 *
 * Two quite different things wearing one price: a push on a bet that ends,
 * and even-money winnings on a bet that stays up. The arithmetic cannot tell
 * them apart and does not need to — `after` is what says which it was.
 */
const ONE: Ratio = [1, 1];

/** Stake and an equal win, for a bet that ends. */
const EVENS: Ratio = [2, 1];

/** Taken odds: the real chance of the number against the seven, stake included. */
const TRUE_ODDS: Readonly<Record<number, Ratio>> = {
  4: [3, 1],
  10: [3, 1],
  5: [5, 2],
  9: [5, 2],
  6: [11, 5],
  8: [11, 5],
};

/** Laid odds: the same chance the other way up, because the bet is reversed. */
const LAY_ODDS: Readonly<Record<number, Ratio>> = {
  4: [3, 2],
  10: [3, 2],
  5: [5, 3],
  9: [5, 3],
  6: [11, 6],
  8: [11, 6],
};

/**
 * What a place bet hands over, keeping the chip on the cloth.
 *
 * The odds themselves rather than the odds plus one, because the six is still
 * on the felt when it pays. Handing the stake over here as well would pay it
 * out twice, and it is the difference the whole bank rests on.
 */
const PLACE_ODDS: Readonly<Record<number, Ratio>> = {
  4: [9, 5],
  10: [9, 5],
  5: [7, 5],
  9: [7, 5],
  6: [7, 6],
  8: [7, 6],
};

/** The hardways, which also stay up when they pay. */
const HARD_ODDS: Readonly<Record<number, Ratio>> = {
  4: [7, 1],
  10: [7, 1],
  6: [9, 1],
  8: [9, 1],
};

/** The one-roll middle: what it wins on, and what it hands over. */
const PROP_ODDS: Readonly<Record<string, readonly [number, Ratio]>> = {
  any7: [7, [5, 1]],
  two: [2, [31, 1]],
  three: [3, [16, 1]],
  eleven: [11, [16, 1]],
  twelve: [12, [31, 1]],
};

const CRAPS_NUMBERS: ReadonlySet<number> = new Set([2, 3, 12]);

/** The table's own three-four-five cap on taken odds. */
const MAX_TAKEN: Readonly<Record<number, number>> = { 4: 3, 10: 3, 5: 4, 9: 4, 6: 5, 8: 5 };

/**
 * What a lay wins per chip laid, which is what caps it.
 *
 * The bare fraction rather than the ratio above, because this one is divided
 * by rather than multiplied out — and a cap is a comparison, not money.
 */
const LAY_WINS: Readonly<Record<number, number>> = {
  4: 1 / 2,
  10: 1 / 2,
  5: 2 / 3,
  9: 2 / 3,
  6: 5 / 6,
  8: 5 / 6,
};

/**
 * What one chip on this spot hands over on this roll.
 *
 * Nothing for a bet that lost, and nothing for a bet that was simply not this
 * roll's business. One-to-one is a push: the chip back and nothing on it.
 */
export function multiplier(spot: Spot, roll: Roll, hand: Hand): Ratio {
  const t = total(roll);
  switch (spot.kind) {
    case "line":
      return line(spot, t, hand);
    case "travelled":
      return (spot.dark ? t === 7 : t === spot.number) ? EVENS : NOTHING;
    case "odds":
      return odds(spot, t, hand);
    case "place":
      return t === spot.number ? (PLACE_ODDS[spot.number as number] as Ratio) : NOTHING;
    case "big":
      // Even money, and the bet stays: winnings alone, so one and not two.
      return t === spot.number ? ONE : NOTHING;
    case "field":
      if (t === 2) return [3, 1];
      if (t === 12) return [4, 1];
      return [3, 4, 9, 10, 11].includes(t) ? EVENS : NOTHING;
    case "hard":
      return isHard(roll) && t === spot.number
        ? (HARD_ODDS[spot.number as number] as Ratio)
        : NOTHING;
    case "prop":
      return prop(spot.id, t);
  }
}

/**
 * The line, light and dark.
 *
 * A come bet in the box is always its own come-out, whatever the table's point
 * is. That is the only difference between the come box and the pass line, and
 * reading it off the spot rather than off the hand is what keeps these from
 * being one function with a flag nobody can follow.
 */
function line(spot: Spot, t: number, hand: Hand): Ratio {
  const ownComeOut = spot.id === "come" || spot.id === "dontcome" || hand.point === null;
  if (spot.dark) {
    if (ownComeOut) {
      // The barred twelve is the entire house edge on this side of the cloth.
      if (CRAPS_NUMBERS.has(t)) return t === 12 ? ONE : EVENS;
      return NOTHING;
    }
    return t === 7 ? EVENS : NOTHING;
  }
  if (ownComeOut) {
    return t === 7 || t === 11 ? EVENS : NOTHING;
  }
  return t === hand.point ? EVENS : NOTHING;
}

/**
 * Odds, which take their number from the spot when they have one.
 *
 * Behind the line it backs the table's point; behind a come bet it backs that
 * bet's own number, which is why the spot carries one at all — a player may
 * have four come bets working and each wants its own price and its own cap.
 */
function odds(spot: Spot, t: number, hand: Hand): Ratio {
  const n = spot.number ?? hand.point;
  if (n === null) return NOTHING;
  if (spot.dark) return t === 7 ? (LAY_ODDS[n] as Ratio) : NOTHING;
  return t === n ? (TRUE_ODDS[n] as Ratio) : NOTHING;
}

function prop(id: string, t: number): Ratio {
  const single = PROP_ODDS[id];
  if (single !== undefined) {
    return t === single[0] ? single[1] : NOTHING;
  }
  if (id === "anycraps") return CRAPS_NUMBERS.has(t) ? [8, 1] : NOTHING;
  if (id === "horn") {
    // A quarter of the chips on each of the four, so a hit pays its own price
    // on a quarter and the other three quarters are gone. The quarter is in
    // the denominator rather than worked out first, which is what keeps a
    // horn of sixty paying 465 and not 464.9999999999999.
    if (t === 2 || t === 12) return [31, 4];
    if (t === 3 || t === 11) return [16, 4];
    return NOTHING;
  }
  if (id === "ce") {
    if (CRAPS_NUMBERS.has(t)) return [8, 2];
    if (t === 11) return [16, 2];
    return NOTHING;
  }
  return NOTHING;
}

/**
 * Where these chips sit once the roll is over, or nothing if the bet is done.
 *
 * The other half of the rulebook, and the half roulette never needed: a wheel
 * settles every chip on the cloth every spin, and this cloth does not.
 */
export function after(spot: Spot, roll: Roll, hand: Hand): string | null {
  const t = total(roll);
  switch (spot.kind) {
    case "line": {
      const ownComeOut = spot.id === "come" || spot.id === "dontcome" || hand.point === null;
      if (!ownComeOut) {
        return t === 7 || t === hand.point ? null : spot.id;
      }
      if (t === 7 || t === 11 || CRAPS_NUMBERS.has(t)) return null;
      // A number: the pass line waits for it, a come bet travels to it.
      return spot.id === "come" || spot.id === "dontcome" ? `${spot.id}:${t}` : spot.id;
    }
    case "travelled":
      return t === 7 || t === spot.number ? null : spot.id;
    case "odds": {
      const n = spot.number ?? hand.point;
      if (n === null) return spot.id;
      return t === 7 || t === n ? null : spot.id;
    }
    case "place":
    case "big":
      return t === 7 ? null : spot.id;
    case "hard":
      // Gone on the seven and gone on the easy way; otherwise still standing,
      // including on the roll that has just paid it.
      if (t === 7) return null;
      if (t === spot.number && !isHard(roll)) return null;
      return spot.id;
    case "field":
    case "prop":
      return null;
  }
}

/** The table's point after this roll. */
export function nextPoint(hand: Hand, roll: Roll): number | null {
  const t = total(roll);
  if (hand.point === null) {
    return POINTS.includes(t) ? t : null;
  }
  return t === hand.point || t === 7 ? null : hand.point;
}

/** What the roll did to the hand, for the board beside the felt. */
export function decided(hand: Hand, roll: Roll): "set" | "made" | "sevenOut" | null {
  const t = total(roll);
  if (hand.point === null) {
    return POINTS.includes(t) ? "set" : null;
  }
  if (t === hand.point) return "made";
  return t === 7 ? "sevenOut" : null;
}

/**
 * The most odds this line bet may carry.
 *
 * Three, four and five times the line on the three pairs of points, which is
 * the standard table's cap and has one property worth the arithmetic: the odds
 * payout is then exactly six times the line bet whatever the point is, so the
 * table's exposure does not lurch about with the dice. A lay is capped at
 * whatever would *win* the same, which is a larger number of chips, because
 * the dark side risks more than it takes.
 *
 * The bank's own cap applies on top and may well be tighter. The felt offers
 * the smaller of the two.
 */
export function maxOdds(point: number, line: number, dark: boolean): number {
  if (!dark) {
    return (MAX_TAKEN[point] as number) * line;
  }
  return Math.floor((6 * line) / (LAY_WINS[point] as number));
}

/**
 * Whether this bet sits out the roll in front of it.
 *
 * The come-out rule, and the real one rather than a simplification: the
 * numbers are off while a new point is being established unless their owner
 * says otherwise, and the odds are off whatever anybody says, because a come
 * bet's odds cannot act on the roll that is deciding a different come bet.
 *
 * `works` is one toggle per seat rather than one per bet. A table where the
 * big six slept through the come-out and the place six did not would be a
 * table nobody could read.
 */
export function sleeps(spot: Spot, hand: Hand, works: boolean): boolean {
  if (hand.point !== null) {
    return false;
  }
  if (spot.kind === "odds") {
    return true;
  }
  return (spot.kind === "place" || spot.kind === "big") && !works;
}
