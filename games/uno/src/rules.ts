import type { Card, Color } from "./cards.js";
import { COLORS, isWild, label, themeOf } from "./cards.js";
import type { Game } from "./engine.js";

/**
 * Every rule the host can set, declared once.
 *
 * The setup panel is drawn from this list, so a rule appears there as soon as
 * it is defined; the engine reads the plain values, and a rule that adds
 * behaviour brings hooks which are only called while it is switched on:
 *
 *   deck(game, deck)                     -> deck     add cards when a round is dealt
 *   canPlay(game, ok, player, card)      -> boolean  veto (or allow) a play
 *   inputs(game, list, player, card)     -> list     extra choices a card needs: "color", "target"
 *   beforePlay(game, { player, card })               turn a card into something else as it is played
 *   onCardPlayed(game, ctx)                          side effects after a card is played, before
 *                                                    Skip/Reverse/Draw resolve; may set ctx.effect
 *                                                    or ctx.nextTurn. Not run on a winning card.
 *   onRoundStart(game)                               reset per-round state (kept in game.ext)
 *   onTurnStart(game, player)                        a turn begins; may set game.turnTimeLimit
 *   onDraw(game, { player, cards })                  somebody drew (not called for a deal)
 *   defersDraw(game, false)              -> boolean  Draw Two / Four wait for the target to answer
 *   badges(game, list)                   -> list     chips for the felt: { icon, text }
 *   hideCount(game, false, player)       -> boolean  hide somebody's card count from the others
 *
 * The values are checked by `sanitize` on the way in. A table's rules are the
 * host's, chosen once when it is opened, and a client that could name a value
 * outside the list would be setting them for everybody else at it.
 */

export type RuleValue = boolean | number | string;

export interface Rules {
  gameMode: "points" | "single";
  targetScore: number;
  scoringMode: "winner" | "penalty";
  handSize: number;
  wd4Rule: "challenge" | "strict" | "free";
  drawnCardPlay: "may" | "must" | "never";
  unoPenalty: number;
  stacking: "off" | "same" | "mixed";
  jumpIn: boolean;
  sevenO: boolean;
  drawUntilPlayable: boolean;
  mustPlay: boolean;
  shuffleHandsCard: boolean;
  noActionFinish: boolean;
  rabbids: boolean;
  rayman: boolean;
  justDance: boolean;
  hurrySeconds: number;
}

export type RuleId = keyof Rules;
export type Input = "color" | "target";

export interface Badge {
  icon: string;
  text: string;
}

export interface PlayContext {
  player: number;
  card: Card;
  opts: PlayOptions;
  /** Which built-in effect resolves: "skip", "reverse", "draw2", "wild4" or anything else. */
  effect: string;
  /** Whose turn is next, skipping the built-in effects, when a hook decides. */
  nextTurn: number | undefined;
}

export interface PlayOptions {
  color?: Color | undefined;
  target?: number | undefined;
  declareUno?: boolean | undefined;
}

export interface Hooks {
  deck?(game: Game, deck: Card[]): Card[];
  canPlay?(game: Game, ok: boolean, player: number, card: Card): boolean;
  inputs?(game: Game, list: Input[], player: number, card: Card): Input[];
  beforePlay?(game: Game, ctx: { player: number; card: Card; opts: PlayOptions }): void;
  onCardPlayed?(game: Game, ctx: PlayContext): void;
  onRoundStart?(game: Game): void;
  onTurnStart?(game: Game, player: number): void;
  onDraw?(game: Game, ctx: { player: number; cards: Card[] }): void;
  defersDraw?(game: Game, value: boolean): boolean;
  badges?(game: Game, list: Badge[]): Badge[];
  hideCount?(game: Game, hidden: boolean, player: number): boolean;
}

export type Category = "game" | "official" | "house" | "themes";

interface BaseDef {
  id: RuleId;
  category: Category;
  name: string;
  desc: string;
  /** Whether the control means anything given the rest of the rules. */
  enabledIf?: (rules: Rules) => boolean;
  hooks?: Hooks;
}

export type RuleDef =
  | (BaseDef & { type: "bool"; default: boolean })
  | (BaseDef & {
      type: "select";
      default: string;
      options: readonly { value: string; label: string }[];
    })
  | (BaseDef & { type: "number"; default: number; min: number; max: number; step: number });

export const CATEGORIES: readonly { id: Category; name: string }[] = [
  { id: "game", name: "Game" },
  { id: "official", name: "Official rules" },
  { id: "house", name: "House rules" },
  { id: "themes", name: "Theme decks" },
];

/* ------------------------------------------------------------ rule state */

/*
 * Each theme keeps its own scratch space on the game, reset every round. Typed
 * here rather than left as an open bag, so a hook that misspells its own state
 * is a compile error rather than a rule that quietly never fires.
 */
export interface Ext {
  rabbids?: { bomb: boolean; hurry: number };
  rayman?: { hidden: Record<number, boolean> };
  jd?: { hot: number };
}

const rabbidsState = (game: Game) => {
  game.ext.rabbids ??= { bomb: false, hurry: 0 };
  return game.ext.rabbids;
};
const raymanState = (game: Game) => {
  game.ext.rayman ??= { hidden: {} };
  return game.ext.rayman;
};
const jdState = (game: Game) => {
  game.ext.jd ??= { hot: 0 };
  return game.ext.jd;
};

const isThemeCard = (card: Card) => themeOf(card) !== null;
const pick = <T>(game: Game, list: readonly T[]): T =>
  list[Math.floor(game.rng() * list.length)] as T;

/** A target somebody named, or the player holding the fewest cards. */
const targetOf = (game: Game, player: number, asked: unknown): number =>
  Number.isInteger(asked) &&
  (asked as number) >= 0 &&
  (asked as number) < game.players.length &&
  asked !== player
    ? (asked as number)
    : (game.fewestCards(player) as number);

const EXPERIMENTS = [
  { id: "skip", text: "Skip!" },
  { id: "reverse", text: "Reverse!" },
  { id: "draw2", text: "Draw Two!" },
  { id: "allDraw", text: "Everyone else draws 1!" },
  { id: "swap", text: "Random hand swap!" },
] as const;

/* ------------------------------------------------------------- the rules */

export const RULES: readonly RuleDef[] = [
  /* --- Game */
  {
    id: "gameMode",
    category: "game",
    type: "select",
    default: "points",
    name: "Game length",
    desc: "Official: play rounds until someone reaches the target score.",
    options: [
      { value: "points", label: "Play to target score" },
      { value: "single", label: "Single round" },
    ],
  },
  {
    id: "targetScore",
    category: "game",
    type: "number",
    default: 500,
    min: 50,
    max: 5000,
    step: 50,
    name: "Target score",
    desc: "Official: 500 points.",
    enabledIf: (rules) => rules.gameMode === "points",
  },
  {
    id: "scoringMode",
    category: "game",
    type: "select",
    default: "winner",
    name: "Scoring",
    desc: "Official: the round winner scores the cards left in everyone else's hands. The alternate official method has each player keep their own leftover points, and when someone hits the target the lowest score wins.",
    options: [
      { value: "winner", label: "Winner collects points" },
      { value: "penalty", label: "Alternate: lowest score wins" },
    ],
  },
  {
    id: "handSize",
    category: "game",
    type: "number",
    default: 7,
    min: 3,
    max: 12,
    step: 1,
    name: "Starting hand",
    desc: "Official: 7 cards each.",
  },

  /* --- Official */
  {
    id: "wd4Rule",
    category: "official",
    type: "select",
    default: "challenge",
    name: "Wild Draw Four",
    desc: "Official: only legal when you hold no card of the current colour, but you may bluff and the next player may challenge. Guilty: you draw 4 instead. Innocent: the challenger draws 6.",
    options: [
      { value: "challenge", label: "Official (bluff & challenge)" },
      { value: "strict", label: "Enforced (no bluffing)" },
      { value: "free", label: "Play any time" },
    ],
  },
  {
    id: "drawnCardPlay",
    category: "official",
    type: "select",
    default: "may",
    name: "Playing a drawn card",
    desc: "Official: if the card you draw is playable you may play it immediately; otherwise your turn ends.",
    options: [
      { value: "may", label: "May play it (official)" },
      { value: "must", label: "Must play it" },
      { value: "never", label: "Drawing ends your turn" },
    ],
  },
  {
    id: "unoPenalty",
    category: "official",
    type: "number",
    default: 2,
    min: 0,
    max: 10,
    step: 1,
    name: "UNO penalty",
    desc: "Official: forget to call UNO on your second-to-last card and get caught before the next player acts, and you draw 2. Set to 0 to turn off call-outs.",
  },

  /* --- Themes */
  {
    id: "rabbids",
    category: "themes",
    type: "bool",
    default: false,
    name: "Rabbids deck",
    desc: "Comin' Through: 5 cards are dealt at random to your opponents, then 5 more at random to everyone. Explosive Results: the next player to draw, for any reason, draws 3 extra. Hurry Up!: for the next lap of turns, everyone has a few seconds to finish or draws a card and is skipped. Wild Blue Yonder: blocks a Draw Two or Wild Draw Four aimed at you, or plays as a normal Wild.",
    hooks: {
      deck(game, deck) {
        for (const color of COLORS) {
          deck.push(
            game.cards.make(color, "cominThrough"),
            game.cards.make(color, "explosive"),
            game.cards.make(color, "hurry"),
          );
        }
        for (let i = 0; i < 4; i += 1) {
          deck.push(game.cards.make("wild", "blueYonder"));
        }
        return deck;
      },
      onRoundStart(game) {
        game.ext.rabbids = { bomb: false, hurry: 0 };
      },
      // Draw penalties wait so the target can answer with Wild Blue Yonder.
      defersDraw: () => true,
      canPlay(game, ok, _player, card) {
        return ok || (card.type === "blueYonder" && game.pendingDraw > 0);
      },
      onCardPlayed(game, { player, card }) {
        const state = rabbidsState(game);
        const name = game.nameOf(player);
        switch (card.type) {
          case "blueYonder":
            if (game.pendingDraw > 0) {
              game.log(`${name} blocks the +${game.pendingDraw}!`);
              game.effect("block", `Blocked! ${name} dodges +${game.pendingDraw}`, player);
              game.pendingDraw = 0;
              game.pendingFrom = null;
              game.wd4 = null;
            }
            break;
          case "cominThrough": {
            const others = game.players.filter((one) => one.index !== player).map((one) => one.index);
            const all = game.players.map((one) => one.index);
            for (let i = 0; i < 5; i += 1) game.drawCards(pick(game, others), 1, { silent: true });
            for (let i = 0; i < 5; i += 1) game.drawCards(pick(game, all), 1, { silent: true });
            game.log("Comin' Through! 10 cards are flung around the table.");
            game.effect("rabbids", "Comin' Through!", player);
            break;
          }
          case "explosive":
            state.bomb = true;
            game.log("Explosive Results: the next player to draw takes 3 extra.");
            game.effect("rabbids", "Explosive Results! 💣", player);
            break;
          case "hurry":
            state.hurry = game.players.length;
            game.log(
              `Hurry Up! ${game.rules.hurrySeconds} seconds per turn for the next ${state.hurry} turns.`,
            );
            game.effect("rabbids", "Hurry Up! ⏱", player);
            break;
        }
      },
      onDraw(game, { player }) {
        const state = rabbidsState(game);
        if (!state.bomb) {
          return;
        }
        state.bomb = false;
        game.drawCards(player, 3, { silent: true });
        game.log(`💥 ${game.nameOf(player)} sets off the explosion and draws 3 more!`);
        game.effect("explode", `💥 ${game.nameOf(player)} +3!`, player);
      },
      onTurnStart(game) {
        const state = rabbidsState(game);
        if (state.hurry > 0) {
          state.hurry -= 1;
          game.turnTimeLimit = game.rules.hurrySeconds;
        }
      },
      badges(game, list) {
        const state = rabbidsState(game);
        if (state.bomb) list.push({ icon: "💣", text: "Next draw +3" });
        if (state.hurry > 0 || game.turnTimeLimit !== null) {
          list.push({
            icon: "⏱",
            text: state.hurry > 0 ? `Hurry Up! ${state.hurry} more` : "Hurry Up! last turn",
          });
        }
        return list;
      },
    },
  },
  {
    id: "rayman",
    category: "themes",
    type: "bool",
    default: false,
    name: "Rayman deck",
    desc: "Dragon: every hand is gathered and dealt back out evenly. Escape: peek at a player's hand, then your card count is hidden until you're down to your last card. Punching Things: swat a Draw Two or Wild Draw Four back at whoever played it, for double the penalty (or play it as a Wild). A Little Help: becomes a copy of the top card, effect and all.",
    hooks: {
      deck(game, deck) {
        for (const color of COLORS) {
          deck.push(game.cards.make(color, "dragon"), game.cards.make(color, "escape"));
        }
        for (let i = 0; i < 4; i += 1) {
          deck.push(game.cards.make("wild", "punch"), game.cards.make("wild", "littleHelp"));
        }
        return deck;
      },
      onRoundStart(game) {
        game.ext.rayman = { hidden: {} };
      },
      defersDraw: () => true,
      canPlay(game, ok, player, card) {
        if (
          ok &&
          card.type === "littleHelp" &&
          game.rules.wd4Rule === "strict" &&
          game.pendingDraw === 0
        ) {
          // Copying a Wild Draw Four obeys the same "no matching colour" rule.
          const top = game.top();
          if (
            top !== null &&
            top.type === "wild4" &&
            game.players[player]?.hand.some((one) => one.id !== card.id && one.color === game.currentColor)
          ) {
            return false;
          }
        }
        return (
          ok ||
          (card.type === "punch" &&
            game.pendingDraw > 0 &&
            game.pendingFrom !== null &&
            game.pendingFrom !== player)
        );
      },
      inputs(game, list, _player, card) {
        if (card.type === "escape") list.push("target");
        if (card.type === "littleHelp") {
          // Copying a coloured card takes its colour; only copying a Wild needs a choice.
          const top = game.top();
          if (top !== null && !isWild(top)) return list.filter((one) => one !== "color");
        }
        return list;
      },
      beforePlay(game, { card }) {
        if (card.type !== "littleHelp") return;
        const top = game.top();
        if (top === null) return;
        card.original = { color: card.color, type: card.type, value: card.value };
        card.clone = "littleHelp";
        card.color = top.color;
        card.type = top.type;
        card.value = top.value;
      },
      onCardPlayed(game, ctx) {
        const { player, card, opts } = ctx;
        const name = game.nameOf(player);
        if (card.clone === "littleHelp") {
          game.effect("rayman", `A Little Help! (${label({ ...card, clone: undefined })})`, player);
        }
        switch (card.type) {
          case "dragon":
            game.redealHands(game.nextIndex(player));
            game.log("The Dragon swallows every hand and spits the cards back out!");
            game.effect("rayman", "Dragon! 🐉", player);
            break;
          case "escape": {
            const target = targetOf(game, player, opts.target);
            raymanState(game).hidden[player] = true;
            game.log(`${name} peeks at ${game.nameOf(target)}'s hand and slips out of sight.`);
            game.effect("rayman", `${name} escapes!`, player);
            game.reveal(player, target);
            break;
          }
          case "punch":
            if (game.pendingDraw > 0 && game.pendingFrom !== null) {
              const back = game.pendingFrom;
              game.pendingDraw *= 2;
              game.wd4 = null;
              game.pendingFrom = player;
              game.log(`${name} punches the draw back at ${game.nameOf(back)}: +${game.pendingDraw}!`);
              game.effect(
                "rayman",
                `Punched back! +${game.pendingDraw} on ${game.nameOf(back)}`,
                player,
              );
              ctx.nextTurn = back;
            }
            break;
        }
      },
      hideCount(game, hidden, player) {
        const state = raymanState(game);
        if (state.hidden[player] && (game.players[player]?.hand.length ?? 0) <= 1) {
          delete state.hidden[player];
        }
        return hidden || state.hidden[player] === true;
      },
    },
  },
  {
    id: "justDance",
    category: "themes",
    type: "bool",
    default: false,
    name: "Just Dance deck",
    desc: "Cross-Fade: every player swaps hands with the player across the table. Get Down: everyone except the player with the fewest cards discards at random down to that count. Hot Number: for a lap of turns, playing a Draw Two, Wild Draw Four or Wild costs you a card. Just Dance Machine: everyone gets an Experiment card, a Wild with a random effect.",
    hooks: {
      deck(game, deck) {
        for (const color of COLORS) {
          deck.push(
            game.cards.make(color, "crossFade"),
            game.cards.make(color, "getDown"),
            game.cards.make(color, "hotNumber"),
            game.cards.make(color, "jdMachine"),
          );
        }
        return deck;
      },
      onRoundStart(game) {
        game.ext.jd = { hot: 0 };
      },
      onCardPlayed(game, ctx) {
        const { player, card } = ctx;
        const state = jdState(game);
        const n = game.players.length;
        if (state.hot > 0 && !isThemeCard(card) && (card.type === "draw2" || isWild(card))) {
          game.drawCards(player, 1);
          game.log(`Hot Number! ${game.nameOf(player)} draws 1 for playing ${label(card)}.`);
          game.effect("jd", `Hot Number! ${game.nameOf(player)} +1`, player);
        }
        switch (card.type) {
          case "crossFade": {
            const k = Math.floor(n / 2);
            const hands = game.players.map((one) => one.hand);
            hands.forEach((hand, i) => {
              (game.players[(i + k) % n] as { hand: Card[] }).hand = hand;
            });
            game.handsChanged();
            game.log("Cross-Fade! Everyone swaps hands across the table.");
            game.effect("jd", "Cross-Fade!", player);
            break;
          }
          case "getDown": {
            const low = Math.min(...game.players.map((one) => one.hand.length));
            for (const one of game.players) game.discardRandom(one.index, one.hand.length - low);
            game.handsChanged();
            game.log(`Get Down! Everyone drops to ${low} card${low === 1 ? "" : "s"}.`);
            game.effect("jd", `Get Down! Everyone to ${low}`, player);
            break;
          }
          case "hotNumber":
            state.hot = n;
            game.log("Hot Number! For a lap, Draw and Wild cards cost a card.");
            game.effect("jd", "Hot Number! 🔥", player);
            break;
          case "jdMachine":
            for (const one of game.players) game.giveNewCard(one.index, "wild", "experiment");
            game.log("Just Dance Machine! Everyone gets an Experiment card.");
            game.effect("jd", "Just Dance Machine! 🧪", player);
            break;
          case "experiment": {
            const ex = pick(game, EXPERIMENTS);
            game.log(`The Experiment goes: ${ex.text}`);
            game.effect("jd", `Experiment: ${ex.text}`, player);
            if (ex.id === "skip" || ex.id === "reverse" || ex.id === "draw2") ctx.effect = ex.id;
            if (ex.id === "allDraw") {
              for (const one of game.players) if (one.index !== player) game.drawCards(one.index, 1);
            }
            if (ex.id === "swap") {
              const others = game.players.filter((one) => one.index !== player);
              game.swapHands(player, pick(game, others).index);
            }
            break;
          }
        }
      },
      onTurnStart(game) {
        const state = jdState(game);
        if (state.hot > 0) state.hot -= 1;
      },
      badges(game, list) {
        const state = jdState(game);
        if (state.hot > 0) list.push({ icon: "🔥", text: `Hot Number: ${state.hot} turns` });
        return list;
      },
    },
  },
  {
    id: "hurrySeconds",
    category: "themes",
    type: "number",
    default: 3,
    min: 2,
    max: 15,
    step: 1,
    name: "Hurry Up! time limit",
    desc: "Seconds per turn while Hurry Up! is active (Ubisoft uses 3).",
    enabledIf: (rules) => rules.rabbids,
  },

  /* --- House */
  {
    id: "stacking",
    category: "house",
    type: "select",
    default: "off",
    name: "Stacking",
    desc: "Answer a Draw card with another to pass the total on. The player who can't (or won't) stack draws everything.",
    options: [
      { value: "off", label: "Off (official)" },
      { value: "same", label: "+2 on +2, +4 on +4" },
      { value: "mixed", label: "Also +4 on +2" },
    ],
  },
  {
    id: "jumpIn",
    category: "house",
    type: "bool",
    default: false,
    name: "Jump-in",
    desc: "Hold the exact same card (colour and symbol) as the top of the discard pile? Play it out of turn, and play continues from you.",
  },
  {
    id: "sevenO",
    category: "house",
    type: "bool",
    default: false,
    name: "Seven-O",
    desc: "Playing a 7 swaps your hand with a player of your choice. Playing a 0 passes every hand to the next player in the direction of play.",
    hooks: {
      inputs(_game, list, _player, card) {
        if (card.type === "number" && card.value === 7) list.push("target");
        return list;
      },
      onCardPlayed(game, { player, card, opts }) {
        if (card.type !== "number") return;
        if (card.value === 7) {
          const target = targetOf(game, player, opts.target);
          game.swapHands(player, target);
          game.log(`${game.nameOf(player)} swaps hands with ${game.nameOf(target)}.`);
          game.effect("swap", `${game.nameOf(player)} ⇄ ${game.nameOf(target)}`, player);
        } else if (card.value === 0) {
          game.rotateHands();
          game.log("Everyone passes their hand along.");
          game.effect("rotate", "Hands rotate!", player);
        }
      },
    },
  },
  {
    id: "drawUntilPlayable",
    category: "house",
    type: "bool",
    default: false,
    name: "Draw until playable",
    desc: "When you draw, keep drawing until you get a card you can play.",
  },
  {
    id: "mustPlay",
    category: "house",
    type: "bool",
    default: false,
    name: "Must play if able",
    desc: "You may only draw when you have no playable card. (Officially you may always choose to draw.)",
  },
  {
    id: "shuffleHandsCard",
    category: "house",
    type: "bool",
    default: false,
    name: "Wild Shuffle Hands card",
    desc: "Adds the Wild Shuffle Hands card from the 2018 deck (40 points): all hands are gathered, shuffled and dealt back out starting with the next player.",
    hooks: {
      deck(game, deck) {
        deck.push(game.cards.make("wild", "shuffle"));
        return deck;
      },
      onCardPlayed(game, { player, card }) {
        if (card.type !== "shuffle") return;
        game.redealHands(game.nextIndex(player));
        game.log("All hands are shuffled and dealt back out.");
        game.effect("shuffle", "Hands shuffled!", player);
      },
    },
  },
  {
    id: "noActionFinish",
    category: "house",
    type: "bool",
    default: false,
    name: "No action finish",
    desc: "Your last card must be a number card. You can't go out on an action or Wild card.",
    hooks: {
      canPlay(game, ok, player, card) {
        const hand = game.players[player]?.hand ?? [];
        if (ok && hand.length === 1 && hand[0]?.id === card.id && card.type !== "number") {
          return false;
        }
        return ok;
      },
    },
  },
];

const byId = new Map(RULES.map((rule) => [rule.id, rule]));

export const ruleDef = (id: RuleId): RuleDef | undefined => byId.get(id);

/** The official rules: every rule at its default, which is what the box says. */
export function officialRules(): Rules {
  const out: Record<string, RuleValue> = {};
  for (const rule of RULES) {
    out[rule.id] = rule.default;
  }
  return out as unknown as Rules;
}

export const isOn = (value: RuleValue): boolean => value !== false && value !== "off" && value !== 0;

/**
 * Rules from whatever arrived, every value checked against its definition.
 *
 * Anything unknown is dropped and anything out of range falls back or is
 * clamped, so the result is always a ruleset the engine can play.
 */
export function sanitize(raw: unknown): Rules {
  const given = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const out = officialRules() as unknown as Record<string, RuleValue>;
  for (const rule of RULES) {
    if (!(rule.id in given)) {
      continue;
    }
    const value = given[rule.id];
    if (rule.type === "bool") {
      out[rule.id] = value === true;
    } else if (rule.type === "select") {
      out[rule.id] = rule.options.some((one) => one.value === value) ? (value as string) : rule.default;
    } else {
      const n = typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
      out[rule.id] = Number.isNaN(n)
        ? rule.default
        : Math.min(rule.max, Math.max(rule.min, Math.round(n / rule.step) * rule.step));
    }
  }
  return out as unknown as Rules;
}

/** The value of one rule as a person would say it. */
export function describe(rules: Rules, rule: RuleDef): string {
  const value = rules[rule.id];
  if (rule.type === "bool") return value ? "On" : "Off";
  if (rule.type === "select") return rule.options.find((one) => one.value === value)?.label ?? String(value);
  return String(value);
}

/* ------------------------------------------------------------ the presets */

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  rules: () => Rules;
}

/**
 * The game modes, as the tabletop shipped them: a starting point for the
 * toggles rather than a separate thing, so a host can pick one and still turn
 * any single rule up or down.
 */
export const PRESETS: readonly Preset[] = [
  {
    id: "official",
    name: "Official",
    blurb: "The rules in the box.",
    rules: () => officialRules(),
  },
  {
    id: "party",
    name: "House party",
    blurb: "Stacking, jump-in, Seven-O and the Shuffle Hands card.",
    rules: () => ({
      ...officialRules(),
      stacking: "mixed",
      jumpIn: true,
      sevenO: true,
      shuffleHandsCard: true,
    }),
  },
  {
    id: "rabbids",
    name: "Rabbids",
    blurb: "Official rules with the Rabbids cards shuffled in.",
    rules: () => ({ ...officialRules(), rabbids: true }),
  },
  {
    id: "rayman",
    name: "Rayman",
    blurb: "Official rules with the Rayman cards shuffled in.",
    rules: () => ({ ...officialRules(), rayman: true }),
  },
  {
    id: "justDance",
    name: "Just Dance",
    blurb: "Official rules with the Just Dance cards shuffled in.",
    rules: () => ({ ...officialRules(), justDance: true }),
  },
];

/** The preset these rules are exactly, if they are one. */
export function presetOf(rules: Rules): Preset | null {
  return (
    PRESETS.find((preset) => {
      const want = preset.rules();
      return RULES.every((rule) => want[rule.id] === rules[rule.id]);
    }) ?? null
  );
}

/** How a ruleset is named on the history: its preset, or that it was the host's own. */
export const rulesetName = (rules: Rules): string => presetOf(rules)?.name ?? "House rules";

/* ------------------------------------------------------------ hook calls */

/** Chains a value through every switched-on rule's hook. */
export function filter<K extends "deck" | "canPlay" | "inputs" | "defersDraw" | "badges" | "hideCount">(
  game: Game,
  hook: K,
  value: ReturnType<NonNullable<Hooks[K]>>,
  ...args: Hooks[K] extends ((game: Game, value: never, ...rest: infer R) => unknown) | undefined
    ? R
    : never
): ReturnType<NonNullable<Hooks[K]>> {
  let out = value;
  for (const rule of RULES) {
    const fn = rule.hooks?.[hook] as
      | ((game: Game, value: unknown, ...rest: unknown[]) => typeof out)
      | undefined;
    if (fn !== undefined && isOn(game.rules[rule.id])) {
      out = fn(game, out, ...args);
    }
  }
  return out;
}

/** Calls a side-effect hook on every switched-on rule. */
export function call<K extends "beforePlay" | "onCardPlayed" | "onRoundStart" | "onTurnStart" | "onDraw">(
  game: Game,
  hook: K,
  ...args: Hooks[K] extends ((game: Game, ...rest: infer R) => void) | undefined ? R : never
): void {
  for (const rule of RULES) {
    const fn = rule.hooks?.[hook] as ((game: Game, ...rest: unknown[]) => void) | undefined;
    if (fn !== undefined && isOn(game.rules[rule.id])) {
      fn(game, ...args);
    }
  }
}

