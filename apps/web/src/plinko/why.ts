import { MIN_STAKE, type Risk } from "@backroom/game-plinko";
import { exact } from "../game/money.js";

/**
 * Why the stake cannot go higher, or why nothing can be dropped at all.
 *
 * A key that silently does nothing reads as broken — `+` and `2×` already
 * clamp to the cap and the balance, so the one moment a press visibly changes
 * nothing is the moment the stake is already sitting on one of those limits,
 * not only once it has somehow gone past it.
 */
export interface WhyArgs {
  canPlay: boolean;
  cap: number;
  balance: number | null;
  stake: number;
  risk: Risk;
  /** A refusal's own words, shown only once neither limit explains the silence. */
  notice: string | null;
}

export function whyLine({ canPlay, cap, balance, stake, risk, notice }: WhyArgs): string | null {
  if (!canPlay) {
    return "Sign in to play for chips, or play for fun.";
  }
  if (cap < MIN_STAKE) {
    return "The bank is empty. Nothing to play for yet.";
  }
  if (stake >= cap) {
    return `The bank covers ${exact(cap)} a ball on ${risk} right now.`;
  }
  if (balance !== null && stake > balance) {
    return "That is more than you have.";
  }
  if (balance !== null && stake >= balance) {
    return "That is everything you have.";
  }
  return notice;
}
