import type { BotSkill } from "@backroom/core";
import { CHIPS } from "./bank.js";
import type { SpotId } from "./spots.js";

/**
 * What a bot puts on the cloth.
 *
 * Bots exist for one reason: a for-fun table is worth sitting at on your own.
 * They never sit at a table playing for chips, so none of this needs to be
 * good — it needs to look like somebody is playing.
 *
 * Which at a baccarat table means something specific. There are three bets and
 * no decisions, so a bot cannot show character by playing well; the only thing
 * it can do wrong is look mechanical. So the side moves, the chip moves, and
 * the tie comes up about as often as a person plays it.
 */

/**
 * Which spot, weighted by how often people actually back it.
 *
 * Banker slightly ahead of Player because that is how a real table bets, and
 * the tie occasionally — a bot that lived on a fourteen per cent bet would
 * look like a machine losing on purpose, and one that never touched it would
 * look like a machine too.
 */
const TASTE: Record<BotSkill, readonly SpotId[]> = {
  easy: ["player", "player", "banker", "banker", "tie"],
  normal: ["banker", "banker", "banker", "player", "player", "tie"],
  hard: ["banker", "banker", "banker", "banker", "player", "player", "player", "tie"],
};

/** How many piles a bot puts down in one window. */
const PILES: Record<BotSkill, number> = { easy: 1, normal: 2, hard: 3 };

/**
 * One chip, somewhere plausible.
 *
 * Returns nothing when the bot has already had its go this window, which is
 * what stops it burying the cloth while a person is deciding.
 */
export function botBet(
  skill: BotSkill,
  already: number,
  purse: number,
  random: () => number = Math.random,
): { spotId: SpotId; chips: number } | null {
  if (already >= PILES[skill]) {
    return null;
  }
  const taste = TASTE[skill];
  const spotId = taste[Math.floor(random() * taste.length)] as SpotId;
  /*
   * Small chips, and never more than the purse holds. A bot that shoved would
   * make the table about the bot, and the point of it is to make the table
   * look busy while somebody else plays.
   */
  const affordable = CHIPS.filter((chip) => chip <= purse && chip <= 500);
  const chip = affordable[Math.floor(random() * affordable.length)];
  return chip === undefined ? null : { spotId, chips: chip };
}

/** How long a bot appears to think before a chip lands. */
export function thinkingTime(random: () => number = Math.random): number {
  return 700 + Math.floor(random() * 1_800);
}
