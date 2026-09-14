import {
  DEFAULT_RULESET,
  bustProbability,
  enumerateOptions,
  hasAnyScore,
  scoreSelection,
} from "@backroom/rules";
import type { Die, Ruleset } from "@backroom/rules";
import { Escrow, MAX_SEATS, MIN_SEATS, Seating, TableError } from "@backroom/core";
import type { Seat as TableSeat, SeatIdentity } from "@backroom/core";
import type { Phase, RoomStatus, RoomView, SeatView, TurnView } from "@backroom/shared";
import type { BotSkill } from "./bot.js";

/**
 * Thrown for anything a client did wrong; the socket layer turns it into
 * room:error. An alias rather than a second class, so a refusal from the
 * seating and a refusal from the rules are the same thing to a caller.
 */
export const RoomError = TableError;
export type RoomError = TableError;

/** Injected so tests can roll deterministically. */
export type Roller = (count: number) => Die[];

/**
 * A seat at a Greed table: everything a seat is anywhere, plus the two things
 * that only mean something here.
 */
export interface Seat extends TableSeat {
  /** Banked points this game. */
  score: number;
  /** Whether they have met the entry threshold at least once. */
  onBoard: boolean;
}

interface Turn {
  seatIndex: number;
  /** Dice on the table right now. Already-set-aside dice live in `kept`. */
  dice: Die[];
  held: boolean[];
  /** Points banked into this turn before the current selection. */
  kept: number;
  /** How many times these dice have been thrown this turn. */
  seq: number;
  phase: Phase;
}

const DICE_PER_ROLL = 6;

/** True when the roll shows every face exactly once — a straight, or $GREED. */
function isEveryFace(dice: readonly Die[]): boolean {
  if (dice.length !== DICE_PER_ROLL) {
    return false;
  }
  const seen = new Set(dice);
  return seen.size === DICE_PER_ROLL;
}

export class Room {
  readonly code: string;
  ruleset: Ruleset;
  /** Who is here. Greed adds a score and a board flag to each seat. */
  private readonly seating: Seating;

  get seats(): Seat[] {
    return this.seating.seats as Seat[];
  }
  status: RoomStatus = "lobby";
  winnerIds: string[] = [];
  lastEvent: string | null = null;
  /** Chips each seat puts in. Zero means a friendly game. */
  buyIn = 0;
  /** Holds the buy-ins taken at the start of a game played for chips. */
  readonly escrow = new Escrow();
  /**
   * When the active player forfeits, in epoch ms. Owned by the socket layer —
   * this class never reads it, so the engine stays free of wall-clock time.
   */
  endsAt: number | null = null;

  private turn: Turn | null = null;
  private readonly roll: Roller;
  /** Seat that reached the target; everyone after it gets one last turn. */
  private finalRoundTrigger: string | null = null;

  constructor(
    code: string,
    roll: Roller,
    ruleset: Ruleset = DEFAULT_RULESET,
    /** How many may sit here. The host's choice, made when the room opened. */
    maxSeats: number = MAX_SEATS,
  ) {
    this.seating = new Seating(maxSeats);
    this.code = code;
    this.roll = roll;
    this.ruleset = ruleset;
  }

  // ---------------------------------------------------------------- lobby

  /** How many may sit here, which the host chose when this table opened. */
  get maxSeats(): number {
    return this.seating.limit;
  }

  get hostId(): string | null {
    return this.seating.hostId;
  }

  get isEmpty(): boolean {
    return this.seating.isEmpty;
  }

  join(id: string, name: string, identity: SeatIdentity | null = null): Seat {
    const seat = this.seating.join(
      id,
      name,
      this.status,
      identity,
      // Chips need somebody to charge, so a paying table needs an account.
      this.buyIn > 0,
    ) as Seat;
    seat.score = 0;
    seat.onBoard = false;
    this.lastEvent = `${seat.name} sat down`;
    return seat;
  }


  /**
   * Applies a host's rule changes. Lobby only — moving the target or the
   * threshold mid-game would rewrite what players had already decided against.
   * The face table is not editable here; a lobby picks an edition instead.
   */
  updateRules(changes: Partial<Ruleset>): void {
    if (this.status !== "lobby") {
      throw new RoomError("The rules are set once the game starts.");
    }
    this.ruleset = Object.freeze({ ...this.ruleset, ...changes });
    this.lastEvent = "House rules changed";
  }

  /**
   * Sets the stake. Everyone seated must be signed in, and no bots may be at
   * the table — a bot has no balance to lose and no account to pay.
   */
  setBuyIn(amount: number): void {
    if (this.status !== "lobby") {
      throw new RoomError("The stake is set before the game starts.");
    }
    if (amount > 0) {
      if (this.seats.some((seat) => seat.isBot)) {
        throw new RoomError("Remove the bots before playing for chips.");
      }
      if (this.seats.some((seat) => seat.userId === null)) {
        throw new RoomError("Everyone has to be signed in to play for chips.");
      }
    }
    this.buyIn = amount;
    this.lastEvent = amount > 0 ? `Buy-in set to ${amount.toLocaleString("en-US")}` : "Playing for fun";
  }

  /** The pot, once everyone has paid in. */
  get pot(): number {
    return this.buyIn * this.seats.length;
  }

  /** Seats a bot. Host-gated by the socket layer; the engine only checks room. */
  addBot(id: string, name: string, skill: BotSkill): Seat {
    if (this.status !== "lobby") {
      throw new RoomError("That game has already started.");
    }
    if (this.buyIn > 0) {
      // A bot has no balance to debit and no account to pay, so letting one
      // into a pot would either mint chips or destroy them.
      throw new RoomError("Bots only play for free.");
    }
    const seat = this.seating.addBot(id, name, skill) as Seat;
    seat.score = 0;
    seat.onBoard = false;
    this.lastEvent = `${name} joined`;
    return seat;
  }


  /** The seat whose turn it is, or null outside a running game. */
  watch(socketId: string): void {
    this.seating.watch(socketId);
  }

  unwatch(socketId: string): void {
    this.seating.unwatch(socketId);
  }

  activeSeat(): Seat | null {
    if (this.status !== "playing" || this.turn === null) {
      return null;
    }
    return this.seats[this.turn.seatIndex] ?? null;
  }

  /** Points already set aside in the turn under way. */
  get keptThisTurn(): number {
    return this.turn?.kept ?? 0;
  }

  /**
   * How far the active seat is behind the leader when this is its last turn,
   * or null. A bot that would still lose by banking should keep rolling.
   */
  deficitOnFinalTurn(): number | null {
    if (this.finalRoundTrigger === null) {
      return null;
    }
    const seat = this.activeSeat();
    if (seat === null) {
      return null;
    }
    const best = Math.max(...this.seats.map((other) => other.score));
    return Math.max(0, best - seat.score);
  }

  /**
   * Marks a seat disconnected but keeps it, so a refresh can reclaim it. The
   * socket layer drops the seat later if nobody comes back — see removeSeat.
   */
  disconnect(seatId: string): void {
    const index = this.seats.findIndex((seat) => seat.id === seatId);
    const seat = this.seating.disconnect(seatId);
    if (seat === null) {
      return;
    }
    this.lastEvent = `${seat.name} dropped out`;
    // Do not stall the table waiting for someone who left.
    if (this.turn?.seatIndex === index && this.status === "playing") {
      this.advanceTurn();
    }
  }

  /**
   * Gives up on a seat that never came back. Only in the lobby: removing a
   * seat mid-game would shift every later seat's index out from under the
   * turn order, and a disconnected seat is simply skipped anyway.
   */
  removeSeat(seatId: string): void {
    if (this.status !== "lobby") {
      return;
    }
    const seat = this.seating.remove(seatId);
    this.lastEvent = `${seat?.name ?? "Someone"} left`;
  }

  reconnect(seatId: string): Seat {
    const seat = this.seating.reconnect(seatId) as Seat;
    this.lastEvent = `${seat.name} came back`;
    return seat;
  }

  /**
   * Puts a finished table back in its lobby, with everyone still at it.
   *
   * A table outlives a game. Once someone has won, the seats, the host, the
   * rules and the stake are all still perfectly good — what is spent is the
   * scores. Leaving the table and building another one loses the people, which
   * is the expensive part to reassemble.
   */
  playAgain(seatId: string): void {
    if (seatId !== this.hostId) {
      throw new RoomError("Only the host can deal another game.");
    }
    if (this.status !== "over") {
      throw new RoomError("That game is still going.");
    }
    this.status = "lobby";
    this.turn = null;
    this.winnerIds = [];
    /*
     * Belongs to the game that just ended, and to nothing else.
     *
     * Left standing it ends the next game the first time play comes round to
     * whoever set it — with every score still near zero, and a winner declared
     * out of a game nobody finished.
     */
    this.finalRoundTrigger = null;
    // The pot is derived from the stake and the seats, so there is nothing to
    // reset — it is already whatever the next game will be worth.
    for (const seat of this.seats) {
      seat.score = 0;
      seat.onBoard = false;
    }
    // Whoever turned up while the last game was running is in this one.
    this.seating.dealInWaiting();
    this.lastEvent = "Another game — sit down or change the rules";
  }

  start(seatId: string): void {
    if (seatId !== this.hostId) {
      throw new RoomError("Only the host can start the game.");
    }
    if (this.status !== "lobby") {
      throw new RoomError("The game is already running.");
    }
    if (this.seats.length < MIN_SEATS) {
      throw new RoomError(`You need at least ${MIN_SEATS} players.`);
    }
    this.status = "playing";
    this.turn = { seatIndex: 0, dice: [], held: [], kept: 0, seq: 0, phase: "awaiting_roll" };
    this.lastEvent = `${this.seats[0]?.name ?? "Someone"} goes first`;
  }

  // ---------------------------------------------------------------- play

  private requireTurn(seatId: string): Turn {
    if (this.status !== "playing" || this.turn === null) {
      throw new RoomError("The game is not running.");
    }
    const seat = this.seats[this.turn.seatIndex];
    if (seat === undefined || seat.id !== seatId) {
      throw new RoomError("It is not your turn.");
    }
    return this.turn;
  }

  private selectedDice(turn: Turn): Die[] {
    return turn.dice.filter((_, index) => turn.held[index] === true);
  }

  doRoll(seatId: string): void {
    const turn = this.requireTurn(seatId);
    if (turn.phase === "farkled" || turn.phase === "over") {
      throw new RoomError("This turn is finished.");
    }

    let toRoll = DICE_PER_ROLL;

    if (turn.phase === "selecting") {
      const selection = this.selectedDice(turn);
      if (selection.length === 0) {
        throw new RoomError("Set aside at least one scoring die first.");
      }
      const scored = scoreSelection(selection, this.ruleset);
      if (!scored.valid) {
        throw new RoomError("That set has a die that scores nothing.");
      }
      turn.kept += scored.points;
      const remaining = turn.dice.length - selection.length;
      // All six set aside: hot dice, roll the lot again.
      toRoll = remaining === 0 ? DICE_PER_ROLL : remaining;
    }

    const rolled = this.roll(toRoll);
    const straight = isEveryFace(rolled);
    // Line a straight up so it reads in face order — 1 to 6, or $GREED. Safe
    // to reorder here because nothing is held yet on a fresh roll, so no index
    // the client is holding can go stale.
    turn.dice = straight ? [...rolled].sort((a, b) => a - b) : rolled;
    turn.held = turn.dice.map(() => false);
    turn.seq += 1;
    turn.phase = "selecting";

    const seat = this.seats[turn.seatIndex] as Seat;
    if (!hasAnyScore(turn.dice, this.ruleset)) {
      turn.kept = 0;
      turn.phase = "farkled";
      this.lastEvent = `${seat.name} farkled`;
      return;
    }
    if (straight) {
      this.lastEvent =
        this.ruleset.skin === "letters"
          ? `${seat.name} rolled $GREED`
          : `${seat.name} rolled a straight`;
      return;
    }
    this.lastEvent = `${seat.name} rolled ${toRoll}`;
  }

  toggle(seatId: string, index: number): void {
    const turn = this.requireTurn(seatId);
    if (turn.phase !== "selecting") {
      throw new RoomError("Roll first.");
    }
    if (!Number.isInteger(index) || index < 0 || index >= turn.dice.length) {
      throw new RoomError("No such die.");
    }
    if (this.deadFlags(turn)[index] === true) {
      throw new RoomError("That die cannot score.");
    }
    turn.held[index] = turn.held[index] !== true;
  }

  bank(seatId: string): void {
    const turn = this.requireTurn(seatId);
    if (turn.phase !== "selecting") {
      throw new RoomError("Roll first.");
    }
    const selection = this.selectedDice(turn);
    if (selection.length === 0) {
      throw new RoomError("Set aside at least one scoring die first.");
    }
    const scored = scoreSelection(selection, this.ruleset);
    if (!scored.valid) {
      throw new RoomError("That set has a die that scores nothing.");
    }

    const seat = this.seats[turn.seatIndex] as Seat;
    const total = turn.kept + scored.points;

    if (!seat.onBoard && total < this.ruleset.entryThreshold) {
      throw new RoomError(`You need ${this.ruleset.entryThreshold} in one turn to get on the board.`);
    }

    seat.score += total;
    seat.onBoard = true;
    this.lastEvent = `${seat.name} banked ${total.toLocaleString("en-US")}`;

    if (seat.score >= this.ruleset.targetScore && this.finalRoundTrigger === null) {
      if (this.ruleset.finalRound) {
        this.finalRoundTrigger = seat.id;
        this.lastEvent = `${seat.name} reached ${this.ruleset.targetScore.toLocaleString("en-US")} — one last turn for everyone`;
      } else {
        this.finish();
        return;
      }
    }

    this.advanceTurn();
  }

  /**
   * The clock ran out. Banks what the player has if it would count, otherwise
   * the turn is lost — the same outcome as a farkle, reached by inaction.
   *
   * Deliberately forgiving: anything already set aside plus a legal current
   * selection is banked, because losing a good turn to a slow connection is a
   * worse experience than a stranger having to wait.
   */
  timeout(seatId: string): void {
    if (this.status !== "playing" || this.turn === null) {
      return;
    }
    const seat = this.seats[this.turn.seatIndex];
    if (seat === undefined || seat.id !== seatId) {
      return;
    }

    const selection = this.selectedDice(this.turn);
    const scored = selection.length > 0 ? scoreSelection(selection, this.ruleset) : null;
    const total = this.turn.kept + (scored?.valid === true ? scored.points : 0);
    const worthBanking = seat.onBoard ? total > 0 : total >= this.ruleset.entryThreshold;

    if (worthBanking) {
      seat.score += total;
      seat.onBoard = true;
      this.lastEvent = `${seat.name} ran out of time and banked ${total.toLocaleString("en-US")}`;
      if (seat.score >= this.ruleset.targetScore && this.finalRoundTrigger === null) {
        if (this.ruleset.finalRound) {
          this.finalRoundTrigger = seat.id;
        } else {
          this.finish();
          return;
        }
      }
    } else {
      this.lastEvent = `${seat.name} ran out of time`;
    }
    this.advanceTurn();
  }

  /**
   * Moves play to the next connected seat. Called by the socket layer after a
   * farkle has been shown, and directly after a bank.
   */
  advanceTurn(): void {
    if (this.status !== "playing" || this.turn === null) {
      return;
    }
    const total = this.seats.length;
    for (let step = 1; step <= total; step += 1) {
      const next = (this.turn.seatIndex + step) % total;
      const seat = this.seats[next];
      // Skipped for the same reason they were never dealt: they arrived after
      // this game began and are waiting for the next one.
      if (seat === undefined || !seat.connected || seat.waiting) {
        continue;
      }
      if (seat.id === this.finalRoundTrigger) {
        this.finish();
        return;
      }
      this.turn = { seatIndex: next, dice: [], held: [], kept: 0, seq: 0, phase: "awaiting_roll" };
      return;
    }
    // Nobody is connected right now. Leave the game exactly where it is rather
    // than declaring a winner: at this instant a refresh and a walk-out look
    // identical, and the empty-room reaper clears the table if nobody returns.
  }

  private finish(): void {
    // The game is decided, so the buy-ins now belong to the pot.
    this.escrow.settle();
    this.status = "over";
    // Only the people who actually played it can have won it.
    const played = this.seats.filter((seat) => !seat.waiting);
    const best = Math.max(...played.map((seat) => seat.score));
    this.winnerIds = played.filter((seat) => seat.score === best).map((seat) => seat.id);
    const names = played.filter((seat) => this.winnerIds.includes(seat.id)).map((seat) => seat.name);
    this.lastEvent = names.length === 1 ? `${names[0]} wins` : `${names.join(" and ")} tie`;
    if (this.turn !== null) {
      this.turn.phase = "over";
    }
  }

  // ---------------------------------------------------------------- view

  /**
   * Which dice can never belong to a scoring selection.
   *
   * Computed as the union of faces appearing in any fully-scoring option, so a
   * lone 2 among three 2s stays clickable — you have to pick all three before
   * the selection becomes legal, and picking them one at a time must work.
   */
  private deadFlags(turn: Turn): boolean[] {
    const live = new Set<Die>();
    for (const option of enumerateOptions(turn.dice, this.ruleset)) {
      for (let face = 0; face < 6; face += 1) {
        if ((option.counts[face] ?? 0) > 0) {
          live.add((face + 1) as Die);
        }
      }
    }
    return turn.dice.map((die) => !live.has(die));
  }

  private turnView(turn: Turn): TurnView {
    const seat = this.seats[turn.seatIndex] as Seat;
    const selection = this.selectedDice(turn);
    const scored = selection.length > 0 ? scoreSelection(selection, this.ruleset) : null;
    const valid = scored?.valid === true;

    const remaining = turn.dice.length - selection.length;
    const nextRollCount = turn.phase === "awaiting_roll" ? DICE_PER_ROLL : remaining === 0 ? DICE_PER_ROLL : remaining;

    return {
      seatId: seat.id,
      rollSeq: turn.seq,
      dice: [...turn.dice],
      held: [...turn.held],
      dead: this.deadFlags(turn),
      kept: turn.kept,
      selection: valid && scored !== null ? scored.points : 0,
      selectionValid: valid,
      nextRollCount,
      bustChance: bustProbability(nextRollCount, this.ruleset),
      phase: turn.phase,
      endsAt: this.endsAt,
    };
  }

  /**
   * The table as one seat may see it.
   *
   * Greed hides nothing — six dice on a table are six dice on a table, and
   * every seat is told the same thing, so `forSeatId` changes nothing here.
   * The parameter exists because the caller must be in the habit of asking on
   * behalf of somebody: a game with a card face down cannot be bolted onto a
   * server that only knows how to describe a table once.
   *
   * @param forSeatId The seat asking, or null for an onlooker.
   */
  view(forSeatId: string | null = null): RoomView {
    void forSeatId;
    const host = this.hostId;
    const seats: SeatView[] = this.seats.map((seat) => ({
      id: seat.id,
      name: seat.name,
      score: seat.score,
      onBoard: seat.onBoard,
      connected: seat.connected,
      isHost: seat.id === host,
      isBot: seat.isBot,
      signedIn: seat.userId !== null,
      waiting: seat.waiting,
      avatar: seat.avatar,
      accentColor: seat.accentColor,
    }));
    return {
      code: this.code,
      status: this.status,
      watching: this.seating.watching,
      seats,
      turn: this.turn === null ? null : this.turnView(this.turn),
      ruleset: this.ruleset,
      buyIn: this.buyIn,
      pot: this.pot,
      winnerIds: [...this.winnerIds],
      lastEvent: this.lastEvent,
    };
  }
}
