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
  /** Every game that is open, for the links a page makes to them. */
  games?: readonly (GameFacts & { id: string })[];
}

export const SITE_NAME = "The Back Room";

/**
 * The front door's title, which has to say what the room is.
 *
 * The name alone told a search result nothing, and every word here is one the
 * door's own text uses, so the title is a summary of the page rather than a
 * claim about it.
 */
const DOOR_TITLE = `${SITE_NAME}: Blackjack, Poker, Slots and Dice for Chips`;

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
      // The load-bearing line. Chips cannot be bought and never leave as money,
      // and this is the only place that fact is written down in a form
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

/** How the chips work, which every indexed page says, because it is the question. */
const CHIPS = `<h2>How the chips work</h2>
      <p>Chips are free. A new account starts with ten thousand of them, and there is no way to pay for more: nothing here takes money, and nothing here pays out anything but chips.</p>
      <p>A chip you win came from another player. A table playing for chips only deals while at least two real people are sitting at it, and a table that loses its second player pauses rather than carrying on. The games played against the house, such as blackjack, roulette, two-up, craps and the slot machine, each pay from a bank of their own that only players' stakes fill, so a win there still comes from everybody who played before you.</p>
      <p>Bots only ever sit at tables played for fun, where the chips belong to the table and are gone when it closes.</p>`;

type Listed = readonly (GameFacts & { id: string })[];

/**
 * A link to a game by whatever name the sentence calls it, or just the name
 * when that game is not open: prose mentions games the catalogue may not.
 */
function mention(games: Listed, id: string, text: string): string {
  return games.some((game) => game.id === id) ? `<a href="/${attr(id)}">${text}</a>` : text;
}

/**
 * The questions a newcomer actually has, at the front door only.
 *
 * Link text here never repeats a game's name from the list above: two links
 * worded the same way to the same page read as one link said twice.
 */
function questions(games: Listed): string {
  return `<h2>Questions people ask</h2>
      <h3>Is it really free?</h3>
      <p>Yes. There is nothing to buy, no subscription and no advert standing between you and a table. Chips cannot be bought, and they cannot be cashed out either, so a good night here is worth exactly what it felt like and nothing more.</p>
      <h3>What happens when I run out of chips?</h3>
      <p>Head to the ${mention(games, "tips", "jar on the bar")}. It fills slowly while you are away, and tapping it pays what has gathered into your account. It is never going to make anybody rich, but it will always get you back to a table.</p>
      <h3>Can I play when nobody else is around?</h3>
      <p>Two ways. A table played for fun can be filled with bots, which is a good way to learn a game before putting chips on it. For chips, pull the handle on ${mention(games, "slots", "the slot machine")} or sit down at ${mention(games, "blackjack", "a blackjack table")}: both are played against the house, and the house caps every stake so that its bank can always cover the biggest win it could owe you.</p>
      <h3>How do I play with friends?</h3>
      <p>Open a table, say ${mention(games, "poker", "a poker table")} or a round of ${mention(games, "greed", "dice at Greed")}, and send the link. Everyone who follows it lands at the same table, with no invites to accept and nothing to install. If the link gets lost, the short code on the table does the same job.</p>
      <h3>Can I send chips to someone?</h3>
      <p>Yes, once you are signed in. Chips can be sent from your account page to another player, up to twenty-five thousand in any twenty-four hours, and every transfer is written down. It is there for staking a friend back into a game, not for moving a fortune.</p>
      <h3>Can the rules be changed?</h3>
      <p>Whoever opens a table sets it up for everybody sitting at it: how many seats there are, how long bets stay open, and whether the table plays for chips or just for fun. Some games go further. At a table of Greed the host picks the score that wins the game and which of the rarer throws count, so the same six dice can play as a quick round or a long night.</p>
      <h3>Is there a leaderboard?</h3>
      <p>There is, for anybody signed in. <a href="/leaderboard">The leaderboard</a> ranks players by the chips they hold, by how far ahead they are overall, by how much they have staked, and by games played and won, so there is more than one way to be at the top of it.</p>
      <h3>Does it work on a phone?</h3>
      <p>Every game is built to be played with a thumb. Open the site in your phone's browser, and add it to your home screen if you want it to open like an app.</p>`;
}

/** One line per game, linked to its page. */
function gameList(games: readonly (GameFacts & { id: string })[]): string {
  const items = games.map((game) => {
    const seats = game.maxSeats === 1 ? "Played on your own." : `Up to ${game.maxSeats} to a table.`;
    return `<li><a href="/${attr(game.id)}">${attr(game.name)}</a>: ${attr(game.blurb)} ${seats}</li>`;
  });
  return `<ul>
        ${items.join("\n        ")}
      </ul>`;
}

/**
 * What the page says in its body before the app has loaded.
 *
 * #root is empty until the bundle arrives, so a crawler that runs no script
 * found no heading, no words and no links on any page here. This is written
 * inside #root for it instead, and React replaces the lot the moment it
 * mounts. On a slow connection it is also what a person sees in the meantime,
 * which is the room saying what it is rather than a black screen.
 *
 * Nothing for a page that asked not to be indexed: nobody is meant to land on
 * those from a search, and a person following the link is about to be shown
 * the real thing.
 */
export function door(page: Page): string {
  if (page.noindex === true) {
    return "";
  }
  const games = page.games ?? [];

  if (page.game !== undefined) {
    const here = page.game.id;
    const others = games.filter((game) => game.id !== here);
    return `<main class="door">
      <p class="door__back"><a href="/">${SITE_NAME}</a></p>
      <h1>${attr(page.game.name)} at ${SITE_NAME}</h1>
      <p>${attr(page.description)}${page.game.maxSeats === 1 ? "" : " Open a table, send the link to whoever you are playing with, and the table deals itself."}</p>
      ${CHIPS}
      ${others.length === 0 ? "" : `<h2>More games</h2>\n      ${gameList(others)}`}
    </main>`;
  }

  return `<main class="door">
      <h1>${SITE_NAME}: cards and dice for chips</h1>
      <p>Blackjack, poker, slots and dice for chips, played with real people in your browser. The Back Room is a free room for cards and dice: pull up a chair at a table, play a few hands with friends or strangers, and leave whenever you like. There is no real money anywhere near it.</p>
      <h2>The games</h2>
      ${gameList(games)}
      ${CHIPS}
      <h2>How a table works</h2>
      <p>Tables deal themselves. Nobody has to press start: a round comes round on its own clock, and players sit down and leave whenever they like. Whoever opens a table decides its shape, from how many seats it has to how long the betting window stays open and whether it plays for chips or for fun.</p>
      <p>Every table has a short code of its own, so bringing a friend is a matter of sending them the link.</p>
      <h2>Getting in</h2>
      <p>Anybody can sit down at a table played for fun. Tables that play for chips ask you to sign in with <a href="https://discord.com/" rel="noopener">Discord</a> first, so that what you win stays yours. The room works on a phone as well as on a desk, and it can be added to a home screen like an app.</p>
      ${questions(games)}
    </main>`;
}

/** Where the written head goes, and what the client ships in its place. */
export const META_OPEN = "<!--meta-->";
export const META_CLOSE = "<!--/meta-->";
/** Where the written body goes, inside #root. */
export const DOOR_OPEN = "<!--door-->";
export const DOOR_CLOSE = "<!--/door-->";

/** Writes `content` between a pair of markers, or returns null if there are none. */
function between(html: string, open: string, close: string, content: string): string | null {
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return `${html.slice(0, start + open.length)}
    ${content}
    ${html.slice(end)}`;
}

/**
 * The page, with its own head in it.
 *
 * The markers are in the client's index.html around a set of defaults, which
 * is what makes this safe to get wrong: a build served by anything but this
 * server still has a title and a card, just not one about the address that was
 * asked for.
 */
export function inject(html: string, page: Page): string {
  // The graph goes inside the markers with the head, so the next address
  // served rewrites it rather than stacking a second one on top of it.
  const written = [headTags(page), jsonLd(page)].filter((part) => part !== "").join("\n    ");
  const headed = between(html, META_OPEN, META_CLOSE, written);
  if (headed === null) {
    return html;
  }
  return between(headed, DOOR_OPEN, DOOR_CLOSE, door(page)) ?? headed;
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
  /** The games somebody can sit down at, in the room's order. */
  games(): (GameFacts & { id: string })[];
}

const SITE_LINE =
  "Blackjack, poker, slots and dice, played for chips and never for money. Free to play with friends or strangers, on a phone or a desk.";

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
      title: DOOR_TITLE,
      description: SITE_LINE,
      image: `${site}/og/site.png`,
      url,
      site,
      games: look.games(),
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
      description: `${game.blurb} Played for chips and nothing else, ${game.maxSeats === 1 ? "on your own" : `at up to ${game.maxSeats} to a table`}.`,
      image: `${site}/og/${first}.png`,
      url,
      site,
      game: { ...game, id: first },
      games: look.games(),
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
