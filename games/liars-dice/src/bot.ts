import type { BotSkill } from "@backroom/core";
import type { Bid, Face } from "./bid.js";
import { countOf, FACES, leastCount } from "./bid.js";

/**
 * Somebody to play against when there is nobody to play against.
 *
 * Bots sit only at tables playing for fun — a bot has no account, so a game
 * won against one for chips would be chips out of thin air. What it needs is
 * therefore not a good player but a believable one: a table that bids things
 * roughly worth bidding and calls a bluff often enough to make bluffing a
 * decision.
 *
 * It knows its own hand and how many dice it cannot see, which is exactly what
 * a person knows. Everything below follows from that and nothing peeks.
 */

export type Choice = { type: "bid"; bid: Bid } | { type: "liar" } | { type: "exact" };

/** How wild a face is: a one fills only a bid on ones, anything else takes wilds too. */
const chanceOf = (face: Face): number => (face === 1 ? 1 / 6 : 1 / 3);

/**
 * The chance of exactly this many hits among dice it cannot see.
 *
 * Multiplied up term by term rather than through factorials: fifty dice is
 * well inside what a float handles this way, and `50!` is not.
 */
export function exactly(trials: number, wanted: number, chance: number): number {
  if (wanted < 0 || wanted > trials) {
    return 0;
  }
  let term = (1 - chance) ** (trials - wanted) * chance ** wanted;
  for (let at = 0; at < wanted; at += 1) {
    term *= (trials - at) / (at + 1);
  }
  return term;
}

/** The chance of at least this many. One when nothing is wanted; zero past the dice. */
export function atLeast(trials: number, wanted: number, chance: number): number {
  if (wanted <= 0) {
    return 1;
  }
  if (wanted > trials) {
    return 0;
  }
  let sum = 0;
  for (let hits = wanted; hits <= trials; hits += 1) {
    sum += exactly(trials, hits, chance);
  }
  return sum;
}

/**
 * How much a bot needs to believe something before it says it, and how little
 * before it calls.
 *
 * An easy bot is credulous: it lets almost anything stand and says things it
 * half believes. A hard one calls on a coin's edge and only bids what it
 * expects to be there.
 */
export const NERVE: Record<BotSkill, { call: number; bid: number }> = {
  easy: { call: 0.18, bid: 0.26 },
  normal: { call: 0.28, bid: 0.34 },
  hard: { call: 0.38, bid: 0.42 },
};

/** The face it holds most of, ties going to the higher one. */
function bestFace(hand: readonly Face[]): Face {
  let best: Face = 6;
  let most = -1;
  for (const face of FACES) {
    // Not `countOf`, because a bot picking a face to open on cares what it
    // actually holds rather than what its ones could pretend to be.
    const held = hand.filter((die) => die === face).length;
    if (held >= most) {
      most = held;
      best = face;
    }
  }
  return best;
}

export function choose({
  skill,
  hand,
  total,
  standing,
}: {
  skill: BotSkill;
  hand: readonly Face[];
  /** Dice on the table, its own included. */
  total: number;
  standing: Bid | null;
}): Choice {
  const unseen = Math.max(0, total - hand.length);
  const nerve = NERVE[skill];

  /** How likely a claim is to be true, given what it holds and what it cannot see. */
  const believe = (bid: Bid): number =>
    atLeast(unseen, bid.count - countOf([hand], bid.face), chanceOf(bid.face));

  if (standing === null) {
    /*
     * Opening. Its own dice plus its share of everybody else's, which is the
     * honest bid — and the honest bid is the right opening, because the whole
     * game is deciding when to stop telling the truth.
     */
    const face = bestFace(hand);
    const count = Math.max(
      1,
      Math.min(total, countOf([hand], face) + Math.round(unseen * chanceOf(face))),
    );
    return { type: "bid", bid: { count, face } };
  }

  /*
   * Exact, at hard only. It is the press that ends games and a bot that reached
   * for it at every table would be unbearable to sit with; a good player uses
   * it when the count sits right on what they expect, which is what this asks.
   */
  if (
    skill === "hard" &&
    exactly(unseen, standing.count - countOf([hand], standing.face), chanceOf(standing.face)) >= 0.26
  ) {
    return { type: "exact" };
  }

  if (believe(standing) < nerve.call) {
    return { type: "liar" };
  }

  /*
   * The raise it believes most, out of the cheapest bid available at each face.
   * Cheapest per face because anything dearer at the same face is strictly less
   * likely — so one candidate per face is the whole board worth considering.
   */
  let best: Bid | null = null;
  let bestOdds = 0;
  for (const face of FACES) {
    const count = leastCount(face, standing, total);
    if (count === null) {
      continue;
    }
    const candidate: Bid = { count, face };
    const odds = believe(candidate);
    if (odds >= nerve.bid && odds > bestOdds) {
      best = candidate;
      bestOdds = odds;
    }
  }
  // Nothing it believes enough to say is a reason to call, not a reason to lie:
  // a bot that bid its way up a board it did not believe would never be caught.
  return best === null ? { type: "liar" } : { type: "bid", bid: best };
}

/** How long to look like it thought about it. Better players are quicker. */
export function thinkingTime(skill: BotSkill): number {
  const base = skill === "easy" ? 1_900 : skill === "normal" ? 1_300 : 850;
  return base + Math.floor(Math.random() * 600);
}
