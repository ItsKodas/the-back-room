import type { PlayTable, Seat, SeatIdentity, TableStatus } from "@backroom/core";
import { Seating, TableError } from "@backroom/core";
import { containsWord, isClose, isCorrect, normalise } from "./guess.js";
import type { Hint } from "./hints.js";
import { hintMs, hintsDue, mask, planHints } from "./hints.js";
import type { FillRequest, InkRelay, Mark, StrokeBatch } from "./ink.js";
import { InkLog, MUST_DRAW } from "./ink.js";
import type { HintLevel, Mode, ScribbleOptions } from "./options.js";
import { minimumPlayers, TEAM_NAMES } from "./options.js";
import type { Turn } from "./rotation.js";
import { mayJoin, smallestTeam, soloTurn, teamTurn } from "./rotation.js";
import { drawerPoints, guesserPoints } from "./scoring.js";
import { drawChoices, poolFor } from "./words/rules.js";

export const COUNTDOWN_MS = 15_000;
export const PICK_MS = 15_000;
export const REVEAL_MS = 5_000;
export const RESULT_MS = 10_000;

export type Phase = "waiting" | "picking" | "drawing" | "reveal" | "over";

export interface Timings {
  countdownMs: number;
  pickMs: number;
  revealMs: number;
  resultMs: number;
}

export interface TableDeps {
  now?: () => number;
  random?: () => number;
  timings?: Partial<Timings>;
}

export interface TurnResult {
  word: string;
  drawers: string[];
  abandoned: boolean;
  scored: { seatId: string; points: number; drew: boolean }[];
}

export type ChatKind = "guess" | "close" | "got" | "pair" | "aside";

/** Where one line of chat goes. The same shape `GameAdapter.chat` returns. */
export interface Said {
  to: "room" | string[];
  kind?: ChatKind;
  text: string;
  /** True when the line changed the table, so the room sends everybody the new state. */
  changed: boolean;
}

export interface SeatView {
  id: string;
  name: string;
  connected: boolean;
  team: number | null;
  score: number;
  drawing: boolean;
  guessed: boolean;
}

export interface TeamView {
  index: number;
  name: string;
  score: number;
  members: string[];
}

export interface TableView {
  code: string;
  phase: Phase;
  deadline: number | null;
  /** The server's clock when this was sent, so a client with a wrong clock still counts down right. */
  now: number;
  mode: Mode;
  rounds: number;
  round: number;
  drawMs: number;
  hints: HintLevel;
  minimum: number;
  maxSeats: number;
  seats: SeatView[];
  teams: TeamView[];
  you: SeatView | null;
  hostId: string | null;
  watching: number;
  lastEvent: string | null;
  turn: { drawers: string[]; picker: string; team: number | null; startedAt: number | null } | null;
  choices: string[] | null;
  word: string | null;
  mask: (string | null)[] | null;
  ink: Mark[];
  reveal: TurnResult | null;
  winners: string[];
}

interface Player {
  name: string;
  team: number | null;
  score: number;
  /** False once they have left. Their points stay with their team until the game ends. */
  present: boolean;
}

export class ScribbleTable implements PlayTable {
  readonly code: string;
  readonly options: ScribbleOptions;
  /* Nothing is staked, so a leave can always be honoured on the spot. */
  readonly leavesMidHand = true;
  private readonly seating: Seating;
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly timings: Timings;
  private readonly pool: string[];

  phase: Phase = "waiting";
  deadline: number | null = null;
  lastEvent: string | null = null;
  /*
   * Counters, so a pause keyed on one game's countdown or one turn's pick can
   * never be mistaken for the next one's by the room's timer.
   */
  game = 0;
  turnNumber = 0;
  round = 0;
  turn: Turn | null = null;
  choices: string[] = [];
  word: string | null = null;
  hints: Hint[] = [];
  hintsShown = 0;
  startedAt: number | null = null;
  ink = new InkLog();
  reveal: TurnResult | null = null;
  winners: string[] = [];

  readonly players = new Map<string, Player>();
  /** Seat ids in the order they joined each team; the index is the team. */
  teams: string[][];
  teamScores: number[];
  /** Everybody who started this turn drawing, including any who have since left. */
  drew: string[] = [];
  /** Who has it this turn, and the points they are owed if the turn stands. */
  readonly guessed = new Map<string, number>();
  private teamTurns: number[];
  private queue: Turn[] = [];
  private readonly played = new Set<string>();

  constructor(code: string, maxSeats: number, options: ScribbleOptions, deps: TableDeps = {}) {
    this.code = code;
    this.options = options;
    this.seating = new Seating(maxSeats);
    this.clock = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.timings = {
      countdownMs: COUNTDOWN_MS,
      pickMs: PICK_MS,
      revealMs: REVEAL_MS,
      resultMs: RESULT_MS,
      ...deps.timings,
    };
    this.pool = poolFor(options.packs, options.custom, options.onlyCustom);
    this.teams = options.mode === "teams" ? Array.from({ length: options.teams }, () => []) : [];
    this.teamScores = this.teams.map(() => 0);
    this.teamTurns = this.teams.map(() => 0);
  }

  // ------------------------------------------------------------- the room

  get seats(): readonly Seat[] {
    return this.seating.seats;
  }
  get hostId(): string | null {
    return this.seating.hostId;
  }
  get isEmpty(): boolean {
    return this.seating.isEmpty;
  }
  get maxSeats(): number {
    return this.seating.limit;
  }
  get watching(): number {
    return this.seating.watching;
  }
  get status(): TableStatus {
    if (this.isEmpty) {
      return "over";
    }
    return this.phase === "waiting" ? "lobby" : "playing";
  }
  get minimum(): number {
    return minimumPlayers(this.options);
  }

  now(): number {
    return this.clock();
  }

  join(id: string, name: string, identity: SeatIdentity | null): Seat {
    // Guests are welcome: nothing here is anybody's money.
    const seat = this.seating.join(id, name, this.status, identity, false);
    // Scribble has no "next game" to wait for: a mid-game joiner can talk and guess at once.
    this.seating.dealInWaiting();
    const midGame = this.options.mode === "teams" && this.phase !== "waiting";
    const team = midGame ? smallestTeam(this.teamSizes()) : null;
    this.players.set(seat.id, { name: seat.name, team, score: 0, present: true });
    if (team !== null) {
      (this.teams[team] as string[]).push(seat.id);
    }
    this.lastEvent = `${seat.name} sat down.`;
    this.settleCountdown();
    return seat;
  }

  removeSeat(seatId: string): void {
    const seat = this.seating.remove(seatId);
    const player = this.players.get(seatId);
    if (player !== undefined) {
      player.present = false;
    }
    this.teams = this.teams.map((members) => members.filter((id) => id !== seatId));
    if (this.phase === "waiting") {
      // Between games there is no score to keep for anybody.
      this.players.delete(seatId);
    }
    if (seat !== null) {
      this.lastEvent = `${seat.name} left.`;
    }
    this.dropDrawer(seatId);
    this.endIfEveryoneHasIt();
    this.settleCountdown();
  }

  disconnect(seatId: string): void {
    this.seating.disconnect(seatId);
  }
  reconnect(seatId: string): Seat {
    return this.seating.reconnect(seatId);
  }
  watch(socketId: string): void {
    this.seating.watch(socketId);
  }
  unwatch(socketId: string): void {
    this.seating.unwatch(socketId);
  }

  // ------------------------------------------------------------- teams

  pickTeam(seatId: string, team: number): void {
    if (this.options.mode !== "teams") {
      throw new TableError("This table isn't playing in teams.");
    }
    if (this.phase !== "waiting") {
      throw new TableError("Teams are picked between games.");
    }
    if (!Number.isInteger(team) || team < 0 || team >= this.teams.length) {
      throw new TableError("There's no such team.");
    }
    const player = this.players.get(seatId);
    if (player === undefined) {
      throw new TableError("You are not at this table.");
    }
    if (player.team === team) {
      return;
    }
    const sizes = this.teams.map((members) => members.filter((id) => id !== seatId).length);
    if (!mayJoin(sizes, team)) {
      throw new TableError(`${TEAM_NAMES[team]} is full for now.`);
    }
    this.teams = this.teams.map((members) => members.filter((id) => id !== seatId));
    (this.teams[team] as string[]).push(seatId);
    player.team = team;
  }

  private teamSizes(): number[] {
    return this.teams.map((members) => members.length);
  }

  // ------------------------------------------------------------- the clock

  /*
   * The table deals itself. Nobody presses start: once enough people are
   * sitting the countdown runs, and the room's timer calls deal() when it ends.
   */
  private settleCountdown(): void {
    if (this.phase !== "waiting") {
      return;
    }
    if (this.seats.length < this.minimum) {
      this.deadline = null;
    } else if (this.deadline === null) {
      this.deadline = this.now() + this.timings.countdownMs;
    }
  }

  deal(): void {
    if (this.phase !== "waiting" || this.seats.length < this.minimum) {
      return;
    }
    this.game += 1;
    this.round = 1;
    this.played.clear();
    this.winners = [];
    this.lastEvent = null;
    this.seating.dealInWaiting();
    for (const player of this.players.values()) {
      player.score = 0;
    }
    this.teamScores = this.teams.map(() => 0);
    this.teamTurns = this.teams.map(() => 0);
    if (this.options.mode === "teams") {
      // An idle player cannot hold the table up by not picking: they are placed.
      for (const seat of this.seats) {
        const player = this.players.get(seat.id);
        if (player !== undefined && player.team === null) {
          const team = smallestTeam(this.teamSizes());
          (this.teams[team] as string[]).push(seat.id);
          player.team = team;
        }
      }
      this.rebalanceTeams();
    }
    this.queue = this.buildRound();
    this.nextTurn();
  }

  /**
   * Teams carry between games, and departures can leave one heavier than the
   * rest by more than the placement loop above ever fixes on its own — it
   * only ever settles a player newly arriving, not a team that lost people
   * between games. So the biggest team's newest arrival moves to the
   * smallest, repeatedly, until no team is more than one bigger than another.
   */
  private rebalanceTeams(): void {
    for (;;) {
      let largest = 0;
      let smallest = 0;
      for (let team = 1; team < this.teams.length; team += 1) {
        const size = (this.teams[team] as string[]).length;
        if (size > (this.teams[largest] as string[]).length) {
          largest = team;
        }
        if (size < (this.teams[smallest] as string[]).length) {
          smallest = team;
        }
      }
      const from = this.teams[largest] as string[];
      const to = this.teams[smallest] as string[];
      if (from.length - to.length <= 1) {
        return;
      }
      const moved = from.pop() as string;
      to.push(moved);
      const player = this.players.get(moved);
      if (player !== undefined) {
        player.team = smallest;
      }
    }
  }

  private buildRound(): Turn[] {
    if (this.options.mode === "solo") {
      return this.seats.filter((seat) => !seat.isBot).map((seat) => soloTurn(seat.id));
    }
    const turns: Turn[] = [];
    this.teams.forEach((members, team) => {
      if (members.length === 0) {
        return;
      }
      const k = this.teamTurns[team] as number;
      turns.push(teamTurn(members, k, team));
      this.teamTurns[team] = k + 1;
    });
    return turns;
  }

  private nextTurn(): void {
    this.turn = null;
    this.word = null;
    this.choices = [];
    this.hints = [];
    this.hintsShown = 0;
    this.startedAt = null;
    this.guessed.clear();
    this.drew = [];
    if (this.seats.length < this.minimum) {
      this.backToWaiting("Not enough players to carry on — waiting for more.");
      return;
    }
    for (;;) {
      const next = this.queue.shift();
      if (next === undefined) {
        if (this.round >= this.options.rounds) {
          this.endGame();
          return;
        }
        this.round += 1;
        this.queue = this.buildRound();
        if (this.queue.length === 0) {
          this.endGame();
          return;
        }
        continue;
      }
      const drawers = next.drawers.filter((id) => this.seats.some((seat) => seat.id === id));
      if (drawers.length === 0) {
        continue;
      }
      const picker = drawers.includes(next.picker) ? next.picker : (drawers[0] as string);
      this.turn = { drawers, picker, team: next.team };
      this.drew = [...drawers];
      this.turnNumber += 1;
      this.choices = drawChoices(this.pool, this.played, this.random);
      this.ink = new InkLog();
      this.reveal = null;
      this.phase = "picking";
      this.deadline = this.now() + this.timings.pickMs;
      return;
    }
  }

  pick(seatId: string, index: number): void {
    if (this.phase !== "picking" || this.turn === null) {
      throw new TableError("There's nothing to pick right now.");
    }
    if (seatId !== this.turn.picker) {
      throw new TableError("It's not your pick.");
    }
    if (!Number.isInteger(index) || index < 0 || index >= this.choices.length) {
      throw new TableError("Pick one of the three.");
    }
    this.beginDrawing(this.choices[index] as string);
  }

  autoPick(): void {
    if (this.phase !== "picking" || this.choices.length === 0) {
      return;
    }
    const index = Math.min(this.choices.length - 1, Math.floor(this.random() * this.choices.length));
    this.beginDrawing(this.choices[index] as string);
  }

  private beginDrawing(word: string): void {
    this.word = word;
    this.played.add(normalise(word));
    this.choices = [];
    this.hints = planHints(word, this.options.hints, this.random);
    this.hintsShown = 0;
    this.startedAt = this.now();
    this.deadline = this.startedAt + this.options.drawMs;
    this.phase = "drawing";
  }

  /** Called by the room's timer at each hint and at the end of the draw time. */
  advanceDrawing(): void {
    if (this.phase !== "drawing" || this.startedAt === null) {
      return;
    }
    const now = this.now();
    if (this.deadline !== null && now >= this.deadline) {
      this.finishTurn(false);
      return;
    }
    this.hintsShown = hintsDue(this.hints, now - this.startedAt, this.options.drawMs);
  }

  nextHintAt(): number | null {
    const hint = this.hints[this.hintsShown];
    if (hint === undefined || this.startedAt === null) {
      return null;
    }
    return this.startedAt + hintMs(hint, this.options.drawMs);
  }

  private dropDrawer(seatId: string): void {
    const turn = this.turn;
    if (turn === null || !turn.drawers.includes(seatId)) {
      return;
    }
    if (this.phase !== "picking" && this.phase !== "drawing") {
      return;
    }
    turn.drawers = turn.drawers.filter((id) => id !== seatId);
    if (turn.drawers.length === 0) {
      if (this.phase === "picking") {
        this.nextTurn();
      } else {
        this.finishTurn(true);
      }
      return;
    }
    if (turn.picker === seatId) {
      turn.picker = turn.drawers[0] as string;
    }
  }

  /** Ends the drawing early once nobody who could still guess is left guessing. */
  private endIfEveryoneHasIt(): void {
    if (this.phase !== "drawing") {
      return;
    }
    const waitingOn = this.seats.filter((seat) => !this.drew.includes(seat.id) && !this.guessed.has(seat.id));
    if (waitingOn.length === 0) {
      this.finishTurn(false);
    }
  }

  private finishTurn(abandoned: boolean): void {
    const word = this.word;
    if (word === null) {
      return;
    }
    const scored: TurnResult["scored"] = [];
    if (!abandoned) {
      const stillGuessing = this.seats.filter((seat) => !this.drew.includes(seat.id) && !this.guessed.has(seat.id));
      const eligible = this.guessed.size + stillGuessing.length;
      for (const [seatId, points] of this.guessed) {
        this.award(seatId, points);
        scored.push({ seatId, points, drew: false });
      }
      const each = drawerPoints(this.guessed.size, eligible);
      for (const seatId of this.drew) {
        this.award(seatId, each);
        scored.push({ seatId, points: each, drew: true });
      }
    }
    this.reveal = { word, drawers: [...this.drew], abandoned, scored };
    this.hintsShown = this.hints.length;
    this.phase = "reveal";
    this.deadline = this.now() + this.timings.revealMs;
  }

  private award(seatId: string, points: number): void {
    const player = this.players.get(seatId);
    if (player === undefined) {
      return;
    }
    player.score += points;
    if (player.team !== null) {
      this.teamScores[player.team] = (this.teamScores[player.team] ?? 0) + points;
    }
  }

  endReveal(): void {
    if (this.phase === "reveal") {
      this.nextTurn();
    }
  }

  private endGame(): void {
    this.phase = "over";
    this.turn = null;
    this.deadline = this.now() + this.timings.resultMs;
    const everyone = [...this.players.entries()];
    if (this.options.mode === "teams") {
      const best = Math.max(...this.teamScores);
      const top = new Set(this.teamScores.flatMap((score, team) => (score === best ? [team] : [])));
      this.winners = everyone.filter(([, player]) => player.team !== null && top.has(player.team)).map(([id]) => id);
    } else {
      const best = Math.max(...everyone.map(([, player]) => player.score));
      this.winners = everyone.filter(([, player]) => player.score === best).map(([id]) => id);
    }
  }

  backToWaiting(note: string | null = null): void {
    this.phase = "waiting";
    this.turn = null;
    this.queue = [];
    this.round = 0;
    this.word = null;
    this.choices = [];
    this.reveal = null;
    this.ink = new InkLog();
    this.deadline = null;
    for (const [id, player] of this.players) {
      if (!player.present) {
        this.players.delete(id);
      }
    }
    if (note !== null) {
      this.lastEvent = note;
    }
    this.settleCountdown();
  }

  // ------------------------------------------------------------- talk

  /**
   * Where a line of chat goes, and what it did.
   *
   * The room would otherwise send every line to everybody, and a drawer could
   * simply type the word. Anything that could give the word away goes to the
   * people who already know it and nobody else.
   */
  say(seatId: string, text: string): Said {
    const turn = this.turn;
    if (turn === null || (this.phase !== "picking" && this.phase !== "drawing")) {
      return { to: "room", text, changed: false };
    }
    if (turn.drawers.includes(seatId)) {
      if (turn.drawers.length < 2) {
        throw new TableError("You're drawing.");
      }
      const secrets = this.phase === "picking" ? this.choices : [this.word as string];
      if (secrets.some((secret) => containsWord(text, secret))) {
        throw new TableError("That gives the word away.");
      }
      return { to: [...turn.drawers], kind: "pair", text, changed: false };
    }
    if (this.phase === "picking") {
      return { to: "room", text, changed: false };
    }
    const word = this.word as string;
    if (this.guessed.has(seatId)) {
      return { to: [...this.guessed.keys(), ...turn.drawers], kind: "aside", text, changed: false };
    }
    if (isCorrect(text, word)) {
      this.guessed.set(seatId, guesserPoints((this.deadline ?? this.now()) - this.now(), this.options.drawMs));
      this.lastEvent = `${this.players.get(seatId)?.name ?? "Somebody"} got it.`;
      this.endIfEveryoneHasIt();
      return { to: "room", kind: "got", text: "got it", changed: true };
    }
    if (containsWord(text, word) || isClose(text, word)) {
      return { to: [seatId], kind: "close", text, changed: false };
    }
    return {
      to: this.seats.map((seat) => seat.id).filter((id) => !this.guessed.has(id)),
      kind: "guess",
      text,
      changed: false,
    };
  }

  // ------------------------------------------------------------- ink

  private mustDraw(seatId: string): void {
    if (this.phase !== "drawing" || this.turn === null || !this.turn.drawers.includes(seatId)) {
      throw new TableError(MUST_DRAW);
    }
  }

  stroke(seatId: string, batch: StrokeBatch): InkRelay | null {
    this.mustDraw(seatId);
    return this.ink.stroke(seatId, batch);
  }

  fill(seatId: string, request: FillRequest): InkRelay | null {
    this.mustDraw(seatId);
    return this.ink.fill(seatId, request);
  }

  undo(seatId: string): InkRelay | null {
    this.mustDraw(seatId);
    return this.ink.undo(seatId);
  }

  clear(seatId: string): InkRelay {
    this.mustDraw(seatId);
    return this.ink.clear();
  }

  view(forSeatId: string | null): TableView {
    const turn = this.turn;
    const live = this.phase === "picking" || this.phase === "drawing";
    const drawing = (id: string) => live && (turn?.drawers.includes(id) ?? false);
    const seats = this.seats.map((seat) => {
      const player = this.players.get(seat.id);
      return {
        id: seat.id,
        name: seat.name,
        connected: seat.connected,
        team: player?.team ?? null,
        score: player?.score ?? 0,
        drawing: drawing(seat.id),
        guessed: this.guessed.has(seat.id),
      };
    });
    const knows = forSeatId !== null && (drawing(forSeatId) || this.guessed.has(forSeatId));
    const word = this.phase === "drawing" ? this.word : null;
    return {
      code: this.code,
      phase: this.phase,
      deadline: this.deadline,
      now: this.now(),
      mode: this.options.mode,
      rounds: this.options.rounds,
      round: this.round,
      drawMs: this.options.drawMs,
      hints: this.options.hints,
      minimum: this.minimum,
      maxSeats: this.maxSeats,
      seats,
      teams: this.teams.map((members, index) => ({
        index,
        name: TEAM_NAMES[index] as string,
        score: this.teamScores[index] ?? 0,
        members: [...members],
      })),
      you: seats.find((seat) => seat.id === forSeatId) ?? null,
      hostId: this.hostId,
      watching: this.watching,
      lastEvent: this.lastEvent,
      turn:
        turn === null
          ? null
          : { drawers: [...turn.drawers], picker: turn.picker, team: turn.team, startedAt: this.startedAt },
      choices: this.phase === "picking" && forSeatId !== null && drawing(forSeatId) ? [...this.choices] : null,
      word: word !== null && knows ? word : null,
      mask: word !== null && !knows ? mask(word, this.hints, this.hintsShown) : null,
      ink: this.phase === "drawing" || this.phase === "reveal" ? [...this.ink.marks] : [],
      reveal: this.phase === "reveal" || this.phase === "over" ? this.reveal : null,
      winners: this.phase === "over" ? [...this.winners] : [],
    };
  }
}
