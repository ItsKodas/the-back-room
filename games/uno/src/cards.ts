/**
 * The cards: what is in a deck, what each one is worth and how two of them
 * match.
 *
 * Ported from the tabletop Uno this game began as, which kept everything on
 * one shared global. Here a deck's ids are counted per game rather than per
 * page, because a server deals many games at once and an id that kept climbing
 * across all of them would say how many cards every other table had dealt.
 */

export const COLORS = ["red", "yellow", "green", "blue"] as const;
export type Color = (typeof COLORS)[number];
/** A card's printed colour. Wilds have none until they are played. */
export type CardColor = Color | "wild";

export const CARD_TYPES = [
  "number",
  "skip",
  "reverse",
  "draw2",
  "wild",
  "wild4",
  "shuffle",
  // Rabbids
  "cominThrough",
  "explosive",
  "hurry",
  "blueYonder",
  // Rayman
  "dragon",
  "escape",
  "punch",
  "littleHelp",
  // Just Dance
  "crossFade",
  "getDown",
  "hotNumber",
  "jdMachine",
  "experiment",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export type Theme = "rabbids" | "rayman" | "jd";

export interface Card {
  id: number;
  color: CardColor;
  type: CardType;
  value: number | null;
  /**
   * What a card was before it turned into something else as it was played —
   * A Little Help becomes a copy of the top card — so it can turn back when
   * the pile is shuffled into the deck.
   */
  original?: { color: CardColor; type: CardType; value: number | null };
  /** Which card did the turning, while it is somebody else. */
  clone?: CardType;
}

export const COLOR_NAMES: Record<CardColor, string> = {
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  wild: "Wild",
};

export const TYPE_NAMES: Record<CardType, string> = {
  number: "Number",
  skip: "Skip",
  reverse: "Reverse",
  draw2: "Draw Two",
  wild: "Wild",
  wild4: "Wild Draw Four",
  shuffle: "Wild Shuffle Hands",
  cominThrough: "Comin' Through",
  explosive: "Explosive Results",
  hurry: "Hurry Up!",
  blueYonder: "Wild Blue Yonder",
  dragon: "Dragon",
  escape: "Escape",
  punch: "Punching Things",
  littleHelp: "A Little Help",
  crossFade: "Cross-Fade",
  getDown: "Get Down",
  hotNumber: "Hot Number",
  jdMachine: "Just Dance Machine",
  experiment: "Experiment",
};

/** Which theme deck a card belongs to, for the felt to dress it. */
export const THEMES: Partial<Record<CardType, Theme>> = {
  cominThrough: "rabbids",
  explosive: "rabbids",
  hurry: "rabbids",
  blueYonder: "rabbids",
  dragon: "rayman",
  escape: "rayman",
  punch: "rayman",
  littleHelp: "rayman",
  crossFade: "jd",
  getDown: "jd",
  hotNumber: "jd",
  jdMachine: "jd",
  experiment: "jd",
};

/** The official scoring values. Number cards score their face. */
export const POINTS: Record<Exclude<CardType, "number">, number> = {
  skip: 20,
  reverse: 20,
  draw2: 20,
  wild: 50,
  wild4: 50,
  shuffle: 40,
  cominThrough: 20,
  explosive: 20,
  hurry: 20,
  blueYonder: 50,
  dragon: 20,
  escape: 20,
  punch: 50,
  littleHelp: 50,
  crossFade: 20,
  getDown: 20,
  hotNumber: 20,
  jdMachine: 20,
  experiment: 20,
};

const SORT_TYPES: readonly CardType[] = [
  "number",
  "skip",
  "reverse",
  "draw2",
  "cominThrough",
  "explosive",
  "hurry",
  "dragon",
  "escape",
  "crossFade",
  "getDown",
  "hotNumber",
  "jdMachine",
  "wild",
  "wild4",
  "shuffle",
  "blueYonder",
  "punch",
  "littleHelp",
  "experiment",
];

/** Hands out card ids for one game. */
export class CardMaker {
  private next = 1;

  make(color: CardColor, type: CardType, value: number | null = null): Card {
    const card: Card = { id: this.next, color, type, value };
    this.next += 1;
    return card;
  }

  /**
   * The standard 108: per colour one 0, two each of 1–9, Skip, Reverse and
   * Draw Two; then four Wild and four Wild Draw Four.
   */
  deck(): Card[] {
    const deck: Card[] = [];
    for (const color of COLORS) {
      deck.push(this.make(color, "number", 0));
      for (let n = 1; n <= 9; n += 1) {
        deck.push(this.make(color, "number", n), this.make(color, "number", n));
      }
      for (const type of ["skip", "reverse", "draw2"] as const) {
        deck.push(this.make(color, type), this.make(color, type));
      }
    }
    for (let i = 0; i < 4; i += 1) {
      deck.push(this.make("wild", "wild"), this.make("wild", "wild4"));
    }
    return deck;
  }
}

/** Fisher–Yates, in place, off whatever source the table was given. */
export function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}

export const isWild = (card: Pick<Card, "color">): boolean => card.color === "wild";
export const isColor = (value: unknown): value is Color => COLORS.includes(value as Color);

/** Two cards match by symbol when these are equal: 7 on 7, Skip on Skip. */
export const matchKey = (card: Pick<Card, "type" | "value">): string =>
  card.type === "number" ? `n${card.value}` : card.type;

export const points = (card: Pick<Card, "type" | "value">): number =>
  card.type === "number" ? (card.value ?? 0) : POINTS[card.type];

export const themeOf = (card: Pick<Card, "type" | "clone">): Theme | null =>
  THEMES[card.clone ?? card.type] ?? null;

export function label(card: Pick<Card, "color" | "type" | "value" | "clone">): string {
  if (card.clone !== undefined) {
    return `${TYPE_NAMES[card.clone]} (as ${label({ ...card, clone: undefined })})`;
  }
  if (isWild(card)) {
    return TYPE_NAMES[card.type];
  }
  return `${COLOR_NAMES[card.color]} ${card.type === "number" ? card.value : TYPE_NAMES[card.type]}`;
}

/** Hand order: by colour, wilds last, then by kind and face. */
export function compare(a: Card, b: Card): number {
  const ca = isWild(a) ? 9 : COLORS.indexOf(a.color as Color);
  const cb = isWild(b) ? 9 : COLORS.indexOf(b.color as Color);
  if (ca !== cb) {
    return ca - cb;
  }
  const ta = SORT_TYPES.indexOf(a.type);
  const tb = SORT_TYPES.indexOf(b.type);
  if (ta !== tb) {
    return ta - tb;
  }
  return (a.value ?? 0) - (b.value ?? 0);
}
