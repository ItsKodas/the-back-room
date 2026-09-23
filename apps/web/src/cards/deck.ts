/*
 * A card's own vocabulary, declared here rather than borrowed from a game.
 *
 * Every game in the building that deals cards has its own Rank and Suit — the
 * rules of twenty-one are blackjack's business and nine's are baccarat's — and
 * they are all the same fifty-two shapes. Structural typing does the rest: a
 * game's own Card satisfies this one without either knowing about the other.
 */
export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

/**
 * Where everything on a playing card goes.
 *
 * One card is drawn in a 100×140 box — the 2.5×3.5 inches a real one is, so
 * nothing has to be nudged to look right — and every number below is in that
 * box. Rendered at whatever size the felt asks for, which is the reason for
 * drawing it rather than setting it in type: a card has to be legible at
 * forty-seven pixels and still be a card at three hundred.
 *
 * The layouts are the traditional ones. They are not a matter of taste: a
 * seven has its odd pip between the top pair and the middle pair, and putting
 * it anywhere else makes a card that is subtly wrong in a way people notice
 * without being able to say why.
 */

export const CARD_W = 100;
export const CARD_H = 140;
/** The rounded corner, and the margin everything else keeps from the edge. */
export const CARD_R = 7;

/**
 * The corner index: where the rank sits, and the suit under it.
 *
 * A real card gives the index about a sixth of the card's height and keeps it
 * in a narrow column of its own, so the pip field beside it starts clean. The
 * rank is centred on that column rather than left-aligned, so a "10" and an
 * "A" sit over the same axis instead of drifting apart.
 */
export const INDEX = { x: 16, rankBase: 28, suitY: 38, suitScale: 0.56 } as const;

/**
 * How big a pip is drawn.
 *
 * The suit paths are about twenty-two units tall, so the normal pip comes out
 * near sixteen — small enough that ten of them sit in the field without
 * touching, and large enough to tell a club from a spade at a glance. The
 * ace's single pip is the exception every deck makes.
 */
export const PIP_SCALE = { normal: 0.74, ace: 1.5 } as const;

/**
 * The panel a court card carries instead of pips.
 *
 * Divided across the middle rather than corner to corner: that is how a real
 * court is built, one figure above the line and the same figure inverted
 * below, so the card reads the same whichever way up it is held.
 */
export const COURT_PANEL = { x: 30, y: 30, w: 40, h: 80, mid: 70, emblemY: 51 } as const;

/** The three columns a pip may stand in. */
const COL = { left: 35, centre: 50, right: 65 } as const;
/** The top and bottom of the field pips are laid out in. */
const FIELD = { top: 26, bottom: 114 } as const;

/** A row of the pip field, as a fraction from its top to its bottom. */
function row(t: number): number {
  return FIELD.top + (FIELD.bottom - FIELD.top) * t;
}

/** One pip: where it stands, and whether it is standing on its head. */
export interface Pip {
  x: number;
  y: number;
  /** Pips below the middle are upside down, exactly as on a real card. */
  turned: boolean;
  /** The ace's single pip is drawn large; every other pip is not. */
  big?: boolean;
}

/** Down one column, at the given fractions of the field. */
function column(x: number, ts: readonly number[]): Pip[] {
  return ts.map((t) => ({ x, y: row(t), turned: t > 0.5 }));
}

const THIRDS = [0, 1 / 3, 2 / 3, 1] as const;
const HALVES = [0, 0.5, 1] as const;

/**
 * The pips on one card, in the arrangement a real deck uses.
 *
 * Court cards have none — they get a panel instead — and so this answers with
 * an empty list for them rather than pretending otherwise.
 */
export function pipsFor(rank: Rank): Pip[] {
  switch (rank) {
    case "A":
      return [{ x: COL.centre, y: row(0.5), turned: false, big: true }];
    case "2":
      return column(COL.centre, [0, 1]);
    case "3":
      return column(COL.centre, HALVES);
    case "4":
      return [...column(COL.left, [0, 1]), ...column(COL.right, [0, 1])];
    case "5":
      return [
        ...column(COL.left, [0, 1]),
        ...column(COL.right, [0, 1]),
        ...column(COL.centre, [0.5]),
      ];
    case "6":
      return [...column(COL.left, HALVES), ...column(COL.right, HALVES)];
    case "7":
      // Six, and the odd one between the top pair and the middle pair.
      return [
        ...column(COL.left, HALVES),
        ...column(COL.right, HALVES),
        ...column(COL.centre, [0.25]),
      ];
    case "8":
      return [
        ...column(COL.left, HALVES),
        ...column(COL.right, HALVES),
        ...column(COL.centre, [0.25, 0.75]),
      ];
    case "9":
      // Nine and ten move to four to a column; the odd pips fall between.
      return [
        ...column(COL.left, THIRDS),
        ...column(COL.right, THIRDS),
        ...column(COL.centre, [0.5]),
      ];
    case "10":
      return [
        ...column(COL.left, THIRDS),
        ...column(COL.right, THIRDS),
        ...column(COL.centre, [1 / 6, 5 / 6]),
      ];
    default:
      return [];
  }
}

export const COURTS = ["J", "Q", "K"] as const;

export function isCourt(rank: Rank): boolean {
  return (COURTS as readonly string[]).includes(rank);
}

/**
 * A suit as a path, drawn around the origin in a 20-unit square.
 *
 * Paths rather than the characters, for the same reason the link cards use
 * them: a glyph is only as good as the font that happens to be loaded, and a
 * card with a hollow box where its suit should be is not a card. It also means
 * one suit is one shape at every size, instead of a font's idea of a small one.
 */
export const SUIT_PATH: Record<Suit, string> = {
  spades:
    "M0 -10 C 5.5 -3.6, 10 -1.2, 10 3 C 10 6.9, 7 9.2, 4 9.2 C 2.2 9.2, 0.9 8.4, 0 7.2 C -0.9 8.4, -2.2 9.2, -4 9.2 C -7 9.2, -10 6.9, -10 3 C -10 -1.2, -5.5 -3.6, 0 -10 Z M -0.9 6 C -1.6 8.6, -2.8 10.2, -4.6 11.2 L 4.6 11.2 C 2.8 10.2, 1.6 8.6, 0.9 6 Z",
  hearts:
    "M0 11 C -3.4 7.2, -10 2.6, -10 -3.2 C -10 -7.6, -6.9 -10.4, -3.6 -10.4 C -1.5 -10.4, -0.5 -9.2, 0 -8 C 0.5 -9.2, 1.5 -10.4, 3.6 -10.4 C 6.9 -10.4, 10 -7.6, 10 -3.2 C 10 2.6, 3.4 7.2, 0 11 Z",
  diamonds: "M0 -11.4 L 8.2 0 L 0 11.4 L -8.2 0 Z",
  clubs:
    "M0 -10.4 C 3.2 -10.4, 5.5 -8.1, 5.5 -5.1 C 5.5 -4.1, 5.2 -3.2, 4.8 -2.5 C 5.6 -3, 6.6 -3.3, 7.6 -3.3 C 10.6 -3.3, 12.6 -1, 12.6 1.9 C 12.6 4.9, 10.3 7.1, 7.3 7.1 C 4.6 7.1, 2.4 5.4, 1.2 3.4 C 1.3 5.9, 2.2 9, 4 11.2 L -4 11.2 C -2.2 9, -1.3 5.9, -1.2 3.4 C -2.4 5.4, -4.6 7.1, -7.3 7.1 C -10.3 7.1, -12.6 4.9, -12.6 1.9 C -12.6 -1, -10.6 -3.3, -7.6 -3.3 C -6.6 -3.3, -5.6 -3, -4.8 -2.5 C -5.2 -3.2, -5.5 -4.1, -5.5 -5.1 C -5.5 -8.1, -3.2 -10.4, 0 -10.4 Z",
};

/** Red suits and black ones, which is the only distinction a hand needs. */
export function isRed(suit: Suit): boolean {
  return suit === "hearts" || suit === "diamonds";
}

/**
 * What sits in the middle of a court card.
 *
 * A real court is a mirrored figure, and a figure at forty-seven pixels is a
 * smudge. These are the emblem of one instead — a crown, a coronet, a halberd
 * — drawn once and again upside down, which is what makes a court card read as
 * a court card from across a table.
 */
export const COURT_EMBLEM: Record<string, string> = {
  K: "M-11 5 L-13 -8 L-6 -2.5 L0 -10 L6 -2.5 L13 -8 L11 5 Z M-11 7.5 L11 7.5 L11 10 L-11 10 Z",
  Q: "M-9.5 6 L-11.5 -6 L-5 -1 L0 -8.5 L5 -1 L11.5 -6 L9.5 6 Z M-9.5 8 L9.5 8 L9.5 10 L-9.5 10 Z M0 -11.5 A 2.2 2.2 0 1 1 0 -11.4 Z",
  J: "M-1.6 11 L-1.6 -4 L1.6 -4 L1.6 11 Z M0 -12 L5.5 -7.5 L5.5 -4.5 L-5.5 -4.5 L-5.5 -7.5 Z M5.5 -6 L10 -6 L7 -1.5 L5.5 -1.5 Z",
};
