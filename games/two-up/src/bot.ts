import type { BotSkill } from "@backroom/core";
import { CHIPS, MIN_CHIP, type BetOn } from "./bank.js";

/**
 * What a bot puts on the cloth.
 *
 * Bots exist for one reason: a for-fun table is worth sitting at on your own.
 * They never sit at a table playing for chips, so none of this needs to be
 * good — it needs to look like somebody is playing. What it must not do is
 * look like a machine, which is why the chip and the bet both move around.
 *
 * An easier bot is predictable, taking side bets eagerly. A harder one
 * understands the table is not its friend and leans away from five-odds,
 * which is a worse price — 1-in-32 chance paid at 30:1, the same edge as the
 * main bet, not better.
 */

/** The sides a bot will actually take, weighted by how often people bet them and skill. */
const TASTE: Record<BotSkill, readonly BetOn[]> = {
  // Leans hard on side bets; what somebody who does not know the price does.
  easy: ["heads", "tails", "fiveOdds", "fiveOdds"],
  // Mixed, with side bets sprinkled in.
  normal: ["heads", "tails", "heads", "tails", "fiveOdds"],
  // Mostly even money, because a bot that understood the table would take it.
  hard: ["heads", "tails", "heads", "tails", "heads", "tails"],
};

/** How many piles a bot puts down in one window. */
const PILES: Record<BotSkill, number> = { easy: 3, normal: 3, hard: 3 };

/**
 * One chip, somewhere plausible.
 *
 * Returns nothing when the bot has already had its go this window, which is
 * what stops a bot burying the cloth under chips while a person is deciding.
 */
export function botBet(
  skill: BotSkill,
  alreadyDown: number,
  purse: number,
  random: () => number = Math.random,
): { on: BetOn; chips: number } | null {
  if (alreadyDown >= PILES[skill]) {
    return null;
  }
  if (purse < MIN_CHIP) {
    return null;
  }
  const tastes = TASTE[skill];
  const on = tastes[Math.floor(random() * tastes.length)];

  /*
   * Small chips, and never more than the purse holds. A bot that shoved would
   * make the table about the bot, and the point of it is to make the table
   * look busy while somebody else plays.
   */
  const affordable = CHIPS.filter((chip) => chip <= purse && chip <= 500);
  const chips = affordable[Math.floor(random() * affordable.length)];
  return chips === undefined ? null : { on, chips };
}

/** How long a bot appears to think before a chip lands. */
export function thinkingTime(random: () => number = Math.random): number {
  return 400 + Math.floor(random() * 2_200);
}
