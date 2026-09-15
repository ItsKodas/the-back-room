import type { HintLevel } from "./options.js";

export interface Hint {
  /** When it opens, as a fraction of the draw time. */
  at: number;
  /** Which character of the word it opens. */
  index: number;
}

const SPREAD: Record<HintLevel, { share: number; from: number; to: number } | null> = {
  none: null,
  few: { share: 4, from: 0.5, to: 0.8 },
  generous: { share: 2, from: 0.3, to: 0.85 },
};

const LETTER = /\p{L}/u;

/**
 * Chosen once, when the word is picked, and kept on the table — so a player
 * who reconnects halfway through sees the letters everybody else sees.
 */
export function planHints(word: string, level: HintLevel, random: () => number): Hint[] {
  const spread = SPREAD[level];
  if (spread === null) {
    return [];
  }
  const letters = [...word].flatMap((character, index) => (LETTER.test(character) ? [index] : []));
  const count = Math.floor(letters.length / spread.share);
  const hints: Hint[] = [];
  for (let n = 0; n < count; n += 1) {
    const at = count === 1 ? spread.from : spread.from + ((spread.to - spread.from) * n) / (count - 1);
    const pick = Math.min(letters.length - 1, Math.floor(random() * letters.length));
    const [index] = letters.splice(pick, 1);
    hints.push({ at: Math.round(at * 1000) / 1000, index: index as number });
  }
  return hints;
}

/*
 * Whole milliseconds, and the same arithmetic for the timer that waits for a
 * hint and the check that decides it has arrived. Float fractions on both sides
 * can disagree by a hair, and a timer that fires to find its hint not yet due
 * re-arms itself for zero milliseconds.
 */
export function hintMs(hint: Hint, drawMs: number): number {
  return Math.ceil(hint.at * drawMs);
}

export function hintsDue(hints: readonly Hint[], elapsedMs: number, drawMs: number): number {
  return hints.filter((hint) => hintMs(hint, drawMs) <= elapsedMs).length;
}

export function mask(word: string, hints: readonly Hint[], shown: number): (string | null)[] {
  const open = new Set(hints.slice(0, shown).map((hint) => hint.index));
  return [...word].map((character, index) => (!LETTER.test(character) || open.has(index) ? character : null));
}
