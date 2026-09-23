import type { BotSkill } from "@backroom/core";
import { CHIPS, MIN_CHIP } from "./bank.js";

/**
 * What a bot puts down.
 *
 * Bots exist to make a for-fun table worth sitting at on your own, and they
 * are dealt in nowhere else — the adapter refuses them at any table playing
 * for chips. So this does not have to be clever, only plausible: the line
 * first, because that is what somebody at a craps table actually does, then
 * a number or two, and a prop now and then from the ones who are here for it.
 */

/** How many piles a bot will have down before it stops. */
const PILES: Readonly<Record<BotSkill, number>> = { easy: 2, normal: 3, hard: 5 };

const LINE = ["pass", "pass", "pass", "dontpass"] as const;
const NUMBERS = ["place:6", "place:8", "place:5", "place:9", "place:4", "place:10"] as const;
const MIDDLE = ["field", "hard:8", "hard:6", "any7", "eleven"] as const;

export function botBet(
  skill: BotSkill,
  piles: number,
  purse: number,
): { spotId: string; chips: number } | null {
  const most = PILES[skill];
  if (piles >= most) {
    return null;
  }
  const pick = <T>(from: readonly T[]): T => from[Math.floor(Math.random() * from.length)] as T;
  const spotId =
    piles === 0 ? pick(LINE) : skill === "hard" && Math.random() < 0.4 ? pick(MIDDLE) : pick(NUMBERS);
  // Small chips, so a bot cannot bury the cloth before anybody has looked at it.
  const chips = pick(CHIPS.filter((one) => one <= MIN_CHIP * 5));
  return chips > purse ? null : { spotId, chips };
}

/** Long enough to look like somebody deciding, short enough not to hold the window. */
export function thinkingTime(): number {
  return 400 + Math.floor(Math.random() * 1_400);
}
