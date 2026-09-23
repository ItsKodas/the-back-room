/**
 * The cloth: every bet this table will take, and nothing about what they pay.
 *
 * A spot is an id, a kind and a name. What each one does to a roll lives in
 * resolve.ts, and the split is not tidiness — it is what lets the rulebook be
 * asserted against all thirty-six outcomes without a table class or a bank
 * anywhere near it.
 *
 * The id is the only thing a client is ever allowed to name a bet by. A
 * message saying `place craps:hard7` looks nothing up here and so buys
 * nothing, which is the same lock `games/roulette/src/bets.ts` describes.
 */

export type Kind =
  /** The four a player may lay on the line: pass, don't pass, come, don't come. */
  | "line"
  /** Where a come bet ends up once it has a number. The table puts chips here, never a player. */
  | "travelled"
  | "odds"
  | "place"
  | "big"
  | "field"
  | "hard"
  | "prop";

export interface Spot {
  /** Stable, and the only thing a client is allowed to name a bet by. */
  readonly id: string;
  readonly kind: Kind;
  /** What it is called out loud. */
  readonly label: string;
  /** The number this spot is about, where it has one. */
  readonly number: number | null;
  /** Wins where the light side loses, which changes how the bank nets it. */
  readonly dark: boolean;
  /** Reached by a bet travelling rather than by a press. */
  readonly derived: boolean;
}

/** The six numbers that can be a point. Seven is not among them, by definition. */
export const POINTS: readonly number[] = [4, 5, 6, 8, 9, 10];

const spot = (
  id: string,
  kind: Kind,
  label: string,
  extra: { number?: number; dark?: boolean; derived?: boolean } = {},
): Spot => ({
  id,
  kind,
  label,
  number: extra.number ?? null,
  dark: extra.dark ?? false,
  derived: extra.derived ?? false,
});

const LIST: readonly Spot[] = [
  spot("pass", "line", "Pass Line"),
  spot("dontpass", "line", "Don't Pass", { dark: true }),
  spot("come", "line", "Come"),
  spot("dontcome", "line", "Don't Come", { dark: true }),

  ...POINTS.map((n) => spot(`come:${n}`, "travelled", `Come ${n}`, { number: n, derived: true })),
  ...POINTS.map((n) =>
    spot(`dontcome:${n}`, "travelled", `Don't Come ${n}`, { number: n, dark: true, derived: true }),
  ),

  spot("odds:pass", "odds", "Odds"),
  spot("odds:dontpass", "odds", "Lay Odds", { dark: true }),
  ...POINTS.map((n) => spot(`odds:come:${n}`, "odds", `Odds ${n}`, { number: n })),
  ...POINTS.map((n) =>
    spot(`odds:dontcome:${n}`, "odds", `Lay Odds ${n}`, { number: n, dark: true }),
  ),

  ...POINTS.map((n) => spot(`place:${n}`, "place", `Place ${n}`, { number: n })),
  spot("big:6", "big", "Big 6", { number: 6 }),
  spot("big:8", "big", "Big 8", { number: 8 }),

  spot("field", "field", "Field"),

  ...[4, 6, 8, 10].map((n) => spot(`hard:${n}`, "hard", `Hard ${n}`, { number: n })),

  spot("any7", "prop", "Any Seven"),
  spot("anycraps", "prop", "Any Craps"),
  spot("two", "prop", "Snake Eyes"),
  spot("three", "prop", "Ace Deuce"),
  spot("eleven", "prop", "Yo Eleven"),
  spot("twelve", "prop", "Boxcars"),
  spot("horn", "prop", "Horn"),
  spot("ce", "prop", "Craps & Eleven"),
];

export const SPOTS: ReadonlyMap<string, Spot> = new Map(LIST.map((one) => [one.id, one]));

/**
 * The spot with this id, or nothing.
 *
 * A `Map` lookup rather than an object index, so a client saying `__proto__`
 * gets nothing instead of a function.
 */
export function spotAt(id: string): Spot | null {
  return SPOTS.get(id) ?? null;
}

/**
 * What backs this line bet with odds, if anything does.
 *
 * Nothing backs the come box itself: a come bet with no number yet has no true
 * odds to be paid at, because nobody knows what it is trying to make.
 */
export function oddsFor(lineId: string): string | null {
  if (lineId === "pass" || lineId === "dontpass") {
    return `odds:${lineId}`;
  }
  const travelled = spotAt(lineId);
  if (travelled === null || travelled.kind !== "travelled") {
    return null;
  }
  return `odds:${lineId}`;
}
