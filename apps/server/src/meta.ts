/**
 * What a page says about itself before anybody has run any of it.
 *
 * The client is a single page app, so every address it answers is the same
 * file — which is fine for a browser and useless for everything else. A search
 * engine and a link unfurler both fetch the HTML and read the head, and
 * neither of them runs the script that would have filled it in. So the head is
 * written here, per address, on the way out.
 */

/** Everything one address needs to say about itself. */
export interface Page {
  /** What it is called in a tab, a search result and a link card. */
  title: string;
  /** One sentence, in a player's language rather than the rules'. */
  description: string;
  /** The card an unfurler shows. Absolute: a relative one reaches nobody. */
  image: string;
  /** Absolute, and without the query: the address this page really lives at. */
  url: string;
  /**
   * The origin this is being served from.
   *
   * Carried separately from {@link url} because the structured data below
   * names the building as well as the room: the same organisation node has to
   * come out with the same id on every page, and only the front door's url
   * happens to be the site's.
   */
  site: string;
  /**
   * The game this page is about, when it is about one rather than about a
   * table of one. What the head says in prose, the graph says in fields.
   */
  game?: (GameFacts & { id: string }) | undefined;
  /**
   * Kept out of search results.
   *
   * For the pages that are somebody's rather than the room's — an account, the
   * admin desk — and for a table, which is a room that will not exist next
   * week and should not be a result anybody lands on.
   */
  noindex?: boolean;
}

export const SITE_NAME = "The Back Room";

/** Into an HTML attribute, where a player's name is otherwise markup. */
function attr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The head, as tags.
 *
 * Open Graph and the Twitter pair both, because the clients that read one and
 * not the other are exactly the ones a table link gets pasted into.
 */
export function headTags(page: Page): string {
  const title = attr(page.title);
  const description = attr(page.description);
  const image = attr(page.image);
  const url = attr(page.url);

  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    page.noindex === true
      ? `<meta name="robots" content="noindex, follow" />`
      : `<meta name="robots" content="index, follow" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    // Told rather than left to be discovered: a client that has to fetch the
    // image to find out how big it is often decides not to bother.
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${title}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="theme-color" content="#0d1015" />`,
  ].join("\n    ");
}

/**
 * Into a <script> element, where a JSON string is otherwise still markup.
 *
 * `JSON.stringify` escapes what JSON needs escaped, and "</script>" needs
 * nothing: it is a perfectly ordinary string that happens to close the element
 * it is sitting in. Every other tag in this file goes through {@link attr},
 * which cannot help here — this is a document, not an attribute. Escaping the
 * one character that can start a tag is enough, and a JSON reader turns
 * `\u003c` back into exactly the character it replaced.
 */
function forScript(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

/**
 * What the page is, rather than what it is called.
 *
 * The head above is read by unfurlers and by people; this is read by search
 * engines, and it exists mostly to answer one question before anybody guesses
 * at it. A page full of blackjack, roulette and slots looks exactly like a
 * site that takes money, and the field that says otherwise —
 * `isAccessibleForFree` — is worth more here than every other line put
 * together.
 *
 * Nothing at all for a page that has asked not to be indexed: structured data
 * is a claim made about a page worth keeping, and a table describing itself as
 * a lasting thing contradicts its own robots tag.
 */
export function jsonLd(page: Page): string {
  if (page.noindex === true) {
    return "";
  }

  const roomId = `${page.site}/#room`;
  const graph: unknown[] = [
    {
      "@type": "Organization",
      "@id": roomId,
      name: SITE_NAME,
      url: page.site,
      logo: `${page.site}/favicon.svg`,
      description: SITE_LINE,
    },
  ];

  const game = page.game;
  if (game === undefined) {
    graph.push({
      "@type": "WebSite",
      "@id": `${page.site}/#site`,
      name: SITE_NAME,
      url: page.site,
      description: SITE_LINE,
      inLanguage: "en",
      publisher: { "@id": roomId },
    });
  } else {
    graph.push({
      "@type": "VideoGame",
      "@id": `${page.url}#game`,
      name: game.name,
      description: page.description,
      url: page.url,
      image: page.image,
      inLanguage: "en",
      // The load-bearing line. Chips come from the daily and from nowhere
      // else, and this is the only place that fact is written down in a form
      // something other than a person can read.
      isAccessibleForFree: true,
      // From the shape rather than from the seat count, because the seat count
      // is a table's answer to a different question. A machine and the bar are
      // played alone; a table and a party are not.
      playMode: game.shape === "machine" || game.shape === "bar" ? "SinglePlayer" : "MultiPlayer",
      numberOfPlayers: {
        "@type": "QuantitativeValue",
        minValue: game.minSeats,
        maxValue: game.maxSeats,
      },
      applicationCategory: "GameApplication",
      gamePlatform: "Web browser",
      operatingSystem: "Any",
      publisher: { "@id": roomId },
    });
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: page.site },
        { "@type": "ListItem", position: 2, name: game.name, item: page.url },
      ],
    });
  }

  return `<script type="application/ld+json">
${forScript({ "@context": "https://schema.org", "@graph": graph })}
</script>`;
}

/** Where the written head goes, and what the client ships in its place. */
export const META_OPEN = "<!--meta-->";
export const META_CLOSE = "<!--/meta-->";

/**
 * The page, with its own head in it.
 *
 * The markers are in the client's index.html around a set of defaults, which
 * is what makes this safe to get wrong: a build served by anything but this
 * server still has a title and a card, just not one about the address that was
 * asked for.
 */
export function inject(html: string, page: Page): string {
  const open = html.indexOf(META_OPEN);
  const close = html.indexOf(META_CLOSE);
  if (open === -1 || close === -1 || close < open) {
    return html;
  }
  // The graph goes inside the markers with the head, so the next address
  // served rewrites it rather than stacking a second one on top of it.
  const written = [headTags(page), jsonLd(page)].filter((part) => part !== "").join("\n    ");
  return `${html.slice(0, open + META_OPEN.length)}
    ${written}
    ${html.slice(close)}`;
}

/** What one game is, as far as its page needs to know. */
export interface GameFacts {
  name: string;
  blurb: string;
  minSeats: number;
  maxSeats: number;
  /** How it is played, which is what decides whether it seats a crowd. */
  shape: "table" | "machine" | "party" | "bar";
  /**
   * False while it is being built.
   *
   * The catalogue lists what is coming as well as what is open, and this head
   * is written from the catalogue — so a game that is only a sign on a door
   * would otherwise get a title, a description and an invitation to index an
   * address the client has no page for.
   */
  open: boolean;
}

/** What one table is, as far as its page needs to know. */
export interface TableFacts {
  game: string;
  host: string | null;
  seats: number;
  maxSeats: number;
}

/** The room, asked only the two questions a page has for it. */
export interface Lookups {
  game(id: string): GameFacts | null;
  table(code: string): TableFacts | null;
}

const SITE_LINE =
  "A back room for cards and dice, played for chips and nothing else. Blackjack, Greed, and a fresh handful every day — no real money anywhere near it.";

/**
 * What one address says about itself.
 *
 * Every address is the same file as far as the browser is concerned, so this
 * is the only place the difference between them is ever written down for
 * something that will not run the app.
 *
 * Pure, with the room passed in, so the interesting part — which of these
 * shapes an address turns out to be — can be asked directly.
 */
export function pageFor(path: string, site: string, look: Lookups): Page {
  const url = `${site}${path === "/" ? "" : path}`;
  const parts = path.split("/").filter((part) => part !== "");
  const first = (parts[0] ?? "").toLowerCase();

  if (parts.length === 0) {
    return {
      title: SITE_NAME,
      description: SITE_LINE,
      image: `${site}/og/site.png`,
      url,
      site,
    };
  }

  // Somebody's own pages rather than the room's. Not secret, just not results.
  const own: Record<string, string> = { me: "Your account", admin: "The desk", style: "Style" };
  const mine = own[first];
  if (mine !== undefined) {
    return {
      title: `${mine} · ${SITE_NAME}`,
      description: SITE_NAME,
      image: `${site}/og/site.png`,
      url,
      site,
      noindex: true,
    };
  }

  /*
   * A code is an address on its own, which is the whole point of a code: the
   * second segment of /blackjack/6PMKG and the first of /6PMKG name the same
   * table, and a link to either should unfurl into the same picture.
   */
  const game = look.game(first);
  const code = (game === null ? parts[0] : parts[1])?.toUpperCase() ?? null;
  const table = code === null ? null : look.table(code);

  if (table !== null && code !== null) {
    return {
      title:
        table.host === null
          ? `A ${table.game.toLowerCase()} · ${SITE_NAME}`
          : `${table.host}’s ${table.game.toLowerCase()} table · ${SITE_NAME}`,
      description: `${table.seats} of ${table.maxSeats} seats taken. Follow the link, or use the code ${code}.`,
      image: `${site}/og/table/${encodeURIComponent(code)}.png`,
      url,
      site,
      // A table is a room that will not exist next week. A search result
      // leading to one is a dead end by the time anybody clicks it.
      noindex: true,
    };
  }

  if (game !== null) {
    return {
      title: `${game.name} · ${SITE_NAME}`,
      description: `${game.blurb} Played for chips and nothing else, at up to ${game.maxSeats} to a table.`,
      image: `${site}/og/${first}.png`,
      url,
      site,
      game: { ...game, id: first },
      /*
       * The game's own page is worth indexing; a table of it never is, and
       * neither is a game that has not opened. A listing is in the catalogue
       * from the moment somebody starts building it, and the client has no
       * route for one until it is finished — so an unopened game indexed here
       * is a search result that lands on the bare-code fallback.
       */
      noindex: code !== null || !game.open,
    };
  }

  return {
    title: SITE_NAME,
    description: SITE_LINE,
    image: `${site}/og/site.png`,
    url,
    site,
    noindex: true,
  };
}
