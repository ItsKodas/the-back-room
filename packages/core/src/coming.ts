import type { GameListing } from "./catalogue.js";

/**
 * Games the building intends to have, listed before they exist.
 *
 * They sit in the catalogue with `open: false`, which the room already knows
 * how to draw: a card with no art and "not open yet" where the blurb goes.
 * Nothing can be created at one, because `playable()` filters on the same flag
 * — so this is a sign on a door rather than a door.
 *
 * They live here rather than in `games/` because there is nothing to put in
 * `games/` yet. A package holding a name and a colour is a package pretending
 * to be a game; when one of these grows rules it gets its own, and its listing
 * moves in there beside them, the way the others already have.
 *
 * Anything that lands here will have to earn the same things Slots and
 * Blackjack did before it can take a chip: a bank players fill, a cap derived
 * from its own worst outcome, and a cryptographic source for whatever it
 * turns over.
 *
 * Nothing is on the list today. Poker, Death Rolling, Two-up, Craps, Baccarat
 * and Liar's Dice were all on it and have all been built. Two-up had to make
 * the bank argument twice over — once for a casino school paying from its own
 * bank, and once for a traditional school that needs no bank because the chips
 * never leave the ring. Baccarat made it the way the wheel did, with one extra
 * condition: it is dealt from a deck, so it reshuffles every coup. Liar's Dice
 * needed no bank at all — the stake goes into a pot and one of the players
 * takes it, so the chips never leave the table. Their listings live in their
 * own packages now, beside the rules, the way the others do.
 */
export const COMING: readonly GameListing[] = [];
