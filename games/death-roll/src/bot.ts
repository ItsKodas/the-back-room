import type { BotSkill } from "@backroom/core";
import { roundFor } from "./odds.js";

/**
 * Somebody to sit at a table playing for nothing.
 *
 * Only ever there: a bot at a table playing for chips is a button that mints
 * them, and the adapter refuses to seat one. Which means everything here can
 * be about making a for-fun table worth sitting through rather than about
 * fairness.
 *
 * There is exactly one decision in this game, so a bot is entirely described
 * by when it spends its pass — and the honest answer, for a table of two to
 * six, is already worked out in odds.ts. Skill is how far short of it the
 * bot falls.
 */

export type Choice = "roll" | "pass";

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

/**
 * How wary each skill is of spending a pass, as a multiple of the real price.
 *
 * A hard bot values surviving a round at exactly what it is worth, so it plays
 * the solver's move. A normal one values it at less, which raises the bar a
 * pass has to clear: it waits longer than it should, the way a player who has
 * worked out that passing is for the endgame without working out where the
 * endgame starts. An easy bot never passes at all.
 */
export const WARINESS = { normal: 2.5, hard: 1 } as const;

/**
 * What a bot does on its turn.
 *
 * @param players How many are still in this round.
 * @param toAct The bot's position in the round's turn order.
 * @param holders Who still holds a pass this round, by position.
 * @param passedTo Whether the roll reached the bot by a pass — which means it
 * must roll.
 * @param margin The real price of a pass as survival, from `passMargin`.
 * @param random Only consulted in a state with no fixed right answer, where
 * good play is to pass some of the time. Math.random is fine there: bots only
 * ever sit at tables playing for nothing.
 */
export function choose(options: {
  skill: BotSkill;
  players: number;
  ceiling: number;
  toAct: number;
  holders: number;
  passedTo: boolean;
  margin: number;
  canAfford: boolean;
  random?: () => number;
}): Choice {
  const { skill, players, ceiling, toAct, holders, passedTo, margin, canAfford } = options;
  if (skill === "easy" || !canAfford) {
    return "roll";
  }
  const chance = roundFor(players, margin * WARINESS[skill]).passChance(
    ceiling,
    toAct,
    holders,
    passedTo,
  );
  if (chance <= 0) {
    return "roll";
  }
  if (chance >= 1) {
    return "pass";
  }
  return (options.random ?? Math.random)() < chance ? "pass" : "roll";
}
