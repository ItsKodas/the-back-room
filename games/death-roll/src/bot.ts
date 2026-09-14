import type { BotSkill } from "@backroom/core";
import { worthPassing } from "./odds.js";

/**
 * Somebody to duel at a table playing for nothing.
 *
 * Only ever there: a bot at a table playing for chips is a button that mints
 * them, and the adapter refuses to seat one. Which means everything here can
 * be about making a for-fun duel worth sitting through rather than about
 * fairness.
 *
 * There is exactly one decision in this game, so a bot is entirely described
 * by when it spends its pass — and the honest answer is already written down
 * in odds.ts. Skill is how far short of it the bot falls.
 */

export type Choice = "roll" | "pass";

/**
 * How much of the true break-even each skill actually sees.
 *
 * A hard bot passes at ceiling eight, which is correct. A normal one waits
 * until five, which is a player who has worked out that passing is for the
 * endgame without working out where the endgame starts. An easy one never
 * passes at all — not a bad decision, but a player who has not noticed there
 * is one, which is the more human way to be bad at this.
 */
const NERVE: Record<BotSkill, number> = { easy: 0, normal: 0.4, hard: 1 };

export function decide(options: {
  skill: BotSkill;
  ceiling: number;
  ante: number;
  price: number;
  canPass: boolean;
}): Choice {
  const { skill, ceiling, ante, price, canPass } = options;
  if (!canPass || NERVE[skill] === 0) {
    return "roll";
  }
  /*
   * The correct threshold, scaled down by nerve. Scaling the *stake* rather
   * than the ceiling is what keeps this honest: a lesser bot values the swing
   * at less than it is worth, which is a plausible mistake, rather than using
   * a made-up cutoff that happens to look like one.
   */
  return worthPassing(ceiling, ante * NERVE[skill], price) ? "pass" : "roll";
}

/**
 * How long to look like it thought about it.
 *
 * A bot that answered instantly would make the table feel like a machine
 * rather than an opponent, and a slow one is the tell that it is not sure —
 * so the better it plays, the quicker it plays.
 */
export function thinkingTime(skill: BotSkill): number {
  const base = { easy: 1_800, normal: 1_300, hard: 800 }[skill];
  return base + Math.floor(Math.random() * 600);
}
