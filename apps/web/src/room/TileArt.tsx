import { CRAPS } from "@backroom/game-craps";
import { OPENING } from "@backroom/game-death-roll";
import { POCKETS, WHEEL, colourOf } from "@backroom/game-roulette";
import type { Face } from "@backroom/game-slots";
import { ChipFace } from "../chips/Chip.js";
import { FaceDefs, ReelFace } from "../slots/Symbols.js";
import { CoinFace } from "../twoup/Coin.js";

/**
 * What a game keeps in the corner of its tile.
 *
 * Dice for Greed, cards for Blackjack — the same furniture the link cards
 * carry, drawn again here rather than shared with them, because these are a
 * few hundred pixels across and animate, and those are print. One drawing
 * asked to be both would be tuned for neither.
 *
 * Every piece is its own group so the tile can move them independently: they
 * sit low and tucked into the corner at rest, and come up and apart when the
 * pointer is on the tile. The transforms live in game.css beside the tile.
 */

/** One piece of furniture, numbered so the stylesheet can move it. */
function Piece({ n, children }: { n: number; children: React.ReactNode }) {
  return <g className={`art__piece art__piece--${n}`}>{children}</g>;
}

function Die({ x, y, turn, spots }: { x: number; y: number; turn: number; spots: [number, number][] }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      <rect x="-30" y="-30" width="60" height="60" rx="11" fill="#e8ecf3" />
      <rect x="-30" y="-30" width="60" height="60" rx="11" fill="none" stroke="#aab4c4" strokeWidth="1.5" />
      {spots.map(([sx, sy]) => (
        <circle key={`${sx},${sy}`} cx={sx} cy={sy} r="5.2" fill="#1b2028" />
      ))}
    </g>
  );
}

export function DiceArt() {
  return (
    <svg viewBox="0 0 200 160" role="img" aria-hidden="true" focusable="false">
      <Piece n={1}>
        <Die x={70} y={96} turn={-14} spots={[[0, 0]]} />
      </Piece>
      <Piece n={2}>
        <Die
          x={132}
          y={78}
          turn={10}
          spots={[
            [-14, -14],
            [14, -14],
            [-14, 14],
            [14, 14],
            [0, 0],
          ]}
        />
      </Piece>
      <Piece n={3}>
        <Die
          x={106}
          y={140}
          turn={22}
          spots={[
            [-14, -14],
            [0, 0],
            [14, 14],
          ]}
        />
      </Piece>
    </svg>
  );
}

function PlayingCard({
  x,
  y,
  turn,
  rank,
  red,
}: {
  x: number;
  y: number;
  turn: number;
  rank: string;
  red: boolean;
}) {
  const ink = red ? "#a8321f" : "#1b2028";
  // Drawn rather than typed, for the same reason the deck is: a suit is only
  // as good as the font that happens to have loaded.
  const pip = red
    ? "M0 8 C -8 3, -14 -2, -14 -8 C -14 -12, -10 -14, -7 -14 C -3 -14, -1 -12, 0 -10 C 1 -12, 3 -14, 7 -14 C 10 -14, 14 -12, 14 -8 C 14 -2, 8 3, 0 8 Z"
    : "M0 -13 C 8 -5, 14 -2, 14 2 C 14 6, 10 8, 6 8 C 3 8, 1 7, 0 5 C -1 7, -3 8, -6 8 C -10 8, -14 6, -14 2 C -14 -2, -8 -5, 0 -13 Z M-1 5 C -2 8, -4 10, -6 11 L 6 11 C 4 10, 2 8, 1 5 Z";

  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      <rect x="-38" y="-54" width="76" height="108" rx="8" fill="#f4f2ec" />
      <rect x="-38" y="-54" width="76" height="108" rx="8" fill="none" stroke="#aab4c4" strokeWidth="1.5" />
      <text
        x="-26"
        y="-26"
        fontFamily="Georgia, serif"
        fontWeight="700"
        fontSize="26"
        textAnchor="middle"
        fill={ink}
      >
        {rank}
      </text>
      <path d={pip} transform="translate(-26 -4) scale(0.5)" fill={ink} />
      <path d={pip} transform="translate(12 26) scale(0.72)" fill={ink} />
    </g>
  );
}

export function CardsArt() {
  return (
    <svg viewBox="0 0 200 160" role="img" aria-hidden="true" focusable="false">
      <Piece n={1}>
        <PlayingCard x={74} y={96} turn={-13} rank="A" red={false} />
      </Piece>
      <Piece n={2}>
        <PlayingCard x={130} y={86} turn={9} rank="K" red />
      </Piece>
    </svg>
  );
}

/**
 * A card at a fraction of `PlayingCard`'s size, for a corner that holds two
 * hands rather than one.
 *
 * Not `PlayingCard` scaled down: that card carries a drawn pip as well as a
 * rank, and at half the size the two crowd each other. Baccarat's hands are
 * told apart by the gap between them, not by the pip, so this drops it and
 * keeps the rank.
 */
function MiniCard({
  x,
  y,
  turn,
  rank,
  red,
}: {
  x: number;
  y: number;
  turn: number;
  rank: string;
  red: boolean;
}) {
  const ink = red ? "#a8321f" : "#1b2028";
  return (
    <g className="art__bc-card" transform={`translate(${x} ${y}) rotate(${turn})`}>
      <rect x="-15" y="-21" width="30" height="42" rx="4" fill="#f4f2ec" />
      <rect x="-15" y="-21" width="30" height="42" rx="4" fill="none" stroke="#aab4c4" strokeWidth="1" />
      <text
        x="-8"
        y="-6"
        fontFamily="Georgia, serif"
        fontWeight="700"
        fontSize="12"
        textAnchor="middle"
        fill={ink}
      >
        {rank}
      </text>
    </g>
  );
}

/**
 * A die with its pips lit in the table's own gold rather than greed's black.
 *
 * The same shape `Die` above draws — flat body, flat spots, no gradient — with
 * one thing changed. Two dice reading identically to greed's would be a tile
 * advertising the wrong table; the pip colour is the one thing at this size
 * that tells a passer-by which room they are looking into.
 */
function CrapsDie({ x, y, turn, spots }: { x: number; y: number; turn: number; spots: [number, number][] }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      <rect x="-30" y="-30" width="60" height="60" rx="11" fill="#e8ecf3" />
      <rect x="-30" y="-30" width="60" height="60" rx="11" fill="none" stroke="#aab4c4" strokeWidth="1.5" />
      {spots.map(([sx, sy]) => (
        <circle key={`${sx},${sy}`} cx={sx} cy={sy} r="5.2" fill={CRAPS.theme.accent} />
      ))}
    </g>
  );
}

/**
 * Two hands, facing each other across a gap.
 *
 * The same silhouette `og.ts` draws for the shared link card, at tile scale:
 * two small pairs with daylight between them, each angled in toward the
 * middle rather than away from it, so the two sides read as leaning in to
 * compare rather than as one fanned hand split down the middle. That gap is
 * the whole of what tells this tile from blackjack's own single angled hand —
 * the only two games in the building dealing from the same deck.
 *
 * Two `Piece` groups, one per hand, so a hand arrives and settles as one
 * thing rather than as two cards thrown independently — CLAUDE.md's own rule
 * that a piece of furniture gets one motion, not two fighting over it.
 *
 * The inner pair sits thirty units apart — one whole card's width, nose to
 * nose — rather than the ten it first shipped with. `og.ts`'s own motif
 * leaves its inner pair about a card's width apart too (70 of a 78-unit
 * card, once its own slight tilt is folded in), and a gap much narrower than
 * that is a gap a room tile cannot afford: there is no hover here to widen
 * it later the way the pointer does on the felt, so whatever daylight is
 * drawn is the only daylight this silhouette ever gets. Ten units of it
 * read, at tile scale, as one cluster of four cards rather than two hands —
 * indistinguishable from `CardsArt`'s own single overlapping pair, which is
 * exactly the confusion this shape exists to rule out.
 */
export function BaccaratArt() {
  return (
    <svg viewBox="0 0 200 160" role="img" aria-hidden="true" focusable="false">
      <Piece n={1}>
        <MiniCard x={50} y={108} turn={-14} rank="9" red />
        <MiniCard x={70} y={92} turn={-6} rank="4" red={false} />
      </Piece>
      <Piece n={2}>
        <MiniCard x={150} y={108} turn={14} rank="9" red={false} />
        <MiniCard x={130} y={92} turn={6} rank="2" red />
      </Piece>
    </svg>
  );
}

/**
 * Two dice, caught mid-tumble — a four and a three, the seven every table on
 * the floor calls a natural.
 *
 * Two and not one: one die is greed's tile, and the whole of craps is what the
 * pair adds up to. Turned against each other and close enough to overlap, the
 * way a pair actually lands rather than the way two dice would be placed.
 */
export function CrapsArt() {
  return (
    <svg viewBox="0 0 200 160" role="img" aria-hidden="true" focusable="false">
      <Piece n={1}>
        <CrapsDie
          x={78}
          y={100}
          turn={-16}
          spots={[
            [-14, -14],
            [14, -14],
            [-14, 14],
            [14, 14],
          ]}
        />
      </Piece>
      <Piece n={2}>
        <CrapsDie
          x={128}
          y={74}
          turn={14}
          spots={[
            [-14, -14],
            [0, 0],
            [14, 14],
          ]}
        />
      </Piece>
    </svg>
  );
}

/** A game with nothing of its own yet still gets a corner: a stack of chips. */
/**
 * Three chips, face on, in three of the house's colours.
 *
 * The building's own chip drawing rather than one of its own: a chip here is
 * the same object as a chip on the felt and a chip in the cage, so it is the
 * same drawing, taken at a different size. The stack of ellipses this replaced
 * was a chip seen edge on, which at this size is a coloured lozenge — three of
 * them overlapping read as one blob rather than as money.
 *
 * Face on also gives the hover somewhere to go. A lozenge that rotates looks
 * like a lozenge; a chip that rotates turns its rim spots with it, so the
 * three coming apart look like chips being spread across a table rather than
 * a picture sliding about.
 *
 * Different denominations rather than one repeated, because the colours are
 * the point — a pile of one colour is a pile, and three colours is a game.
 */
const TILE_CHIPS = [
  { amount: 5000, cx: 72, cy: 74 },
  { amount: 500, cx: 126, cy: 58 },
  { amount: 25000, cx: 100, cy: 108 },
];

export function ChipsArt() {
  return (
    <svg viewBox="0 0 200 160" role="img" aria-hidden="true" focusable="false">
      {TILE_CHIPS.map((chip, index) => (
        <Piece key={chip.amount} n={index + 1}>
          {/* Close enough to overlap at rest, so coming apart is a thing that
              happens rather than three chips that were always separate. */}
          <ChipFace cx={chip.cx} cy={chip.cy} r={28} amount={chip.amount} />
        </Piece>
      ))}
    </svg>
  );
}

/**
 * The machine against the wall.
 *
 * Five reels behind a window, each carrying more faces than the window shows,
 * so the roll on hover has somewhere to come from and somewhere to go. Its
 * motion is in game.css beside the cabinet: a reel rolls, it does not fly out
 * of a corner like the furniture on a table game's tile.
 *
 * Five windows, and the faces the machine actually shows.
 *
 * Five because the machine has five, and a card advertising three was
 * advertising a different game. They were drawn here as chips and bells until
 * the reels were redrawn, and neither of those has been on the strip since —
 * so the faces come from the machine now rather than being kept in step by
 * somebody remembering to.
 *
 * `FaceDefs` comes with them because the drawings are painted with its
 * gradients. Mounted inside this art rather than at the page, so a room that
 * never lists a machine never carries them.
 */
/*
 * Laid out wide rather than square.
 *
 * The screen this sits in is about three times as wide as it is tall, and an
 * SVG fits its drawing to whichever axis runs out first — so a 200x160 box
 * scaled to the height and used half the width, leaving the reels small and
 * marooned in the middle of a lit screen. Four hundred by a hundred and sixty
 * is much closer to the shape it is drawn into, so the windows get the room.
 *
 * The rows stay forty apart whatever else moves here: the roll in game.css
 * steps a reel by exactly one face, and it is written in these coordinates.
 */
const WINDOWS = [20, 98, 176, 254, 332];
const WINDOW_W = 48;
/** A face is drawn in a 60-unit box, and this is what fits it in a window. */
const FACE_SCALE = 0.6;

/**
 * What each reel is showing, top to bottom.
 *
 * Five faces on a strip of three windows' worth, so there is always something
 * arriving and something leaving as it rolls. Different down each reel: five
 * identical strips would roll into a row of the same face, which is a jackpot
 * on a card advertising a machine nobody has played.
 */
const STRIPS: Face[][] = [
  ["seven", "tumbler", "cigar", "diamond", "spade"],
  ["diamond", "seven", "dice", "tumbler", "cigar"],
  ["cigar", "spade", "seven", "diamond", "dice"],
  ["tumbler", "diamond", "spade", "seven", "cigar"],
  ["dice", "cigar", "diamond", "spade", "seven"],
];

export function ReelsArt() {
  return (
    <svg viewBox="0 0 400 160" role="img" aria-hidden="true" focusable="false">
      <defs>
        {WINDOWS.map((x, index) => (
          <clipPath key={x} id={`reel-window-${index}`}>
            <rect x={x} y="18" width={WINDOW_W} height="124" rx="5" />
          </clipPath>
        ))}
      </defs>
      <FaceDefs />
      {WINDOWS.map((x, index) => (
        <g key={x}>
          <rect x={x} y="18" width={WINDOW_W} height="124" rx="5" fill="#0f0a14" />
          <g clipPath={`url(#reel-window-${index})`}>
            {/*
             * Two groups, not one. The stylesheet rolls the inner one with a
             * CSS transform, and a CSS transform *replaces* an element's
             * transform attribute rather than composing with it — so putting
             * this reel across on the same group would have the roll wipe out
             * the placement and stack every reel at x=0, outside its own
             * window.
             */}
            <g transform={`translate(${x + WINDOW_W / 2} 0)`}>
              {/* Numbered so the stylesheet can roll each one a beat apart. */}
              <g className={`art__piece art__piece--${index + 1}`}>
                {(STRIPS[index] as Face[]).map((face, row) => (
                  <g
                    // Position is the identity here: a strip is a fixed run of
                    // rows, and a face can repeat down one.
                    // biome-ignore lint/suspicious/noArrayIndexKey: a strip is positional
                    key={row}
                    /*
                     * A face is drawn into a 60-unit box with its middle at
                     * (30, 30), so half of the scaled box comes back off both
                     * axes to sit that middle on the row.
                     */
                    transform={`translate(${-30 * FACE_SCALE} ${40 + row * 40 - 30 * FACE_SCALE}) scale(${FACE_SCALE})`}
                  >
                    <ReelFace face={face} />
                  </g>
                ))}
              </g>
            </g>
          </g>
          <rect
            x={x}
            y="18"
            width={WINDOW_W}
            height="124"
            rx="5"
            fill="none"
            stroke="#3a2749"
            strokeWidth="2"
          />
        </g>
      ))}
    </svg>
  );
}

/**
 * The wheel in the corner.
 *
 * Drawn from the same rim order the rules use, for the reason the felt's own
 * wheel is: a wheel laid out in counting order stops alternating colours half
 * way round, and at this size the alternating band *is* the drawing. There
 * would be no way to see it was wrong and no way to miss that it was.
 *
 * The numbers are left off, which the big one cannot do. A pocket is four
 * pixels wide here, so what is left is what you recognise a wheel by from
 * across a room: mahogany, a ring of red and black, brass in the middle and a
 * ball out on the track.
 *
 * Its motion is in game.css beside the tile, and it is not the throw the other
 * tables get. Dice and cards are loose things that come off a table; a wheel
 * is bolted to the middle of its own and the only thing it ever does is turn.
 * So it comes across in one piece and spins.
 */

/** The middle of the wheel, in the drawing's own coordinates. */
const WHEEL_X = 120;
const WHEEL_Y = 94;
/** The band the pockets are cut into. */
const POCKET_OUTER = 60;
const POCKET_INNER = 44;
/** How far round the rim one pocket is, in degrees. */
const RIM_STEP = 360 / POCKETS;

function on(angle: number, radius: number): { x: number; y: number } {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: WHEEL_X + Math.cos(radians) * radius, y: WHEEL_Y + Math.sin(radians) * radius };
}

/** One pocket, as a wedge of the rim. */
function pocketWedge(at: number): string {
  const from = at * RIM_STEP - RIM_STEP / 2;
  const to = at * RIM_STEP + RIM_STEP / 2;
  const a = on(from, POCKET_OUTER);
  const b = on(to, POCKET_OUTER);
  const c = on(to, POCKET_INNER);
  const d = on(from, POCKET_INNER);
  return [
    `M ${a.x} ${a.y}`,
    `A ${POCKET_OUTER} ${POCKET_OUTER} 0 0 1 ${b.x} ${b.y}`,
    `L ${c.x} ${c.y}`,
    `A ${POCKET_INNER} ${POCKET_INNER} 0 0 0 ${d.x} ${d.y}`,
    "Z",
  ].join(" ");
}

export function WheelArt() {
  return (
    <svg viewBox="0 0 200 160" role="img" aria-hidden="true" focusable="false">
      {/*
        Three nested groups, and the nesting is the point: the outer one slides
        and everything that turns lives inside it. A CSS transform replaces an
        element's transform rather than composing with it, so a group asked to
        slide and spin at once would only ever do the second of them.
      */}
      <g className="art__wheel">
        {/* The bowl, which does not turn. Everything else here does. */}
        <circle cx={WHEEL_X} cy={WHEEL_Y} r={POCKET_OUTER + 5} className="art__wheel-bowl" />

        {/*
          The rotor: pockets, frets, cone and turret, all one piece. On a real
          wheel these turn together and the bowl around them does not, and the
          spokes are what makes that legible — thirty-seven wedges four pixels
          wide turning is a band that shimmers, and four brass arms turning is
          plainly a wheel going round.
        */}
        <g className="art__wheel-rim">
          {WHEEL.map((n, at) => (
            <path
              key={n}
              d={pocketWedge(at)}
              data-pocket={n}
              className={`art__pocket art__pocket--${colourOf(n) ?? "zero"}`}
            />
          ))}
          <circle cx={WHEEL_X} cy={WHEEL_Y} r={POCKET_INNER - 1} className="art__wheel-hub" />
          <g className="art__wheel-spokes">
            {[0, 45, 90, 135].map((turn) => (
              <line
                key={turn}
                x1={on(turn, POCKET_INNER - 3).x}
                y1={on(turn, POCKET_INNER - 3).y}
                x2={on(turn + 180, POCKET_INNER - 3).x}
                y2={on(turn + 180, POCKET_INNER - 3).y}
              />
            ))}
          </g>
          <circle cx={WHEEL_X} cy={WHEEL_Y} r="19" className="art__wheel-cone" />
          <circle cx={WHEEL_X} cy={WHEEL_Y} r="7.5" className="art__wheel-turret" />
        </g>

        {/*
          The ball, on an arm that swings the other way round the middle.

          The opposition is the whole illusion — a disc and a dot going the same
          way is a loading spinner. Two motions again, and two elements again:
          the arm carries it round and the ball itself sits out on the track or
          drops into the frets, and those have nothing to do with each other.
        */}
        <g className="art__ball-arm">
          <circle cx={WHEEL_X} cy={WHEEL_Y} r="4" className="art__ball" />
        </g>
      </g>
    </svg>
  );
}

/**
 * Death roll's number, falling.
 *
 * The room has nothing in it but one lit figure, so that is all the corner
 * carries: a duel's worth of rolls, from where a table opens down to the one
 * that ends it. Each roll is its own element and the stylesheet lights them in
 * turn — SVG text cannot change what it says from CSS, and a single element
 * asked to settle seven times over would be seven motions fighting over one
 * thing.
 *
 * Every roll is under the one before it, the way the rules have it. A run that
 * went back up would be a card advertising a game that does not exist.
 */
export const DUEL = [OPENING, 412, 97, 38, 11, 4, 1] as const;

export function DuelArt() {
  return (
    <svg viewBox="0 0 200 160" role="img" aria-hidden="true" focusable="false">
      {/* Two groups: the outer slides up out of the corner, the numbers inside
          it settle. A CSS transform replaces rather than composes. */}
      <g className="art__duel">
        {DUEL.map((n, at) => (
          <text
            key={n}
            x="84"
            y="96"
            textAnchor="middle"
            data-roll={n}
            className={`art__roll art__roll--${at + 1}${n === 1 ? " art__roll--one" : ""}`}
          >
            {n}
          </text>
        ))}
      </g>
    </svg>
  );
}

/**
 * Two pennies, tossed.
 *
 * The room's own coin faces, taken at a fraction of the size, for the reason
 * the chips are the building's chip: a penny here is the same object as the
 * one in the ring. They tumble about their horizontal axis the way a coin off
 * a kip does, and land heads — four half-turns, so the face they come down on
 * is the face they sat on, and nothing changes when the pointer leaves.
 *
 * Three groups a coin, one per motion: the piece is thrown out of the corner,
 * the toss inside it rises and falls, and the flip inside that turns.
 */
const TILE_COINS = [
  { x: 44, y: 62 },
  { x: 98, y: 44 },
];
const COIN_SIZE = 62;

export function CoinsArt() {
  return (
    <svg viewBox="0 0 200 160" role="img" aria-hidden="true" focusable="false">
      {TILE_COINS.map((coin, index) => (
        <Piece key={coin.x} n={index + 1}>
          <g className="art__coin-toss">
            <g className="art__coin-flip">
              <svg x={coin.x} y={coin.y} width={COIN_SIZE} height={COIN_SIZE} aria-hidden="true">
                <CoinFace tail={false} />
              </svg>
              <g className="art__coin-tails">
                <svg x={coin.x} y={coin.y} width={COIN_SIZE} height={COIN_SIZE} aria-hidden="true">
                  <CoinFace tail />
                </svg>
              </g>
            </g>
          </g>
        </Piece>
      ))}
    </svg>
  );
}

/**
 * A triangle of pegs and one ball on its way down.
 *
 * The ball keeps its own class rather than the wheel's `art__ball` — that name
 * is already spoken for by the roulette rim's own rest position and fall, and
 * both drawings would answer to it at once: a plinko ball with no motion of
 * its own would sit hoisted up by the wheel's `translateY(-51px)`, then fall
 * along the wheel's track on hover instead of down its own board.
 */
export function PegsArt() {
  const pegs: Array<{ x: number; y: number }> = [];
  for (let row = 0; row < 5; row += 1) {
    for (let index = 0; index < row + 3; index += 1) {
      pegs.push({ x: 100 + (index - (row + 2) / 2) * 22, y: 38 + row * 22 });
    }
  }
  return (
    <svg viewBox="0 0 200 160" role="img" aria-hidden="true" focusable="false">
      {pegs.map((peg) => (
        <circle key={`${peg.x}:${peg.y}`} cx={peg.x} cy={peg.y} r="3.2" fill="#92a8ab" />
      ))}
      <g className="art__plinko-ball">
        <circle cx="111" cy="62" r="7" fill="#7cecf5" />
      </g>
      {[0, 1, 2, 3, 4, 5, 6].map((bucket) => (
        <rect
          key={bucket}
          x={100 + (bucket - 3) * 22 - 9}
          y="140"
          width="18"
          height="10"
          rx="3"
          fill={bucket === 0 || bucket === 6 ? "#22b8c8" : "#1f3339"}
        />
      ))}
    </svg>
  );
}

/**
 * A napkin with a lighthouse half drawn on it.
 *
 * Still, rather than moved on hover like the others: nothing on it is a thing
 * that moves, and a drawing that wobbles reads as a drawing that is wrong.
 */
export function ScribbleArt() {
  return (
    <svg viewBox="0 0 200 160" role="img" aria-hidden="true" focusable="false">
      <g className="art__napkin" transform="rotate(-6 100 80)">
        <rect x="38" y="28" width="124" height="104" rx="4" fill="#f2efe9" />
        <path d="M84 110 L90 58 L110 58 L116 110 Z" fill="none" stroke="#1f1c22" strokeWidth="4" strokeLinejoin="round" />
        <path d="M86 92 L114 92 M88 76 L112 76" stroke="#d9413b" strokeWidth="6" />
        <path d="M112 64 L144 52 M112 70 L146 78" stroke="#f1c232" strokeWidth="4" strokeLinecap="round" />
        <path d="M48 118 q10 -7 20 0 t20 0 t20 0 t20 0 t20 0" fill="none" stroke="#2e6fd4" strokeWidth="4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** The furniture a game keeps, by which game it is. */
export function TileArt({ game }: { game: string }) {
  if (game === "death-roll") {
    return <DuelArt />;
  }
  if (game === "two-up") {
    return <CoinsArt />;
  }
  if (game === "greed") {
    return <DiceArt />;
  }
  if (game === "blackjack") {
    return <CardsArt />;
  }
  if (game === "slots") {
    return <ReelsArt />;
  }
  if (game === "roulette") {
    return <WheelArt />;
  }
  if (game === "scribble") {
    return <ScribbleArt />;
  }
  if (game === "plinko") {
    return <PegsArt />;
  }
  if (game === "craps") {
    return <CrapsArt />;
  }
  if (game === "baccarat") {
    return <BaccaratArt />;
  }
  return <ChipsArt />;
}
