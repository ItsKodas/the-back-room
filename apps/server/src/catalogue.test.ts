import { COMING } from "@backroom/core";
import { BLACKJACK } from "@backroom/game-blackjack";
import { DEATH_ROLL } from "@backroom/game-death-roll";
import { GREED } from "@backroom/game-greed";
import { POKER } from "@backroom/game-poker";
import { ROULETTE } from "@backroom/game-roulette";
import { SLOTS } from "@backroom/game-slots";
import { TWO_UP } from "@backroom/game-two-up";
import { describe, expect, it } from "vitest";

/**
 * The sign on the door, against the door.
 *
 * Every game starts as an entry in COMING — a name and a colour, with nothing
 * behind it — and the catalogue puts those in *after* the real listings, so a
 * placeholder left behind quietly overwrites the game it was standing in for.
 * The game then lists itself as not open and cannot be opened at all, while
 * every test passes: the listing is right, the adapter is registered, and the
 * only thing wrong is which of two objects with the same id won.
 *
 * Which is exactly what happened to roulette, and would have shipped.
 */
const BUILT = [GREED, BLACKJACK, SLOTS, POKER, ROULETTE, DEATH_ROLL, TWO_UP];

describe("the room's catalogue", () => {
  it("has no coming-soon sign left on a game that is built", () => {
    const coming = new Set(COMING.map((game) => game.id));
    const shadowed = BUILT.filter((game) => coming.has(game.id)).map((game) => game.id);
    expect(shadowed).toEqual([]);
  });

  it("lists every built game as open", () => {
    // A built game that lists itself shut is a door nobody can go through, and
    // nothing else in the suite would notice.
    for (const game of BUILT) {
      expect(game.open, game.id).toBe(true);
    }
  });

  it("names every game once", () => {
    const ids = [...BUILT, ...COMING].map((game) => game.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
