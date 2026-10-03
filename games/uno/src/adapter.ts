import type { BotMove, GameAdapter, GameDeps, Seat } from "@backroom/core";
import { seatLimit, TableError } from "@backroom/core";
import type { Decision } from "./bot.js";
import { act as botAct, decide, neutralMove, PROFILES, thinkingTime } from "./bot.js";
import { isColor } from "./cards.js";
import type { Game } from "./engine.js";
import { UnoError } from "./engine.js";
import { anteFor, BOT_SPEEDS, botSpeedOf, RESULT_MS, ROUND_MS, TURN_MS, UNO } from "./listing.js";
import { sanitize } from "./rules.js";
import { Table } from "./table.js";

/**
 * Runs one engine move, saying what it did and turning the engine's refusals
 * into the table's.
 *
 * The engine refuses in words, and those words are for the player. Anything
 * else it throws is a bug, and goes up as one rather than being dressed as a
 * refusal somebody might think was their fault.
 */
function move(table: Table, game: Game, run: () => void): void {
  const mark = game.logTotal;
  try {
    run();
  } catch (error) {
    if (error instanceof UnoError) {
      throw new TableError(error.message);
    }
    throw error;
  }
  const lines = game.linesSince(mark);
  if (lines.length > 0) {
    table.say(lines.join(" "));
  }
  table.touchClock();
}

/**
 * What the room does with an Uno table.
 *
 * The money needs no bank to be honest: every chip in the pot came off a
 * player in the game, and the champion takes it. Nothing is staked during a
 * game, so `act` never touches an account — the only money is the antes going
 * in at the deal and the pot going out at the end.
 *
 * The timing is Liar's Dice's. Nothing starts a game but the table's own
 * clock, and `pause` is synchronous and cannot take an ante, so the table asks
 * for a game and `payOut` — asynchronous, run on every broadcast — takes the
 * antes, deals, and asks the room to send the state again.
 */
export function unoAdapter(
  options: {
    /**
     * Where the shuffle comes from. Injected so a test can stack the deck; in
     * the server it is `node:crypto`, because every round ends with every
     * hand face up — exactly the run of observations that predicts the next
     * shuffle from Math.random.
     */
    rng?: () => number;
    turnMs?: number;
    roundMs?: number;
    resultMs?: number;
    countdownMs?: number;
  } = {},
): GameAdapter<Table> {
  const rng = options.rng ?? Math.random;
  const turnMs = options.turnMs ?? TURN_MS;
  const roundMs = options.roundMs ?? ROUND_MS;
  const resultMs = options.resultMs ?? RESULT_MS;

  /** Chips off a player, from a for-fun purse or a real account — never mixed up. */
  const take = async (
    table: Table,
    seat: Pick<Seat, "id" | "userId">,
    chips: number,
    deps: GameDeps,
  ): Promise<boolean> => {
    if (table.forFun) {
      if (table.purseFor(seat.id) < chips) {
        return false;
      }
      table.movePurse(seat.id, -chips);
      return true;
    }
    if (seat.userId === null) {
      throw new TableError("Sign in to play for chips.");
    }
    return await deps.take(seat.userId, chips);
  };

  const give = async (
    table: Table,
    seat: Pick<Seat, "id" | "userId">,
    chips: number,
    deps: GameDeps,
  ): Promise<void> => {
    if (chips <= 0) {
      return;
    }
    if (table.forFun) {
      table.movePurse(seat.id, chips);
      return;
    }
    if (seat.userId !== null) {
      await deps.give(seat.userId, chips);
    }
  };

  /** Records an ante just taken. False only when a void got there first. */
  const hold = (table: Table, seat: Pick<Seat, "id" | "userId">, chips: number): boolean => {
    if (table.forFun || seat.userId === null) {
      return true;
    }
    return table.escrow.hold(seat.userId, chips);
  };

  /** An ante going back before the game is decided: what the escrow released, never more. */
  const giveBack = async (
    table: Table,
    seat: Pick<Seat, "id" | "userId">,
    chips: number,
    deps: GameDeps,
  ): Promise<void> => {
    if (table.forFun || seat.userId === null) {
      await give(table, seat, chips, deps);
      return;
    }
    await give(table, seat, table.escrow.release(seat.userId, chips), deps);
  };

  /** Every ante back, trying them all even when one fails. */
  const refundAll = async (table: Table, seats: readonly Seat[], deps: GameDeps) => {
    let failure: unknown = null;
    for (const seat of seats) {
      try {
        await giveBack(table, seat, table.ante, deps);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== null) {
      throw failure;
    }
  };

  /**
   * The antes in, and a game dealt to whoever paid. Liar's Dice's, line for
   * line in what it guards against: a refusal sits one player out, a store
   * that throws deals nobody and hands everything back, a player who left
   * while the antes were being taken gets theirs back and is not dealt.
   */
  const antesIn = async (table: Table, wanted: readonly string[], deps: GameDeps): Promise<boolean> => {
    const funded: Seat[] = [];
    const short: string[] = [];
    for (const seatId of wanted) {
      const seat = table.seats.find((one) => one.id === seatId);
      if (seat === undefined || !seat.connected) {
        continue;
      }
      table.topUp(seat.id);
      let paid = false;
      try {
        paid = await take(table, seat, table.ante, deps);
      } catch (error) {
        table.failDeal("The table could not take the antes, so nobody was dealt.");
        await refundAll(table, funded, deps);
        throw error;
      }
      if (paid && !hold(table, seat, table.ante)) {
        await give(table, seat, table.ante, deps);
        await refundAll(table, funded, deps);
        return true;
      }
      if (paid) {
        funded.push(seat);
      } else {
        short.push(seat.id);
      }
    }

    // Re-checked until nobody is found gone, with nothing awaited between the
    // last pass and the deal, so a ghost can never reach the turn order.
    let here = funded;
    for (;;) {
      const stillHere = here.filter((seat) => table.seats.some((one) => one.id === seat.id && one.connected));
      if (stillHere.length === here.length) {
        here = stillHere;
        break;
      }
      const gone = here.filter((seat) => !stillHere.includes(seat));
      try {
        await refundAll(table, gone, deps);
      } catch (error) {
        table.failDeal("The table could not take the antes, so nobody was dealt.");
        await refundAll(table, stillHere, deps);
        throw error;
      }
      here = stillHere;
    }

    if (table.escrow.closed) {
      return true;
    }
    table.noteShorts(short);
    if (here.length < 2) {
      table.failDeal(
        short.length > 0
          ? "Not enough players could cover the ante, so nobody was dealt."
          : "Not enough players are left to deal.",
      );
      await refundAll(table, here, deps);
      return true;
    }
    table.begin(here.map((seat) => seat.id));
    return true;
  };

  /**
   * What a bot wants to do right now, if anything — one move at a time.
   *
   * Out-of-turn moves go first, because they only exist for a moment: calling
   * UNO late before somebody catches it, catching somebody, jumping in on the
   * card just played. Each is planned once per window or per card, with one
   * roll, so asking again on every broadcast does not turn a one-in-four
   * chance into a certainty.
   */
  const nextBotMove = (table: Table): { seat: Seat; delayMs: number; run: () => void } | null => {
    const game = table.game;
    if (game === null || !game.active) {
      return null;
    }
    const seatOf = (index: number | null) =>
      index === null ? undefined : table.seats.find((one) => one.id === table.seatAt(index));
    const isBot = (index: number) => seatOf(index)?.isBot === true;
    const skillOf = (index: number) => seatOf(index)?.skill ?? "normal";

    // UNO left uncalled: the bot who forgot may remember, and others may pounce.
    const target = game.unoVulnerable;
    if (target !== null) {
      if (table.catchPlan?.window !== game.unoWindow) {
        const catchers = game.players
          .filter((one) => one.index !== target && isBot(one.index))
          .filter((one) => rng() < PROFILES[skillOf(one.index)].catchChance);
        table.catchPlan = {
          window: game.unoWindow,
          declare: isBot(target) && rng() < PROFILES[skillOf(target)].lateDeclare,
          catcher: catchers[Math.floor(rng() * catchers.length)]?.index ?? null,
        };
      }
      const plan = table.catchPlan;
      const self = seatOf(target);
      if (plan.declare && self !== undefined) {
        return { seat: self, delayMs: 300 + Math.floor(rng() * 500), run: () => game.declareUno(target) };
      }
      const catcher = seatOf(plan.catcher);
      if (plan.catcher !== null && catcher !== undefined) {
        const by = plan.catcher;
        return {
          seat: catcher,
          delayMs: 700 + Math.floor(rng() * 900),
          run: () => game.callUno(by, target),
        };
      }
    }

    // Jump-in: every new top card gives the bots one chance between them.
    const top = game.top();
    if (game.rules.jumpIn && top !== null && (game.phase === "playing" || game.phase === "postDraw")) {
      if (table.jumpPlan?.topId !== top.id) {
        const keen = game.players.filter(
          (one) =>
            one.index !== game.current &&
            isBot(one.index) &&
            one.hand.some((card) => game.canJumpIn(one.index, card)) &&
            rng() < PROFILES[skillOf(one.index)].jumpIn,
        );
        table.jumpPlan = { topId: top.id, player: keen[Math.floor(rng() * keen.length)]?.index ?? null };
      }
      const who = table.jumpPlan.player;
      const jumper = seatOf(who);
      if (who !== null && jumper !== undefined && who !== game.current) {
        const card = game.players[who]?.hand.find((one) => game.canJumpIn(who, one));
        if (card !== undefined) {
          return {
            seat: jumper,
            delayMs: 500 + Math.floor(rng() * 700),
            run: () => {
              table.jumpPlan = null;
              game.playCard(who, card.id, {
                color: game.bestColor(who, card.id),
                target: game.fewestCards(who) ?? undefined,
                declareUno:
                  game.players[who]?.hand.length === 2 && rng() < PROFILES[skillOf(who)].unoDeclare,
              });
            },
          };
        }
      }
    }

    // Its own turn.
    const self = seatOf(game.current);
    if (self === undefined || !self.isBot) {
      return null;
    }
    const player = game.current;
    const decision: Decision | null = decide(game, player, self.skill ?? "normal", rng);
    if (decision === null) {
      return null;
    }
    return {
      seat: self,
      delayMs: thinkingTime(self.skill ?? "normal", rng, {
        speed: BOT_SPEEDS[table.botSpeed],
        hurrySeconds: game.turnTimeLimit,
        challenge: game.phase === "challenge",
      }),
      run: () => botAct(game, player, decision),
    };
  };

  return {
    listing: UNO,

    create(code, made) {
      const table = new Table(code, seatLimit(made?.["maxSeats"], UNO.maxSeats), {
        ante: anteFor(made?.["buyIn"]),
        rules: sanitize(made?.["uno"]),
        botSpeed: botSpeedOf((made?.["uno"] as Record<string, unknown> | undefined)?.["botSpeed"]),
        rng,
        turnMs,
        ...(options.countdownMs === undefined ? {} : { countdownMs: options.countdownMs }),
      });
      // Fixed when the table opens: a table anybody may sit at and one that
      // spends real chips are not the same game with a different label.
      table.forFun = made?.["forFun"] === true;
      return table;
    },

    /**
     * One move. No chips move here, at all — the antes went on at the deal and
     * the pot is paid at the end — so `deps` is not even taken.
     *
     * Every number and id in here arrived from a browser, and is checked
     * against the game rather than trusted: a card has to be in your hand, a
     * colour has to be a colour, a target has to be somebody in the game.
     */
    async act(table, seatId, action) {
      const m = action as {
        type?: string;
        ready?: unknown;
        cardId?: unknown;
        color?: unknown;
        target?: unknown;
        uno?: unknown;
        challenge?: unknown;
        seat?: unknown;
      };
      const seat = table.seats.find((one) => one.id === seatId);
      if (seat === undefined) {
        throw new TableError("You are not at this table.");
      }
      if (m.type === "ready") {
        table.setReady(seatId, m.ready === true, Date.now());
        return;
      }
      const game = table.game;
      if (game === null || !game.active) {
        throw new TableError("There is nothing to play right now.");
      }
      const me = table.indexOf(seatId);
      if (me === -1) {
        throw new TableError("You are not in this game.");
      }

      switch (m.type) {
        case "play": {
          if (typeof m.cardId !== "number") {
            throw new TableError("Pick a card.");
          }
          const target = typeof m.target === "string" ? table.indexOf(m.target) : -1;
          move(table, game, () =>
            game.playCard(me, m.cardId, {
              color: isColor(m.color) ? m.color : undefined,
              target: target === -1 ? undefined : target,
              declareUno: m.uno === true,
            }),
          );
          return;
        }
        case "draw":
          move(table, game, () => game.drawCard(me));
          return;
        case "pass":
          move(table, game, () => game.pass(me));
          return;
        case "color":
          move(table, game, () => game.chooseStartColor(me, m.color));
          return;
        case "challenge":
          move(table, game, () => game.respondChallenge(me, m.challenge === true));
          return;
        case "uno":
          move(table, game, () => game.declareUno(me));
          return;
        case "catch": {
          const target = typeof m.seat === "string" ? table.indexOf(m.seat) : -1;
          if (target === -1) {
            throw new TableError("There's nobody to catch.");
          }
          move(table, game, () => game.callUno(me, target));
          return;
        }
        default:
          throw new TableError("That is not a move at this table.");
      }
    },

    async payOut(table, deps) {
      const wanted = table.takePending();
      if (wanted === null) {
        return false;
      }
      try {
        return await antesIn(table, wanted, deps);
      } catch (error) {
        console.error(`uno ${table.code}: the deal fell through`, error);
        return true;
      } finally {
        table.draining = false;
      }
    },

    isSettled(table) {
      return table.phase === "over";
    },

    /**
     * Pays the pot to the champion: every ante, out of chips already in it.
     * Seats in a game are held until the felt clears, so the champion is
     * always there to be paid.
     */
    async settle(table, deps) {
      const game = table.game;
      const championId = table.championId;
      if (game === null || !game.over || championId === null) {
        return;
      }
      // Before the first await: the pot is the champion's now, so a void
      // racing this finds nothing left to hand back twice.
      table.escrow.settle();
      const champion = table.seats.find((one) => one.id === championId);
      if (champion === undefined) {
        throw new Error(`uno: ${table.code} won by a seat that is gone; pot unpaid`);
      }
      const pot = table.pot;
      await give(table, champion, pot, deps);

      // Play money is paid but never recorded: a for-fun win is nobody's to claim.
      if (table.forFun) {
        return;
      }

      for (const [index, seatId] of table.players.entries()) {
        const seat = table.seats.find((one) => one.id === seatId);
        if (seat === undefined || seat.userId === null) {
          continue;
        }
        const net = table.netFor(seatId);
        await deps.record(seat.userId, {
          shared: { rounds: 1, roundsWon: net > 0 ? 1 : 0, chipsWon: net, chipsStaked: table.ante },
          game: UNO.id,
          add: { games: 1, roundsPlayed: game.round },
          max: { pot, score: game.players[index]?.score ?? 0 },
        });
      }

      await deps.finished({
        code: table.code,
        rulesetName: table.rulesetName,
        buyIn: table.ante,
        pot,
        players: table.players.map((seatId, index) => {
          const seat = table.seats.find((one) => one.id === seatId);
          return {
            userId: seat?.userId ?? null,
            name: seat?.name ?? "Somebody",
            score: game.players[index]?.score ?? 0,
            isBot: seat?.isBot ?? false,
            net: table.netFor(seatId),
          };
        }),
        winnerIds: [championId],
        endedAt: Date.now(),
      });
    },

    async void(table, deps) {
      const owed = table.escrow.close();
      for (const one of owed) {
        await deps.give(one.userId, one.chips);
      }
      return owed;
    },

    winners(table) {
      const champion = table.championId;
      return champion === null ? [] : [champion];
    },

    clock(table) {
      const game = table.game;
      const endsAt = table.turnEndsAt;
      if (game === null || !game.active || endsAt === null) {
        return null;
      }
      const seatId = table.seatAt(game.current);
      return seatId === null ? null : { seatId, endsAt };
    },

    /**
     * Moves for somebody whose time ran out.
     *
     * Under Hurry Up! that is the rule's own penalty: a card and the turn.
     * Otherwise it is the move that decides nothing — keep the colour you hold
     * most of, take the Draw Four rather than gamble on a challenge, keep a
     * drawn card, or draw — so a bad connection costs a turn and not a game.
     */
    timeout(table, seatId) {
      const game = table.game;
      if (
        game === null ||
        !game.active ||
        table.seatAt(game.current) !== seatId ||
        table.turnEndsAt === null ||
        table.turnEndsAt > Date.now()
      ) {
        return;
      }
      const player = game.current;
      const mark = game.logTotal;
      if (game.turnTimeLimit !== null) {
        game.timeout(player);
      } else {
        neutralMove(game, player);
      }
      table.say(`The clock moved for ${table.nameOf(seatId)}. ${game.linesSince(mark).join(" ")}`.trim());
      table.touchClock();
    },

    /** A bot's move, or nothing. Bots only sit at tables playing for fun. */
    botMove(table): BotMove | null {
      const next = nextBotMove(table);
      if (next === null) {
        return null;
      }
      const game = table.game as Game;
      return {
        seatId: next.seat.id,
        delayMs: next.delayMs,
        play() {
          if (table.game !== game || !game.active) {
            return;
          }
          move(table, game, next.run);
        },
      };
    },

    /**
     * The table's own clock: a finished game stays up to be read, then clears;
     * a finished round stays up with every hand face up, then the next is
     * dealt; between games, everybody ready deals at once and a running
     * countdown deals when it ends.
     */
    pause(table) {
      if (table.phase === "over") {
        return { key: "result", ms: resultMs, run: () => table.finish() };
      }
      if (table.phase === "between") {
        return { key: `round-${table.game?.round ?? 0}`, ms: roundMs, run: () => table.nextRound() };
      }
      if (table.game !== null || table.pending || table.draining) {
        return null;
      }
      const seated = table.present();
      if (seated.length >= 2 && table.readiness.count(seated) === seated.length) {
        return { key: "deal", ms: 0, run: () => table.askForGame(Date.now()) };
      }
      const endsAt = table.readiness.countdownEndsAt;
      if (endsAt !== null) {
        return {
          key: "countdown",
          ms: Math.max(0, endsAt - Date.now()),
          run: () => table.askForGame(Date.now()),
        };
      }
      return null;
    },
  };
}
