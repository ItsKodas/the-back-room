import type { BotMove, GameAdapter, GameDeps } from "@backroom/core";
import { ledgerOf, seatLimit, TableError } from "@backroom/core";
import { type Bet, headroom, owed, staked } from "./bank.js";
import { toBets } from "./bets.js";
import { botBet, thinkingTime } from "./bot.js";
import { CRAPS } from "./listing.js";
import { spotAt } from "./spots.js";
import { ROLL_MS, SETTLE_MS, Table, WINDOWS } from "./table.js";

/** What a table needs of the chips everybody before it has staked. */
export interface Bank {
  holds(): Promise<number>;
  add(amount: number): Promise<void>;
  /** Pays out, or returns false rather than overdrawing. */
  take(amount: number): Promise<boolean>;
}

/**
 * What came off the cloth, or why it could not.
 *
 * Two refusals rather than one, because they are different facts and a player
 * refused deserves the true one: chips can be pinned down because another bet
 * is leaning on them, or because the bank has already handed them out as
 * somebody's winnings and has not got them to give back.
 */
type Lift = { off: number } | { refused: string };

/**
 * What the room does with a craps table.
 *
 * Roulette's money with one thing added, and the addition is the whole file.
 * A wheel settles every chip every spin, so a cloth that has been paid owes
 * nothing; this cloth carries place bets, hardways and travelled come bets
 * into the next roll. That shows up three times below — in what the table
 * tells the bank's book it could still be asked for, in what a take-back is
 * allowed to lift, and in the fact that betting ends by *sealing* rather than
 * by the dice simply going, so the off rule can be decided inside the bank's
 * own queue where nothing can move the bank between reading it and the dice
 * deciding.
 */
export function crapsAdapter(
  options: {
    pick?: (faces: number) => number;
    /** How long the felt is open for bets. An argument so a test can hurry it. */
    window?: number;
    /** How long the dice are in the air. */
    rollMs?: number;
    /** How long a finished roll stays up to be read. */
    settleMs?: number;
    /**
     * The bank these tables pay from, when there is one.
     *
     * Without it a table takes chips off accounts and hands winnings back with
     * nothing in between, which is a cloth that mints. With it, every chip is
     * in the bank before the dice are released and every payout comes out of
     * it, so the table can only ever hand over what somebody put there.
     */
    bank?: Bank;
  } = {},
): GameAdapter<Table> {
  const bank = options.bank ?? null;
  const rollMs = options.rollMs ?? ROLL_MS;
  const settleMs = options.settleMs ?? SETTLE_MS;

  /*
   * The book every table paid from this bank keeps together.
   *
   * Every craps table in the building is paid from one bank, so a cap worked
   * out against this table's cloth alone reads every other table's chips as
   * headroom — chips those tables' winners are already owed. See `BankLedger`
   * for the whole of why.
   */
  const ledger = bank === null ? null : ledgerOf(bank);

  /** Whether this table's chips are the bank's, and so in the book. */
  const banked = (table: Table): boolean => ledger !== null && !table.forFun;

  /** Rolls that have been paid, so a settled cloth stops holding the bank's chips. */
  const paidOut = new WeakSet<object>();

  /**
   * A roll handed to `settle` and still waiting its turn in the queue.
   *
   * Counted apart from the table, because the table does not wait for it: a
   * table that has opened its next window no longer says what the last roll
   * is owed.
   */
  const unpaid = new WeakMap<Table, { roll: object; back: number }>();

  /** What a void has closed the escrow on and not yet paid back out of the bank. */
  const refunding = new WeakMap<Table, number>();

  const backOf = (roll: ReadonlyMap<string, { back: number }>): number => {
    let back = 0;
    for (const one of roll.values()) {
      back += one.back;
    }
    return back;
  };

  /**
   * The most this table could still take out of the bank, stakes back included.
   *
   * What the dice actually decided until that is paid, and then the cloth that
   * survived them — which is the line roulette does not have. A wheel owes
   * nothing once it has paid; this table is still carrying everybody's place
   * bets into the next roll, and a book that read those as nothing would let
   * another table promise them.
   */
  const owing = (table: Table): number => {
    /*
     * A called-off table owes only the refunds its void has not paid yet.
     * Those are still in the bank until the void's turn in the queue, and
     * reading them as nothing would let another table promise them. Nothing
     * after that, or an act queued behind the void would put its reservation
     * back on the way out of `serially`.
     */
    if (table.escrow.closed) {
      return refunding.get(table) ?? 0;
    }
    const waiting = unpaid.get(table);
    let total = waiting?.back ?? 0;
    if (table.paid !== null && table.paid !== waiting?.roll && !paidOut.has(table.paid)) {
      total += backOf(table.paid);
    }
    return total + owed(toBets(table.placed), table.hand);
  };

  /**
   * Runs something that moves this table's chips in the bank's own queue, and
   * tells the book what the table owes once it has.
   *
   * A for-fun table skips the queue: its bank is a field on the table, nobody
   * else's chips are in it, and it cannot promise anybody anything.
   */
  const serially = async <T>(table: Table, work: () => Promise<T>): Promise<T> => {
    if (ledger === null || !banked(table)) {
      return work();
    }
    return ledger.serially(async () => {
      try {
        return await work();
      } finally {
        ledger.owes(table, () => owing(table));
      }
    });
  };

  /*
   * Where a table's money actually lives.
   *
   * Two entirely separate worlds behind one set of verbs, and keeping them
   * separate is the point. A for-fun table's purse and bank live on the table
   * and are gone when it closes; a chips table's live in the store and belong
   * to real people. A signed-in player sitting at a for-fun table must spend
   * the former, and a branch that got this wrong would quietly spend the
   * latter — which is a real balance, really gone.
   */

  const holds = async (table: Table): Promise<number> => {
    if (table.forFun) {
      return table.funBank;
    }
    return bank === null ? Number.MAX_SAFE_INTEGER : bank.holds();
  };

  /**
   * What the bank holds, not counting the chips already on this cloth.
   *
   * The figure every cap is worked out against, and the figure the dice are
   * released against. Chips go into the bank as they land, so what it holds
   * already includes them — and `working` and `owed` add them back themselves
   * through `staked`, so handing either of them the stored balance would let
   * the cloth vouch for itself twice and the table would promise money it has
   * not got.
   *
   * Nor counting what every other table paid from this bank could owe. Their
   * chips are in there too, and they are not this table's to promise. Only
   * a fact inside `serially`, where nothing else can move the bank between
   * reading it and a chip landing.
   */
  const base = async (table: Table): Promise<number> => {
    const held = await holds(table);
    const elsewhere = ledger !== null && banked(table) ? ledger.owedElsewhere(table) : 0;
    return held - staked(toBets(table.placed)) - elsewhere;
  };

  /**
   * Chips off the cloth, unless the bank cannot stand it.
   *
   * Two refusals, and the second one is craps' own. A chip coming off comes
   * out of the bank, and what it leaves does not get cheaper for it: the six
   * went down against the bank, the eight was then allowed to lean on the six,
   * and taking the six back leaves the eight owed more than the bank holds. So
   * it is refused — but only when it makes the shortfall worse, so a bank
   * drained from outside never traps anybody's chips on a cloth.
   *
   * The other is that the chips have to be there to come off at all. A wheel
   * resolves every chip every spin, so a bet on its cloth is always still
   * backed by the stake that bought it; a place bet is paid and stays down,
   * and after a long enough run its own stake is what paid for its wins. The
   * bank can then hold less than the cloth is carrying, and lifting those
   * chips would be asking it for money it has already handed to the same
   * player. `floor` is the bank less this cloth, so `floor + what stays` is
   * what the bank would hold once the chips came off, and it may not go under
   * what the other tables on this bank are owed.
   *
   * Returns what came off, or why not, with the cloth put back. One check for
   * a take-back and for somebody who stood up, because they are one movement.
   *
   * Handed the floor rather than reading it, and synchronous from snapshot to
   * restore, on purpose. Reading the bank is an await, and anything that moved
   * the cloth in that gap — a leaver's chips handed back, the dice going —
   * would be undone by putting back a snapshot taken before it. Nothing is
   * released from the escrow until this has answered, so a refusal has nothing
   * to re-hold.
   */
  const lifts = (table: Table, floor: number, lift: () => void): Lift => {
    const before = [...table.placed];
    lift();
    const off = staked(toBets(before)) - staked(toBets(table.placed));
    const put = (refused: string): Lift => {
      table.placed = before;
      return { refused };
    };
    if (banked(table)) {
      const stays = toBets(table.placed);
      if (floor + staked(stays) < 0) {
        return put("The bank has not got those chips to hand back. They stay on the cloth for now.");
      }
      const short = (bets: readonly Bet[]) => owed(bets, table.hand) - staked(bets) - floor;
      if (short(stays) > Math.max(0, short(toBets(before)))) {
        return put("That chip is covering another bet. It stays for this roll.");
      }
    }
    return { off };
  };

  /**
   * Chips that came off the cloth, out of the bank to whoever put them down.
   *
   * What the escrow actually lets go of, never the nominal amount: a void
   * ahead of this in the bank's queue may already have handed these chips
   * back, and paying them again would pay them twice. Play money never
   * reaches the escrow, so a for-fun table pays what came off.
   */
  const handBack = async (
    table: Table,
    seat: { id: string; userId: string | null },
    off: number,
    deps: GameDeps,
  ): Promise<void> => {
    if (table.forFun || seat.userId === null) {
      await pay(table, seat, off, deps);
      return;
    }
    const back = table.escrow.release(seat.userId, off);
    await pay(table, seat, back, deps);
  };

  /** A take-back: the cover check, then the chips home. */
  const giveBack = async (
    table: Table,
    seat: { id: string; userId: string | null },
    lift: () => void,
    deps: GameDeps,
  ): Promise<void> => {
    const floor = await base(table);
    const lifted = lifts(table, floor, lift);
    if ("refused" in lifted) {
      throw new TableError(lifted.refused);
    }
    await handBack(table, seat, lifted.off, deps);
  };

  /** Chips off the player and into the bank. False if they have not got them. */
  const stake = async (
    table: Table,
    seat: { id: string; userId: string | null },
    chips: number,
    deps: GameDeps,
  ): Promise<boolean> => {
    if (table.forFun) {
      if (table.purseFor(seat.id) < chips) {
        return false;
      }
      table.movePurse(seat.id, -chips);
      table.funBank += chips;
      return true;
    }
    if (seat.userId === null) {
      throw new TableError("Sign in to play for chips.");
    }
    if (!(await deps.take(seat.userId, chips))) {
      return false;
    }
    await bank?.add(chips);
    return true;
  };

  /**
   * A bot paying for its own chip.
   *
   * Synchronous, which is the whole reason it is not `stake` above: `play()`
   * cannot await, and on this path there is nothing to await. A bot only ever
   * plays at a for-fun table, where the purse and the bank are both fields on
   * the table.
   *
   * Without it the cloth carries a chip nobody paid for, and settlement then
   * pays the bot out of the table's bank as though it had.
   */
  const stakeFun = (table: Table, seatId: string, chips: number): boolean => {
    if (table.purseFor(seatId) < chips) {
      return false;
    }
    table.movePurse(seatId, -chips);
    table.funBank += chips;
    return true;
  };

  /** The same movement backwards, for a chip the table then refused. */
  const refundFun = (table: Table, seatId: string, chips: number): void => {
    table.funBank -= chips;
    table.movePurse(seatId, chips);
  };

  /** Chips out of the bank and back to the player. */
  const pay = async (
    table: Table,
    seat: { id: string; userId: string | null },
    chips: number,
    deps: GameDeps,
  ): Promise<void> => {
    if (chips <= 0) {
      return;
    }
    if (table.forFun) {
      table.funBank -= chips;
      table.movePurse(seat.id, chips);
      return;
    }
    /*
     * Only if the bank actually holds it. Every bet on this cloth was asked
     * again, at the seal, whether the bank could carry it — and anything it
     * could not was turned off, so whatever the dice did, what is owed now was
     * covered before they were released. So this cannot refuse, which is
     * exactly why it is checked. The alternative is a bank going negative in
     * silence and a cloth that has quietly started minting.
     *
     * And loudly, because a refusal now means something outside the book
     * moved the bank: another process, or a hand on the database. A winner
     * left unpaid with nothing in the log is how this hid the first time.
     */
    if (bank !== null && !(await bank.take(chips))) {
      console.error(
        `craps ${table.code}: the bank refused ${chips} owed to ${seat.userId ?? seat.id}`,
      );
      return;
    }
    if (seat.userId !== null) {
      await deps.give(seat.userId, chips);
    }
  };

  return {
    listing: CRAPS,

    create(code, made) {
      const window = WINDOWS.includes(made?.["window"] as (typeof WINDOWS)[number])
        ? (made?.["window"] as number)
        : (options.window ?? WINDOWS[1]);
      const table = new Table(code, seatLimit(made?.["maxSeats"], CRAPS.maxSeats), {
        pick: options.pick,
        window,
      });
      // Fixed when the table is opened: a table anybody may sit at and a table
      // that spends real chips are not the same game with a different label.
      table.forFun = made?.["forFun"] === true;
      return table;
    },

    async act(table, seatId, action, deps) {
      const move = action as { type?: string; spotId?: string; chips?: number; on?: boolean };
      const seat = table.seats.find((one) => one.id === seatId);
      if (seat === undefined) {
        throw new TableError("You are not at this table.");
      }

      await serially(table, async () => {
        switch (move.type) {
          case "place": {
            const spot = spotAt(move.spotId ?? "");
            if (spot === null) {
              throw new TableError("There is no such bet on this table.");
            }
            const chips = move.chips ?? 0;

            /*
             * What this spot can still take, worked out across the whole cloth.
             * Everybody's chips, not just this seat's: one pair of dice settles
             * all of them, so the table's exposure is a single shared number and
             * a cap that ignored the other seats would be a promise made in
             * front of people it did not count.
             */
            const most = headroom(await base(table), toBets(table.placed), table.hand, spot);
            if (chips > most) {
              throw new TableError(
                most === 0
                  ? "The bank cannot cover any more on that."
                  : `The bank covers ${most.toLocaleString("en-US")} on that at the moment.`,
              );
            }

            /*
             * Asked, paid, then placed. The table is asked first because it is
             * the cheap refusal, and placed last because by then nothing is left
             * to go wrong — which is what keeps a chip on the cloth and the
             * chips that paid for it from ever disagreeing.
             */
            table.check(seatId, spot.id, chips);
            if (!(await stake(table, seat, chips, deps))) {
              throw new TableError(
                table.forFun ? "That is more than your purse." : "You do not have the chips for that.",
              );
            }
            /*
             * And straight back out if the cloth refuses it now. Taking the
             * chips is an await, and the table does not stand still for it:
             * last call can arrive, the window can shut on its own clock, the
             * seat can go, the table can be called off. The chips are in the
             * bank by then, so they come out the way a take-back does — in
             * full, because a refused place never reached the escrow.
             */
            try {
              table.place(seatId, spot.id, chips);
            } catch (error) {
              await pay(table, seat, chips, deps);
              throw error;
            }
            return;
          }

          /*
           * Taking a chip back pays it out of the bank, which is the same
           * movement as a win and has to be, or a player could fill the bank by
           * placing and unplacing all evening.
           */
          case "take": {
            const spot = spotAt(move.spotId ?? "");
            if (spot === null) {
              throw new TableError("There is no such bet on this table.");
            }
            await giveBack(table, seat, () => table.take(seatId, spot.id, move.chips ?? 0), deps);
            return;
          }

          case "undo":
            await giveBack(table, seat, () => table.undo(seatId), deps);
            return;

          case "clear":
            await giveBack(table, seat, () => table.clear(seatId), deps);
            return;

          case "repeat": {
            const want = table.lastRound(seatId);
            for (const one of want) {
              const spot = spotAt(one.spotId);
              if (spot === null) {
                continue;
              }
              const most = headroom(await base(table), toBets(table.placed), table.hand, spot);
              if (one.chips > most) {
                continue;
              }
              /*
               * Skipped rather than abandoned, which is the one place this
               * differs from the wheel. Every roulette spot is legal every
               * spin, so a refusal there can only mean the window shut; here a
               * come bet recorded on the roll that sevened out is a bet the
               * come-out in front of it will not take, and returning on it
               * would let one stale spot silently cancel the whole replay.
               */
              try {
                table.check(seatId, one.spotId, one.chips);
              } catch {
                continue;
              }
              if (!(await stake(table, seat, one.chips, deps))) {
                return;
              }
              // The same await as a single chip, and the same way back out.
              try {
                table.place(seatId, one.spotId, one.chips);
              } catch {
                await pay(table, seat, one.chips, deps);
                return;
              }
            }
            return;
          }

          /*
           * The shooter throws. Nothing moves here except the phase — the dice
           * themselves are decided in `payOut`, inside the bank's queue,
           * because that is where the off rule has to be decided.
           */
          case "roll":
            table.shoot(seatId);
            return;

          /*
           * Whether this seat's numbers act through a come-out. No money
           * moves: the chips are already down and already in the bank, and
           * this only says whether the dice may reach them.
           */
          case "working":
            table.setWorking(seatId, move.on === true);
            return;

          default:
            throw new TableError("That is not a move at this table.");
        }
      });
    },

    /**
     * Releases the dice, hands chips back to anybody who stood up while bets
     * were open where the bank allows it, and reads what the store's bank holds
     * so the view can show a cap.
     *
     * All three belong here because this hook runs on every broadcast and is
     * allowed to be asynchronous, which the table's own clock is not. Leaving
     * is synchronous, so the table can only note who left, and whether their
     * chips can come off is a cover check against the bank; what the bank
     * holds is a question for the store, which a view cannot ask because
     * building one is synchronous; and the dice are the same question with
     * money on it.
     *
     * A for-fun table never needs the last of those: its bank is on the table
     * and its figure is exact from the moment it exists. Which is the good half
     * of doing it this way — the number can only ever be stale where staleness
     * costs a greyed-out spot on a table nobody is sitting at yet.
     */
    async payOut(table, deps) {
      /*
       * The dice, released inside the bank's own queue.
       *
       * This is the table's guarantee and the reason the `sealed` phase
       * exists. The off rule has to be decided against a bank figure that
       * nothing can move between reading it and the dice deciding, and the
       * hook for a timed phase is synchronous. So betting ends by sealing and
       * this — asynchronous, on every broadcast, able to ask for another —
       * does the rest.
       *
       * Taken off the queue before the first await, which is what makes
       * calling this often exactly-once rather than two throws for one seal.
       */
      if (table.phase === "sealed") {
        table.phase = "releasing";
        try {
          await serially(table, async () => {
            table.release(await base(table));
          });
        } catch (error) {
          /*
           * Put back where it was found. The latch above is what stops two
           * broadcasts throwing one seal twice, and a table left holding it
           * after the bank failed to answer is a table that never deals again
           * — so a failure hands the seal back for the next broadcast to try.
           */
          if (table.phase === "releasing") {
            table.phase = "sealed";
          }
          throw error;
        }
        return true;
      }
      if (table.leaving.size > 0) {
        await serially(table, async () => {
          /*
           * Round again whenever somebody's chips came off. A leaver refused
           * because their chips cover another bet is free to go once that bet
           * has gone too — and if everybody has left, no roll is coming to
           * settle what a refusal left behind.
           */
          let moved = true;
          while (moved) {
            moved = false;
            for (const seatId of [...table.leaving]) {
              const floor = await base(table);
              /*
               * Asked again after the bank has answered: the window may have
               * shut, the seat may have sat back down, or another broadcast
               * may have got here first.
               */
              if (table.phase !== "betting" || !table.leaving.has(seatId)) {
                continue;
              }
              /*
               * The table's own sweep rather than a filter over the cloth,
               * which is the one line roulette does not need. A pass line bet
               * with the point on is a contract: `take` refuses to bring it
               * down, and a leaver lifting it off with a filter would be the
               * same take-back by another door — stand up once the point is
               * unkind and get the stake back. `clear` keeps exactly what the
               * table keeps, and the rest comes off.
               */
              const lifted = lifts(table, floor, () => {
                table.clear(seatId);
              });
              /*
               * Refused, and still on the list: every later broadcast asks
               * again, until the chips come off or the window shuts and they
               * ride.
               */
              if ("refused" in lifted) {
                continue;
              }
              table.leaving.delete(seatId);
              moved = true;
              await handBack(
                table,
                { id: seatId, userId: table.accountOf(seatId) },
                lifted.off,
                deps,
              );
            }
          }
        });
      }
      if (!table.forFun) {
        const elsewhere = ledger?.owedElsewhere(table) ?? 0;
        table.housed = (await holds(table)) - elsewhere;
      }
    },

    isSettled(table) {
      return table.phase === "settling";
    },

    /**
     * Pays what the roll owes.
     *
     * Every stake is already in the bank, so this only ever moves winnings
     * out. The bank cannot refuse: every bet still working was asked at the
     * seal whether the bank could carry it and turned off if it could not, so
     * whatever the dice did, what is owed now was covered before they were
     * released. It is checked anyway, because the alternative to checking is a
     * bank that goes negative in silence.
     *
     * In the bank's queue, so that no other table reads the bank with this
     * roll's winnings paid out of it and still counted as owed, or the other
     * way round. The roll is read before joining the queue, not after: the
     * table opens its next window on its own clock, and a settle that looked
     * for the result once its turn came could find nothing there to pay.
     */
    async settle(table, deps) {
      const roll = table.paid;
      if (roll === null || table.dice === null) {
        return;
      }
      if (banked(table)) {
        unpaid.set(table, { roll, back: backOf(roll) });
      }
      /*
       * A decided payout is theirs, seated or not: chips that rode belong to
       * whatever the dice did, so somebody who stood up is owed what they
       * landed on. Who that is gets settled here, before the first await. The
       * account behind an empty seat is only remembered while something of
       * theirs is still on the felt, and the table opens its next window on its
       * own clock whether or not the store has finished paying for this roll.
       */
      const payees = [...roll].map(([seatId, paid]) => ({
        seat: {
          id: seatId,
          userId: table.seats.find((one) => one.id === seatId)?.userId ?? table.accountOf(seatId),
        },
        paid,
      }));
      await serially(table, async () => {
        for (const { seat, paid } of payees) {
          /*
           * Play money is paid but never recorded. A for-fun table touches no
           * account, so a win there is not a win anybody's profile should claim
           * — and a guest has no account to write one on either way.
           */
          if (table.forFun || seat.userId === null) {
            await pay(table, seat, paid.back, deps);
            continue;
          }
          await pay(table, seat, paid.back, deps);
          await deps.record(seat.userId, {
            shared: {
              rounds: 1,
              roundsWon: paid.back > paid.staked ? 1 : 0,
              chipsWon: paid.back - paid.staked,
              chipsStaked: paid.staked,
            },
            game: CRAPS.id,
            add: { rolls: 1 },
          });
        }
        paidOut.add(roll);
        unpaid.delete(table);
      });
    },

    /**
     * Calls the table off: every chip still on the cloth, back to whoever put
     * it there, and this table's claim on the bank released.
     */
    async void(table, deps) {
      const owed = table.escrow.close();
      refunding.set(
        table,
        owed.reduce((total, one) => total + one.chips, 0),
      );
      await serially(table, async () => {
        try {
          for (const one of owed) {
            await pay(table, { id: one.userId, userId: one.userId }, one.chips, deps);
          }
        } finally {
          // Gone before `serially` asks what the table owes on the way out.
          refunding.delete(table);
        }
      });
      ledger?.release(table);
      return owed;
    },

    /** Who came out of the roll ahead, which is not the same as who was paid. */
    winners(table) {
      if (table.paid === null) {
        return [];
      }
      return [...table.paid.entries()]
        .filter(([, paid]) => paid.back > paid.staked)
        .map(([seatId]) => seatId);
    },

    /**
     * The table's own clock, which is most of the engine here.
     *
     * Three waits going round: the felt is open until a deadline, the dice are
     * in the air for a fixed moment, and a finished roll sits where it is long
     * enough to be read. Nobody has a turn — the shooter's press only ends the
     * window early — so unlike the card tables there is never a wait on a
     * person, which is why this game has no `clock` and no `timeout` at all.
     */
    pause(table) {
      if (table.phase === "sealed" || table.phase === "releasing") {
        // Waiting on the bank, not on a clock. payOut moves this along.
        return null;
      }
      if (table.deadline === null) {
        return null;
      }
      const left = () => Math.max(0, (table.deadline ?? 0) - Date.now());
      switch (table.phase) {
        case "betting":
          return { key: "betting", ms: left(), run: () => table.seal() };
        case "rolling":
          return { key: "rolling", ms: Math.min(left(), rollMs), run: () => table.land() };
        case "settling":
          return {
            key: "settling",
            ms: Math.min(left(), settleMs),
            run: () => table.beginBetting(),
          };
      }
    },

    /**
     * What a seated bot wants to do next.
     *
     * Never at a table playing for chips. A bot has no account to take chips
     * from, so everything it puts down would be chips nobody won — and that is
     * the one thing this building does not do. The seating already refuses a
     * bot at a chips table for want of an identity; this is the same rule said
     * where the money is, because a rule with one lock on it is a rule with one
     * mistake between it and being false.
     *
     * Only while the felt is open, and only a chip at a time — a bot that put
     * its whole evening down at once would bury the cloth before anybody else
     * had looked at it.
     */
    botMove(table): BotMove | null {
      if (!table.forFun || table.phase !== "betting" || table.lastCall) {
        return null;
      }
      for (const seat of table.seats) {
        if (!seat.isBot || seat.waiting) {
          continue;
        }
        const bet = botBet(seat.skill ?? "normal", table.pilesFor(seat.id), table.purseFor(seat.id));
        if (bet === null) {
          continue;
        }
        return {
          seatId: seat.id,
          delayMs: thinkingTime(),
          play: () => {
            if (!stakeFun(table, seat.id, bet.chips)) {
              return;
            }
            try {
              table.place(seat.id, bet.spotId, bet.chips);
            } catch {
              // The window shut while it was thinking. Give the chips back.
              refundFun(table, seat.id, bet.chips);
            }
          },
        };
      }
      return null;
    },
  };
}
