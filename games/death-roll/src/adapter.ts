import type { BotMove, GameAdapter, GameDeps, Seat } from "@backroom/core";
import { seatLimit, TableError } from "@backroom/core";
import { choose, thinkingTime } from "./bot.js";
import { anteFor, DEATH_ROLL, openingFor, RESULT_MS, ROUND_MS, TURN_MS } from "./listing.js";
import { passMargin } from "./odds.js";
import { Table } from "./table.js";

/**
 * What the room does with a death roll table.
 *
 * The money needs no bank to be honest: every chip in the pot came off one of
 * the players in the game, and one of them takes it. The timing is the awkward
 * part. A game cannot start until the antes are in, and nothing starts one but
 * the table's own clock; `pause` is synchronous and cannot take an ante, so the
 * table asks for a game and `payOut` — asynchronous, run on every broadcast —
 * takes the antes, deals, and asks the room to send the state again.
 */
export function deathRollAdapter(
  options: {
    /**
     * Where the number comes from. Injected so tests can roll to order; in the
     * server it is `randomInt`, because this game hands the player its whole
     * result every turn — exactly the run of observations that predicts the
     * next one from Math.random.
     */
    roll?: (ceiling: number) => number;
    turnMs?: number;
    resultMs?: number;
    roundMs?: number;
    countdownMs?: number;
  } = {},
): GameAdapter<Table> {
  const roll = options.roll ?? ((ceiling: number) => Math.floor(Math.random() * ceiling) + 1);
  const turnMs = options.turnMs ?? TURN_MS;
  const resultMs = options.resultMs ?? RESULT_MS;
  const roundMs = options.roundMs ?? ROUND_MS;

  /**
   * Chips off a player, wherever this table's chips live: a for-fun table's
   * purse, or a real account. Keeping the two apart is the point — a branch that
   * got it wrong would quietly spend real balances at a table playing for fun.
   */
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

  /** Chips back to a player, from the same two worlds. */
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

  /**
   * Every ante back, trying them all even if one fails.
   *
   * One refund failing is no reason to keep the rest of these people's stakes,
   * so each is attempted and the first failure is only raised once all of them
   * have been.
   */
  const refundAll = async (table: Table, seats: readonly Seat[], deps: GameDeps) => {
    let failure: unknown = null;
    for (const seat of seats) {
      try {
        await give(table, seat, table.ante, deps);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== null) {
      throw failure;
    }
  };

  /**
   * The antes in, and a game dealt to whoever paid.
   *
   * Each ready player antes in seat order. A refusal sits that player out and
   * nobody else; a store that throws deals nobody and hands back everything
   * taken; a player who stood up while the antes were being taken gets theirs
   * back and is not dealt. Fewer than two funded deals nobody.
   */
  const antesIn = async (
    table: Table,
    wanted: readonly string[],
    deps: GameDeps,
  ): Promise<boolean> => {
    const funded: Seat[] = [];
    const short: string[] = [];
    for (const seatId of wanted) {
      const seat = table.seats.find((one) => one.id === seatId);
      /*
       * A seat gone, or only disconnected, is not charged, dealt, or marked
       * short. A deliberate leave only disconnects — the room reaps the seat
       * itself later — and a disconnected seat whose ready survived to be
       * queued for this deal must still not be anted while they are gone. Bots
       * are always connected, so this never sits one of them out.
       */
      if (seat === undefined || !seat.connected) {
        continue;
      }
      table.topUp(seat.id);
      let paid = false;
      try {
        paid = await take(table, seat, table.ante, deps);
      } catch (error) {
        /*
         * Noted before the refunds rather than after: a refund that throws
         * takes the rest of this with it, and the felt should still say why
         * the table stopped.
         */
        table.failDeal("The table could not take the antes, so nobody was dealt.");
        await refundAll(table, funded, deps);
        throw error;
      }
      if (paid) {
        funded.push(seat);
      } else {
        short.push(seat.id);
      }
    }

    /*
     * Only now is it safe to ask who is still here — and it stays unsafe for as
     * long as a refund is in flight. A seat that is not in a game is dropped the
     * moment its player leaves, which is the state for every await above and
     * every await a refund itself takes, so a player can go between antes or
     * *during the refund of somebody who already went*. Re-checked until a pass
     * finds nobody gone, with nothing awaited between that pass and the deal
     * below — otherwise a ghost could still reach the turn order, and a ghost
     * that won would be a pot nobody could be paid.
     *
     * Gone includes disconnected. Leave at this table only disconnects, and
     * the seat lingers until the room reaps it, so a seat still being there is
     * not the player still being there — the same test the first pass uses.
     */
    let here = funded;
    for (;;) {
      const stillHere = here.filter((seat) =>
        table.seats.some((one) => one.id === seat.id && one.connected),
      );
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

  return {
    listing: DEATH_ROLL,

    create(code, made) {
      const table = new Table(code, seatLimit(made?.["maxSeats"], DEATH_ROLL.maxSeats), {
        opening: openingFor(made?.["ceiling"]),
        ante: anteFor(made?.["buyIn"]),
        turnMs,
        ...(options.countdownMs === undefined ? {} : { countdownMs: options.countdownMs }),
      });
      // Fixed when the table is opened: a table anybody may sit at and one that
      // spends real chips are not the same game with a different label.
      table.forFun = made?.["forFun"] === true;
      return table;
    },

    async act(table, seatId, action, deps) {
      const move = action as { type?: string; ready?: unknown };
      const seat = table.seats.find((one) => one.id === seatId);
      if (seat === undefined) {
        throw new TableError("You are not at this table.");
      }
      if (move.type === "ready") {
        table.setReady(seatId, move.ready === true, Date.now());
        return;
      }
      const game = table.game;
      if (game === null || game.over || game.round.over) {
        throw new TableError("There is no roll to make right now.");
      }

      switch (move.type) {
        case "roll": {
          game.roll(seatId, roll);
          table.touchClock();
          return;
        }
        case "pass": {
          /*
           * Asked, paid, then spent: a player who cannot afford it is refused
           * with their pass still in hand. And handed straight back if the table
           * moved while the chips were in flight — the clock may have rolled for
           * this seat — since a pass paid for that never reached the pot is
           * chips gone from a game with no bank to lose them from.
           */
          const price = game.round.checkPass(seatId);
          if (!(await take(table, seat, price, deps))) {
            throw new TableError(
              table.forFun ? "That is more than your purse." : "You cannot cover a pass.",
            );
          }
          try {
            game.pass(seatId);
          } catch (error) {
            await give(table, seat, price, deps);
            throw error;
          }
          table.touchClock();
          return;
        }
        default:
          throw new TableError("That is not a move at this table.");
      }
    },

    /**
     * The antes, and the one thing that starts a game here.
     *
     * Drained before the first await, which is what makes running on every
     * broadcast exactly-once. Returns true when it changed the table, so the
     * room sends the state again; false when there was nothing to do.
     */
    async payOut(table, deps) {
      const wanted = table.takePending();
      if (wanted === null) {
        return false;
      }
      try {
        return await antesIn(table, wanted, deps);
      } catch (error) {
        /*
         * Every throw out of `antesIn` comes after `failDeal`, so the table has
         * already changed — readies stood down, a reason on the felt — and the
         * room only sends that when this answers true. Answered here rather
         * than by the room rebroadcasting on any payOut failure: the banked
         * games read the store in payOut on every broadcast, and a store that
         * stayed down would turn that into a loop.
         */
        console.error(`death roll ${table.code}: the deal fell through`, error);
        return true;
      } finally {
        table.draining = false;
      }
    },

    isSettled(table) {
      return table.phase === "over";
    },

    /**
     * Pays the pot to the last one standing: every ante and every pass, out of
     * chips already in it. Seats in the game are held until the felt clears, so
     * the winner is always there to be paid; if one somehow is not, nothing is
     * recorded as though it were.
     */
    async settle(table, deps) {
      const game = table.game;
      if (game === null || !game.over) {
        return;
      }
      const winnerId = game.winnerId as string;
      const winner = table.seats.find((one) => one.id === winnerId);
      if (winner === undefined) {
        throw new Error(`death roll: ${table.code} won by a seat that is gone; pot unpaid`);
      }
      await give(table, winner, game.pot, deps);

      // Play money is paid but never recorded: a for-fun win is nobody's to claim.
      if (table.forFun) {
        return;
      }

      for (const seatId of game.players) {
        const seat = table.seats.find((one) => one.id === seatId);
        if (seat === undefined || seat.userId === null) {
          continue;
        }
        const net = game.netFor(seatId);
        await deps.record(seat.userId, {
          shared: {
            rounds: 1,
            roundsWon: net > 0 ? 1 : 0,
            chipsWon: net,
            chipsStaked: game.ante + game.spentBy(seatId),
          },
          game: DEATH_ROLL.id,
          // `duels` kept as the key so nobody's history resets; it counts games.
          add: { duels: 1, passes: game.passesBy(seatId) },
          max: { pot: game.pot },
        });
      }

      await deps.finished({
        code: table.code,
        rulesetName: `${table.opening}`,
        buyIn: table.ante,
        pot: game.pot,
        players: game.players.map((seatId) => {
          const seat = table.seats.find((one) => one.id === seatId);
          return {
            userId: seat?.userId ?? null,
            name: seat?.name ?? "Somebody",
            score: game.survivedBy(seatId),
            isBot: seat?.isBot ?? false,
            net: game.netFor(seatId),
          };
        }),
        winnerIds: [winnerId],
        endedAt: Date.now(),
      });
    },

    winners(table) {
      const winner = table.game?.winnerId ?? null;
      return winner === null ? [] : [winner];
    },

    clock(table) {
      const game = table.game;
      const endsAt = table.turnEndsAt;
      if (game === null || game.over || game.round.over || endsAt === null) {
        return null;
      }
      return { seatId: game.round.toRoll, endsAt };
    },

    /**
     * Rolls for somebody whose time ran out — even a roll they could have
     * passed. The clock never spends somebody's pass for them, and never
     * forfeits: a bad connection must not cost a stake.
     */
    timeout(table, seatId) {
      const game = table.game;
      if (game === null || game.over || game.round.over || game.round.toRoll !== seatId) {
        return;
      }
      game.roll(seatId, roll);
      table.touchClock();
    },

    /** A bot's turn, or nothing. Bots only sit at tables playing for fun. */
    botMove(table): BotMove | null {
      const game = table.game;
      if (game === null || game.over || game.round.over) {
        return null;
      }
      const round = game.round;
      const seat = table.seats.find((one) => one.id === round.toRoll);
      if (seat === undefined || !seat.isBot) {
        return null;
      }
      const skill = seat.skill ?? "normal";
      const choice = choose({
        skill,
        players: round.order.length,
        ceiling: round.ceiling,
        toAct: round.position(seat.id),
        holders: round.holders(),
        passedTo: round.passedTo === seat.id,
        margin: passMargin(round.order.length, table.ante, table.passPrice),
        canAfford: table.purseFor(seat.id) >= table.passPrice,
      });
      return {
        seatId: seat.id,
        delayMs: thinkingTime(skill),
        play() {
          // Checked again on the way in: the clock may have rolled for this seat
          // while the bot was thinking, or the round may be over.
          if (table.game !== game || game.round !== round || round.over || round.toRoll !== seat.id) {
            return;
          }
          if (choice === "pass") {
            game.pass(seat.id);
            table.movePurse(seat.id, -table.passPrice);
          } else {
            game.roll(seat.id, roll);
          }
          table.touchClock();
        },
      };
    },

    /**
     * The table's own clock.
     *
     * A finished game is left up to be read, then cleared. A round that just
     * ended shows who went out, then the next one starts. Between games:
     * everybody ready deals at once, and a running countdown deals when it ends.
     *
     * The countdown keeps its own key even once it has run out. The room only
     * runs a pause if the table is still waiting on the same thing when the
     * timer fires — so a countdown that turned into "deal" at that moment would
     * never be run, and the table would sit there with people ready.
     */
    pause(table) {
      if (table.phase === "over") {
        return { key: "result", ms: resultMs, run: () => table.finish() };
      }
      const game = table.game;
      if (game !== null) {
        return game.betweenRounds
          ? { key: "round", ms: roundMs, run: () => table.nextRound() }
          : null;
      }
      if (table.pending || table.draining) {
        return null;
      }
      // Only the players still here: a seat held after Leave is not ready and
      // is not coming back for this deal, so it must not hold the rest to the
      // countdown.
      const seated = table.present();
      const now = Date.now();
      if (seated.length >= 2 && table.readiness.count(seated) === seated.length) {
        return { key: "deal", ms: 0, run: () => table.askForGame(Date.now()) };
      }
      const endsAt = table.readiness.countdownEndsAt;
      if (endsAt !== null) {
        return {
          key: "countdown",
          ms: Math.max(0, endsAt - now),
          run: () => table.askForGame(Date.now()),
        };
      }
      return null;
    },
  };
}
