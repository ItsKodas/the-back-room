import type { Card, CardColor, CardType, Color } from "./cards.js";
import { CardMaker, COLORS, isColor, isWild, label, matchKey, points, shuffle } from "./cards.js";
import type { Badge, Ext, Input, PlayContext, PlayOptions, Rules } from "./rules.js";
import { call, filter, sanitize } from "./rules.js";

/**
 * One game of Uno, from the first deal to a champion. No seats, no clock, no
 * chips — players are indices, and the table maps them to seats.
 *
 * Every action validates and either changes the game or throws an
 * {@link UnoError} saying why not, which the table hands to the player as a
 * refusal. Ported from the tabletop engine's rules one for one; what changed
 * is the plumbing round them.
 *
 * Phases:
 *   chooseColor  the round opened on a Wild; the first player picks a colour
 *   playing      the current player plays or draws
 *   postDraw     they drew a playable card and may play it or keep it
 *   challenge    a Wild Draw Four was played; the next player challenges or takes it
 *   roundOver / gameOver
 */

export type EnginePhase = "chooseColor" | "playing" | "postDraw" | "challenge" | "roundOver" | "gameOver";

const TURN_PHASES: readonly EnginePhase[] = ["playing", "postDraw"];
export const ACTIVE_PHASES: readonly EnginePhase[] = ["playing", "postDraw", "challenge", "chooseColor"];

export class UnoError extends Error {}

export interface Player {
  index: number;
  name: string;
  hand: Card[];
  score: number;
  unoDeclared: boolean;
}

/**
 * Something that just happened, for the felt to show as it happens.
 *
 * Numbered so the client can tell this one from the last even when the words
 * are the same — two Skips in a row are two things.
 */
export interface Effect {
  seq: number;
  kind: string;
  text: string;
  player: number | null;
}

/** Escape's peek: a hand shown to one player and nobody else. */
export interface Peek {
  seq: number;
  to: number;
  target: number;
  cards: Card[];
}

export interface RoundResult {
  round: number;
  winner: number;
  handPoints: number[];
  gained: number[];
  gameOver: boolean;
  champion: number | null;
}

export interface Wd4 {
  by: number;
  illegal: boolean;
  color: Color | null;
}

/** How many effects the felt is ever sent. Enough to cover one busy turn. */
const EFFECT_WINDOW = 12;

export class Game {
  readonly rng: () => number;
  readonly rules: Rules;
  readonly players: Player[];
  readonly cards = new CardMaker();

  round = 0;
  dealer: number;
  /** 1 is clockwise, to the left; -1 is back the other way. */
  direction: 1 | -1 = 1;
  current = 0;
  phase: EnginePhase = "roundOver";
  drawPile: Card[] = [];
  discardPile: Card[] = [];
  currentColor: Color | null = null;
  /** Cards owed by the current player: a Draw Four, or a stack. */
  pendingDraw = 0;
  /** Who played the latest card adding to `pendingDraw`. */
  pendingFrom: number | null = null;
  /** While a Wild Draw Four can be challenged. */
  wd4: Wd4 | null = null;
  drawnCardId: number | null = null;
  /** Who can be caught for not calling UNO, if anybody. */
  unoVulnerable: number | null = null;
  /** Moves on every time a catch window opens. */
  unoWindow = 0;
  lastRound: RoundResult | null = null;
  champion: number | null = null;
  /** Moves on every time a turn begins. */
  turn = 0;
  /** Seconds allowed for this turn, when a rule such as Hurry Up! sets one. */
  turnTimeLimit: number | null = null;
  /** Per-round scratch space for rule hooks. */
  ext: Ext = {};
  /** Cards made mid-round by a rule (Experiment cards), so a count can still balance. */
  createdCards = 0;
  effects: Effect[] = [];
  peek: Peek | null = null;
  logLines: string[] = [];
  /** Every line ever logged, counted, so a caller can ask what is new since a move. */
  logTotal = 0;
  private seq = 0;

  constructor(options: { players: readonly string[]; rules?: unknown; rng: () => number; dealer?: number }) {
    const n = options.players.length;
    if (n < 2 || n > 10) {
      throw new UnoError("Uno needs two to ten players.");
    }
    this.rng = options.rng;
    this.rules = sanitize(options.rules);
    this.players = options.players.map((name, index) => ({
      index,
      name,
      hand: [],
      score: 0,
      unoDeclared: false,
    }));
    this.dealer = options.dealer ?? Math.floor(this.rng() * n);
  }

  /* --------------------------------------------------------------- telling */

  /** What has been logged since `mark`, as far back as the log still reaches. */
  linesSince(mark: number): string[] {
    const fresh = this.logTotal - mark;
    return fresh <= 0 ? [] : this.logLines.slice(-fresh);
  }

  log(text: string): void {
    this.logLines.push(text);
    this.logTotal += 1;
    if (this.logLines.length > 40) {
      this.logLines.shift();
    }
  }

  effect(kind: string, text: string, player: number | null = null): void {
    this.seq += 1;
    this.effects.push({ seq: this.seq, kind, text, player });
    if (this.effects.length > EFFECT_WINDOW) {
      this.effects.shift();
    }
  }

  /** Shows one player another's hand, as it is now. */
  reveal(to: number, target: number): void {
    this.seq += 1;
    this.peek = { seq: this.seq, to, target, cards: (this.players[target]?.hand ?? []).slice() };
  }

  nameOf(player: number): string {
    return this.players[player]?.name ?? "Somebody";
  }

  /* --------------------------------------------------------------- asking */

  top(): Card | null {
    return this.discardPile[this.discardPile.length - 1] ?? null;
  }

  get totalCards(): number {
    return (
      this.drawPile.length +
      this.discardPile.length +
      this.players.reduce((sum, one) => sum + one.hand.length, 0)
    );
  }

  get over(): boolean {
    return this.phase === "gameOver";
  }

  get betweenRounds(): boolean {
    return this.phase === "roundOver";
  }

  get active(): boolean {
    return ACTIVE_PHASES.includes(this.phase);
  }

  nextIndex(from: number, steps = 1, dir: number = this.direction): number {
    const n = this.players.length;
    return (((from + dir * steps) % n) + n) % n;
  }

  fewestCards(exclude: number | null): number | null {
    let best: number | null = null;
    for (const one of this.players) {
      if (one.index === exclude) continue;
      if (best === null || one.hand.length < (this.players[best] as Player).hand.length) {
        best = one.index;
      }
    }
    return best;
  }

  isCountHidden(player: number): boolean {
    return filter(this, "hideCount", false, player);
  }

  findCard(player: number, cardId: unknown): Card | null {
    return this.players[player]?.hand.find((card) => card.id === cardId) ?? null;
  }

  canPlay(player: number, card: Card | null): boolean {
    if (card === null || !TURN_PHASES.includes(this.phase)) return false;
    if (this.phase === "postDraw" && card.id !== this.drawnCardId) return false;
    let ok = this.pendingDraw > 0 ? this.canStack(card) : this.matches(card);
    if (
      ok &&
      card.type === "wild4" &&
      this.rules.wd4Rule === "strict" &&
      this.pendingDraw === 0 &&
      this.hasColor(player, this.currentColor, card.id)
    ) {
      ok = false;
    }
    return filter(this, "canPlay", ok, player, card);
  }

  playableCards(player: number): Card[] {
    return (this.players[player]?.hand ?? []).filter((card) => this.canPlay(player, card));
  }

  canJumpIn(player: number, card: Card | null): boolean {
    const top = this.top();
    if (!this.rules.jumpIn || card === null || top === null || player === this.current) return false;
    if (!TURN_PHASES.includes(this.phase) || this.pendingDraw > 0) return false;
    if (isWild(card) || isWild(top) || card.color !== top.color || matchKey(card) !== matchKey(top)) {
      return false;
    }
    if (this.findCard(player, card.id) === null) return false;
    return filter(this, "canPlay", true, player, card);
  }

  canDraw(player: number): boolean {
    if (this.phase !== "playing" || player !== this.current) return false;
    if (this.pendingDraw === 0 && this.rules.mustPlay && this.playableCards(player).length > 0) {
      return false;
    }
    return true;
  }

  canPass(player: number): boolean {
    return this.phase === "postDraw" && player === this.current && this.rules.drawnCardPlay !== "must";
  }

  canDeclareUno(player: number): boolean {
    const one = this.players[player];
    if (one === undefined) return false;
    if (this.unoVulnerable === player) return true;
    return (
      TURN_PHASES.includes(this.phase) &&
      one.hand.length === 2 &&
      !one.unoDeclared &&
      (player === this.current || this.rules.jumpIn)
    );
  }

  canCatch(caller: number, target: number): boolean {
    return this.unoVulnerable === target && caller !== target && this.rules.unoPenalty > 0;
  }

  /** Extra choices a card needs before it can be played. */
  requiredInputs(player: number, card: Card): Input[] {
    const list: Input[] = isWild(card) ? ["color"] : [];
    return filter(this, "inputs", list, player, card);
  }

  badges(): Badge[] {
    return filter(this, "badges", []);
  }

  bestColor(player: number, excludeId: number | null = null): Color {
    const counts = new Map<CardColor, number>();
    for (const card of this.players[player]?.hand ?? []) {
      if (card.id !== excludeId && !isWild(card)) {
        counts.set(card.color, (counts.get(card.color) ?? 0) + 1);
      }
    }
    let best: Color[] = [];
    let max = 0;
    for (const color of COLORS) {
      const n = counts.get(color) ?? 0;
      if (n > max) {
        max = n;
        best = [color];
      } else if (n === max) {
        best.push(color);
      }
    }
    return best[Math.floor(this.rng() * best.length)] as Color;
  }

  private matches(card: Card): boolean {
    if (isWild(card) || card.color === this.currentColor) return true;
    const top = this.top();
    return top !== null && !isWild(top) && matchKey(top) === matchKey(card);
  }

  private canStack(card: Card): boolean {
    const mode = this.rules.stacking;
    const top = this.top();
    if (mode === "off" || top === null) return false;
    if (top.type === "draw2") return card.type === "draw2" || (mode === "mixed" && card.type === "wild4");
    if (top.type === "wild4") return card.type === "wild4";
    return false;
  }

  private hasColor(player: number, color: Color | null, excludeId: number): boolean {
    return (this.players[player]?.hand ?? []).some((card) => card.id !== excludeId && card.color === color);
  }

  /* -------------------------------------------------------- moving cards */

  /** `silent`: the cards are dealt rather than drawn, so onDraw hooks are not told. */
  drawCards(player: number, n: number, opts: { silent?: boolean } = {}): Card[] {
    const one = this.players[player] as Player;
    const got: Card[] = [];
    for (let i = 0; i < n; i += 1) {
      if (this.drawPile.length === 0) this.reshuffle();
      const card = this.drawPile.pop();
      if (card === undefined) break;
      one.hand.push(card);
      got.push(card);
    }
    if (got.length > 0) {
      one.unoDeclared = false;
      if (this.unoVulnerable === player) this.unoVulnerable = null;
      if (opts.silent !== true) call(this, "onDraw", { player, cards: got });
    }
    return got;
  }

  private reshuffle(): void {
    if (this.discardPile.length <= 1) return;
    const top = this.discardPile.pop() as Card;
    // Cards that changed identity when played turn back into themselves.
    for (const card of this.discardPile) {
      if (card.original !== undefined) {
        Object.assign(card, card.original);
        delete card.original;
        delete card.clone;
      }
    }
    this.drawPile = shuffle(this.discardPile, this.rng);
    this.discardPile = [top];
    this.log("The draw pile ran out, so the discard pile is shuffled in.");
    this.effect("reshuffle", "Discards shuffled in");
  }

  swapHands(a: number, b: number): void {
    const pa = this.players[a] as Player;
    const pb = this.players[b] as Player;
    [pa.hand, pb.hand] = [pb.hand, pa.hand];
    this.handsChanged();
  }

  /** Every hand moves to the next player in the direction of play. */
  rotateHands(): void {
    const hands = this.players.map((one) => one.hand);
    hands.forEach((hand, i) => {
      (this.players[this.nextIndex(i)] as Player).hand = hand;
    });
    this.handsChanged();
  }

  /** Gathers every hand, shuffles, and deals them back out from `start`. */
  redealHands(start: number): void {
    const all = shuffle(
      this.players.flatMap((one) => one.hand),
      this.rng,
    );
    for (const one of this.players) one.hand = [];
    let i = start;
    for (let card = all.pop(); card !== undefined; card = all.pop()) {
      (this.players[i] as Player).hand.push(card);
      i = this.nextIndex(i);
    }
    this.handsChanged();
  }

  /** A brand-new card that was never in the deck. */
  giveNewCard(player: number, color: CardColor, type: CardType, value: number | null = null): Card {
    const card = this.cards.make(color, type, value);
    const one = this.players[player] as Player;
    one.hand.push(card);
    one.unoDeclared = false;
    if (this.unoVulnerable === player) this.unoVulnerable = null;
    this.createdCards += 1;
    return card;
  }

  /** Moves n random cards from a hand to the bottom of the discard pile. */
  discardRandom(player: number, n: number): void {
    const hand = (this.players[player] as Player).hand;
    for (let i = 0; i < n && hand.length > 0; i += 1) {
      const [card] = hand.splice(Math.floor(this.rng() * hand.length), 1);
      this.discardPile.unshift(card as Card);
    }
  }

  /**
   * Hands that changed owners can't be caught; a one-card hand that arrived
   * this way counts as called.
   */
  handsChanged(): void {
    this.unoVulnerable = null;
    for (const one of this.players) one.unoDeclared = one.hand.length === 1;
  }

  /* ---------------------------------------------------------------- rounds */

  startRound(): void {
    if (this.phase !== "roundOver") {
      throw new UnoError("A round is already in progress.");
    }
    const n = this.players.length;
    this.round += 1;
    if (this.round > 1) this.dealer = (this.dealer + 1) % n;
    this.direction = 1;
    this.pendingDraw = 0;
    this.pendingFrom = null;
    this.wd4 = null;
    this.drawnCardId = null;
    this.unoVulnerable = null;
    this.lastRound = null;
    this.createdCards = 0;
    this.ext = {};
    this.peek = null;
    this.turnTimeLimit = null;
    call(this, "onRoundStart");

    const deck = shuffle(filter(this, "deck", this.cards.deck()), this.rng);
    this.drawPile = deck;
    this.discardPile = [];
    for (const one of this.players) {
      one.hand = [];
      one.unoDeclared = false;
    }

    // One at a time from the dealer's left, keeping enough back to play with.
    const handSize = Math.max(1, Math.min(this.rules.handSize, Math.floor((deck.length - 20) / n)));
    for (let k = 0; k < handSize; k += 1) {
      for (let i = 1; i <= n; i += 1) {
        (this.players[(this.dealer + i) % n] as Player).hand.push(this.drawPile.pop() as Card);
      }
    }

    // The first card. A Wild Draw Four goes back in.
    let top = this.drawPile.pop() as Card;
    for (let guard = 0; top.type === "wild4" && guard < 100; guard += 1) {
      this.drawPile.push(top);
      shuffle(this.drawPile, this.rng);
      top = this.drawPile.pop() as Card;
    }
    this.discardPile.push(top);
    this.currentColor = isWild(top) ? null : (top.color as Color);

    const first = this.nextIndex(this.dealer);
    this.setTurn(first);
    this.phase = "playing";
    this.log(`Round ${this.round}: ${this.nameOf(this.dealer)} deals. First card is ${label(top)}.`);
    this.effect("deal", `Round ${this.round}`, this.dealer);

    switch (top.type) {
      case "skip":
        this.effect("skip", `${this.nameOf(first)} is skipped!`, first);
        this.setTurn(this.nextIndex(first));
        break;
      case "reverse":
        // The dealer plays first and play goes to the right.
        this.direction = -1;
        this.setTurn(this.dealer);
        this.effect("reverse", "Reverse! Dealer starts.", this.dealer);
        break;
      case "draw2":
        this.drawCards(first, 2);
        this.log(`${this.nameOf(first)} draws 2 and is skipped.`);
        this.effect("draw", `${this.nameOf(first)} draws 2!`, first);
        this.setTurn(this.nextIndex(first));
        break;
      default:
        // Any Wild, theme wilds included: the first player picks the colour.
        if (isWild(top)) this.phase = "chooseColor";
    }
  }

  private endRound(winner: number, lastCard: Card): void {
    if (lastCard.type === "draw2" || lastCard.type === "wild4") {
      // Official: the next player still draws, and those cards count to the winner.
      const target = this.nextIndex(winner);
      const amount = this.pendingDraw + (lastCard.type === "draw2" ? 2 : 4);
      this.drawCards(target, amount);
      this.log(`${this.nameOf(target)} draws ${amount}.`);
    }
    this.pendingDraw = 0;
    this.wd4 = null;
    this.unoVulnerable = null;
    this.drawnCardId = null;
    this.turnTimeLimit = null;

    const handPoints = this.players.map((one) => one.hand.reduce((sum, card) => sum + points(card), 0));
    const gained = this.players.map(() => 0);
    if (this.rules.scoringMode === "winner") {
      gained[winner] = handPoints.reduce((a, b) => a + b, 0);
    } else {
      handPoints.forEach((pts, i) => {
        if (i !== winner) gained[i] = pts;
      });
    }
    this.players.forEach((one, i) => {
      one.score += gained[i] as number;
    });

    const w = this.players[winner] as Player;
    let gameOver = false;
    let champion: number | null = null;
    if (this.rules.gameMode === "single") {
      gameOver = true;
      champion = winner;
    } else if (this.rules.scoringMode === "winner") {
      if (w.score >= this.rules.targetScore) {
        gameOver = true;
        champion = winner;
      }
    } else if (this.players.some((one) => one.score >= this.rules.targetScore)) {
      gameOver = true;
      const low = Math.min(...this.players.map((one) => one.score));
      champion = w.score === low ? winner : (this.players.find((one) => one.score === low) as Player).index;
    }

    this.lastRound = { round: this.round, winner, handPoints, gained, gameOver, champion };
    this.champion = champion;
    this.phase = gameOver ? "gameOver" : "roundOver";
    this.log(
      `${w.name} wins round ${this.round}!${gameOver && champion !== null ? ` ${this.nameOf(champion)} wins the game!` : ""}`,
    );
    this.effect("win", `${w.name} wins the round!`, winner);
  }

  /* --------------------------------------------------------------- actions */

  private setTurn(player: number): void {
    this.current = player;
    this.turn += 1;
    this.turnTimeLimit = null;
    call(this, "onTurnStart", player);
  }

  /** Draw penalties wait for the target to respond (stack or block). */
  private defersDraw(): boolean {
    return this.rules.stacking !== "off" || filter(this, "defersDraw", false);
  }

  /** Somebody facing a draw takes it at once when they hold nothing to answer with. */
  private offerResponse(player: number): void {
    if (this.pendingDraw > 0 && this.playableCards(player).length === 0) this.takePending(player);
  }

  /** Any action by somebody else closes the UNO catch window. */
  private beginAction(player: number): void {
    if (this.unoVulnerable !== null && this.unoVulnerable !== player) this.unoVulnerable = null;
  }

  chooseStartColor(player: number, color: unknown): void {
    if (this.phase !== "chooseColor" || player !== this.current) throw new UnoError("It's not your choice.");
    if (!isColor(color)) throw new UnoError("Pick a colour.");
    this.currentColor = color;
    this.phase = "playing";
    this.log(`${this.nameOf(player)} chooses ${color}.`);
  }

  /** Plays a card. Out of turn, it is a jump-in. */
  playCard(player: number, cardId: unknown, opts: PlayOptions = {}): void {
    if (!TURN_PHASES.includes(this.phase)) throw new UnoError("You can't play right now.");
    if (player !== this.current) {
      this.jumpIn(player, cardId, opts);
      return;
    }
    const card = this.findCard(player, cardId);
    if (card === null) throw new UnoError("That card is not in your hand.");
    if (!this.canPlay(player, card)) throw new UnoError("That card can't be played.");
    this.doPlay(player, card, opts);
  }

  jumpIn(player: number, cardId: unknown, opts: PlayOptions = {}): void {
    const card = this.findCard(player, cardId);
    if (!this.canJumpIn(player, card)) throw new UnoError("You can't jump in with that.");
    this.drawnCardId = null;
    this.setTurn(player);
    this.phase = "playing";
    this.log(`${this.nameOf(player)} jumps in!`);
    this.effect("jumpin", `${this.nameOf(player)} jumps in!`, player);
    this.doPlay(player, card as Card, opts);
  }

  private doPlay(player: number, card: Card, opts: PlayOptions): void {
    this.beginAction(player);
    const one = this.players[player] as Player;
    const prevColor = this.currentColor;
    // Rules may turn the card into something else as it lands (A Little Help).
    call(this, "beforePlay", { player, card, opts });
    const illegalWd4 = card.type === "wild4" && this.hasColor(player, prevColor, card.id);

    one.hand.splice(one.hand.indexOf(card), 1);
    this.discardPile.push(card);
    this.drawnCardId = null;
    this.currentColor = isWild(card)
      ? isColor(opts.color)
        ? opts.color
        : this.bestColor(player)
      : (card.color as Color);
    this.log(`${one.name} plays ${label(card)}${isWild(card) ? ` and picks ${this.currentColor}` : ""}.`);

    if (one.hand.length === 1) {
      if (opts.declareUno === true && !one.unoDeclared) {
        one.unoDeclared = true;
        this.log(`${one.name} calls UNO!`);
        this.effect("uno", `${one.name}: UNO!`, player);
      }
      if (!one.unoDeclared && this.rules.unoPenalty > 0) {
        this.unoVulnerable = player;
        this.unoWindow += 1;
      }
    } else {
      one.unoDeclared = false;
    }

    if (one.hand.length === 0) {
      this.endRound(player, card);
      return;
    }

    const ctx: PlayContext = { player, card, opts, effect: card.type, nextTurn: undefined };
    call(this, "onCardPlayed", ctx);

    const n = this.players.length;
    const next = this.nextIndex(player);
    this.phase = "playing";
    if (ctx.effect === "draw2" || ctx.effect === "wild4") this.pendingFrom = player;
    if (ctx.nextTurn !== undefined) {
      this.setTurn(ctx.nextTurn);
      this.offerResponse(ctx.nextTurn);
      return;
    }
    switch (ctx.effect) {
      case "skip":
        this.effect("skip", `${this.nameOf(next)} is skipped!`, next);
        this.setTurn(this.nextIndex(player, 2));
        break;
      case "reverse":
        if (n === 2) {
          // With two players Reverse acts like Skip.
          this.effect("skip", `${this.nameOf(next)} is skipped!`, next);
          this.setTurn(player);
        } else {
          this.direction = this.direction === 1 ? -1 : 1;
          this.effect("reverse", "Reverse!", player);
          this.setTurn(this.nextIndex(player));
        }
        break;
      case "draw2":
        if (this.defersDraw()) {
          this.pendingDraw += 2;
          this.effect("draw", `+${this.pendingDraw} on ${this.nameOf(next)}!`, next);
          this.setTurn(next);
          this.offerResponse(next);
        } else {
          this.drawCards(next, 2);
          this.log(`${this.nameOf(next)} draws 2 and is skipped.`);
          this.effect("draw", `${this.nameOf(next)} draws 2!`, next);
          this.setTurn(this.nextIndex(player, 2));
        }
        break;
      case "wild4":
        this.pendingDraw += 4;
        this.setTurn(next);
        if (this.rules.wd4Rule === "challenge") {
          this.wd4 = { by: player, illegal: illegalWd4, color: prevColor };
          this.phase = "challenge";
          this.effect("draw", `+${this.pendingDraw} on ${this.nameOf(next)}!`, next);
        } else if (this.defersDraw()) {
          this.effect("draw", `+${this.pendingDraw} on ${this.nameOf(next)}!`, next);
          this.offerResponse(next);
        } else {
          this.takePending(next);
        }
        break;
      default:
        this.setTurn(next);
    }
  }

  /** Draws every card owed, and loses the turn. */
  private takePending(player: number): void {
    const n = this.pendingDraw;
    this.pendingDraw = 0;
    this.pendingFrom = null;
    this.wd4 = null;
    this.drawCards(player, n);
    this.log(`${this.nameOf(player)} draws ${n} and is skipped.`);
    this.effect("draw", `${this.nameOf(player)} draws ${n}!`, player);
    this.setTurn(this.nextIndex(player));
    this.phase = "playing";
  }

  drawCard(player: number): void {
    if (this.phase !== "playing" || player !== this.current) throw new UnoError("You can't draw right now.");
    if (!this.canDraw(player)) throw new UnoError("You must play a card if you can.");
    this.beginAction(player);
    if (this.pendingDraw > 0) {
      this.takePending(player);
      return;
    }
    const one = this.players[player] as Player;
    let draws = 0;
    let playable: Card | null = null;
    const limit = this.rules.drawUntilPlayable ? Number.POSITIVE_INFINITY : 1;
    while (draws < limit) {
      const before = one.hand.length;
      if (this.drawCards(player, 1).length === 0) break;
      draws += 1;
      // Hooks may add bonus cards (Explosive Results); any fresh card counts.
      playable = one.hand.slice(before).find((card) => this.canPlay(player, card)) ?? null;
      if (playable !== null) break;
    }
    this.log(`${one.name} draws ${draws === 1 ? "a card" : `${draws} cards`}.`);
    if (playable !== null && this.rules.drawnCardPlay !== "never") {
      this.phase = "postDraw";
      this.drawnCardId = playable.id;
    } else {
      this.setTurn(this.nextIndex(player));
    }
  }

  /** Keeps the playable card just drawn, and ends the turn. */
  pass(player: number): void {
    if (!this.canPass(player)) throw new UnoError("You can't pass right now.");
    this.beginAction(player);
    this.drawnCardId = null;
    this.phase = "playing";
    this.setTurn(this.nextIndex(player));
  }

  respondChallenge(player: number, challenge: boolean): void {
    if (this.phase !== "challenge" || player !== this.current || this.wd4 === null) {
      throw new UnoError("There is nothing to challenge.");
    }
    this.beginAction(player);
    const offender = this.wd4.by;
    this.phase = "playing";
    if (!challenge) {
      this.wd4 = null;
      if (this.defersDraw()) this.offerResponse(player);
      else this.takePending(player);
    } else if (this.wd4.illegal) {
      this.wd4 = null;
      this.pendingDraw = Math.max(0, this.pendingDraw - 4);
      this.drawCards(offender, 4);
      this.log(`${this.nameOf(player)} challenges, and ${this.nameOf(offender)} was bluffing and draws 4!`);
      this.effect("caught", `Busted! ${this.nameOf(offender)} draws 4`, offender);
      // The challenger now takes a normal turn, or faces what is left of a stack.
      this.offerResponse(player);
    } else {
      this.log(`${this.nameOf(player)} challenges, but ${this.nameOf(offender)} played it legally.`);
      this.pendingDraw += 2;
      this.takePending(player);
    }
  }

  /** Hurry Up! ran out: the player draws one (plus anything owed) and is skipped. */
  timeout(player: number): void {
    if (this.turnTimeLimit === null || player !== this.current || !this.active) {
      throw new UnoError("No timer is running.");
    }
    this.beginAction(player);
    if (this.phase === "chooseColor") this.currentColor = this.bestColor(player);
    this.phase = "playing";
    this.drawnCardId = null;
    this.pendingDraw += 1;
    this.log(`${this.nameOf(player)} ran out of time!`);
    this.effect("timeout", `Too slow, ${this.nameOf(player)}!`, player);
    this.takePending(player);
  }

  declareUno(player: number): void {
    if (!this.canDeclareUno(player)) {
      throw new UnoError("You can only call UNO with two cards on your turn, or with one.");
    }
    const one = this.players[player] as Player;
    one.unoDeclared = true;
    if (this.unoVulnerable === player) this.unoVulnerable = null;
    this.log(`${one.name} calls UNO!`);
    this.effect("uno", `${one.name}: UNO!`, player);
  }

  callUno(caller: number, target: number): void {
    if (!this.canCatch(caller, target)) throw new UnoError("There's nobody to catch.");
    this.unoVulnerable = null;
    const n = this.rules.unoPenalty;
    this.drawCards(target, n);
    this.log(`${this.nameOf(caller)} catches ${this.nameOf(target)} not calling UNO: draw ${n}!`);
    this.effect("caught", `Caught! ${this.nameOf(target)} draws ${n}`, target);
  }
}
