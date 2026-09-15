const GUESS_BASE = 50;
const GUESS_SPEED = 250;
const DRAW_FULL = 250;

export function guesserPoints(msLeft: number, drawMs: number): number {
  const left = Math.max(0, Math.min(msLeft, drawMs));
  return GUESS_BASE + Math.round((GUESS_SPEED * left) / drawMs);
}

/**
 * By share rather than by count, so a drawer at a table of four is not paid
 * less for a drawing everybody got than one at a table of ten.
 */
export function drawerPoints(correct: number, eligible: number): number {
  return eligible <= 0 ? 0 : Math.round((DRAW_FULL * correct) / eligible);
}
