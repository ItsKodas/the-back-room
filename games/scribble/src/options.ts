import type { PackId } from "./words/index.js";
import { PACK_IDS } from "./words/index.js";
import { parseCustomWords } from "./words/rules.js";

export type Mode = "solo" | "teams";
export type HintLevel = "none" | "few" | "generous";

export const TEAM_COUNTS = [2, 3, 4] as const;
export const ROUNDS = [2, 3, 4, 5] as const;
export const DRAW_SECONDS = [60, 80, 120] as const;
export const HINT_LEVELS = ["none", "few", "generous"] as const;
export const SEAT_CHOICES = [4, 6, 8, 10] as const;
export const TEAM_NAMES = ["Blue", "Orange", "Violet", "Teal"] as const;
export const DEFAULT_PACKS: readonly PackId[] = ["everyday", "animals", "food"];
export const MIN_CUSTOM_ALONE = 10;

export interface ScribbleOptions {
  mode: Mode;
  teams: number;
  rounds: number;
  drawMs: number;
  hints: HintLevel;
  packs: PackId[];
  custom: string[];
  /** How many of the host's words were refused, so the setup screen can say. */
  skipped: number;
  onlyCustom: boolean;
}

function choose<T>(choices: readonly T[], value: unknown, fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

/**
 * The table's shape, from whatever the client sent.
 *
 * Snapped rather than trusted: these decide everybody's evening, and a client
 * naming its own draw time would be one player setting it for the rest.
 */
export function snapOptions(raw: unknown): ScribbleOptions {
  const given = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const asked = Array.isArray(given["packs"]) ? (given["packs"] as unknown[]) : [];
  const packs = PACK_IDS.filter((id) => asked.includes(id));
  const { words, skipped } = parseCustomWords(typeof given["custom"] === "string" ? given["custom"] : "");
  return {
    mode: given["mode"] === "teams" ? "teams" : "solo",
    teams: choose(TEAM_COUNTS, given["teams"], 2),
    rounds: choose(ROUNDS, given["rounds"], 3),
    drawMs: choose(DRAW_SECONDS, given["drawSeconds"], 80) * 1000,
    hints: choose(HINT_LEVELS, given["hints"], "few"),
    packs: packs.length > 0 ? packs : [...DEFAULT_PACKS],
    custom: words,
    skipped,
    onlyCustom: given["onlyCustom"] === true && words.length >= MIN_CUSTOM_ALONE,
  };
}

export function minimumPlayers(options: Pick<ScribbleOptions, "mode" | "teams">): number {
  return options.mode === "teams" ? options.teams * 2 : 3;
}
