/**
 * Deciding what a guess was.
 *
 * Everything is compared normalised, because a guess is typed at speed on a
 * phone: nobody should lose a race to a capital letter or an autocorrected
 * apostrophe.
 */

export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[\s-]+/g, " ")
    .trim();
}

/** Letters and digits only — what is left once somebody tries to spell around a filter. */
function squash(text: string): string {
  return normalise(text).replace(/[^\p{L}\p{N}]/gu, "");
}

export function isCorrect(guess: string, word: string): boolean {
  return normalise(guess) === normalise(word);
}

export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const swap = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] as number) + 1, (current[j - 1] as number) + 1, swap));
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/*
 * Five letters, because below that one letter off is usually another real
 * word — "bat" for "cat" is not close, it is wrong.
 */
const CLOSE_FROM = 5;

export function isClose(guess: string, word: string): boolean {
  if (squash(word).length < CLOSE_FROM) {
    return false;
  }
  return editDistance(normalise(guess), normalise(word)) === 1;
}

export function containsWord(text: string, word: string): boolean {
  const target = squash(word);
  return target.length > 0 && squash(text).includes(target);
}
