import { normalise } from "../guess.js";
import type { PackId } from "./index.js";
import { PACKS } from "./index.js";

export const MAX_CUSTOM = 200;

/*
 * Only what can be typed back on any keyboard. An accent or a digit in the
 * word is a guess somebody gets right and still loses, because their phone
 * spelled it the other way.
 */
const SHAPE = /^[a-z][a-z' -]*[a-z]$/i;

/** Why a word cannot be played, or null if it can. */
export function wordProblem(word: string): string | null {
  if (word.length < 3 || word.length > 24) {
    return "3 to 24 characters";
  }
  if (!SHAPE.test(word)) {
    return "letters, spaces, hyphens and apostrophes only";
  }
  if (word.split(" ").length > 3) {
    return "at most 3 words";
  }
  return null;
}

export function parseCustomWords(raw: string): { words: string[]; skipped: number } {
  const seen = new Set<string>();
  const words: string[] = [];
  let skipped = 0;
  for (const piece of raw.split(",")) {
    const word = piece.trim().replace(/\s+/g, " ");
    if (word === "") {
      continue;
    }
    const key = normalise(word);
    if (wordProblem(word) !== null || seen.has(key) || words.length >= MAX_CUSTOM) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    words.push(word);
  }
  return { words, skipped };
}

export function poolFor(packs: readonly PackId[], custom: readonly string[], onlyCustom: boolean): string[] {
  const all = [...(onlyCustom ? [] : packs.flatMap((id) => PACKS[id].words)), ...custom];
  const seen = new Set<string>();
  return all.filter((word) => {
    const key = normalise(word);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function drawChoices(
  pool: readonly string[],
  played: ReadonlySet<string>,
  random: () => number,
  count = 3,
): string[] {
  const fresh = pool.filter((word) => !played.has(normalise(word)));
  // A long game on a short custom list runs dry. Repeats are a lesser evil than
  // a turn with nothing to draw.
  const left = fresh.length >= count ? fresh : [...pool];
  const out: string[] = [];
  while (out.length < count && left.length > 0) {
    const at = Math.min(left.length - 1, Math.floor(random() * left.length));
    out.push(...left.splice(at, 1));
  }
  return out;
}
