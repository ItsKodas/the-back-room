/**
 * Liar's Dice: five under a cup, and a count nobody can check.
 *
 * The whole game in one package — the bidding arithmetic, a round, a game, the
 * table and its bot. It borrows seating, the ready button and the shape of a
 * table from @backroom/core and brings everything that makes it this game.
 */
export {
  ANTE,
  COUNTDOWN_MS,
  DICE,
  DICE_LEVELS,
  FUN_PURSE,
  LIARS_DICE,
  RESULT_MS,
  REVEAL_MS,
  STAKES,
  TURN_MS,
  anteFor,
  diceFor,
} from "./listing.js";
