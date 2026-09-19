import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * How a room's colours out-rank the building's.
 *
 * This is a specificity rule, and specificity failures are silent: the page
 * renders, nothing errors, and a whole game is simply painted in somebody
 * else's colours. Greed shipped lit blue for exactly that reason — a bare
 * `[data-game="greed"]` ties with the base `:root` tokens on the one element
 * they both match, and then loses on whichever stylesheet the bundler put
 * last.
 *
 * So both selectors are required, and they say different things:
 *
 *   :root[data-game="x"]   the document wearing this room, ranked above :root
 *   [data-game="x"]        any element inside a page that is a corner of it
 *
 * Read off the files rather than out of a browser, because there is no cascade
 * in a test runner to ask — and this is a question about what is written, not
 * about what a particular page computed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const GAMES = ["greed", "blackjack", "slots", "plinko"] as const;

function theme(game: string): string {
  return readFileSync(join(here, `../../../games/${game}/src/theme.css`), "utf8");
}

describe("a game's own colours", () => {
  for (const game of GAMES) {
    it(`${game} out-ranks the building on the document`, () => {
      // Without the :root, the base tokens win and the room is the wrong colour.
      expect(theme(game)).toContain(`:root[data-game="${game}"]`);
    });

    it(`${game} can also dress one corner of a page`, () => {
      // The tiles on the front page are a window into each room, and nothing
      // on <html> competes for them.
      expect(theme(game)).toMatch(new RegExp(`^\\[data-game="${game}"\\]`, "m"));
    });

    it(`${game} paints its own room and touches nothing that carries meaning`, () => {
      /*
       * A game owns its materials; the building owns what things mean. Gold is
       * money at every table and a win is a win in every room, so a theme that
       * repainted those would be changing the rules rather than the walls.
       */
      const css = theme(game);
      expect(css).not.toMatch(/^\s*--gr-color-chip\b/m);
      expect(css).not.toMatch(/^\s*--gr-color-good\b/m);
      expect(css).not.toMatch(/^\s*--gr-color-bad\b/m);
    });
  }
});
