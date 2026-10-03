import type { Card, CardColor, CardType } from "./cards.js";
import type { Game } from "./engine.js";

/** A seeded source, so a test that shuffles shuffles the same way every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let fresh = 10_000;

/** A card made outside any deck, with an id no deck will ever use. */
export function card(color: CardColor, type: CardType, value: number | null = null): Card {
  fresh += 1;
  return { id: fresh, color, type, value };
}

export const num = (color: CardColor, value: number) => card(color, "number", value);

/**
 * Sets a game up mid-round exactly as a test wants it: these hands, this card
 * on top, this player to act. The draw pile is left alone, so drawing still
 * works.
 */
export function stage(
  game: Game,
  setup: { hands: Card[][]; top: Card; current?: number; color?: Game["currentColor"] },
): void {
  setup.hands.forEach((hand, i) => {
    const player = game.players[i];
    if (player !== undefined) {
      player.hand = hand;
      player.unoDeclared = false;
    }
  });
  game.discardPile = [setup.top];
  game.currentColor =
    setup.color !== undefined ? setup.color : setup.top.color === "wild" ? "red" : setup.top.color;
  game.current = setup.current ?? 0;
  game.phase = "playing";
  game.pendingDraw = 0;
  game.pendingFrom = null;
  game.wd4 = null;
  game.unoVulnerable = null;
}
