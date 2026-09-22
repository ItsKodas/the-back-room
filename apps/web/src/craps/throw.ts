import type { Roll } from "@backroom/game-craps";

/**
 * The dice's whole flight as a function of the clock.
 *
 * Pure, the same way `twoup/toss.ts` and `plinko/flight.ts` are, and for the
 * same reason: the felt asks "where are the dice *now*" every frame rather
 * than keeping its own animation state, so a re-render mid-throw can never
 * restart them somewhere else. There is no state in this file at all — every
 * number is worked out from `dice`, `which` and `ms`.
 *
 * The dice are already the server's fact the instant a throw begins — the
 * table sets them before it tells anyone the phase is `rolling` — so `path`
 * is not hiding an unknown answer. It is holding a known one back: `face`
 * stays null until the very end of the flight, so nothing on screen reads the
 * result before the dice have actually stopped turning.
 */

export interface Flight {
  /** Milliseconds into the throw this sample was taken. */
  at: number;
  /** Nought at the shooter's rail, one at the back wall. */
  x: number;
  /** Height off the felt, nought at rest. */
  y: number;
  /** Cumulative turns, always climbing — never wraps, so a keyframe never has to. */
  turn: number;
  /** The real face, or null while it is still not this die's to say. */
  face: number | null;
}

/**
 * How often the flight is sampled.
 *
 * Coarse enough that a test can walk the whole throw as a short array, fine
 * enough that the tumble reads as motion rather than a slideshow. `Dice.tsx`
 * steps through the same samples on the same clock, so the two never carry
 * two copies of this number to drift apart.
 */
export const FRAME_MS = 40;

/**
 * Where the wall is struck, where the die settles past it, how many turns it
 * takes to get there and how high it hops — one set of numbers per die.
 *
 * Seeded from the roll and which die this is rather than drawn at random, so
 * the same roll always throws the same way. Two dice thrown from the same
 * hand still travel differently — same reason `twoup/toss.ts` gives its two
 * coins different turn counts — so `which` is folded into the seed alongside
 * the faces rather than only the faces: a double still throws two dice that
 * do not travel together.
 */
function arcOf(dice: Roll, which: 0 | 1): { bounceAt: number; settleX: number; turns: number; hop: number } {
  const seed = dice[0] * 131 + dice[1] * 17 + which * 977 + 11;
  return {
    bounceAt: 0.3 + scatter(seed) * 0.08,
    settleX: 0.64 + scatter(seed + 1) * 0.1,
    turns: 3 + scatter(seed + 2) * 2.2,
    hop: 0.1 + scatter(seed + 3) * 0.06,
  };
}

/**
 * A deterministic scatter in [0, 1), standing in for `Math.random()`.
 *
 * Never the real thing — a die whose wobble came from `Math.random` would
 * throw a different way each render, which is the exact bug this whole file
 * exists to rule out.
 */
function scatter(seed: number): number {
  const x = Math.sin(seed) * 43758.5453123;
  return x - Math.floor(x);
}

function easeOutCubic(p: number): number {
  const c = Math.min(1, Math.max(0, p));
  return 1 - (1 - c) ** 3;
}

function easeOutQuad(p: number): number {
  const c = Math.min(1, Math.max(0, p));
  return 1 - (1 - c) ** 2;
}

/**
 * How far across the table the die is, nought to one.
 *
 * Rises to the wall on an ease-out — fast off the rail, slowing as it
 * arrives — then comes back off it onto the resting spot, losing the rest of
 * its energy on the way. The wall is always struck (`x` reaches exactly `1`)
 * and the rest is always short of it, which is what makes `furthest > final`
 * true of every throw rather than true by luck of the seed.
 */
function xAt(share: number, bounceAt: number, settleX: number): number {
  if (share <= bounceAt) {
    return easeOutCubic(share / bounceAt);
  }
  const after = (share - bounceAt) / (1 - bounceAt);
  return 1 - (1 - settleX) * easeOutQuad(after);
}

/**
 * How high the die is off the felt.
 *
 * Two hops, not one: the throw itself, and a smaller one off the wall as it
 * loses the rest of its energy — a die that drifted to a stop without ever
 * leaving the felt would read as a die being placed, not thrown.
 */
function yAt(share: number, bounceAt: number, hop: number): number {
  if (share <= bounceAt) {
    const p = share / bounceAt;
    return hop * 4 * p * (1 - p);
  }
  const after = (share - bounceAt) / (1 - bounceAt);
  return hop * 0.35 * 4 * after * (1 - after) ** 2;
}

/**
 * The whole throw, sampled every `FRAME_MS`.
 *
 * `face` only turns real on the last two samples — comfortably inside the
 * last three a die is allowed to show it on, whatever `ms` and `FRAME_MS`
 * work out to — because the point is not "near the end", it is "once the
 * dice have actually stopped".
 */
export function path(dice: Roll, which: 0 | 1, ms: number): Flight[] {
  const { bounceAt, settleX, turns, hop } = arcOf(dice, which);
  const face = dice[which];

  const at: number[] = [];
  for (let t = 0; t < ms; t += FRAME_MS) {
    at.push(t);
  }
  at.push(ms);

  return at.map((t, index): Flight => {
    const share = ms <= 0 ? 1 : t / ms;
    return {
      at: t,
      x: xAt(share, bounceAt, settleX),
      y: yAt(share, bounceAt, hop),
      turn: turns * easeOutCubic(share),
      face: index >= at.length - 2 ? face : null,
    };
  });
}
