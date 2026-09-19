/** How many colours the floor paints other players in. */
export const COLOURS = 8;
/** How many recent drops the floor remembers for somebody walking up. */
export const FEED_LENGTH = 12;
/** Drops one account may have waiting on the server at once; the next is refused. */
export const MAX_WAITING = 10;
/** Other players' balls drawn at once; past that they go straight to the feed. */
export const MAX_OTHERS = 30;
/** A hit worth a name tag over the bucket: 10×, in tenths. */
export const BIG_HIT = 100;

/**
 * A player's colour, from their account id, so a person is the same colour
 * every visit without anything being stored. FNV-1a: small, stable, and
 * spreads short ids well enough across eight.
 */
export function colourOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % COLOURS;
}
