import type { BotMove, GameAdapter, GameDeps, Seat } from "@backroom/core";
import { seatLimit, TableError } from "@backroom/core";
import type { Face } from "./bid.js";
import { isFace, minRaise, says } from "./bid.js";
import { choose, thinkingTime } from "./bot.js";
import { anteFor, diceFor, LIARS_DICE, RESULT_MS, REVEAL_MS, TURN_MS } from "./listing.js";
import type { Resolution } from "./round.js";
import { Table } from "./table.js";

/** Who somebody is at this table, or a name for a seat that has gone. */
const nameOf = (table: Table, seatId: string): string =>
  table.seats.find((one) => one.id === seatId)?.name ?? "Somebody";

/**
 * A resolution in one sentence, for the activity log.
 *
 * The count is always said, because it is the thing everybody at the table
 * wants to know and the only thing they could not have worked out themselves.
 *
 * `right` is a fact about the bid rather than about the caller — a good bid
 * costs whoever doubted it — so the two branches read backwards from the name
 * and are deliberately spelled out in full rather than shortened.
 */
const said = (table: Table, out: Resolution): string => {
  const caller = nameOf(table, out.caller);
  const bidder = nameOf(table, out.bidder);
  const count = `${out.count} on the table`;
  if (out.call === "liar") {
    return out.right
      ? `${caller} called ${bidder} a liar over ${says(out.bid)} — ${count}, so ${caller} loses a die.`
      : `${caller} called ${bidder} a liar over ${says(out.bid)} — ${count}, so ${bidder} loses a die.`;
  }
  return out.right
    ? `${caller} called ${says(out.bid)} exactly — ${count}, and everybody else loses a die.`
    : `${caller} called ${says(out.bid)} exactly — ${count}, so ${caller} loses a die.`;
};

/**
 * What the room does with a Liar's Dice table.
 *
 * The money needs no bank to be honest: every chip in the pot came off one of
 * the players in the game, and one of them takes it. Nothing is staked during a
 * game at all, so `act` never touches an account — the only money here is the
 * antes and the payout.
 *
 * The timing is the awkward part, and it is Death Roll's. A game cannot start
 * until the antes are in, and nothing starts one but the table's own clock;
 * `pause` is synchronous and cannot take an ante, so the table asks for a game
 * and `payOut` — asynchronous, run on every broadcast — takes the antes, deals,
 * and asks the room to send the state again.
 */
export function liarsDiceAdapter(
  options: {
    /**
     * Where a die comes from. Injected so tests can deal to order; in the
     * server it is `randomInt`, because a reveal hands the table every hand at
     * once — exactly the run of observations that predicts the next deal from
     * Math.random.
     */
    roll?: () => Face;
    turnMs?: number;
    revealMs?: number;
    resultMs?: number;
    countdownMs?: number;
  } = {},
): GameAdapter<Table> {
  const roll = options.roll ?? (() => (Math.floor(Math.random() * 6) + 1) as Face);
  const turnMs = options.turnMs ?? TURN_MS;
  const revealMs = options.revealMs ?? REVEAL_MS;
  const resultMs = options.resultMs ?? RESULT_MS;

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
   * Records chips just taken for the game on the felt.
   *
   * False only when the table has been called off while the take was in
   * flight: the void has already handed back everything it held, and this
   * arrived too late to be in it, so the caller gives it back in full. Play
   * money and guests are never held.
   */
  const hold = (table: Table, seat: Pick<Seat, "id" | "userId">, chips: number): boolean => {
    if (table.forFun || seat.userId === null) {
      return true;
    }
    return table.escrow.hold(seat.userId, chips);
  };

  /**
   * Chips going back before the game is decided: off the escrow, then to them.
   *
   * What `release` actually removed, never the nominal amount — a void may
   * already have refunded this account, and handing it back again would be
   * paying it twice.
   */
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
      if (paid && !hold(table, seat, table.ante)) {
        /*
         * Taken after the table was called off. The void has already handed
         * back every ante it held and this one was not among them, so it goes
         * back in full — and nobody is dealt at a table that has closed.
         */
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

    /*
     * A void while a refund above was in flight has already handed back every
     * ante held for this deal. Dealing now would open a game whose pot is gone.
     */
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

  return {
    listing: LIARS_DICE,

    create(code, made) {
      const table = new Table(code, seatLimit(made?.["maxSeats"], LIARS_DICE.maxSeats), {
        ante: anteFor(made?.["buyIn"]),
        dice: diceFor(made?.["dice"]),
        roll,
        turnMs,
        ...(options.countdownMs === undefined ? {} : { countdownMs: options.countdownMs }),
      });
      // Fixed when the table is opened: a table anybody may sit at and one that
      // spends real chips are not the same game with a different label.
      table.forFun = made?.["forFun"] === true;
      return table;
    },

    /**
     * One move. No chips move here, at all.
     *
     * Nothing is staked during a game — the antes went on at the deal and the
     * pot is settled at the end — so unlike Death Roll's pass there is nothing
     * here to take, hold or hand back. What is left is the rules, and the rules
     * refuse in words. `deps` is not taken at all rather than taken and ignored,
     * so nothing here can grow a route to an account by accident.
     *
     * Still `async`, with nothing awaited in it: every refusal in here has to
     * reach the player as a rejection, the way it does at every other table,
     * and a synchronous throw out of a method the room awaits is a different
     * thing for the room to catch.
     */
    async act(table, seatId, action) {
      const move = action as { type?: string; ready?: unknown; count?: unknown; face?: unknown };
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
        throw new TableError("There is nothing to bid on right now.");
      }

      switch (move.type) {
        case "bid": {
          /*
           * Checked here rather than trusted, because these two numbers arrive
           * from a browser: the count is bounded by the round, which knows how
           * many dice are on the table, and the face has to actually be a face.
           */
          if (!isFace(move.face)) {
            throw new TableError("That is not a face on a die.");
          }
          if (typeof move.count !== "number") {
            throw new TableError("A bid names a whole number of dice.");
          }
          const bid = { count: move.count, face: move.face };
          game.raise(seatId, bid);
          table.say(`${seat.name} bid ${says(bid)}.`);
          table.touchClock();
          return;
        }
        case "liar":
        case "exact": {
          const out = game.call(seatId, move.type);
          table.say(said(table, out));
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
        console.error(`liars dice ${table.code}: the deal fell through`, error);
        return true;
      } finally {
        table.draining = false;
      }
    },

    isSettled(table) {
      return table.phase === "over";
    },

    /**
     * Pays the pot to the last one holding dice: every ante, out of chips
     * already in it. Seats in the game are held until the felt clears, so the
     * winner is always there to be paid; if one somehow is not, nothing is
     * recorded as though it were.
     */
    async settle(table, deps) {
      const game = table.game;
      if (game === null || !game.over) {
        return;
      }
      /*
       * Before the first await: the pot now belongs to the winner, not to the
       * accounts it came off, so a void racing this settlement finds nothing
       * left to give back twice.
       */
      table.escrow.settle();
      const winnerId = game.winnerId as string;
      const winner = table.seats.find((one) => one.id === winnerId);
      if (winner === undefined) {
        throw new Error(`liars dice: ${table.code} won by a seat that is gone; pot unpaid`);
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
            chipsStaked: game.ante,
          },
          game: LIARS_DICE.id,
          add: {
            games: 1,
            bids: game.bidsBy(seatId),
            calls: game.callsBy(seatId),
            exacts: game.exactsBy(seatId),
            exactsHit: game.hitsBy(seatId),
          },
          max: { pot: game.pot, rounds: game.survivedBy(seatId) },
        });
      }

      await deps.finished({
        code: table.code,
        rulesetName: `${table.startingDice} dice`,
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

    /** Calls the table off: every ante still on the felt, back to whoever paid it. */
    async void(table, deps) {
      const owed = table.escrow.close();
      for (const one of owed) {
        await deps.give(one.userId, one.chips);
      }
      return owed;
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
      return { seatId: game.round.toAct, endsAt };
    },

    /**
     * Acts for somebody whose time ran out.
     *
     * The lowest legal raise, which is the neutral move: it resolves nothing,
     * so a bad connection cannot cost somebody a die or their ante. Only when
     * the board is at its ceiling and no raise exists is there nothing else to
     * do but call — and by then there is no other move in the game.
     */
    timeout(table, seatId) {
      const game = table.game;
      if (game === null || game.over || game.round.over || game.round.toAct !== seatId) {
        return;
      }
      const name = nameOf(table, seatId);
      const raise = minRaise(game.round.bid, game.round.total);
      if (raise === null) {
        const out = game.call(seatId, "liar");
        table.say(`The clock called liar for ${name}. ${said(table, out)}`);
      } else {
        game.raise(seatId, raise);
        table.say(`The clock bid ${says(raise)} for ${name}.`);
      }
      table.touchClock();
    },

    /** A bot's turn, or nothing. Bots only sit at tables playing for fun. */
    botMove(table): BotMove | null {
      const game = table.game;
      if (game === null || game.over || game.round.over) {
        return null;
      }
      const round = game.round;
      const seat = table.seats.find((one) => one.id === round.toAct);
      if (seat === undefined || !seat.isBot) {
        return null;
      }
      const skill = seat.skill ?? "normal";
      const choice = choose({
        skill,
        hand: round.handFor(seat.id) ?? [],
        total: round.total,
        standing: round.bid,
      });
      return {
        seatId: seat.id,
        delayMs: thinkingTime(skill),
        play() {
          // Checked again on the way in: the clock may have acted for this seat
          // while the bot was thinking, or the round may be over.
          if (
            table.game !== game ||
            game.round !== round ||
            round.over ||
            round.toAct !== seat.id
          ) {
            return;
          }
          if (choice.type === "bid") {
            game.raise(seat.id, choice.bid);
            table.say(`${seat.name} bid ${says(choice.bid)}.`);
          } else {
            const out = game.call(seat.id, choice.type);
            table.say(said(table, out));
          }
          table.touchClock();
        },
      };
    },

    /**
     * The table's own clock.
     *
     * A finished game is left up to be read, then cleared. A revealed round
     * stays up, then the next one is dealt. Between games: everybody ready
     * deals at once, and a running countdown deals when it ends.
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
          ? { key: "round", ms: revealMs, run: () => table.nextRound() }
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
