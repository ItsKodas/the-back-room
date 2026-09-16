import { describe, expect, it } from "vitest";
import { Catalogue } from "./catalogue.js";
import { MAX_SEATS } from "./types.js";
import { COMING } from "./coming.js";

/*
 * The games the room advertises but cannot deal yet.
 *
 * A listing with `open: false` is a sign on a door. The thing that makes it a
 * sign rather than a door is the flag, and the thing that makes the flag mean
 * anything is `playable()` — so both are held here, because a coming game that
 * quietly became creatable would be a table with no rules taking real chips.
 */
describe("the games that are coming", () => {
  it("is none of them openable", () => {
    for (const game of COMING) {
      expect(game.open).toBe(false);
    }
  });

  it("keeps them out of what can be sat down at", () => {
    const catalogue = COMING.reduce((all, game) => all.add(game), new Catalogue());
    expect(catalogue.playable()).toEqual([]);
    // But listed, which is the whole point of them.
    expect(catalogue.all().length).toBe(COMING.length);
  });

  it("gives each a name nothing else in the building answers to", () => {
    // The id is a URL segment and a stats key, so a clash would mix two games'
    // records together and route one to the other.
    const ids = COMING.map((game) => game.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("asks for seat counts a room could actually honour", () => {
    for (const game of COMING) {
      expect(game.minSeats).toBeGreaterThanOrEqual(1);
      expect(game.maxSeats).toBeGreaterThanOrEqual(game.minSeats);
      expect(game.maxSeats).toBeLessThanOrEqual(MAX_SEATS);
    }
  });

  it("says what each one is, in a sentence", () => {
    // The card shows the blurb only once the game opens, but writing it now is
    // what stops a game arriving with placeholder text on the shelf.
    for (const game of COMING) {
      expect(game.name.length).toBeGreaterThan(0);
      expect(game.blurb.length).toBeGreaterThan(0);
    }
  });
});

/*
 * The three kinds of thing this building holds.
 *
 * The room groups by shape and draws each group its own way, so a shape it has
 * never heard of is a game that renders nowhere — listed by the server,
 * invisible on the page, and impossible to notice from either end alone.
 */
describe("the shapes a game can be", () => {
  it("gives every coming game one the room knows how to draw", () => {
    const drawn = new Set(["table", "machine", "party", "bar"]);
    for (const game of COMING) {
      expect(drawn.has(game.shape)).toBe(true);
    }
  });

  it("wants a crowd for every party game, not a duel", () => {
    /*
     * A standing rule for whatever `COMING` holds, not a fact about any one
     * entry: a party game is the race between the guessers, and a race needs
     * more than one racer. Vacuously true while `COMING` has none — the rule
     * still binds the next one added.
     */
    const party = COMING.filter((game) => game.shape === "party");
    for (const game of party) {
      expect(game.minSeats).toBeGreaterThanOrEqual(3);
    }
  });
});

