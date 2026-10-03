import type { BotSkill } from "@backroom/core";
import type { Card, Color } from "./cards.js";
import { isWild, points, themeOf } from "./cards.js";
import type { Game } from "./engine.js";

/**
 * Somebody to play against for fun. Bots only sit at tables playing for
 * nothing — a bot has no account, so a game won against one for chips would
 * be chips out of thin air.
 *
 * Ported from the tabletop's bots, which played honestly: everything one
 * decides from is its own hand, the top card, and the card counts anybody at
 * the table can see.
 */

export interface Profile {
  smart: boolean;
  unoDeclare: number;
  lateDeclare: number;
  catchChance: number;
  jumpIn: number;
  challenge: number;
  bluff: number;
}

export const PROFILES: Record<BotSkill, Profile> = {
  easy: { smart: false, unoDeclare: 0.65, lateDeclare: 0.35, catchChance: 0.25, jumpIn: 0.25, challenge: 0.2, bluff: 0 },
  normal: { smart: true, unoDeclare: 0.9, lateDeclare: 0.6, catchChance: 0.55, jumpIn: 0.55, challenge: 0.3, bluff: 0 },
  hard: { smart: true, unoDeclare: 1, lateDeclare: 1, catchChance: 0.9, jumpIn: 0.85, challenge: 0.35, bluff: 0.2 },
};

export type Decision =
  | { type: "chooseColor"; color: Color }
  | { type: "challenge"; challenge: boolean }
  | { type: "pass" }
  | { type: "draw" }
  | { type: "play"; cardId: number; color?: Color; target?: number; declareUno?: boolean };

/** What a bot wants to do on its own turn, or null if it is not its turn. */
export function decide(game: Game, player: number, skill: BotSkill, rng: () => number): Decision | null {
  const profile = PROFILES[skill];
  switch (game.phase) {
    case "chooseColor":
      return { type: "chooseColor", color: game.bestColor(player) };
    case "challenge":
      return { type: "challenge", challenge: shouldChallenge(game, profile, rng) };
    case "postDraw": {
      const card = game.findCard(player, game.drawnCardId);
      if (
        card !== null &&
        game.canPlay(player, card) &&
        (game.rules.drawnCardPlay === "must" || !isBadBluff(game, player, card, profile, rng))
      ) {
        return playAction(game, player, card, profile, rng);
      }
      return { type: "pass" };
    }
    case "playing": {
      const playable = game.playableCards(player);
      if (playable.length === 0) return { type: "draw" };
      const card = chooseCard(game, player, playable, profile, rng);
      if (card === null && game.canDraw(player)) return { type: "draw" };
      return playAction(game, player, card ?? (playable[0] as Card), profile, rng);
    }
    default:
      return null;
  }
}

/** An illegal Wild Draw Four the bot does not want to risk. */
function isBadBluff(game: Game, player: number, card: Card, profile: Profile, rng: () => number): boolean {
  if (card.type !== "wild4" || game.rules.wd4Rule !== "challenge" || game.pendingDraw > 0) return false;
  const illegal = (game.players[player]?.hand ?? []).some(
    (one) => one.id !== card.id && one.color === game.currentColor,
  );
  return illegal && rng() >= profile.bluff;
}

function chooseCard(
  game: Game,
  player: number,
  playable: Card[],
  profile: Profile,
  rng: () => number,
): Card | null {
  if (!profile.smart) {
    const safe = playable.filter((card) => !isBadBluff(game, player, card, profile, rng));
    const pool = safe.length > 0 ? safe : playable;
    return pool[Math.floor(rng() * pool.length)] ?? null;
  }
  const me = game.players[player];
  if (me === undefined) return null;
  const n = game.players.length;
  const next = game.players[game.nextIndex(player)];
  const opponents = game.players.filter((one) => one.index !== player);
  const minOpp = Math.min(...opponents.map((one) => one.hand.length));
  const colorCounts = new Map<string, number>();
  for (const card of me.hand) {
    if (!isWild(card)) colorCounts.set(card.color, (colorCounts.get(card.color) ?? 0) + 1);
  }

  let best: Card | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const card of playable) {
    let s = 0;
    switch (card.type) {
      case "number":
        s += 10 + (card.value ?? 0) * 0.4;
        break;
      case "skip":
      case "reverse":
      case "draw2":
        s += 12;
        break;
      case "wild":
        s += 2;
        break;
      case "shuffle":
      case "dragon":
        s += me.hand.length > minOpp + 2 ? 30 : -10;
        break;
      case "cominThrough":
        s += 14;
        break;
      case "explosive":
      case "hurry":
        s += 11;
        break;
      case "blueYonder":
        s += game.pendingDraw > 0 ? 60 : 1; // saved as a shield
        break;
      case "punch":
        s += game.pendingDraw > 0 ? 70 : 1; // a counter beats a block
        break;
      case "escape":
      case "hotNumber":
        s += 10;
        break;
      case "littleHelp": {
        const top = game.top();
        s += top !== null && ["skip", "draw2", "wild4", "reverse"].includes(top.type) ? 16 : 3;
        break;
      }
      case "crossFade": {
        const giver = game.players[(player - Math.floor(n / 2) + n) % n];
        s += (giver?.hand.length ?? 0) < me.hand.length - 1 ? 22 : -12;
        break;
      }
      case "getDown": {
        const low = Math.min(...game.players.map((one) => one.hand.length));
        s += me.hand.length - 1 > low ? 22 : 4;
        break;
      }
      case "jdMachine":
        s += 4;
        break;
      case "experiment":
        s += 8;
        break;
      default:
        break;
    }
    // Hot Number makes standard Draw and Wild cards cost a card.
    if ((game.ext.jd?.hot ?? 0) > 0 && themeOf(card) === null && (card.type === "draw2" || isWild(card))) {
      s -= 8;
    }
    if (!isWild(card)) s += (colorCounts.get(card.color) ?? 0) * 2;

    // Attack a player close to going out.
    if ((next?.hand.length ?? 99) <= 2) {
      if (card.type === "draw2") s += 25;
      if (card.type === "wild4") s += 30;
      if (card.type === "skip") s += 20;
      if (card.type === "reverse" && n > 2) s += 15;
    }
    // Somebody is about to win: dump the expensive cards.
    if (minOpp <= 2) s += points(card) * 0.25;

    if (game.rules.sevenO && card.type === "number") {
      if (card.value === 7) s += minOpp < me.hand.length - 1 ? 25 : -15;
      if (card.value === 0) {
        const giver = game.players[game.nextIndex(player, 1, -game.direction)];
        s += (giver?.hand.length ?? 0) < me.hand.length - 1 ? 18 : -8;
      }
    }
    if (isBadBluff(game, player, card, profile, rng)) s -= 100;
    s += rng() * 3;
    if (s > bestScore) {
      bestScore = s;
      best = card;
    }
  }
  // The only thing left is a bluff it will not make.
  return bestScore < -50 ? null : best;
}

function playAction(game: Game, player: number, card: Card, profile: Profile, rng: () => number): Decision {
  const inputs = game.requiredInputs(player, card);
  const action: Decision = { type: "play", cardId: card.id };
  if (inputs.includes("color")) action.color = game.bestColor(player, card.id);
  if (inputs.includes("target")) action.target = game.fewestCards(player) ?? undefined;
  if (game.players[player]?.hand.length === 2) action.declareUno = rng() < profile.unoDeclare;
  return action;
}

function shouldChallenge(game: Game, profile: Profile, rng: () => number): boolean {
  let chance = profile.challenge;
  const offender = game.wd4 === null ? undefined : game.players[game.wd4.by];
  if (profile.smart && offender !== undefined) {
    // Big hands are likely to hold the colour; tiny ones are risky to challenge.
    if (offender.hand.length >= 6) chance += 0.15;
    if (offender.hand.length <= 2) chance -= 0.15;
  }
  return rng() < chance;
}

/**
 * Carries out a decision, falling back to something legal if the game refuses
 * it — whatever rules are in play, a bot's turn must end the turn.
 */
export function act(game: Game, player: number, decision: Decision): void {
  try {
    switch (decision.type) {
      case "play":
        game.playCard(player, decision.cardId, decision);
        return;
      case "draw":
        game.drawCard(player);
        return;
      case "pass":
        game.pass(player);
        return;
      case "challenge":
        game.respondChallenge(player, decision.challenge);
        return;
      case "chooseColor":
        game.chooseStartColor(player, decision.color);
        return;
    }
  } catch {
    neutralMove(game, player);
  }
}

/**
 * The move that decides nothing for somebody: what the clock does for a
 * player who ran out of time, and what a bot falls back on.
 *
 * Take the colour you hold most of, accept a Draw Four rather than gamble on
 * a challenge, keep a drawn card, and otherwise draw. Only when a house rule
 * forbids drawing is a card played for them, and then the first one that will
 * go — the rule leaves nothing else.
 */
export function neutralMove(game: Game, player: number): void {
  if (game.current !== player) return;
  switch (game.phase) {
    case "chooseColor":
      game.chooseStartColor(player, game.bestColor(player));
      return;
    case "challenge":
      game.respondChallenge(player, false);
      return;
    case "postDraw":
      if (game.canPass(player)) {
        game.pass(player);
        return;
      }
      break;
    case "playing":
      if (game.canDraw(player)) {
        game.drawCard(player);
        return;
      }
      break;
    default:
      return;
  }
  const card = game.playableCards(player)[0];
  if (card !== undefined) {
    game.playCard(player, card.id, {
      color: game.bestColor(player, card.id),
      target: game.fewestCards(player) ?? undefined,
    });
  }
}

/** How long a bot looks like it is thinking. */
export function thinkingTime(skill: BotSkill, rng: () => number, hurried: boolean): number {
  if (hurried) {
    return 700 + Math.floor(rng() * 900);
  }
  const base = skill === "hard" ? 900 : skill === "easy" ? 1400 : 1100;
  return base + Math.floor(rng() * 700);
}
