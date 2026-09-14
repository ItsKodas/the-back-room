import type { GameListing } from "@backroom/core";
import { BLACKJACK } from "@backroom/game-blackjack";
import { GREED } from "@backroom/game-greed";
import { POKER } from "@backroom/game-poker";
import { ROULETTE } from "@backroom/game-roulette";
import { SLOTS } from "@backroom/game-slots";
import { TIPS } from "@backroom/game-tips";
import { describe, expect, it } from "vitest";
import type { Lookups } from "./meta.js";
import { headTags, inject, jsonLd, pageFor } from "./meta.js";

/** A room with one game and one table in it. */
const room: Lookups = {
  game: (id) =>
    id === "blackjack"
      ? {
          name: "Blackjack",
          blurb: "Beat the dealer to twenty-one.",
          minSeats: 1,
          maxSeats: 6,
          shape: "table" as const,
          open: true,
        }
      : null,
  table: (code) =>
    code === "6PMKG" ? { game: "Blackjack", host: "Ada", seats: 3, maxSeats: 6 } : null,
};

const SITE = "https://back.example";

describe("what an address says about itself", () => {
  it("puts the host and the seats where an unfurler will read them", () => {
    const page = pageFor("/6PMKG", SITE, room);

    expect(page.title).toBe("Ada’s blackjack table · The Back Room");
    expect(page.description).toContain("3 of 6 seats");
    expect(page.description).toContain("6PMKG");
    expect(page.image).toBe("https://back.example/og/table/6PMKG.png");
  });

  it("finds the same table down either address", () => {
    /*
     * A code is an address on its own, and the link people paste is whichever
     * one they happened to have open. Both have to unfurl into the same table.
     */
    const bare = pageFor("/6PMKG", SITE, room);
    const under = pageFor("/blackjack/6pmkg", SITE, room);

    expect(under.title).toBe(bare.title);
    expect(under.image).toBe(bare.image);
  });

  it("keeps a table out of search results, and the game it is played at in", () => {
    // A table is a room that will not exist next week; the game outlives it.
    // Asserted on the tag rather than the flag, because the tag is the thing a
    // crawler actually obeys.
    expect(headTags(pageFor("/6PMKG", SITE, room))).toContain('content="noindex, follow"');
    expect(headTags(pageFor("/blackjack", SITE, room))).toContain('content="index, follow"');
  });

  it("describes a game from its own blurb rather than a second one", () => {
    const page = pageFor("/blackjack", SITE, room);

    expect(page.title).toBe("Blackjack · The Back Room");
    expect(page.description).toContain("Beat the dealer to twenty-one.");
    expect(page.image).toBe("https://back.example/og/blackjack.png");
  });

  it("sends every game to a card of its own rather than to the room's", () => {
    /*
     * The other end of the picture. `og.ts` draws each game its own furniture,
     * and that is worth nothing if the head points every one of them at the
     * same file — a link to the wheel that unfurls into the house banner is a
     * link that says "a casino" where it should be saying which game.
     */
    const dealt: readonly GameListing[] = [GREED, BLACKJACK, SLOTS, POKER, ROULETTE, TIPS];
    const all: Lookups = {
      game: (id) => {
        const found = dealt.find((game) => game.id === id);
        return found === undefined
          ? null
          : {
              name: found.name,
              blurb: found.blurb,
              minSeats: found.minSeats,
              maxSeats: found.maxSeats,
              shape: found.shape,
              open: found.open,
            };
      },
      table: () => null,
    };

    const images = dealt.map((game) => pageFor(`/${game.id}`, SITE, all).image);
    for (const [at, game] of dealt.entries()) {
      expect(images[at], game.id).toBe(`${SITE}/og/${game.id}.png`);
    }
    expect(new Set(images).size).toBe(dealt.length);
    expect(images).not.toContain(`${SITE}/og/site.png`);
  });

  it("falls back to the room when the code is not a table any more", () => {
    // The link outlives the table, and a dead code is a link somebody is
    // following right now.
    const page = pageFor("/ZZZZZ", SITE, room);

    expect(page.title).toBe("The Back Room");
    expect(page.image).toBe("https://back.example/og/site.png");
    expect(page.noindex).toBe(true);
  });

  it("keeps a game that is only a sign on a door out of search results", () => {
    /*
     * The catalogue lists what is coming as well as what is open, and this
     * head is written from the catalogue — so /craps was handed a title, a
     * description and `index, follow`, while the client has no route for it
     * and answers with the bare-code fallback instead. An invitation to index
     * a result that leads nowhere, once per unbuilt game.
     */
    const listed: Lookups = {
      game: (id) =>
        id === "craps"
          ? {
              name: "Craps",
              blurb: "Two dice, a point to make, and a rail of people shouting.",
              minSeats: 1,
              maxSeats: 8,
              shape: "table",
              open: false,
            }
          : null,
      table: () => null,
    };

    // Asserted on the tag rather than the flag: the tag is what a crawler obeys.
    expect(headTags(pageFor("/craps", SITE, listed))).toContain('content="noindex, follow"');
  });

  it("keeps somebody's own pages out of search", () => {
    for (const path of ["/me", "/admin", "/style"]) {
      expect(pageFor(path, SITE, room).noindex).toBe(true);
    }
  });

  it("gives the door a canonical address without a trailing slash", () => {
    expect(pageFor("/", SITE, room).url).toBe("https://back.example");
    expect(pageFor("/blackjack", SITE, room).url).toBe("https://back.example/blackjack");
  });
});

describe("the head that goes out", () => {
  it("does not let a name become markup", () => {
    /*
     * A display name is whatever somebody typed, and it lands in an attribute
     * in a document served to everybody who follows the link. This is the only
     * thing standing between those two facts.
     */
    const nasty: Lookups = {
      game: () => null,
      table: () => ({
        game: "Blackjack",
        host: '"><script>alert(1)</script>',
        seats: 1,
        maxSeats: 6,
      }),
    };
    const html = headTags(pageFor("/6PMKG", SITE, nasty));

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    // And the attribute it sits in is still closed by the quote we put there.
    expect(html).toContain("&quot;&gt;");
  });

  it("says the same thing to both kinds of unfurler", () => {
    const html = headTags(pageFor("/blackjack", SITE, room));

    expect(html).toContain('<meta property="og:title" content="Blackjack · The Back Room" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<link rel="canonical" href="https://back.example/blackjack" />');
  });
});

describe("writing the head into the page", () => {
  const shell = "<head>\n    <!--meta-->\n    <title>Old</title>\n    <!--/meta-->\n  </head>";

  it("replaces the defaults rather than adding to them", () => {
    const out = inject(shell, pageFor("/blackjack", SITE, room));

    expect(out).toContain("<title>Blackjack · The Back Room</title>");
    // The stale one is gone, not merely outnumbered.
    expect(out).not.toContain("<title>Old</title>");
    expect(out.match(/<title>/g)).toHaveLength(1);
  });

  it("leaves a page alone when there is nowhere to write", () => {
    // A build served by something simpler still has the defaults in it, which
    // is the whole reason those defaults are written down.
    const plain = "<head><title>Old</title></head>";

    expect(inject(plain, pageFor("/", SITE, room))).toBe(plain);
  });
});

describe("what a crawler is told in so many words", () => {
  /**
   * The head says what the page is called. This says what it *is* — and the
   * one thing this building most needs a search engine not to guess at is
   * whether it takes money, because everything here looks like a game that
   * would.
   */

  /** The graph a page carries, parsed, or null when it carries none. */
  const graph = (page: ReturnType<typeof pageFor>): Record<string, unknown>[] => {
    const html = jsonLd(page);
    const body = /<script type="application\/ld\+json">([\s\S]*)<\/script>/.exec(html)?.[1];
    if (body === undefined) {
      return [];
    }
    const parsed = JSON.parse(body) as { "@graph": Record<string, unknown>[] };
    return parsed["@graph"];
  };

  /** The one node of a given type, or undefined. */
  const node = (
    page: ReturnType<typeof pageFor>,
    type: string,
  ): Record<string, unknown> | undefined => graph(page).find((one) => one["@type"] === type);

  it("names the room and the site at the front door, and ties them together", () => {
    const front = pageFor("/", SITE, room);
    const org = node(front, "Organization");
    const site = node(front, "WebSite");

    expect(org?.["name"]).toBe("The Back Room");
    expect(org?.["url"]).toBe(SITE);
    // The site points at the organisation by id rather than repeating it,
    // which is the whole reason both live in one graph.
    const publisher = site?.["publisher"] as Record<string, unknown> | undefined;
    expect(publisher?.["@id"]).toBe(org?.["@id"]);
    expect(publisher?.["@id"]).toBe(`${SITE}/#room`);
  });

  it("says a game is free to play, in the field made for saying it", () => {
    /*
     * The load-bearing assertion in this file. Every game here is played for
     * chips that cannot be bought, and a crawler reading a page full of
     * blackjack and roulette will otherwise reach its own conclusion about
     * what kind of site this is.
     */
    const game = node(pageFor("/blackjack", SITE, room), "VideoGame");

    expect(game?.["isAccessibleForFree"]).toBe(true);
    expect(game?.["name"]).toBe("Blackjack");
    expect(game?.["url"]).toBe("https://back.example/blackjack");
  });

  it("counts the players from the seats rather than from the shape's name", () => {
    const game = node(pageFor("/blackjack", SITE, room), "VideoGame");
    const players = game?.["numberOfPlayers"] as Record<string, unknown>;

    expect(players["minValue"]).toBe(1);
    expect(players["maxValue"]).toBe(6);
  });

  it("tells a machine apart from a table", () => {
    const machine: Lookups = {
      game: (id) =>
        id === "slots"
          ? {
              name: "Slots",
              blurb: "Five reels, nine lines, one climbing bank.",
              minSeats: 1,
              maxSeats: 1,
              shape: "machine",
              open: true,
            }
          : null,
      table: () => null,
    };

    expect(node(pageFor("/slots", SITE, machine), "VideoGame")?.["playMode"]).toBe("SinglePlayer");
    expect(node(pageFor("/blackjack", SITE, room), "VideoGame")?.["playMode"]).toBe("MultiPlayer");
  });

  it("walks back to the front door", () => {
    const crumbs = node(pageFor("/blackjack", SITE, room), "BreadcrumbList");
    const steps = crumbs?.["itemListElement"] as Record<string, unknown>[];

    expect(steps).toHaveLength(2);
    expect(steps[0]?.["item"]).toBe(SITE);
    expect(steps[1]?.["item"]).toBe("https://back.example/blackjack");
  });

  it("says nothing at all about a page that asked not to be indexed", () => {
    /*
     * Structured data is a claim worth making about a page a crawler should
     * keep. On one it has been asked to drop it is weight and a contradiction
     * — a table page describing itself as a lasting thing while its own robots
     * tag says it will not be here next week.
     */
    for (const path of ["/6PMKG", "/me", "/admin"]) {
      expect(jsonLd(pageFor(path, SITE, room)), path).toBe("");
    }
  });

  it("cannot be climbed out of into the page", () => {
    /*
     * JSON escaping is not HTML escaping: "</script>" inside a JSON string is
     * still a perfectly valid string, and still ends the script element it is
     * sitting in. Every other tag in this file goes through `attr`; this one
     * cannot, because it is a document rather than an attribute.
     */
    const nasty: Lookups = {
      game: () => ({
        name: "</script><script>alert(1)</script>",
        blurb: "Nothing to see.",
        minSeats: 1,
        maxSeats: 4,
        shape: "table",
        open: true,
      }),
      table: () => null,
    };
    const html = jsonLd(pageFor("/anything", SITE, nasty));

    expect(html).not.toContain("</script><script>");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    // And it is still the name it was, once something parses it back.
    const parsed = node(pageFor("/anything", SITE, nasty), "VideoGame");
    expect(parsed?.["name"]).toBe("</script><script>alert(1)</script>");
  });

  it("goes into the page along with the head", () => {
    const shell = `<head>
    <!--meta-->
    <title>Old</title>
    <!--/meta-->
  </head>`;
    const out = inject(shell, pageFor("/blackjack", SITE, room));

    expect(out).toContain('<script type="application/ld+json">');
    expect(out).toContain("<title>Blackjack · The Back Room</title>");
    // Inside the markers, so the next address served rewrites it rather than
    // stacking a second graph on top.
    expect(out.indexOf("ld+json")).toBeLessThan(out.indexOf("<!--/meta-->"));
  });
});
