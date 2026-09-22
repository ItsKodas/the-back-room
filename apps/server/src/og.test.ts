import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameListing } from "@backroom/core";
import { COMING } from "@backroom/core";
import { BLACKJACK } from "@backroom/game-blackjack";
import { CRAPS } from "@backroom/game-craps";
import { GREED } from "@backroom/game-greed";
import { POKER } from "@backroom/game-poker";
import { POCKETS, ROULETTE } from "@backroom/game-roulette";
import { SLOTS } from "@backroom/game-slots";
import { TIPS } from "@backroom/game-tips";
import { describe, expect, it } from "vitest";
import type { CardSpec } from "./og.js";
import { Avatars, Cards, cardSvg, fit, Kept, MOTIFS } from "./og.js";

const FONTS = join(dirname(fileURLToPath(import.meta.url)), "../assets/fonts");

const table: CardSpec = {
  game: {
    id: "blackjack",
    name: "Blackjack",
    theme: { wall: "#0b1712", felt: "#17402e", accent: "#2e7bff", accentHi: "#7ba9ff" },
  },
  host: "Ada",
  code: "6PMKG",
  players: [null, null, null],
  maxSeats: 6,
  note: "Open, pull up a chair",
};

describe("the card a link unfurls into", () => {
  it("does not let a name become markup", () => {
    /*
     * The same boundary the head has, in a second document. A name reaches
     * this one too, and an SVG that a player can close a tag in is an SVG they
     * can put anything into.
     */
    const svg = cardSvg({ ...table, host: '</text><script>alert(1)</script>' });

    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("</text><");
  });

  it("draws one chip per seat, and fills the ones taken", () => {
    const svg = cardSvg(table);
    // Gold is money and money is a seat sold; the empty ones are the dark ring.
    const gold = svg.match(/#e0b048/g) ?? [];
    const spare = svg.match(/#39414d/g) ?? [];

    // Two marks per chip: the rim arcs share one stroke, the inlay takes one.
    expect(spare).toHaveLength(6);
    expect(svg).toContain("3 of 6 seats");
    expect(gold.length).toBeGreaterThan(0);
  });

  it("says nothing about seats on a banner for a whole game", () => {
    // Six of six seats is a fact about a table. A game does not have any.
    const svg = cardSvg({ ...table, host: null, code: null });

    expect(svg).not.toContain("of 6 seats");
    expect(svg).not.toContain("6PMKG");
  });

  it("cuts a name that would run off the card", () => {
    const svg = cardSvg({ ...table, host: "Bartholomew".repeat(12) });

    expect(svg).toContain("…");
    // And what is left of it still ends inside its own element.
    expect(svg).toMatch(/…<\/text>/);
  });

  it("lights the sign from one set of words rather than five", () => {
    /*
     * Not a style note. The rasterizer shapes and outlines every `<text>` it
     * is handed and reads a font file for each one, which is most of what it
     * costs to draw a card — and the glow used to be five stacked copies of
     * the same two words, so the sign alone was paying that five times over
     * for a picture feMerge makes from one.
     */
    const svg = cardSvg(table);

    expect((svg.match(/Back Room/g) ?? []).length).toBe(1);
    // The same wash, stacked where stacking is free.
    expect((svg.match(/<feMergeNode/g) ?? []).length).toBe(5);
    expect(svg).toContain('flood-color="#2e7bff"');
  });

  it("gives each game its own furniture", () => {
    // The picture should say which game before anybody reads a word of it.
    expect(cardSvg(table)).toContain("IBM Plex Sans");
    const greed = {
      id: "greed",
      name: "Greed",
      theme: { wall: "#241811", felt: "#16241c", accent: "#c08a2e", accentHi: "#e8c168" },
    };
    expect(cardSvg({ ...table, game: greed })).toContain('rx="20"');
    expect(cardSvg({ ...table, game: null, code: null })).not.toContain("rx=\"20\"");
  });
});

/*
 * The picture every game unfurls into.
 *
 * A card falls back to the house's own chip when a game has no furniture of
 * its own, which is right for a name on a door and wrong for a game somebody
 * can sit down at: a link to the wheel that unfurls into a chip is a link that
 * says "a casino" where it should be saying which game. Nothing failed when
 * four of the six were doing exactly that — a card still rendered, and still
 * had the right words on it.
 */
const DEALT: readonly GameListing[] = [GREED, BLACKJACK, SLOTS, POKER, ROULETTE, TIPS, CRAPS];

/** One card for a whole game, which is the shape a link to /roulette unfurls into. */
const banner = (game: GameListing): string =>
  cardSvg({
    game: { id: game.id, name: game.name, theme: game.theme, mark: game.mark },
    host: null,
    code: null,
    players: [],
    maxSeats: game.maxSeats,
    note: game.blurb,
  });

describe("the furniture on a game's card", () => {
  it("gives every game the room deals something of its own", () => {
    for (const game of DEALT) {
      expect(Object.keys(MOTIFS), game.id).toContain(game.id);
    }
  });

  it("draws a different thing for each of them", () => {
    /*
     * The other half of the check above, and the one that catches the lazy
     * version of it: a motif added by copying its neighbour and never edited
     * has an entry, passes, and puts blackjack's cards on the poker card.
     */
    const drawn = DEALT.map((game) => MOTIFS[game.id]?.() ?? "");
    expect(new Set(drawn).size).toBe(DEALT.length);
  });

  it("puts that furniture on the card itself, not just in the record", () => {
    // The record is only worth having if `cardSvg` reaches for it.
    for (const game of DEALT) {
      const own = MOTIFS[game.id]?.() ?? "";
      expect(own.length, game.id).toBeGreaterThan(0);
      expect(banner(game), game.id).toContain(own);
    }
  });

  it("cuts the wheel from the order the rules lay the rim out in", () => {
    /*
     * Borrowed rather than copied, the same as the felt's wheel and the tile's.
     * A wheel drawn in counting order stops alternating colours half way round
     * — a picture that lies about the game it is advertising.
     */
    const wheel = MOTIFS["roulette"]?.() ?? "";
    expect((wheel.match(/<path /g) ?? []).length).toBe(POCKETS);
    // And the zero, which is the one pocket belonging to neither colour.
    expect(wheel).toContain("#17663f");
  });

  it("gives the machine as many reels as it has", () => {
    // Five, because the machine has five. A card advertising three is a card
    // advertising a different game.
    const machine = MOTIFS["slots"]?.() ?? "";
    expect((machine.match(/clip-path="url\(#reel/g) ?? []).length).toBe(5);
  });

  it("does not put a jackpot on the poster", () => {
    /*
     * Five of the same thing across the middle is a win on a banner for a
     * machine nobody has played. Counted by kind rather than by strip: the
     * point is that the window is showing a mixture at all.
     */
    const machine = MOTIFS["slots"]?.() ?? "";
    const kinds = [/font-family="Bevan"/, /fill="#5fc9e8"/, /fill="#e8ecf3"/].filter((kind) =>
      kind.test(machine),
    );
    expect(kinds).toHaveLength(3);
  });

  it("still draws a card for a game listed before it exists", () => {
    /*
     * The fallback is deliberate rather than an oversight. A game with no rules
     * yet has no furniture to draw, and the house chip is the honest picture of
     * a name on a door — so this pins that a coming-soon card renders, and that
     * it is not quietly claiming to be one of the games above.
     */
    const soon = COMING[0] as GameListing;
    expect(Object.keys(MOTIFS)).not.toContain(soon.id);
    const card = banner(soon);
    // The house chip, drawn large, which is what "no furniture yet" looks like.
    expect(card).toContain('r="122"');
    for (const game of DEALT) {
      expect(card, game.id).not.toContain(MOTIFS[game.id]?.() ?? "never");
    }
  });
});

describe("fitting a line", () => {
  it("leaves a line that fits exactly as it was", () => {
    expect(fit("Ada", 38, 760)).toBe("Ada");
  });

  it("ends a cut line with one ellipsis and no trailing space", () => {
    const cut = fit("a ".repeat(200), 38, 200);

    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toContain(" …");
  });
});

describe("keeping a few of something", () => {
  /*
   * The bound the two caches share, asked about directly. It used to be
   * proved through `Cards`, which meant a rasterized card per entry — half a
   * second of native rendering on an idle machine and several times that on a
   * busy one, against a five-second budget. The property is a Map's, so it is
   * tested where it lives and answers instantly.
   */
  it("holds everything up to the number it was given room for", () => {
    const kept = new Kept<string>(4);
    for (const key of ["a", "b", "c", "d"]) {
      kept.set(key, key);
    }

    expect(["a", "b", "c", "d"].map((key) => kept.get(key))).toEqual(["a", "b", "c", "d"]);
  });

  it("pushes out the one that went in first", () => {
    const kept = new Kept<string>(3);
    for (const key of ["a", "b", "c", "d"]) {
      kept.set(key, key);
    }

    expect(kept.get("a")).toBeUndefined();
    expect(["b", "c", "d"].map((key) => kept.get(key))).toEqual(["b", "c", "d"]);
  });

  it("does not let a read keep something's place", () => {
    // Oldest out rather than least recently used, on purpose: asking for `a`
    // is not what saves it.
    const kept = new Kept<string>(2);
    kept.set("a", "one");
    kept.set("b", "two");
    expect(kept.get("a")).toBe("one");

    kept.set("c", "three");

    expect(kept.get("a")).toBeUndefined();
  });

  it("does not drop a stranger to overwrite something it already holds", () => {
    const kept = new Kept<string>(2);
    kept.set("a", "one");
    kept.set("b", "two");

    kept.set("b", "again");

    // Writing `b` a second time takes `b`'s place, not the room's last seat.
    // Neither caller here writes a key it already holds, but a bound that
    // quietly shrinks under a plain overwrite is a trap for the one that does.
    expect(kept.get("a")).toBe("one");
    expect(kept.get("b")).toBe("again");
  });
});

/*
 * The only tests in here that go through the rasterizer, and they are budgeted
 * for it. Nearly all of a card's time is resvg turning `<text>` into outlines:
 * it reads a font file for every text element rather than once per document,
 * so a card costs about ten file opens a line of type — tens of milliseconds
 * of native, event-loop-blocking work on an idle machine, and several times
 * that when the machine is cold, busy with the rest of the suite, or scanning
 * every read. Under the five-second default that vitest gives a unit test,
 * drawing a handful of cards was close enough to the ceiling to go over it
 * perhaps one run in four. Nothing here is asserted any less firmly; the clock
 * just matches the work.
 */
describe("drawing it for real", { timeout: 30_000 }, () => {
  it("renders a PNG with the fonts that ship beside it", () => {
    /*
     * The one test that goes all the way through the rasterizer. It is here
     * because the failure it catches is a missing font file, and that failure
     * is invisible in the SVG — the card renders, just in nothing anybody
     * chose, or not at all.
     */
    const png = new Cards(FONTS).png(table);

    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    // A card with type on it is not a few hundred bytes of flat colour.
    expect(png.byteLength).toBeGreaterThan(10_000);
  });

  it("draws the same card once", () => {
    const cards = new Cards(FONTS);

    // The same buffer, not merely an equal one: a link in a busy channel is
    // fetched by every client that renders the embed.
    expect(cards.png(table)).toBe(cards.png(table));
    expect(cards.png({ ...table, players: [null, null, null, null] })).not.toBe(cards.png(table));
  });

  it("does not grow without limit", () => {
    // Room for one, so the bound is proved with three drawn cards rather than
    // seven. What eviction does in general is settled above, where asking
    // costs nothing.
    const cards = new Cards(FONTS, 1);
    const first = cards.png(table);
    cards.png({ ...table, players: [null, null] });

    // Pushed out by the one after it, and drawn again rather than kept.
    expect(cards.png(table)).not.toBe(first);
  });
});

describe("the faces at a table", () => {
  it("draws a seat as somebody's picture when there is one", () => {
    const picture = "data:image/png;base64,iVBORw0KGgo=";
    const svg = cardSvg({ ...table, players: [picture, null] });

    expect(svg).toContain(`href="${picture}"`);
    // Cut to a circle rather than laid over one: a square face in a row of
    // round chips is the one thing that would look like a mistake.
    expect(svg).toContain("clip-path");
    // The seat that has nobody's picture is still a chip.
    expect(svg).toContain("#e0b048");
  });

  it("falls back to a chip for a seat with no picture", () => {
    const svg = cardSvg({ ...table, players: [null, null] });

    expect(svg).not.toContain("<image");
  });

  it("counts the seats that are taken, not the pictures that arrived", () => {
    const svg = cardSvg({ ...table, players: [null, null, null] });

    expect(svg).toContain("3 of 6 seats");
  });
});

describe("fetching a face", () => {
  it("will not fetch from anywhere but the picture host", async () => {
    /*
     * The address comes out of this server's own store, which is the shape of
     * every server-side request forgery there has been. Anything that is not
     * Discord's CDN is not cleaned up or followed — it is not fetched.
     */
    const avatars = new Avatars();
    let asked = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => {
      asked += 1;
      return real(...args);
    };
    try {
      for (const url of [
        "http://localhost:3001/api/room",
        "https://evil.example/x.png",
        "https://cdn.discordapp.com.evil.example/x.png",
        "file:///etc/passwd",
        null,
      ]) {
        expect(await avatars.data(url)).toBeNull();
      }
    } finally {
      globalThis.fetch = real;
    }
    expect(asked).toBe(0);
  });

  it("fetches one picture once when two seats are wearing it", async () => {
    /*
     * Two seats at a table share a face more often than not — the same
     * person's link unfurled twice, a table they are sitting at in two
     * clients. The cache only helps if the second one waits on the first
     * request rather than starting a second: a cache written after the answer
     * lands is empty for exactly as long as the burst it exists for.
     */
    const avatars = new Avatars();
    const url = "https://cdn.discordapp.com/avatars/1/abc.png";
    let asked = 0;
    let land: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      land = resolve;
    });
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      asked += 1;
      await held;
      return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;
    try {
      const both = avatars.all([url, url]);
      land();
      const [one, two] = await both;
      expect(one).not.toBeNull();
      expect(two).toBe(one);
    } finally {
      globalThis.fetch = real;
    }
    expect(asked).toBe(1);
  });

  it("remembers a picture that did not come, rather than asking for it again", async () => {
    const avatars = new Avatars();
    const url = "https://cdn.discordapp.com/avatars/2/gone.png";
    let asked = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      asked += 1;
      throw new Error("refused");
    }) as typeof fetch;
    try {
      expect(await avatars.data(url)).toBeNull();
      expect(await avatars.data(url)).toBeNull();
    } finally {
      globalThis.fetch = real;
    }
    expect(asked).toBe(1);
  });
});
