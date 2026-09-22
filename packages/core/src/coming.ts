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
 * moves in there beside them, the way the three real ones already have.
 *
 * Most of them will have to earn the same things Slots and Blackjack did
 * before they can take a chip: a bank players fill, a cap derived from its own
 * worst outcome, and a cryptographic source for whatever it turns over.
 * Roulette and Baccarat and Craps are house games, so none of those can be
 * built without that argument being made again.
 *
 * Poker, Death Rolling, Two-up and Liar's Dice were on this list and have been
 * built. Two-up had to make the bank argument twice over — once for a casino
 * school paying from its own bank, and once for a traditional school that
 * needs no bank because the chips never leave the ring. Liar's Dice needed no
 * bank at all: the stake goes into a pot and one of the players takes it, so
 * the chips never leave the table. Their listings live in their own packages
 * now, beside the rules, the way the others do.
 */
export const COMING: readonly GameListing[] = [
  {
    id: "baccarat",
    name: "Baccarat",
    blurb: "Player or banker. Bet on which side gets closer to nine.",
    shape: "table",
    minSeats: 1,
    maxSeats: 8,
    open: false,
    mark: { text: "BACCARAT", accentAt: 0 },
    theme: { wall: "#12161c", felt: "#1b2a3d", accent: "#3d7ab8", accentHi: "#86c2ff" },
  },
  {
    id: "craps",
    name: "Craps",
    blurb: "Two dice, a point to make, and a rail of people shouting.",
    shape: "table",
    minSeats: 1,
    maxSeats: 8,
    open: false,
    mark: { text: "CRAPS", accentAt: 0 },
    theme: { wall: "#1a1610", felt: "#33280f", accent: "#c08a1e", accentHi: "#ffd166" },
  },
];
