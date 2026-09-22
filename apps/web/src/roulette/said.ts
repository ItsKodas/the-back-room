import { MIN_CHIP } from "@backroom/game-roulette";
import { exact } from "../game/money.js";

/**
 * The one line under the chip keys.
 *
 * Pure, and the felt's only source for it, because this is three messages that
 * used to live in three places and disagree about which one won: the empty
 * bank was said in the standing line, the cap refusal replaced it, and why a
 * key was dark was said nowhere at all.
 *
 * N6 in the table requirements: a limit the client can already see is said in
 * place, not left for the server to refuse. It stays a courtesy — the server
 * checks every figure again and is the only thing that can say no.
 */

export interface Reach {
  /** What the bank can still cover on the best spot on the cloth. */
  most: number;
  /** The balance, or the play purse. Null for somebody with no account. */
  purse: number | null;
  /** What the bank holds. */
  bank: number;
}

/**
 * Why a held custom figure was let go — the same shape Slots' betSaid gives it.
 *
 * Here rather than in Controls because it is one of the messages on this line,
 * and the whole point of this file is that they are ordered in one place. It
 * was rendered past `said` for a while, which put it above every rule below —
 * including the empty bank, which is the one message this table has already
 * had to win an argument about.
 */
function releasedSaid(chip: number, reach: Reach): string {
  if (reach.purse !== null && chip > reach.purse) {
    return `Your ${exact(chip)} chip was released: more than your ${exact(reach.purse)}.`;
  }
  return `Your ${exact(chip)} chip was released: the bank covers ${exact(reach.most)} on the best spot now.`;
}

export function said({
  reach,
  typed,
  holding,
  refused,
  released = null,
  betting,
}: {
  reach: Reach;
  chip: number;
  typed: number | null;
  holding: boolean;
  refused: string | null;
  /** A custom figure the box let go of, if one is still worth explaining. */
  released?: number | null;
  betting: boolean;
}): string {
  // The wheel is turning. Nothing here is actionable, and a line that stays up
  // through a spin reads as a complaint about the spin.
  if (!betting) {
    return "";
  }

  /*
   * An empty bank is a fact about the table, not a refusal of your press, and
   * it belongs on screen while you are still deciding rather than after you
   * have tried. It wins over a refusal because it is the reason for it.
   */
  if (reach.bank <= 0) {
    return "The bank is empty — nothing to play for yet.";
  }

  if (refused !== null) {
    return refused;
  }

  /*
   * A figure the box let go of, under both of those.
   *
   * Under the empty bank because an empty bank is why it went, and under a
   * refusal because a refusal is about the press just made and this is about
   * one made a moment ago — a player whose new chip is being turned away needs
   * to hear that, not to be told again about the old one. Above what follows
   * because those are complaints about a figure still in the box, and the
   * release emptied it.
   */
  if (released !== null) {
    return releasedSaid(released, reach);
  }

  // A figure already on is not a figure to complain about, however it compares
  // now: the cap moves as other people bet, and a bet already down is down.
  if (typed !== null && !holding) {
    if (typed < MIN_CHIP) {
      return `Chips here start at ${exact(MIN_CHIP)}.`;
    }
    if (reach.purse !== null && typed > reach.purse) {
      return `That is more than your ${exact(reach.purse)}.`;
    }
    if (typed > reach.most) {
      return `The bank covers ${exact(reach.most)} on the best spot at the moment.`;
    }
  }

  return "";
}
