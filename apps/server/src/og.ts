import { CRAPS } from "@backroom/game-craps";
import { WHEEL, colourOf } from "@backroom/game-roulette";
import { Resvg } from "@resvg/resvg-js";

/**
 * The picture a link to this place unfurls into.
 *
 * Every unfurler — Discord, Slack, X, iMessage — fetches the page with
 * something that does not run JavaScript, and then fetches one image. So the
 * card is drawn here rather than in the browser, and it leaves as a PNG rather
 * than the SVG this file actually writes, because none of them will render an
 * SVG.
 *
 * Drawn in the room's own language: the chip from the tab icon, the blue of
 * the sign, and gold only ever meaning money.
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** What one card has to say. */
export interface CardSpec {
  /**
   * The game on the felt, or null for the room's own banner.
   *
   * Carries the colours it is painted in and how it writes its name, because
   * a picture of Greed should look like Greed rather than like the building
   * with the word "Greed" on it.
   */
  game: {
    id: string;
    name: string;
    theme: { wall: string; felt: string; accent: string; accentHi: string };
    mark?: { text: string; accentAt: number } | undefined;
  } | null;
  /** Who opened the table. Null when the card is not about one table. */
  host: string | null;
  /** The table's code, which is also how anybody gets to it. */
  code: string | null;
  /**
   * Who is sitting, in order, as a picture each or nothing.
   *
   * A face rather than a chip wherever there is one: the point of a link to a
   * table is who is already at it. What arrives here is a data URI, because
   * the rasterizer cannot fetch anything and would not be given the chance to
   * if it could.
   */
  players: readonly (string | null)[];
  maxSeats: number;
  /** The line under the title: a game's blurb, or what a table is doing. */
  note: string | null;
}

const INK = "#f2f6fb";
const INK_DIM = "#8b97a8";
const CHIP = "#e0b048";
const CLAY = "#171b22";
/** How big the sign hangs on a link card. Small: a card is about a table. */
const SIGN_SCALE = 0.62;

/**
 * Text on its way into an SVG document.
 *
 * Names come from players, so this is the boundary where one of them stops
 * being a string and becomes markup. Everything drawn here goes through it.
 */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A line cut to what will fit.
 *
 * SVG does not wrap, and a name long enough to run off the card would take the
 * seat count with it. The widths are per-face averages rather than real
 * metrics: this only has to decide where to stop, and being a character out
 * costs nothing at these sizes.
 */
export function fit(text: string, size: number, room: number, em = 0.54): string {
  const each = size * em;
  const most = Math.max(1, Math.floor(room / each));
  if (text.length <= most) {
    return text;
  }
  return `${text.slice(0, Math.max(1, most - 1)).trimEnd()}…`;
}

/** A point on a circle, with zero at the top — the convention the chips use. */
function around(cx: number, cy: number, r: number, degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(radians), cy + r * Math.sin(radians)];
}

/** One seat as somebody's face, cut to a circle and ringed in gold. */
function face(cx: number, cy: number, r: number, picture: string, id: string): string {
  return `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r - 2}"/></clipPath>
    <image href="${picture}" x="${cx - r + 2}" y="${cy - r + 2}" width="${(r - 2) * 2}" height="${(r - 2) * 2}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>
    <circle cx="${cx}" cy="${cy}" r="${r - 1}" fill="none" stroke="${CHIP}" stroke-width="2.5"/>`;
}

/** One seat as a chip: gold for taken, a dark ring for one going spare. */
function chip(cx: number, cy: number, r: number, taken: boolean): string {
  const rim = r * 0.82;
  const arcs: string[] = [];
  for (const centre of [0, 90, 180, 270]) {
    const [ax, ay] = around(cx, cy, rim, centre - 34);
    const [bx, by] = around(cx, cy, rim, centre + 34);
    arcs.push(
      `M ${ax.toFixed(2)} ${ay.toFixed(2)} A ${rim.toFixed(2)} ${rim.toFixed(2)} 0 0 1 ${bx.toFixed(2)} ${by.toFixed(2)}`,
    );
  }
  const colour = taken ? CHIP : "#39414d";
  return [
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${taken ? CLAY : "#12151b"}"/>`,
    `<g fill="none" stroke="${colour}" stroke-width="${(r * 0.23).toFixed(2)}">`,
    arcs.map((d) => `<path d="${d}"/>`).join(""),
    "</g>",
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.35).toFixed(2)}" fill="${colour}"/>`,
  ].join("");
}

/**
 * The sign over the door, as it hangs on the wall.
 *
 * The same shape the building wears: "The" small and hung above, "Back Room"
 * carrying the weight, the whole piece a couple of degrees off square the way
 * a hand-bent sign sits on its hook. It was set in plain letterspaced capitals
 * here, which said the right words in somebody else's voice.
 *
 * The glow is the tube, drawn the way the page draws it: the same words
 * underneath in blue and blurred, twice, with the burning white core on top. A
 * filter rather than a text-shadow, because that is what an SVG has.
 *
 * Written as one set of words and one filter rather than as five copies of the
 * words, because the rasterizer shapes and outlines every `<text>` it is given
 * separately and pays a font lookup for each — five copies of the sign is five
 * times that work for one picture. `tube()` stacks the same washes inside the
 * filter instead, which is what feMerge is for.
 */
function sign(x: number, y: number, scale: number): string {
  /*
   * "The" hangs where the stylesheet hangs it. The page sets it at 0.44 of the
   * sign's size and indents it 1.9 of its own ems, which comes to 0.836 of the
   * big text — measured out here rather than guessed at, because a sign that
   * differs between the wall and the card is two signs.
   */
  return `<g transform="rotate(-2.4 ${x} ${y})" fill="#ffffff" filter="url(#tube)">
    <text x="${x + 53.5 * scale}" y="${y - 30 * scale}" font-family="Dancing Script" font-weight="700" font-size="${28.2 * scale}">The</text>
    <text x="${x}" y="${y}" font-family="Dancing Script" font-weight="700" font-size="${64 * scale}">Back Room</text>
  </g>`;
}

/**
 * The light the tube throws, as one filter.
 *
 * The word's own alpha blurred wide and flooded with the room's colour, then
 * blurred close and flooded with the brighter one, each laid down twice under
 * the burning white core. The wide wash twice over because one pass of it is a
 * halo you have to look for — a tube on a dark wall throws more light than
 * that, and a blur spreads whatever it is given thinly enough that stacking is
 * how you get it back.
 *
 * Lit in whatever colour the room is lit. Greed has burned brass since its
 * first screen and a blue sign over a brass room is the building's sign in
 * somebody else's doorway.
 */
function tube(accent: string, accentHi: string): string {
  const wash = (id: string, spread: number, ink: string) =>
    `<feGaussianBlur in="SourceAlpha" stdDeviation="${spread}" result="${id}-shape"/>
      <feFlood flood-color="${ink}"/>
      <feComposite in2="${id}-shape" operator="in" result="${id}"/>`;
  return `<filter id="tube" x="-60%" y="-60%" width="220%" height="220%">
      ${wash("wide", 9 * SIGN_SCALE, accent)}
      ${wash("near", 3 * SIGN_SCALE, accentHi)}
      <feMerge>
        <feMergeNode in="wide"/>
        <feMergeNode in="wide"/>
        <feMergeNode in="near"/>
        <feMergeNode in="near"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>`;
}

/**
 * A suit, drawn rather than typed.
 *
 * The obvious way to get a heart onto a card is to write one, and the fonts
 * this renders with have no such glyph — a card with a hollow box where its
 * suit should be is worse than a card with none. Paths always draw.
 */
function suit(x: number, y: number, size: number, red: boolean, ink?: string): string {
  const s = size;
  const d = red
    ? `M ${x} ${y + s * 0.78} C ${x - s * 1.15} ${y + s * 0.02}, ${x - s * 0.72} ${y - s * 0.82}, ${x} ${y - s * 0.24} C ${x + s * 0.72} ${y - s * 0.82}, ${x + s * 1.15} ${y + s * 0.02}, ${x} ${y + s * 0.78} Z`
    : `M ${x} ${y - s * 0.86} C ${x + s * 1.0} ${y + s * 0.02}, ${x + s * 0.58} ${y + s * 0.54}, ${x + s * 0.13} ${y + s * 0.3} L ${x + s * 0.32} ${y + s * 0.78} L ${x - s * 0.32} ${y + s * 0.78} L ${x - s * 0.13} ${y + s * 0.3} C ${x - s * 0.58} ${y + s * 0.54}, ${x - s * 1.0} ${y + s * 0.02}, ${x} ${y - s * 0.86} Z`;
  /*
   * The card's own ink by default, and something else on request. A reel is
   * not a card: its window is nearly black, and a spade drawn in a playing
   * card's near-black is a spade nobody can see. It rendered as an empty
   * window, which on a machine is not a missing symbol — it is a broken reel.
   */
  return `<path d="${d}" fill="${ink ?? (red ? "#a8321f" : "#1b2028")}"/>`;
}

/** A playing card, for the corner of a blackjack banner. */
function pip(x: number, y: number, turn: number, rank: string, red: boolean): string {
  const face = red ? "#a8321f" : "#1b2028";
  return `<g transform="translate(${x} ${y}) rotate(${turn})">
    <rect x="-72" y="-104" width="144" height="208" rx="14" fill="#e8ecf3"/>
    <rect x="-72" y="-104" width="144" height="208" rx="14" fill="none" stroke="#aab4c4" stroke-width="2"/>
    <text x="-50" y="-50" font-family="IBM Plex Sans" font-weight="600" font-size="48" fill="${face}">${rank}</text>
    ${suit(-32, 0, 22, red)}
    ${suit(34, 62, 16, red)}
  </g>`;
}

/** A die, for the corner of a greed banner. */
function die(cx: number, cy: number, turn: number, spots: Array<[number, number]>): string {
  return `<g transform="translate(${cx} ${cy}) rotate(${turn})">
    <rect x="-58" y="-58" width="116" height="116" rx="20" fill="#e8ecf3"/>
    <rect x="-58" y="-58" width="116" height="116" rx="20" fill="none" stroke="#aab4c4" stroke-width="2"/>
    ${spots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10" fill="#1b2028"/>`).join("")}
  </g>`;
}

/** A smaller card, for a game whose furniture is a row of them. */
function board(x: number, y: number, turn: number, rank: string, red: boolean): string {
  const ink = red ? "#a8321f" : "#1b2028";
  return `<g transform="translate(${x} ${y}) rotate(${turn})">
    <rect x="-39" y="-56" width="78" height="112" rx="9" fill="#e8ecf3"/>
    <rect x="-39" y="-56" width="78" height="112" rx="9" fill="none" stroke="#aab4c4" stroke-width="2"/>
    <text x="-27" y="-24" font-family="IBM Plex Sans" font-weight="600" font-size="30" fill="${ink}">${rank}</text>
    ${suit(-16, 6, 13, red)}
    ${suit(18, 34, 10, red)}
  </g>`;
}

/**
 * The wheel, cut from the order the rules lay the rim out in.
 *
 * Borrowed rather than copied, for the same reason the felt's wheel and the
 * tile's are: a wheel drawn in counting order stops alternating colours half
 * way round, which is a picture that lies about the game it is advertising.
 * Numbers are left off — a pocket is twenty pixels wide here — so what is left
 * is what anybody recognises a wheel by: mahogany, a ring of red and black,
 * and brass in the middle.
 */
function wheel(cx: number, cy: number, r: number): string {
  const step = 360 / WHEEL.length;
  const inner = r * 0.73;
  const at = (angle: number, radius: number): [number, number] => around(cx, cy, radius, angle);

  const pockets = WHEEL.map((n, index) => {
    const [ax, ay] = at(index * step - step / 2, r);
    const [bx, by] = at(index * step + step / 2, r);
    const [ix, iy] = at(index * step + step / 2, inner);
    const [jx, jy] = at(index * step - step / 2, inner);
    const colour = colourOf(n);
    const fill = colour === "red" ? "#d13a30" : colour === "black" ? "#17120f" : "#17663f";
    const arc = `M ${ax.toFixed(2)} ${ay.toFixed(2)} A ${r} ${r} 0 0 1 ${bx.toFixed(2)} ${by.toFixed(2)} L ${ix.toFixed(2)} ${iy.toFixed(2)} A ${inner.toFixed(2)} ${inner.toFixed(2)} 0 0 0 ${jx.toFixed(2)} ${jy.toFixed(2)} Z`;
    return `<path d="${arc}" fill="${fill}" stroke="#c9a227" stroke-width="1"/>`;
  }).join("");

  const spokes = [0, 45, 90, 135]
    .map((turn) => {
      const [x1, y1] = at(turn, inner * 0.94);
      const [x2, y2] = at(turn + 180, inner * 0.94);
      return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#c9a227" stroke-width="4" opacity="0.7"/>`;
    })
    .join("");

  const [bx, by] = at(64, r * 0.87);
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${(r * 1.06).toFixed(2)}" fill="#4a2418" stroke="#c9a227" stroke-width="3"/>
    ${pockets}
    <circle cx="${cx}" cy="${cy}" r="${(inner - 2).toFixed(2)}" fill="#6b3625"/>
    ${spokes}
    <circle cx="${cx}" cy="${cy}" r="${(r * 0.32).toFixed(2)}" fill="#4a2418" stroke="#c9a227" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="${(r * 0.12).toFixed(2)}" fill="#f0cf68"/>
    <circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="9" fill="#f7efe9"/>
  </g>`;
}

/** A diamond, for a reel. A rotated square is one, and a path always draws. */
function diamond(cx: number, cy: number, size: number): string {
  return `<path d="M ${cx} ${cy - size} L ${cx + size * 0.72} ${cy} L ${cx} ${cy + size} L ${cx - size * 0.72} ${cy} Z" fill="#5fc9e8"/>`;
}

/** The three kinds of thing a reel on this card can be showing. */
type Face = "seven" | "diamond" | "spade";

function reelFace(face: Face, x: number, y: number): string {
  if (face === "seven") {
    return `<text x="${x}" y="${y + 16}" font-family="Bevan" font-size="42" fill="#e0b048" text-anchor="middle">7</text>`;
  }
  if (face === "diamond") {
    return diamond(x, y, 20);
  }
  // Ivory rather than the card's ink: see suit().
  return suit(x, y, 20, false, "#e8ecf3");
}

/**
 * The machine against the wall: five windows, and the strips behind them.
 *
 * Five because the machine has five, and a card advertising three is a card
 * advertising a different game. Three rows deep because a window showing one
 * symbol in the middle of a tall black rectangle is a machine that has
 * finished; a strip with something arriving and something leaving is one that
 * is running, which is the thing worth putting on a poster.
 *
 * No two strips alike, and no line straight across. Five of the same thing is
 * a jackpot on a banner for a machine nobody has played.
 */
const STRIPS: readonly (readonly [Face, Face, Face])[] = [
  ["spade", "seven", "diamond"],
  ["seven", "diamond", "spade"],
  ["diamond", "seven", "spade"],
  ["seven", "spade", "diamond"],
  ["spade", "diamond", "seven"],
];

function cabinet(): string {
  const windows = [923, 975, 1027, 1079, 1131];
  /* The rows the strip sits on: the outer two are cut by the glass. */
  const rows = [252, 322, 392];
  const reels = windows
    .map((x, index) => {
      const strip = STRIPS[index] as readonly [Face, Face, Face];
      const faces = rows
        .map(
          (y, row) =>
            `<g opacity="${row === 1 ? "1" : "0.42"}">${reelFace(strip[row] as Face, x, y)}</g>`,
        )
        .join("");
      return `<g>
      <rect x="${x - 22}" y="226" width="44" height="192" rx="6" fill="#0f0a14" stroke="#3a2749" stroke-width="2"/>
      <g clip-path="url(#reel${index})">${faces}</g>
    </g>`;
    })
    .join("");
  const clips = windows
    .map(
      (x, index) =>
        `<clipPath id="reel${index}"><rect x="${x - 22}" y="226" width="44" height="192" rx="6"/></clipPath>`,
    )
    .join("");
  return `<g>
    <defs>${clips}</defs>
    <rect x="884" y="204" width="286" height="236" rx="20" fill="#1b1024" stroke="#c9439e" stroke-width="3"/>
    ${reels}
    <!-- The line the middle row pays on, which is what a window is for. -->
    <rect x="895" y="320" width="264" height="3" rx="1.5" fill="#c9439e" opacity="0.35"/>
  </g>`;
}

/**
 * The jar on the bar, with what has already dripped into it.
 *
 * Glass rather than a pot, because the whole of this one is watching it fill.
 * A jar you cannot see into is a jar with nothing to say.
 */
function jar(): string {
  return `<g>
    <rect x="936" y="238" width="178" height="26" rx="8" fill="#d99a3f"/>
    <rect x="950" y="264" width="150" height="184" rx="24" fill="#ffffff" fill-opacity="0.07" stroke="#d99a3f" stroke-width="3"/>
    <rect x="968" y="286" width="22" height="130" rx="11" fill="#ffffff" fill-opacity="0.09"/>
    ${chip(989, 406, 28, true)}
    ${chip(1057, 412, 28, true)}
    ${chip(1024, 356, 28, true)}
    ${/* One still on its way in, because the bar drips rather than pays. Close
         enough to the mouth to be arriving: further up it read as a mark on
         the wall rather than as anything to do with the jar. */ ""}
    ${chip(1025, 198, 22, true)}
  </g>`;
}

/**
 * The board's pegs, and the ball a few rows into them.
 *
 * Six rows rather than the tile's five: the card is wide rather than square,
 * and five pegs read as sparse across it. Same idea as the tile's corner — a
 * triangle above a ball still on its way down — in the card's own coordinates.
 */
function pegs(): string {
  const dots: string[] = [];
  for (let row = 0; row < 6; row += 1) {
    for (let index = 0; index < row + 3; index += 1) {
      const x = 1028 + (index - (row + 2) / 2) * 34;
      const y = 236 + row * 34;
      dots.push(`<circle cx="${x}" cy="${y}" r="5" fill="#92a8ab"/>`);
    }
  }
  return `<g>
    ${dots.join("")}
    <circle cx="1045" cy="286" r="12" fill="#7cecf5"/>
  </g>`;
}

/**
 * Two dice, turned against each other, sitting dark in the table's own gold.
 *
 * Filled rather than the tile's ivory — flat, the way `pegs` fills its pegs
 * and its ball and `wheel` fills every pocket, not the outline this drew
 * before, which read as a diagram of a die rather than a die. The body is
 * the table's own felt, not a fifth colour invented for this: a dark square
 * lit only at its rim and its pips is the room craps is in, the same one
 * lit by its own sign and nothing else.
 */
function dice(cx: number, cy: number, size: number): string {
  const accent = CRAPS.theme.accent;
  const body = CRAPS.theme.felt;
  const half = size / 2;
  const corner = size * 0.16;
  const dot = size * 0.07;
  const spread = size * 0.24;

  const one = (dx: number, dy: number, turn: number, spots: ReadonlyArray<[number, number]>): string =>
    `<g transform="translate(${cx + dx} ${cy + dy}) rotate(${turn})">
      <rect x="${-half}" y="${-half}" width="${size}" height="${size}" rx="${corner}" fill="${body}" stroke="${accent}" stroke-width="4"/>
      ${spots.map(([sx, sy]) => `<circle cx="${sx}" cy="${sy}" r="${dot}" fill="${accent}"/>`).join("")}
    </g>`;

  return `<g>
    ${one(-size * 0.42, -size * 0.26, -9, [
      [-spread, -spread],
      [spread, -spread],
      [-spread, spread],
      [spread, spread],
    ])}
    ${one(size * 0.4, size * 0.24, 13, [
      [-spread, -spread],
      [0, 0],
      [spread, spread],
    ])}
  </g>`;
}

/**
 * The furniture each game keeps, by which game it is.
 *
 * A record rather than a run of ifs, so the set can be counted. A game that is
 * open and has no entry here falls back to the house's own chip, which is a
 * card saying "a casino" where it should be saying which game — and nothing
 * anywhere would have mentioned it. `og.test.ts` holds these keys against the
 * games the room actually deals.
 */
export const MOTIFS: Record<string, () => string> = {
  blackjack: () => `${pip(944, 322, -13, "A", false)}${pip(1082, 296, 9, "K", true)}`,
  greed: () => `
      ${die(958, 240, -12, [[0, 0]])}
      ${die(1092, 330, 8, [
        [-27, -27],
        [27, -27],
        [-27, 27],
        [27, 27],
        [0, 0],
      ])}
      ${die(966, 414, 17, [
        [-27, -27],
        [0, 0],
        [27, 27],
      ])}`,
  /*
   * The board rather than a hand, which is what tells this card from the
   * blackjack one at a glance. Two cards held at an angle is somebody's hand;
   * five spread in a line is the middle of the table, and the middle of the
   * table is most of the difference between the two games.
   */
  poker: () => `
      ${board(908, 330, -5, "A", false)}
      ${board(960, 324, -2, "K", true)}
      ${board(1012, 322, 1, "Q", false)}
      ${board(1064, 324, 3, "J", true)}
      ${board(1116, 330, 6, "9", false)}
      ${/* The pot, under the board rather than beside it — a chip off the
           corner of the spread reads as one somebody dropped. */ ""}
      ${chip(982, 432, 30, true)}
      ${chip(1040, 438, 30, true)}`,
  roulette: () => wheel(1028, 318, 128),
  slots: cabinet,
  tips: jar,
  plinko: pegs,
  craps: () => dice(1028, 318, 120),
};

/**
 * The thing on the right that says which game without spending a word on it.
 *
 * Kept behind the type and slightly turned, because it is the furniture in the
 * room rather than a second headline competing with the first.
 */
function motif(game: string | null): string {
  const drawn = game === null ? undefined : MOTIFS[game];
  if (drawn !== undefined) {
    return `<g opacity="0.92">${drawn()}</g>`;
  }
  /*
   * The room itself gets one chip, large — and so does a game listed before it
   * exists, which has no furniture to draw yet. A stack drawn face-on is four
   * discs on top of each other rather than a pile: the pile in the app works
   * because it is seen from the side, and half a pile is worse than one chip
   * drawn properly.
   */
  return `<g opacity="0.92">${chip(1024, 322, 122, true)}</g>`;
}

/**
 * The game's name, with the one letter it picks out in its own colour.
 *
 * Drawn as separate runs rather than as one string, because SVG has no span:
 * the accented letter is placed by measuring what comes before it, which is
 * why this marks a single letter and never a phrase.
 */
function name(text: string, accentAt: number | undefined, accent: string): string {
  const at = accentAt ?? -1;
  /*
   * One text element with a coloured run inside it, rather than three placed
   * beside each other. Placing them meant guessing an advance width, and
   * Bevan's capitals are nothing like equal — GREED came out as GRED with the
   * marked letter sitting on top of its neighbour. A tspan asks the text
   * engine where the letter goes, which is the only thing that knows.
   */
  const body =
    at < 0 || at >= text.length
      ? esc(text)
      : `${esc(text.slice(0, at))}<tspan fill="${accent}">${esc(text[at] ?? "")}</tspan>${esc(
          text.slice(at + 1),
        )}`;
  return `<text x="72" y="288" font-family="Bevan" font-size="88" fill="${INK}">${body}</text>`;
}

/**
 * The card, as an SVG document.
 *
 * Pure, and exported, so the layout can be tested without a rasterizer in the
 * way — what a name does to it matters more than what the pixels come out as.
 */
export function cardSvg(spec: CardSpec): string {
  const title = spec.game?.mark?.text ?? spec.game?.name ?? "The Back Room";
  /* The room's own colours when there is no game to borrow any from. */
  const room = spec.game?.theme ?? {
    wall: "#101828",
    felt: "#132033",
    accent: "#2e7bff",
    accentHi: "#7ba9ff",
  };
  const line = spec.host === null ? null : `${spec.host}’s table`;
  // Seats mean something at a table and nothing on a banner for a whole game.
  const atTable = spec.game !== null && spec.code !== null;

  const taken = spec.players.length;
  const seats: string[] = [];
  if (atTable) {
    for (let index = 0; index < spec.maxSeats; index += 1) {
      const x = 94 + index * 52;
      const picture = spec.players[index];
      seats.push(
        picture === undefined || picture === null
          ? chip(x, 486, 20, index < taken)
          : face(x, 486, 20, picture, `seat${index}`),
      );
    }
  }

  const noteY = line === null ? 348 : 408;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <!-- The wash a tube throws on the wall, and the light inside the glass. -->
    ${tube(room.accent, room.accentHi)}
    <radialGradient id="sign" cx="18%" cy="6%" r="78%">
      <stop offset="0%" stop-color="${room.accent}" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="${room.accent}" stop-opacity="0"/>
    </radialGradient>
    <!-- The floor of the room, coming up from under the furniture. -->
    <radialGradient id="floor" cx="50%" cy="118%" r="86%">
      <stop offset="0%" stop-color="${room.felt}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="${room.felt}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="lamp" cx="86%" cy="94%" r="66%">
      <stop offset="0%" stop-color="#e0b048" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#e0b048" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${room.wall}"/>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#floor)"/>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#sign)"/>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#lamp)"/>
  ${motif(spec.game?.id ?? null)}
  <rect x="0" y="0" width="${OG_WIDTH}" height="6" fill="${room.accent}" opacity="0.7"/>

  ${
    /*
     * On a card about a game, the sign hangs small over the door and the game
     * is the headline. On the room's own card there is no game, so the sign is
     * the headline — setting it small above the same words again in a slab
     * face was the building introducing itself twice.
     */
    spec.game === null
      ? sign(76, 300, 1.5)
      : `${sign(74, 110, SIGN_SCALE)}
  ${name(fit(title, 88, 780, 0.62), spec.game?.mark?.accentAt, room.accent)}`
  }
  ${
    line === null
      ? ""
      : `<text x="72" y="352" font-family="IBM Plex Sans" font-weight="600" font-size="38" fill="${CHIP}">${esc(fit(line, 38, 760))}</text>`
  }
  ${
    spec.note === null
      ? ""
      : `<text x="72" y="${noteY}" font-family="IBM Plex Sans" font-size="30" fill="${INK_DIM}">${esc(fit(spec.note, 30, atTable ? 740 : 820))}</text>`
  }

  ${seats.join("")}
  ${
    atTable
      ? `<text x="${94 + spec.maxSeats * 52 + 8}" y="496" font-family="IBM Plex Sans" font-size="28" fill="${INK_DIM}">${taken} of ${spec.maxSeats} seats</text>`
      : ""
  }
  ${
    spec.code === null
      ? ""
      : `<g>
    <rect x="72" y="534" width="${64 + spec.code.length * 29}" height="62" rx="10" fill="#12161d" stroke="${CHIP}" stroke-opacity="0.45" stroke-width="2"/>
    <text x="96" y="576" font-family="IBM Plex Mono" font-size="36" letter-spacing="5" fill="${CHIP}">${esc(spec.code)}</text>
  </g>`
  }
</svg>`;
}

/**
 * The fonts the card is drawn with.
 *
 * Handed to the rasterizer as files rather than left to the machine, because a
 * server has no fonts installed worth the name and a container often has none
 * at all — and a card that renders in whatever Debian happened to ship is not
 * a card anybody designed.
 */
const FONT_FILES = [
  "DancingScript.ttf",
  "Bevan-Regular.ttf",
  "IBMPlexSans-Regular.ttf",
  "IBMPlexSans-SemiBold.ttf",
  "IBMPlexMono-Medium.ttf",
];

export function fontPaths(root: string): string[] {
  return FONT_FILES.map((name) => `${root}/${name}`);
}

/**
 * A few of something, the one that went in first out when the room runs out.
 *
 * Both caches below want exactly this and neither wants a dependency for it.
 * A Map keeps insertion order, which is the whole trick.
 *
 * Deliberately oldest-out rather than least-recently-used. These hold a burst
 * — a link pasted in a busy channel, a table whose seats are filling — and
 * over a burst the entry that went in first is the one least likely to be
 * wanted again. Keeping a hit's place would cost a delete and a set on the
 * path that every hit takes, which is the path worth protecting.
 *
 * Pulled out of the two classes that had it so the bound can be checked
 * without drawing anything. Proving eviction through `Cards` meant rasterizing
 * a card per entry, and a test that spends a second of native rendering to
 * assert a property of a Map is a test that fails when the machine is busy.
 */
export class Kept<T> {
  private readonly held = new Map<string, T>();
  /** Small on purpose: this is a cache for a burst, not a store. */
  private readonly most: number;

  constructor(most: number) {
    this.most = most;
  }

  get(key: string): T | undefined {
    return this.held.get(key);
  }

  set(key: string, value: T): void {
    // Only a new key can push one out. Setting a key already held keeps its
    // place, so counting it against the bound would drop a good entry and
    // leave this holding fewer than it was given room for.
    if (!this.held.has(key) && this.held.size >= this.most) {
      const oldest = this.held.keys().next();
      if (!oldest.done) {
        this.held.delete(oldest.value);
      }
    }
    this.held.set(key, value);
  }
}

/**
 * One drawn card, kept for a moment.
 *
 * An unfurler is not one request. A link pasted in a busy Discord fans out to
 * every client that renders the embed, and rasterizing the same table four
 * hundred times in a minute is work nobody asked for. Keyed on what the card
 * actually says, so a seat filling produces a new picture and nothing else
 * does.
 */
export class Cards {
  private readonly drawn: Kept<Buffer>;
  private readonly fonts: string[];

  constructor(fontRoot: string, most = 64) {
    this.fonts = fontPaths(fontRoot);
    this.drawn = new Kept(most);
  }

  png(spec: CardSpec): Buffer {
    const key = JSON.stringify(spec);
    const had = this.drawn.get(key);
    if (had !== undefined) {
      return had;
    }
    const made = Buffer.from(
      new Resvg(cardSvg(spec), {
        font: {
          fontFiles: this.fonts,
          // Nothing from the machine, so a card looks the same everywhere it
          // is rendered — and a missing font file fails here rather than
          // silently becoming whatever was lying about.
          loadSystemFonts: false,
          defaultFontFamily: "IBM Plex Sans",
        },
        fitTo: { mode: "width", value: OG_WIDTH },
      })
        .render()
        .asPng(),
    );
    this.drawn.set(key, made);
    return made;
  }
}

/**
 * Players' pictures, fetched once and kept.
 *
 * The rasterizer cannot fetch anything, so a face has to arrive as bytes. That
 * means this server makes a request to an address it read out of its own
 * store, which is the shape of every server-side request forgery there has
 * ever been — so it will only ever talk to Discord's picture host, and
 * anything else is not cleaned up or followed, it is simply not fetched.
 *
 * A failure is not an error. A card with a chip where a face would have been
 * is a card; a card that never renders because somebody's avatar host was slow
 * is not.
 */
const PICTURE_HOST = "https://cdn.discordapp.com/";
/** Bigger than any avatar Discord serves at the size we ask for. */
const MOST_BYTES = 512 * 1024;

export class Avatars {
  /**
   * The request rather than its answer.
   *
   * A cache written only once the bytes land is empty for the whole of the
   * burst it exists for: a table with one person's face in two seats asked
   * twice, and two links to that table unfurled at once asked twice again.
   * Holding the fetch itself means the second caller waits on the first one's
   * request instead of starting its own.
   */
  private readonly held: Kept<Promise<string | null>>;

  constructor(most = 256) {
    this.held = new Kept(most);
  }

  /** One picture as a data URI, or null if there isn't one to be had. */
  async data(url: string | null): Promise<string | null> {
    if (url === null || !url.startsWith(PICTURE_HOST)) {
      return null;
    }
    const had = this.held.get(url);
    if (had !== undefined) {
      return had;
    }

    // Started and remembered in the same breath, before anything is awaited,
    // so nothing can slip between the miss and the entry.
    const coming = this.fetched(url);
    this.held.set(url, coming);
    return coming;
  }

  /**
   * The request itself, which never rejects.
   *
   * A failure resolves to null and is remembered as null, so a picture that
   * is not coming is not asked for again on every unfurl of every link to
   * that table.
   */
  private async fetched(url: string): Promise<string | null> {
    try {
      const answer = await fetch(url, { signal: AbortSignal.timeout(2500) });
      const type = answer.headers.get("content-type") ?? "";
      if (answer.ok && type.startsWith("image/")) {
        const bytes = Buffer.from(await answer.arrayBuffer());
        if (bytes.byteLength <= MOST_BYTES) {
          return `data:${type};base64,${bytes.toString("base64")}`;
        }
      }
    } catch {
      // Slow, refused, or gone. The seat gets a chip.
    }
    return null;
  }

  /** Every seat's picture, in order, fetched together. */
  async all(urls: readonly (string | null)[]): Promise<(string | null)[]> {
    return Promise.all(urls.map((url) => this.data(url)));
  }
}
