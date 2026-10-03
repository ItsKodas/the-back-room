/**
 * Uno: match the colour or the number, and shout when you are down to one.
 *
 * The whole game in one package — the cards, the rules a host can set, the
 * engine, the table and its bots. It borrows seating, the ready button and the
 * shape of a table from @backroom/core and brings everything that makes it
 * this game.
 */
export type { Card, CardColor, CardType, Color, Theme } from "./cards.js";
export {
  CARD_TYPES,
  COLOR_NAMES,
  COLORS,
  compare,
  isColor,
  isWild,
  label,
  matchKey,
  points,
  POINTS,
  themeOf,
  TYPE_NAMES,
} from "./cards.js";
export type { Badge, Category, Input, Preset, RuleDef, RuleId, Rules } from "./rules.js";
export { CATEGORIES, describe, officialRules, presetOf, PRESETS, RULES, ruleDef, rulesetName, sanitize } from "./rules.js";
export type { Effect, EnginePhase, Peek, Player, RoundResult } from "./engine.js";
export { Game, UnoError } from "./engine.js";
export type { Decision, Profile } from "./bot.js";
export { decide, neutralMove, PROFILES, thinkingTime } from "./bot.js";
export {
  ANTE,
  anteFor,
  COUNTDOWN_MS,
  FUN_PURSE,
  RESULT_MS,
  ROUND_MS,
  STAKES,
  TURN_MS,
  UNO,
} from "./listing.js";
export type {
  EffectView,
  PeekView,
  Phase,
  RoundView,
  SeatView,
  TableView,
  YourHand,
} from "./table.js";
export { GONE_MS, Table } from "./table.js";
export { unoAdapter } from "./adapter.js";
