import type { Card as CardData, Rank, Suit } from "@backroom/game-blackjack";
import type { CSSProperties, PointerEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  CARD_H,
  CARD_R,
  CARD_W,
  COURT_EMBLEM,
  COURT_PANEL,
  INDEX,
  isCourt,
  isRed,
  PIP_SCALE,
  pipsFor,
  SUIT_PATH,
} from "./deck.js";

/**
 * The deck.
 *
 * Drawn rather than set in type. A card is a layout — an index in two corners
 * and a field of pips between them — and the whole point of the traditional
 * arrangement is that it is the same on every card, which is a thing you get
 * from geometry and not from a font. It also means one card is one shape at
 * any size, which is what makes the felt animate later without a sprite sheet
 * to keep in step.
 *
 * Every number here lives in {@link deck.ts}, in the 100×140 box a real card
 * is shaped like. Nothing in this file nudges anything.
 */

/**
 * Angles a card toward the pointer.
 *
 * Written straight onto the element rather than held in state on purpose: this
 * fires on every pointer move, and a re-render per move would be a re-render
 * of the whole felt sixty times a second to move one card a few degrees.
 */
const tilt = {
  onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    // Where the pointer is on the card, from its middle: -0.5 to 0.5 each way.
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    // Toward the pointer, so the near edge dips. Reading the other way round
    // makes a card that leans away from your finger, which feels wrong before
    // anybody works out why.
    event.currentTarget.style.setProperty("--tilt-x", `${(-y * 20).toFixed(1)}deg`);
    event.currentTarget.style.setProperty("--tilt-y", `${(x * 24).toFixed(1)}deg`);
  },
  onPointerLeave(event: PointerEvent<SVGSVGElement>) {
    // Back to flat, and let the transition carry it there.
    event.currentTarget.style.removeProperty("--tilt-x");
    event.currentTarget.style.removeProperty("--tilt-y");
  },
};

/** The corner index: rank over suit, drawn at one corner and again at the other. */
function Index({ rank, suit }: { rank: Rank; suit: Suit }) {
  return (
    <g>
      {/* Centred on the index column rather than left-aligned, so a "10" and
          an "A" sit over the same axis instead of drifting apart. */}
      <text
        className="bj-card__rank"
        x={INDEX.x}
        y={INDEX.rankBase}
        textAnchor="middle"
        // Ten is the only two-character rank, and at full size it would spill
        // out of the index column. Squeezed rather than shrunk, so it keeps
        // the height of every other rank and the corner still reads as a row.
        textLength={rank === "10" ? 19 : undefined}
        lengthAdjust="spacingAndGlyphs"
      >
        {rank}
      </text>
      <path
        d={SUIT_PATH[suit]}
        transform={`translate(${INDEX.x} ${INDEX.suitY}) scale(${INDEX.suitScale})`}
      />
    </g>
  );
}

/**
 * One card, face up.
 *
 * Red and black rather than four colours: a deck is two colours, and somebody
 * reading a hand at a glance is reading rank first and suit second.
 */
export function Card({
  card,
  deal = 0,
  enter = "deal",
}: {
  card: CardData;
  /**
   * Which card of the deal this is, for the stagger.
   *
   * Only the opening two are staggered. A card taken later arrives on its own
   * and waiting a beat before showing it would read as lag, which is the exact
   * thing the rest of this is here to avoid.
   */
  deal?: number;
  /**
   * How this card comes into the world.
   *
   * `deal` flies it out of the shoe. `turn` is the dealer's hole card being
   * squashed through the middle. `unfold` is the second half of a card that
   * was already on the felt face down and is now being turned over — the back
   * folded away, and this opens out in its place.
   */
  enter?: "deal" | "turn" | "unfold";
}) {
  const red = isRed(card.suit);
  const pips = pipsFor(card.rank);
  const court = isCourt(card.rank);
  const emblem = COURT_EMBLEM[card.rank];

  return (
    <svg
      className={`bj-card${red ? " bj-card--red" : ""} bj-card--${enter}`}
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      role="img"
      aria-label={`${card.rank} of ${card.suit}`}
      {...tilt}
      // A card is only ever dealt once, so this runs on mount and never again
      // — which is precisely the behaviour wanted, and why the stagger can be
      // a plain delay rather than something choreographed.
      style={deal > 0 ? { animationDelay: `${deal * 90}ms` } : undefined}
    >
      <rect
        className="bj-card__face"
        x="0.5"
        y="0.5"
        width={CARD_W - 1}
        height={CARD_H - 1}
        rx={CARD_R}
      />
      <g className="bj-card__ink" fill="currentColor">
        <Index rank={card.rank} suit={card.suit} />
        {/* The second index is the first one turned about the middle of the
            card — which is what makes it land in the opposite corner at the
            opposite angle without a second set of numbers to keep in step. */}
        <g transform={`rotate(180 ${CARD_W / 2} ${CARD_H / 2})`}>
          <Index rank={card.rank} suit={card.suit} />
        </g>

        {court && emblem !== undefined ? (
          <>
            <rect
              className="bj-card__panel"
              x={COURT_PANEL.x}
              y={COURT_PANEL.y}
              width={COURT_PANEL.w}
              height={COURT_PANEL.h}
              rx="3"
            />
            {/* Divided across the middle and mirrored about it, which is what
                a real court card is: one figure, and the same figure upside
                down, so the card reads the same whichever way it is held. */}
            <path
              className="bj-card__rule"
              d={`M${COURT_PANEL.x} ${COURT_PANEL.mid} H${COURT_PANEL.x + COURT_PANEL.w}`}
            />
            <path d={emblem} transform={`translate(50 ${COURT_PANEL.emblemY})`} />
            <path
              d={emblem}
              transform={`rotate(180 50 ${COURT_PANEL.mid}) translate(50 ${COURT_PANEL.emblemY})`}
            />
          </>
        ) : (
          pips.map((pip) => (
            <path
              key={`${pip.x}-${pip.y}`}
              d={SUIT_PATH[card.suit]}
              transform={`translate(${pip.x} ${pip.y}) rotate(${pip.turned ? 180 : 0}) scale(${
                pip.big === true ? PIP_SCALE.ace : PIP_SCALE.normal
              })`}
            />
          ))
        )}
      </g>
    </svg>
  );
}

/**
 * A card whose face nobody has been told.
 *
 * There is nothing behind this in the payload — the server left the card out
 * rather than sending it and asking the browser to keep the secret.
 *
 * The weave takes its colours from the page rather than from here, so a game
 * with its own theme deals its own deck without a second drawing of one.
 */
export function FaceDown({
  deal = 0,
  folding = false,
}: {
  deal?: number;
  /** Being turned over: the back folds away and a face opens in its place. */
  folding?: boolean;
}) {
  // A pattern needs an id unique to the document, and a felt can hold several
  // face-down cards at once.
  const weave = useId();

  return (
    <svg
      className={`bj-card bj-card--down bj-card--${folding ? "fold" : "deal"}`}
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      role="img"
      aria-label="face down"
      {...tilt}
      style={deal > 0 ? { animationDelay: `${deal * 90}ms` } : undefined}
    >
      <defs>
        {/* Eight units, which is a compromise the small size wins: finer and
            the weave greys out at the forty-seven pixels a card is actually
            dealt at, coarser and it reads as three fat stripes up close. */}
        <pattern
          id={weave}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="8" height="8" className="bj-card__weft" />
          <rect width="3.7" height="8" className="bj-card__warp" />
        </pattern>
      </defs>
      <rect
        className="bj-card__back"
        x="0.5"
        y="0.5"
        width={CARD_W - 1}
        height={CARD_H - 1}
        rx={CARD_R}
      />
      {/* Inset, so the weave has a border of its own the way a printed back
          does — a pattern running to the edge reads as a swatch, not a card. */}
      <rect x="6" y="6" width={CARD_W - 12} height={CARD_H - 12} rx="4" fill={`url(#${weave})`} />
      <rect
        className="bj-card__edge"
        x="6"
        y="6"
        width={CARD_W - 12}
        height={CARD_H - 12}
        rx="4"
      />
    </svg>
  );
}

/**
 * How long the back is in the air before it can be turned over.
 *
 * A card that arrives while its own back is still flying in should land
 * first — folding it mid-flight is two motions fighting over one card, which
 * is the thing this whole arrangement exists to stop.
 */
const DEAL_MS = 380;
/** Half a turn: the back folding away, then the face opening out. */
const FOLD_MS = 120;

/**
 * One place in a hand, which may not have a card in it yet.
 *
 * This is the whole answer to a move made over a real connection. Asking for a
 * card used to put a back on the felt and then, when the reply came, throw
 * that away and fly a different card in from the shoe — two arrivals for one
 * card, which reads as a glitch rather than as a deal.
 *
 * Now it is one card the whole way through: the back flies out of the shoe on
 * the press, waits however long the table takes, and turns over in place when
 * the answer lands. The element changes underneath, but the motion does not.
 */
function Slot({ card, deal }: { card: CardData | undefined; deal: number }) {
  // What is showing, which lags the real card by half a turn while it flips.
  const [face, setFace] = useState<CardData | undefined>(card);
  const [folding, setFolding] = useState(false);
  /*
   * How the face arrives when it does.
   *
   * A slot that had a card from the start is dealing one out of the shoe. A
   * slot that stood there as a back is opening out of a fold, and flying it in
   * from the shoe a second time is exactly the double arrival this is here to
   * remove.
   */
  const [enter, setEnter] = useState<"deal" | "unfold">("deal");
  // When this slot appeared, so a card can wait for its own back to land.
  const born = useRef(Date.now());

  useEffect(() => {
    if (card === undefined || face !== undefined) {
      return;
    }
    const landed = Math.max(0, DEAL_MS - (Date.now() - born.current));
    const fold = window.setTimeout(() => setFolding(true), landed);
    // The face opens out exactly as the back finishes folding away.
    const turn = window.setTimeout(() => {
      setEnter("unfold");
      setFace(card);
      setFolding(false);
    }, landed + FOLD_MS);
    return () => {
      window.clearTimeout(fold);
      window.clearTimeout(turn);
    };
  }, [card, face]);

  if (face === undefined) {
    return <FaceDown deal={deal} folding={folding} />;
  }
  return <Card card={face} deal={deal} enter={enter} />;
}

export function Hand({
  cards,
  hidden,
  arriving = false,
  turnedFrom,
}: {
  cards: readonly CardData[];
  hidden?: boolean;
  /**
   * A card this player has asked for and the table has not sent yet.
   *
   * It takes a place in the hand of its own, face down — the honest version,
   * because a card is on its way and nobody yet knows what it is. When the
   * table answers, that same card turns over. It is the only thing on the felt
   * that is not the table's word, and it stops being so the moment it speaks.
   */
  arriving?: boolean;
  /** From this card on, the hand is being turned over rather than dealt. */
  turnedFrom?: number;
}) {
  /*
   * Four cards is where a hand stops fitting beside a seat.
   *
   * Up to three it is laid out flat, which is the clearest way to read one.
   * Past that the row is wider than the seat holding it, and what got pushed
   * out was the count — into the next player's seat. So a long hand is dealt
   * onto itself instead, the way one actually sits in a hand on a felt. The
   * index is in the corner either way, so an overlapped card still says what
   * it is.
   */
  /*
   * One place per card, plus one for a card that has been asked for.
   *
   * The asked-for place is a place in the hand rather than something tacked on
   * the end, which is what lets the back that lands in it become the card that
   * fills it — the same slot the whole way through, so there is one arrival
   * and not two.
   */
  const places = cards.length + (arriving ? 1 : 0);
  const length = places + (hidden === true ? 1 : 0);
  const tight = length > 3;

  return (
    // The length goes to the felt, which overlaps the hand by however much it
    // takes for that many places to fit the room the row has left.
    <span className={`bj-hand${tight ? " bj-hand--tight" : ""}`} style={{ "--bj-places": length } as CSSProperties}>
      {Array.from({ length: places }, (_, index) => {
        /*
         * Position is the identity here. A hand only ever grows at its end,
         * and a four-deck shoe deals the same card to the same hand often
         * enough that rank and suit are not unique — so keying by what the
         * card is would collide where keying by where it sits cannot.
         */
        const card = cards[index];
        // The dealer's hand is turned over rather than dealt, and never has a
        // card on the way, so it goes straight to a face.
        if (turnedFrom !== undefined && index >= turnedFrom && card !== undefined) {
          // biome-ignore lint/suspicious/noArrayIndexKey: a hand is append-only
          return <Card key={index} card={card} deal={index} enter="turn" />;
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: a hand is append-only
        return <Slot key={index} card={card} deal={index} />;
      })}
      {hidden === true ? <FaceDown /> : null}
    </span>
  );
}
